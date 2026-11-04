import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { isOwningDepartmentHead } from '../../lib/workflow';
import { typeOf } from '../../lib/formatters';
import { useDirectory } from '../../lib/directory';
import { CheckCircle, CheckCircle2, Clock, CornerDownRight, Wallet, ShieldCheck, Send, Search } from 'lucide-react';

export const HeadReviewPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const dir = useDirectory();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'admin' ? 'admin' : 'review';

  const isPettyCashDealer = Boolean(
    user?.role === 'head' &&
      (dir.users.find((u) => u.id === user.id)?.is_petty_cash_dealer ?? user.is_petty_cash_dealer)
  );

  // Route B requests waiting for Head direct approval
  const toApproveQueue = requests.filter(
    (r) => r.status === 'pending_head_approval' && isOwningDepartmentHead(r, user)
  );

  // Route A requests waiting for Head review
  const toReviewQueue = requests.filter(
    (r) => r.status === 'pending_head_review' && isOwningDepartmentHead(r, user)
  );

  // Route A requests forwarded to Admin, waiting for Admin approval
  const pendingAdminQueue = requests.filter(
    (r) =>
      r.status === 'pending_admin_approval' &&
      (isOwningDepartmentHead(r, user) || r.department_id === user?.department_id)
  );

  const pettyCashCount = [...toApproveQueue, ...toReviewQueue].filter((r) => typeOf(r) === 'petty_cash').length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Quick Queue Switcher Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-b border-slate-200/90">
        <button
          type="button"
          onClick={() => navigate('/head')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <CheckCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>To Approve (Route B)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
            {toApproveQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'review' })}
          className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
            activeTab === 'review'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Clock className={`w-3.5 h-3.5 ${activeTab === 'review' ? 'text-white' : 'text-slate-400'}`} />
          <span>To Review (Route A)</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'review' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {toReviewQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'admin' })}
          className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
            activeTab === 'admin'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className={`w-3.5 h-3.5 ${activeTab === 'admin' ? 'text-white' : 'text-blue-500'}`} />
          <span>Pending Admin Approval</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'admin' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-800'
            }`}
          >
            {pendingAdminQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/head/tracking')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 text-purple-600" />
          <span>Track Request</span>
        </button>

        {isPettyCashDealer && (
          <button
            type="button"
            onClick={() => navigate('/petty-cash')}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-teal-600" />
            <span>Petty Cash</span>
            {pettyCashCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-teal-600 text-white text-[10px] font-bold">
                {pettyCashCount}
              </span>
            )}
          </button>
        )}
      </div>

      {activeTab === 'review' ? (
        <>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
                To-Review Queue (Route A Requests)
              </h1>
              {toReviewQueue.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-bold">
                  {toReviewQueue.length} waiting
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Review invoices and documents, then forward to the Administrator with your recommendation.
            </p>
          </div>

          <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 flex items-start gap-3 text-xs text-blue-950">
            <CornerDownRight className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Route A Workflow:</span>
              <p className="mt-0.5 text-blue-800 leading-relaxed">
                These requests (including any escalated from Route B) require Administrator final approval
                and official seal stamping. Tap any card to inspect vouchers, listen to voice notes, and
                forward to Admin or return for correction.
              </p>
            </div>
          </div>

          <RequestQueue
            items={toReviewQueue}
            initialFilters={{ sort: 'oldest' }}
            emptyIcon={CheckCircle2}
            emptyTitle="Review Queue Cleared"
            emptyDescription="There are currently no Route A requests awaiting your department review."
          />
        </>
      ) : (
        <>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
                Pending Admin Approval
              </h1>
              {pendingAdminQueue.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold">
                  {pendingAdminQueue.length} with Admin
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Route A requests reviewed and forwarded by your department, currently awaiting Administrator final approval and digital sealing.
            </p>
          </div>

          <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-950">
            <Send className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">With Administrator:</span>
              <p className="mt-0.5 text-amber-900 leading-relaxed">
                These requests have been reviewed and forwarded to the Administrator. Once Admin approves them,
                they will be officially stamped and will automatically leave this pending queue.
              </p>
            </div>
          </div>

          <RequestQueue
            items={pendingAdminQueue}
            initialFilters={{ sort: 'newest' }}
            emptyIcon={CheckCircle2}
            emptyTitle="No Requests Pending Admin Approval"
            emptyDescription="There are currently no forwarded requests waiting for Admin approval."
          />
        </>
      )}
    </div>
  );
};
