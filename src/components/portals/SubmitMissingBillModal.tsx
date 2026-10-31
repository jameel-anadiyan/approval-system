import React, { useState, useRef } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { formatFileSize } from '../../lib/formatters';
import { AlertCircle, UploadCloud, FileText, CheckCircle2, Loader2, X } from 'lucide-react';

interface SubmitMissingBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord | null;
  onSuccess?: () => void;
}

export const SubmitMissingBillModal: React.FC<SubmitMissingBillModalProps> = ({
  isOpen,
  onClose,
  request,
  onSuccess,
}) => {
  const { submitMissingBill } = useRequests();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !request) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const valid =
        ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
        file.name.toLowerCase().match(/\.(pdf|jpe?g|png)$/i);
      if (!valid) {
        setError('Only PDF, JPG, or PNG files are supported.');
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError('File size must be under 25 MB.');
        return;
      }
      setError(null);
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please choose a file to attach as the original bill.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await submitMissingBill(request.id, selectedFile, note);
      if (!res.success) {
        throw new Error(res.error || 'Failed to submit bill');
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
      title="Attach &amp; Submit Original Bill"
      description={`Request #${request.approval_no || request.request_no} · ${request.title}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Note from Entry Officer */}
        {request.bill_missing_note && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs space-y-1">
            <div className="flex items-center justify-between text-rose-900 font-bold">
              <span>Note from Entry Officer ({request.bill_missing_by_name || 'Disbursement'}):</span>
            </div>
            <p className="text-rose-800 leading-relaxed">{request.bill_missing_note}</p>
          </div>
        )}

        {/* Drop / Pick Zone */}
        {!selectedFile ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-rose-200 hover:border-rose-400 bg-rose-50/40 hover:bg-rose-50/70 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/png,image/jpeg"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="w-10 h-10 rounded-xl bg-white text-rose-600 border border-rose-100 flex items-center justify-center mx-auto shadow-xs">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div className="text-xs text-slate-700">
              <span className="font-bold text-rose-700">Click to choose file</span> or drag and drop
            </div>
            <p className="text-[11px] text-slate-400">Attach original tax invoice / stamped bill (PDF, JPG, PNG up to 25MB)</p>
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="font-bold text-slate-900 truncate block">{selectedFile.name}</span>
                <span className="text-[10px] text-slate-500 font-mono">{formatFileSize(selectedFile.size)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors"
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Optional note */}
        <div>
          <label htmlFor="submit-bill-note" className="text-xs font-bold text-slate-700 block mb-1">
            Optional Note / Remarks
          </label>
          <input
            id="submit-bill-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Attached original signed and stamped GST tax invoice copy"
            className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white"
          />
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
            disabled={submitting || !selectedFile}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{submitting ? 'Submitting…' : 'Submit Bill to Entry Team'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
