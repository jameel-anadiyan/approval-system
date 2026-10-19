import React, { useState, useRef } from 'react';
import { Modal } from '../common/Modal';
import { FileUploader } from './FileUploader';
import { RequestFile, RequestRecord, RequestDetails } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { formatFileSize, formatINR, formatINRWhole, typeOf } from '../../lib/formatters';
import { FileText, Mic, Trash2, Save, Loader2 } from 'lucide-react';
import {
  DiscountFields, ExhibitionFields, discountFromDetails, exhibitionFromDetails, discountCalc, exhibitionCalc,
  validateDiscount, validateExhibition, toDiscountDetails, toExhibitionDetails,
} from './TypedRequestFields';

interface EditDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
}

/** Requester edits a draft / returned request: details, add documents, remove attachments. */
export const EditDraftModal: React.FC<EditDraftModalProps> = ({ isOpen, onClose, request }) => {
  const { updateDraft, addFiles, removeFile, threshold } = useRequests();
  const type = typeOf(request);
  const [title, setTitle] = useState(request.title);
  const [amountStr, setAmountStr] = useState(() => {
    const gBase = request.details?.base_amount;
    return gBase ? String(gBase) : String(request.amount);
  });
  const [hasGst, setHasGst] = useState<boolean>(() => Boolean(request.details?.has_gst));
  const [notes, setNotes] = useState(request.notes || '');
  const [discount, setDiscount] = useState(() => discountFromDetails(request.details));
  const [exhibition, setExhibition] = useState(() => exhibitionFromDetails(request.details));
  const [newFiles, setNewFiles] = useState<RequestFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveLockRef = useRef(false);

  const baseAmount = parseFloat(amountStr) || 0;
  const gstRate = 18;
  const gstAmount = hasGst ? Math.round(baseAmount * (gstRate / 100) * 100) / 100 : 0;
  const generalTotal = hasGst ? Math.round((baseAmount + gstAmount) * 100) / 100 : baseAmount;

  const amount =
    type === 'discount' ? discountCalc(discount).value : type === 'exhibition' ? exhibitionCalc(exhibition).total : generalTotal;
  const existing = request.files || [];

  const handleRemoveExisting = async (fileId: string) => {
    setError(null);
    setRemovingId(fileId);
    const res = await removeFile(request.id, fileId);
    setRemovingId(null);
    if (!res.success) setError(res.error || 'Could not remove file');
  };

  const getDetails = (): RequestDetails | null => {
    if (type === 'discount') return toDiscountDetails(discount);
    if (type === 'exhibition') return toExhibitionDetails(exhibition);
    return {
      base_amount: baseAmount,
      has_gst: hasGst,
      gst_rate: hasGst ? gstRate : 0,
      gst_amount: gstAmount,
      total_amount: generalTotal,
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveLockRef.current) return;
    setError(null);
    if (!title.trim()) return setError('Please enter a title.');
    if (baseAmount <= 0 && type === 'general') return setError('Amount must be more than zero.');
    const v = type === 'discount' ? validateDiscount(discount) : type === 'exhibition' ? validateExhibition(exhibition) : null;
    if (v) return setError(v);
    saveLockRef.current = true;
    setBusy(true);
    try {
      const upd = await updateDraft(request.id, {
        title: title.trim(),
        amount: type === 'general' ? generalTotal : amount,
        notes: notes.trim() || undefined,
        details: getDetails(),
      });
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
      saveLockRef.current = false;
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
        {type === 'general' && (
          <div className="space-y-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
            <div>
              <label htmlFor="edit-amount" className="text-xs font-bold text-slate-700 block mb-1">
                Amount (Excluding GST) in Rupees (₹) <span className="text-rose-500">*</span>
              </label>
              <input id="edit-amount" type="number" min="1" step="0.01" inputMode="decimal" value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full text-sm p-3 rounded-xl border border-slate-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-bold" />
              {baseAmount > 0 && <span className="text-xs text-slate-500 mt-1 block">Base amount: {formatINR(baseAmount)}</span>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Is GST applicable?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHasGst(false)}
                  className={`py-2 px-3 text-xs font-bold rounded-lg border transition-all ${
                    !hasGst
                      ? 'bg-white border-indigo-600 text-indigo-700 ring-1 ring-indigo-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  No GST (0%)
                </button>
                <button
                  type="button"
                  onClick={() => setHasGst(true)}
                  className={`py-2 px-3 text-xs font-bold rounded-lg border transition-all ${
                    hasGst
                      ? 'bg-indigo-50 border-indigo-600 text-indigo-700 ring-1 ring-indigo-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  Yes, Add 18% GST
                </button>
              </div>
            </div>

            {hasGst && baseAmount > 0 && (
              <div className="pt-2 border-t border-slate-200/80 space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Base (Excl. GST):</span>
                  <span className="font-mono">{formatINR(baseAmount)}</span>
                </div>
                <div className="flex justify-between text-indigo-700 font-medium">
                  <span>GST @ 18%:</span>
                  <span className="font-mono">+{formatINR(gstAmount)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-dashed border-slate-200 text-sm font-bold text-slate-900">
                  <span>Total (Incl. GST):</span>
                  <span className="font-mono text-indigo-600">{formatINR(generalTotal)}</span>
                </div>
              </div>
            )}
            {!hasGst && baseAmount > 0 && (
              <div className="pt-2 border-t border-slate-200/80 flex justify-between text-sm font-bold text-slate-900">
                <span className="text-xs">Total Amount:</span>
                <span className="font-mono text-indigo-600">{formatINR(generalTotal)}</span>
              </div>
            )}

            {generalTotal > threshold && (
              <p className="text-[11px] text-amber-700 mt-1 font-medium">Above {formatINRWhole(threshold)}: this will need Admin approval (Route A).</p>
            )}
          </div>
        )}
        {type === 'discount' && <DiscountFields value={discount} onChange={setDiscount} />}
        {type === 'exhibition' && <ExhibitionFields value={exhibition} onChange={setExhibition} />}
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
                  {!f.added_by && (
                    <button type="button" onClick={() => handleRemoveExisting(f.id)} disabled={removingId === f.id}
                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50" aria-label={`Remove ${f.original_name}`}>
                      {removingId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  )}
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
