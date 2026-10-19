import React, { useEffect, useMemo, useState } from 'react';
import type { RequestRecord } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { invokeEdgeFunction } from '../../lib/supabase';
import { formatINR } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, CheckSquare, Square, MinusSquare } from 'lucide-react';

/** Tracks selected request ids; drops ids that leave the visible list. */
export function useSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const key = visibleIds.join(',');

  useEffect(() => {
    setSelected((prev) => {
      const keep = new Set([...prev].filter((id) => visibleIds.includes(id)));
      return keep.size === prev.size ? prev : keep;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));
  const clear = () => setSelected(new Set());
  return { selected, toggle, toggleAll, allSelected, clear };
}

interface BulkApproveBarProps {
  items: RequestRecord[];
  selection: ReturnType<typeof useSelection>;
}

type ItemResult = { id: string; ok: boolean; text: string };

/** Select-all toolbar + "Approve selected" with sequential signing and per-item results. */
export const BulkApproveBar: React.FC<BulkApproveBarProps> = ({ items, selection }) => {
  const { isBackendConnected } = useAuth();
  const { approveRequest, refreshRequests } = useRequests();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [batch, setBatch] = useState<RequestRecord[]>([]);
  const [creds, setCreds] = useState<{ ok: boolean; loading: boolean }>({ ok: true, loading: false });

  const chosen = useMemo(() => items.filter((r) => selection.selected.has(r.id)), [items, selection.selected]);
  const shown = running || results.length ? batch : chosen;
  const total = shown.reduce((s, r) => s + r.amount, 0);
  const some = selection.selected.size > 0 && !selection.allSelected;

  useEffect(() => {
    if (!open || !isBackendConnected) return;
    setCreds({ ok: true, loading: true });
    invokeEdgeFunction<{ seal_url: string | null; signature_url: string | null }>('credentials', { action: 'view' }).then(
      ({ data }) => setCreds({ ok: !!data?.seal_url && !!data?.signature_url, loading: false })
    );
  }, [open, isBackendConnected]);

  const run = async () => {
    setRunning(true);
    setResults([]);
    setBatch(chosen);
    const out: ItemResult[] = [];
    for (const r of chosen) {
      const res = await approveRequest(r.id, null, { reload: false });
      out.push({
        id: r.id,
        ok: res.success,
        text: res.success ? res.approval_no || 'Approved' : res.error || 'Failed',
      });
      setResults([...out]);
    }
    await refreshRequests();
    setRunning(false);
    selection.clear();
  };

  const close = () => {
    if (running) return;
    setOpen(false);
    setResults([]);
  };

  if (items.length === 0 && !open) return null;
  const done = results.length > 0 && !running;
  const okCount = results.filter((r) => r.ok).length;
  const nameOf = (id: string) => {
    const r = batch.find((x) => x.id === id);
    return r ? `${r.request_no || 'Request'} · ${r.title}` : id;
  };

  return (
    <>
      <div className="sticky top-16 z-20 flex items-center justify-between gap-3 bg-white/90 backdrop-blur-md border border-brand-200 rounded-2xl px-3 py-2.5 shadow-sm">
        <button
          type="button"
          id="bulk-select-all"
          onClick={selection.toggleAll}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-brand-700"
        >
          {selection.allSelected ? (
            <CheckSquare className="w-4 h-4 text-brand-600" />
          ) : some ? (
            <MinusSquare className="w-4 h-4 text-brand-600" />
          ) : (
            <Square className="w-4 h-4 text-slate-400" />
          )}
          <span>{selection.allSelected ? 'Unselect all' : `Select all (${items.length})`}</span>
        </button>
        <div className="flex items-center gap-3">
          {selection.selected.size > 0 && (
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {selection.selected.size} selected · {formatINR(total)}
            </span>
          )}
          <button
            type="button"
            id="bulk-approve"
            disabled={selection.selected.size === 0}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 disabled:opacity-40 disabled:shadow-none transition-all active:scale-95"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Approve selected{selection.selected.size ? ` (${selection.selected.size})` : ''}</span>
          </button>
        </div>
      </div>

      <Modal
        isOpen={open}
        onClose={close}
        title={done ? 'Bulk approval finished' : 'Approve & sign selected requests'}
        description={`${shown.length} request(s) · ${formatINR(total)}`}
        maxWidth="md"
      >
        <div className="space-y-4">
          {!done && !running && (
            <>
              <ul className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                {chosen.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate">
                      <span className="font-mono font-bold text-slate-700">{r.request_no}</span> · {r.title}
                    </span>
                    <span className="font-bold text-slate-900 shrink-0">{formatINR(r.amount)}</span>
                  </li>
                ))}
              </ul>
              {isBackendConnected && !creds.loading && !creds.ok && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Your seal and signature must both be uploaded by the Admin before you can approve.</span>
                </div>
              )}
              <p className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed">
                Each request is stamped with your seal, signature and an approval number, one after another. To add a
                voice message, approve that request on its own page instead.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={close}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="bulk-approve-confirm"
                  onClick={run}
                  disabled={chosen.length === 0 || (isBackendConnected && (creds.loading || !creds.ok))}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm & approve {chosen.length}
                </button>
              </div>
            </>
          )}

          {(running || done) && (
            <>
              <div>
                <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                  <span>{running ? 'Stamping documents…' : `${okCount} of ${results.length} approved`}</span>
                  <span>
                    {results.length}/{batch.length}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-brand-600 transition-all duration-300"
                    style={{ width: `${(results.length / Math.max(1, batch.length)) * 100}%` }}
                  />
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                {results.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 px-3 py-2">
                    {r.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-slate-800 font-medium">{nameOf(r.id)}</span>
                      <span className={`block font-mono text-[11px] ${r.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{r.text}</span>
                    </span>
                  </li>
                ))}
                {running && (
                  <li className="flex items-center gap-2 px-3 py-2 text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Working…
                  </li>
                )}
              </ul>
              {done && (
                <div className="flex justify-end pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={close}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
};
