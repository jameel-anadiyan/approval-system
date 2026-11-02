import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests, errMsg } from '../../context/RequestContext';
import {
  RequestFile,
  RequestType,
  RequestDetails,
  Profile,
  DisbursementMode,
  PettyCashDealer,
  isDisbursementAssociated,
  isSpecialRequestType,
} from '../../types/database';
import { FileUploader } from '../../components/requests/FileUploader';
import { VoiceRecorder } from '../../components/requests/VoiceRecorder';
import {
  DiscountFields, ExhibitionFields, emptyDiscount, emptyExhibition, discountCalc, exhibitionCalc,
  validateDiscount, validateExhibition, toDiscountDetails, toExhibitionDetails,
  DiscountForm, ExhibitionForm,
  NonCashFields, NonCashForm, emptyNonCash, toNonCashDetails,
  AgreementBanner, toAgreementDetails,
  StatutoryPaymentFields, StatutoryPaymentForm, emptyStatutoryPayment, validateStatutoryPayment, toStatutoryPaymentDetails,
  AuditReportFields, AuditReportForm, emptyAuditReport, validateAuditReport, toAuditReportDetails,
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
import { ShieldAlert, Send, Save, ArrowLeft, Receipt, BadgePercent, Store, Ban, Package, UserCheck, FileCheck, CalendarDays, ArrowLeftRight, Loader2, Wallet, FileSignature, Landmark, ClipboardCheck } from 'lucide-react';
import { WorkCategoryField, useCategoryOptions } from '../../components/requests/WorkCategoryField';
import { TargetHeadField } from '../../components/requests/TargetHeadField';
import { checkExhibitionQuota } from '../../lib/exhibitionQuota';
import { useDirectory, fetchActiveEntryOfficers, fetchPettyCashDealers } from '../../lib/directory';
import { RequestShopField, useRequestShops, useExhibitionShops, needsShopPick } from '../../components/requests/RequestShopField';
import { DisbursementModeSelector } from '../../components/requests/DisbursementModeSelector';

const TYPE_ICONS: Record<RequestType, React.ReactNode> = {
  general: <Receipt className="w-5 h-5" />,
  petty_cash: <Wallet className="w-5 h-5" />,
  discount: <BadgePercent className="w-5 h-5" />,
  exhibition: <Store className="w-5 h-5" />,
  asset: <Package className="w-5 h-5" />,
  asset_below_20k: <Package className="w-5 h-5" />,
  non_cash: <FileCheck className="w-5 h-5" />,
  stock_transfer: <ArrowLeftRight className="w-5 h-5" />,
  agreement: <FileSignature className="w-5 h-5" />,
  statutory_payment: <Landmark className="w-5 h-5" />,
  audit_report: <ClipboardCheck className="w-5 h-5" />,
};

export const NewRequestPage: React.FC = () => {
  const { user, isBackendConnected } = useAuth();
  const dir = useDirectory();
  const { createDraft, submitRequest, threshold, requests } = useRequests();
  const navigate = useNavigate();
  const location = useLocation();

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
    const raw = activeProfile?.allowed_types ?? user?.allowed_types ?? ['general'];
    const list = new Set<RequestType>(raw);
    if (list.has('asset')) {
      list.add('asset_below_20k');
    }
    if (user?.role === 'employee' || user?.role === 'regional_head' || user?.role === 'clerk' || user?.role === 'head' || user?.role === 'admin') {
      list.add('petty_cash');
    }
    if (user?.role === 'admin') {
      return REQUEST_TYPES;
    }
    if (user?.role === 'head') {
      // Standard types are always available to Heads; special restricted types (Agreement, Statutory Payment, Audit Report) only when enabled for this Head
      return REQUEST_TYPES.filter((t) => !isSpecialRequestType(t) || list.has(t));
    }
    return REQUEST_TYPES.filter((t) => list.has(t));
  }, [activeProfile?.allowed_types, user?.allowed_types, user?.role]);
  const requestedDefaultType = (location.state as { defaultType?: RequestType } | null)?.defaultType;
  const initialType: RequestType =
    requestedDefaultType && allowed.includes(requestedDefaultType)
      ? requestedDefaultType
      : (allowed[0] ?? 'general');
  const [type, setType] = useState<RequestType>(initialType);

  useEffect(() => {
    if (requestedDefaultType && allowed.includes(requestedDefaultType)) {
      setType(requestedDefaultType);
    }
  }, [requestedDefaultType, allowed]);

  const isAsset = type === 'asset' || type === 'asset_below_20k';
  const isPettyCash = type === 'petty_cash';
  const isSpecial = isSpecialRequestType(type);
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [hasGst, setHasGst] = useState<boolean>(true);
  const [gstRate, setGstRate] = useState<number>(18);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<DiscountForm>(emptyDiscount);
  const [nonCash, setNonCash] = useState<NonCashForm>(emptyNonCash);
  const [statutoryPayment, setStatutoryPayment] = useState<StatutoryPaymentForm>(emptyStatutoryPayment);
  const [auditReport, setAuditReport] = useState<AuditReportForm>(emptyAuditReport);
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
  const [pettyCashDealers, setPettyCashDealers] = useState<PettyCashDealer[]>([]);
  const [loadingPettyDealers, setLoadingPettyDealers] = useState(false);
  const categoryOptions = useCategoryOptions(type === 'exhibition' || type === 'petty_cash' ? null : targetHeadId || null);
  const [categoryId, setCategoryId] = useState('');
  const shopState = useRequestShops();
  const exhibitionShopState = useExhibitionShops(shopState);
  const [shopId, setShopId] = useState('');
  const [shopName, setShopName] = useState('');
  const pickShop = needsShopPick(type);
  const isPaymentNeeded = isDisbursementAssociated(type);
  const [disbursementMode, setDisbursementMode] = useState<DisbursementMode>(initialType === 'petty_cash' ? 'cash' : 'bank');
  const [enterBankDetailsLater, setEnterBankDetailsLater] = useState<boolean>(false);
  const [bankAccountNo, setBankAccountNo] = useState<string>('');
  const [bankIfsc, setBankIfsc] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [bankBranch, setBankBranch] = useState<string>('');
  const [bankAccountHolderName, setBankAccountHolderName] = useState<string>('');
  const [bankVerified, setBankVerified] = useState<boolean>(false);
  const [bankVerificationMessage, setBankVerificationMessage] = useState<string | null>(null);

  // Head, Clerk, and Petty Cash requests select the Disbursement Entry Account up front.
  const needsEntryAccount = user?.role === 'head' || user?.role === 'clerk' || isPettyCash;
  const [assignedEntryUserId, setAssignedEntryUserId] = useState<string>('');
  const [entryOfficers, setEntryOfficers] = useState<Profile[]>([]);
  const [loadingOfficers, setLoadingOfficers] = useState(false);

  useEffect(() => {
    if (!isPettyCash) return;
    let cancelled = false;
    setLoadingPettyDealers(true);
    fetchPettyCashDealers(isBackendConnected, dir.users)
      .then((dealers) => {
        if (cancelled) return;
        setPettyCashDealers(dealers);
        if (user?.role !== 'head') {
          setTargetHeadId((prev) =>
            prev && dealers.some((d) => d.head_id === prev) ? prev : (dealers[0]?.head_id || '')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPettyDealers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPettyCash, isBackendConnected, dir.users, user?.role]);

  useEffect(() => {
    if (needsEntryAccount) {
      let cancelled = false;
      setLoadingOfficers(true);
      fetchActiveEntryOfficers(isBackendConnected)
        .then((officers) => {
          if (!cancelled) setEntryOfficers(officers);
        })
        .finally(() => {
          if (!cancelled) setLoadingOfficers(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [needsEntryAccount, isBackendConnected]);

  // Exactly one associated shop: assign it as the default.
  useEffect(() => {
    if (shopState.autoShop) {
      setShopId(shopState.autoShop.id);
      setShopName(shopState.autoShop.name);
    }
  }, [shopState.autoShop?.id]);

  // Pre-select when the user has a single exhibition shop in their list
  useEffect(() => {
    if (exhibitionShopState.options.length === 1) {
      const single = exhibitionShopState.options[0];
      setExhibition((prev) =>
        prev.conducting_shop_id
          ? prev
          : { ...prev, conducting_shop_id: single.id, conducting_shop_name: single.name }
      );
    }
  }, [exhibitionShopState.options]);

  const shopChoice = () => (shopId ? { shop_id: shopId, shop_name: shopName || null } : {});

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

  const statutoryAmt = parseFloat(statutoryPayment.payment_amount) || 0;
  const quoteInfo = quoteSummary(quotes);
  const stockCalc = stockTransferCalc(stockTransfer);
  const amount =
    type === 'non_cash' || type === 'agreement' || type === 'audit_report' ? 0
      : type === 'statutory_payment' ? statutoryAmt
      : type === 'petty_cash' ? baseAmount
      : type === 'discount' ? discountCalc(discount).value
      : type === 'stock_transfer' ? stockCalc.totalMrp
      : type === 'exhibition' ? exhibitionCalc(exhibition).total
      : isAsset ? quoteInfo.amount
      : generalTotal;
  const isHighValue = type === 'general' && amount > threshold;
  const docsRequired =
    type === 'general' ||
    type === 'discount' ||
    type === 'agreement' ||
    type === 'statutory_payment' ||
    type === 'audit_report';
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
    (type === 'petty_cash'
      ? `Petty Cash: ${(notes.trim() || 'Expense').replace(/\s+/g, ' ').slice(0, 60)}`
      : title.trim())
    || (type === 'non_cash' && nonCash.associated_notes.trim() ? `Non-Cash: ${nonCash.associated_notes.trim().slice(0, 50)}` : '')
    || (type === 'exhibition' && exhibition.event_name.trim() ? `Exhibition: ${exhibition.event_name.trim()}` : '')
    || (isAsset && asset.asset_name.trim() ? `Asset: ${asset.asset_name.trim()}` : '')
    || (type === 'stock_transfer' && stockTransfer.from_shop_name && stockTransfer.to_shop_name
        ? `Stock Transfer: ${stockTransfer.from_shop_name} → ${stockTransfer.to_shop_name} (${stockCalc.pieces} pcs)`
        : '');

  const details = (): RequestDetails | null => {
    let d: RequestDetails | null = null;
    if (type === 'non_cash') d = toNonCashDetails(nonCash, shopChoice());
    else if (type === 'agreement') d = toAgreementDetails(notes, shopChoice());
    else if (type === 'statutory_payment') d = toStatutoryPaymentDetails(statutoryPayment, notes, shopChoice());
    else if (type === 'audit_report') d = toAuditReportDetails(auditReport, notes, shopChoice());
    else if (type === 'petty_cash') {
      d = {
        petty_cash_form: 'petty_cash_form_below_1000',
        max_limit: 1000,
        total_amount: baseAmount,
        ...shopChoice(),
      };
    } else if (type === 'discount') d = toDiscountDetails(discount);
    else if (type === 'stock_transfer') d = toStockTransferDetails(stockTransfer);
    else if (type === 'exhibition') {
      const exh = toExhibitionDetails(exhibition);
      if (exhibitionQuota?.mustUseWaitlist) {
        exh.is_waitlist = true;
      }
      (exh as any).region_id = effectiveRegionId;
      (exh as any).region_name = effectiveRegionName;
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
        ...shopChoice(),
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
        bank_branch: disbursementMode === 'bank' && !enterBankDetailsLater ? bankBranch.trim() || null : null,
        bank_account_holder_name: disbursementMode === 'bank' && !enterBankDetailsLater ? bankAccountHolderName.trim() || null : null,
        bank_verified: disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerified : false,
        bank_verification_message: disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerificationMessage : null,
      };
    }
    return d;
  };

  const validate = (forDraft: boolean): string | null => {
    if (type === 'petty_cash') {
      if (baseAmount > 1000) return 'Maximum amount for Petty Cash is ₹1,000.';
      if (!forDraft) {
        if (user?.role !== 'head' && !targetHeadId) {
          return 'Please select a Petty Cash Dealing Head.';
        }
        if (!assignedEntryUserId) {
          return 'Please select a Disbursement Entry Account before submitting.';
        }
        if (baseAmount <= 0) {
          return 'Please enter a valid Petty Cash amount greater than zero (up to ₹1,000).';
        }
        if (disbursementMode !== 'cash' && disbursementMode !== 'bank') {
          return 'Please select Cash or Bank payment mode.';
        }
        if (disbursementMode === 'bank' && !enterBankDetailsLater) {
          if (!bankAccountNo.trim()) return 'Please enter bank account number, or select "Enter bank details later".';
          if (!bankIfsc.trim()) return 'Please enter bank IFSC code, or select "Enter bank details later".';
        }
        if (!notes.trim()) {
          return 'Note is mandatory for Petty Cash requests.';
        }
      }
      return null;
    }
    if (!forDraft && user?.role !== 'head' && user?.role !== 'clerk' && categoryOptions.required && !categoryId) return 'Select the work category for this request.';
    if (!forDraft && needsEntryAccount && isPaymentNeeded && !assignedEntryUserId) {
      return 'Please select a Disbursement Entry Account before submitting.';
    }
    if (!forDraft && isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater) {
      if (!bankAccountNo.trim()) return 'Please enter bank account number, or select "Enter bank details later".';
      if (!bankIfsc.trim()) return 'Please enter bank IFSC code, or select "Enter bank details later".';
    }
    if (!forDraft && pickShop && shopState.mustPick && !shopId) return 'Select the shop for this request.';
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
    if (type === 'non_cash') {
      return null;
    }
    if (type === 'agreement') {
      if (!forDraft && !notes.trim()) return 'Please enter the Agreement description.';
      if (!forDraft && files.length === 0) return 'Please attach at least one agreement document (Excel, Word, PDF, or image).';
      return null;
    }
    if (type === 'statutory_payment') {
      const sv = validateStatutoryPayment(statutoryPayment);
      if (!forDraft && sv) return sv;
      if (!forDraft && !notes.trim()) return 'Please enter the Statutory Payment description.';
      if (!forDraft && files.length === 0) return 'Please attach at least one supporting document.';
      return null;
    }
    if (type === 'audit_report') {
      const av = validateAuditReport(auditReport);
      if (!forDraft && av) return av;
      if (!forDraft && !notes.trim()) return 'Please enter the Audit Report description.';
      if (!forDraft && files.length === 0) return 'Please attach the audit report document (Excel, Word, PDF, or image).';
      return null;
    }
    if (type === 'exhibition') {
      return validateExhibition(exhibition, {
        requireShop: exhibitionShopState.options.length > 0,
      });
    }
    return null;
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
        amount:
          type === 'non_cash' || type === 'agreement' || type === 'audit_report'
            ? 0
            : type === 'statutory_payment'
            ? statutoryAmt || 1
            : type === 'petty_cash'
            ? Math.min(baseAmount || 1, 1000)
            : type === 'general'
            ? generalTotal || 1
            : isAsset
            ? amount || 1
            : amount,
        notes: notes.trim() || undefined,
        details: details(),
        files: allFiles,
        category_id: type !== 'petty_cash' && user?.role !== 'head' && categoryOptions.required ? categoryId || null : null,
        target_head_id: type === 'exhibition' ? null : (targetHeadId || null),
        assigned_entry_user_id: needsEntryAccount && isPaymentNeeded ? assignedEntryUserId || null : null,
        disbursement_mode: isPaymentNeeded ? disbursementMode : null,
        enter_bank_details_later: isPaymentNeeded && disbursementMode === 'bank' ? enterBankDetailsLater : false,
        bank_account_no: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankAccountNo.trim() : null,
        bank_ifsc: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankIfsc.trim().toUpperCase() : null,
        bank_name: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankName.trim() || null : null,
        bank_branch: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankBranch.trim() || null : null,
        bank_account_holder_name: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankAccountHolderName.trim() || null : null,
        bank_verified: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerified : false,
        bank_verification_message: isPaymentNeeded && disbursementMode === 'bank' && !enterBankDetailsLater ? bankVerificationMessage : null,
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
      const submitRes = await submitRequest(
        draftRes.id,
        needsEntryAccount && isPaymentNeeded ? assignedEntryUserId || null : null
      );
      navigate(`/requests/${draftRes.id}`, submitRes.success ? undefined : {
        state: { notice: `Saved as a draft but not submitted: ${submitRes.error}` },
      });
    } catch (err: unknown) {
      console.error('Save request unexpected failure:', err);
      setError(errMsg(err));
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
            {type === 'agreement' || type === 'statutory_payment'
              ? 'Department Head request: Approved directly by Department Head (Admin approval is not required).'
              : 'Department Head request: Bypasses clerk routing and goes directly to Admin for approval.'}
          </p>
        )}
        {user?.role === 'clerk' && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-800 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-purple-600" />
            Clerk request: Goes directly to your Department Head for approval. Select the Disbursement Entry Account below.
          </p>
        )}
        {user?.role === 'employee' && user.regional_head_id && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-cyan-600" />
            {isPettyCash
              ? 'Petty Cash: Goes to your Regional Head first, then directly to the chosen Petty Cash Dealing Head (skipping clerk).'
              : 'Your request goes to your Regional Head first, who forwards it to the clerk.'}
          </p>
        )}
        {isPettyCash && user?.role !== 'head' && !(user?.role === 'employee' && user.regional_head_id) && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1">
            <Wallet className="w-3.5 h-3.5 text-teal-600" />
            Petty Cash (Max ₹1,000): Skips clerk routing and goes directly to the selected Petty Cash Dealing Head.
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
                const prev = type;
                setType(t);
                setError(null);
                if (t === 'petty_cash') {
                  setDisbursementMode('cash');
                } else if (prev === 'petty_cash' && disbursementMode === 'cash') {
                  setDisbursementMode('bank');
                }
                if (t === 'asset_below_20k') {
                  if (quotes.length < 1) setQuotes(initialQuotes(1));
                } else if (t === 'asset') {
                  if (quotes.length < 2) setQuotes(initialQuotes(2));
                }
              }}
              className={`text-left p-4 rounded-2xl border-2 transition-all ${
                type === t
                  ? t === 'petty_cash'
                    ? 'border-teal-600 bg-teal-50 shadow-md shadow-teal-100'
                    : 'border-indigo-600 bg-indigo-50 shadow-md shadow-indigo-100'
                  : t === 'petty_cash'
                  ? 'border-teal-200 bg-white hover:border-teal-400'
                  : 'border-slate-200 bg-white hover:border-indigo-200'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  type === t
                    ? t === 'petty_cash'
                      ? 'bg-teal-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : t === 'petty_cash'
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {TYPE_ICONS[t]}
              </div>
              <div className={`font-bold text-sm mt-2 ${t === 'petty_cash' ? 'text-teal-900' : 'text-slate-900'}`}>{TYPE_LABELS[t]}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{TYPE_DESCRIPTIONS[t]}</div>
            </button>
          ))}
        </div>

        {/* Main details */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-800 font-display">
              {type === 'petty_cash'
                ? 'Petty Cash Form Below 1000'
                : type === 'exhibition'
                ? 'Event Sponsorship & Promotion Form'
                : type === 'discount'
                ? 'Discount Details'
                : type === 'stock_transfer'
                ? 'Stock Transfer Details'
                : isAsset
                ? type === 'asset_below_20k'
                  ? 'Asset Purchase Details (< ₹20k)'
                  : 'Asset Purchase Details'
                : type === 'non_cash'
                ? 'Non-Cash Request Details'
                : type === 'agreement'
                ? 'Agreement Request Details'
                : type === 'statutory_payment'
                ? 'Statutory Payment Request Details'
                : type === 'audit_report'
                ? 'Audit Report Request Details'
                : 'Request Information'}
            </h2>
            {type === 'petty_cash' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 font-bold text-[11px] border border-teal-200">
                <Wallet className="w-3.5 h-3.5 text-teal-600" />
                <span>Max ₹1,000 · Cash Default · Skips Clerk</span>
              </span>
            )}
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

          {type === 'petty_cash' ? (
            user?.role !== 'head' ? (
              <div className="p-4 bg-teal-50/70 border border-teal-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label htmlFor="petty-cash-head" className="text-xs font-bold text-teal-950 flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-teal-600" />
                    <span>Petty Cash Dealing Head <span className="text-rose-500">*</span></span>
                  </label>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100 px-2 py-0.5 rounded-md">
                    Skips Clerk Routing
                  </span>
                </div>
                {loadingPettyDealers ? (
                  <div className="flex items-center gap-2 text-xs text-teal-700 py-1.5 font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading Petty Cash Dealing Heads…</span>
                  </div>
                ) : pettyCashDealers.length === 0 ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                    No Department Head has <strong>Petty Cash Dealer</strong> enabled yet. Ask Admin to enable a Petty Cash Dealer in <strong>Staff → Dept Heads</strong>.
                  </div>
                ) : (
                  <select
                    id="petty-cash-head"
                    value={targetHeadId}
                    onChange={(e) => setTargetHeadId(e.target.value)}
                    disabled={isSubmitting || isSavingDraft}
                    className="w-full text-xs sm:text-sm font-semibold p-3 rounded-xl border border-teal-300 bg-white text-slate-800 focus:border-teal-600 focus:ring-1 focus:ring-teal-600 outline-hidden"
                  >
                    <option value="">-- Select Petty Cash Dealing Head --</option>
                    {pettyCashDealers.map((dealer) => (
                      <option key={dealer.head_id} value={dealer.head_id}>
                        {dealer.head_name} ({dealer.department_name}){dealer.designation ? ` – ${dealer.designation}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-teal-900/80 leading-relaxed">
                  {user?.role === 'employee' && user.regional_head_id
                    ? 'Forwarded to your Regional Head first (who can review or change the Petty Cash Dealing Head), then sent directly to the Head without clerk routing.'
                    : 'Sent directly to this Petty Cash Dealing Head for approval without clerk routing.'}
                </p>
              </div>
            ) : (
              <div className="p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-xl text-xs text-purple-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-purple-600 shrink-0" />
                <span>Department Head Petty Cash request: Goes directly to <strong>Admin</strong> for approval.</span>
              </div>
            )
          ) : type !== 'exhibition' ? (
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

          {!isPettyCash && user?.role !== 'head' && user?.role !== 'clerk' && (
            <WorkCategoryField options={categoryOptions} value={categoryId} onChange={setCategoryId} />
          )}

          {/* Disbursement Entry Account selection (required for Petty Cash, Clerk, and Head Direct requests) */}
          {needsEntryAccount && isPaymentNeeded && (
            <div className={`p-4 rounded-2xl space-y-2.5 border ${isPettyCash ? 'bg-teal-50/50 border-teal-200' : 'bg-indigo-50/70 border-indigo-200'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="head-entry-account" className={`block text-xs font-bold flex items-center gap-1.5 ${isPettyCash ? 'text-teal-950' : 'text-indigo-950'}`}>
                  <UserCheck className={`w-4 h-4 ${isPettyCash ? 'text-teal-600' : 'text-indigo-600'}`} />
                  <span>Disbursement Entry Account <span className="text-rose-500">*</span></span>
                </label>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${isPettyCash ? 'text-teal-700 bg-teal-100' : 'text-indigo-700 bg-indigo-100'}`}>
                  {isPettyCash
                    ? 'Editable by Regional Head & Head'
                    : `Required for ${user?.role === 'clerk' ? 'Clerk' : 'Head Direct'} Request`}
                </span>
              </div>
              <p className={`text-[11px] leading-relaxed ${isPettyCash ? 'text-teal-900/80' : 'text-indigo-900/80'}`}>
                {isPettyCash
                  ? 'Select the Disbursement Entry Account for this Petty Cash request. Regional Head and Petty Cash Dealing Head can also edit this before payment.'
                  : user?.role === 'clerk'
                  ? 'Please select the Disbursement Entry Account who will record the payment entries once this request is approved.'
                  : 'Because your request goes directly to Admin for approval, please select the Disbursement Entry Account who will record the payment entries.'}
              </p>
              {loadingOfficers ? (
                <div className={`flex items-center gap-2 text-xs py-1.5 font-medium ${isPettyCash ? 'text-teal-700' : 'text-indigo-600'}`}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading active entry accounts…</span>
                </div>
              ) : entryOfficers.length === 0 ? (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  No active Disbursement Entry Only accounts found. Please contact Admin.
                </div>
              ) : (
                <select
                  id="head-entry-account"
                  value={assignedEntryUserId}
                  onChange={(e) => setAssignedEntryUserId(e.target.value)}
                  className={`w-full text-xs font-semibold p-2.5 rounded-xl border bg-white text-slate-800 outline-hidden ${
                    isPettyCash
                      ? 'border-teal-300 focus:border-teal-600 focus:ring-1 focus:ring-teal-600'
                      : 'border-indigo-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                  }`}
                >
                  <option value="">-- Choose Disbursement Entry Account --</option>
                  {entryOfficers.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.full_name} (@{officer.username}){officer.designation ? ` – ${officer.designation}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {isPettyCash && (
            <div className="space-y-2 bg-teal-50/40 p-4 rounded-xl border border-teal-200/80">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="petty-cash-amount" className="block text-xs font-bold text-slate-800">
                  Amount in Rupees (₹) <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-bold text-teal-700">Maximum ₹1,000.00</span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-3.5 font-bold text-teal-600 text-base">₹</span>
                <input
                  id="petty-cash-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  max="1000"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00 (up to 1000)"
                  className={`w-full text-base sm:text-sm pl-8 pr-4 py-3 rounded-xl border bg-white outline-hidden font-display font-semibold transition-colors ${
                    baseAmount > 1000
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 text-rose-700'
                      : 'border-teal-300 focus:border-teal-600 focus:ring-1 focus:ring-teal-600 text-slate-900'
                  }`}
                />
              </div>
              {baseAmount > 1000 ? (
                <p className="text-xs font-bold text-rose-600">
                  Amount exceeds ₹1,000. Petty Cash requests are strictly for amounts up to ₹1,000.
                </p>
              ) : baseAmount > 0 ? (
                <span className="text-xs font-semibold text-teal-800 block">
                  Petty Cash amount: {formatINR(baseAmount)}
                </span>
              ) : null}
            </div>
          )}

          {pickShop && (
            <RequestShopField
              state={shopState}
              value={shopId}
              onChange={(id, name) => {
                setShopId(id);
                setShopName(name);
              }}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {/* Disbursement Mode: Cash vs Bank with Penny-Less Auto-fill Verification */}
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
              branch={bankBranch}
              onBranchChange={setBankBranch}
              accountHolderName={bankAccountHolderName}
              onAccountHolderNameChange={setBankAccountHolderName}
              isVerified={bankVerified}
              onVerifiedChange={setBankVerified}
              verificationMessage={bankVerificationMessage}
              onVerificationMessageChange={setBankVerificationMessage}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {!isPettyCash && (
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
                    : type === 'non_cash' ? 'e.g. Branch maintenance clearance / Administrative approval'
                    : type === 'agreement' ? 'e.g. Showroom Lease Renewal Agreement – Calicut'
                    : type === 'statutory_payment' ? 'e.g. Monthly GST / TDS / PF Statutory Remittance'
                    : type === 'audit_report' ? 'e.g. Q3 Internal Stock & Financial Audit Report'
                    : 'e.g. Vendor invoice for showroom lighting'
                }
                className="w-full text-base sm:text-sm p-3.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors"
              />
            </div>
          )}

          {type === 'agreement' && <AgreementBanner />}

          {type === 'statutory_payment' && (
            <StatutoryPaymentFields
              value={statutoryPayment}
              onChange={setStatutoryPayment}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {type === 'audit_report' && (
            <AuditReportFields
              value={auditReport}
              onChange={setAuditReport}
              disabled={isSubmitting || isSavingDraft}
            />
          )}

          {type === 'non_cash' && (
            <NonCashFields
              value={nonCash}
              onChange={setNonCash}
              disabled={isSubmitting || isSavingDraft}
            />
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
          {type === 'exhibition' && (
            <ExhibitionFields
              value={exhibition}
              onChange={setExhibition}
              quotaStatus={exhibitionQuota}
              shopOptions={exhibitionShopState.options}
              shopsLoading={exhibitionShopState.loading}
              disabled={isSubmitting || isSavingDraft}
            />
          )}
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
              {isPettyCash ? (
                <>Note <span className="text-rose-500">*</span></>
              ) : isSpecial ? (
                <>Description <span className="text-rose-500">*</span></>
              ) : type === 'general' ? (
                'Notes & Purpose (Optional)'
              ) : (
                'Remarks (Optional)'
              )}
            </label>
            <textarea
              id="request-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isPettyCash
                  ? 'Describe the petty cash purpose / expense (mandatory)…'
                  : type === 'agreement'
                  ? 'Enter agreement summary, parties involved, key terms…'
                  : type === 'statutory_payment'
                  ? 'Enter statutory payment nature, period, challan / compliance details…'
                  : type === 'audit_report'
                  ? 'Enter audit scope, key observations, or summary notes…'
                  : 'Any extra context for the approvers…'
              }
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
            <span className="text-[11px] text-slate-400">
              {type === 'discount'
                ? 'PDF required'
                : isSpecial
                ? 'Excel, Word, CSV, PDF, PNG, JPG & any Image'
                : 'PDF, JPG, PNG'}
            </span>
          </div>
          <FileUploader
            files={files}
            onAddFiles={(nf) => setFiles((p) => [...p, ...nf])}
            onRemoveFile={(id) => setFiles((p) => p.filter((f) => f.id !== id))}
            allowExtendedDocs={isSpecial}
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
          {isPettyCash && (
            <p className="text-[11px] text-teal-800 font-medium">
              Supporting document is optional. <strong>Petty Cash Form Below 1000</strong> is generated and stamped automatically upon approval (along with any attached documents).
            </p>
          )}
        </div>
        )}

        {/* Voice note */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-800 font-display border-b border-slate-100 pb-2">
            Spoken Explanation <span className="text-slate-400 font-normal text-xs">(optional)</span>
          </h2>
          <VoiceRecorder onRecordingComplete={handleVoiceRecording} onClear={() => setVoiceFile(null)} />
        </div>

        {/* Sticky action bar */}
        <div className="action-bar">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="hidden sm:block text-xs text-slate-500">
              {TYPE_LABELS[type]} ·{' '}
              <span className="font-bold text-slate-800">
                {type === 'non_cash' || type === 'agreement' || type === 'audit_report'
                  ? 'Non-Cash (No Disbursement)'
                  : formatINR(amount)}
              </span>
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
