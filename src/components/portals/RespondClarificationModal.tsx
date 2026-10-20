import React, { useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, DisbursementClarification } from '../../types/database';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { ConsultationVoicePlayer } from '../requests/ConsultationVoicePlayer';
import { Loader2, MessageSquare, AlertCircle, CornerDownLeft, Paperclip, FileText, Image as ImageIcon, X } from 'lucide-react';
import { formatISTDate, formatFileSize } from '../../lib/formatters';

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

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
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !ALLOWED.includes(f.type));
    if (bad) return setError(`${bad.name}: only PDF, JPG or PNG files can be attached.`);
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) return setError(`${big.name} is larger than 20 MB.`);
    const next = [...files, ...picked];
    if (next.length > MAX_FILES) return setError(`You can attach at most ${MAX_FILES} files.`);
    setError(null);
    setFiles(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseNote.trim() && !voice && files.length === 0) {
      setError('Add a note, a voice message or a file for the Disbursement department.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await respondDisbursementClarification(
        clarification.id,
        responseNote.trim() || undefined,
        voice,
        request.id,
        files
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to submit clarification response');
      }
      setResponseNote('');
      setVoice(null);
      setFiles([]);
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

        {/* New documents for the approved request */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700">Attach New Files (Optional)</label>
            <span className="text-[10px] text-slate-400">PDF, JPG, PNG · max 20 MB · up to {MAX_FILES}</span>
          </div>
          <input
            ref={fileInputRef}
            id="clarification-files-input"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            id="clarification-add-files-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= MAX_FILES}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/40 text-teal-800 hover:bg-teal-50 hover:border-teal-300 font-semibold text-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Paperclip className="w-4 h-4" />
            <span>Add invoice, revised bill or supporting document</span>
          </button>
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs animate-in fade-in"
                >
                  {f.type === 'application/pdf' ? (
                    <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                  <span className="truncate flex-1 font-medium text-slate-800">{f.name}</span>
                  <span className="text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            Files are added to this approved request and shared with Disbursement. The signed approval documents are not changed.
          </p>
        </div>

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
