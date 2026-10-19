import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, paymentSummary } from '../../types/database';
import { formatINR, formatISTDate } from '../../lib/formatters';
import type { PaymentInput } from '../../context/RequestContext';
import { Banknote, CheckCircle, History } from 'lucide-react';

interface MarkPaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onMarkPaid: (details: PaymentInput) => Promise<void>;
}

const inputCls =
  'w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden';

export const MarkPaidModal: React.FC<MarkPaidModalProps> = ({ isOpen, onClose, request, onMarkPaid }) => {
  const { paid, balance } = paymentSummary(request);
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const [paymentMode, setPaymentMode] = useState('NEFT');
  const [paymentDate, setPaymentDate] = useState(todayIST);
  const [amountStr, setAmountStr] = useState(balance.toFixed(2));
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Math.round((parseFloat(amountStr) || 0) * 100) / 100;
  const isFull = amount >= balance && amount > 0;
  const balanceAfter = Math.max(0, Math.round((balance - amount) * 100) / 100);
  const payments = request.payments || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount <= 0) return setError('Enter the amount being paid now.');
    if (amount > balance) return setError(`Amount is more than the balance of ${formatINR(balance)}.`);
    setIsSubmitting(true);
    try {
      await onMarkPaid({
        amount,
        payment_mode: paymentMode,
        payment_date: paymentDate || undefined,
        payment_ref: paymentRef.trim() || undefined,
        payment_remarks: paymentRemarks.trim() || undefined,
      });
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
      title={paid > 0 ? 'Record Next Payment' : 'Record Payment'}
      description={`Approval ${request.approval_no || request.request_no} · ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}

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
                    {p.payment_mode ? ` · ${p.payment_mode}` : ''}
                    {p.payment_ref ? ` · ${p.payment_ref}` : ''}
                  </span>
                  <span className="font-bold text-slate-900 shrink-0">{formatINR(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Amount now */}
        <div>
          <label htmlFor="payment-amount" className="text-xs font-bold text-slate-700 block mb-1">
            Amount paying now (₹) <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              id="payment-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={balance}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className={`${inputCls} font-display font-bold text-base`}
            />
            <button
              type="button"
              id="payment-full"
              onClick={() => setAmountStr(balance.toFixed(2))}
              className="shrink-0 px-3 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 text-xs font-bold hover:bg-teal-100"
            >
              Full balance
            </button>
          </div>
          <p className={`text-[11px] mt-1 font-semibold ${isFull ? 'text-teal-700' : 'text-amber-700'}`}>
            {amount <= 0
              ? 'Enter an amount.'
              : isFull
              ? 'Full payment: the request will be closed as Paid.'
              : `Partial payment: balance after this will be ${formatINR(balanceAfter)}.`}
          </p>
        </div>

        {/* Payment Mode Selection */}
        <div>
          <span className="text-xs font-bold text-slate-700 block mb-1.5">Payment Mode</span>
          <div className="grid grid-cols-3 gap-2">
            {['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaymentMode(mode)}
                className={`py-2 px-2 text-xs font-semibold rounded-xl border text-center transition-all ${
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
            placeholder="e.g. First instalment" className={inputCls} />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            id="payment-submit"
            disabled={isSubmitting || amount <= 0 || amount > balance}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all disabled:opacity-50"
          >
            {isFull ? <CheckCircle className="w-4 h-4" /> : <Banknote className="w-4 h-4" />}
            <span>{isSubmitting ? 'Saving…' : isFull ? `Pay ${formatINR(amount)} & Close` : `Record ${formatINR(amount)} Payment`}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
