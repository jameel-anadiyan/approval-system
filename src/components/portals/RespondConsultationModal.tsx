import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, HeadConsultation } from '../../types/database';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { ConsultationVoicePlayer } from '../requests/ConsultationVoicePlayer';
import { formatINR, formatISTDate } from '../../lib/formatters';
import {
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  Users,
} from 'lucide-react';

interface RespondConsultationModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  consultation: HeadConsultation;
  initialStatus?: 'agreed' | 'disagreed' | null;
  onSuccess?: () => void;
}

export const RespondConsultationModal: React.FC<RespondConsultationModalProps> = ({
  isOpen,
  onClose,
  request,
  consultation,
  initialStatus,
  onSuccess,
}) => {
  const { respondHeadConsultation } = useRequests();

  const isRevision = consultation.status !== 'pending';
  const [selectedStatus, setSelectedStatus] = useState<'agreed' | 'disagreed'>(
    initialStatus || (consultation.status !== 'pending' ? consultation.status : 'agreed')
  );
  const [remarks, setRemarks] = useState(consultation.response_remarks || '');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStatus) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await respondHeadConsultation(
        consultation.id,
        selectedStatus,
        remarks.trim() || undefined,
        voice,
        request.id
      );

      if (!res.success) {
        throw new Error(res.error || 'Failed to submit response');
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isRevision
          ? `Revise Consultation: ${selectedStatus.toUpperCase()}`
          : 'Submit Inter-Department Decision'
      }
      description={`Request ${request.request_no || ''} · ${request.department?.name || 'Department'}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Request Quick Summary */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 truncate">{request.title}</span>
            <span className="font-extrabold text-slate-900 font-display shrink-0 ml-2">
              {formatINR(request.amount)}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 flex items-center justify-between">
            <span>Requester: <strong>{request.requester_name}</strong></span>
            <span>Requested by: <strong>{consultation.requested_by_name}</strong></span>
          </div>

          {consultation.request_note && (
            <div className="pt-2 border-t border-slate-200/80 text-[11px] text-purple-950 flex items-start gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-700">Forwarder's Note:</span>
                <p className="italic text-slate-600">"{consultation.request_note}"</p>
              </div>
            </div>
          )}

          {consultation.request_voice_path && (
            <div className="pt-2 border-t border-slate-200/80">
              <span className="text-[11px] font-bold text-slate-700 block mb-1">
                Audio Note from {consultation.requested_by_name}:
              </span>
              <ConsultationVoicePlayer
                storagePath={consultation.request_voice_path}
                duration={consultation.request_voice_duration}
                title={`Audio Note from ${consultation.requested_by_name}`}
              />
            </div>
          )}
        </div>

        {/* Existing Decision Notice (when revising) */}
        {isRevision && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              consultation.status === 'agreed'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {consultation.status === 'agreed' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <span className="font-bold">
                You previously responded: {consultation.status.toUpperCase()}
              </span>
              {consultation.responded_at && (
                <span className="text-[10px] opacity-75 ml-1">
                  ({formatISTDate(consultation.responded_at)})
                </span>
              )}
              {consultation.response_remarks && (
                <p className="text-[11px] opacity-90 truncate mt-0.5 italic">
                  "{consultation.response_remarks}"
                </p>
              )}
            </div>
          </div>
        )}

        {/* Decision Toggle: Agree vs Disagree */}
        <div>
          <label className="text-xs font-bold text-slate-800 block mb-2">
            Select Your Decision <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedStatus('agreed')}
              className={`p-3.5 rounded-xl border-2 flex items-center justify-center gap-2.5 font-bold text-xs transition-all cursor-pointer ${
                selectedStatus === 'agreed'
                  ? 'border-emerald-500 bg-emerald-50/80 text-emerald-800 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <ThumbsUp
                className={`w-4 h-4 ${
                  selectedStatus === 'agreed' ? 'text-emerald-600' : 'text-slate-400'
                }`}
              />
              <span>Agree</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedStatus('disagreed')}
              className={`p-3.5 rounded-xl border-2 flex items-center justify-center gap-2.5 font-bold text-xs transition-all cursor-pointer ${
                selectedStatus === 'disagreed'
                  ? 'border-rose-500 bg-rose-50/80 text-rose-800 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <ThumbsDown
                className={`w-4 h-4 ${
                  selectedStatus === 'disagreed' ? 'text-rose-600' : 'text-slate-400'
                }`}
              />
              <span>Disagree</span>
            </button>
          </div>
        </div>

        {/* Remarks Input */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Remarks or Feedback {selectedStatus === 'disagreed' ? '(Recommended)' : '(Optional)'}
          </label>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              selectedStatus === 'disagreed'
                ? 'State the reason or condition for disagreeing (e.g. Budget discrepancy, scope mismatch)...'
                : 'Add any supporting remarks or advice for the owning department head...'
            }
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-hidden"
          />
        </div>

        {/* Optional Voice Response */}
        <div>
          <ActionVoiceField
            onChange={setVoice}
            label={`Voice response with your ${selectedStatus} decision (optional)`}
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            {error}
          </div>
        )}

        {/* Actions */}
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
            disabled={submitting}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all disabled:opacity-50 cursor-pointer ${
              selectedStatus === 'agreed'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'
                : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
            }`}
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isRevision ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : selectedStatus === 'agreed' ? (
              <ThumbsUp className="w-3.5 h-3.5" />
            ) : (
              <ThumbsDown className="w-3.5 h-3.5" />
            )}
            <span>
              {isRevision
                ? `Update Decision to ${selectedStatus.toUpperCase()}`
                : `Submit ${selectedStatus.toUpperCase()}`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
