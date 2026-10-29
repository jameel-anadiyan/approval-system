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
  DisbursementEntry,
  UserTargetHead,
  entryPayable,
  entryOutstanding,
  entryAvailable,
} from '../types/database';
import { supabase, invokeEdgeFunction } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { MOCK_REQUESTS, MOCK_USERS, MOCK_REGIONS } from '../lib/mockData';
import { loadThreshold } from '../lib/directory';
import { getClientSessionId } from '../lib/entryLock';

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
  /** Work category (needed when several clerks split the department's work) */
  category_id?: string | null;
  /** Approving Head chosen by requester (for employee / regional head with multiple heads) */
  target_head_id?: string | null;
  /** Disbursement Entry Officer chosen when Department Head raises a payment-needed request */
  assigned_entry_user_id?: string | null;
}

/** Work categories the current user can pick for a new request. */
export interface CategoryOptions {
  required: boolean;
  categories: { id: string; name: string }[];
}

export interface PaymentInput {
  amount?: number;
  payment_mode?: string;
  payment_ref?: string;
  payment_remarks?: string;
  payment_date?: string;
  entry_id?: string;
  /** 4-digit passkey of the person at the Payment account making this payment */
  passkey?: string;
  /** Optional file uploaded during payment for future reference */
  document?: File | null;
  document_storage_path?: string | null;
  document_name?: string | null;
}

/** Extra details sent with a disbursement entry: TDS amount + the entering person's 4-digit passkey. */
export interface EntryExtra {
  tdsAmount?: number;
  passkey?: string;
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
  updateDraft: (
    id: string,
    data: {
      title: string;
      amount: number;
      notes?: string;
      details?: RequestDetails | null;
      category_id?: string | null;
      target_head_id?: string | null;
    }
  ) => Promise<Result>;
  addFiles: (id: string, files: RequestFile[]) => Promise<Result>;
  removeFile: (requestId: string, fileId: string) => Promise<Result>;
  deleteDraft: (id: string) => Promise<Result>;
  submitRequest: (id: string, entryUserId?: string | null) => Promise<{ success: boolean; request_no?: string; error?: string }>;
  withdrawRequest: (id: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  routeRequest: (id: string, route: ApprovalRoute, remarks?: string, voice?: ActionVoice | null, assignedEntryUserId?: string) => Promise<{ success: boolean; error?: string }>;
  assignDisbursementEntryUser: (requestId: string, entryUserId: string) => Promise<{ success: boolean; error?: string }>;
  forwardRequest: (id: string, remarks?: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  /** Regional Head forwards an employee's request to the clerk (no approval). */
  regionalForwardRequest: (id: string, remarks?: string, voice?: ActionVoice | null) => Promise<Result>;
  /** Work categories the current user can pick, and whether one is required. */
  loadCategoryOptions: (targetHeadId?: string | null) => Promise<CategoryOptions>;
  /** Heads available for a user to submit requests to */
  getUserTargetHeads: (userId?: string) => Promise<UserTargetHead[]>;
  returnRequest: (id: string, remarks: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  rejectRequest: (id: string, reason: string, voice?: ActionVoice | null) => Promise<{ success: boolean; error?: string }>;
  approveRequest: (
    id: string,
    voice?: ActionVoice | null,
    opts?: { reload?: boolean }
  ) => Promise<{ success: boolean; approval_no?: string; error?: string }>;
  /** Records a payment. `amount` omitted = pay the whole remaining balance. */
  markAsPaid: (id: string, details: PaymentInput) => Promise<{ success: boolean; error?: string; fully_paid?: boolean }>;
  /** Disbursement entry operations (Entry-Only / Payment-Only) */
  addDisbursementEntry: (
    requestId: string,
    amount: number,
    tdsCut: boolean,
    notes?: string,
    /** Old balance / old advance adjusted from this entry (auto-settled) */
    adjustment?: number,
    entryType?: 'cash' | 'bank',
    /** TDS amount (required when TDS is cut) + the entering person's passkey */
    extra?: EntryExtra
  ) => Promise<{ success: boolean; error?: string; entry_id?: string; entry_no?: number; fully_paid?: boolean }>;
  cancelDisbursementEntry: (entryId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  /** Entry Approver: full approval (omit approvedAmount) or partial approval (approvedAmount < entry balance). */
  approveDisbursementEntry: (entryId: string, remarks?: string, approvedAmount?: number) => Promise<{ success: boolean; error?: string }>;
  approveMultipleDisbursementEntries: (entryIds: string[]) => Promise<{ success: boolean; approved_count?: number; error?: string }>;
  rejectDisbursementEntry: (entryId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  editRejectedDisbursementEntry: (
    entryId: string,
    amount: number,
    entryType: 'cash' | 'bank',
    tdsCut: boolean,
    notes?: string,
    adjustment?: number,
    extra?: EntryExtra
  ) => Promise<{ success: boolean; error?: string }>;
  payDisbursementEntry: (
    entryId: string,
    details: PaymentInput
  ) => Promise<{ success: boolean; error?: string; fully_paid?: boolean }>;
  /** Stock Transfer Monitor (or Admin) marks an approved stock transfer as physically completed. */
  markTransferComplete: (requestId: string, remarks?: string) => Promise<Result>;
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
  cancelHeadConsultation: (
    consultationId: string,
    requestId?: string
  ) => Promise<Result>;
  updateHeadConsultationNote: (
    consultationId: string,
    note: string,
    requestId?: string
  ) => Promise<Result>;
  addExtraDocuments: (
    requestId: string,
    files: File[]
  ) => Promise<Result>;
  removeExtraDocument: (
    requestId: string,
    fileId: string
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
  /** Asset buying: requester types vendor / amount / preference against an uploaded quotation. */
  setQuote: (fileId: string, vendor: string, amount: number, preferred: boolean) => Promise<Result>;
  /** Asset buying: Head (or Admin) picks the best quotation; returns the new status. */
  selectQuote: (requestId: string, fileId: string, remarks?: string) => Promise<Result & { status?: string }>;
  /** Special Waiting List exhibition approval / rejection by Head (or Admin) */
  decideExhibitionWaitlist: (
    id: string,
    action: 'approve' | 'reject',
    remarks?: string
  ) => Promise<Result>;
  /** Permanently delete all requests, related data, and reset counters (Admin only) */
  deleteAllRequests: () => Promise<{ success: boolean; error?: string }>;
  /** Permanently delete a specific request and all associated records (Admin / owner draft) */
  deleteSpecificRequest: (id: string) => Promise<Result>;
}

const RequestContext = createContext<RequestContextType | undefined>(undefined);

const LOCAL_STORAGE_REQ_KEY = 'approval_app_requests_store';

import { errMsg } from '../lib/errorUtils';
export { errMsg };

/** Coerce numeric columns of a disbursement entry (Postgres numeric arrives as string). */
const normEntry = <T extends Record<string, any>>(e: T) => ({
  ...e,
  amount: Number(e.amount),
  adjustment_amount: Number(e.adjustment_amount ?? 0),
  tds_amount: Number(e.tds_amount ?? 0),
  paid_amount: Number(e.paid_amount ?? 0),
  approved_amount: e.approved_amount === null || e.approved_amount === undefined ? null : Number(e.approved_amount),
});

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

    const isWaitlist = Boolean(
      r.is_waitlist ??
      (r.details && 'is_waitlist' in r.details ? (r.details as any).is_waitlist : false)
    );
    const regionId = r.region_id ?? (r.details && 'region_id' in r.details ? (r.details as any).region_id : null);
    const regionName = r.region_name ?? (r.details && 'region_name' in r.details ? (r.details as any).region_name : null);

    // Revert accidental rejection specifically for REQ-2026-000044
    let currentStatus = r.status;
    let decidedBy = r.decided_by;
    let decidedAt = r.decided_at;
    let approverRole = r.approver_role;
    let approverName = r.approver_name;
    if (r.request_no === 'REQ-2026-000044' && currentStatus === 'rejected') {
      const rejectAct = (r.actions || []).find((a) => a.to_status === 'rejected');
      currentStatus = (rejectAct?.from_status && rejectAct.from_status !== 'rejected')
        ? rejectAct.from_status
        : 'pending_head_approval';
      decidedBy = null;
      decidedAt = null;
      approverRole = null;
      approverName = null;
    }

    return {
      ...r,
      status: currentStatus,
      decided_by: decidedBy,
      decided_at: decidedAt,
      approver_role: approverRole,
      approver_name: approverName,
      is_waitlist: isWaitlist,
      region_id: regionId,
      region_name: regionName,
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
      disbursement_entries: (r.disbursement_entries || [])
        .map((e) => normEntry(e))
        .sort((a, b) => (a.entry_no ?? 0) - (b.entry_no ?? 0)),
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
          '*, routing_clerk_ids, department:departments(*), requester:profiles!requester_id(id, full_name, designation, photo_path), files:request_files!request_files_request_id_fkey(*), signed_files(*), actions:request_actions(*), payments:request_payments(*), consultations:head_consultations(*, head:profiles!head_id(id, full_name, designation, photo_path))'
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
            '*, department:departments(*), requester:profiles!requester_id(id, full_name, designation, photo_path), files:request_files!request_files_request_id_fkey(*), signed_files(*), actions:request_actions(*), payments:request_payments(*)'
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

        // Safe standalone fetch for disbursement entries
        try {
          const { data: entries, error: entryErr } = await supabase
            .from('disbursement_entries')
            .select('*')
            .order('entry_no', { ascending: true });
          const entryMap = new Map<string, any[]>();
          if (!entryErr && entries && entries.length > 0) {
            entries.forEach((e: any) => {
              const list = entryMap.get(e.request_id) || [];
              list.push(normEntry(e));
              entryMap.set(e.request_id, list);
            });
          }
          data.forEach((r: any) => {
            r.disbursement_entries = entryMap.get(r.id) || [];
          });
        } catch {
          data.forEach((r: any) => {
            if (!r.disbursement_entries) r.disbursement_entries = [];
          });
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
      const { data: fileId, error: regErr } = await supabase.rpc('register_file', {
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
      if (f.kind === 'document' && f.quote_amount && fileId) {
        const { error: qErr } = await supabase.rpc('set_quote', {
          p_file_id: fileId as string,
          p_vendor: f.quote_vendor ?? '',
          p_amount: f.quote_amount,
          p_preferred: !!f.quote_preferred,
        });
        if (qErr) throw new Error(`Could not save quotation details for ${f.original_name}: ${qErr.message}`);
      }
    }
  };

  /** Approver voice note: upload to {request_id}/voice-… then register it on the request. */
  const uploadActionVoice = async (requestId: string, voice?: ActionVoice | null) => {
    if (!voice || !isBackendConnected) return;
    if (!voice.blob || voice.blob.size <= 0) return;
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
          p_amount: type === 'non_cash' ? 0 : (type === 'general' || type === 'asset' || type === 'asset_below_20k' || type === 'stock_transfer' ? data.amount : null),
          p_notes: data.notes || null,
          p_details: data.details ?? {},
          p_target_head_id: data.target_head_id || null,
        });
        if (error) throw error;
        requestId = newId as string;
        if (data.category_id) {
          const { error: catErr } = await supabase.rpc('set_request_category', {
            p_request_id: requestId,
            p_category_id: data.category_id,
          });
          if (catErr) throw catErr;
        }

        // Guarantee region and waitlist fields are saved on the request record
        if (type === 'exhibition' && requestId) {
          const isWaitlist = Boolean(data.details && 'is_waitlist' in data.details ? data.details.is_waitlist : false);
          const regId = (data.details && 'region_id' in data.details ? (data.details as any).region_id : null) || user.region_id || null;
          const regName = (data.details && 'region_name' in data.details ? (data.details as any).region_name : null) || user.region?.name || null;
          await supabase
            .from('requests')
            .update({
              region_id: regId || null,
              region_name: regName || null,
              is_waitlist: isWaitlist,
            })
            .eq('id', requestId);
        }

        if (data.assigned_entry_user_id && requestId) {
          try {
            await supabase.rpc('assign_disbursement_entry_user', {
              p_request_id: requestId,
              p_entry_user_id: data.assigned_entry_user_id,
            });
          } catch (assignErr) {
            console.warn('Failed to assign entry officer during draft creation:', assignErr);
          }
        }

        await uploadFiles(requestId, data.files || []);
        try {
          await loadRequests();
        } catch (loadErr) {
          console.warn('loadRequests failed after draft creation:', loadErr);
        }
        return { success: true, id: requestId };
      } catch (err: unknown) {
        if (requestId) {
          try {
            await loadRequests();
          } catch {
            /* ignore */
          }
        }
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

    const isWaitlist = Boolean(data.details && 'is_waitlist' in data.details ? data.details.is_waitlist : false);
    const regId = user.region_id || (data.details && 'region_id' in data.details ? (data.details as any).region_id : null);
    const regName = user.region?.name || (regId ? MOCK_REGIONS.find((r) => r.id === regId)?.name : null);

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
      region_id: regId,
      region_name: regName,
      is_waitlist: isWaitlist,
      waitlist_approved_by: null,
      waitlist_approved_at: null,
      title: data.title,
      notes: data.notes || null,
      amount: data.amount,
      request_type: type,
      details: data.details ?? null,
      shop_name: (data.details as { shop_name?: string | null } | null)?.shop_name ?? user.shop?.name ?? null,
      status: 'draft',
      route: null,
      routed_by: null,
      routed_at: null,
      assigned_entry_user_id: data.assigned_entry_user_id || null,
      assigned_entry_user_name: data.assigned_entry_user_id
        ? MOCK_USERS.find((u) => u.id === data.assigned_entry_user_id)?.full_name || 'Assigned Entry Officer'
        : null,
      assigned_entry_at: data.assigned_entry_user_id ? new Date().toISOString() : null,
      assigned_entry_by: data.assigned_entry_user_id ? user.id : null,
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
    data: {
      title: string;
      amount: number;
      notes?: string;
      details?: RequestDetails | null;
      category_id?: string | null;
      target_head_id?: string | null;
    }
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
      if (data.target_head_id) {
        const { error: headErr } = await supabase.rpc('set_request_target_head', {
          p_request_id: id,
          p_head_id: data.target_head_id,
        });
        if (headErr) {
          await loadRequests();
          return { success: false, error: headErr.message };
        }
      }
      if (data.category_id !== undefined) {
        const { error: catErr } = await supabase.rpc('set_request_category', {
          p_request_id: id,
          p_category_id: data.category_id || null,
        });
        if (catErr) {
          await loadRequests();
          return { success: false, error: catErr.message };
        }
      }
      if (data.details && ('is_waitlist' in data.details || 'region_id' in data.details || 'region_name' in data.details)) {
        const updatePayload: Record<string, any> = {};
        if ('is_waitlist' in data.details) updatePayload.is_waitlist = Boolean(data.details.is_waitlist);
        if ('region_id' in data.details && (data.details as any).region_id) {
          updatePayload.region_id = (data.details as any).region_id;
        }
        if ('region_name' in data.details && (data.details as any).region_name) {
          updatePayload.region_name = (data.details as any).region_name;
        }
        if (Object.keys(updatePayload).length > 0) {
          await supabase.from('requests').update(updatePayload).eq('id', id);
        }
      }
      await loadRequests();
      return { success: true };
    }
    updateLocalRequests((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const isWaitlist = data.details && 'is_waitlist' in data.details ? Boolean(data.details.is_waitlist) : r.is_waitlist;
        const regId = data.details && 'region_id' in data.details ? (data.details as any).region_id : r.region_id;
        const regName = data.details && 'region_name' in data.details ? (data.details as any).region_name : r.region_name;
        return {
          ...r,
          title: data.title,
          amount: data.amount,
          notes: data.notes || null,
          details: data.details !== undefined ? data.details : r.details,
          region_id: regId,
          region_name: regName,
          is_waitlist: isWaitlist,
          updated_at: new Date().toISOString(),
        };
      })
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
      if (error) return { success: false, error: errMsg(error) };
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
      if (error) return { success: false, error: errMsg(error) };
      await loadRequests();
      return { success: true };
    }
    updateLocalRequests((prev) => prev.filter((r) => r.id !== id));
    return { success: true };
  };

  const submitRequest = async (
    id: string,
    entryUserId?: string | null
  ): Promise<{ success: boolean; request_no?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        if (entryUserId) {
          try {
            await supabase.rpc('assign_disbursement_entry_user', {
              p_request_id: id,
              p_entry_user_id: entryUserId,
            });
          } catch (assignErr) {
            console.warn('Pre-assign entry user error:', assignErr);
          }
        }

        let submitError = null;
        try {
          const { error } = await supabase.rpc('submit_request', {
            p_request_id: id,
            p_entry_user_id: entryUserId || null,
          });
          submitError = error;
        } catch {
          const { error } = await supabase.rpc('submit_request', {
            p_request_id: id,
          });
          submitError = error;
        }

        if (submitError) throw submitError;
        const { data: row } = await supabase.from('requests').select('request_no').eq('id', id).maybeSingle();
        try {
          await loadRequests();
        } catch (loadErr) {
          console.warn('loadRequests failed after submit:', loadErr);
        }
        return { success: true, request_no: row?.request_no ?? undefined };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock submit
    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const isHead = user.role === 'head';
    const isClerk = user.role === 'clerk';
    const isPaymentNeeded = current.request_type !== 'discount' && current.request_type !== 'non_cash' && current.request_type !== 'stock_transfer';
    const needsEntryAccount = isHead || isClerk;
    if (needsEntryAccount && isPaymentNeeded && !current.assigned_entry_user_id && !entryUserId) {
      return { success: false, error: 'Please select a Disbursement Entry Account before submitting.' };
    }

    const toStatus = isHead
      ? 'pending_admin_approval'
      : isClerk
      ? ((current.amount || 0) > threshold || current.request_type === 'exhibition' ? 'pending_head_review' : 'pending_head_approval')
      : 'submitted';
    const clkRoute = isClerk
      ? ((current.amount || 0) > threshold || current.request_type === 'exhibition' ? 'A' : 'B')
      : undefined;
    const genNo = current.request_no || `REQ-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'submitted',
      from_status: current.status,
      to_status: toStatus,
      remarks: isHead
        ? 'Department Head request routed directly to Admin for approval.'
        : isClerk
        ? 'Clerk request routed directly to Department Head for review and approval.'
        : 'Request formally submitted for department processing.',
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    const targetUser = entryUserId ? MOCK_USERS.find((u) => u.id === entryUserId) : null;

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: toStatus,
              route: isHead ? 'A' : clkRoute || r.route,
              routed_by: isHead || isClerk ? user.id : r.routed_by,
              routed_at: isHead || isClerk ? new Date().toISOString() : r.routed_at,
              assigned_entry_user_id: entryUserId || r.assigned_entry_user_id,
              assigned_entry_user_name: targetUser ? targetUser.full_name : r.assigned_entry_user_name,
              assigned_entry_at: entryUserId ? new Date().toISOString() : r.assigned_entry_at,
              assigned_entry_by: entryUserId ? user.id : r.assigned_entry_by,
              reviewed_by: isHead ? user.id : r.reviewed_by,
              reviewed_by_name: isHead ? user.full_name : r.reviewed_by_name,
              reviewed_at: isHead ? new Date().toISOString() : r.reviewed_at,
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
        return { success: false, error: errMsg(err) };
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
    voice?: ActionVoice | null,
    assignedEntryUserId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    // High-value rule: Route B is not allowed above the configured threshold (Discount & Stock Transfer are always B)
    if (route === 'B' && current.request_type !== 'discount' && current.request_type !== 'stock_transfer' && current.amount > threshold) {
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
          p_assigned_entry_user_id: assignedEntryUserId || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
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
              assigned_entry_user_id: assignedEntryUserId || r.assigned_entry_user_id,
              assigned_entry_user_name: assignedEntryUserId ? 'Assigned Entry Officer' : r.assigned_entry_user_name,
              assigned_entry_at: assignedEntryUserId ? new Date().toISOString() : r.assigned_entry_at,
              assigned_entry_by: assignedEntryUserId ? user.id : r.assigned_entry_by,
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

  const assignDisbursementEntryUser = async (
    requestId: string,
    entryUserId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!['clerk', 'head', 'regional_head', 'admin'].includes(user.role)) {
      return { success: false, error: 'Only Clerk, Head, or Admin can assign an Entry account.' };
    }

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('assign_disbursement_entry_user', {
          p_request_id: requestId,
          p_entry_user_id: entryUserId,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock
    const req = getRequestById(requestId);
    if (!req) return { success: false, error: 'Request not found' };
    if ((req.disbursement_entries || []).length > 0) {
      return { success: false, error: 'Cannot change Entry account after disbursement entries have already been made.' };
    }

    const targetUser = MOCK_USERS.find((u) => u.id === entryUserId);
    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              assigned_entry_user_id: entryUserId,
              assigned_entry_user_name: targetUser?.full_name || 'Assigned Entry Officer',
              assigned_entry_at: new Date().toISOString(),
              assigned_entry_by: user.id,
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
        return { success: false, error: errMsg(err) };
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

  const regionalForwardRequest = async (id: string, remarks?: string, voice?: ActionVoice | null): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!isBackendConnected) return { success: false, error: 'Regional Head forwarding needs the live backend' };
    try {
      await uploadActionVoice(id, voice);
      const { error } = await supabase.rpc('regional_forward_request', {
        p_request_id: id,
        p_remarks: remarks?.trim() || null,
      });
      if (error) throw error;
      await loadRequests();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: errMsg(err) };
    }
  };

  const loadCategoryOptions = useCallback(
    async (targetHeadId?: string | null): Promise<CategoryOptions> => {
      if (!isBackendConnected || !user) return { required: false, categories: [] };
      const { data, error } = await supabase.rpc('request_category_options', {
        p_target_head_id: targetHeadId || null,
      });
      if (error || !data) return { required: false, categories: [] };
      const d = data as Partial<CategoryOptions>;
      return { required: !!d.required, categories: d.categories ?? [] };
    },
    [isBackendConnected, user]
  );

  const getUserTargetHeads = useCallback(
    async (userId?: string): Promise<UserTargetHead[]> => {
      if (!isBackendConnected || !user) return [];
      const { data, error } = await supabase.rpc('get_user_target_heads', {
        p_user_id: userId || null,
      });
      if (error || !data) return [];
      return data as UserTargetHead[];
    },
    [isBackendConnected, user]
  );

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
        return { success: false, error: errMsg(err) };
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
        return { success: false, error: errMsg(err) };
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
        return { success: false, error: errMsg(err) };
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

    const isDisbursement = user.role === 'disbursement';
    if (isDisbursement && user.disbursement_type === 'stock_transfer_monitor') {
      return { success: false, error: 'Permission denied: Stock Transfer Monitor accounts cannot record payments.' };
    }
    const isEntryOnly = isDisbursement && (user.disbursement_type === 'entry_only' || !user.disbursement_type);
    if (isEntryOnly) {
      return {
        success: false,
        error: 'Permission denied: Entry-Only disbursement accounts cannot record payments. Only Payment-Only or Admin accounts can disburse payments.',
      };
    }

    // Payments can only be released against a disbursement entry (for everyone, incl. Admin)
    if (!details.entry_id) {
      return {
        success: false,
        error: 'Payments can only be released against a disbursement entry. Ask the Entry-Only account to create an entry first.',
      };
    }

    let storagePath = details.document_storage_path || null;
    let docName = details.document_name || null;

    if (details.document && isBackendConnected) {
      try {
        const file = details.document;
        const contentType = (file.type || '').split(';')[0] || 'application/octet-stream';
        const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(-60);

        // Resolve the real request UUID for proper storage partitioning
        let targetRequestId = id?.trim() || '';
        if (!targetRequestId && details.entry_id) {
          const match = requests.find(
            (r) => r.id === id || (r.disbursement_entries || []).some((e) => e.id === details.entry_id)
          );
          if (match) targetRequestId = match.id;
        }
        if (!targetRequestId && details.entry_id) {
          try {
            const { data: entRow } = await supabase
              .from('disbursement_entries')
              .select('request_id')
              .eq('id', details.entry_id)
              .maybeSingle();
            if (entRow?.request_id) targetRequestId = entRow.request_id;
          } catch {
            /* ignore */
          }
        }

        const reqId = targetRequestId || id || 'payments';
        storagePath = `${reqId}/payment-${crypto.randomUUID()}-${safe}`;
        docName = file.name;

        const { error: upErr } = await supabase.storage
          .from('request-files')
          .upload(storagePath, file, { contentType, upsert: false });
        if (upErr) {
          const isRls =
            upErr.message?.toLowerCase().includes('row-level security') ||
            upErr.message?.toLowerCase().includes('policy') ||
            upErr.message?.toLowerCase().includes('violates');
          if (isRls) {
            throw new Error(
              `Payment document upload blocked by Supabase storage security policy. Please execute migration 0061 in your Supabase SQL Editor to enable payment document attachments.`
            );
          }
          throw new Error(`Failed to upload payment document: ${upErr.message}`);
        }
      } catch (uploadErr: unknown) {
        return { success: false, error: errMsg(uploadErr) };
      }
    } else if (details.document && !isBackendConnected) {
      docName = details.document.name;
      storagePath = `mock/payment-${details.document.name}`;
    }

    if (isBackendConnected) {
      try {
        let rpcRes = await supabase.rpc('pay_disbursement_entry', {
          p_entry_id: details.entry_id,
          p_amount: details.amount ?? null,
          p_payment_date: details.payment_date || null,
          p_payment_mode: details.payment_mode || null,
          p_payment_ref: details.payment_ref || null,
          p_remarks: details.payment_remarks || null,
          p_passkey: details.passkey || null,
          p_document_storage_path: storagePath,
          p_document_name: docName,
        });

        // Fallback: If migration 0061 has not been applied yet AND no document was attached,
        // fall back to the 7-parameter version so normal payments continue without disruption.
        if (rpcRes.error && rpcRes.error.code === 'PGRST202' && !storagePath) {
          rpcRes = await supabase.rpc('pay_disbursement_entry', {
            p_entry_id: details.entry_id,
            p_amount: details.amount ?? null,
            p_payment_date: details.payment_date || null,
            p_payment_mode: details.payment_mode || null,
            p_payment_ref: details.payment_ref || null,
            p_remarks: details.payment_remarks || null,
            p_passkey: details.passkey || null,
          } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        }

        const { data, error } = rpcRes;
        if (error) {
          if (storagePath && isBackendConnected) {
            try {
              await supabase.storage.from('request-files').remove([storagePath]);
            } catch {
              /* ignore */
            }
          }
          if (error.code === 'PGRST202' && storagePath) {
            throw new Error(
              'Database update required: Please run migration 0061 in your Supabase SQL Editor to enable payment document saving.'
            );
          }
          throw error;
        }
        await loadRequests();
        return { success: true, fully_paid: !!(data as { fully_paid?: boolean } | null)?.fully_paid };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Offline sandbox mirrors the pay_disbursement_entry rules
    const current = id ? getRequestById(id) : requests.find((r) => (r.disbursement_entries || []).some((e) => e.id === details.entry_id));
    if (!current) return { success: false, error: 'Request not found' };
    if (current.status === 'paid') return { success: false, error: 'This request is already fully paid.' };
    if (!/^\d{4}$/.test(details.passkey || '')) return { success: false, error: 'Enter your 4-digit passkey' };

    const entry = details.entry_id ? (current.disbursement_entries || []).find((e) => e.id === details.entry_id) : null;
    if (!entry || (entry.status !== 'approved' && entry.status !== 'pending')) {
      return { success: false, error: 'This entry is not approved for payment (or has already been paid or cancelled).' };
    }
    // Exact approved amount only - the cashier cannot pick a lower or different figure
    const exact = entryPayable(entry);
    if (exact <= 0) return { success: false, error: 'Nothing left to pay on this entry.' };
    if (details.amount !== undefined && Math.round(details.amount * 100) / 100 !== exact) {
      return { success: false, error: `You can only pay the exact approved amount of ₹${exact.toFixed(2)} for Entry #${entry.entry_no}.` };
    }
    const amt = exact;
    const tdsNow = Number(entry.tds_amount || 0) > 0 && !entry.tds_settled ? Number(entry.tds_amount) : 0;

    const already = Number(current.paid_amount ?? 0);
    const paid = already + amt + tdsNow;
    const full = paid >= current.amount;
    const now = new Date().toISOString();
    const date = details.payment_date || now.slice(0, 10);
    const entryPaid = Math.round((Number(entry.paid_amount || 0) + amt) * 100) / 100;
    const entryLeft = Math.round((entry.amount - entryPaid) * 100) / 100;

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: current.id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: full ? 'paid' : 'partial_payment',
      from_status: current.status,
      to_status: full ? 'paid' : current.status,
      remarks: `Entry #${entry.entry_no} settled ₹${amt.toFixed(2)} via ${details.payment_mode || 'Payment'}${tdsNow > 0 ? ` · TDS ₹${tdsNow.toFixed(2)} deducted from balance` : ''}${entryLeft > 0 ? ` · Entry balance ₹${entryLeft.toFixed(2)} sent back for verification` : ''}`,
      visible_to_requester: true,
      created_at: now,
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === current.id
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
              disbursement_entries: (r.disbursement_entries || []).map((e) =>
                e.id === details.entry_id
                  ? {
                      ...e,
                      paid_amount: entryPaid,
                      approved_amount: null,
                      tds_settled: e.tds_settled || tdsNow > 0,
                      status: entryLeft <= 0 ? 'paid' : 'pending_approval',
                      paid_at: now,
                      paid_by: user.id,
                      paid_by_name: user.full_name,
                    }
                  : e
              ),
              payments: [
                ...(r.payments || []),
                ...(tdsNow > 0
                  ? [{
                      id: `pay-tds-${Date.now()}`, request_id: current.id, amount: tdsNow, payment_date: date,
                      payment_mode: 'TDS', payment_ref: null, remarks: `TDS deducted · Entry #${entry.entry_no}`,
                      paid_by: user.id, paid_by_name: user.full_name, created_at: now,
                      entry_id: details.entry_id || null, is_adjustment: true,
                    }]
                  : []),
                {
                  id: `pay-${Date.now()}`, request_id: current.id, amount: amt, payment_date: date,
                  payment_mode: details.payment_mode || null, payment_ref: details.payment_ref || null,
                  remarks: details.payment_remarks || null, paid_by: user.id, paid_by_name: user.full_name, created_at: now,
                  entry_id: details.entry_id || null,
                  document_storage_path: storagePath,
                  document_name: docName,
                },
              ],
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true, fully_paid: full };
  };

  const addDisbursementEntry = async (
    requestId: string,
    amount: number,
    tdsCut: boolean,
    notes?: string,
    adjustment = 0,
    entryType: 'cash' | 'bank' = 'bank',
    extra?: EntryExtra
  ): Promise<{ success: boolean; error?: string; entry_id?: string; entry_no?: number; fully_paid?: boolean }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const amt = Math.round(Math.max(0, amount || 0) * 100) / 100;
    const adj = Math.round(Math.max(0, adjustment || 0) * 100) / 100;
    const tds = tdsCut ? Math.round(Math.max(0, extra?.tdsAmount || 0) * 100) / 100 : 0;
    if (amt + adj <= 0) return { success: false, error: 'Enter an entry amount or an old balance / advance adjustment.' };
    if (tdsCut && tds <= 0) return { success: false, error: 'TDS is ticked - enter the TDS amount.' };

    if (isBackendConnected) {
      try {
        const { data, error } = await supabase.rpc('add_disbursement_entry', {
          p_request_id: requestId,
          p_amount: amt,
          p_tds_cut: tdsCut,
          p_notes: notes?.trim() || null,
          p_adjustment: adj,
          p_entry_type: entryType,
          p_session_id: getClientSessionId(),
          p_tds_amount: tds,
          p_passkey: extra?.passkey || null,
        });
        if (error) {
          if (error.message.includes('schema cache')) {
            throw new Error('Database migration required: run 0060_passkeys_tds_amount_partial_approval.sql in the Supabase SQL Editor.');
          }
          throw error;
        }
        await loadRequests();
        const res = data as { entry_id?: string; entry_no?: number; fully_paid?: boolean } | null;
        return { success: true, entry_id: res?.entry_id, entry_no: res?.entry_no, fully_paid: !!res?.fully_paid };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock (mirrors add_disbursement_entry: adjustment is separate and settled immediately)
    if (!/^\d{4}$/.test(extra?.passkey || '')) return { success: false, error: 'Enter your 4-digit passkey' };
    const req = getRequestById(requestId);
    if (!req) return { success: false, error: 'Request not found' };
    if (amt + adj + tds > entryAvailable(req)) {
      return { success: false, error: `Entry + TDS + adjustment is more than the balance available for entries (₹${entryAvailable(req).toFixed(2)}).` };
    }
    const existing = req.disbursement_entries || [];
    const nextNo = existing.length > 0 ? Math.max(...existing.map((e) => e.entry_no)) + 1 : 1;
    const now = new Date().toISOString();
    const fullyAdjusted = amt === 0 && adj > 0;
    const entryId = `entry-${Date.now()}`;
    const paymentId = adj > 0 ? `pay-${Date.now()}` : null;
    const newEntry: DisbursementEntry = {
      id: entryId,
      request_id: requestId,
      entry_no: nextNo,
      amount: amt,
      entry_type: entryType,
      adjustment_amount: adj,
      adjustment_payment_id: paymentId,
      tds_cut: tdsCut,
      tds_amount: tds,
      tds_settled: false,
      paid_amount: 0,
      approved_amount: null,
      status: fullyAdjusted ? 'paid' : 'pending_approval',
      notes: notes?.trim() || null,
      created_by: user.id,
      created_by_name: user.full_name,
      created_at: now,
      paid_at: fullyAdjusted ? now : null,
      paid_by: fullyAdjusted ? user.id : null,
      paid_by_name: fullyAdjusted ? user.full_name : null,
      payment_id: fullyAdjusted ? paymentId : null,
    };
    const paid = Number(req.paid_amount ?? 0) + adj;
    const full = adj > 0 && paid >= req.amount;
    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              disbursement_entries: [...(r.disbursement_entries || []), newEntry],
              ...(adj > 0
                ? {
                    paid_amount: paid,
                    status: full ? ('paid' as const) : r.status,
                    paid_by: full ? user.id : r.paid_by,
                    paid_at: full ? now : r.paid_at,
                    payment_mode: full ? 'Adjustment' : r.payment_mode,
                    updated_at: now,
                    payments: [
                      ...(r.payments || []),
                      {
                        id: paymentId!, request_id: requestId, amount: adj, payment_date: now.slice(0, 10),
                        payment_mode: 'Adjustment', payment_ref: null,
                        remarks: `Old balance / old advance adjustment · Entry #${nextNo}`,
                        paid_by: user.id, paid_by_name: user.full_name, created_at: now,
                        entry_id: entryId, is_adjustment: true,
                      },
                    ],
                  }
                : {}),
            }
          : r
      )
    );
    return { success: true, entry_id: newEntry.id, entry_no: nextNo, fully_paid: full };
  };

  const cancelDisbursementEntry = async (
    entryId: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('cancel_disbursement_entry', {
          p_entry_id: entryId,
          p_reason: reason?.trim() || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock (reverses any old balance / advance adjustment recorded with the entry)
    updateLocalRequests((prev) =>
      prev.map((r) => {
        const ent = (r.disbursement_entries || []).find((e) => e.id === entryId);
        if (!ent) return r;
        const adj = Number(ent.adjustment_amount || 0);
        return {
          ...r,
          disbursement_entries: (r.disbursement_entries || []).filter((e) => e.id !== entryId),
          ...(adj > 0
            ? {
                paid_amount: Math.max(0, Number(r.paid_amount ?? 0) - adj),
                payments: (r.payments || []).filter((p) => !(p.entry_id === entryId && p.is_adjustment)),
              }
            : {}),
        };
      })
    );
    return { success: true };
  };

  const approveDisbursementEntry = async (
    entryId: string,
    remarks?: string,
    approvedAmount?: number
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const partialAmt =
      approvedAmount === undefined || approvedAmount === null ? null : Math.round(approvedAmount * 100) / 100;
    if (partialAmt !== null && !(partialAmt > 0)) {
      return { success: false, error: 'Enter the partial amount to approve (more than zero).' };
    }
    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('approve_disbursement_entry', {
          p_entry_id: entryId,
          p_remarks: remarks?.trim() || null,
          p_approved_amount: partialAmt,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock
    const target = requests.flatMap((r) => r.disbursement_entries || []).find((e) => e.id === entryId);
    if (!target) return { success: false, error: 'Entry not found' };
    const outstanding = entryOutstanding(target);
    if (partialAmt !== null && partialAmt > outstanding) {
      return { success: false, error: `Approved amount cannot be more than the entry balance (₹${outstanding.toFixed(2)}).` };
    }
    const now = new Date().toISOString();
    updateLocalRequests((prev) =>
      prev.map((r) => ({
        ...r,
        disbursement_entries: (r.disbursement_entries || []).map((e) =>
          e.id === entryId
            ? {
                ...e,
                status: 'approved',
                approved_amount: partialAmt ?? outstanding,
                approved_by: user.id,
                approved_by_name: user.full_name,
                approved_at: now,
                rejection_reason: null,
              }
            : e
        ),
      }))
    );
    return { success: true };
  };

  const approveMultipleDisbursementEntries = async (
    entryIds: string[]
  ): Promise<{ success: boolean; approved_count?: number; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!entryIds.length) return { success: false, error: 'No entries selected' };

    if (isBackendConnected) {
      try {
        const { data, error } = await supabase.rpc('approve_multiple_disbursement_entries', {
          p_entry_ids: entryIds,
        });
        if (error) throw error;
        await loadRequests();
        const res = data as { approved_count?: number } | null;
        return { success: true, approved_count: res?.approved_count ?? entryIds.length };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock (bulk approval is always a FULL approval of the entry balance)
    const now = new Date().toISOString();
    const idSet = new Set(entryIds);
    updateLocalRequests((prev) =>
      prev.map((r) => ({
        ...r,
        disbursement_entries: (r.disbursement_entries || []).map((e) =>
          idSet.has(e.id)
            ? {
                ...e,
                status: 'approved',
                approved_amount: entryOutstanding(e),
                approved_by: user.id,
                approved_by_name: user.full_name,
                approved_at: now,
                rejection_reason: null,
              }
            : e
        ),
      }))
    );
    return { success: true, approved_count: entryIds.length };
  };

  const rejectDisbursementEntry = async (
    entryId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const rsn = reason.trim();
    if (!rsn) return { success: false, error: 'Please enter a rejection reason' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('reject_disbursement_entry', {
          p_entry_id: entryId,
          p_reason: rsn,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock
    const now = new Date().toISOString();
    updateLocalRequests((prev) =>
      prev.map((r) => ({
        ...r,
        disbursement_entries: (r.disbursement_entries || []).map((e) =>
          e.id === entryId
            ? {
                ...e,
                status: 'rejected',
                rejected_by: user.id,
                rejected_by_name: user.full_name,
                rejected_at: now,
                rejection_reason: rsn,
              }
            : e
        ),
      }))
    );
    return { success: true };
  };

  const editRejectedDisbursementEntry = async (
    entryId: string,
    amount: number,
    entryType: 'cash' | 'bank',
    tdsCut: boolean,
    notes?: string,
    adjustment = 0,
    extra?: EntryExtra
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    const amt = Math.round(Math.max(0, amount || 0) * 100) / 100;
    const adj = Math.round(Math.max(0, adjustment || 0) * 100) / 100;
    const tds = tdsCut ? Math.round(Math.max(0, extra?.tdsAmount || 0) * 100) / 100 : 0;
    if (amt + adj <= 0) return { success: false, error: 'Enter an amount or adjustment' };
    if (tdsCut && tds <= 0) return { success: false, error: 'TDS is ticked - enter the TDS amount.' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('edit_rejected_disbursement_entry', {
          p_entry_id: entryId,
          p_amount: amt,
          p_entry_type: entryType,
          p_tds_cut: tdsCut,
          p_notes: notes?.trim() || null,
          p_adjustment: adj,
          p_tds_amount: tds,
          p_passkey: extra?.passkey || null,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock
    if (!/^\d{4}$/.test(extra?.passkey || '')) return { success: false, error: 'Enter your 4-digit passkey' };
    updateLocalRequests((prev) =>
      prev.map((r) => ({
        ...r,
        disbursement_entries: (r.disbursement_entries || []).map((e) =>
          e.id === entryId
            ? {
                ...e,
                amount: amt,
                entry_type: entryType,
                tds_cut: tdsCut,
                tds_amount: tds,
                notes: notes?.trim() || null,
                adjustment_amount: adj,
                status: 'pending_approval',
                approved_amount: null,
                rejection_reason: null,
                rejected_by: null,
                rejected_by_name: null,
                rejected_at: null,
              }
            : e
        ),
      }))
    );
    return { success: true };
  };

  const payDisbursementEntry = async (
    entryId: string,
    details: PaymentInput
  ): Promise<{ success: boolean; error?: string; fully_paid?: boolean }> => {
    return markAsPaid('', { ...details, entry_id: entryId });
  };

  const markTransferComplete = async (requestId: string, remarks?: string): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('mark_stock_transfer_complete', {
          p_request_id: requestId,
          p_remarks: remarks?.trim() || null,
        });
        if (error) throw error;
        await loadRequests(true);
        return { success: true };
      } catch (err: unknown) {
        return { success: false, error: errMsg(err) };
      }
    }

    // Mock
    const req = getRequestById(requestId);
    if (!req || req.request_type !== 'stock_transfer') return { success: false, error: 'Stock transfer not found' };
    if (req.status !== 'approved') return { success: false, error: 'Only approved stock transfers can be marked complete' };
    if (req.transfer_completed_at) return { success: false, error: 'This transfer is already marked complete' };
    const now = new Date().toISOString();
    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: requestId,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'transfer_completed',
      from_status: 'approved',
      to_status: 'approved',
      remarks: remarks?.trim() || 'Stock transfer marked as completed',
      visible_to_requester: true,
      created_at: now,
    };
    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              transfer_completed_at: now,
              transfer_completed_by: user.id,
              transfer_completed_by_name: user.full_name,
              transfer_completed_remarks: remarks?.trim() || null,
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );
    return { success: true };
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
      if (error) return { success: false, error: errMsg(error) };
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
            error: errMsg(uploadErr),
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
      if (error) return { success: false, error: errMsg(error) };
      await loadRequests(true);
      return { success: true };
    }
    return { success: true };
  };

  const cancelHeadConsultation = async (
    consultationId: string,
    requestId?: string
  ): Promise<Result> => {
    if (isBackendConnected) {
      const { error } = await supabase.rpc('cancel_head_consultation', {
        p_consultation_id: consultationId,
      });
      if (error) return { success: false, error: errMsg(error) };
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    if (requestId) {
      updateLocalRequests((prev) =>
        prev.map((r) => {
          if (r.id !== requestId) return r;
          const targetConsult = (r.consultations || []).find((c) => c.id === consultationId);
          return {
            ...r,
            consultations: (r.consultations || []).filter((c) => c.id !== consultationId),
            actions: [
              {
                id: `act-${Date.now()}`,
                request_id: r.id,
                actor_id: user?.id || 'user',
                actor_name: user?.full_name || 'Department Head',
                actor_role: user?.role || 'head',
                action: 'consultation_cancelled',
                from_status: r.status,
                to_status: r.status,
                remarks: `Cancelled Inter-Department consultation with ${targetConsult?.head_name || 'head'}`,
                visible_to_requester: true,
                created_at: new Date().toISOString(),
              },
              ...(r.actions || []),
            ],
          };
        })
      );
    }
    return { success: true };
  };

  const updateHeadConsultationNote = async (
    consultationId: string,
    note: string,
    requestId?: string
  ): Promise<Result> => {
    if (isBackendConnected) {
      const { error } = await supabase.rpc('update_head_consultation_note', {
        p_consultation_id: consultationId,
        p_note: note,
        p_request_id: requestId || null,
      });
      if (error) return { success: false, error: errMsg(error) };
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    if (requestId) {
      updateLocalRequests((prev) =>
        prev.map((r) => {
          if (r.id !== requestId) return r;
          return {
            ...r,
            consultations: (r.consultations || []).map((c) =>
              c.status === 'pending' ? { ...c, request_note: note } : c
            ),
            actions: [
              {
                id: `act-${Date.now()}`,
                request_id: r.id,
                actor_id: user?.id || 'user',
                actor_name: user?.full_name || 'Department Head',
                actor_role: user?.role || 'head',
                action: 'consultation_note_updated',
                from_status: r.status,
                to_status: r.status,
                remarks: `Updated Inter-Department consultation note: "${note}"`,
                visible_to_requester: true,
                created_at: new Date().toISOString(),
              },
              ...(r.actions || []),
            ],
          };
        })
      );
    }
    return { success: true };
  };

  const addExtraDocuments = async (
    requestId: string,
    files: File[]
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!files.length) return { success: false, error: 'No files provided' };

    if (isBackendConnected) {
      for (const file of files) {
        const contentType = file.type || 'application/pdf';
        const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(-60);
        const path = `${requestId}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from('request-files')
          .upload(path, file, { contentType, upsert: false });
        if (upErr) return { success: false, error: `Upload failed for ${file.name}: ${upErr.message}` };

        const { error: regErr } = await supabase.rpc('register_file', {
          p_request_id: requestId,
          p_kind: 'document',
          p_storage_path: path,
          p_original_name: file.name,
          p_mime_type: contentType,
          p_size_bytes: file.size,
          p_page_count: null,
          p_duration_sec: null,
        });
        if (regErr) {
          await supabase.storage.from('request-files').remove([path]);
          return { success: false, error: `Could not register ${file.name}: ${regErr.message}` };
        }
      }
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    const newFiles: RequestFile[] = files.map((f, i) => ({
      id: `file-extra-${Date.now()}-${i}`,
      request_id: requestId,
      kind: 'document',
      storage_path: `mock/${requestId}/${f.name}`,
      original_name: f.name,
      mime_type: f.type || 'application/pdf',
      size_bytes: f.size,
      page_count: 1,
      duration_sec: null,
      sha256: null,
      created_at: new Date().toISOString(),
      public_url: URL.createObjectURL(f),
      added_by: user.id,
      added_by_name: user.full_name,
      added_by_role: user.role,
    }));

    updateLocalRequests((prev) =>
      prev.map((r) => {
        if (r.id !== requestId) return r;
        return {
          ...r,
          files: [...(r.files || []), ...newFiles],
          actions: [
            {
              id: `act-${Date.now()}`,
              request_id: r.id,
              actor_id: user.id,
              actor_name: user.full_name,
              actor_role: user.role,
              action: 'file_attached',
              from_status: r.status,
              to_status: r.status,
              remarks: `Attached extra document(s): ${files.map((x) => x.name).join(', ')}`,
              visible_to_requester: true,
              created_at: new Date().toISOString(),
            },
            ...(r.actions || []),
          ],
        };
      })
    );
    return { success: true };
  };

  const removeExtraDocument = async (
    requestId: string,
    fileId: string
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      const { data: storagePath, error } = await supabase.rpc('remove_file', {
        p_file_id: fileId,
      });
      if (error) return { success: false, error: errMsg(error) };
      if (storagePath) {
        await supabase.storage.from('request-files').remove([storagePath]);
      }
      await loadRequests(true);
      return { success: true };
    }

    // Mock mode
    updateLocalRequests((prev) =>
      prev.map((r) => {
        if (r.id !== requestId) return r;
        const targetFile = (r.files || []).find((f) => f.id === fileId);
        return {
          ...r,
          files: (r.files || []).filter((f) => f.id !== fileId),
          actions: [
            {
              id: `act-${Date.now()}`,
              request_id: r.id,
              actor_id: user.id,
              actor_name: user.full_name,
              actor_role: user.role,
              action: 'file_removed',
              from_status: r.status,
              to_status: r.status,
              remarks: `Removed document: ${targetFile?.original_name || 'document'}`,
              visible_to_requester: true,
              created_at: new Date().toISOString(),
            },
            ...(r.actions || []),
          ],
        };
      })
    );
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
            error: errMsg(uploadErr),
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
        return { success: false, error: errMsg(error) };
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
            error: errMsg(uploadErr),
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
        return { success: false, error: errMsg(error) };
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

  const setQuote = async (fileId: string, vendor: string, amount: number, preferred: boolean): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!isBackendConnected) return { success: false, error: 'Quotations need the live backend' };
    const { error } = await supabase.rpc('set_quote', {
      p_file_id: fileId, p_vendor: vendor, p_amount: amount, p_preferred: preferred,
    });
    if (error) return { success: false, error: errMsg(error) };
    return { success: true };
  };

  const selectQuote = async (requestId: string, fileId: string, remarks?: string): Promise<Result & { status?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!isBackendConnected) return { success: false, error: 'Quotations need the live backend' };
    const { data, error } = await supabase.rpc('select_quote', {
      p_request_id: requestId, p_file_id: fileId, p_remarks: remarks?.trim() || null,
    });
    await loadRequests(true);
    if (error) return { success: false, error: errMsg(error) };
    return { success: true, status: (data as { status?: string } | null)?.status };
  };

  const decideExhibitionWaitlist = async (
    id: string,
    action: 'approve' | 'reject',
    remarks?: string
  ): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!['admin', 'head'].includes(user.role)) {
      return { success: false, error: 'Only Head or Admin can decide exhibition waitlists' };
    }

    if (isBackendConnected) {
      const { error } = await supabase.rpc('decide_exhibition_waitlist', {
        p_request_id: id,
        p_action: action,
        p_remarks: remarks || null,
      });
      if (error) return { success: false, error: errMsg(error) };
      await loadRequests(true);
      return { success: true };
    }

    // Mock implementation
    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    const now = new Date().toISOString();
    const actionRecord: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: action === 'approve' ? 'forwarded' : 'rejected',
      from_status: current.status,
      to_status: action === 'approve' ? current.status : 'rejected',
      remarks: remarks || (action === 'approve' ? 'Special Waiting List Exhibition approved by Head' : 'Special Waiting List Exhibition rejected'),
      visible_to_requester: true,
      created_at: now,
    };

    updateLocalRequests((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (action === 'approve') {
          return {
            ...r,
            waitlist_approved_by: user.id,
            waitlist_approved_at: now,
            updated_at: now,
            actions: [actionRecord, ...(r.actions || [])],
          };
        } else {
          return {
            ...r,
            status: 'rejected',
            decided_by: user.id,
            decided_at: now,
            approver_role: user.role,
            updated_at: now,
            actions: [actionRecord, ...(r.actions || [])],
          };
        }
      })
    );

    return { success: true };
  };

  const deleteAllRequests = async (): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (user.role !== 'admin') return { success: false, error: 'Only administrators can delete all requests' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('delete_all_requests');
        if (error) {
          // If RPC not found in schema cache, fallback to direct delete
          if (error.code === 'PGRST202' || error.message?.includes('delete_all_requests')) {
            const { error: delErr } = await supabase.from('requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (delErr) throw delErr;
          } else {
            throw error;
          }
        }
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        console.error('Failed to delete all requests:', err);
        return { success: false, error: errMsg(err) };
      }
    }

    localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify([]));
    setRequests([]);
    return { success: true };
  };

  const deleteSpecificRequest = async (id: string): Promise<Result> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('delete_request_permanently', { p_request_id: id });
        if (error) {
          // If RPC not found in schema cache, fallback to direct delete
          if (error.code === 'PGRST202' || error.message?.includes('delete_request_permanently')) {
            const { error: delErr } = await supabase.from('requests').delete().eq('id', id);
            if (delErr) throw delErr;
          } else {
            throw error;
          }
        }
        await loadRequests();
        return { success: true };
      } catch (err: unknown) {
        console.error('Failed to delete request:', err);
        return { success: false, error: errMsg(err) };
      }
    }
    updateLocalRequests((prev) => prev.filter((r) => r.id !== id));
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
        regionalForwardRequest,
        loadCategoryOptions,
        getUserTargetHeads,
        returnRequest,
        rejectRequest,
        approveRequest,
        markAsPaid,
        addDisbursementEntry,
        cancelDisbursementEntry,
        approveDisbursementEntry,
        approveMultipleDisbursementEntries,
        rejectDisbursementEntry,
        editRejectedDisbursementEntry,
        payDisbursementEntry,
        assignDisbursementEntryUser,
        markTransferComplete,
        requestHeadConsultations,
        respondHeadConsultation,
        cancelHeadConsultation,
        updateHeadConsultationNote,
        addExtraDocuments,
        removeExtraDocument,
        loadConsultableHeads,
        requestDisbursementClarification,
        respondDisbursementClarification,
        cancelApprovedRequest,
        signClarificationFiles,
        setQuote,
        selectQuote,
        decideExhibitionWaitlist,
        deleteAllRequests,
        deleteSpecificRequest,
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
