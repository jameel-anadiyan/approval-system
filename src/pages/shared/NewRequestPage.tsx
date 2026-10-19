import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestFile, RequestType, RequestDetails } from '../../types/database';
import { FileUploader } from '../../components/requests/FileUploader';
import { VoiceRecorder } from '../../components/requests/VoiceRecorder';
import {
  DiscountFields, ExhibitionFields, emptyDiscount, emptyExhibition, discountCalc, exhibitionCalc,
  validateDiscount, validateExhibition, toDiscountDetails, toExhibitionDetails,
  DiscountForm, ExhibitionForm,
} from '../../components/requests/TypedRequestFields';
import { formatINR, formatINRWhole, REQUEST_TYPES, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../lib/formatters';
import { ShieldAlert, Send, Save, ArrowLeft, Receipt, BadgePercent, Store, Ban } from 'lucide-react';

const TYPE_ICONS: Record<RequestType, React.ReactNode> = {
  general: <Receipt className="w-5 h-5" />,
  discount: <BadgePercent className="w-5 h-5" />,
  exhibition: <Store className="w-5 h-5" />,
};

export const NewRequestPage: React.FC = () => {
  const { user } = useAuth();
  const { createDraft, submitRequest, threshold } = useRequests();
  const navigate = useNavigate();

  const allowed = useMemo<RequestType[]>(
    () => REQUEST_TYPES.filter((t) => (user?.allowed_types ?? ['general']).includes(t)),
    [user?.allowed_types]
  );
  const [type, setType] = useState<RequestType>(allowed[0] ?? 'general');
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<DiscountForm>(emptyDiscount);
  const [exhibition, setExhibition] = useState<ExhibitionForm>(emptyExhibition);
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [voiceFile, setVoiceFile] = useState<RequestFile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generalAmount = parseFloat(amountStr) || 0;
  const amount =
    type === 'discount' ? discountCalc(discount).value : type === 'exhibition' ? exhibitionCalc(exhibition).total : generalAmount;
  const isHighValue = type === 'general' && amount > threshold;
  const docsRequired = type === 'general' || type === 'discount';
  const hasPdf = files.some((f) => f.mime_type === 'application/pdf');

  const allFiles = voiceFile ? [...files, voiceFile] : files;

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

  const effectiveTitle = () =>
    title.trim() || (type === 'exhibition' && exhibition.event_name.trim() ? `Exhibition: ${exhibition.event_name.trim()}` : '');

  const details = (): RequestDetails | null =>
    type === 'discount' ? toDiscountDetails(discount) : type === 'exhibition' ? toExhibitionDetails(exhibition) : null;

  const validate = (forDraft: boolean): string | null => {
    if (!effectiveTitle()) return type === 'exhibition' ? 'Enter the event name.' : 'Please enter a request title.';
    if (type === 'general') {
      if (!forDraft && generalAmount <= 0) return 'Please enter a valid amount greater than zero.';
      if (!forDraft && files.length === 0) return 'At least one document (invoice, bill, or receipt) must be attached to submit.';
      return null;
    }
    if (type === 'discount') {
      const v = validateDiscount(discount);
      if (v) return v;
      if (!forDraft && !hasPdf) return 'Attach the discount PDF (bill / estimate) to submit.';
      return null;
    }
    return validateExhibition(exhibition);
  };

  const save = async (andSubmit: boolean) => {
    setError(null);
    const v = validate(!andSubmit);
    if (v) {
      setError(v);
      return;
    }
    andSubmit ? setIsSubmitting(true) : setIsSavingDraft(true);
    try {
      const draftRes = await createDraft({
        type,
        title: effectiveTitle(),
        amount: type === 'general' ? generalAmount || 1 : amount,
        notes: notes.trim() || undefined,
        details: details(),
        files: allFiles,
      });
      if (!draftRes.success || !draftRes.id) {
        if (draftRes.id) {
          navigate(`/requests/${draftRes.id}`, {
            state: { notice: `Saved as a draft, but an attachment failed: ${draftRes.error}. Use Edit to attach it${andSubmit ? ', then Submit' : ''}.` },
          });
          return;
        }
        setError(draftRes.error || 'Failed to create request.');
        return;
      }
      if (!andSubmit) {
        navigate(`/requests/${draftRes.id}`);
        return;
      }
      const submitRes = await submitRequest(draftRes.id);
      navigate(`/requests/${draftRes.id}`, submitRes.success ? undefined : {
        state: { notice: `Saved as a draft but not submitted: ${submitRes.error}` },
      });
    } finally {
      setIsSubmitting(false);
      setIsSavingDraft(false);
    }
  };

  if (allowed.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <Ban className="w-10 h-10 text-slate-300 mx-auto" />
        <h1 className="text-lg font-bold text-slate-800 mt-3">No request types assigned</h1>
        <p className="text-sm text-slate-500 mt-1">Ask your Department Head or Admin to enable a request type for you.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-1 sm:px-4 py-4 sm:py-8 has-action-bar">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">Raise New Request</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          {user?.shop ? <>Shop: <span className="font-semibold text-slate-700">{user.shop.name}</span> · </> : null}
          Choose the request type, fill the form and submit for approval.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="space-y-6">
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {/* Request type */}
        <div className={`grid gap-3 ${allowed.length === 1 ? 'grid-cols-1' : allowed.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
          {allowed.map((t) => (
            <button
              key={t}
              type="button"
              id={`type-${t}`}
              onClick={() => { setType(t); setError(null); }}
              className={`text-left p-4 rounded-2xl border-2 transition-all ${
                type === t
                  ? 'border-indigo-600 bg-indigo-50 shadow-md shadow-indigo-100'
                  : 'border-slate-200 bg-white hover:border-indigo-200'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${type === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {TYPE_ICONS[t]}
              </div>
              <div className="font-bold text-sm text-slate-900 mt-2">{TYPE_LABELS[t]}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{TYPE_DESCRIPTIONS[t]}</div>
            </button>
          ))}
        </div>

        {/* Main details */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-800 font-display border-b border-slate-100 pb-2">
            {type === 'exhibition' ? 'Event Sponsorship & Promotion Form' : type === 'discount' ? 'Discount Details' : 'Request Information'}
          </h2>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {type === 'discount' ? 'Subject' : 'Request Title'} {type !== 'exhibition' && <span className="text-rose-500">*</span>}
            </label>
            <input
              id="request-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === 'discount' ? 'e.g. Discount for bridal set – Mrs. Fathima'
                  : type === 'exhibition' ? 'Optional – event name is used if empty'
                  : 'e.g. Vendor invoice for showroom lighting'
              }
              className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
            />
          </div>

          {type === 'general' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Amount in Indian Rupees (₹) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-3.5 font-bold text-slate-400 text-base">₹</span>
                <input
                  id="request-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-base sm:text-sm pl-8 pr-4 py-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-semibold transition-colors"
                />
              </div>
              {generalAmount > 0 && <span className="text-xs font-bold text-indigo-700 mt-1 block">{formatINR(generalAmount)}</span>}
            </div>
          )}

          {type === 'discount' && <DiscountFields value={discount} onChange={setDiscount} />}
          {type === 'exhibition' && <ExhibitionFields value={exhibition} onChange={setExhibition} />}

          {isHighValue && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">High Value — Admin Approval Required</span>
                <p className="mt-0.5 text-amber-800 leading-relaxed">
                  Amounts above {formatINRWhole(threshold)} must take Route A: reviewed by your Department Head and
                  signed off by the Administrator.
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {type === 'general' ? 'Notes & Purpose (Optional)' : 'Remarks (Optional)'}
            </label>
            <textarea
              id="request-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any extra context for the approvers…"
              className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
            />
          </div>
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-800 font-display">
              {type === 'exhibition' ? "Organiser's proposal / quotation" : type === 'discount' ? 'Discount PDF (bill / estimate)' : 'Document Attachments'}{' '}
              {docsRequired ? <span className="text-rose-500">*</span> : <span className="text-slate-400 font-normal text-xs">(optional)</span>}
            </h2>
            <span className="text-[11px] text-slate-400">{type === 'discount' ? 'PDF required' : 'PDF, JPG, PNG'}</span>
          </div>
          <FileUploader
            files={files}
            onAddFiles={(nf) => setFiles((p) => [...p, ...nf])}
            onRemoveFile={(id) => setFiles((p) => p.filter((f) => f.id !== id))}
          />
          {type === 'discount' && !hasPdf && (
            <p className="text-[11px] text-amber-700 font-semibold">A PDF is mandatory for discount approvals.</p>
          )}
          {type === 'exhibition' && (
            <p className="text-[11px] text-slate-500">
              The filled form is turned into a signed PDF automatically when approved.
            </p>
          )}
        </div>

        {/* Voice note */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-800 font-display border-b border-slate-100 pb-2">Spoken Explanation</h2>
          <VoiceRecorder onRecordingComplete={handleVoiceRecording} onClear={() => setVoiceFile(null)} />
        </div>

        {/* Sticky action bar */}
        <div className="action-bar">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="hidden sm:block text-xs text-slate-500">
              {TYPE_LABELS[type]} · <span className="font-bold text-slate-800">{formatINR(amount)}</span>
            </div>
            <div className="action-bar-buttons flex flex-1 sm:flex-none items-center gap-2 sm:gap-3">
              <button
                type="button"
                id="save-draft"
                onClick={() => save(false)}
                disabled={isSavingDraft || isSubmitting}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs sm:text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingDraft ? 'Saving…' : <><span className="sm:hidden">Draft</span><span className="hidden sm:inline">Save as Draft</span></>}</span>
              </button>
              <button
                type="submit"
                id="submit-request"
                disabled={isSubmitting || isSavingDraft}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all active:scale-98 disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmitting ? 'Submitting…' : 'Submit for Approval'}</span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
