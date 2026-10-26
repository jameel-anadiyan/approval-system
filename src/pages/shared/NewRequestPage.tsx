import React, { useMemo, useState, useRef } from 'react';
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
import { GstSelector } from '../../components/requests/GstSelector';
import {
  AssetFields, AssetForm, emptyAsset, toAssetDetails, QuotationsEditor, QuoteRow, initialQuotes,
  quoteSummary, validateQuotes, newQuoteFiles,
} from '../../components/requests/AssetQuotations';
import {
  StockTransferFields, StockTransferForm, emptyStockTransfer,
  toStockTransferDetails, validateStockTransfer, stockTransferCalc,
} from '../../components/requests/StockTransferFields';
import { formatINR, formatINRWhole, REQUEST_TYPES, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../lib/formatters';
import { ShieldAlert, Send, Save, ArrowLeft, Receipt, BadgePercent, Store, Ban, Package, UserCheck, FileCheck, CalendarDays, ArrowLeftRight } from 'lucide-react';
import { WorkCategoryField, useCategoryOptions } from '../../components/requests/WorkCategoryField';
import { TargetHeadField } from '../../components/requests/TargetHeadField';
import { checkExhibitionQuota } from '../../lib/exhibitionQuota';
import { useDirectory } from '../../lib/directory';

const TYPE_ICONS: Record<RequestType, React.ReactNode> = {
  general: <Receipt className="w-5 h-5" />,
  discount: <BadgePercent className="w-5 h-5" />,
  exhibition: <Store className="w-5 h-5" />,
  asset: <Package className="w-5 h-5" />,
  asset_below_20k: <Package className="w-5 h-5" />,
  non_cash: <FileCheck className="w-5 h-5" />,
  stock_transfer: <ArrowLeftRight className="w-5 h-5" />,
};

export const NewRequestPage: React.FC = () => {
  const { user } = useAuth();
  const dir = useDirectory();
  const { createDraft, submitRequest, threshold, requests } = useRequests();
  const navigate = useNavigate();

  const activeProfile = dir.users.find((u) => u.id === user?.id) || user;
  const effectiveRegionId =
    activeProfile?.region_id ||
    user?.region_id ||
    (activeProfile?.regional_head_id
      ? dir.users.find((u) => u.id === activeProfile.regional_head_id)?.region_id
      : null) ||
    null;

  const effectiveRegionName =
    activeProfile?.region?.name ||
    dir.regions.find((r) => r.id === effectiveRegionId)?.name ||
    user?.region?.name ||
    null;

  const allowed = useMemo<RequestType[]>(() => {
    const raw = user?.allowed_types ?? ['general'];
    const list = new Set<RequestType>(raw);
    if (list.has('asset')) {
      list.add('asset_below_20k');
    }
    if (user?.role === 'admin' || user?.role === 'head') {
      return REQUEST_TYPES;
    }
    return REQUEST_TYPES.filter((t) => list.has(t));
  }, [user?.allowed_types, user?.role]);
  const [type, setType] = useState<RequestType>(allowed[0] ?? 'general');
  const isAsset = type === 'asset' || type === 'asset_below_20k';
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [hasGst, setHasGst] = useState<boolean>(true);
  const [gstRate, setGstRate] = useState<number>(18);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<DiscountForm>(emptyDiscount);
  const [exhibition, setExhibition] = useState<ExhibitionForm>(emptyExhibition);
  const [asset, setAsset] = useState<AssetForm>(emptyAsset);
  const [stockTransfer, setStockTransfer] = useState<StockTransferForm>(() =>
    emptyStockTransfer(user?.shop_id || '', user?.shop?.name || '')
  );
  const [quotes, setQuotes] = useState<QuoteRow[]>(() => initialQuotes(type === 'asset_below_20k' ? 1 : 2));
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [voiceFile, setVoiceFile] = useState<RequestFile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef<boolean>(false);
  const [targetHeadId, setTargetHeadId] = useState('');
  const categoryOptions = useCategoryOptions(type === 'exhibition' ? null : targetHeadId || null);
  const [categoryId, setCategoryId] = useState('');

  const exhibitionQuota = useMemo(() => {
    if (type !== 'exhibition') return null;
    return checkExhibitionQuota({
      eventStart: exhibition.event_start,
      eventDates: exhibition.event_dates,
      regionId: effectiveRegionId,
      regionName: effectiveRegionName,
      currentUser: user,
      allRequests: requests,
    });
  }, [type, exhibition.event_start, exhibition.event_dates, effectiveRegionId, effectiveRegionName, user, requests]);

  const baseAmount = parseFloat(amountStr) || 0;
  const gstAmount = hasGst ? Math.round(baseAmount * (gstRate / 100) * 100) / 100 : 0;
  const generalTotal = hasGst ? Math.round((baseAmount + gstAmount) * 100) / 100 : baseAmount;

  const quoteInfo = quoteSummary(quotes);
  const stockCalc = stockTransferCalc(stockTransfer);
  const amount =
    type === 'non_cash' ? 0
      : type === 'discount' ? discountCalc(discount).value
      : type === 'stock_transfer' ? stockCalc.totalMrp
      : type === 'exhibition' ? exhibitionCalc(exhibition).total
      : isAsset ? quoteInfo.amount
      : generalTotal;
  const isHighValue = type === 'general' && amount > threshold;
  const docsRequired = type === 'general' || type === 'discount';
  const hasPdf = files.some((f) => f.mime_type === 'application/pdf');

  const allFiles = isAsset
    ? [...newQuoteFiles(quotes), ...(voiceFile ? [voiceFile] : [])]
    : voiceFile ? [...files, voiceFile] : files;

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
    title.trim()
    || (type === 'exhibition' && exhibition.event_name.trim() ? `Exhibition: ${exhibition.event_name.trim()}` : '')
    || (isAsset && asset.asset_name.trim() ? `Asset: ${asset.asset_name.trim()}` : '')
    || (type === 'stock_transfer' && stockTransfer.from_shop_name && stockTransfer.to_shop_name
        ? `Stock Transfer: ${stockTransfer.from_shop_name} → ${stockTransfer.to_shop_name} (${stockCalc.pieces} pcs)`
        : '');

  const details = (): RequestDetails | null => {
    if (type === 'non_cash') return null;
    if (type === 'discount') return toDiscountDetails(discount);
    if (type === 'stock_transfer') return toStockTransferDetails(stockTransfer);
    if (type === 'exhibition') {
      const exh = toExhibitionDetails(exhibition);
      if (exhibitionQuota?.mustUseWaitlist) {
        exh.is_waitlist = true;
      }
      (exh as any).region_id = effectiveRegionId;
      (exh as any).region_name = effectiveRegionName;
      return exh;
    }
    if (isAsset) return toAssetDetails(asset);
    return {
      base_amount: baseAmount,
      has_gst: hasGst,
      gst_rate: hasGst ? gstRate : 0,
      gst_amount: gstAmount,
      total_amount: generalTotal,
    };
  };

  const validate = (forDraft: boolean): string | null => {
    if (!forDraft && user?.role !== 'head' && categoryOptions.required && !categoryId) return 'Select the work category for this request.';
    if (isAsset) {
      if (!asset.asset_name.trim()) return 'Enter the asset you want to buy.';
      return validateQuotes(quotes, forDraft, type === 'asset_below_20k' ? 1 : 2, type === 'asset_below_20k' ? 20000 : undefined);
    }
    if (type === 'stock_transfer') {
      if (forDraft) return null;
      return validateStockTransfer(stockTransfer);
    }
    if (!effectiveTitle()) return type === 'exhibition' ? 'Enter the event name.' : 'Please enter a request title.';
    if (type === 'general') {
      if (!forDraft && baseAmount <= 0) return 'Please enter a valid amount greater than zero.';
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
    if (submittingRef.current) return;
    setError(null);
    const v = validate(!andSubmit);
    if (v) {
      setError(v);
      return;
    }
    submittingRef.current = true;
    andSubmit ? setIsSubmitting(true) : setIsSavingDraft(true);
    try {
      const draftRes = await createDraft({
        type,
        title: effectiveTitle(),
        amount: type === 'non_cash' ? 0 : (type === 'general' ? generalTotal || 1 : isAsset ? amount || 1 : amount),
        notes: notes.trim() || undefined,
        details: details(),
        files: allFiles,
        category_id: user?.role !== 'head' && categoryOptions.required ? categoryId || null : null,
        target_head_id: type === 'exhibition' ? null : (targetHeadId || null),
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
      submittingRef.current = false;
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
        {user?.role === 'head' && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-800 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-purple-600" />
            Department Head request: Bypasses clerk routing and goes directly to Admin for approval.
          </p>
        )}
        {user?.role === 'employee' && user.regional_head_id && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-cyan-600" />
            Your request goes to your Regional Head first, who forwards it to the clerk.
          </p>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="space-y-6">
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {/* Request type */}
        <div className={`grid gap-3 ${allowed.length === 1 ? 'grid-cols-1' : allowed.length === 2 ? 'grid-cols-2' : allowed.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {allowed.map((t) => (
            <button
              key={t}
              type="button"
              id={`type-${t}`}
              onClick={() => {
                setType(t);
                setError(null);
                if (t === 'asset_below_20k') {
                  if (quotes.length < 1) setQuotes(initialQuotes(1));
                } else if (t === 'asset') {
                  if (quotes.length < 2) setQuotes(initialQuotes(2));
                }
              }}
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
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-800 font-display">
              {type === 'exhibition' ? 'Event Sponsorship & Promotion Form' : type === 'discount' ? 'Discount Details' : type === 'stock_transfer' ? 'Stock Transfer Details' : isAsset ? (type === 'asset_below_20k' ? 'Asset Purchase Details (< ₹20k)' : 'Asset Purchase Details') : type === 'non_cash' ? 'Non-Cash Request Details' : 'Request Information'}
            </h2>
            {type === 'exhibition' && (
              <a
                href="/calendar/exhibitions"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 transition-colors"
              >
                <CalendarDays className="w-3.5 h-3.5 text-indigo-600" />
                <span>View Exhibition Calendar ↗</span>
              </a>
            )}
          </div>

          {type !== 'exhibition' ? (
            <TargetHeadField
              value={targetHeadId}
              onChange={(newHeadId) => {
                if (newHeadId !== targetHeadId) {
                  setTargetHeadId(newHeadId);
                  setCategoryId('');
                }
              }}
            />
          ) : (
            <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl text-xs text-indigo-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Exhibition requests are submitted directly to your <strong>Main Department Head</strong> for review.</span>
            </div>
          )}

          {user?.role !== 'head' && (
            <WorkCategoryField options={categoryOptions} value={categoryId} onChange={setCategoryId} />
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {type === 'discount' ? 'Subject' : 'Request Title'} {type !== 'exhibition' && type !== 'stock_transfer' && !isAsset && <span className="text-rose-500">*</span>}
            </label>
            <input
              id="request-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === 'discount' ? 'e.g. Discount for bridal set – Mrs. Fathima'
                  : type === 'exhibition' ? 'Optional – event name is used if empty'
                  : type === 'stock_transfer' ? 'Optional – origin and destination shops are used if empty'
                  : isAsset ? 'Optional – asset name is used if empty'
                  : 'e.g. Vendor invoice for showroom lighting'
              }
              className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
            />
          </div>

          {type === 'non_cash' && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 leading-relaxed flex items-start gap-2">
              <FileCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong>Non-Cash Request:</strong> This request is for operational or internal approval with no cash or disbursement involved.
              </div>
            </div>
          )}

          {type === 'stock_transfer' && (
            <StockTransferFields
              value={stockTransfer}
              onChange={setStockTransfer}
              shops={dir.shops}
              categories={dir.productCategories}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {type === 'general' && (
            <div className="space-y-3.5 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Amount (Excluding GST) in Rupees (₹) <span className="text-rose-500">*</span>
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
                    className="w-full text-base sm:text-sm pl-8 pr-4 py-3 rounded-xl border border-slate-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-semibold transition-colors"
                  />
                </div>
                {baseAmount > 0 && <span className="text-xs font-medium text-slate-600 mt-1 block">Base amount: {formatINR(baseAmount)}</span>}
              </div>

              <GstSelector
                hasGst={hasGst}
                onHasGstChange={setHasGst}
                gstRate={gstRate}
                onGstRateChange={setGstRate}
                baseAmount={baseAmount}
                gstAmount={gstAmount}
                totalAmount={generalTotal}
              />
            </div>
          )}

          {type === 'discount' && <DiscountFields value={discount} onChange={setDiscount} />}
          {type === 'exhibition' && <ExhibitionFields value={exhibition} onChange={setExhibition} quotaStatus={exhibitionQuota} />}
          {isAsset && <AssetFields value={asset} onChange={setAsset} />}

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
        {isAsset ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-sm font-bold text-slate-800 font-display">
                {type === 'asset_below_20k' ? 'Bill or Quote' : 'Bills / Quotations'} <span className="text-rose-500">*</span>
              </h2>
              <span className="text-[11px] text-slate-400">
                {type === 'asset_below_20k' ? 'Min. 1 (Mandatory) · Max ₹20,000' : 'Min. 2 (Mandatory)'} · PDF, JPG, PNG
              </span>
            </div>
            <QuotationsEditor
              rows={quotes}
              onChange={setQuotes}
              disabled={isSubmitting || isSavingDraft}
              minQuotes={type === 'asset_below_20k' ? 1 : 2}
              maxAmount={type === 'asset_below_20k' ? 20000 : undefined}
            />
          </div>
        ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-800 font-display">
              {type === 'exhibition'
                ? "Organiser's proposal / quotation"
                : type === 'discount'
                ? 'Discount PDF (bill / estimate)'
                : type === 'stock_transfer'
                ? 'Document Attachments (e.g. delivery challan / gate pass)'
                : 'Document Attachments'}{' '}
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
          {type === 'stock_transfer' && (
            <p className="text-[11px] text-slate-500">
              Documents are not mandatory. The filled stock transfer request form itself will be automatically generated, signed, and sealed. Any attached documents will be sealed together.
            </p>
          )}
        </div>
        )}

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
                disabled={isSavingDraft || isSubmitting || submittingRef.current}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs sm:text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingDraft ? 'Saving…' : <><span className="sm:hidden">Draft</span><span className="hidden sm:inline">Save as Draft</span></>}</span>
              </button>
              <button
                type="submit"
                id="submit-request"
                disabled={isSubmitting || isSavingDraft || submittingRef.current}
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
