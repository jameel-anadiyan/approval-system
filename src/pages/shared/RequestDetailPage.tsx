import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { DocumentViewer } from '../../components/requests/DocumentViewer';
import { SignedDocuments, VoiceNoteItem } from '../../components/requests/SignedDocuments';
import { EditDraftModal } from '../../components/requests/EditDraftModal';
import { RequestTimeline } from '../../components/requests/RequestTimeline';
import { RouteModal } from '../../components/portals/RouteModal';
import { ApproveModal } from '../../components/portals/ApproveModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RejectModal } from '../../components/portals/RejectModal';
import { ForwardModal } from '../../components/portals/ForwardModal';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import {
  formatINR,
  formatINRWhole,
  formatISTDate,
  ROLE_LABELS,
} from '../../lib/formatters';
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
    'route' | 'approve' | 'return' | 'reject' | 'forward' | 'pay' | 'edit' | null
  >(null);
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
  const isHighValue = request.amount > threshold;
  const voiceNotes = (request.files || []).filter((f) => f.kind === 'voice_note');
  // Disbursement only ever sees the stamped output, never the originals (storage policy agrees).
  const showOriginals = role !== 'disbursement';
  const editable = isOwner && (request.status === 'draft' || request.status === 'returned');

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
    setBusy(true);
    setBanner(null);
    const res = await fn();
    setBusy(false);
    setBanner(res.success ? { ok: true, text: okText } : { ok: false, text: res.error || 'Action failed' });
    return res.success;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 pb-32">
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

        <div className="flex items-center gap-3">
          <StatusBadge status={request.status} size="lg" showDescription />
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
                  Total Requested Amount
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
              <div>
                <span className="text-slate-400 font-medium block">Requester</span>
                <span className="font-bold text-slate-800 mt-0.5 block">
                  {request.requester_name}
                </span>
                <span className="text-[11px] text-slate-500 capitalize">
                  {ROLE_LABELS[request.requester_role] || request.requester_role}
                </span>
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

          {editable && !(request.files || []).some((f) => f.kind === 'document') && (
            <div className="p-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 text-xs text-amber-900">
              No document attached yet. Use <strong>Edit</strong> to attach at least one invoice or bill before submitting.
            </div>
          )}

          {/* Signed Approval Packet Card (when approved or paid) */}
          {(request.status === 'approved' || request.status === 'paid') && <SignedDocuments request={request} />}

          {request.status === 'paid' && (
            <div className="bg-white rounded-2xl border border-teal-200 p-5 shadow-xs text-xs grid grid-cols-2 gap-3">
              <div className="col-span-2 flex items-center gap-2 font-bold text-teal-800 text-sm">
                <Banknote className="w-4 h-4" /> Payment recorded
              </div>
              <div>
                <span className="text-slate-400 block">Paid on</span>
                <span className="font-semibold text-slate-800">{formatISTDate(request.paid_at)}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Mode</span>
                <span className="font-semibold text-slate-800">{request.payment_mode || '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block">Reference</span>
                <span className="font-mono font-semibold text-slate-800">{request.payment_ref || '—'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (Timeline & Actions) - 5 cols on lg */}
        <div className="lg:col-span-5 space-y-6">
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
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-500 hidden sm:block">
            Signed in as: <strong className="text-slate-800">{user?.full_name}</strong> ({role})
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
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

            {/* Head Actions (Route A review vs Route B approval) */}
            {role === 'head' && request.status === 'pending_head_review' && (
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
                  onClick={() => setModalState('forward')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs shadow-md hover:bg-indigo-700"
                >
                  <CornerDownRight className="w-3.5 h-3.5" />
                  <span>Forward to Admin…</span>
                </button>
              </>
            )}

            {role === 'head' && request.status === 'pending_head_approval' && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('reject')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('approve')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs shadow-md hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Sign</span>
                </button>
              </>
            )}

            {/* Admin Actions */}
            {role === 'admin' && request.status === 'pending_admin_approval' && (
              <>
                <button
                  type="button"
                  onClick={() => setModalState('return')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Return</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('reject')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 font-semibold text-xs hover:bg-rose-100"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalState('approve')}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs shadow-md hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve & Digital Sign</span>
                </button>
              </>
            )}

            {/* Disbursement Action */}
            {role === 'disbursement' && request.status === 'approved' && (
              <button
                type="button"
                onClick={() => setModalState('pay')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-teal-600 text-white font-semibold text-xs shadow-md hover:bg-teal-700"
              >
                <Banknote className="w-4 h-4" />
                <span>Mark as Paid</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Modals */}
      {modalState === 'edit' && (
        <EditDraftModal isOpen={true} onClose={() => setModalState(null)} request={request} />
      )}

      {modalState === 'route' && (
        <RouteModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onRoute={(rt, rm) => orThrow(routeRequest(request.id, rt, rm), `Routed via Route ${rt}.`)}
        />
      )}

      {modalState === 'approve' && (
        <ApproveModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onApprove={async () => {
            return await approveRequest(request.id);
          }}
        />
      )}

      {modalState === 'return' && (
        <ReturnModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onReturn={(rm) => orThrow(returnRequest(request.id, rm), 'Returned to the requester for correction.')}
        />
      )}

      {modalState === 'reject' && (
        <RejectModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onReject={(rs) => orThrow(rejectRequest(request.id, rs), 'Request rejected.')}
        />
      )}

      {modalState === 'forward' && (
        <ForwardModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onForward={(rm) => orThrow(forwardRequest(request.id, rm), 'Forwarded to Admin.')}
        />
      )}

      {modalState === 'pay' && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onMarkPaid={(dt) => orThrow(markAsPaid(request.id, dt), 'Marked as paid.')}
        />
      )}
    </div>
  );
};
