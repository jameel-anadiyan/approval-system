import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { formatINR } from '../../lib/formatters';
import { HelpCircle, Send, Loader2, UserCheck, AlertCircle } from 'lucide-react';

interface DisbursementClarificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onSuccess?: () => void;
}

export const DisbursementClarificationModal: React.FC<DisbursementClarificationModalProps> = ({
  isOpen,
  onClose,
  request,
  onSuccess,
}) => {
  const { requestDisbursementClarification } = useRequests();

  const [note, setNote] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() && !voice) {
      setError('Please provide either a written message or a voice note explaining the clarification needed.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await requestDisbursementClarification(request.id, note.trim() || undefined, voice);
      if (!res.success) {
        throw new Error(res.error || 'Failed to send clarification request');
      }
      setNote('');
      setVoice(null);
      if (onSuccess) onSuccess();
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
      title="Send to Head for Clarification"
      description={`Request ${request.approval_no || request.request_no || ''} · ${request.title}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Summary Card */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 font-medium">Beneficiary / Requester:</span>
            <span className="font-bold text-slate-800">{request.requester_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 font-medium">Approved Amount:</span>
            <span className="font-extrabold text-slate-900 font-display">{formatINR(request.amount)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
            <span className="text-slate-500 font-medium flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>Receiving Head:</span>
            </span>
            <span className="font-bold text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
              {request.owner_head_name || 'Department Head'}
            </span>
          </div>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200/90 rounded-xl text-xs text-amber-900 leading-relaxed flex items-start gap-2">
          <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Hold for Head Clarification:</span> This will pause disbursement and send this request directly back to the Department Head with your message and audio recording. Once the Head responds, the request will be returned to you to release payment.
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Written Message */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Clarification Query / Note for Head
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please verify vendor bank details / GST credit note mismatch before disbursement…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden"
          />
        </div>

        {/* Voice Recording */}
        <ActionVoiceField
          label="Audio Voice Message for Head (Optional)"
          onChange={setVoice}
        />

        {/* Action Buttons */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-200 transition-all disabled:opacity-60 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send to Head for Clarification</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
