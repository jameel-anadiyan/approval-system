import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { Send } from 'lucide-react';
import type { ActionVoice } from '../../context/RequestContext';
import { ActionVoiceField } from '../requests/ActionVoiceField';

interface RegionalForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onForward: (remarks?: string, voice?: ActionVoice | null) => Promise<void>;
}

/** Regional Head checks an employee's request and passes it to the clerk (no approval). */
export const RegionalForwardModal: React.FC<RegionalForwardModalProps> = ({ isOpen, onClose, request, onForward }) => {
  const [remarks, setRemarks] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRecording) {
      setError('Please stop your voice recording first before forwarding.');
      return;
    }
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
      title="Forward to Clerk"
      description={`Request ${request.request_no || ''} · ${request.requester_name}${request.shop_name ? ` · ${request.shop_name}` : ''}${
        request.category_name ? ` · ${request.category_name}` : ''
      }`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl text-xs text-cyan-900 leading-relaxed">
          You have checked this request and are passing it to the{' '}
          {request.category_name ? <strong>{request.category_name}</strong> : 'department'} clerk for routing. This is not an
          approval — the Department Head or Admin approves it later.
        </div>

        <div>
          <label htmlFor="regional-remarks" className="text-xs font-bold text-slate-700 block mb-1">
            Remarks for the clerk (optional)
          </label>
          <textarea
            id="regional-remarks"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Checked the bills with the shop manager."
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-hidden"
          />
        </div>

        <ActionVoiceField
          onChange={setVoice}
          onRecordingStateChange={setIsRecording}
          label="Voice message for the clerk (optional)"
        />

        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>}

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
            id="regional-forward-confirm"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Forwarding…' : 'Forward to Clerk'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
