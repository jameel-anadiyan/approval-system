import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { Clock, CheckCircle2, CornerDownRight } from 'lucide-react';

export const HeadReviewPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();

  // Route A requests waiting for Head review
  const toReviewQueue = requests.filter(
    (r) =>
      r.status === 'pending_head_review' &&
      (!user?.department_id || r.department_id === user.department_id)
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
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
            These requests require Administrator final approval and official seal stamping. Tap any
            card to inspect vouchers, listen to voice notes, and forward or return for correction.
          </p>
        </div>
      </div>

      {toReviewQueue.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Review Queue Cleared"
          description="There are currently no Route A requests awaiting your department review."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {toReviewQueue.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
};
