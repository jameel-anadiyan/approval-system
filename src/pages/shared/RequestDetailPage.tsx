import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { StatusBadge, TypeBadge } from '../../components/common/StatusBadge';
import { DocumentViewer } from '../../components/requests/DocumentViewer';
import { SignedDocuments, VoiceNoteItem } from '../../components/requests/SignedDocuments';
import { EditDraftModal } from '../../components/requests/EditDraftModal';
import { RequestTimeline } from '../../components/requests/RequestTimeline';
import { RequestDetailsPanel } from '../../components/requests/RequestDetailsPanel';
import { QuotationsPanel } from '../../components/requests/AssetQuotations';
import { RouteModal } from '../../components/portals/RouteModal';
import { ApproveModal } from '../../components/portals/ApproveModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RejectModal } from '../../components/portals/RejectModal';
import { ForwardModal } from '../../components/portals/ForwardModal';
import { RegionalForwardModal } from '../../components/portals/RegionalForwardModal';
import { isMyRoutingRequest } from '../../lib/workflow';
import { supabase } from '../../lib/supabase';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { AddDisbursementEntryModal } from '../../components/portals/AddDisbursementEntryModal';
import { ConsultHeadsModal } from '../../components/portals/ConsultHeadsModal';
import { RespondConsultationModal } from '../../components/portals/RespondConsultationModal';
import { DisbursementClarificationModal } from '../../components/portals/DisbursementClarificationModal';
import { RespondClarificationModal } from '../../components/portals/RespondClarificationModal';
import { CancelApprovalModal } from '../../components/portals/CancelApprovalModal';
import { HeadConsultationsSection } from '../../components/requests/HeadConsultationsSection';
import { DisbursementClarificationSection } from '../../components/requests/DisbursementClarificationSection';
import { RequesterProfileCard } from '../../components/requests/RequesterProfileCard';
import { UserAvatar } from '../../components/common/UserAvatar';
import { CompleteTransferModal } from '../../components/portals/CompleteTransferModal';
import {
  formatINR,
  formatINRWhole,
  formatISTDate,
  ROLE_LABELS,
  typeOf,
} from '../../lib/formatters';
import { DisbursementEntry, paymentSummary } from '../../types/database';
import {
  ArrowLeft,
  Send,
  RotateCcw,
  XCircle,
  CornerDownRight,
  CheckCircle2,
  Banknote,
  ShieldAlert,
  Building2,
  FileCheck,
  Copy,
  Check,
  Pencil,
  Trash2,
  Loader2,
  Store,
  Users,
  AlertCircle,
  PlusCircle,
  ThumbsUp,
  ThumbsDown,
  Clock,
  UserCheck,
  HelpCircle,
  Ban,
  AlertTriangle,
  MapPin,
  PackageCheck,
  Truck,
} from 'lucide-react';

export const RequestDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role } = useAuth();
  const {
    getRequestById,
    isLoading,
    threshold,
    submitRequest,
    withdrawRequest,
    deleteDraft,
    routeRequest,
    forwardRequest,
    regionalForwardRequest,
    returnRequest,
    rejectRequest,
    approveRequest,
    markAsPaid,
    addDisbursementEntry,
    cancelApprovedRequest,
    selectQuote,
    decideExhibitionWaitlist,
    deleteSpecificRequest,
    markTransferComplete,
  } = useRequests();

  const [modalState, setModalState] = useState<
    'route' | 'approve' | 'return' | 'reject' | 'forward' | 'regional_forward' | 'pay' | 'add_disb_entry' | 'edit' | 'consult' | 'consult_respond' | 'disb_clarify' | 'disb_respond' | 'cancel' | 'complete_transfer' | null
  >(null);
  const [selectedEntry, setSelectedEntry] = useState<DisbursementEntry | null>(null);
  const [consultInitialStatus, setConsultInitialStatus] = useState<'agreed' | 'disagreed' | null>(null);
  const [copiedNo, setCopiedNo] = useState(false);
  const [busy, setBusy] = useState(false);
  const actionLockRef = useRef(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(
    (location.state as { notice?: string } | null)?.notice
      ? { ok: false, text: (location.state as { notice: string }).notice }
      : null
  );

  const request = id ? getRequestById(id) : undefined;

  const handleDeleteRequestPermanently = async () => {
    if (!request) return;
    const reqNo = request.request_no || 'this draft';
    const conf = confirm(
      `Are you sure you want to PERMANENTLY DELETE ${reqNo}?\n\nThis will completely erase the request from all departments, including disbursement, clerk queues, and reports. This action cannot be undone.`
    );
    if (!conf) return;

    setBusy(true);
    const res = await deleteSpecificRequest(request.id);
    setBusy(false);
    if (res.success) {
      navigate('/admin', {
        state: { notice: `Request ${reqNo} has been permanently deleted.` },
      });
    } else {
      setBanner({ text: res.error || 'Failed to delete request.', ok: false });
    }
  };

  // The department Head may forward / return on the Regional Head's behalf only when that
  // Regional Head has been deactivated (the server enforces the same rule).
  const [regionalHeadInactive, setRegionalHeadInactive] = useState(false);
  const waitingRegionalId =
    role === 'head' && request?.status === 'pending_regional_review' ? request.regional_head_id ?? null : null;
  useEffect(() => {
    if (!waitingRegionalId) {
      setRegionalHeadInactive(false);
      return;
    }
    let alive = true;
    supabase
      .from('profiles')
      .select('is_active')
      .eq('id', waitingRegionalId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setRegionalHeadInactive(!data?.is_active);
      });
    return () => {
      alive = false;
    };
  }, [waitingRegionalId]);

  if (!request && isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 flex justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-lg font-bold text-slate-800">Request Not Found</h2>
        <p className="text-xs text-slate-500 mt-1">
          The request does not exist, was deleted, or you do not have access to it.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold"
        >
          Return to Portal
        </button>
      </div>
    );
  }

  const isOwner = user?.id === request.requester_id;

  // Inter-department consultations & strict role isolation:
  const consultations = request.consultations || [];
  const myConsultation = consultations.find((c) => c.head_id === user?.id);

  // A consulted head is ANY head assigned in consultations OR from another department
  const isConsultedHead = role === 'head' && (Boolean(myConsultation) || user?.department_id !== request.department_id);

  // Strict Owning Head:
  // Must be role === 'head', NOT the requester, NOT a consulted head, and MUST belong to the request's department or match owner_head_id!
  const isOwningHead =
    role === 'head' &&
    !isOwner &&
    !myConsultation &&
    ((Boolean(request.owner_head_id) && user?.id === request.owner_head_id) ||
      (Boolean(user?.department_id) && user?.department_id === request.department_id));

  // If any consultation is pending or disagreed, forwarding to Admin and Approval are blocked!
  const pendingConsultations = consultations.filter((c) => c.status === 'pending');
  const disagreedConsultations = consultations.filter((c) => c.status === 'disagreed');
  const hasPendingConsultations = pendingConsultations.length > 0;
  const hasDisagreedConsultations = disagreedConsultations.length > 0;
  const isConsultationBlocked = hasPendingConsultations || hasDisagreedConsultations;

  let consultationBlockReason = '';
  if (hasPendingConsultations && hasDisagreedConsultations) {
    consultationBlockReason = `Approval & Forwarding blocked: Awaiting review response from ${pendingConsultations.map((c) => c.head_name).join(', ')}, and disagreed by ${disagreedConsultations.map((c) => c.head_name).join(', ')}.`;
  } else if (hasPendingConsultations) {
    consultationBlockReason = `Approval & Forwarding blocked: Awaiting review response from ${pendingConsultations.map((c) => c.head_name).join(', ')}.`;
  } else if (hasDisagreedConsultations) {
    consultationBlockReason = `Approval & Forwarding blocked: One or more consulted department heads (${disagreedConsultations.map((c) => c.head_name).join(', ')}) disagreed with this request.`;
  }

  const isFinalized = ['approved', 'rejected', 'paid', 'withdrawn', 'cancelled'].includes(request.status);
  const canRequestConsultation =
    (isOwningHead || role === 'admin') &&
    request.status !== 'draft' &&
    !isFinalized;

  const rType = typeOf(request);
  const isDisbursement = role === 'disbursement';
  const isStockMonitorUser = isDisbursement && user?.disbursement_type === 'stock_transfer_monitor';
  const isEntryOnly = isDisbursement && !isStockMonitorUser && (user?.disbursement_type === 'entry_only' || !user?.disbursement_type);
  const isPaymentOnly = isDisbursement && user?.disbursement_type === 'payment_only';
  const canAddDisbursementEntry = isEntryOnly || role === 'admin';
  const canDisbursePayment = isPaymentOnly || role === 'admin';
  const isApprovedTransfer = rType === 'stock_transfer' && request.status === 'approved';
  const canCompleteTransfer = isApprovedTransfer && !request.transfer_completed_at && (role === 'admin' || isStockMonitorUser);

  const entries: DisbursementEntry[] = useMemo(() => {
    return (request.disbursement_entries || []).filter((e) => e.status !== 'cancelled');
  }, [request.disbursement_entries]);

  const pendingEntries = useMemo(() => {
    return entries.filter((e) => e.status === 'pending');
  }, [entries]);

  const totalEntered = useMemo(() => {
    return entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  }, [entries]);

  const remainingUnentered = useMemo(() => {
    return Math.max(0, Math.round(((request.amount || 0) - totalEntered) * 100) / 100);
  }, [request.amount, totalEntered]);

  const nextEntryNo = useMemo(() => {
    return entries.reduce((m, e) => Math.max(m, e.entry_no || 0), 0) + 1;
  }, [entries]);

  const firstPendingEntry = pendingEntries[0] || null;

  const isHighValue = rType === 'general' && request.amount > threshold;
  const isAsset = rType === 'asset' || rType === 'asset_below_20k';
  // Asset buying: the owning Head (or Admin when it reached Admin directly) selects the best quotation.
  const quoteSelectorRole: 'head' | 'admin' | null = !isAsset ? null
    : isOwningHead && (request.status === 'pending_head_review' || request.status === 'pending_head_approval') ? 'head'
    : role === 'admin' && request.status === 'pending_admin_approval' && !request.selected_quote_id ? 'admin'
    : null;
  const canSelectQuote = !!quoteSelectorRole && !isConsultationBlocked;
  const needsQuote = isAsset && !request.selected_quote_id;
  const approveBlocked = isConsultationBlocked || needsQuote;
  const approveBlockReason = isConsultationBlocked ? consultationBlockReason
    : needsQuote ? 'Select the best quotation first' : undefined;
  const amountLabel =
    rType === 'discount' ? 'Discount Value' : rType === 'stock_transfer' ? 'Total MRP Value' : rType === 'exhibition' ? 'Total Sponsorship (incl. GST)'
      : isAsset ? (request.selected_quote_id ? 'Selected Quotation Amount' : 'Indicative Amount (Head selects final)')
      : 'Total Requested Amount';
  const voiceNotes = (request.files || []).filter((f) => {
    if (f.kind !== 'voice_note') return false;
    // Regional heads only see requester voice notes or their own voice notes (NOT clerk, admin, head)
    if (role === 'regional_head') {
      return !f.added_by || f.added_by === user?.id;
    }
    // Clerks, heads, and admins can view all voice notes
    if (role === 'admin' || role === 'head' || role === 'clerk') return true;
    // Requester only sees their own audio notes
    return !f.added_by || f.added_by === user?.id || f.added_by === request.requester_id;
  });
  // Disbursement only ever sees the stamped output, never the originals (storage policy agrees).
  const showOriginals = role !== 'disbursement';
  const editable = isOwner && (request.status === 'draft' || request.status === 'returned');
  const pay = paymentSummary(request);
  const payments = request.payments || [];
  const clarifications = request.disbursement_clarifications || [];
  const latestClarification = clarifications[0];
  const isPendingDisbursementClarification = latestClarification?.status === 'pending_head';
  // Owner Head (or current head of the request's department) may cancel any time before full payment.
  const canCancelApproval =
    role === 'head' &&
    request.status === 'approved' &&
    (request.owner_head_id === user?.id || (Boolean(user?.department_id) && user?.department_id === request.department_id));
  const originalDocs = (request.files || []).filter((f) => f.kind === 'document' && !f.clarification_id);
  // Regional Head: forward to clerk or return (never approve / reject).
  const canRegionalAct =
    request.status === 'pending_regional_review' &&
    !isOwner &&
    ((role === 'regional_head' && request.regional_head_id === user?.id) ||
      (role === 'head' && user?.department_id === request.department_id && regionalHeadInactive));
  // Clerk: only the clerk(s) of the request's work category route / return it.
  const canClerkAct = role === 'clerk' && isMyRoutingRequest(request, user);

  const canDecideWaitlist =
    request.is_waitlist &&
    !request.waitlist_approved_at &&
    request.status !== 'rejected' &&
    request.status !== 'withdrawn' &&
    (role === 'admin' || (role === 'head' && user?.can_view_exhibition_waitlist));

  const latestReturnAction = useMemo(() => {
    return (request.actions || [])
      .filter((a) => a.action === 'returned')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }, [request.actions]);

  const copyApprovalNo = (no: string) => {
    navigator.clipboard.writeText(no);
    setCopiedNo(true);
    setTimeout(() => setCopiedNo(false), 2000);
  };

  /** Turns a context result into a thrown error so the open modal can show it. */
  const orThrow = async (p: Promise<{ success: boolean; error?: string }>, okText?: string) => {
    const res = await p;
    if (!res.success) throw new Error(res.error || 'Action failed');
    if (okText) setBanner({ ok: true, text: okText });
  };

  const runInline = async (fn: () => Promise<{ success: boolean; error?: string }>, okText: string) => {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fn();
      setBanner(res.success ? { ok: true, text: okText } : { ok: false, text: res.error || 'Action failed' });
      return res.success;
    } finally {
      setBusy(false);
      actionLockRef.current = false;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-1 sm:px-4 py-4 sm:py-8 has-action-bar">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors shrink-0 shadow-xs"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                {request.request_no || 'UNSUBMITTED DRAFT'}
              </span>
              <TypeBadge type={rType} />
              {request.approval_no && (
                <button
                  type="button"
                  onClick={() => copyApprovalNo(request.approval_no!)}
                  className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1 hover:bg-emerald-100 transition-colors"
                  title="Click to copy approval number"
                >
                  <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{request.approval_no}</span>
                  {copiedNo ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-emerald-600" />}
                </button>
              )}
              {request.route && (
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                    request.route === 'A'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-purple-50 text-purple-700 border border-purple-200'
                  }`}
                >
                  Route {request.route}
                </span>
              )}
              {request.owner_head_name && (
                <span
                  id="detail-owner-head-badge"
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs"
                  title="Request Owner Head"
                >
                  <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Head: {request.owner_head_name}</span>
                </span>
              )}
              {request.is_waitlist && (
                <span
                  id="detail-waitlist-badge"
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-200 shadow-2xs"
                  title="Special Waiting List Exhibition"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Special Waiting List</span>
                </span>
              )}
              {request.region_name && (
                <span
                  id="detail-region-badge"
                  className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs"
                  title="Region"
                >
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span>{request.region_name}</span>
                </span>
              )}
            </div>
            <h1 className="text-lg sm:text-2xl font-extrabold text-slate-900 font-display mt-1">
              {request.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {canRequestConsultation && (
            <button
              type="button"
              id="request-other-head-header-btn"
              onClick={() => setModalState('consult')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-200 transition-all shrink-0 cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>Request Other Head</span>
            </button>
          )}
          {role === 'admin' && (
            <button
              type="button"
              id="admin-delete-request-header-btn"
              onClick={handleDeleteRequestPermanently}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs shadow-xs transition-all shrink-0 cursor-pointer disabled:opacity-50"
              title="Permanently delete this request completely from the database and all dashboards"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Delete Request</span>
            </button>
          )}
          <StatusBadge status={request.status} requestType={rType} size="lg" showDescription />
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className={`mb-4 p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
            banner.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="font-bold opacity-60 hover:opacity-100" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {request.is_waitlist && (
        <div
          id="waitlist-banner"
          className="mb-4 p-4 sm:p-5 rounded-2xl bg-linear-to-r from-rose-50/90 via-red-50/60 to-white border-2 border-rose-300 shadow-xs flex items-start gap-3.5 animate-in fade-in"
        >
          <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div className="text-xs space-y-2 min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-rose-950 font-display">
                  Special Waiting List Exhibition
                </p>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-rose-200/80 text-rose-900 border border-rose-300">
                  Low Chance of Approval
                </span>
              </div>
              {request.region_name && (
                <span className="text-[11px] font-semibold text-rose-800 bg-rose-100/70 border border-rose-200/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-rose-500" />
                  Region: {request.region_name}
                </span>
              )}
            </div>

            <p className="text-rose-900 leading-relaxed font-medium">
              This exhibition request was submitted outside the standard daily quota (daily regional slots claimed by another Regional Head).
              {request.waitlist_approved_at ? (
                <span className="block mt-1 text-emerald-800 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                  Approved by Department Head on {formatISTDate(request.waitlist_approved_at)}.
                </span>
              ) : (
                <span className="block mt-1 text-rose-800 font-semibold">
                  Awaiting review and approval by an authorized Department Head before standard processing.
                </span>
              )}
            </p>

            {canDecideWaitlist && (
              <div className="pt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runInline(async () => {
                      return await decideExhibitionWaitlist(request.id, 'approve', 'Special Waiting List Exhibition approved by Head');
                    }, 'Special Waiting List Exhibition approved!')
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve Special Waitlist</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runInline(async () => {
                      return await decideExhibitionWaitlist(request.id, 'reject', 'Special Waiting List Exhibition rejected');
                    }, 'Special Waiting List Exhibition rejected.')
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-semibold text-xs border border-rose-200 transition-colors cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject Special Waitlist</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {request.status === 'cancelled' && (
        <div
          id="cancelled-banner"
          className="mb-4 p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-white border border-rose-200 shadow-xs flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Ban className="w-5 h-5" />
          </div>
          <div className="text-xs space-y-1 min-w-0">
            <p className="text-sm font-extrabold text-rose-950 font-display">Approval cancelled</p>
            <p className="text-rose-800">
              Cancelled by <strong>{request.cancelled_by_name || 'Head'}</strong>
              {request.cancelled_at && <> on {formatISTDate(request.cancelled_at)}</>}. Signed documents for{' '}
              {request.approval_no || 'this approval'} are void.
              {rType !== 'discount' && rType !== 'non_cash' && rType !== 'stock_transfer' && pay.paid > 0 && (
                <> {formatINR(pay.paid)} was paid before cancellation; the balance {formatINR(pay.balance)} will not be paid.</>
              )}
            </p>
            {request.cancel_reason && (
              <p className="text-slate-700 bg-white/80 border border-rose-100 rounded-lg px-2.5 py-1.5 break-words">
                “{request.cancel_reason}”
              </p>
            )}
          </div>
        </div>
      )}

      {isApprovedTransfer && (
        <div
          id="transfer-status-banner"
          className={`mb-4 p-4 rounded-2xl border shadow-xs flex items-start gap-3 ${
            request.transfer_completed_at
              ? 'bg-gradient-to-r from-emerald-50 to-white border-emerald-200'
              : 'bg-gradient-to-r from-amber-50 to-white border-amber-200'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs ${
            request.transfer_completed_at ? 'bg-emerald-600' : 'bg-amber-500'
          }`}>
            {request.transfer_completed_at ? <PackageCheck className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
          </div>
          <div className="text-xs space-y-1 min-w-0 flex-1">
            {request.transfer_completed_at ? (
              <>
                <p className="text-sm font-extrabold text-emerald-950 font-display">Transfer completed</p>
                <p className="text-emerald-800">
                  Marked complete by <strong>{request.transfer_completed_by_name || 'Stock Transfer Monitor'}</strong> on{' '}
                  {formatISTDate(request.transfer_completed_at)}.
                </p>
                {request.transfer_completed_remarks && (
                  <p className="text-slate-700 bg-white/80 border border-emerald-100 rounded-lg px-2.5 py-1.5 break-words">
                    “{request.transfer_completed_remarks}”
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-extrabold text-amber-950 font-display">Awaiting transfer</p>
                <p className="text-amber-800">
                  Approved — the stock has not yet been confirmed as received at{' '}
                  <strong>{request.details?.to_shop_name || 'the destination shop'}</strong>.
                </p>
              </>
            )}
          </div>
          {canCompleteTransfer && (
            <button
              type="button"
              id="mark-transfer-complete-banner-btn"
              onClick={() => setModalState('complete_transfer')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 shrink-0 transition-all active:scale-95"
            >
              <PackageCheck className="w-4 h-4" /> Mark Complete
            </button>
          )}
        </div>
      )}

      {request.status === 'returned' && (
        <div
          id="returned-banner"
          className="mb-4 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-50/90 via-amber-50/60 to-white border-2 border-amber-300 shadow-sm flex items-start gap-3.5 animate-in fade-in"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div className="text-xs space-y-2 min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-extrabold text-amber-950 font-display">
                Returned for Correction
              </p>
              {latestReturnAction?.created_at && (
                <span className="text-[11px] font-semibold text-amber-800 bg-amber-100/70 border border-amber-200/80 px-2 py-0.5 rounded-md">
                  {formatISTDate(latestReturnAction.created_at)}
                </span>
              )}
            </div>

            <p className="text-amber-900 leading-relaxed font-medium">
              Returned by{' '}
              <strong>{latestReturnAction?.actor_name || 'Reviewer'}</strong>
              {latestReturnAction?.actor_role ? ` (${ROLE_LABELS[latestReturnAction.actor_role] || latestReturnAction.actor_role})` : ''}.
              {isOwner
                ? ' Please review the return remarks below, click Edit to update details or attachments, then click Resubmit.'
                : ` Waiting for ${request.requester_name} to make corrections and resubmit.`}
            </p>

            {latestReturnAction?.remarks && (
              <div className="text-slate-800 bg-white border border-amber-200 rounded-xl p-3.5 font-medium text-xs break-words shadow-2xs leading-relaxed">
                <span className="font-bold text-amber-900 block mb-1">Reason / Instructions for correction:</span>
                “{latestReturnAction.remarks}”
              </div>
            )}

            {isOwner && (
              <div className="pt-1 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  id="returned-edit-btn"
                  onClick={() => setModalState('edit')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit Request</span>
                </button>
                <button
                  type="button"
                  id="returned-resubmit-btn"
                  disabled={busy}
                  onClick={() =>
                    runInline(async () => {
                      const res = await submitRequest(request.id);
                      return res;
                    }, 'Request resubmitted.')
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Resubmit</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main 2-Column Responsive Layout (Stacked on mobile, 2-column on desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (Details, Documents, Voice Note) - 7 cols on lg */}
        <div className="lg:col-span-7 space-y-6">
          {/* Key Amount & Summary Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {amountLabel}
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display mt-0.5">
                  {rType === 'non_cash' ? 'Non Cash' : formatINR(request.amount)}
                </div>
              </div>
              {isHighValue && (
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                    <span>High Value (&gt; {formatINRWhole(threshold)})</span>
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div className="flex items-center gap-2.5">
                <UserAvatar
                  photoPath={request.requester?.photo_path ?? request.requester_photo_path ?? null}
                  name={request.requester_name}
                  size="sm"
                  previewable
                  className="shadow-xs shrink-0"
                />
                <div className="min-w-0">
                  <span className="text-slate-400 font-medium block">Requester</span>
                  <span className="font-bold text-slate-800 mt-0.5 block truncate">
                    {request.requester_name}
                  </span>
                  <span className="text-[11px] text-slate-500 capitalize truncate block">
                    {ROLE_LABELS[request.requester_role] || request.requester_role}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Department</span>
                <span className="font-bold text-slate-800 mt-0.5 block flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {request.department?.name || 'Department'}
                </span>
                <span className="text-[11px] text-slate-500">
                  Code: {request.department?.code || '—'}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <UserAvatar
                  photoPath={request.owner_head?.photo_path ?? null}
                  name={request.owner_head_name || 'Department Head'}
                  size="sm"
                  previewable
                  className="shadow-xs shrink-0 ring-1 ring-indigo-200"
                />
                <div className="min-w-0">
                  <span className="text-slate-400 font-medium block">Request Owner Head</span>
                  <span className="font-bold text-indigo-900 mt-0.5 block truncate">
                    {request.owner_head_name || 'Unassigned'}
                  </span>
                  <span className="text-[11px] text-slate-500 truncate block">
                    {request.department?.code ? `${request.department.code} Head` : 'Department Head'}
                  </span>
                </div>
              </div>
              {request.shop_name && (
                <div className="col-span-2">
                  <span className="text-slate-400 font-medium block">Shop</span>
                  <span className="font-bold text-slate-800 mt-0.5 flex items-center gap-1">
                    <Store className="w-3.5 h-3.5 text-slate-400" />
                    {request.shop_name}
                  </span>
                </div>
              )}
              {request.regional_head_name && (
                <div>
                  <span className="text-slate-400 font-medium block">Regional Head</span>
                  <span className="font-bold text-cyan-900 mt-0.5 flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5 text-cyan-600" />
                    {request.regional_head_name}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {request.regional_forwarded_at
                      ? `Forwarded ${formatISTDate(request.regional_forwarded_at, false)}`
                      : request.status === 'pending_regional_review'
                        ? 'Waiting to forward'
                        : 'Did not forward'}
                  </span>
                </div>
              )}
              {request.category_name && (
                <div>
                  <span className="text-slate-400 font-medium block">Work Category</span>
                  <span className="font-bold text-indigo-800 mt-0.5 block">{request.category_name}</span>
                </div>
              )}
              <div>
                <span className="text-slate-400 font-medium block">Submitted Date</span>
                <span className="font-semibold text-slate-700 mt-0.5 block">
                  {formatISTDate(request.submitted_at || request.created_at)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Last Updated</span>
                <span className="font-semibold text-slate-700 mt-0.5 block">
                  {formatISTDate(request.updated_at)}
                </span>
              </div>
            </div>

            {request.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 block mb-1">
                  Purpose / Notes
                </span>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/60">
                  {request.notes}
                </p>
              </div>
            )}
          </div>

          <RequestDetailsPanel request={request} />

          {isAsset && showOriginals && (
            <QuotationsPanel
              request={request}
              canSelect={canSelectQuote}
              selectorRole={quoteSelectorRole}
              threshold={threshold}
              onSelect={async (fileId, remarks) => {
                const res = await selectQuote(request.id, fileId, remarks);
                if (res.success) {
                  setBanner({
                    ok: true,
                    text: res.status === 'pending_admin_approval' && quoteSelectorRole === 'head'
                      ? 'Quotation selected. Above the limit, so it has been sent to Admin for approval.'
                      : 'Quotation selected. You can now approve & sign.',
                  });
                }
                return res;
              }}
            />
          )}

          {/* Inter-Department Head Consultations Section */}
          {request.consultations && request.consultations.length > 0 ? (
            <HeadConsultationsSection
              consultations={request.consultations}
              requestId={request.id}
              canRequestMore={canRequestConsultation}
              requestStatus={request.status}
              onRequestMore={() => setModalState('consult')}
              ownerHeadName={request.owner_head_name ?? undefined}
            />
          ) : (
            canRequestConsultation && (
              <div className="bg-white rounded-2xl border border-purple-200/90 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 font-display">
                      Need Other Department Head's Approval / Review?
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Send a request to other department heads to review this document and indicate Agree or Disagree.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  id="request-other-head-card-btn"
                  onClick={() => setModalState('consult')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-200 transition-all self-start sm:self-auto shrink-0 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Request Other Head</span>
                </button>
              </div>
            )
          )}

          {/* Voice Notes (if present) */}
          {showOriginals && voiceNotes.map((vn) => <VoiceNoteItem key={vn.id} file={vn} />)}

          {/* Document Viewer (PDF or Photos) */}
          {showOriginals && originalDocs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Attached Invoices &amp; Documents
                </h3>
                <span className="text-xs text-slate-400">
                  {originalDocs.length} file(s)
                </span>
              </div>
              <DocumentViewer key={originalDocs.map((f) => f.id).join(',')} files={originalDocs} />
            </div>
          )}

          {editable && rType === 'general' && !(request.files || []).some((f) => f.kind === 'document') && (
            <div className="p-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 text-xs text-amber-900">
              No document attached yet. Use <strong>Edit</strong> to attach at least one invoice or bill before submitting.
            </div>
          )}

          {/* Disbursement Clarification Section */}
          <DisbursementClarificationSection request={request} isOwningHead={isOwningHead || role === 'admin'} />

          {/* Signed Approval Packet Card (when approved or paid) */}
          {(request.status === 'approved' || request.status === 'paid' || request.status === 'cancelled') && (
            <div className={request.status === 'cancelled' ? 'relative opacity-60 grayscale pointer-events-auto' : undefined}>
              {request.status === 'cancelled' && (
                <span className="absolute top-3 right-3 z-10 text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md bg-rose-600 text-white rotate-3 shadow">
                  Void
                </span>
              )}
              <SignedDocuments request={request} />
            </div>
          )}

          {rType !== 'discount' && rType !== 'non_cash' && rType !== 'stock_transfer' && (request.status === 'paid' || ((request.status === 'approved' || request.status === 'cancelled') && (pay.paid > 0 || (request.disbursement_entries?.length || 0) > 0))) && (
            <div className="bg-white rounded-2xl border border-teal-200 p-4 sm:p-5 shadow-xs text-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-teal-800 text-sm">
                  <Banknote className="w-4 h-4" /> Payments &amp; Disbursement Entries
                </div>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                    pay.paid === 0
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : pay.balance > 0
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-teal-50 text-teal-700 border-teal-200'
                  }`}
                >
                  {pay.paid === 0 ? 'Awaiting Payment' : pay.balance > 0 ? 'Partially paid' : 'Paid in full'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-center min-w-0">
                  <p className="text-[10px] text-slate-500 uppercase">Approved</p>
                  <p className="font-bold text-slate-800 truncate">{formatINR(request.amount)}</p>
                </div>
                <div className="rounded-xl bg-teal-50 border border-teal-200 p-2.5 text-center min-w-0">
                  <p className="text-[10px] text-teal-600 uppercase">Paid</p>
                  <p className="font-bold text-teal-800 truncate">{formatINR(pay.paid)}</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-center min-w-0">
                  <p className="text-[10px] text-amber-600 uppercase">Balance</p>
                  <p className="font-bold text-amber-800 truncate">{formatINR(pay.balance)}</p>
                </div>
              </div>

              {/* Disbursement Entries List if applicable */}
              {(request.status === 'approved' || request.status === 'paid' || entries.length > 0) && (
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-sky-600" />
                      <span className="font-bold text-slate-800 text-xs">
                        Disbursement Entries ({entries.length})
                      </span>
                      {entries.length > 0 && (
                        <span className="text-[11px] text-slate-500 font-mono">
                          · {formatINR(totalEntered)} entered of {formatINR(request.amount)}
                        </span>
                      )}
                    </div>

                    {canAddDisbursementEntry && request.status === 'approved' && remainingUnentered > 0 && !isPendingDisbursementClarification && (
                      <button
                        type="button"
                        onClick={() => setModalState('add_disb_entry')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-sky-300 bg-sky-50 text-sky-800 text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer shadow-2xs"
                      >
                        <PlusCircle className="w-3.5 h-3.5 text-sky-600" />
                        <span>+ Add Entry #{nextEntryNo}</span>
                      </button>
                    )}
                  </div>

                  {entries.length === 0 ? (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          {canAddDisbursementEntry
                            ? 'No payment entries created yet. Click "+ Add Entry #1" to record the first entry with TDS indication.'
                            : 'Awaiting payment entries from an Entry Only account before disbursement can proceed.'}
                        </span>
                      </div>
                      {canAddDisbursementEntry && request.status === 'approved' && !isPendingDisbursementClarification && (
                        <button
                          type="button"
                          onClick={() => setModalState('add_disb_entry')}
                          className="shrink-0 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-sky-600 text-white font-bold text-xs hover:bg-sky-700 transition-colors cursor-pointer"
                        >
                          + Add Entry #1
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {entries.map((ent) => {
                        const isEntryPending = ent.status === 'pending';
                        return (
                          <div
                            key={ent.id}
                            className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-colors ${
                              isEntryPending ? 'bg-sky-50/40 border-sky-200' : 'bg-slate-50/70 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="font-mono font-extrabold text-sky-900 bg-sky-100/90 px-2 py-0.5 rounded-md text-[11px]">
                                Entry #{ent.entry_no}
                              </span>
                              <span className="font-extrabold text-slate-900 font-mono text-xs">
                                {formatINR(ent.amount)}
                              </span>
                              <span
                                className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                                  ent.tds_cut
                                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                                    : 'bg-slate-200 text-slate-700 border-slate-300'
                                }`}
                              >
                                {ent.tds_cut ? 'TDS Cut' : 'TDS Not Cut'}
                              </span>
                              {ent.notes && (
                                <span className="text-[11px] text-slate-500 italic truncate max-w-xs">
                                  · {ent.notes}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                              {isEntryPending ? (
                                canDisbursePayment && !isPendingDisbursementClarification && request.status === 'approved' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedEntry(ent);
                                      setModalState('pay');
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                                  >
                                    <Banknote className="w-3.5 h-3.5" />
                                    <span>Pay Entry #{ent.entry_no} ({formatINR(ent.amount)})</span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    {isPendingDisbursementClarification
                                      ? 'On Hold'
                                      : isEntryOnly
                                      ? 'Awaiting Payment'
                                      : 'Pending'}
                                  </span>
                                )
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Paid</span>
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {payments.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <span className="font-bold text-slate-700 text-xs block mb-1">
                    Settled Payments ({payments.length})
                  </span>
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {payments.map((p, i) => (
                      <li key={p.id || i} className="p-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800">
                            #{i + 1} · {formatISTDate(p.payment_date, false)}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {[p.payment_mode, p.payment_ref, p.paid_by_name].filter(Boolean).join(' · ') || '—'}
                          </p>
                          {p.remarks && <p className="text-[11px] text-slate-500 italic break-words">{p.remarks}</p>}
                        </div>
                        <span className="font-bold text-teal-700 shrink-0">{formatINR(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                (request.status === 'paid' || request.paid_at) && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <div>
                      <span className="text-slate-400 block">Paid on</span>
                      <span className="font-semibold text-slate-800">{formatISTDate(request.paid_at)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Mode / Ref</span>
                      <span className="font-semibold text-slate-800 break-all">
                        {[request.payment_mode, request.payment_ref].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Right Column (Timeline & Actions) - 5 cols on lg */}
        <div className="lg:col-span-5 space-y-6">
          {/* Requested Person Profile Card (Side panel on desktop, stacked on mobile) */}
          <RequesterProfileCard request={request} />

          {/* Workflow Timeline Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 font-display mb-4 pb-2 border-b border-slate-100 flex items-center justify-between">
              <span>Workflow Audit Trail</span>
              <span className="text-[11px] text-slate-400 font-normal">
                {request.actions?.length || 0} steps
              </span>
            </h3>

            <RequestTimeline actions={request.actions || []} />
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar with Role-based workflow controls */}
      <div className="action-bar">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-500 hidden sm:block">
            Signed in as: <strong className="text-slate-800">{user?.full_name}</strong> ({role ? ROLE_LABELS[role] ?? role : ''})
          </div>

          <div className="action-bar-buttons flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
            {/* Universal Request Other Head button for Owning Head & Admin (Only 1 button in bottom bar) */}
            {canRequestConsultation && (
              <button
                type="button"
                id="request-other-head-bar-btn"
                onClick={() => setModalState('consult')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 font-bold text-xs transition-colors cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-purple-600" />
                <span>Request Other Head</span>
              </button>
            )}

            {/* Warning when inter-department consultation blocks Forwarding or Approval */}
            {isConsultationBlocked && (isOwningHead || role === 'admin') && (
              <div
                role="status"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold max-w-md"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{consultationBlockReason}</span>
              </div>
            )}

            {/* Consulted Head Actions: Agree, Disagree, and Revise Decision directly in bottom bar */}
            {isConsultedHead && myConsultation && (
              myConsultation.status === 'pending' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-purple-950 bg-purple-50 border border-purple-200 px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-2xs">
                    <Clock className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                    <span>Your Review Decision:</span>
                  </span>

                  <button
                    type="button"
                    id="bar-consult-disagree-btn"
                    onClick={() => {
                      setConsultInitialStatus('disagreed');
                      setModalState('consult_respond');
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 font-bold text-xs shadow-xs transition-all cursor-pointer"
                  >
                    <ThumbsDown className="w-3.5 h-3.5 text-rose-600" />
                    <span>Disagree</span>
                  </button>

                  <button
                    type="button"
                    id="bar-consult-agree-btn"
                    onClick={() => {
                      setConsultInitialStatus('agreed');
                      setModalState('consult_respond');
                    }}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 transition-all cursor-pointer"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Agree</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <div
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border shadow-2xs ${
                      myConsultation.status === 'agreed'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-rose-50 text-rose-800 border-rose-300'
                    }`}
                  >
                    {myConsultation.status === 'agreed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>You {myConsultation.status.toUpperCase()}</span>
                    {myConsultation.response_remarks && (
                      <span className="text-[11px] font-normal text-slate-600 max-w-[140px] truncate">
                        — "{myConsultation.response_remarks}"
                      </span>
                    )}
                  </div>

                  {!isFinalized && (
                    <button
                      type="button"
                      id="bar-revise-consult-btn"
                      onClick={() => {
                        setConsultInitialStatus(
                          myConsultation.status === 'agreed' ? 'disagreed' : 'agreed'
                        );
                        setModalState('consult_respond');
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-200 transition-all cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>
                        Revise Decision (Switch to {myConsultation.status === 'agreed' ? 'Disagree' : 'Agree'})
                      </span>
                    </button>
                  )}
                </div>
              )
            )}

            {/* Read-only notice if head from another department is viewing without being consulted */}
            {isConsultedHead && !myConsultation && (
              <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold">
                <Users className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Reviewer Mode · Request belongs to {request.department?.name || 'other department'}
                </span>
              </div>
            )}

            {/* Requester Actions on Draft or Returned */}
            {editable && (
              <button
                type="button"
                id="edit-request"
                onClick={() => setModalState('edit')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
              >
                <Pencil className="w-3.5 h-3.5 text-slate-400" />
                <span>Edit</span>
              </button>
            )}

            {isOwner && request.status === 'draft' && !request.request_no && (
              <button
                type="button"
                id="delete-draft"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Delete this draft and its attachments? This cannot be undone.')) return;
                  setBusy(true);
                  const res = await deleteDraft(request.id);
                  setBusy(false);
                  if (res.success) navigate('/my', { replace: true });
                  else setBanner({ ok: false, text: res.error || 'Could not delete draft' });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}

            {editable && (
              <button
                type="button"
                id="submit-request"
                disabled={busy}
                onClick={() =>
                  runInline(async () => {
                    const res = await submitRequest(request.id);
                    return res;
                  }, request.status === 'returned' ? 'Request resubmitted.' : 'Request submitted.')
                }
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs shadow-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{request.status === 'returned' ? 'Resubmit' : 'Submit Request'}</span>
              </button>
            )}

            {isOwner && (
              request.status === 'submitted' ||
              request.status === 'pending_regional_review' ||
              request.status === 'returned' ||
              (role === 'head' && request.status === 'pending_admin_approval')
            ) && (
              <button
                type="button"
                id="withdraw-request"
                disabled={busy}
                onClick={async () => {
                  if (confirm('Are you sure you want to withdraw this request?')) {
                    await runInline(() => withdrawRequest(request.id), 'Request withdrawn.');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5 text-slate-400" />
                <span>Withdraw</span>
              </button>
            )}

            {/* Regional Head Actions: forward to clerk or return (no approve / reject) */}
            {canRegionalAct && (
              <>
                <button
                  type="button"
                  id="regional-return"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-amber-200 text-amber-800 bg-amber-50 font-semibold text-xs hover:bg-amber-100"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return for Correction</span>
                </button>

                <button
                  type="button"
                  id="regional-forward"
                  onClick={() => setModalState('regional_forward')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-cyan-600 text-white font-semibold text-xs shadow-md hover:bg-cyan-700"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{role === 'head' ? 'Forward to Clerk (Regional Head inactive)' : 'Forward to Clerk'}</span>
                </button>
              </>
            )}

            {request.status === 'pending_regional_review' && !canRegionalAct && !isOwner && request.regional_head_name && (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-800 font-semibold text-xs">
                <Clock className="w-3.5 h-3.5" />
                <span>Waiting for Regional Head {request.regional_head_name}</span>
              </span>
            )}

            {role === 'clerk' && request.status === 'submitted' && !canClerkAct && (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 font-semibold text-xs">
                <Clock className="w-3.5 h-3.5" />
                <span>With the {request.category_name || 'assigned'} clerk</span>
              </span>
            )}

            {/* Clerk Actions */}
            {canClerkAct && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-amber-200 text-amber-800 bg-amber-50 font-semibold text-xs hover:bg-amber-100"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return for Correction</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('route')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs shadow-md hover:bg-indigo-700"
                >
                  <CornerDownRight className="w-3.5 h-3.5" />
                  <span>Route Request…</span>
                </button>
              </>
            )}

            {/* Head Actions (Route A review) - ONLY for the original owning department head */}
            {isOwningHead && request.status === 'pending_head_review' && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('reject')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-amber-200 text-amber-800 bg-amber-50 font-semibold text-xs hover:bg-amber-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return for Correction</span>
                </button>

                {isAsset ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 font-semibold text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Select the best quotation above</span>
                  </span>
                ) : (
                <button
                  type="button"
                  disabled={isConsultationBlocked}
                  onClick={() => setModalState('forward')}
                  title={isConsultationBlocked ? consultationBlockReason : undefined}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                    isConsultationBlocked
                      ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-indigo-200'
                  }`}
                >
                  <CornerDownRight className="w-3.5 h-3.5" />
                  <span>Forward to Admin…</span>
                </button>
                )}
              </>
            )}

            {/* Head Actions (Route B approval) - ONLY for the original owning department head */}
            {isOwningHead && (request.status === 'pending_head_approval' || (request.status === 'approving' && (!request.approving_started_at || Date.now() - new Date(request.approving_started_at).getTime() > 60000))) && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('reject')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  disabled={approveBlocked}
                  onClick={() => setModalState('approve')}
                  title={approveBlockReason}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                    approveBlocked
                      ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Sign</span>
                </button>
              </>
            )}

            {/* Admin Actions */}
            {role === 'admin' && (request.status === 'pending_admin_approval' || (request.status === 'approving' && (!request.approving_started_at || Date.now() - new Date(request.approving_started_at).getTime() > 60000))) && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('reject')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  disabled={approveBlocked}
                  onClick={() => setModalState('approve')}
                  title={approveBlockReason}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                    approveBlocked
                      ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Digital Sign</span>
                </button>
              </>
            )}

            {/* Admin Delete Action (Available on any status) */}
            {role === 'admin' && (
              <button
                type="button"
                id="admin-delete-request-action-bar-btn"
                onClick={handleDeleteRequestPermanently}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                title="Permanently delete this request completely from the system"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Delete Request</span>
              </button>
            )}

            {/* Owning Head / Admin Action when Disbursement requested clarification */}
            {(isOwningHead || role === 'admin') && request.status === 'approved' && isPendingDisbursementClarification && (
              <button
                type="button"
                id="head-respond-disb-bar-btn"
                onClick={() => setModalState('disb_respond')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all cursor-pointer"
              >
                <CornerDownRight className="w-3.5 h-3.5" />
                <span>Send Clarification to Disbursement</span>
              </button>
            )}

            {/* Owner Head: cancel an approved request any time before it is fully paid */}
            {canCancelApproval && (
              <button
                type="button"
                id="cancel-approval-btn"
                onClick={() => setModalState('cancel')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 font-semibold text-xs transition-colors cursor-pointer"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Cancel Approval</span>
              </button>
            )}

            {/* Stock Transfer Monitor / Admin: confirm the stock reached the destination shop */}
            {canCompleteTransfer && (
              <button
                type="button"
                id="mark-transfer-complete-btn"
                onClick={() => setModalState('complete_transfer')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 transition-all active:scale-95 cursor-pointer"
              >
                <PackageCheck className="w-4 h-4" />
                <span>Mark Transfer Complete</span>
              </button>
            )}

            {/* Disbursement Action */}
            {role === 'disbursement' && !isStockMonitorUser && request.status === 'approved' && rType !== 'discount' && rType !== 'non_cash' && rType !== 'stock_transfer' && (
              <>
                <button
                  type="button"
                  id="disb-ask-head-bar-btn"
                  onClick={() => setModalState('disb_clarify')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4 text-amber-600" />
                  <span>Ask Head for Clarification</span>
                </button>

                {isEntryOnly ? (
                  remainingUnentered > 0 ? (
                    <button
                      type="button"
                      disabled={isPendingDisbursementClarification}
                      onClick={() => setModalState('add_disb_entry')}
                      title={isPendingDisbursementClarification ? 'Entry creation is on hold pending Head clarification' : undefined}
                      className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                        isPendingDisbursementClarification
                          ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                          : 'bg-sky-600 hover:bg-sky-700 text-white cursor-pointer shadow-sky-200 active:scale-95'
                      }`}
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>+ Add Entry #{nextEntryNo}</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-sky-800 bg-sky-50 border border-sky-200">
                      <Check className="w-4 h-4 text-sky-600" />
                      <span>All Entries Added · Ready for Payment</span>
                    </span>
                  )
                ) : isPaymentOnly ? (
                  firstPendingEntry ? (
                    <button
                      type="button"
                      disabled={isPendingDisbursementClarification}
                      onClick={() => {
                        setSelectedEntry(firstPendingEntry);
                        setModalState('pay');
                      }}
                      title={isPendingDisbursementClarification ? 'Payment is on hold pending Head clarification' : undefined}
                      className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                        isPendingDisbursementClarification
                          ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                          : 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer shadow-teal-200 active:scale-95'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      <span>
                        {isPendingDisbursementClarification
                          ? 'Payment on Hold'
                          : `Pay Entry #${firstPendingEntry.entry_no} (${formatINR(firstPendingEntry.amount)})`}
                      </span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span>Awaiting Entry from Entry-Only Account</span>
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={isPendingDisbursementClarification}
                    onClick={() => {
                      if (firstPendingEntry) setSelectedEntry(firstPendingEntry);
                      setModalState('pay');
                    }}
                    title={isPendingDisbursementClarification ? 'Payment is on hold pending Head clarification' : undefined}
                    className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                      isPendingDisbursementClarification
                        ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                        : 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer shadow-teal-200'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>
                      {isPendingDisbursementClarification
                        ? 'Payment on Hold'
                        : firstPendingEntry
                        ? `Pay Entry #${firstPendingEntry.entry_no} (${formatINR(firstPendingEntry.amount)})`
                        : pay.paid > 0
                        ? `Pay Balance ${formatINR(pay.balance)}`
                        : 'Record Payment'}
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Modals */}
      {modalState === 'consult' && (
        <ConsultHeadsModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onSuccess={() => setBanner({ ok: true, text: 'Consultation request sent to department heads.' })}
        />
      )}

      {modalState === 'consult_respond' && myConsultation && (
        <RespondConsultationModal
          isOpen={true}
          onClose={() => {
            setModalState(null);
            setConsultInitialStatus(null);
          }}
          request={request}
          consultation={myConsultation}
          initialStatus={consultInitialStatus}
          onSuccess={() => setBanner({ ok: true, text: 'Your consultation decision has been saved.' })}
        />
      )}

      {modalState === 'disb_clarify' && (
        <DisbursementClarificationModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onSuccess={() => setBanner({ ok: true, text: 'Clarification query sent to Request Owner Head.' })}
        />
      )}

      {modalState === 'disb_respond' && latestClarification && (
        <RespondClarificationModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          clarification={latestClarification}
          onSuccess={(warning) =>
            setBanner(
              warning
                ? { ok: false, text: warning }
                : { ok: true, text: 'Clarification response sent back to Disbursement.' }
            )
          }
        />
      )}

      {modalState === 'cancel' && (
        <CancelApprovalModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onCancel={(reason, v) => orThrow(cancelApprovedRequest(request.id, reason, v), 'Approval cancelled.')}
        />
      )}

      {modalState === 'edit' && (
        <EditDraftModal isOpen={true} onClose={() => setModalState(null)} request={request} />
      )}

      {modalState === 'route' && (
        <RouteModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onRoute={(rt, rm, v) => orThrow(routeRequest(request.id, rt, rm, v), `Routed via Route ${rt}.`)}
        />
      )}

      {modalState === 'approve' && (
        <ApproveModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onApprove={async (v) => {
            return await approveRequest(request.id, v);
          }}
        />
      )}

      {modalState === 'return' && (
        <ReturnModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onReturn={(rm, v) => orThrow(returnRequest(request.id, rm, v), 'Returned to the requester for correction.')}
        />
      )}

      {modalState === 'reject' && (
        <RejectModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onReject={(rs, v) => orThrow(rejectRequest(request.id, rs, v), 'Request rejected.')}
        />
      )}

      {modalState === 'forward' && (
        <ForwardModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onForward={(rm, v) => orThrow(forwardRequest(request.id, rm, v), 'Forwarded to Admin.')}
        />
      )}

      {modalState === 'regional_forward' && (
        <RegionalForwardModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onForward={(rm, v) => orThrow(regionalForwardRequest(request.id, rm, v), 'Forwarded to the clerk.')}
        />
      )}

      {modalState === 'add_disb_entry' && request && (
        <AddDisbursementEntryModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onAddEntry={async (amount, tdsCut, notes) => {
            const res = await addDisbursementEntry(request.id, amount, tdsCut, notes);
            if (!res.success) throw new Error(res.error || 'Failed to add entry');
            setBanner({
              ok: true,
              text: `Disbursement entry created successfully (${formatINR(amount)} · ${tdsCut ? 'TDS Cut' : 'TDS Not Cut'}). Ready for payment.`,
            });
          }}
        />
      )}

      {modalState === 'pay' && request && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => {
            setModalState(null);
            setSelectedEntry(null);
          }}
          request={request}
          entry={selectedEntry}
          onMarkPaid={async (dt) => {
            const res = await markAsPaid(request.id, {
              ...dt,
              entry_id: selectedEntry ? selectedEntry.id : dt.entry_id,
            });
            if (!res.success) throw new Error(res.error || 'Action failed');
            const paidEnt = selectedEntry;
            setSelectedEntry(null);
            setBanner({
              ok: true,
              text: paidEnt
                ? `Entry #${paidEnt.entry_no} paid successfully (${formatINR(dt.amount || paidEnt.amount)}).`
                : res.fully_paid
                ? 'Paid in full.'
                : 'Partial payment recorded. Balance is still pending.',
            });
          }}
        />
      )}
      {modalState === 'complete_transfer' && request && (
        <CompleteTransferModal
          isOpen
          request={request}
          onClose={() => setModalState(null)}
          onConfirm={async (remarks) => {
            const res = await markTransferComplete(request.id, remarks);
            if (res.success) setBanner({ ok: true, text: 'Stock transfer marked as completed.' });
            return res;
          }}
        />
      )}
    </div>
  );
};
