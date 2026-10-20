import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, DisbursementClarification } from '../../types/database';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { ConsultationVoicePlayer } from '../requests/ConsultationVoicePlayer';
import { Send, Loader2, MessageSquare, AlertCircle, CornerDownLeft } from 'lucide-react';
import { formatISTDate } from '../../lib/formatters';

interface RespondClarificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  clarification: DisbursementClarification;
  onSuccess?: () => void;
}

export const RespondClarificationModal: React.FC<RespondClarificationModalProps> = ({
  isOpen,
  onClose,
  request,
  clarification,
  onSuccess,
}) => {
  const { respondDisbursementClarification } = useRequests();

  const [responseNote, setResponseNote] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseNote.trim() && !voice) {
      setError('Please provide either a response note or a voice note for the Disbursement department.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await respondDisbursementClarification(
        clarification.id,
        responseNote.trim() || undefined,
        voice,
        request.id
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to submit clarification response');
      }
      setResponseNote('');
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
      title="Send Clarification to Disbursement"
      description={`Request ${request.approval_no || request.request_no || ''} · ${request.title}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Original Query from Disbursement */}
        <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-950 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
              <span>Query from {clarification.requested_by_name} (Disbursement):</span>
            </span>
            <span className="text-[10px] text-amber-700">
              {formatISTDate(clarification.created_at)}
            </span>
          </div>

          {clarification.request_note && (
            <p className="p-2.5 bg-white/90 rounded-xl border border-amber-200 text-slate-800 leading-relaxed font-medium">
              "{clarification.request_note}"
            </p>
          )}

          {clarification.request_voice_path && (
            <div className="pt-1">
              <span className="text-[11px] font-bold text-amber-900 block mb-1">
                Audio Message from Disbursement:
              </span>
              <ConsultationVoicePlayer
                storagePath={clarification.request_voice_path}
                duration={clarification.request_voice_duration}
                title={`Disbursement Query (${clarification.requested_by_name})`}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Head Response Note */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Head Response / Clarification Note
          </label>
          <textarea
            rows={3}
            value={responseNote}
            onChange={(e) => setResponseNote(e.target.value)}
            placeholder="e.g. Account details confirmed with supplier; payment can be released against invoice…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden"
          />
        </div>

        {/* Voice Recording */}
        <ActionVoiceField
          label="Audio Voice Message for Disbursement (Optional)"
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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md shadow-teal-200 transition-all disabled:opacity-60 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>Send back to Disbursement</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
