import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  RequestRecord,
  RequestFile,
  RequestStatus,
  ApprovalRoute,
  RequestAction,
  RequestType,
  RequestDetails,
  Profile,
  DisbursementClarification,
} from '../types/database';
import { supabase, invokeEdgeFunction } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { MOCK_REQUESTS, MOCK_USERS } from '../lib/mockData';
import { loadThreshold } from '../lib/directory';

type Result = { success: boolean; error?: string; warning?: string };

/** Optional voice note recorded by the Clerk / Head / Admin while acting. */
export interface ActionVoice {
  blob: Blob;
  duration: number;
}

export interface DraftInput {
  type?: RequestType;
  title: string;
  amount: number;
  notes?: string;
  details?: RequestDetails | null;
  files?: RequestFile[];
}

export interface PaymentInput {
  amount?: number;
  payment_mode?: string;
  payment_ref?: string;
  payment_remarks?: string;
  payment_date?: string;
}

interface RequestContextType {
  requests: RequestRecord[];
  isLoading: boolean;
  /** High-value threshold (₹) from app_settings; Route B is blocked above it. */
  threshold: number;
  reloadThreshold: () => Promise<void>;
  refreshRequests: () => Promise<void>;
  getRequestById: (id: string) => RequestRecord | undefined;
  createDraft: (data: DraftInput) => Promise<{ success: boolean; id?: string; error?: string }>;
  updateDraft: (id: string, data: { title: string; amount: number; notes?: string; details?: RequestDetails | null }) => Promise<Result>;
  addFiles: (id: string, files: RequestFile[]) => Promise<Result>;
  removeFile: (requestId: string, fileId: string) => Promise<Result>;
  deleteDraft: (id: string) => Promise<Result>;
  submitRequest: (id: string) => Promise<{ success: boolean; request_no?: string; error?: string }>;
  withdrawRequest: (id: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  routeRequest: (id: string, route: ApprovalRoute, remarks?: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  forwardRequest: (id: string, remarks?: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  returnRequest: (id: string, remarks: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  rejectRequest: (id: string, reason: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  approveRequest: (
    id: string,
    voice?: ActionVoice | null,
    opts?: { reload?: boolean }
  ) => Promise<{ success: boolean; approval_no?: string; error?: string }>;
  /** Records a payment. `amount` omitted = pay the whole remaining balance. */
  markAsPaid: (id: string, details: PaymentInput) => Promise<{ success: boolean; error?: string; fully_paid?: boolean }>;
  /** Inter-department head consultations */
  requestHeadConsultations: (
    requestId: string,
    headIds: string[],
    note?: string,
    voice?: ActionVoice | null
  ) => Promise<{ success: boolean; count?: number; error?: string }>;
  respondHeadConsultation: (
    consultationId: string,
    status: 'agreed' | 'disagreed',
    remarks?: string,
    voice?: ActionVoice | null,
    requestId?: string
  ) => Promise<Result>;
  loadConsultableHeads: () => Promise<Profile[]>;
  requestDisbursementClarification: (
    requestId: string,
    note?: string,
    voice?: ActionVoice | null
  ) => Promise<Result>;
  respondDisbursementClarification: (
    clarificationId: string,
    responseNote?: string,
    voice?: ActionVoice | null,
    requestId?: string,
    files?: File[]
  ) => Promise<Result>;
  /** Owner Head cancels an approved request before it is fully paid. */
  cancelApprovedRequest: (id: string, reason: string, voice?: ActionVoice | null) => Promise<Result>;
  /** Stamps clarification attachments (ADDENDUM) and adds them to Signed Documents + packet. */
  signClarificationFiles: (requestId: string) => Promise<Result>;
}

const RequestContext = createContext<RequestContextType | undefined>(undefined);

const LOCAL_STORAGE_REQ_KEY = 'approval_app_requests_store';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Newest action first, files in upload order, resolve owner head. */
const normalize = (rows: RequestRecord[], headsByDept: Record<string, Partial<Profile>> = {}) =>
  rows.map((r) => {
    const deptHead =
      headsByDept[r.department_id] ||
      MOCK_USERS.find((u) => u.role === 'head' && u.department_id === r.department_id);

    const ownerHeadName =
      r.owner_head_name ||
      (r.requester_role === 'head' ? r.requester_name : null) ||
      deptHead?.full_name ||
      (r.consultations && r.consultations[0]?.requested_by_name) ||
      (r.department?.name ? `${r.department.name} Head` : null);

    const ownerHead =
      r.owner_head ||
      (deptHead
        ? {
            id: deptHead.id!,
            full_name: deptHead.full_name!,
            designation: deptHead.designation ?? null,
            photo_path: deptHead.photo_path ?? null,
          }
        : null) ||
      (r.requester_role === 'head' && r.requester ? r.requester : null);

    return {
      ...r,
      amount: Number(r.amount),
      paid_amount: Number(r.paid_amount ?? 0),
      requester_photo_path: r.requester?.photo_path || r.requester_photo_path || null,
      owner_head_id: r.owner_head_id || deptHead?.id || (r.requester_role === 'head' ? r.requester_id : null),
      owner_head_name: ownerHeadName,
      owner_head: ownerHead,
      payments: [...(r.payments || [])]
        .map((p) => ({ ...p, amount: Number(p.amount) }))
        .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.created_at.localeCompare(b.created_at)),
      actions: [...(r.actions || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      consultations: [...(r.consultations || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      disbursement_clarifications: [...(r.disbursement_clarifications || [])].sort(
        (a, b) => b.created_at.localeCompare(a.created_at)
      ),
      files: [...(r.files || [])].sort(
        (a, b) =>
          ((a as RequestFile & { sort_order?: number }).sort_order ?? 0) -
            ((b as RequestFile & { sort_order?: number }).sort_order ?? 0) || a.created_at.localeCompare(b.created_at)
      ),
    };
  });

export const RequestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isBackendConnected } = useAuth();
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [threshold, setThreshold] = useState<number>(10000);

  const loadRequests = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    if (isBackendConnected) {
      if (!user) {
        setRequests([]);
        setIsLoading(false);
        return;
      }

      // Try to load active heads to map department -> head profile
      const headsMap: Record<string, Partial<Profile>> = {};
      try {
        const { data: headsData } = await supabase
          .from('profiles')
          .select('id, full_name, designation, photo_path, department_id, role, is_active')
          .eq('role', 'head')
          .eq('is_active', true);
        (headsData || []).forEach((h) => {
          if (h.department_id) headsMap[h.department_id] = h;
        });
      } catch {
        // ignore
      }

      let data: any[] | null = null;
      let error: any = null;

      const res = await supabase
        .from('requests')
        .select(
          '*, department:departments(*), requester:profiles!requester_id(id, full_name, designation, photo_path), files:request_files(*), signed_files(*), actions:request_actions(*), payments:request_payments(*), consultations:head_consultations(*, head:profiles!head_id(id, full_name, designation, photo_path))'
        )
        .order('created_at', { ascending: false });

      if (!res.error && res.data) {
        data = res.data;
      } else {
        error = res.error;
        console.warn('Initial requests load error:', res.error?.message);
        // Fallback without consultations in case that has an issue
        const coreRes = await supabase
          .from('requests')
          .select(
            '*, department:departments(*), requester:profiles!requester_id(id, full_name, designation, photo_path), files:request_files(*), signed_files(*), actions:request_actions(*), payments:request_payments(*)'
          )
          .order('created_at', { ascending: false });
        if (!coreRes.error && coreRes.data) {
          data = coreRes.data;
          error = null;
        }
      }

      // Safe standalone fetch for disbursement clarifications so missing table/schema never blocks request list loading
      if (!error && data && data.length > 0) {
        try {
          const { data: clarifs, error: clarifErr } = await supabase
            .from('disbursement_clarifications')
            .select('*')
            .order('created_at', { ascending: false });
          if (!clarifErr && clarifs && clarifs.length > 0) {
            const map = new Map<string, DisbursementClarification[]>();
            clarifs.forEach((c: any) => {
              const list = map.get(c.request_id) || [];
              list.push(c as DisbursementClarification);
              map.set(c.request_id, list);
            });
            data.forEach((r: any) => {
              r.disbursement_clarifications = map.get(r.id) || [];
            });
          }
        } catch {
          // Table not yet migrated; gracefully ignored so requests still display!
        }
      }

      // RLS decides what each role sees; never substitute demo data in live mode.
      setRequests(!error && data ? normalize(data as RequestRecord[], headsMap) : []);
      setIsLoading(false);
      return;
    }

    const saved = localStorage.getItem(LOCAL_STORAGE_REQ_KEY);
    if (saved) {
      try {
        setRequests(normalize(JSON.parse(saved)));
        setIsLoading(false);
        return;
      } catch {
        // ignore
      }
    }

    setRequests(normalize(MOCK_REQUESTS));
    localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(MOCK_REQUESTS));
    setIsLoading(false);
  }, [isBackendConnected, user?.id]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const reloadThreshold = useCallback(async () => {
    setThreshold(await loadThreshold(isBackendConnected));
  }, [isBackendConnected]);

  useEffect(() => {
    if (!user) return;
    reloadThreshold();
  }, [reloadThreshold, user?.id]);

  // Live refresh: every workflow step notifies the next actor, so a new
  // notification for me means some request I can see has changed.
  useEffect(() => {
    if (!isBackendConnected || !user) return;
    const channel = supabase
      .channel(`req-refresh-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => loadRequests(true)
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRequests(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isBackendConnected, user?.id, loadRequests]);

  const updateLocalRequests = (updater: (prev: RequestRecord[]) => RequestRecord[]) => {
    setRequests((prev) => {
      const updated = updater(prev);
      localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const getRequestById = (id: string) => {
    return requests.find((r) => r.id === id);
  };

  /** Upload straight to Storage (path must start with the request id), then register. */
  const uploadFiles = async (requestId: string, files: RequestFile[]) => {
    for (const f of files) {
      if (!f.blob) continue;
      const contentType = (f.mime_type || f.blob.type).split(';')[0];
      const safe = f.original_name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(-60);
      const path = `${requestId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from('request-files')
        .upload(path, f.blob, { contentType, upsert: false });
      if (upErr) throw new Error(`Upload failed for ${f.original_name}: ${upErr.message}`);
      const { error: regErr } = await supabase.rpc('register_file', {
        p_request_id: requestId,
        p_kind: f.kind,
        p_storage_path: path,
        p_original_name: f.original_name,
        p_mime_type: contentType,
        p_size_bytes: f.blob.size,
        p_page_count: f.page_count,
        p_duration_sec: f.duration_sec,
      });
      if (regErr) {
        await supabase.storage.from('request-files').remove([path]);
        throw new Error(`Could not attach ${f.original_name}: ${regErr.message}`);
      }
    }
  };

  /** Approver voice note: upload to {request_id}/voice-… then register it on the request. */
  const uploadActionVoice = async (requestId: string, voice?: ActionVoice | null) => {
    if (!voice || !isBackendConnected) return;
    const rawType = (voice.blob.type || '').split(';')[0];
    const contentType = rawType.startsWith('audio/') ? rawType : 'audio/webm';
    const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
    const path = `${requestId}/voice-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('request-files')
      .upload(path, voice.blob, { contentType, upsert: false });
    if (upErr) throw new Error(`Voice note upload failed: ${upErr.message}`);
    const { error } = await supabase.rpc('attach_action_voice', {
      p_request_id: requestId,
      p_storage_path: path,
      p_mime_type: contentType,
      p_size_bytes: voice.blob.size,
      p_duration_sec: Math.min(300, Math.max(1, Math.round(voice.duration))),
    });
    if (error) throw new Error(`Could not attach voice note: ${error.message}`);
  };

  const createDraft = async (data: DraftInput): Promise<{ success: boolean; id?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const type: RequestType = data.type ?? 'general';

    if (isBackendConnected) {
      let requestId: string | undefined;
      try {
        const { data: newId, error } = await supabase.rpc('create_typed_draft', {
          p_type: type,
          p_title: data.title,
          p_amount: type === 'general' ? data.amount : null,
          p_notes: data.notes || null,
          p_details: data.details ?? {},
        });
        if (error) throw error;
        requestId = newId as string;
        await uploadFiles(requestId, data.files || []);
        await loadRequests();
        return { success: true, id: requestId };
      } catch (err: unknown) {
        if (requestId) await loadRequests();
        // The draft (if created) stays in My Requests so attachments can be retried.
        return { success: false, id: requestId, error: errMsg(err) };
      }
    }

    // Mock create draft
    const newId = `req-draft-${Date.now()}`;
    const mockDeptHead =
      user.role === 'head'
        ? user
        : MOCK_USERS.find((u) => u.role === 'head' && u.department_id === (user.department_id || 'dept-fin-001'));

    const newRecord: RequestRecord = {
      id: newId,
      request_no: null,
      requester_id: user.id,
      requester_name: user.full_name,
      requester_role: user.role,
      department_id: user.department_id || 'dept-fin-001',
      owner_head_id: mockDeptHead?.id || null,
      owner_head_name: mockDeptHead?.full_name || null,
      owner_head: mockDeptHead
        ? {
            id: mockDeptHead.id,
            full_name: mockDeptHead.full_name,
            designation: mockDeptHead.designation ?? null,
            photo_path: mockDeptHead.photo_path ?? null,
          }
        : null,
      title: data.title,
      notes: data.notes || null,
      amount: data.amount,
      request_type: type,
      details: data.details ?? null,
      shop_name: user.shop?.name ?? null,
      status: 'draft',
      route: null,
      routed_by: null,
      routed_at: null,
      approval_no: null,
      decided_by: null,
      decided_at: null,
      approver_role: null,
      verify_token: null,
      approving_by: null,
      approving_started_at: null,
      status_before_approving: null,
      paid_by: null,
      paid_at: null,
      payment_mode: null,
      payment_ref: null,
      payment_remarks: null,
      submitted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      department: user.department,
      files: data.files || [],
      actions: [],
    };

    updateLocalRequests((prev) => [newRecord, ...prev]);
    return { success: true, id: newId };
  };

  const updateDraft = async (
    id: string,
    data: { title: string; amount: number; notes?: string; details?: RequestDetails | null }
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      const { error } = await supabase.rpc('update_typed_draft', {
        p_request_id: id,
        p_title: data.title,
        p_amount: data.amount,
        p_notes: data.notes || null,
        p_details: data.details ?? null,
      });
      if (error) return { success: false, error: error.message };
      await loadRequests();
      return { success: true };
    }
    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, title: data.title, amount: data.amount, notes: data.notes || null, details: data.details ?? r.details, updated_at: new Date().toISOString() }
          : r
      )
    );
    return { success: true };
  };

  const addFiles = async (id: string, files: RequestFile[]): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      try {
        await uploadFiles(id, files);
        await loadRequests();
        return { success: true };
      } catch (err) {
        await loadRequests();
        return { success: false, error: errMsg(err) };
      }
    }
    const clean = files.map(({ blob: _blob, ...f }) => ({ ...f, request_id: id }));
    updateLocalRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, files: [...(r.files || []), ...clean] } : r))
    );
    return { success: true };
  };

  const removeFile = async (requestId: string, fileId: string): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      const { data: path, error } = await supabase.rpc('remove_file', { p_file_id: fileId });
      if (error) return { success: false, error: error.message };
      if (path) await supabase.storage.from('request-files').remove([path as string]);
      await loadRequests();
      return { success: true };
    }
    updateLocalRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, files: (r.files || []).filter((f) => f.id !== fileId) } : r))
    );
    return { success: true };
  };

  const deleteDraft = async (id: string): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const current = getRequestById(id);
    if (isBackendConnected) {
      // delete_draft requires the attachments to be removed first.
      for (const f of current?.files || []) {
        const res = await removeFile(id, f.id);
        if (!res.success) return res;
      }
      const { error } = await supabase.rpc('delete_draft', { p_request_id: id });
      if (error) return { success: false, error: error.message };
      await loadRequests();
      return { success: true };
    }
    updateLocalRequests((prev) => prev.filter((r) => r.id !== id));
    return { success: true };
  };

  const submitRequest = async (id: string): Promise<{ success: boolean; request_no?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('submit_request', {
          p_request_id: id,
        });
        if (error) throw error;
        const { data: row } = await supabase.from('requests').select('request_no').eq('id', id).maybeSingle();
        await loadRequests();
        return { success: true, request_no: row?.request_no ?? undefined };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Mock submit
    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const genNo = current.request_no || `REQ-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'submitted',
      from_status: current.status,
      to_status: 'submitted',
      remarks: 'Request formally submitted for department processing.',
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'submitted',
              request_no: genNo,
              submitted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true, request_no: genNo };
  };

  const withdrawRequest = async (id: string, reason?: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('withdraw_request', {
          p_request_id: id,
          p_remarks: reason || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'withdrawn',
      from_status: current.status,
      to_status: 'withdrawn',
      remarks: reason || 'Withdrawn by requester.',
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'withdrawn',
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  const routeRequest = async (
    id: string,
    route: ApprovalRoute,
    remarks?: string,
    voice?: ActionVoice | null
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    // High-value rule: Route B is not allowed above the configured threshold (Discount is always B)
    if (route === 'B' && current.request_type !== 'discount' && current.amount > threshold) {
      return {
        success: false,
        error: `Requests above ₹${threshold.toLocaleString('en-IN')} must take Route A (Admin approval required).`,
      };
    }

    if (route === 'B' && current.requester_role === 'head') {
      return { success: false, error: 'A Department Head cannot approve their own request.' };
    }

    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { error } = await supabase.rpc('route_request', {
          p_request_id: id,
          p_route: route,
          p_remarks: remarks || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    let nextStatus: RequestStatus;
    if (route === 'B') {
      nextStatus = 'pending_head_approval';
    } else {
      nextStatus = current.requester_role === 'head' ? 'pending_admin_approval' : 'pending_head_review';
    }

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: `routed_${route}`,
      from_status: current.status,
      to_status: nextStatus,
      remarks: remarks || `Routed to Route ${route}.`,
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: nextStatus,
              route,
              routed_by: user.id,
              routed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  const forwardRequest = async (id: string, remarks?: string, voice?: ActionVoice | null): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { error } = await supabase.rpc('forward_request', {
          p_request_id: id,
          p_remarks: remarks || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'forwarded',
      from_status: current.status,
      to_status: 'pending_admin_approval',
      remarks: remarks || 'Reviewed and forwarded to Admin.',
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'pending_admin_approval',
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  const returnRequest = async (id: string, remarks: string, voice?: ActionVoice | null): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!remarks.trim()) return { success: false, error: 'A remark is required when returning a request.' };

    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { error } = await supabase.rpc('return_request', {
          p_request_id: id,
          p_remarks: remarks,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'returned',
      from_status: current.status,
      to_status: 'returned',
      remarks,
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'returned',
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  const rejectRequest = async (id: string, reason: string, voice?: ActionVoice | null): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!reason.trim()) return { success: false, error: 'A reason is required when rejecting a request.' };

    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { error } = await supabase.rpc('reject_request', {
          p_request_id: id,
          p_remarks: reason,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'rejected',
      from_status: current.status,
      to_status: 'rejected',
      remarks: reason,
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'rejected',
              decided_by: user.id,
              decided_at: new Date().toISOString(),
              approver_role: user.role,
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  const approveRequest = async (
    id: string,
    voice?: ActionVoice | null,
    opts: { reload?: boolean } = {}
  ): Promise<{ success: boolean; approval_no?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { data, error } = await invokeEdgeFunction<{ approval_no: string }>('approve-request', {
          request_id: id,
          // Used for the QR / verify link stamped on every page.
          app_url: window.location.origin,
        });
        if (error) throw error;
        if (opts.reload !== false) await loadRequests();
        return { success: true, approval_no: data?.approval_no };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const approvalNo = current.approval_no || `APR-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    const verifyToken = current.verify_token || `vtok-${Math.random().toString(36).substring(2, 14)}`;

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'approved',
      from_status: current.status,
      to_status: 'approved',
      remarks: 'Approved and digitally stamped with official seal and signature.',
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'approved',
              approval_no: approvalNo,
              verify_token: verifyToken,
              decided_by: user.id,
              decided_at: new Date().toISOString(),
              approver_role: user.role,
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
              signed_files: [
                {
                  id: `signed-${Date.now()}`,
                  request_id: id,
                  source_file_id: null,
                  storage_path: `signed/${approvalNo}_packet.pdf`,
                  sha256: 'a9f24e7821bc19e3489d71fa90bce32148b598710fa982341209bca3482910fa',
                  page_count: (r.files?.length || 1) + 1,
                  created_at: new Date().toISOString(),
                },
              ],
            }
          : r
      )
    );

    return { success: true, approval_no: approvalNo };
  };

  const markAsPaid = async (
    id: string,
    details: PaymentInput
  ): Promise<{ success: boolean; error?: string; fully_paid?: boolean }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { data, error } = await supabase.rpc('add_payment', {
          p_request_id: id,
          p_amount: details.amount ?? null,
          p_payment_date: details.payment_date || null,
          p_payment_mode: details.payment_mode || null,
          p_payment_ref: details.payment_ref || null,
          p_remarks: details.payment_remarks || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true, fully_paid: !!(data as { fully_paid?: boolean } | null)?.fully_paid };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Offline sandbox mirrors the add_payment rules
    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };
    if (current.status === 'paid') return { success: false, error: 'This request is already fully paid.' };
    const already = Number(current.paid_amount ?? 0);
    const balance = Math.round((current.amount - already) * 100) / 100;
    const amt = Math.round((details.amount ?? balance) * 100) / 100;
    if (amt <= 0) return { success: false, error: 'Payment amount must be more than zero.' };
    if (amt > balance) return { success: false, error: `Payment is more than the balance of ₹${balance.toFixed(2)}.` };
    const paid = already + amt;
    const full = paid >= current.amount;
    const now = new Date().toISOString();
    const date = details.payment_date || now.slice(0, 10);

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: full ? 'paid' : 'partial_payment',
      from_status: current.status,
      to_status: full ? 'paid' : current.status,
      remarks: full
        ? `Paid via ${details.payment_mode || 'Direct Transfer'}. Ref: ${details.payment_ref || 'N/A'}. ${details.payment_remarks || ''}`
        : `Paid ₹${amt.toFixed(2)} · balance ₹${(current.amount - paid).toFixed(2)}`,
      visible_to_requester: true,
      created_at: now,
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: full ? 'paid' : r.status,
              paid_amount: paid,
              paid_by: full ? user.id : r.paid_by,
              paid_at: full ? now : r.paid_at,
              payment_mode: full ? details.payment_mode || 'NEFT' : r.payment_mode,
              payment_ref: full ? details.payment_ref || null : r.payment_ref,
              payment_remarks: full ? details.payment_remarks || null : r.payment_remarks,
              updated_at: now,
              payments: [
                ...(r.payments || []),
                {
                  id: `pay-${Date.now()}`, request_id: id, amount: amt, payment_date: date,
                  payment_mode: details.payment_mode || null, payment_ref: details.payment_ref || null,
                  remarks: details.payment_remarks || null, paid_by: user.id, paid_by_name: user.full_name, created_at: now,
                },
              ],
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true, fully_paid: full };
  };

  const requestHeadConsultations = async (
    requestId: string,
    headIds: string[],
    note?: string,
    voice?: ActionVoice | null
  ): Promise<{ success: boolean; count?: number; error?: string }> => {
    if (!headIds.length) return { success: false, error: 'Select at least one department head' };
    if (isBackendConnected) {
      let voicePath: string | null = null;
      let voiceDuration: number | null = null;
      if (voice) {
        try {
          const rawType = (voice.blob.type || '').split(';')[0];
          const contentType = rawType.startsWith('audio/') ? rawType : 'audio/webm';
          const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
          voicePath = `${requestId}/voice-consult-${crypto.randomUUID()}.${ext}`;
          voiceDuration = Math.min(300, Math.max(1, Math.round(voice.duration)));
          const { error: upErr } = await supabase.storage
            .from('request-files')
            .upload(voicePath, voice.blob, { contentType, upsert: false });
          if (upErr) throw new Error(`Audio record upload failed: ${upErr.message}`);
        } catch (uploadErr: unknown) {
          return {
            success: false,
            error: uploadErr instanceof Error ? uploadErr.message : 'Voice upload failed',
          };
        }
      }

      const { data, error } = await supabase.rpc('request_head_consultations', {
        p_request_id: requestId,
        p_head_ids: headIds,
        p_note: note || null,
        p_voice_path: voicePath,
        p_voice_duration: voiceDuration,
      });
      if (error) return { success: false, error: error.message };
      await loadRequests(true);
      return { success: true, count: data?.count };
    }
    return { success: true, count: headIds.length };
  };

  const respondHeadConsultation = async (
    consultationId: string,
    status: 'agreed' | 'disagreed',
    remarks?: string,
    voice?: ActionVoice | null,
    requestId?: string
  ): Promise<Result> => {
    if (isBackendConnected) {
      let voicePath: string | null = null;
      let voiceDuration: number | null = null;
      if (voice && requestId) {
        try {
          const rawType = (voice.blob.type || '').split(';')[0];
          const contentType = rawType.startsWith('audio/') ? rawType : 'audio/webm';
          const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
          voicePath = `${requestId}/voice-resp-${crypto.randomUUID()}.${ext}`;
          voiceDuration = Math.min(300, Math.max(1, Math.round(voice.duration)));
          const { error: upErr } = await supabase.storage
            .from('request-files')
            .upload(voicePath, voice.blob, { contentType, upsert: false });
          if (upErr) throw new Error(`Audio record upload failed: ${upErr.message}`);
        } catch (uploadErr: unknown) {
          return {
            success: false,
            error: uploadErr instanceof Error ? uploadErr.message : 'Voice upload failed',
          };
        }
      }

      const { error } = await supabase.rpc('respond_head_consultation', {
        p_consultation_id: consultationId,
        p_status: status,
        p_remarks: remarks || null,
        p_voice_path: voicePath,
        p_voice_duration: voiceDuration,
      });
      if (error) return { success: false, error: error.message };
      await loadRequests(true);
      return { success: true };
    }
    return { success: true };
  };

  const loadConsultableHeads = async (): Promise<Profile[]> => {
    if (isBackendConnected) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, department:departments(*)')
        .eq('role', 'head')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) {
        console.error('Failed to load heads:', error);
        return [];
      }
      return (data || []) as Profile[];
    }
    return [];
  };

  const requestDisbursementClarification = async (
    requestId: string,
    note?: string,
    voice?: ActionVoice | null
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const r = requests.find((x) => x.id === requestId);
    if (!r) return { success: false, error: 'Request not found' };

    let voicePath: string | null = null;
    let voiceDuration: number | null = null;

    if (isBackendConnected) {
      if (voice) {
        try {
          const rawType = (voice.blob.type || '').split(';')[0];
          const contentType = rawType.startsWith('audio/') ? rawType : 'audio/webm';
          const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
          // Must start with "voice-" to satisfy storage policy: split_part(name, '/', 2) like 'voice-%'
          voicePath = `${requestId}/voice-disb-${crypto.randomUUID()}.${ext}`;
          voiceDuration = Math.min(300, Math.max(1, Math.round(voice.duration)));
          const { error: upErr } = await supabase.storage
            .from('request-files')
            .upload(voicePath, voice.blob, { contentType, upsert: false });
          if (upErr) {
            if (upErr.message.includes('row-level security') || upErr.message.includes('policy')) {
              throw new Error(
                'Supabase Storage policy blocked upload: Please execute migration 0018_disbursement_clarifications.sql in Supabase SQL Editor to allow voice notes for disbursement.'
              );
            }
            throw new Error(`Audio upload failed: ${upErr.message}`);
          }
        } catch (uploadErr: unknown) {
          return {
            success: false,
            error: uploadErr instanceof Error ? uploadErr.message : 'Voice upload failed',
          };
        }
      }

      const { error } = await supabase.rpc('request_disbursement_clarification', {
        p_request_id: requestId,
        p_note: note || null,
        p_voice_path: voicePath,
        p_voice_duration: voiceDuration,
      });
      if (error) {
        if (
          error.message.includes('function') ||
          error.message.includes('schema cache') ||
          error.message.includes('does not exist')
        ) {
          return {
            success: false,
            error:
              'Database migration required: Please run migration 0018_disbursement_clarifications.sql in Supabase SQL Editor to enable clarifications.',
          };
        }
        return { success: false, error: error.message };
      }
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    const newClarification: DisbursementClarification = {
      id: `clarif-${Date.now()}`,
      request_id: requestId,
      requested_by: user.id,
      requested_by_name: user.full_name,
      head_id: r.owner_head_id || 'user-head-fin-002',
      head_name: r.owner_head_name || 'Rajesh Sharma',
      request_note: note || null,
      request_voice_path: voice ? URL.createObjectURL(voice.blob) : null,
      request_voice_duration: voice ? Math.round(voice.duration) : null,
      status: 'pending_head',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: requestId,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'disbursement_clarification_requested',
      from_status: r.status,
      to_status: r.status,
      remarks: note || 'Disbursement sent request to Head for clarification',
      visible_to_requester: false,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((req) =>
        req.id === requestId
          ? {
              ...req,
              disbursement_clarifications: [
                newClarification,
                ...(req.disbursement_clarifications || []),
              ],
              actions: [action, ...(req.actions || [])],
            }
          : req
      )
    );
    return { success: true };
  };

  const respondDisbursementClarification = async (
    clarificationId: string,
    responseNote?: string,
    voice?: ActionVoice | null,
    requestId?: string,
    files: File[] = []
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    let voicePath: string | null = null;
    let voiceDuration: number | null = null;

    if (isBackendConnected) {
      const uploaded: { storage_path: string; original_name: string; mime_type: string; size_bytes: number }[] = [];
      if (files.length > 0) {
        if (!requestId) return { success: false, error: 'Request id missing for attachments' };
        for (const file of files) {
          const contentType = (file.type || '').split(';')[0];
          const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(-60);
          // Must start with "clarif-" to satisfy the clarification upload storage policy.
          const path = `${requestId}/clarif-${crypto.randomUUID()}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from('request-files')
            .upload(path, file, { contentType, upsert: false });
          if (upErr) {
            if (uploaded.length) await supabase.storage.from('request-files').remove(uploaded.map((u) => u.storage_path));
            return { success: false, error: `Upload failed for ${file.name}: ${upErr.message}` };
          }
          uploaded.push({ storage_path: path, original_name: file.name, mime_type: contentType, size_bytes: file.size });
        }
      }
      if (voice && requestId) {
        try {
          const rawType = (voice.blob.type || '').split(';')[0];
          const contentType = rawType.startsWith('audio/') ? rawType : 'audio/webm';
          const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm';
          // Must start with "voice-" to satisfy storage policy: split_part(name, '/', 2) like 'voice-%'
          voicePath = `${requestId}/voice-head-${crypto.randomUUID()}.${ext}`;
          voiceDuration = Math.min(300, Math.max(1, Math.round(voice.duration)));
          const { error: upErr } = await supabase.storage
            .from('request-files')
            .upload(voicePath, voice.blob, { contentType, upsert: false });
          if (upErr) {
            if (upErr.message.includes('row-level security') || upErr.message.includes('policy')) {
              throw new Error(
                'Supabase Storage policy blocked upload: Please execute migration 0018_disbursement_clarifications.sql in Supabase SQL Editor to allow voice notes for heads.'
              );
            }
            throw new Error(`Audio upload failed: ${upErr.message}`);
          }
        } catch (uploadErr: unknown) {
          return {
            success: false,
            error: uploadErr instanceof Error ? uploadErr.message : 'Voice upload failed',
          };
        }
      }

      const { error } = await supabase.rpc('respond_disbursement_clarification', {
        p_clarification_id: clarificationId,
        p_response_note: responseNote || null,
        p_voice_path: voicePath,
        p_voice_duration: voiceDuration,
        p_files: uploaded,
      });
      if (error && uploaded.length) {
        await supabase.storage.from('request-files').remove(uploaded.map((u) => u.storage_path));
      }
      if (error) {
        if (
          error.message.includes('function') ||
          error.message.includes('schema cache') ||
          error.message.includes('does not exist')
        ) {
          return {
            success: false,
            error:
              'Database migration required: Please run migration 0018_disbursement_clarifications.sql in Supabase SQL Editor to enable clarifications.',
          };
        }
        return { success: false, error: error.message };
      }
      if (uploaded.length && requestId) {
        const signed = await signClarificationFiles(requestId);
        if (!signed.success) {
          return {
            success: true,
            warning: `Reply sent, but the files could not be added to Signed Documents yet: ${signed.error}`,
          };
        }
        return { success: true };
      }
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    const targetReq = requests.find((rq) => (rq.disbursement_clarifications || []).some((c) => c.id === clarificationId));
    const reqStatus = targetReq?.status || 'approved';
    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: requestId || targetReq?.id || '',
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'disbursement_clarification_provided',
      from_status: reqStatus,
      to_status: reqStatus,
      remarks: responseNote || 'Head provided clarification and sent back to Disbursement',
      visible_to_requester: false,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((req) => {
        const clarifs = req.disbursement_clarifications || [];
        const hasIt = clarifs.some((c) => c.id === clarificationId);
        if (!hasIt) return req;
        const updatedClarifs = clarifs.map((c) =>
          c.id === clarificationId
            ? {
                ...c,
                responded_by: user.id,
                responded_by_name: user.full_name,
                response_note: responseNote || null,
                response_voice_path: voice ? URL.createObjectURL(voice.blob) : null,
                response_voice_duration: voice ? Math.round(voice.duration) : null,
                responded_at: new Date().toISOString(),
                status: 'clarified' as const,
                updated_at: new Date().toISOString(),
              }
            : c
        );
        return {
          ...req,
          disbursement_clarifications: updatedClarifs,
          actions: [action, ...(req.actions || [])],
        };
      })
    );
    return { success: true };
  };

  const signClarificationFiles = async (requestId: string): Promise<Result> => {
    if (!isBackendConnected) return { success: true };
    try {
      const { error } = await invokeEdgeFunction<{ signed: number }>('sign-clarification-files', {
        request_id: requestId,
        app_url: window.location.origin,
      });
      if (error) throw error;
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: errMsg(err) };
    } finally {
      await loadRequests(true);
    }
  };

  const cancelApprovedRequest = async (id: string, reason: string, voice?: ActionVoice | null): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const r = requests.find((x) => x.id === id);
    if (!r) return { success: false, error: 'Request not found' };
    if (isBackendConnected) {
      try {
        await uploadActionVoice(id, voice);
        const { error } = await supabase.rpc('cancel_approved_request', { p_request_id: id, p_reason: reason });
        if (error) throw error;
        await loadRequests(true);
        return { success: true };
      } catch (err: unknown) {
        await loadRequests(true);
        return { success: false, error: errMsg(err) };
      }
    }
    // Mock mode
    if (r.status !== 'approved') return { success: false, error: 'Only approved requests can be cancelled' };
    const now = new Date().toISOString();
    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'cancelled',
      from_status: 'approved',
      to_status: 'cancelled',
      remarks: reason,
      visible_to_requester: true,
      created_at: now,
    };
    updateLocalRequests((prev) =>
      prev.map((req) =>
        req.id === id
          ? {
              ...req,
              status: 'cancelled',
              cancelled_by: user.id,
              cancelled_by_name: user.full_name,
              cancelled_at: now,
              cancel_reason: reason,
              updated_at: now,
              actions: [action, ...(req.actions || [])],
            }
          : req
      )
    );
    return { success: true };
  };

  return (
    <RequestContext.Provider
      value={{
        requests,
        isLoading,
        threshold,
        reloadThreshold,
        refreshRequests: loadRequests,
        getRequestById,
        createDraft,
        updateDraft,
        addFiles,
        removeFile,
        deleteDraft,
        submitRequest,
        withdrawRequest,
        routeRequest,
        forwardRequest,
        returnRequest,
        rejectRequest,
        approveRequest,
        markAsPaid,
        requestHeadConsultations,
        respondHeadConsultation,
        loadConsultableHeads,
        requestDisbursementClarification,
        respondDisbursementClarification,
        cancelApprovedRequest,
        signClarificationFiles,
      }}
    >
      {children}
    </RequestContext.Provider>
  );
};

export const useRequests = () => {
  const context = useContext(RequestContext);
  if (!context) {
    throw new Error('useRequests must be used within a RequestProvider');
  }
  return context;
};
