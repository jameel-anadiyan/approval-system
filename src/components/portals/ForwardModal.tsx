import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { CornerDownRight } from 'lucide-react';
import type { ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onForward: (remarks?: string, voice?: ActionVoice | null) => Promise<void>;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  request,
  onForward,
}) => {
  const [remarks, setRemarks] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onForward(remarks.trim() || undefined, voice);
      setRemarks('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Forward to Admin for Approval"
      description={`Review and submit request ${request.request_no || ''} to Administrator`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
          As Department Head, you are confirming that you have reviewed the request details, verified
          the invoices, and recommend it for final Admin sign-off.
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Head Review Remarks / Recommendation (Optional)
          </label>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Verified against department Q2 budget; recommended for sanction…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        <ActionVoiceField onChange={setVoice} label="Voice message for Admin (optional)" />

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>
        )}

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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Forward to Admin</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
