import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { DisbursementEntry, RequestRecord, entryPayable, paymentSummary } from '../../types/database';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import type { PaymentInput } from '../../context/RequestContext';
import { Banknote, CheckCircle, History, Percent, FileText, Lock } from 'lucide-react';
import { PasskeyField, isValidPasskey } from '../common/PasskeyField';

interface MarkPaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  entry?: DisbursementEntry | null;
  onMarkPaid: (details: PaymentInput) => Promise<void>;
}

const inputCls =
  'w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden';

export const MarkPaidModal: React.FC<MarkPaidModalProps> = ({
  isOpen,
  onClose,
  request,
  entry,
  onMarkPaid,
}) => {
  const { paid, balance } = paymentSummary(request);
  const { user } = useAuth();
  const dealerType = user?.payment_dealer_type;
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const availableModes = React.useMemo(() => {
    if (dealerType === 'cash') return ['Cash'];
    if (dealerType === 'bank') return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer'];
    return ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'];
  }, [dealerType]);

  const entryAdjustment = entry ? Number(entry.adjustment_amount || 0) : 0;
  // The cashier pays EXACTLY what the Entry Approver approved (full entry balance, or the partial figure)
  const exactAmount = entry ? entryPayable(entry) : 0;
  const entryOutstandingAmt = entry ? Math.max(0, Math.round((Number(entry.amount) - Number(entry.paid_amount || 0)) * 100) / 100) : 0;
  const isPartialApproval = !!entry && exactAmount > 0 && exactAmount < entryOutstandingAmt;
  // TDS is deducted from the request balance with this entry's first payment
  const tdsNow = entry && Number(entry.tds_amount || 0) > 0 && !entry.tds_settled ? Number(entry.tds_amount) : 0;

  const [paymentMode, setPaymentMode] = useState(dealerType === 'cash' ? 'Cash' : 'NEFT');
  const [paymentDate, setPaymentDate] = useState(todayIST);
  const [paymentRef, setPaymentRef] = useState('');
  const [passkey, setPasskey] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState(
    entry ? `Disbursement for Entry #${entry.entry_no}` : ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaymentRemarks(entry ? `Disbursement for Entry #${entry.entry_no}` : '');
    if (dealerType === 'cash') {
      setPaymentMode('Cash');
    } else if (dealerType === 'bank') {
      setPaymentMode(entry?.entry_type === 'cash' ? 'Bank Transfer' : 'NEFT');
    } else if (entry?.entry_type === 'cash') {
      setPaymentMode('Cash');
    } else {
      setPaymentMode('NEFT');
    }
    setPasskey('');
    setError(null);
  }, [entry?.id, entry?.entry_type, exactAmount, dealerType]);

  const amount = exactAmount;
  const isFull = amount + tdsNow >= balance && amount > 0;
  const balanceAfter = Math.max(0, Math.round((balance - amount - tdsNow) * 100) / 100);
  const payments = request.payments || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entry) {
      return setError('Payments can only be released against a disbursement entry.');
    }

    if (amount <= 0) {
      return setError('This entry has no approved amount waiting to be paid.');
    }

    if (!isValidPasskey(passkey)) {
      return setError('Enter your 4-digit passkey to confirm this payment.');
    }

    setIsSubmitting(true);
    try {
      await onMarkPaid({
        amount,
        payment_mode: paymentMode,
        payment_date: paymentDate || undefined,
        payment_ref: paymentRef.trim() || undefined,
        payment_remarks: paymentRemarks.trim() || undefined,
        entry_id: entry ? entry.id : undefined,
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
      title={entry ? `Pay Entry #${entry.entry_no}` : paid > 0 ? 'Record Next Payment' : 'Record Payment'}
      description={`Approval ${request.approval_no || request.request_no} · ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}

        {!entry && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-semibold">
            No entry selected. Payments can only be released against a disbursement entry created by the Entry-Only account.
          </div>
        )}

        {/* Specific Entry Card if paying against entry */}
        {entry && (
          <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-extrabold text-teal-950">
                <FileText className="w-4 h-4 text-teal-600" />
                <span>Target: Entry #{entry.entry_no}</span>
              </span>
              <span
                className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                  entry.tds_cut
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-slate-200 text-slate-700 border-slate-300'
                }`}
              >
                {entry.tds_cut
                  ? Number(entry.tds_amount || 0) > 0
                    ? `TDS Cut · ${formatINR(Number(entry.tds_amount))}`
                    : 'TDS Cut'
                  : 'TDS Not Cut'}
              </span>
            </div>

            {entryAdjustment > 0 && (
              <div className="flex items-baseline justify-between pt-1 text-xs text-violet-800">
                <span>Old balance / advance adjusted separately (already settled)</span>
                <span className="font-mono font-semibold">{formatINR(entryAdjustment)}</span>
              </div>
            )}

            {tdsNow > 0 && (
              <div className="flex items-baseline justify-between pt-1 text-xs text-amber-800">
                <span>TDS deducted from the balance with this payment</span>
                <span className="font-mono font-semibold">{formatINR(tdsNow)}</span>
              </div>
            )}

            {isPartialApproval && (
              <div className="flex items-baseline justify-between pt-1 text-xs text-slate-700">
                <span>Entry balance (rest needs the Approver's verification again)</span>
                <span className="font-mono font-semibold">{formatINR(entryOutstandingAmt)}</span>
              </div>
            )}

            <div className="flex items-baseline justify-between pt-1">
              <span className="text-xs text-teal-800">
                {isPartialApproval ? 'Partially approved — pay exactly:' : 'Approved — pay exactly:'}
              </span>
              <span className="font-mono text-base font-extrabold text-teal-950">
                {formatINR(exactAmount)}
              </span>
            </div>

            {entry.notes && (
              <p className="text-[11px] text-teal-800/90 italic pt-1 border-t border-teal-200/60">
                Note: {entry.notes}
              </p>
            )}
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Approved</span>
            <span className="text-xs sm:text-sm font-extrabold text-slate-900 break-words">{formatINR(request.amount)}</span>
          </div>
          <div className="rounded-xl bg-teal-50 border border-teal-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 block">Paid so far</span>
            <span className="text-xs sm:text-sm font-extrabold text-teal-800 break-words">{formatINR(paid)}</span>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Balance</span>
            <span className="text-xs sm:text-sm font-extrabold text-amber-800 break-words">{formatINR(balance)}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Earlier payments ({payments.length})
            </div>
            <ul className="divide-y divide-slate-100 max-h-36 overflow-y-auto">
              {payments.map((p) => (
                <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600 min-w-0 truncate">
                    {formatISTDate(p.payment_date, false)}
                    {p.is_adjustment
                      ? p.payment_mode === 'TDS'
                        ? ' · TDS deducted'
                        : ' · Old balance / advance adjustment'
                      : p.payment_mode
                      ? ` · ${p.payment_mode}`
                      : ''}
                    {p.payment_ref ? ` · ${p.payment_ref}` : ''}
                  </span>
                  <span className="font-bold text-slate-900 shrink-0">{formatINR(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Amount now — fixed to the exact approved amount (cannot be edited) */}
        <div>
          <label htmlFor="payment-amount" className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            Amount paying now (₹)
            <span className="text-[11px] font-normal text-slate-500">(fixed — exactly what the Approver approved)</span>
          </label>
          <input
            id="payment-amount"
            type="text"
            readOnly
            value={exactAmount.toFixed(2)}
            className={`${inputCls} font-display font-bold text-base bg-slate-50 text-slate-900 cursor-not-allowed`}
          />
          <p className={`text-[11px] mt-1 font-semibold ${isFull ? 'text-teal-700' : 'text-amber-700'}`}>
            {amount <= 0
              ? 'Nothing approved for payment on this entry.'
              : isFull
              ? 'Full payment: the request will be closed as Paid.'
              : isPartialApproval
              ? `Partial payment. Entry balance ${formatINR(entryOutstandingAmt - exactAmount)} goes back to the Approver for verification. Request balance after this: ${formatINR(balanceAfter)}.`
              : `Balance after this will be ${formatINR(balanceAfter)}.`}
          </p>
        </div>

        {/* Payment Mode Selection */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-slate-700">Payment Mode</span>
            {dealerType === 'cash' && (
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                Cash Account Only
              </span>
            )}
            {dealerType === 'bank' && (
              <span className="text-[11px] font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                Bank Account Only (Cash Disabled)
              </span>
            )}
          </div>
          <div className={`grid ${availableModes.length === 1 ? 'grid-cols-1' : 'grid-cols-3'} gap-2`}>
            {availableModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaymentMode(mode)}
                className={`py-2 px-2 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                  paymentMode === mode
                    ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="payment-date" className="text-xs font-bold text-slate-700 block mb-1">Payment Date</label>
            <input id="payment-date" type="date" value={paymentDate} max={todayIST}
              onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="payment-ref" className="text-xs font-bold text-slate-700 block mb-1">Reference / UTR / Cheque No.</label>
            <input id="payment-ref" type="text" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="e.g. UTR1234567890" className={`${inputCls} font-mono`} />
          </div>
        </div>

        <div>
          <label htmlFor="payment-remarks" className="text-xs font-bold text-slate-700 block mb-1">Remarks (Optional)</label>
          <textarea id="payment-remarks" rows={2} value={paymentRemarks} onChange={(e) => setPaymentRemarks(e.target.value)}
            placeholder="e.g. Disbursed against Entry #1" className={inputCls} />
        </div>

        {/* Who is paying */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
          <PasskeyField
            id="payment-passkey"
            value={passkey}
            onChange={setPasskey}
            label="Your 4-digit Passkey"
            hint="Enter your personal passkey to confirm this payment. It records who paid."
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            id="payment-submit"
            disabled={isSubmitting || !entry || amount <= 0 || !isValidPasskey(passkey)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isFull ? <CheckCircle className="w-4 h-4" /> : <Banknote className="w-4 h-4" />}
            <span>
              {isSubmitting
                ? 'Saving…'
                : entry
                ? `Pay ${formatINR(amount)} (Entry #${entry.entry_no})`
                : isFull
                ? `Pay ${formatINR(amount)} & Close`
                : `Record ${formatINR(amount)} Payment`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
