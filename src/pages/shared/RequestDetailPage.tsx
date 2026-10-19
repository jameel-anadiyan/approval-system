import React, { useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { StatusBadge, TypeBadge } from '../../components/common/StatusBadge';
import { DocumentViewer } from '../../components/requests/DocumentViewer';
import { SignedDocuments, VoiceNoteItem } from '../../components/requests/SignedDocuments';
import { EditDraftModal } from '../../components/requests/EditDraftModal';
import { RequestTimeline } from '../../components/requests/RequestTimeline';
import { RequestDetailsPanel } from '../../components/requests/RequestDetailsPanel';
import { RouteModal } from '../../components/portals/RouteModal';
import { ApproveModal } from '../../components/portals/ApproveModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RejectModal } from '../../components/portals/RejectModal';
import { ForwardModal } from '../../components/portals/ForwardModal';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { ConsultHeadsModal } from '../../components/portals/ConsultHeadsModal';
import { RespondConsultationModal } from '../../components/portals/RespondConsultationModal';
import { HeadConsultationsSection } from '../../components/requests/HeadConsultationsSection';
import { RequesterProfileCard } from '../../components/requests/RequesterProfileCard';
import { UserAvatar } from '../../components/common/UserAvatar';
import {
  formatINR,
  formatINRWhole,
  formatISTDate,
  ROLE_LABELS,
  typeOf,
} from '../../lib/formatters';
import { paymentSummary } from '../../types/database';
import {
  ArrowLeft,
  Download,
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
  ThumbsUp,
  ThumbsDown,
  Clock,
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
    returnRequest,
    rejectRequest,
    approveRequest,
    markAsPaid,
  } = useRequests();

  const [modalState, setModalState] = useState<
    'route' | 'approve' | 'return' | 'reject' | 'forward' | 'pay' | 'edit' | 'consult' | 'consult_respond' | null
  >(null);
  const [consultInitialStatus, setConsultInitialStatus] = useState<'agreed' | 'disagreed' | null>(null);
  const [copiedNo, setCopiedNo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(
    (location.state as { notice?: string } | null)?.notice
      ? { ok: false, text: (location.state as { notice: string }).notice }
      : null
  );

  const request = id ? getRequestById(id) : undefined;

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
  // Must be role === 'head', NOT the requester, NOT a consulted head, and MUST belong to the request's department!
  const isOwningHead =
    role === 'head' &&
    !isOwner &&
    !myConsultation &&
    !!user?.department_id &&
    user.department_id === request.department_id;

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

  const isFinalized = ['approved', 'rejected', 'paid', 'withdrawn'].includes(request.status);
  const canRequestConsultation =
    (isOwningHead || role === 'admin') &&
    request.status !== 'draft' &&
    !isFinalized;

  const rType = typeOf(request);
  const isHighValue = rType === 'general' && request.amount > threshold;
  const amountLabel =
    rType === 'discount' ? 'Discount Value' : rType === 'exhibition' ? 'Total Sponsorship (incl. GST)' : 'Total Requested Amount';
  const voiceNotes = (request.files || []).filter((f) => {
    if (f.kind !== 'voice_note') return false;
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

  const actionLockRef = useRef(false);
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
                  {formatINR(request.amount)}
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

            <div className="grid grid-cols-2 gap-4 text-xs">
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
              {request.shop_name && (
                <div className="col-span-2">
                  <span className="text-slate-400 font-medium block">Shop</span>
                  <span className="font-bold text-slate-800 mt-0.5 flex items-center gap-1">
                    <Store className="w-3.5 h-3.5 text-slate-400" />
                    {request.shop_name}
                  </span>
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

          {/* Inter-Department Head Consultations Section */}
          {request.consultations && request.consultations.length > 0 ? (
            <HeadConsultationsSection
              consultations={request.consultations}
              requestId={request.id}
              canRequestMore={canRequestConsultation}
              requestStatus={request.status}
              onRequestMore={() => setModalState('consult')}
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
          {showOriginals && request.files && request.files.filter((f) => f.kind === 'document').length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Attached Invoices &amp; Documents
                </h3>
                <span className="text-xs text-slate-400">
                  {request.files.filter((f) => f.kind === 'document').length} file(s)
                </span>
              </div>
              <DocumentViewer key={request.files.map((f) => f.id).join(',')} files={request.files} />
            </div>
          )}

          {editable && rType === 'general' && !(request.files || []).some((f) => f.kind === 'document') && (
            <div className="p-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 text-xs text-amber-900">
              No document attached yet. Use <strong>Edit</strong> to attach at least one invoice or bill before submitting.
            </div>
          )}

          {/* Signed Approval Packet Card (when approved or paid) */}
          {(request.status === 'approved' || request.status === 'paid') && <SignedDocuments request={request} />}

          {rType !== 'discount' && (request.status === 'paid' || (request.status === 'approved' && pay.paid > 0)) && (
            <div className="bg-white rounded-2xl border border-teal-200 p-4 sm:p-5 shadow-xs text-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-teal-800 text-sm">
                  <Banknote className="w-4 h-4" /> Payments
                </div>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                    pay.balance > 0
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-teal-50 text-teal-700 border-teal-200'
                  }`}
                >
                  {pay.balance > 0 ? 'Partially paid' : 'Paid in full'}
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
              {payments.length > 0 ? (
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
              ) : (
                <div className="grid grid-cols-2 gap-3">
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
            Signed in as: <strong className="text-slate-800">{user?.full_name}</strong> ({role})
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

            {isOwner && (request.status === 'submitted' || request.status === 'returned') && (
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

            {/* Clerk Actions */}
            {role === 'clerk' && request.status === 'submitted' && (
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
                  disabled={isConsultationBlocked}
                  onClick={() => setModalState('approve')}
                  title={isConsultationBlocked ? consultationBlockReason : undefined}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                    isConsultationBlocked
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
                  disabled={isConsultationBlocked}
                  onClick={() => setModalState('approve')}
                  title={isConsultationBlocked ? consultationBlockReason : undefined}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
                    isConsultationBlocked
                      ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Digital Sign</span>
                </button>
              </>
            )}

            {/* Disbursement Action */}
            {role === 'disbursement' && request.status === 'approved' && rType !== 'discount' && (
              <button
                type="button"
                onClick={() => setModalState('pay')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-teal-600 text-white font-semibold text-xs shadow-md hover:bg-teal-700"
              >
                <Banknote className="w-4 h-4" />
                <span>{pay.paid > 0 ? `Pay Balance ${formatINR(pay.balance)}` : 'Record Payment'}</span>
              </button>
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

      {modalState === 'pay' && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onMarkPaid={async (dt) => {
            const res = await markAsPaid(request.id, dt);
            if (!res.success) throw new Error(res.error || 'Action failed');
            setBanner({
              ok: true,
              text: res.fully_paid ? 'Paid in full.' : 'Partial payment recorded. Balance is still pending.',
            });
          }}
        />
      )}
    </div>
  );
};
