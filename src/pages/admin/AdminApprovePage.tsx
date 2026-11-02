import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { typeOf } from '../../lib/formatters';
import { CheckCircle2, Wallet } from 'lucide-react';

export const AdminApprovePage: React.FC = () => {
  const { requests } = useRequests();
  const navigate = useNavigate();

  const toApproveQueue = requests.filter(
    (r) => r.status === 'pending_admin_approval' || (r.status === 'approving' && (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
  );
  const pettyCashCount = toApproveQueue.filter((r) => typeOf(r) === 'petty_cash').length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

        <button
          type="button"
          onClick={() => navigate('/petty-cash')}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 text-xs font-bold transition-colors self-start sm:self-auto cursor-pointer"
        >
          <Wallet className="w-3.5 h-3.5 text-teal-600" />
          <span>Petty Cash Tab</span>
          {pettyCashCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-teal-600 text-white text-[10px] font-bold">
              {pettyCashCount}
            </span>
          )}
        </button>
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
