import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { FileUploader } from './FileUploader';
import { RequestFile, RequestRecord } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { formatFileSize, formatINRWhole } from '../../lib/formatters';
import { FileText, Mic, Trash2, Save, Loader2 } from 'lucide-react';

interface EditDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
}

/** Requester edits a draft / returned request: details, add documents, remove attachments. */
export const EditDraftModal: React.FC<EditDraftModalProps> = ({ isOpen, onClose, request }) => {
  const { updateDraft, addFiles, removeFile, threshold } = useRequests();
  const [title, setTitle] = useState(request.title);
  const [amountStr, setAmountStr] = useState(String(request.amount));
  const [notes, setNotes] = useState(request.notes || '');
  const [newFiles, setNewFiles] = useState<RequestFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const existing = request.files || [];

  const handleRemoveExisting = async (fileId: string) => {
    setError(null);
    setRemovingId(fileId);
    const res = await removeFile(request.id, fileId);
    setRemovingId(null);
    if (!res.success) setError(res.error || 'Could not remove file');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Please enter a title.');
    if (amount <= 0) return setError('Amount must be more than zero.');
    setBusy(true);
    try {
      const upd = await updateDraft(request.id, { title: title.trim(), amount, notes: notes.trim() || undefined });
      if (!upd.success) throw new Error(upd.error);
      if (newFiles.length) {
        const add = await addFiles(request.id, newFiles);
        if (!add.success) throw new Error(add.error);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Request" description="Correct the details or attachments, then submit again." maxWidth="lg">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="edit-title" className="text-xs font-bold text-slate-700 block mb-1">Title</label>
          <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
            className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden" />
        </div>
        <div>
          <label htmlFor="edit-amount" className="text-xs font-bold text-slate-700 block mb-1">Amount (₹)</label>
          <input id="edit-amount" type="number" min="1" step="0.01" inputMode="decimal" value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-bold" />
          {amount > threshold && (
            <p className="text-[11px] text-amber-700 mt-1">Above {formatINRWhole(threshold)}: this will need Admin approval (Route A).</p>
          )}
        </div>
        <div>
          <label htmlFor="edit-notes" className="text-xs font-bold text-slate-700 block mb-1">Purpose / Notes</label>
          <textarea id="edit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden" />
        </div>

        {existing.length > 0 && (
          <div>
            <span className="text-xs font-bold text-slate-700 block mb-1.5">Attached files</span>
            <ul className="space-y-1.5">
              {existing.map((f) => (
                <li key={f.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
                  {f.kind === 'voice_note' ? <Mic className="w-4 h-4 text-violet-500" /> : <FileText className="w-4 h-4 text-indigo-500" />}
                  <span className="flex-1 truncate font-medium text-slate-700">{f.original_name}</span>
                  <span className="text-[10px] text-slate-400">{formatFileSize(f.size_bytes)}</span>
                  <button type="button" onClick={() => handleRemoveExisting(f.id)} disabled={removingId === f.id}
                    className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50" aria-label={`Remove ${f.original_name}`}>
                    {removingId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="text-xs font-bold text-slate-700 block mb-1.5">Add documents</span>
          <FileUploader
            files={newFiles}
            onAddFiles={(f) => setNewFiles((p) => [...p, ...f])}
            onRemoveFile={(id) => setNewFiles((p) => p.filter((f) => f.id !== id))}
            disabled={busy}
          />
        </div>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>}

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{busy ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
