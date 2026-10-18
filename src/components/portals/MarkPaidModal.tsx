import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { formatINR } from '../../lib/formatters';
import { Banknote, CheckCircle } from 'lucide-react';

interface MarkPaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onMarkPaid: (details: {
    payment_mode?: string;
    payment_ref?: string;
    payment_remarks?: string;
    payment_date?: string;
  }) => Promise<void>;
}

export const MarkPaidModal: React.FC<MarkPaidModalProps> = ({
  isOpen,
  onClose,
  request,
  onMarkPaid,
}) => {
  const [paymentMode, setPaymentMode] = useState('NEFT');
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [paymentDate, setPaymentDate] = useState(todayIST);
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onMarkPaid({
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
      title="Disburse & Mark as Paid"
      description={`Disbursement for approval ${request.approval_no || request.request_no}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
              Approved Amount to Disburse
            </span>
            <div className="text-xl font-extrabold text-teal-950 font-display mt-0.5">
              {formatINR(request.amount)}
            </div>
          </div>
          <div className="text-right text-xs">
            <span className="text-slate-500 block">Beneficiary</span>
            <span className="font-bold text-slate-800">{request.requester_name}</span>
          </div>
        </div>

        {/* Payment Mode Selection */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1.5">
            Payment Mode
          </label>
          <div className="grid grid-cols-3 gap-2">
            {['NEFT', 'RTGS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaymentMode(mode)}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all ${
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

        {/* Payment Date */}
        <div>
          <label htmlFor="payment-date" className="text-xs font-bold text-slate-700 block mb-1">
            Payment Date
          </label>
          <input
            id="payment-date"
            type="date"
            value={paymentDate}
            max={todayIST}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden"
          />
        </div>

        {/* Payment Reference Number */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Reference / UTR / Cheque Number
          </label>
          <input
            type="text"
            value={paymentRef}
            onChange={(e) => setPaymentRef(e.target.value)}
            placeholder="e.g. UTR1234567890 or Cheque #004512"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden font-mono"
          />
        </div>

        {/* Payment Remarks */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Disbursement Remarks (Optional)
          </label>
          <textarea
            rows={2}
            value={paymentRemarks}
            onChange={(e) => setPaymentRemarks(e.target.value)}
            placeholder="Disbursed via corporate treasury account…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden"
          />
        </div>

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
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all disabled:opacity-50"
          >
            <Banknote className="w-4 h-4" />
            <span>Confirm & Close Request</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
