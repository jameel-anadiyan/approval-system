// Discount report data. Live mode calls the discount_report RPC (Admin, or a Head
// that Admin granted access to); the offline sandbox derives rows from demo requests.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestContext';
import type { Profile, RequestStatus } from '../types/database';

export interface DiscountRow {
  id: string;
  request_no: string | null;
  title: string;
  status: RequestStatus;
  shop_id: string | null;
  shop_name: string;
  department_id: string | null;
  department_name: string | null;
  requester_id: string;
  requester_name: string;
  approver_name: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  before_amount: number;
  after_amount: number;
  discount_amount: number;
  discount_pct: number;
  customer_name: string | null;
  reference: string | null;
  invoice_no: string | null;
  bill_date: string | null;
}

/** UI check only — the RPC enforces the same rule in the database. */
export const canViewDiscountReport = (u: Profile | null | undefined) =>
  !!u && (u.role === 'admin' || (u.role === 'head' && !!u.can_view_discount_report));

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export function useDiscountReport(from: string, to: string) {
  const { isBackendConnected, user } = useAuth();
  const { requests } = useRequests();
  const [rows, setRows] = useState<DiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isBackendConnected && user) {
      const { data, error: e } = await supabase.rpc('discount_report', { p_from: from || null, p_to: to || null });
      if (e) {
        setError(e.message);
        setRows([]);
      } else {
        setRows(
          ((data as DiscountRow[]) ?? []).map((r) => ({
            ...r,
            before_amount: n(r.before_amount),
            after_amount: n(r.after_amount),
            discount_amount: n(r.discount_amount),
            discount_pct: n(r.discount_pct),
            invoice_no: r.invoice_no ?? null,
            bill_date: r.bill_date ?? null,
          }))
        );
      }
    } else {
      const inRange = (iso: string | null) => {
        if (!iso) return !from && !to;
        const d = iso.slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      };
      setRows(
        requests
          .filter((r) => r.request_type === 'discount' && r.status !== 'draft' && inRange(r.submitted_at))
          .map((r) => {
            const before = n(r.details?.before_amount);
            return {
              id: r.id, request_no: r.request_no, title: r.title, status: r.status,
              shop_id: r.shop_id ?? null, shop_name: r.shop_name || 'No shop',
              department_id: r.department_id, department_name: r.department?.name ?? null,
              requester_id: r.requester_id, requester_name: r.requester_name,
              approver_name: r.approver_name ?? null, submitted_at: r.submitted_at, decided_at: r.decided_at,
              before_amount: before, after_amount: n(r.details?.after_amount), discount_amount: n(r.amount),
              discount_pct: n(r.details?.discount_pct) || (before ? (n(r.amount) / before) * 100 : 0),
              customer_name: r.details?.customer_name ?? null, reference: r.details?.reference ?? null,
              invoice_no: r.details?.invoice_no ?? null, bill_date: r.details?.bill_date ?? null,
            };
          })
      );
    }
    setLoading(false);
  }, [isBackendConnected, user?.id, from, to, requests]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loading, error, reload: load };
}
