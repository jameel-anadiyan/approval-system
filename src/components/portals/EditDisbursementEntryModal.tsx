import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { DisbursementEntry, RequestRecord, entriesTotal, entryAvailable } from '../../types/database';
import { formatINR } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import { ShieldAlert, AlertCircle, Banknote, Landmark, CheckCircle2, RotateCcw } from 'lucide-react';

interface EditDisbursementEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  entry: DisbursementEntry;
  onResubmit: (
    entryId: string,
    amount: number,
    entryType: 'cash' | 'bank',
    tdsCut: boolean,
    notes?: string,
    adjustment?: number
  ) => Promise<void>;
}

export const EditDisbursementEntryModal: React.FC<EditDisbursementEntryModalProps> = ({
  isOpen,
  onClose,
  request,
  entry,
  onResubmit,
}) => {
  const [entryType, setEntryType] = useState<'cash' | 'bank'>(entry.entry_type || 'bank');
  const [amountStr, setAmountStr] = useState<string>(String(entry.amount || ''));
  const [tdsCut, setTdsCut] = useState<boolean>(entry.tds_cut);
  const [adjustmentStr, setAdjustmentStr] = useState<string>(
    entry.adjustment_amount && entry.adjustment_amount > 0 ? String(entry.adjustment_amount) : ''
  );
  const [notes, setNotes] = useState<string>(entry.notes || '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const parsedAmount = round2(parseFloat(amountStr) || 0);
  const parsedAdjustment = round2(parseFloat(adjustmentStr) || 0);
  const total = round2(parsedAmount + parsedAdjustment);

  // Remaining available excluding this entry
  const otherEntries = (request.disbursement_entries || []).filter(
    (e) => e.id !== entry.id && e.status !== 'cancelled'
  );
  const otherUnpaidSum = otherEntries
    .filter((e) => e.status in ['pending', 'pending_approval', 'approved'])
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const availableBalance = Math.max(
    0,
    round2(request.amount - Number(request.paid_amount || 0) - otherUnpaidSum)
  );

  const overLimit = total > availableBalance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount < 0 || parsedAdjustment < 0) {
      setError('Amounts cannot be negative.');
      return;
    }
    if (total <= 0) {
      setError('Enter an entry amount or an old balance adjustment.');
      return;
    }
    if (overLimit) {
      setError(
        `Total amount (${formatINR(total)}) exceeds available balance (${formatINR(availableBalance)}).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onResubmit(
        entry.id,
        parsedAmount,
        entryType,
        tdsCut,
        notes.trim() || undefined,
        parsedAdjustment
      );
      onClose();
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Correct & Resubmit Entry #${entry.entry_no}`}
      description={`Request ${request.approval_no || request.request_no} · ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Rejection notice banner */}
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-rose-900">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Returned by Entry Approver for Correction</span>
          </div>
          <p className="text-rose-800 bg-white/70 p-2.5 rounded-xl border border-rose-200 font-medium">
            "{entry.rejection_reason || 'Please verify the amount and payment mode.'}"
          </p>
          <span className="text-[10px] text-rose-600 block">
            Make the required correction below and resubmit. The entry will go back to the Approver queue.
          </span>
        </div>

        {/* Mode Selector: Cash vs Bank */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Payment Entry Mode <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEntryType('cash')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                entryType === 'cash'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Banknote className="w-4 h-4" />
              <span>Cash Entry</span>
            </button>
            <button
              type="button"
              onClick={() => setEntryType('bank')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                entryType === 'bank'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span>Bank Entry</span>
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="edit-entry-amount" className="text-xs font-bold text-slate-700 block">
              Entry Amount to Pay (₹) <span className="text-rose-500">*</span>
            </label>
            <span className="text-[11px] text-slate-500">
              Max available: <strong>{formatINR(availableBalance)}</strong>
            </span>
          </div>
          <input
            id="edit-entry-amount"
            type="number"
            step="0.01"
            min="0"
            max={availableBalance}
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="w-full text-sm font-semibold p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono bg-white"
          />
        </div>

        {/* TDS Checkbox */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tdsCut}
              onChange={(e) => setTdsCut(e.target.checked)}
              className="mt-0.5 rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-800 block">TDS was cut on this entry</span>
              <span className="text-[11px] text-slate-500 block">
                Check if tax deduction at source applies to this payment voucher.
              </span>
            </div>
          </label>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="edit-entry-notes" className="text-xs font-bold text-slate-700 block mb-1">
            Correction Notes / Remarks
          </label>
          <textarea
            id="edit-entry-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add explanation of correction made…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || total <= 0 || overLimit}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Resubmitting…' : 'Resubmit for Approval'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
