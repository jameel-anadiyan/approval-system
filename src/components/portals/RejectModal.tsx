import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { XCircle } from 'lucide-react';

interface RejectModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onReject: (reason: string) => Promise<void>;
}

export const RejectModal: React.FC<RejectModalProps> = ({
  isOpen,
  onClose,
  request,
  onReject,
}) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A reason for rejecting this request is mandatory.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onReject(reason.trim());
      setReason('');
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
      title="Reject Request"
      description={`Decline request ${request.request_no || ''}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 leading-relaxed">
          Rejecting permanently closes this request. The requester cannot edit or resubmit it.
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Reason for Rejection <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain the justification for rejection (e.g. out of budget policy, unapproved vendor, etc.)…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden"
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
            disabled={isSubmitting || !reason.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-md shadow-rose-200 transition-all disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Confirm Rejection</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
