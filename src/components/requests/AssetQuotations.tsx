// Asset buying: asset fields, the quotation editor used by the requester (New Request / Edit Draft)
// and the quotation panel on the request page where the Head (or Admin) selects the best quote.
import React, { useMemo, useRef, useState } from 'react';
import {
  Award, CheckCircle2, ExternalLink, FileText, Image as ImageIcon, Loader2, Plus, Star, Trash2, TrendingDown,
  UploadCloud, XCircle, Eye,
} from 'lucide-react';
import { RequestDetails, RequestFile, RequestRecord } from '../../types/database';
import { formatINR, formatINRWhole, formatISTDate } from '../../lib/formatters';
import { useSignedUrl } from '../../lib/files';
import { useAuth } from '../../context/AuthContext';
import { DocumentPreviewModal, DocumentPreviewItem } from './DocumentPreviewModal';

export const MIN_QUOTES = 2;
export const MAX_QUOTES = 10;

const inputCls =
  'w-full text-base sm:text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors bg-white';
const labelCls = 'block text-xs font-bold text-slate-700 mb-1';

// ── Asset details ─────────────────────────────────────────────────────────────────────────────

export interface AssetForm {
  asset_name: string;
  quantity: string;
  specification: string;
  purpose: string;
}

export const emptyAsset: AssetForm = { asset_name: '', quantity: '', specification: '', purpose: '' };

export const assetFromDetails = (d?: RequestDetails | null): AssetForm => ({
  asset_name: d?.asset_name ?? '',
  quantity: d?.quantity ?? '',
  specification: d?.specification ?? '',
  purpose: d?.purpose ?? '',
});

export const toAssetDetails = (f: AssetForm): RequestDetails => ({
  asset_name: f.asset_name.trim(),
  quantity: f.quantity.trim() || null,
  specification: f.specification.trim() || null,
  purpose: f.purpose.trim() || null,
});

export const AssetFields: React.FC<{ value: AssetForm; onChange: (v: AssetForm) => void }> = ({ value, onChange }) => {
  const set = (k: keyof AssetForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3.5 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>Asset to buy <span className="text-rose-500">*</span></label>
          <input id="asset-name" className={inputCls} value={value.asset_name} onChange={set('asset_name')}
            placeholder="e.g. Billing laptop, CCTV system, Display counter" maxLength={200} />
        </div>
        <div>
          <label className={labelCls}>Quantity</label>
          <input id="asset-qty" className={inputCls} value={value.quantity} onChange={set('quantity')} placeholder="e.g. 2 nos" maxLength={50} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Specification</label>
        <textarea id="asset-spec" rows={2} className={inputCls} value={value.specification} onChange={set('specification')}
          placeholder="Model, size, configuration, warranty…" maxLength={1000} />
      </div>
      <div>
        <label className={labelCls}>Purpose / why it is needed</label>
        <textarea id="asset-purpose" rows={2} className={inputCls} value={value.purpose} onChange={set('purpose')}
          placeholder="Where it will be used and why" maxLength={1000} />
      </div>
    </div>
  );
};

// ── Quotation editor (requester) ────────────────────────────────────────────────────────────

export interface QuoteRow {
  key: string;
  vendor: string;
  amount: string;
  preferred: boolean;
  /** Newly picked file (not uploaded yet) */
  file: RequestFile | null;
  /** Already uploaded quotation document (edit draft) */
  existing?: RequestFile | null;
}

const newKey = () => `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const blankQuote = (): QuoteRow => ({ key: newKey(), vendor: '', amount: '', preferred: false, file: null });
export const initialQuotes = (min: number = MIN_QUOTES): QuoteRow[] => Array.from({ length: min }, blankQuote);

export const quotesFromFiles = (files: RequestFile[] = [], min: number = MIN_QUOTES): QuoteRow[] => {
  const rows: QuoteRow[] = files
    .filter((f) => f.kind === 'document' && !f.added_by && !f.clarification_id)
    .map((f) => ({
      key: f.id,
      vendor: f.quote_vendor ?? '',
      amount: f.quote_amount ? String(f.quote_amount) : '',
      preferred: !!f.quote_preferred,
      file: null,
      existing: f,
    }));
  while (rows.length < min) rows.push(blankQuote());
  return rows;
};

const amt = (s: string) => {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const rowHasDoc = (r: QuoteRow) => !!(r.file || r.existing);
export const isCompleteQuote = (r: QuoteRow) => rowHasDoc(r) && r.vendor.trim() !== '' && amt(r.amount) > 0;

/** Request amount before the Head selects: requester's preferred quote, else the lowest. */
export function quoteSummary(rows: QuoteRow[]) {
  const complete = rows.filter(isCompleteQuote);
  const amounts = complete.map((r) => amt(r.amount));
  const lowest = amounts.length ? Math.min(...amounts) : 0;
  const pref = complete.find((r) => r.preferred);
  return { complete: complete.length, lowest, amount: pref ? amt(pref.amount) : lowest };
}

export function validateQuotes(
  rows: QuoteRow[],
  forDraft: boolean,
  minQuotes: number = MIN_QUOTES,
  maxAmount?: number
): string | null {
  for (const [i, r] of rows.entries()) {
    const touched = rowHasDoc(r) || r.vendor.trim() || r.amount.trim();
    if (!touched) continue;
    if (!rowHasDoc(r)) return `Bill / Quote ${i + 1}: attach the document.`;
    if (!r.vendor.trim()) return `Bill / Quote ${i + 1}: enter the vendor / supplier name.`;
    if (amt(r.amount) <= 0) return `Bill / Quote ${i + 1}: enter the quoted amount.`;
  }
  const n = rows.filter(isCompleteQuote).length;
  if (!forDraft && n < minQuotes) {
    return `Attach at least ${minQuotes} ${minQuotes === 1 ? 'bill or quotation' : 'bills or quotations'} with vendor and amount (${n} so far).`;
  }
  if (maxAmount) {
    const summary = quoteSummary(rows);
    if (summary.amount > maxAmount) {
      return `Amount cannot exceed ₹${maxAmount.toLocaleString('en-IN')} for Asset Buying Below 20k. (Current: ₹${summary.amount.toLocaleString('en-IN')})`;
    }
  }
  return null;
}

/** New quotation files to upload, carrying the typed vendor / amount / preference. */
export const newQuoteFiles = (rows: QuoteRow[]): RequestFile[] =>
  rows
    .filter((r) => r.file && !r.existing)
    .map((r) => ({
      ...(r.file as RequestFile),
      quote_vendor: r.vendor.trim() || null,
      quote_amount: amt(r.amount) > 0 ? amt(r.amount) : null,
      quote_preferred: r.preferred,
    }));

const pickFile = (file: File): RequestFile | null => {
  if (file.size > 15 * 1024 * 1024) { alert(`${file.name} is too large. Maximum size is 15 MB.`); return null; }
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
    alert('Quotations and bills must be PDF, JPG or PNG.');
    return null;
  }
  return {
    id: `file-temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    request_id: 'draft', kind: 'document', storage_path: `uploads/${file.name}`, original_name: file.name,
    mime_type: file.type, size_bytes: file.size, page_count: 1, duration_sec: null, sha256: null,
    created_at: new Date().toISOString(), public_url: URL.createObjectURL(file), blob: file,
  };
};

export const QuotationsEditor: React.FC<{
  rows: QuoteRow[];
  onChange: (rows: QuoteRow[]) => void;
  /** Called when an already-uploaded quote row is removed (edit draft) */
  onRemoveExisting?: (file: RequestFile) => void;
  disabled?: boolean;
  minQuotes?: number;
  maxAmount?: number;
}> = ({ rows, onChange, onRemoveExisting, disabled, minQuotes = MIN_QUOTES, maxAmount }) => {
  const [previewDoc, setPreviewDoc] = useState<DocumentPreviewItem | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const { complete, lowest, amount } = quoteSummary(rows);

  const update = (key: string, patch: Partial<QuoteRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : patch.preferred ? { ...r, preferred: false } : r)));

  const remove = (r: QuoteRow) => {
    if (r.existing && onRemoveExisting) onRemoveExisting(r.existing);
    const next = rows.filter((x) => x.key !== r.key);
    while (next.length < minQuotes) next.push(blankQuote());
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-teal-50 border border-teal-200 text-[11px] text-teal-900 leading-relaxed">
        <Award className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
        <span>
          Attach <b>at least {minQuotes} {minQuotes === 1 ? 'bill or quotation' : 'bills or quotations'}</b> and type the vendor and amount shown on each document.
          {minQuotes > 1 ? (
            <> You may mark the one you prefer — your Head sees it, but the <b>Head selects the final quotation</b>.</>
          ) : (
            <> Type the vendor and amount — your Head reviews and approves.</>
          )}
        </span>
      </div>

      {rows.map((r, i) => {
        const doc = r.existing ?? r.file;
        const isLowest = isCompleteQuote(r) && amt(r.amount) === lowest && complete > 1;
        const isPdf = doc?.mime_type.includes('pdf');
        return (
          <div key={r.key} className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 transition-colors ${
            r.preferred ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center justify-center">Q{i + 1}</span>
                {isLowest && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    <TrendingDown className="w-3 h-3" /> Lowest
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {minQuotes > 1 && (
                  <button type="button" disabled={disabled} id={`quote-pref-${i}`}
                    onClick={() => update(r.key, { preferred: !r.preferred })}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                      r.preferred ? 'bg-amber-400 border-amber-400 text-white' : 'border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-700'}`}
                    title="Mark as my preferred quotation">
                    <Star className={`w-3.5 h-3.5 ${r.preferred ? 'fill-white' : ''}`} /> My preferred
                  </button>
                )}
                {(rows.length > minQuotes || doc || r.vendor || r.amount) && (
                  <button type="button" disabled={disabled} onClick={() => remove(r)} title="Remove item"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-2.5">
              <input className={inputCls} placeholder="Vendor / supplier name" value={r.vendor} maxLength={150}
                id={`quote-vendor-${i}`} disabled={disabled} onChange={(e) => update(r.key, { vendor: e.target.value })} />
              <div className="relative">
                <span className="absolute left-3 top-3 font-bold text-slate-400">₹</span>
                <input className={`${inputCls} pl-7 font-semibold`} type="number" step="0.01" min="1" inputMode="decimal"
                  placeholder="Quoted amount" value={r.amount} id={`quote-amount-${i}`} disabled={disabled}
                  onChange={(e) => update(r.key, { amount: e.target.value })} />
              </div>
            </div>

            <input ref={(el) => { inputs.current[r.key] = el; }} type="file" className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const picked = pickFile(f);
                if (picked) update(r.key, { file: picked });
              }} />
            {doc ? (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  {isPdf ? <FileText className="w-4 h-4 text-rose-500 shrink-0" /> : <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />}
                  <span className="text-xs font-semibold text-slate-700 truncate">{doc.original_name}</span>
                  {r.existing && <span className="text-[10px] text-slate-400 shrink-0">uploaded</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewDoc({
                        id: doc.id,
                        name: doc.original_name,
                        publicUrl: doc.public_url,
                        storagePath: doc.storage_path,
                        mimeType: doc.mime_type,
                        sizeBytes: doc.size_bytes,
                        badge: 'Quotation Bill',
                      })
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>
                  {r.existing && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => remove(r)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                      title="Delete this quotation file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                  {!r.existing && (
                    <button type="button" disabled={disabled} onClick={() => inputs.current[r.key]?.click()}
                      className="text-[11px] font-bold text-slate-500 hover:text-slate-800">Change</button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" disabled={disabled} id={`quote-file-${i}`} onClick={() => inputs.current[r.key]?.click()}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50 text-xs font-bold text-indigo-700 transition-colors">
                <UploadCloud className="w-4 h-4" /> Attach bill or quote (PDF / photo)
              </button>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {rows.length < MAX_QUOTES && (
          <button type="button" disabled={disabled} id="add-quote" onClick={() => onChange([...rows, blankQuote()])}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Plus className="w-4 h-4" /> Add another bill or quote
          </button>
        )}
        <div className="text-[11px] text-slate-500">
          {complete}/{minQuotes} min. complete
          {amount > 0 && <> · Request amount <b className="text-slate-800">{formatINR(amount)}</b></>}
          {maxAmount && amount > maxAmount && (
            <span className="text-rose-600 font-bold ml-1">· Exceeds max limit of ₹{maxAmount.toLocaleString('en-IN')}</span>
          )}
        </div>
      </div>

      <DocumentPreviewModal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        files={previewDoc ? [previewDoc] : []}
        title="Quotation Document Preview"
        onDeleteFile={previewDoc?.id ? async (item) => {
          const target = rows.find((r) => r.existing?.id === item.id || r.file?.id === item.id);
          if (target) {
            remove(target);
          }
        } : undefined}
      />
    </div>
  );
};

// ── Quotation panel (request page) ──────────────────────────────────────────────────────────

export const quoteFiles = (r: Pick<RequestRecord, 'files'>): RequestFile[] =>
  (r.files ?? []).filter((f) => f.kind === 'document' && f.quote_amount !== null && f.quote_amount !== undefined);

const QuoteLink: React.FC<{ file: RequestFile; onPreview?: () => void }> = ({ file, onPreview }) => {
  const { isBackendConnected } = useAuth();
  const signed = useSignedUrl('request-files', file.storage_path, isBackendConnected);
  const url = isBackendConnected ? signed.url : file.public_url;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition-colors cursor-pointer"
          title={`Preview ${file.original_name}`}
        >
          <Eye className="w-3 h-3" />
          <span>Preview Bill</span>
        </button>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-indigo-800 max-w-[140px] truncate">
          <ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{file.original_name}</span>
        </a>
      )}
    </div>
  );
};

export const QuotationsPanel: React.FC<{
  request: RequestRecord;
  /** Head (or Admin) may pick a quote right now */
  canSelect: boolean;
  selectorRole: 'head' | 'admin' | null;
  threshold: number;
  onSelect: (fileId: string, remarks: string) => Promise<{ success: boolean; error?: string }>;
}> = ({ request, canSelect, selectorRole, threshold, onSelect }) => {
  const quotes = useMemo(() => quoteFiles(request), [request]);
  const [choice, setChoice] = useState<string | null>(request.selected_quote_id ?? (quotes.length === 1 ? quotes[0].id : null));
  const [previewDocIndex, setPreviewDocIndex] = useState<number | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!quotes.length) return null;
  const lowest = Math.min(...quotes.map((q) => Number(q.quote_amount)));
  const chosen = quotes.find((q) => q.id === choice);
  const decided = !!request.selected_quote_id;
  const changed = choice && (choice !== request.selected_quote_id || !request.selected_quote_id);

  const confirm = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    const res = await onSelect(choice, remarks);
    setBusy(false);
    if (!res.success) setError(res.error || 'Could not select the quotation');
    else setRemarks('');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
          <Award className="w-4 h-4 text-teal-600" /> Bills / Quotations ({quotes.length})
        </h3>
        {decided ? (
          <span className="text-[11px] text-slate-500">
            Selected by <b className="text-slate-700">{request.quote_selected_by_name}</b>
            {request.quote_selected_at ? ` · ${formatISTDate(request.quote_selected_at)}` : ''}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-amber-700">Awaiting Head's selection</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {quotes.map((q, i) => {
          const isSel = request.selected_quote_id === q.id;
          const isRej = decided && !isSel;
          const picked = canSelect && choice === q.id;
          return (
            <div key={q.id} role={canSelect ? 'button' : undefined} tabIndex={canSelect ? 0 : undefined} id={`select-quote-${i}`}
              onClick={() => canSelect && setChoice(q.id)}
              onKeyDown={(e) => { if (canSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setChoice(q.id); } }}
              className={`text-left rounded-2xl border-2 p-3.5 transition-all ${
                picked ? 'border-teal-500 bg-teal-50/60 shadow-md shadow-teal-100'
                  : isSel ? 'border-emerald-400 bg-emerald-50/50'
                  : isRej ? 'border-slate-200 bg-slate-50/70 opacity-80'
                  : 'border-slate-200 bg-white'} ${canSelect ? 'hover:border-teal-300 cursor-pointer' : 'cursor-default'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-400">Q{i + 1}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {q.quote_preferred && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> Requester's choice
                    </span>
                  )}
                  {Number(q.quote_amount) === lowest && quotes.length > 1 && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                      <TrendingDown className="w-3 h-3" /> Lowest
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 font-bold text-sm text-slate-900 truncate">{q.quote_vendor || 'Vendor'}</div>
              <div className="text-lg font-extrabold font-display text-slate-900">{formatINR(Number(q.quote_amount))}</div>
              <div className="mt-1.5" onClick={(e) => e.stopPropagation()}><QuoteLink file={q} onPreview={() => setPreviewDocIndex(i)} /></div>
              {(isSel || isRej) && (
                <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wide ${
                  isSel ? 'bg-emerald-600 text-white' : 'bg-rose-100 text-rose-700'}`}>
                  {isSel ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {isSel ? 'SELECTED' : 'REJECTED'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canSelect && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-2.5">
          <p className="text-xs text-teal-900 leading-relaxed">
            {selectorRole === 'admin'
              ? 'Pick the best quotation, then approve. The selected quotation is stamped APPROVED and the others REJECTED.'
              : <>Pick the best quotation. Up to <b>{formatINRWhole(threshold)}</b> you approve it yourself; above that it goes to Admin for approval.</>}
          </p>
          {chosen && selectorRole === 'head' && (
            <p className={`text-[11px] font-bold ${Number(chosen.quote_amount) > threshold ? 'text-indigo-700' : 'text-emerald-700'}`}>
              {chosen.quote_vendor} · {formatINR(Number(chosen.quote_amount))} →{' '}
              {Number(chosen.quote_amount) > threshold ? 'will be sent to Admin for approval (Route A)' : 'you can approve it (Route B)'}
            </p>
          )}
          <input className={inputCls} placeholder="Reason for selection (optional)" value={remarks}
            onChange={(e) => setRemarks(e.target.value)} maxLength={500} id="quote-remarks" />
          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
          <button type="button" id="confirm-quote" disabled={!changed || busy} onClick={confirm}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-md shadow-teal-100 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {decided ? 'Change selection' : quotes.length === 1 ? 'Confirm quotation' : 'Confirm selected quotation'}
          </button>
        </div>
      )}

      {/* Quotation Bills Full Modal Preview */}
      <DocumentPreviewModal
        isOpen={previewDocIndex !== null}
        onClose={() => setPreviewDocIndex(null)}
        files={quotes.map((q) => ({
          id: q.id,
          name: q.original_name,
          storagePath: q.storage_path,
          publicUrl: q.public_url,
          bucket: 'request-files',
          mimeType: q.mime_type,
          sizeBytes: q.size_bytes,
          badge: q.quote_vendor ? `${q.quote_vendor} · ${formatINR(Number(q.quote_amount))}` : 'Quotation Bill',
        }))}
        initialIndex={previewDocIndex ?? 0}
        title="Quotation Bill Preview"
      />
    </div>
  );
};
