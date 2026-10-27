import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, PackageCheck } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { RequestRecord } from '../../types/database';
import { formatINR } from '../../lib/formatters';

interface CompleteTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onConfirm: (remarks: string) => Promise<{ success: boolean; error?: string }>;
}

/** Stock Transfer Monitor (or Admin) confirms the goods reached the destination shop. */
export const CompleteTransferModal: React.FC<CompleteTransferModalProps> = ({ isOpen, onClose, request, onConfirm }) => {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = request.details || {};
  const pieces = Number(d.total_pieces ?? d.pieces_count ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onConfirm(remarks);
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not mark the transfer complete');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mark Transfer Complete"
      description={`${request.approval_no || request.request_no || ''} · confirm the stock has reached the destination shop`}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">From</span>
              <span className="font-bold text-slate-900 truncate block">{d.from_shop_name || '—'}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-200">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="min-w-0 text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">To</span>
              <span className="font-bold text-slate-900 truncate block">{d.to_shop_name || '—'}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white border border-slate-200 p-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Pieces</span>
              <span className="text-sm font-extrabold text-slate-900">{pieces}</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Gross Wt</span>
              <span className="text-sm font-extrabold text-slate-900">{Number(d.total_gross_weight ?? 0)} g</span>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">MRP</span>
              <span className="text-sm font-extrabold text-slate-900">{formatINR(Number(d.total_mrp ?? request.amount ?? 0))}</span>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="transfer-complete-remarks" className="text-xs font-bold text-slate-700 block mb-1">
            Remarks <span className="text-slate-400 font-normal">(optional — e.g. received by, challan no.)</span>
          </label>
          <textarea
            id="transfer-complete-remarks"
            rows={3}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Received at destination shop by…"
            className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden"
          />
        </div>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="confirm-transfer-complete"
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 disabled:opacity-50 active:scale-95 transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            <span>{busy ? 'Saving…' : 'Confirm Transfer Complete'}</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> The requester and owner Head are notified. This cannot be undone.
        </p>
      </form>
    </Modal>
  );
};
