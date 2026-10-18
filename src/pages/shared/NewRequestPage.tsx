import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestFile } from '../../types/database';
import { FileUploader } from '../../components/requests/FileUploader';
import { VoiceRecorder } from '../../components/requests/VoiceRecorder';
import { formatINR } from '../../lib/formatters';
import { ShieldAlert, Send, Save, ArrowLeft, CheckCircle2 } from 'lucide-react';

export const NewRequestPage: React.FC = () => {
  const { user } = useAuth();
  const { createDraft, submitRequest } = useRequests();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [voiceFile, setVoiceFile] = useState<RequestFile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const isHighValue = amount > 10000;

  const allFiles = voiceFile ? [...files, voiceFile] : files;

  const handleAddFiles = (newFiles: RequestFile[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleVoiceRecording = (recorded: { name: string; blob: Blob; duration: number }) => {
    const tempUrl = URL.createObjectURL(recorded.blob);
    setVoiceFile({
      id: `voice-${Date.now()}`,
      request_id: 'draft',
      kind: 'voice_note',
      storage_path: `voice/${recorded.name}`,
      original_name: recorded.name,
      mime_type: recorded.blob.type,
      size_bytes: recorded.blob.size,
      page_count: null,
      duration_sec: recorded.duration,
      sha256: null,
      created_at: new Date().toISOString(),
      public_url: tempUrl,
      blob: recorded.blob,
    });
  };

  const handleSaveDraft = async () => {
    if (!title.trim()) {
      setError('Please provide a title for the draft.');
      return;
    }
    setError(null);
    setIsSavingDraft(true);

    try {
      const res = await createDraft({
        title: title.trim(),
        amount: amount || 1,
        notes: notes.trim() || undefined,
        files: allFiles,
      });

      if (res.success && res.id) {
        navigate(`/requests/${res.id}`);
      } else {
        setError(res.error || 'Failed to save draft.');
      }
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter a request title.');
      return;
    }

    if (amount <= 0) {
      setError('Please enter a valid amount greater than zero.');
      return;
    }

    if (files.length === 0) {
      setError('At least one document (invoice, bill, or receipt) must be attached to submit.');
      return;
    }

    setIsSubmitting(true);
    try {
      const draftRes = await createDraft({
        title: title.trim(),
        amount,
        notes: notes.trim() || undefined,
        files: allFiles,
      });

      if (!draftRes.success || !draftRes.id) {
        setError(draftRes.error || 'Failed to create request.');
        setIsSubmitting(false);
        return;
      }

      const submitRes = await submitRequest(draftRes.id);
      if (submitRes.success) {
        navigate(`/requests/${draftRes.id}`);
      } else {
        setError(submitRes.error || 'Failed to submit request.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 pb-32">
      {/* Top Breadcrumb */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
          Raise New Money Request
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Submit invoice vouchers for approval, digital signing, and treasury disbursement.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {/* Card 1: Main Details */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-800 font-display border-b border-slate-100 pb-2">
            Request Information
          </h2>

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Request Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Statutory GST Audit Filing or Vendor Invoice"
              className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
            />
          </div>

          {/* Amount in ₹ */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Amount in Indian Rupees (₹) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-3.5 font-bold text-slate-400 text-base">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="1"
                inputMode="decimal"
                required
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full text-base sm:text-sm pl-8 pr-4 py-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-semibold transition-colors"
              />
            </div>
            {amount > 0 && (
              <span className="text-xs font-bold text-indigo-700 mt-1 block">
                {formatINR(amount)}
              </span>
            )}
          </div>

          {/* High Value Policy Alert */}
          {isHighValue && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">High Value — Admin Approval Required</span>
                <p className="mt-0.5 text-amber-800 leading-relaxed">
                  Amounts above ₹10,000 must take Route A: they will be reviewed by your Department Head
                  and signed off by the Administrator with their official seal.
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Notes & Purpose (Optional)
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide context, vendor background, or budget line details…"
              className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
            />
          </div>
        </div>

        {/* Card 2: Document Attachments */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-800 font-display">
              Document Attachments <span className="text-rose-500">*</span>
            </h2>
            <span className="text-[11px] text-slate-400">PDF, JPG, PNG</span>
          </div>

          <FileUploader
            files={files}
            onAddFiles={handleAddFiles}
            onRemoveFile={handleRemoveFile}
          />
        </div>

        {/* Card 3: Voice Note */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-800 font-display border-b border-slate-100 pb-2">
            Spoken Explanation
          </h2>

          <VoiceRecorder
            onRecordingComplete={handleVoiceRecording}
            onClear={() => setVoiceFile(null)}
          />
        </div>

        {/* Sticky Mobile/Desktop Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSavingDraft || isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs sm:text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingDraft ? 'Saving…' : 'Save as Draft'}</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting || isSavingDraft}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 transition-all active:scale-98 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{isSubmitting ? 'Submitting…' : 'Submit for Routing'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
