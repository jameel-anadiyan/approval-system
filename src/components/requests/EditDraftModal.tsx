import React, { useState, useRef } from 'react';
import { Modal } from '../common/Modal';
import { FileUploader } from './FileUploader';
import { RequestFile, RequestRecord, RequestDetails, DisbursementMode } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { formatFileSize, formatINR, formatINRWhole, typeOf } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import { FileText, Mic, Trash2, Save, Loader2, Eye, Image as ImageIcon } from 'lucide-react';
import { DocumentPreviewModal, DocumentPreviewItem } from './DocumentPreviewModal';
import {
  DiscountFields, ExhibitionFields, discountFromDetails, exhibitionFromDetails, discountCalc, exhibitionCalc,
  validateDiscount, validateExhibition, toDiscountDetails, toExhibitionDetails,
  NonCashFields, nonCashFromDetails, toNonCashDetails, NonCashForm,
} from './TypedRequestFields';
import { GstSelector } from './GstSelector';
import {
  AssetFields, assetFromDetails, toAssetDetails, QuotationsEditor, QuoteRow, quotesFromFiles, quoteSummary,
  validateQuotes, newQuoteFiles,
} from './AssetQuotations';
import {
  StockTransferFields, stockTransferFromDetails, toStockTransferDetails, validateStockTransfer, stockTransferCalc,
} from './StockTransferFields';
import { WorkCategoryField, useCategoryOptions } from './WorkCategoryField';
import { TargetHeadField } from './TargetHeadField';
import { checkExhibitionQuota } from '../../lib/exhibitionQuota';
import { useAuth } from '../../context/AuthContext';
import { useDirectory } from '../../lib/directory';
import { RequestShopField, useRequestShops, needsShopPick } from './RequestShopField';
import { DisbursementModeSelector } from './DisbursementModeSelector';

interface EditDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
}

/** Requester edits a draft / returned request: details, add documents, remove attachments. */
export const EditDraftModal: React.FC<EditDraftModalProps> = ({ isOpen, onClose, request }) => {
  const { user } = useAuth();
  const { updateDraft, addFiles, removeFile, setQuote, threshold, requests } = useRequests();
  const type = typeOf(request);
  const isAsset = type === 'asset' || type === 'asset_below_20k';
  const isPaymentNeeded = type !== 'discount' && type !== 'non_cash' && type !== 'stock_transfer';
  const [disbursementMode, setDisbursementMode] = useState<DisbursementMode>(
    request.disbursement_mode ?? (request.details?.disbursement_mode as DisbursementMode) ?? null
  );
  const [enterBankDetailsLater, setEnterBankDetailsLater] = useState<boolean>(
    Boolean(request.enter_bank_details_later ?? request.details?.enter_bank_details_later ?? false)
  );
  const [bankAccountNo, setBankAccountNo] = useState<string>(
    request.bank_account_no || request.details?.bank_account_no || ''
  );
  const [bankIfsc, setBankIfsc] = useState<string>(
    request.bank_ifsc || request.details?.bank_ifsc || ''
  );
  const [bankName, setBankName] = useState<string>(
    request.bank_name || request.details?.bank_name || ''
  );
  const [branch, setBranch] = useState<string>(
    request.bank_branch || request.details?.bank_branch || ''
  );
  const [accountHolderName, setAccountHolderName] = useState<string>(
    request.bank_account_holder_name || request.details?.bank_account_holder_name || ''
  );
  const [bankVerified, setBankVerified] = useState<boolean>(
    Boolean(request.bank_verified ?? request.details?.bank_verified ?? false)
  );
  const [bankVerificationMessage, setBankVerificationMessage] = useState<string | null>(
    request.bank_verification_message || request.details?.bank_verification_message || null
  );
  const [title, setTitle] = useState(request.title);
  const [amountStr, setAmountStr] = useState(() => {
    const gBase = request.details?.base_amount;
    return gBase ? String(gBase) : String(request.amount);
  });
  const [hasGst, setHasGst] = useState<boolean>(() =>
    request.details?.has_gst !== undefined ? Boolean(request.details.has_gst) : true
  );
  const [gstRate, setGstRate] = useState<number>(() =>
    Number(request.details?.gst_rate ?? 18)
  );
  const [notes, setNotes] = useState(request.notes || '');
  const dir = useDirectory();
  const [discount, setDiscount] = useState(() => discountFromDetails(request.details));
  const [nonCash, setNonCash] = useState<NonCashForm>(() => nonCashFromDetails(request.details));
  const [exhibition, setExhibition] = useState(() => exhibitionFromDetails(request.details));
  const [asset, setAsset] = useState(() => assetFromDetails(request.details));
  const [stockTransfer, setStockTransfer] = useState(() =>
    stockTransferFromDetails(request.details, request.shop_id || '', request.shop_name || '')
  );
  const [quotes, setQuotes] = useState<QuoteRow[]>(() => quotesFromFiles(request.files, type === 'asset_below_20k' ? 1 : 2));
  const [newFiles, setNewFiles] = useState<RequestFile[]>([]);
  const [targetHeadId, setTargetHeadId] = useState<string>(request.owner_head_id ?? '');
  const categoryOptions = useCategoryOptions(type === 'exhibition' ? null : targetHeadId || null);
  const [categoryId, setCategoryId] = useState<string>(request.category_id ?? '');
  const shopState = useRequestShops();
  const pickShop = needsShopPick(type);
  const [shopId, setShopId] = useState<string>(request.shop_id ?? '');
  const [shopName, setShopName] = useState<string>(request.shop_name ?? '');
  // A single associated shop is always the request's shop.
  const effectiveShopId = shopState.autoShop ? shopState.autoShop.id : shopId;
  const effectiveShopName = shopState.autoShop ? shopState.autoShop.name : shopName;
  const shopChoice = () => ({ shop_id: effectiveShopId || '', shop_name: effectiveShopName || null });
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deletedFileIds, setDeletedFileIds] = useState<Set<string>>(new Set());
  const [previewFiles, setPreviewFiles] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIdx, setPreviewInitialIdx] = useState<number>(0);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveLockRef = useRef(false);

  const exhibitionQuota = type === 'exhibition' ? checkExhibitionQuota({
    eventStart: exhibition.event_start,
    eventDates: exhibition.event_dates,
    regionId: request.region_id || user?.region_id || null,
    regionName: request.region_name || user?.region?.name || null,
    currentUser: user,
    allRequests: requests,
    excludeRequestId: request.id,
  }) : null;

  const baseAmount = parseFloat(amountStr) || 0;
  const gstAmount = hasGst ? Math.round(baseAmount * (gstRate / 100) * 100) / 100 : 0;
  const generalTotal = hasGst ? Math.round((baseAmount + gstAmount) * 100) / 100 : baseAmount;

  const stockCalc = stockTransferCalc(stockTransfer);
  const amount =
    type === 'non_cash' ? 0
      : type === 'discount' ? discountCalc(discount).value
      : type === 'stock_transfer' ? stockCalc.totalMrp
      : type === 'exhibition' ? exhibitionCalc(exhibition).total
      : isAsset ? quoteSummary(quotes).amount || request.amount
      : generalTotal;

  // Asset quotation documents are edited in the quotation editor; only voice notes are listed here.
  const existing = (request.files || []).filter(
    (f) => !deletedFileIds.has(f.id) && (!isAsset || f.kind !== 'document')
  );

  const handleRemoveExisting = async (fileId: string, fileName?: string): Promise<boolean> => {
    if (fileName && !window.confirm(`Delete "${fileName}"? This cannot be undone.`)) {
      return false;
    }
    setError(null);
    setRemovingId(fileId);
    // Optimistically hide immediately from modal UI
    setDeletedFileIds((prev) => new Set(prev).add(fileId));

    const res = await removeFile(request.id, fileId);
    setRemovingId(null);
    if (!res.success) {
      // Revert optimistic removal on error
      setDeletedFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setError(res.error || 'Could not remove file');
      return false;
    }
    return true;
  };

  const handlePreviewExisting = (fileId: string) => {
    const previewable = existing.filter((f) => f.kind !== 'voice_note');
    const items: DocumentPreviewItem[] = previewable.map((f) => ({
      id: f.id,
      name: f.original_name,
      storagePath: f.storage_path,
      publicUrl: f.public_url || null,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      pageCount: f.page_count,
      badge: f.added_by_name ? `Added by: ${f.added_by_name}${f.added_by_role ? ` (${f.added_by_role})` : ''}` : undefined,
    }));
    const idx = previewable.findIndex((f) => f.id === fileId);
    setPreviewFiles(items);
    setPreviewInitialIdx(Math.max(0, idx));
    setIsPreviewOpen(true);
  };

  const getDetails = (): RequestDetails | null => {
    let d: RequestDetails | null = null;
    if (type === 'non_cash') d = toNonCashDetails(nonCash, shopState.loading ? undefined : shopChoice());
    else if (type === 'discount') d = toDiscountDetails(discount);
    else if (type === 'stock_transfer') d = toStockTransferDetails(stockTransfer);
    else if (type === 'exhibition') {
      const exh = toExhibitionDetails(exhibition);
      if (exhibitionQuota?.mustUseWaitlist) {
        exh.is_waitlist = true;
      }
      (exh as any).region_id = request.region_id || user?.region_id || null;
      (exh as any).region_name = request.region_name || user?.region?.name || null;
      d = exh;
    } else if (isAsset) {
      d = toAssetDetails(asset);
    } else {
      d = {
        base_amount: baseAmount,
        has_gst: hasGst,
        gst_rate: hasGst ? gstRate : 0,
        gst_amount: gstAmount,
        total_amount: generalTotal,
        ...(shopState.loading ? {} : shopChoice()),
      };
    }

    if (isPaymentNeeded) {
      d = {
        ...d,
        disbursement_mode: disbursementMode,
        enter_bank_details_later: disbursementMode === 'bank' ? enterBankDetailsLater : false,
        bank_account_no: disbursementMode === 'bank' && !enterBankDetailsLater ? bankAccountNo.trim() : null,
        bank_ifsc: disbursementMode === 'bank' && !enterBankDetailsLater ? bankIfsc.trim().toUpperCase() : null,
        bank_name: disbursementMode === 'bank' && !enterBankDetailsLater ? bankName.trim() || null : null,
        bank_branch: disbursementMode === 'bank' && !enterBankDetailsLater ? branch.trim() || null : null,
        bank_account_holder_name: disbursementMode === 'bank' && !enterBankDetailsLater ? accountHolderName.trim() || null : null,
        bank_verified: disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerified : false,
        bank_verification_message: disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerificationMessage : null,
      };
    }
    return d;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveLockRef.current) return;
    setError(null);
    if (!title.trim()) return setError('Please enter a title.');
    if (baseAmount <= 0 && type === 'general') return setError('Amount must be more than zero.');
    if (isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater) {
      if (!bankAccountNo.trim()) return setError('Please enter bank account number, or select "Enter bank details later".');
      if (!bankIfsc.trim()) return setError('Please enter bank IFSC code, or select "Enter bank details later".');
    }
    const v =
      type === 'discount' ? validateDiscount(discount)
      : type === 'exhibition' ? validateExhibition(exhibition)
      : type === 'stock_transfer' ? validateStockTransfer(stockTransfer)
      : isAsset ? (!asset.asset_name.trim() ? 'Enter the asset name.' : validateQuotes(quotes, true, type === 'asset_below_20k' ? 1 : 2, type === 'asset_below_20k' ? 20000 : undefined))
      : null;
    if (v) return setError(v);
    if (user?.role !== 'head' && categoryOptions.required && !categoryOptions.categories.some((c) => c.id === categoryId)) {
      return setError('Please select the work category.');
    }
    if (pickShop && shopState.mustPick && !effectiveShopId) {
      return setError('Please select the shop for this request.');
    }
    saveLockRef.current = true;
    setBusy(true);
    try {
      const upd = await updateDraft(request.id, {
        title: title.trim(),
        amount: type === 'non_cash' ? 0 : (type === 'general' ? generalTotal : amount),
        notes: notes.trim() || undefined,
        details: getDetails(),
        category_id: user?.role !== 'head' && categoryOptions.required ? categoryId || null : undefined,
        target_head_id: type === 'exhibition' || user?.role === 'head' ? null : (targetHeadId || undefined),
      });
      if (!upd.success) throw new Error(upd.error);
      if (isAsset) {
        // Update typed vendor / amount / preference on already-uploaded quotations that changed.
        for (const q of quotes) {
          const f = q.existing;
          if (!f) continue;
          const a = parseFloat(q.amount) || 0;
          if (!q.vendor.trim() || a <= 0) continue;
          if (f.quote_vendor === q.vendor.trim() && Number(f.quote_amount) === a && !!f.quote_preferred === q.preferred) continue;
          const res = await setQuote(f.id, q.vendor.trim(), a, q.preferred);
          if (!res.success) throw new Error(res.error);
        }
      }
      const toAdd = isAsset ? newQuoteFiles(quotes) : newFiles;
      if (toAdd.length) {
        const add = await addFiles(request.id, toAdd);
        if (!add.success) throw new Error(add.error);
      } else if (isAsset) {
        await addFiles(request.id, []); // refresh list after quote edits
      }
      onClose();
    } catch (err) {
      setError(errMsg(err));
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
        {type !== 'exhibition' && user?.role !== 'head' && (
          <TargetHeadField
            value={targetHeadId}
            onChange={(newHeadId) => {
              if (newHeadId !== targetHeadId) {
                setTargetHeadId(newHeadId);
                setCategoryId('');
              }
            }}
          />
        )}
        {user?.role !== 'head' && (
          <WorkCategoryField options={categoryOptions} value={categoryId} onChange={setCategoryId}
            currentName={request.category_name} />
        )}
        {pickShop && (
          <RequestShopField
            state={shopState}
            value={shopId}
            currentName={request.shop_name}
            onChange={(id, name) => {
              setShopId(id);
              setShopName(name);
            }}
            disabled={busy}
          />
        )}
        {isPaymentNeeded && (
          <DisbursementModeSelector
            mode={disbursementMode}
            onModeChange={setDisbursementMode}
            enterLater={enterBankDetailsLater}
            onEnterLaterChange={setEnterBankDetailsLater}
            accountNumber={bankAccountNo}
            onAccountNumberChange={setBankAccountNo}
            ifsc={bankIfsc}
            onIfscChange={setBankIfsc}
            bankName={bankName}
            onBankNameChange={setBankName}
            branch={branch}
            onBranchChange={setBranch}
            accountHolderName={accountHolderName}
            onAccountHolderNameChange={setAccountHolderName}
            isVerified={bankVerified}
            onVerifiedChange={setBankVerified}
            verificationMessage={bankVerificationMessage}
            onVerificationMessageChange={setBankVerificationMessage}
            disabled={busy}
          />
        )}
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

            <GstSelector
              hasGst={hasGst}
              onHasGstChange={setHasGst}
              gstRate={gstRate}
              onGstRateChange={setGstRate}
              baseAmount={baseAmount}
              gstAmount={gstAmount}
              totalAmount={generalTotal}
            />

            {generalTotal > threshold && (
              <p className="text-[11px] text-amber-700 mt-1 font-medium">Above {formatINRWhole(threshold)}: this will need Admin approval (Route A).</p>
            )}
          </div>
        )}
        {type === 'discount' && <DiscountFields value={discount} onChange={setDiscount} />}
        {type === 'non_cash' && <NonCashFields value={nonCash} onChange={setNonCash} disabled={busy} />}
        {type === 'exhibition' && <ExhibitionFields value={exhibition} onChange={setExhibition} quotaStatus={exhibitionQuota} />}
        {type === 'stock_transfer' && (
          <StockTransferFields
            value={stockTransfer}
            onChange={setStockTransfer}
            shops={dir.shops}
            categories={dir.productCategories}
            disabled={busy}
          />
        )}
        {isAsset && <AssetFields value={asset} onChange={setAsset} />}
        <div>
          <label htmlFor="edit-notes" className="text-xs font-bold text-slate-700 block mb-1">Purpose / Notes</label>
          <textarea id="edit-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden" />
        </div>

        {existing.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>Existing Attachments</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                  {existing.length}
                </span>
              </label>
              {existing.some((f) => f.kind !== 'voice_note') && (
                <button
                  type="button"
                  onClick={() => {
                    const firstDoc = existing.find((f) => f.kind !== 'voice_note');
                    if (firstDoc) handlePreviewExisting(firstDoc.id);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview Attached</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              {existing.map((f) => {
                const isPdf = f.mime_type?.includes('pdf') || f.original_name.toLowerCase().endsWith('.pdf');
                const isVoice = f.kind === 'voice_note';

                return (
                  <div
                    key={f.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isVoice
                            ? 'bg-violet-50 text-violet-600 border border-violet-200'
                            : isPdf
                            ? 'bg-rose-50 text-rose-600 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        }`}
                      >
                        {isVoice ? (
                          <Mic className="w-4 h-4" />
                        ) : isPdf ? (
                          <FileText className="w-4 h-4" />
                        ) : (
                          <ImageIcon className="w-4 h-4" />
                        )}
                      </div>
                      <div className="overflow-hidden min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate" title={f.original_name}>
                          {f.original_name}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                          <span>{formatFileSize(f.size_bytes)}</span>
                          {f.added_by_name && (
                            <span className="text-indigo-600 font-medium">
                              • Added by {f.added_by_name} {f.added_by_role ? `(${f.added_by_role})` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isVoice && (
                        <button
                          type="button"
                          onClick={() => handlePreviewExisting(f.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-800 text-xs font-bold transition-colors cursor-pointer"
                          title={`Preview ${f.original_name}`}
                        >
                          <Eye className="w-3.5 h-3.5 text-indigo-600" />
                          <span className="hidden sm:inline">Preview</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleRemoveExisting(f.id, f.original_name)}
                        disabled={removingId === f.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                        aria-label={`Delete ${f.original_name}`}
                        title="Delete attachment"
                      >
                        {removingId === f.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>{removingId === f.id ? 'Deleting…' : 'Delete'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isAsset ? (
          <div>
            <span className="text-xs font-bold text-slate-700 block mb-1.5">
              {type === 'asset_below_20k' ? 'Bill or Quote' : 'Bills / Quotations'}
            </span>
            <QuotationsEditor
              rows={quotes}
              onChange={setQuotes}
              disabled={busy}
              minQuotes={type === 'asset_below_20k' ? 1 : 2}
              maxAmount={type === 'asset_below_20k' ? 20000 : undefined}
              onRemoveExisting={(f) => handleRemoveExisting(f.id, f.original_name)}
            />
          </div>
        ) : (
        <div>
          <span className="text-xs font-bold text-slate-700 block mb-1.5">Add documents</span>
          <FileUploader
            files={newFiles}
            onAddFiles={(f) => setNewFiles((p) => [...p, ...f])}
            onRemoveFile={(id) => setNewFiles((p) => p.filter((f) => f.id !== id))}
            disabled={busy}
          />
        </div>
        )}

        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>}

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 disabled:opacity-50 cursor-pointer">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{busy ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </form>

      {/* Attachment Preview Modal with Delete button support */}
      <DocumentPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        files={previewFiles}
        initialIndex={previewInitialIdx}
        title={`Attachment Preview - ${request.request_no || request.title}`}
        onDeleteFile={async (item) => {
          if (item.id) {
            const ok = await handleRemoveExisting(item.id, item.name);
            return ok;
          }
        }}
      />
    </Modal>
  );
};
