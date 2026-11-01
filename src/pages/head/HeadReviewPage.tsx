import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { isOwningDepartmentHead } from '../../lib/workflow';
import { CheckCircle, CheckCircle2, Clock, CornerDownRight } from 'lucide-react';

export const HeadReviewPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  // Route B requests waiting for Head direct approval
  const toApproveQueue = requests.filter(
    (r) => r.status === 'pending_head_approval' && isOwningDepartmentHead(r, user)
  );

  // Route A requests waiting for Head review
  const toReviewQueue = requests.filter(
    (r) => r.status === 'pending_head_review' && isOwningDepartmentHead(r, user)
  );

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
          className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white flex items-center gap-2 shadow-xs shrink-0"
        >
          <Clock className="w-3.5 h-3.5" />
          <span>To Review (Route A)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-bold">
            {toReviewQueue.length}
          </span>
        </button>
      </div>

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
    </div>
  );
};
