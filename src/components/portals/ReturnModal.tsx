import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { RotateCcw } from 'lucide-react';

interface ReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onReturn: (remarks: string) => Promise<void>;
}

export const ReturnModal: React.FC<ReturnModalProps> = ({
  isOpen,
  onClose,
  request,
  onReturn,
}) => {
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarks.trim()) {
      setError('A remark explaining the correction required is mandatory.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onReturn(remarks.trim());
      setRemarks('');
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
      title="Return Request for Correction"
      description={`Send request ${request.request_no || ''} back to ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed">
          The requester will be notified to edit the details or re-upload missing documents, and
          resubmit for fresh routing.
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Required Correction Remarks <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={3}
            required
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Explain clearly what needs to be fixed (e.g. missing GST invoice, mismatch in amount, etc.)…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden"
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
            disabled={isSubmitting || !remarks.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-md shadow-amber-200 transition-all disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Confirm & Return</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
