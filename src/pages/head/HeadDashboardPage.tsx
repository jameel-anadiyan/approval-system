import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { ApproveModal } from '../../components/portals/ApproveModal';
import { formatINR } from '../../lib/formatters';
import { CheckCircle2, Clock, CheckCircle, PlusCircle, Building2, TrendingUp } from 'lucide-react';
import { RequestRecord } from '../../types/database';

export const HeadDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, approveRequest } = useRequests();
  const navigate = useNavigate();

  const [activeRequest, setActiveRequest] = useState<RequestRecord | null>(null);

  // Department requests
  const deptRequests = requests.filter(
    (r) => !user?.department_id || r.department_id === user.department_id
  );

  // Queue 1: To Approve (Route B requests waiting for Head approval)
  const toApproveQueue = deptRequests.filter((r) => r.status === 'pending_head_approval');

  // Queue 2: To Review (Route A requests waiting for Head review)
  const toReviewQueue = deptRequests.filter((r) => r.status === 'pending_head_review');

  // Total department amount approved/paid
  const sanctionedTotal = deptRequests
    .filter((r) => r.status === 'approved' || r.status === 'paid')
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 inline-block mb-1">
            Department Head Portal
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Welcome, {user?.full_name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Department: <strong>{user?.department?.name || 'Department'}</strong> ({user?.department?.code})
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/new')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Raise Own Request</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          onClick={() => {}}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-purple-200/90 shadow-xs cursor-pointer hover:border-purple-300 transition-all"
        >
          <div className="flex items-center justify-between text-purple-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">To Approve (Route B)</span>
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-purple-900 font-display">
            {toApproveQueue.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Awaiting your digital sign</span>
        </div>

        <div
          onClick={() => navigate('/head/review')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-indigo-200/90 shadow-xs cursor-pointer hover:border-indigo-300 transition-all"
        >
          <div className="flex items-center justify-between text-indigo-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">To Review (Route A)</span>
            <Clock className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-indigo-900 font-display">
            {toReviewQueue.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">To forward to Admin</span>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Sanctioned Total</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display truncate">
            {formatINR(sanctionedTotal)}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Approved & Disbursed</span>
        </div>

        <div
          onClick={() => navigate('/head/department')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs cursor-pointer hover:border-slate-300 transition-all"
        >
          <div className="flex items-center justify-between text-slate-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total Dept Logs</span>
            <Building2 className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
            {deptRequests.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">All department requests</span>
        </div>
      </div>

      {/* Main Section: To-Approve Queue (Route B) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <span>To-Approve Queue (Route B Requests)</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
              {toApproveQueue.length}
            </span>
          </h2>
          <span className="text-xs text-slate-400">
            Sign directly with your official seal & signature
          </span>
        </div>

        {toApproveQueue.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No Pending Direct Approvals"
            description="You have cleared all Route B requests waiting for your approval and signature."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {toApproveQueue.map((req) => (
              <RequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </div>

      {/* Approve Modal */}
      {activeRequest && (
        <ApproveModal
          isOpen={true}
          onClose={() => setActiveRequest(null)}
          request={activeRequest}
          onApprove={async () => {
            return await approveRequest(activeRequest.id);
          }}
        />
      )}
    </div>
  );
};
