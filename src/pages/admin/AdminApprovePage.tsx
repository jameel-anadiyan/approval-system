import React from 'react';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export const AdminApprovePage: React.FC = () => {
  const { requests } = useRequests();

  const toApproveQueue = requests.filter(
    (r) => r.status === 'pending_admin_approval' || (r.status === 'approving' && (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
  );

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

      <RequestQueue
        items={toApproveQueue}
        bulkApprove
        initialFilters={{ sort: 'oldest' }}
        emptyIcon={CheckCircle2}
        emptyTitle="No Requests Pending Approval"
        emptyDescription="All A-route requests forwarded by department heads have been approved or processed."
      />
    </div>
  );
};
