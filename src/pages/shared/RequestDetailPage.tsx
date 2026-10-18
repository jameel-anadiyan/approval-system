import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { DocumentViewer } from '../../components/requests/DocumentViewer';
import { VoicePlayer } from '../../components/requests/VoicePlayer';
import { RequestTimeline } from '../../components/requests/RequestTimeline';
import { RouteModal } from '../../components/portals/RouteModal';
import { ApproveModal } from '../../components/portals/ApproveModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RejectModal } from '../../components/portals/RejectModal';
import { ForwardModal } from '../../components/portals/ForwardModal';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import {
  formatINR,
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
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

export const RequestDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const {
    getRequestById,
    submitRequest,
    withdrawRequest,
    routeRequest,
    forwardRequest,
    returnRequest,
    rejectRequest,
    approveRequest,
    markAsPaid,
  } = useRequests();

  const [modalState, setModalState] = useState<
    'route' | 'approve' | 'return' | 'reject' | 'forward' | 'pay' | null
  >(null);
  const [copiedNo, setCopiedNo] = useState(false);

  const request = id ? getRequestById(id) : undefined;

  if (!request) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-lg font-bold text-slate-800">Request Not Found</h2>
        <p className="text-xs text-slate-500 mt-1">
          The requested voucher does not exist or has been removed.
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
  const isHighValue = request.amount > 10000;
  const voiceNote = request.files?.find((f) => f.kind === 'voice_note');

  const copyApprovalNo = (no: string) => {
    navigator.clipboard.writeText(no);
    setCopiedNo(true);
    setTimeout(() => setCopiedNo(false), 2000);
  };

  const handleDownloadSignedPDF = () => {
    alert(
      `Downloading signed PDF packet for Approval ${request.approval_no || request.request_no}...\nEvery page contains the digital stamp, official seal, signature, IST timestamp, and SHA-256 hash.`
    );
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
                    <span>High Value (&gt; ₹10k)</span>
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

          {/* Voice Note Player (if present) */}
          {voiceNote && (
            <VoicePlayer
              url={voiceNote.public_url}
              duration={voiceNote.duration_sec}
              title={voiceNote.original_name}
            />
          )}

          {/* Document Viewer (PDF or Photos) */}
          {request.files && request.files.filter((f) => f.kind === 'document').length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Attached Invoices & Documents
                </h3>
                <span className="text-xs text-slate-400">
                  {request.files.filter((f) => f.kind === 'document').length} file(s)
                </span>
              </div>
              <DocumentViewer files={request.files} />
            </div>
          )}

          {/* Signed Approval Packet Card (when approved or paid) */}
          {(request.status === 'approved' || request.status === 'paid') && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">
                    Official Signed Approval Packet
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Approval No: <span className="font-mono font-bold">{request.approval_no}</span> •
                    Stamped with seal, signature & date-time
                  </p>
                  {request.verify_token && (
                    <a
                      href={`/verify/${request.verify_token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 mt-1 underline"
                    >
                      <span>Public Verification Link</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadSignedPDF}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 transition-all shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download Signed PDF</span>
              </button>
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
            {isOwner && request.status === 'draft' && (
              <button
                type="button"
                onClick={async () => {
                  const res = await submitRequest(request.id);
                  if (res.success) alert(`Request submitted as ${res.request_no}`);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs shadow-md hover:bg-indigo-700"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit Request</span>
              </button>
            )}

            {isOwner && (request.status === 'submitted' || request.status === 'returned') && (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Are you sure you want to withdraw this request?')) {
                    await withdrawRequest(request.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
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

            {/* Download Signed PDF for any user once approved */}
            {(request.status === 'approved' || request.status === 'paid') && (
              <button
                type="button"
                onClick={handleDownloadSignedPDF}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Signed PDF</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Modals */}
      {modalState === 'route' && (
        <RouteModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onRoute={async (rt, rm) => {
            await routeRequest(request.id, rt, rm);
          }}
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
          onReturn={async (rm) => {
            await returnRequest(request.id, rm);
          }}
        />
      )}

      {modalState === 'reject' && (
        <RejectModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onReject={async (rs) => {
            await rejectRequest(request.id, rs);
          }}
        />
      )}

      {modalState === 'forward' && (
        <ForwardModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onForward={async (rm) => {
            await forwardRequest(request.id, rm);
          }}
        />
      )}

      {modalState === 'pay' && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setModalState(null)}
          request={request}
          onMarkPaid={async (dt) => {
            await markAsPaid(request.id, dt);
          }}
        />
      )}
    </div>
  );
};
