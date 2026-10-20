import { supabase } from './supabase';
import { AppRole, RequestRecord, RequestStatus } from '../types/database';

export interface VerifyResult {
  request_id: string;
  approval_no: string | null;
  request_no: string | null;
  title: string;
  amount: number;
  status: RequestStatus;
  approver_name: string | null;
  approver_role: AppRole | null;
  decided_at: string | null;
  paid_at: string | null;
  department: string | null;
  requester_name: string;
  owner_head_name?: string | null;
  can_open: boolean;
  request_type?: string | null;
  shop_name?: string | null;
  paid_amount: number;
  balance: number;
  payments: { amount: number; payment_date: string }[];
  files: { file_name: string; sha256: string; page_count: number; is_packet: boolean }[];
  cancelled_at?: string | null;
  cancelled_by_name?: string | null;
}

/** Pulls the token out of a scanned QR (full /verify/<token> URL) or returns the input as-is. */
export function extractToken(input: string): string {
  const s = input.trim();
  const m = s.match(/\/verify\/([^/?#\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

/**
 * Verifies an approval by QR token, verify URL, or approval / request number.
 * Live: the `verify_approval` RPC is the source of truth (only approved/paid match).
 */
export async function verifyApproval(
  input: string,
  live: boolean,
  visibleRequests: RequestRecord[]
): Promise<{ result: VerifyResult | null; error?: string }> {
  const code = extractToken(input);
  if (!code) return { result: null };
  const lc = code.toLowerCase();
  const byNumber = visibleRequests.find(
    (r) => r.approval_no?.toLowerCase() === lc || r.request_no?.toLowerCase() === lc
  );

  if (!live) {
    const r = byNumber || visibleRequests.find((x) => x.verify_token === code);
    if (!r || !['approved', 'paid', 'cancelled'].includes(r.status)) return { result: null };
    return {
      result: {
        request_id: r.id,
        approval_no: r.approval_no,
        request_no: r.request_no,
        title: r.title,
        amount: r.amount,
        status: r.status,
        approver_name: r.approver_name ?? null,
        approver_role: r.approver_role,
        decided_at: r.decided_at,
        paid_at: r.paid_at,
        department: r.department?.name ?? null,
        requester_name: r.requester_name,
        owner_head_name: r.owner_head_name ?? null,
        can_open: true,
        request_type: r.request_type ?? null,
        shop_name: r.shop_name ?? null,
        paid_amount: Number(r.paid_amount ?? (r.status === 'paid' ? r.amount : 0)),
        balance: Math.max(r.amount - Number(r.paid_amount ?? (r.status === 'paid' ? r.amount : 0)), 0),
        payments: (r.payments || []).map((p) => ({ amount: Number(p.amount), payment_date: p.payment_date })),
        cancelled_at: r.cancelled_at ?? null,
        cancelled_by_name: r.cancelled_by_name ?? null,
        files: (r.signed_files || []).map((s) => ({
          file_name: s.file_name || 'packet.pdf',
          sha256: s.sha256,
          page_count: s.page_count,
          is_packet: !!s.is_packet,
        })),
      },
    };
  }

  const token = byNumber?.verify_token || code;
  const { data, error } = await supabase.rpc('verify_approval', { p_token: token });
  if (error) return { result: null, error: error.message };
  if (!data) return { result: null };
  const d = data as VerifyResult;
  const amount = Number(d.amount);
  const paid = Number(d.paid_amount ?? (d.status === 'paid' ? amount : 0));
  return {
    result: {
      ...d,
      amount,
      paid_amount: paid,
      balance: d.balance != null ? Number(d.balance) : Math.max(amount - paid, 0),
      payments: (d.payments || []).map((p) => ({ amount: Number(p.amount), payment_date: p.payment_date })),
      files: d.files || [],
    },
  };
}
