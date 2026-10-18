import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  RequestRecord,
  RequestFile,
  RequestStatus,
  ApprovalRoute,
  RequestAction,
} from '../types/database';
import { supabase, invokeEdgeFunction } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { MOCK_REQUESTS, MOCK_SETTINGS } from '../lib/mockData';

interface RequestContextType {
  requests: RequestRecord[];
  isLoading: boolean;
  refreshRequests: () => Promise<void>;
  getRequestById: (id: string) => RequestRecord | undefined;
  createDraft: (data: { title: string; amount: number; notes?: string; files?: RequestFile[] }) => Promise<{ success: boolean; id?: string; error?: string }>;
  submitRequest: (id: string) => Promise<{ success: boolean; request_no?: string; error?: string }>;
  withdrawRequest: (id: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  routeRequest: (id: string, route: ApprovalRoute, remarks?: string) => Promise<{ success: boolean; error?: string }>;
  forwardRequest: (id: string, remarks?: string) => Promise<{ success: boolean; error?: string }>;
  returnRequest: (id: string, remarks: string) => Promise<{ success: boolean; error?: string }>;
  rejectRequest: (id: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  approveRequest: (id: string) => Promise<{ success: boolean; approval_no?: string; error?: string }>;
  markAsPaid: (id: string, details: { payment_mode?: string; payment_ref?: string; payment_remarks?: string }) => Promise<{ success: boolean; error?: string }>;
}

const RequestContext = createContext<RequestContextType | undefined>(undefined);

const LOCAL_STORAGE_REQ_KEY = 'approval_app_requests_store';

export const RequestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isBackendConnected } = useAuth();
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    if (isBackendConnected) {
      try {
        const { data, error } = await supabase
          .from('requests')
          .select('*, department:departments(*), files:request_files(*), signed_files(*), actions:request_actions(*)')
          .order('created_at', { ascending: false });

        if (!error && data) {
          setRequests(data as RequestRecord[]);
          setIsLoading(false);
          return;
        }
      } catch {
        // fallback
      }
    }

    const saved = localStorage.getItem(LOCAL_STORAGE_REQ_KEY);
    if (saved) {
      try {
        setRequests(JSON.parse(saved));
        setIsLoading(false);
        return;
      } catch {
        // ignore
      }
    }

    setRequests(MOCK_REQUESTS);
    localStorage.setItem(LOCAL_STORAGE_REQ_KEY, JSON.stringify(MOCK_REQUESTS));
    setIsLoading(false);
  }, [isBackendConnected]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

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

  const createDraft = async (data: {
    title: string;
    amount: number;
    notes?: string;
    files?: RequestFile[];
  }): Promise<{ success: boolean; id?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { data: newId, error } = await supabase.rpc('create_draft', {
          p_department_id: user.department_id,
          p_title: data.title,
          p_amount: data.amount,
          p_notes: data.notes || null,
        });

        if (error) throw error;
        await loadRequests();
        return { success: true, id: newId };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Mock create draft
    const newId = `req-draft-${Date.now()}`;
    const newRecord: RequestRecord = {
      id: newId,
      request_no: null,
      requester_id: user.id,
      requester_name: user.full_name,
      requester_role: user.role,
      department_id: user.department_id || 'dept-fin-001',
      title: data.title,
      notes: data.notes || null,
      amount: data.amount,
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

  const submitRequest = async (id: string): Promise<{ success: boolean; request_no?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { data: reqNo, error } = await supabase.rpc('submit_request', {
          p_request_id: id,
        });
        if (error) throw error;
        await loadRequests();
        return { success: true, request_no: reqNo };
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
    remarks?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    const current = getRequestById(id);
    if (!current) return { success: false, error: 'Request not found' };

    // ₹10,000 threshold validation: Route B is not allowed above threshold
    if (route === 'B' && current.amount > MOCK_SETTINGS.high_value_threshold) {
      return {
        success: false,
        error: `Requests above ₹${MOCK_SETTINGS.high_value_threshold.toLocaleString('en-IN')} must take Route A (Admin approval required).`,
      };
    }

    if (route === 'B' && current.requester_role === 'head') {
      return { success: false, error: 'A Department Head cannot approve their own request.' };
    }

    if (isBackendConnected) {
      try {
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

  const forwardRequest = async (id: string, remarks?: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
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

  const returnRequest = async (id: string, remarks: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!remarks.trim()) return { success: false, error: 'A remark is required when returning a request.' };

    if (isBackendConnected) {
      try {
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

  const rejectRequest = async (id: string, reason: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };
    if (!reason.trim()) return { success: false, error: 'A reason is required when rejecting a request.' };

    if (isBackendConnected) {
      try {
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

  const approveRequest = async (id: string): Promise<{ success: boolean; approval_no?: string; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { data, error } = await invokeEdgeFunction<{ ok: boolean; approval_no: string }>('approve-request', {
          request_id: id,
        });
        if (error) throw error;
        await loadRequests();
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
    details: { payment_mode?: string; payment_ref?: string; payment_remarks?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Must be logged in' };

    if (isBackendConnected) {
      try {
        const { error } = await supabase.rpc('mark_paid', {
          p_request_id: id,
          p_mode: details.payment_mode || null,
          p_ref: details.payment_ref || null,
          p_remarks: details.payment_remarks || null,
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
    if (current.status === 'paid') return { success: false, error: 'This request has already been marked as paid.' };

    const action: RequestAction = {
      id: `act-${Date.now()}`,
      request_id: id,
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'paid',
      from_status: current.status,
      to_status: 'paid',
      remarks: `Paid via ${details.payment_mode || 'Direct Transfer'}. Ref: ${details.payment_ref || 'N/A'}. ${details.payment_remarks || ''}`,
      visible_to_requester: true,
      created_at: new Date().toISOString(),
    };

    updateLocalRequests((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'paid',
              paid_by: user.id,
              paid_at: new Date().toISOString(),
              payment_mode: details.payment_mode || 'NEFT',
              payment_ref: details.payment_ref || null,
              payment_remarks: details.payment_remarks || null,
              updated_at: new Date().toISOString(),
              actions: [action, ...(r.actions || [])],
            }
          : r
      )
    );

    return { success: true };
  };

  return (
    <RequestContext.Provider
      value={{
        requests,
        isLoading,
        refreshRequests: loadRequests,
        getRequestById,
        createDraft,
        submitRequest,
        withdrawRequest,
        routeRequest,
        forwardRequest,
        returnRequest,
        rejectRequest,
        approveRequest,
        markAsPaid,
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
