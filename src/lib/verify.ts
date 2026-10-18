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
  can_open: boolean;
  files: { file_name: string; sha256: string; page_count: number; is_packet: boolean }[];
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
    if (!r || (r.status !== 'approved' && r.status !== 'paid')) return { result: null };
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
        can_open: true,
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
  return { result: { ...d, amount: Number(d.amount), files: d.files || [] } };
}
