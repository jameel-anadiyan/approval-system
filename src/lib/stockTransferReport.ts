// Stock Transfer report data. Live mode calls the stock_transfer_report RPC (Admin,
// Stock Transfer Monitor accounts, or users Admin granted access); the offline sandbox
// derives rows from demo requests.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestContext';
import type { Profile, RequestDetails, RequestStatus } from '../types/database';

export interface StockTransferRow {
  id: string;
  request_no: string | null;
  approval_no: string | null;
  title: string;
  status: RequestStatus;
  requester_id: string;
  requester_name: string;
  department_id: string | null;
  department_name: string | null;
  approver_name: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  from_shop_id: string | null;
  from_shop_name: string;
  to_shop_id: string | null;
  to_shop_name: string;
  transfer_mode: 'itemized' | 'bulk';
  pieces: number;
  gross_weight: number;
  total_mrp: number;
  transfer_completed_at: string | null;
  transfer_completed_by_name: string | null;
  transfer_completed_remarks: string | null;
  details: RequestDetails | null;
}

/** Disbursement account that only tracks approved stock transfers. */
export const isStockMonitor = (u: Profile | null | undefined) =>
  !!u && u.role === 'disbursement' && u.disbursement_type === 'stock_transfer_monitor';

/** UI check only — the RPC enforces the same rule in the database. */
export const canViewStockTransferReport = (u: Profile | null | undefined) =>
  !!u && (u.role === 'admin' || isStockMonitor(u) || !!u.can_view_stock_transfer_report);

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export function useStockTransferReport(from: string, to: string) {
  const { isBackendConnected, user } = useAuth();
  const { requests } = useRequests();
  const [rows, setRows] = useState<StockTransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isBackendConnected && user) {
      const { data, error: e } = await supabase.rpc('stock_transfer_report', { p_from: from || null, p_to: to || null });
      if (e) {
        setError(
          e.message.includes('does not exist') || e.message.includes('schema cache')
            ? 'Database migration required: run 0049_request_shop_and_stock_transfer_monitor.sql in the Supabase SQL Editor.'
            : e.message
        );
        setRows([]);
      } else {
        setRows(
          ((data as StockTransferRow[]) ?? []).map((r) => ({
            ...r,
            transfer_mode: r.transfer_mode === 'bulk' ? 'bulk' : 'itemized',
            pieces: n(r.pieces),
            gross_weight: n(r.gross_weight),
            total_mrp: n(r.total_mrp),
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
          .filter((r) => r.request_type === 'stock_transfer' && r.status !== 'draft' && inRange(r.submitted_at))
          .map((r) => {
            const d = r.details || {};
            return {
              id: r.id,
              request_no: r.request_no,
              approval_no: r.approval_no,
              title: r.title,
              status: r.status,
              requester_id: r.requester_id,
              requester_name: r.requester_name,
              department_id: r.department_id,
              department_name: r.department?.name ?? null,
              approver_name: r.approver_name ?? null,
              submitted_at: r.submitted_at,
              decided_at: r.decided_at,
              from_shop_id: d.from_shop_id ?? null,
              from_shop_name: d.from_shop_name || 'Unknown shop',
              to_shop_id: d.to_shop_id ?? null,
              to_shop_name: d.to_shop_name || 'Unknown shop',
              transfer_mode: d.transfer_mode === 'bulk' ? 'bulk' : 'itemized',
              pieces: n(d.total_pieces ?? d.pieces_count),
              gross_weight: n(d.total_gross_weight),
              total_mrp: n(d.total_mrp ?? r.amount),
              transfer_completed_at: r.transfer_completed_at ?? null,
              transfer_completed_by_name: r.transfer_completed_by_name ?? null,
              transfer_completed_remarks: r.transfer_completed_remarks ?? null,
              details: r.details ?? null,
            } as StockTransferRow;
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
