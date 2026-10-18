import React from 'react';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export const AdminApprovePage: React.FC = () => {
  const { requests } = useRequests();

  const toApproveQueue = requests.filter((r) => r.status === 'pending_admin_approval');

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Admin Approval & Stamping Queue
          </h1>
          {toApproveQueue.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold">
              {toApproveQueue.length} waiting
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Final approver on A-route requests; approves with digital seal and signature stamp.
        </p>
      </div>

      {toApproveQueue.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No Requests Pending Approval"
          description="All A-route requests forwarded by department heads have been approved or processed."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {toApproveQueue.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
};
