import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { CornerDownRight, AlertTriangle } from 'lucide-react';
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

  const consultations = request.consultations || [];
  const pendingConsultations = consultations.filter((c) => c.status === 'pending');
  const disagreedConsultations = consultations.filter((c) => c.status === 'disagreed');
  const isConsultationBlocked = pendingConsultations.length > 0 || disagreedConsultations.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isConsultationBlocked) return;
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
      description={`Request ${request.request_no || ''} · ${request.department?.name || 'Department'}${request.owner_head_name ? ` · Head: ${request.owner_head_name}` : ''}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isConsultationBlocked ? (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Inter-department consultation in progress:</span>
              <p className="mt-0.5">
                {pendingConsultations.length > 0 && disagreedConsultations.length > 0
                  ? 'Awaiting response from pending heads and received disagreement.'
                  : pendingConsultations.length > 0
                  ? `Waiting for review response from ${pendingConsultations.map((c) => c.head_name).join(', ')}.`
                  : `Disagreed by ${disagreedConsultations.map((c) => c.head_name).join(', ')}.`}
                {' '}Cannot forward to Admin until all consulted heads agree.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
            As Department Head, you are confirming that you have reviewed the request details, verified
            the invoices, and recommend it for final Admin sign-off.
          </div>
        )}

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
            disabled={isSubmitting || isConsultationBlocked}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
              isConsultationBlocked
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
            }`}
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Forward to Admin</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
