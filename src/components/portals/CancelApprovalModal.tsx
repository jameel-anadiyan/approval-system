import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, paymentSummary } from '../../types/database';
import { ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { formatINR } from '../../lib/formatters';
import { AlertTriangle, Ban, Loader2, AlertCircle } from 'lucide-react';

interface CancelApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onCancel: (reason: string, voice: ActionVoice | null) => Promise<void>;
}

/** Owner Head cancels an approved request before it has been fully paid. */
export const CancelApprovalModal: React.FC<CancelApprovalModalProps> = ({ isOpen, onClose, request, onCancel }) => {
  const [reason, setReason] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = paymentSummary(request);
  const isDiscount = request.request_type === 'discount';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Please give a reason for cancelling.');
    if (!confirmed) return setError('Please tick the confirmation box.');
    setSubmitting(true);
    setError(null);
    try {
      await onCancel(reason.trim(), voice);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cancel Approval"
      description={`${request.approval_no || request.request_no || ''} · ${request.title}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-1.5">
          <p className="font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            This cannot be undone
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-rose-800">
            <li>The approval {request.approval_no ? <strong>{request.approval_no}</strong> : null} and its signed documents become void.</li>
            {!isDiscount && <li>Disbursement can no longer record payments against it.</li>}
            <li>The requester{!isDiscount ? ', Disbursement' : ''} and your department are notified.</li>
          </ul>
        </div>

        {!isDiscount && pay.paid > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
              <p className="text-[10px] uppercase text-slate-500">Approved</p>
              <p className="font-bold text-slate-800">{formatINR(request.amount)}</p>
            </div>
            <div className="rounded-xl bg-teal-50 border border-teal-200 p-2">
              <p className="text-[10px] uppercase text-teal-600">Already paid</p>
              <p className="font-bold text-teal-800">{formatINR(pay.paid)}</p>
            </div>
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-2">
              <p className="text-[10px] uppercase text-rose-600">Will not be paid</p>
              <p className="font-bold text-rose-800">{formatINR(pay.balance)}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="cancel-reason" className="text-xs font-bold text-slate-700 block mb-1">
            Reason for cancelling <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Event postponed; vendor invoice withdrawn…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-rose-400 focus:ring-1 focus:ring-rose-400 outline-hidden"
          />
        </div>

        <ActionVoiceField label="Voice message (optional)" onChange={setVoice} />

        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer select-none">
          <input
            id="cancel-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 accent-rose-600"
          />
          <span>I understand this approval will be cancelled permanently.</span>
        </label>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Keep Approval
          </button>
          <button
            type="submit"
            id="confirm-cancel-approval"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-200 transition-all disabled:opacity-60 cursor-pointer"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            <span>{submitting ? 'Cancelling…' : 'Cancel Approval'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
