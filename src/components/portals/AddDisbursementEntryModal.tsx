import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { DisbursementEntry, RequestRecord, entriesTotal, entryAvailable } from '../../types/database';
import { formatINR } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import { PlusCircle, ShieldAlert, Check, FileText, Percent, AlertCircle, AlertTriangle, RotateCcw, Banknote, Landmark, CheckCircle2 } from 'lucide-react';
import { PasskeyField, isValidPasskey } from '../common/PasskeyField';

interface AddDisbursementEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onAddEntry: (
    amount: number,
    tdsCut: boolean,
    notes: string | undefined,
    adjustment: number,
    entryType: 'cash' | 'bank',
    extra: { tdsAmount: number; passkey: string }
  ) => Promise<void>;
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

  const totalEntered = entriesTotal(existingEntries);
  // Balance available for new entries = approved - paid/adjusted - unpaid entries
  const remainingUnentered = entryAvailable(request);

  const [entryType, setEntryType] = useState<'cash' | 'bank'>(
    request.disbursement_mode === 'cash' ? 'cash' : 'bank'
  );
  const [amountStr, setAmountStr] = useState<string>(
    remainingUnentered > 0 ? remainingUnentered.toFixed(2) : ''
  );
  const [amountTouched, setAmountTouched] = useState(false);
  const [tdsCut, setTdsCut] = useState<boolean>(false);
  const [tdsAmountStr, setTdsAmountStr] = useState<string>('');
  const [adjustmentStr, setAdjustmentStr] = useState<string>('');
  const [passkey, setPasskey] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const parsedAmount = round2(parseFloat(amountStr) || 0);
  const parsedAdjustment = round2(parseFloat(adjustmentStr) || 0);
  // TDS is deducted from the request balance, so it is only counted when ticked
  const parsedTds = tdsCut ? round2(parseFloat(tdsAmountStr) || 0) : 0;
  const total = round2(parsedAmount + parsedAdjustment + parsedTds);
  // Max entry amount after keeping room for the adjustment and the TDS
  const maxEntryAmount = Math.max(0, round2(remainingUnentered - parsedAdjustment - parsedTds));
  const adjustmentInvalid = parsedAdjustment < 0 || parsedAdjustment > remainingUnentered;
  const tdsMissing = tdsCut && parsedTds <= 0;
  const overLimit = total > remainingUnentered;
  const adjustmentOnly = parsedAmount === 0 && parsedAdjustment > 0;

  // Keep the auto-filled entry amount = balance - adjustment - TDS until the user edits it
  const autoFill = (adj: number, tds: number) => {
    if (amountTouched) return;
    const next = Math.max(0, round2(remainingUnentered - adj - tds));
    setAmountStr(next > 0 ? next.toFixed(2) : '0');
  };

  const handleAdjustmentChange = (value: string) => {
    setAdjustmentStr(value);
    autoFill(round2(parseFloat(value) || 0), parsedTds);
  };

  const handleTdsAmountChange = (value: string) => {
    setTdsAmountStr(value);
    autoFill(parsedAdjustment, tdsCut ? round2(parseFloat(value) || 0) : 0);
  };

  const handleTdsToggle = (checked: boolean) => {
    setTdsCut(checked);
    if (!checked) {
      setTdsAmountStr('');
      autoFill(parsedAdjustment, 0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount < 0 || parsedAdjustment < 0 || parsedTds < 0) {
      setError('Amounts cannot be negative.');
      return;
    }

    if (tdsMissing) {
      setError('TDS is ticked - enter the TDS amount that was cut.');
      return;
    }

    if (parsedAmount + parsedAdjustment <= 0) {
      setError('Enter an entry amount or an old balance / advance adjustment.');
      return;
    }

    if (tdsCut && parsedAmount === 0) {
      setError('TDS needs an entry amount to be paid.');
      return;
    }

    if (overLimit) {
      setError(
        `Entry amount + TDS + adjustment (${formatINR(total)}) cannot exceed the balance available for entries (${formatINR(remainingUnentered)}).`
      );
      return;
    }

    if (!isValidPasskey(passkey)) {
      setError('Enter your 4-digit passkey to save this entry.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddEntry(parsedAmount, tdsCut, notes.trim() || undefined, parsedAdjustment, entryType, {
        tdsAmount: parsedTds,
        passkey,
      });
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
              Available
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

        {/* Payment Entry Mode (Cash vs Bank) */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Payment Dealing Mode <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEntryType('cash')}
              className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                entryType === 'cash'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs ring-1 ring-emerald-500'
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
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs ring-1 ring-indigo-500'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span>Bank Entry</span>
            </button>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            This entry will route to the associated {entryType === 'cash' ? 'Cash' : 'Bank'} payment desk once approved by the Entry Approver.
          </span>
        </div>

        {/* If Bank Entry, display the request's bank details */}
        {entryType === 'bank' && (
          <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-indigo-600" />
                Request Beneficiary Bank Account
              </span>
              {request.bank_verified && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                  ✓ Verified (Penny-Less)
                </span>
              )}
            </div>

            {request.bank_account_no ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">Beneficiary Name</span>
                  <span className="font-bold text-slate-900 block truncate">{request.bank_account_holder_name || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">Bank / Branch</span>
                  <span className="font-semibold text-slate-800 block truncate">{request.bank_name || '—'} {request.bank_branch ? `(${request.bank_branch})` : ''}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">Account Number</span>
                  <span className="font-mono font-bold text-slate-900 block">{request.bank_account_no}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-500 block">IFSC Code</span>
                  <span className="font-mono font-bold text-slate-900 block">{request.bank_ifsc}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>Bank account details have not been entered yet for this request. Only requests with bank account details entered will be automatically transferred.</span>
              </div>
            )}
          </div>
        )}

        {!request.disbursement_mode && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Disbursement mode has not been decided yet.</span>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Payout method was not specified at creation. You can select Cash Entry or Bank Entry above for this voucher.
              </p>
            </div>
          </div>
        )}

        {/* Old balance / old advance adjustment (separate from the entry amount) */}
        <div className="p-3.5 rounded-xl border border-violet-200 bg-violet-50/50 space-y-2.5">
          <label htmlFor="entry-adjustment" className="text-xs font-bold text-violet-950 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-violet-600" />
            Old Balance / Old Advance Adjustment (₹)
            <span className="text-[10px] font-semibold text-violet-600">Optional</span>
          </label>
          <input
            id="entry-adjustment"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={remainingUnentered}
            value={adjustmentStr}
            onChange={(e) => handleAdjustmentChange(e.target.value)}
            placeholder="0.00"
            className={`w-full text-sm font-bold font-mono p-2.5 rounded-xl border bg-white outline-hidden focus:ring-1 ${
              adjustmentInvalid
                ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                : 'border-violet-200 focus:border-violet-500 focus:ring-violet-500'
            }`}
          />
          <p className="text-[11px] text-violet-800/80 leading-snug">
            Deducted from the request balance and marked as <strong>paid automatically</strong>. It is not part of the
            entry amount — the Payment account does not pay it.
          </p>
        </div>

        {/* Entry Amount (what the Payment-Only account pays) */}
        <div>
          <label htmlFor="entry-amount" className="text-xs font-bold text-slate-700 block mb-1">
            Entry Amount to Pay (₹) <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              id="entry-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max={maxEntryAmount}
              required
              value={amountStr}
              onChange={(e) => {
                setAmountTouched(true);
                setAmountStr(e.target.value);
              }}
              placeholder="0.00"
              className={`w-full text-base font-bold font-mono p-3 rounded-xl border outline-hidden focus:ring-1 ${
                overLimit
                  ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                  : 'border-slate-200 focus:border-sky-500 focus:ring-sky-500'
              }`}
            />
            {maxEntryAmount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAmountTouched(true);
                  setAmountStr(maxEntryAmount.toFixed(2));
                }}
                className="shrink-0 px-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors"
              >
                Max Balance
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            The Payment-Only account pays exactly the amount the Entry Approver approves against Entry #{nextEntryNo}
            (full, or a partial figure). Use 0 to record only an adjustment.
          </p>
        </div>

        {(parsedAdjustment > 0 || parsedTds > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {parsedAdjustment > 0 && (
              <div className="rounded-lg bg-violet-100/70 border border-violet-200 p-2 min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-violet-700 flex items-center justify-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> Adjusted
                </span>
                <span className="text-xs font-extrabold text-violet-800 break-words">{formatINR(parsedAdjustment)}</span>
              </div>
            )}
            {parsedTds > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 flex items-center justify-center gap-0.5">
                  <Percent className="w-2.5 h-2.5" /> TDS
                </span>
                <span className="text-xs font-extrabold text-amber-800 break-words">{formatINR(parsedTds)}</span>
              </div>
            )}
            <div className="rounded-lg bg-teal-50 border border-teal-200 p-2 min-w-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-teal-700 flex items-center justify-center gap-0.5">
                <Banknote className="w-2.5 h-2.5" /> To Pay
              </span>
              <span className="text-xs font-extrabold text-teal-800 break-words">{formatINR(parsedAmount)}</span>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-2 min-w-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">Total</span>
              <span className={`text-xs font-extrabold break-words ${overLimit ? 'text-rose-700' : 'text-slate-900'}`}>
                {formatINR(total)}
              </span>
            </div>
          </div>
        )}
        {adjustmentOnly && (
          <p className="text-[11px] font-semibold text-violet-900 bg-violet-100/80 border border-violet-200 rounded-lg px-2.5 py-1.5">
            Adjustment only — Entry #{nextEntryNo} will be marked <strong>Paid</strong> immediately (nothing to pay).
          </p>
        )}
        {overLimit && (
          <p className="text-[11px] font-semibold text-rose-700">
            Entry amount + TDS + adjustment cannot be more than {formatINR(remainingUnentered)}.
          </p>
        )}

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
              onChange={(e) => handleTdsToggle(e.target.checked)}
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

          {tdsCut && (
            <div className="mt-2 p-3 rounded-xl border border-amber-200 bg-amber-50/50">
              <label htmlFor="entry-tds-amount" className="text-xs font-bold text-amber-950 block mb-1">
                TDS Amount Cut (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                id="entry-tds-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={tdsAmountStr}
                onChange={(e) => handleTdsAmountChange(e.target.value)}
                placeholder="0.00"
                className={`w-full text-sm font-bold font-mono p-2.5 rounded-xl border bg-white outline-hidden focus:ring-1 ${
                  tdsMissing
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                    : 'border-amber-200 focus:border-amber-500 focus:ring-amber-500'
                }`}
              />
              <p className="text-[11px] text-amber-900/80 leading-snug mt-1">
                Deducted from the request balance together with the entry amount. The Payment account pays only the
                entry amount; the TDS is settled automatically against the balance.
              </p>
            </div>
          )}
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

        {/* Who is making this entry */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
          <PasskeyField
            id="entry-passkey"
            value={passkey}
            onChange={setPasskey}
            label="Your 4-digit Passkey"
            hint="Enter your personal passkey to save this entry. It records who made the entry."
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
            disabled={isSubmitting || parsedAmount + parsedAdjustment <= 0 || overLimit || adjustmentInvalid || tdsMissing || !isValidPasskey(passkey)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-md shadow-sky-200 transition-all disabled:opacity-50 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'Creating Entry…'
                : `Create Entry #${nextEntryNo} (${formatINR(parsedAmount)} to pay)${
                    parsedAdjustment > 0 ? ` · Adjust ${formatINR(parsedAdjustment)}` : ''
                  }`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
