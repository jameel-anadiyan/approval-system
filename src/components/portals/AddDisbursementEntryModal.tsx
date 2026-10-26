import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { DisbursementEntry, RequestRecord } from '../../types/database';
import { formatINR } from '../../lib/formatters';
import { PlusCircle, ShieldAlert, Check, FileText, Percent, AlertCircle } from 'lucide-react';

interface AddDisbursementEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onAddEntry: (amount: number, tdsCut: boolean, notes?: string) => Promise<void>;
}

export const AddDisbursementEntryModal: React.FC<AddDisbursementEntryModalProps> = ({
  isOpen,
  onClose,
  request,
  onAddEntry,
}) => {
  const existingEntries: DisbursementEntry[] = (request.disbursement_entries || []).filter(
    (e) => e.status !== 'cancelled'
  );

  // Automatic entry number starts from 1 for each request
  const maxEntryNo = existingEntries.reduce((max, e) => Math.max(max, e.entry_no || 0), 0);
  const nextEntryNo = maxEntryNo + 1;

  const totalEntered = existingEntries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const remainingUnentered = Math.max(0, Math.round((Number(request.amount || 0) - totalEntered) * 100) / 100);

  const [amountStr, setAmountStr] = useState<string>(
    remainingUnentered > 0 ? remainingUnentered.toFixed(2) : ''
  );
  const [tdsCut, setTdsCut] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = Math.round((parseFloat(amountStr) || 0) * 100) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount <= 0) {
      setError('Please enter a valid entry amount greater than ₹0.');
      return;
    }

    if (parsedAmount > remainingUnentered) {
      setError(
        `Entry amount cannot exceed the unentered approved balance of ${formatINR(remainingUnentered)}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddEntry(parsedAmount, tdsCut, notes.trim() || undefined);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Create Disbursement Entry #${nextEntryNo}`}
      description={`Request ${request.approval_no || request.request_no} · ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Request amount breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
              Approved
            </span>
            <span className="text-xs sm:text-sm font-extrabold text-slate-900 break-words">
              {formatINR(request.amount)}
            </span>
          </div>
          <div className="rounded-xl bg-sky-50 border border-sky-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 block">
              Entered ({existingEntries.length})
            </span>
            <span className="text-xs sm:text-sm font-extrabold text-sky-800 break-words">
              {formatINR(totalEntered)}
            </span>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
              Unentered
            </span>
            <span className="text-xs sm:text-sm font-extrabold text-amber-800 break-words">
              {formatINR(remainingUnentered)}
            </span>
          </div>
        </div>

        {/* Automatic Entry Number indicator */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-sky-50/70 border border-sky-200">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-600 shrink-0" />
            <div>
              <span className="text-xs font-bold text-sky-950 block">
                Automatic Entry Sequence
              </span>
              <span className="text-[11px] text-sky-700 block">
                Sequentially numbered per request starting from 1
              </span>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-mono font-extrabold text-xs shadow-xs">
            Entry #{nextEntryNo}
          </span>
        </div>

        {/* Entry Amount */}
        <div>
          <label htmlFor="entry-amount" className="text-xs font-bold text-slate-700 block mb-1">
            Entry Amount (₹) <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              id="entry-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={remainingUnentered}
              required
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              className="w-full text-base font-bold font-mono p-3 rounded-xl border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
            />
            {remainingUnentered > 0 && (
              <button
                type="button"
                onClick={() => setAmountStr(remainingUnentered.toFixed(2))}
                className="shrink-0 px-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors"
              >
                Max Balance
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            The Payment Only account will be allowed to pay up to this exact entry amount.
          </p>
        </div>

        {/* TDS Cut / Not Cut indication */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1.5">
            TDS Deducted Status <span className="text-rose-500">*</span>
          </label>
          <label
            htmlFor="tds-checkbox"
            className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
              tdsCut
                ? 'bg-amber-50/80 border-amber-300 ring-1 ring-amber-300'
                : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              id="tds-checkbox"
              type="checkbox"
              checked={tdsCut}
              onChange={(e) => setTdsCut(e.target.checked)}
              className="mt-1 w-4 h-4 text-amber-600 rounded-sm border-slate-300 focus:ring-amber-500 cursor-pointer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Percent className={`w-3.5 h-3.5 ${tdsCut ? 'text-amber-700' : 'text-slate-500'}`} />
                <span className={`text-xs font-bold ${tdsCut ? 'text-amber-900' : 'text-slate-800'}`}>
                  {tdsCut ? 'TDS Cut (Tax Deducted at Source)' : 'TDS Not Cut (No Tax Deducted)'}
                </span>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                    tdsCut
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                >
                  {tdsCut ? 'TDS Cut' : 'TDS Not Cut'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {tdsCut
                  ? 'Check this box if TDS has been deducted from this payment entry.'
                  : 'Leave unchecked if no TDS deduction applies to this entry.'}
              </p>
            </div>
          </label>
        </div>

        {/* Optional Notes */}
        <div>
          <label htmlFor="entry-notes" className="text-xs font-bold text-slate-700 block mb-1">
            Entry Notes / Invoice Reference (Optional)
          </label>
          <textarea
            id="entry-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Invoice #1029 / Advance 50% with TDS"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
          />
        </div>

        {/* Modal Actions */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="submit-entry-button"
            disabled={isSubmitting || parsedAmount <= 0 || parsedAmount > remainingUnentered}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-md shadow-sky-200 transition-all disabled:opacity-50 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'Creating Entry…'
                : `Create Entry #${nextEntryNo} (${parsedAmount > 0 ? formatINR(parsedAmount) : '₹0'})`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
