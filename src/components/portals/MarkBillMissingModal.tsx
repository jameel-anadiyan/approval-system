import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { formatINR } from '../../lib/formatters';
import { AlertCircle, FileX, Loader2 } from 'lucide-react';

interface MarkBillMissingModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord | null;
  onSuccess?: () => void;
}

export const MarkBillMissingModal: React.FC<MarkBillMissingModalProps> = ({
  isOpen,
  onClose,
  request,
  onSuccess,
}) => {
  const { markBillMissing } = useRequests();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !request) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNote = note.trim();
    if (!cleanNote) {
      setError('Please provide a note explaining what is missing or required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await markBillMissing(request.id, cleanNote);
      if (!res.success) {
        throw new Error(res.error || 'Failed to flag missing bill');
      }
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Flag Original Bill Missing"
      description={`Request #${request.approval_no || request.request_no} · ${request.requester_name}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3.5 bg-rose-50/60 border border-rose-200/80 rounded-2xl text-xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-700">
            <span>Requester Name:</span>
            <span className="font-bold text-slate-900">{request.requester_name}</span>
          </div>
          <div className="flex items-center justify-between text-slate-700">
            <span>Request Amount:</span>
            <span className="font-bold text-slate-900">{formatINR(request.amount)}</span>
          </div>
          <div className="flex items-center justify-between text-slate-700">
            <span>Title:</span>
            <span className="font-medium text-slate-800 truncate max-w-[240px]">{request.title}</span>
          </div>
        </div>

        <div>
          <label htmlFor="bill-missing-note" className="text-xs font-bold text-slate-700 block mb-1.5">
            Note to Requester &amp; Department <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="bill-missing-note"
            rows={3}
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain why the original bill is missing (e.g. Original physical tax invoice not attached, only proforma invoice attached, stamp missing)…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden bg-white"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            This request will immediately move into the glowing red <span className="text-rose-600 font-bold">"Bill Missing"</span> tab for the requester, clerk, regional head, and department head.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !note.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileX className="w-4 h-4" />
            )}
            <span>{submitting ? 'Flagging…' : 'Mark Bill Missing'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
