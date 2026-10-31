import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { RouteModal } from '../../components/portals/RouteModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RequestRecord } from '../../types/database';
import { Inbox, CheckCircle2, ShieldAlert, FileWarning, ArrowRightLeft } from 'lucide-react';
import { formatINRWhole } from '../../lib/formatters';
import { isMyRoutingRequest, canUserViewBillMissingRequest } from '../../lib/workflow';

export const ClerkInboxPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, routeRequest, returnRequest, threshold } = useRequests();
  const limit = formatINRWhole(threshold);

  const [activeTab, setActiveTab] = useState<'routing' | 'bill_missing'>('routing');
  const [activeRequest, setActiveRequest] = useState<RequestRecord | null>(null);
  const [modalType, setModalType] = useState<'route' | 'return' | null>(null);

  // Clerk inbox: submitted requests of own department in my work categories (oldest first by default)
  const pendingRouting = requests.filter((r) => isMyRoutingRequest(r, user));
  const otherClerksCount = requests.filter(
    (r) => r.status === 'submitted' && r.department_id === user?.department_id && !isMyRoutingRequest(r, user)
  ).length;

  // Bill missing queue: department requests strictly associated with this clerk
  const billMissingQueue = requests.filter((r) => canUserViewBillMissingRequest(r, user));

  const source = activeTab === 'routing' ? pendingRouting : billMissingQueue;
  const { filters, setFilters, result: visible } = useRequestFilters(source, {
    sort: activeTab === 'routing' ? 'oldest' : 'newest',
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Clerk Operations Queue
          </h1>
          {pendingRouting.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
              {pendingRouting.length} to route
            </span>
          )}
          {billMissingQueue.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs font-bold shadow-xs shadow-rose-600/30 animate-pulse">
              {billMissingQueue.length} bill missing
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Review newly submitted department vouchers, assign approval routes, and attach missing original bills.
          {otherClerksCount > 0 && (
            <span className="block text-[11px] text-slate-400 mt-0.5">
              {otherClerksCount} more waiting with other clerks (other work categories).
            </span>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1 flex-wrap" role="tablist">
        <button
          type="button"
          role="tab"
          id="clerk-tab-routing"
          aria-selected={activeTab === 'routing'}
          onClick={() => setActiveTab('routing')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'routing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-600" />
          <span>Pending Routing ({pendingRouting.length})</span>
        </button>

        {/* Glowing Red Bill Missing Tab */}
        <button
          type="button"
          role="tab"
          id="clerk-tab-bill_missing"
          aria-selected={activeTab === 'bill_missing'}
          onClick={() => setActiveTab('bill_missing')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'bill_missing'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 ring-2 ring-rose-400 ring-offset-2 animate-pulse'
              : billMissingQueue.length > 0
              ? 'bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 hover:border-rose-400'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileWarning className={`w-3.5 h-3.5 ${activeTab === 'bill_missing' ? 'text-white' : 'text-rose-600'}`} />
          <span>Bill Missing</span>
          {billMissingQueue.length > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                activeTab === 'bill_missing' ? 'bg-white text-rose-700' : 'bg-rose-600 text-white animate-bounce'
              }`}
            >
              {billMissingQueue.length}
            </span>
          )}
        </button>
      </div>

      {billMissingQueue.length > 0 && activeTab !== 'bill_missing' && (
        <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-xl flex items-center justify-between gap-3 text-xs text-rose-950 shadow-md shadow-rose-500/10 animate-in fade-in">
          <div className="flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-rose-600 shrink-0 animate-bounce" />
            <span>
              <strong>{billMissingQueue.length}</strong> request{billMissingQueue.length === 1 ? '' : 's'} has <strong>original bill missing</strong>. Entry account has flagged these requests.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('bill_missing')}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs transition-all shadow-md shadow-rose-600/30"
          >
            View Bill Missing ({billMissingQueue.length})
          </button>
        </div>
      )}

      {/* High-value rule reminder */}
      {activeTab === 'routing' && (
        <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-4 flex items-start gap-3 text-xs text-indigo-950">
          <ShieldAlert className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Workflow Routing Rule:</span>
            <p className="mt-0.5 text-indigo-800 leading-relaxed">
              General requests <strong>above {limit}</strong> can only be routed to Route A (Admin). Requests{' '}
              <strong>{limit} or less</strong> can be sent to either Route A or Route B (Department Head).{' '}
              <strong>Discount</strong> approvals go to Route B (Head) and <strong>Exhibition</strong> requests go to
              Route A (Admin).
            </p>
          </div>
        </div>
      )}

      {source.length > 0 && (
        <RequestFilters value={filters} onChange={setFilters} source={source} resultCount={visible.length} />
      )}

      {/* Queue Content */}
      {source.length === 0 ? (
        <EmptyState
          icon={activeTab === 'routing' ? CheckCircle2 : FileWarning}
          title={activeTab === 'routing' ? 'All Caught Up!' : 'No Missing Bills'}
          description={
            activeTab === 'routing'
              ? 'There are currently no new department requests waiting for routing.'
              : 'None of your department requests currently have missing original bills.'
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={Inbox} title="No matching requests" description="Try clearing the filters." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}

      {/* Modals */}
      {modalType === 'route' && activeRequest && (
        <RouteModal
          isOpen={true}
          onClose={() => {
            setModalType(null);
            setActiveRequest(null);
          }}
          request={activeRequest}
          onRoute={async (rt, rm, v, entryUserId) => {
            const res = await routeRequest(activeRequest.id, rt, rm, v, entryUserId);
            if (!res.success) throw new Error(res.error || 'Routing failed');
          }}
        />
      )}

      {modalType === 'return' && activeRequest && (
        <ReturnModal
          isOpen={true}
          onClose={() => {
            setModalType(null);
            setActiveRequest(null);
          }}
          request={activeRequest}
          onReturn={async (rm, v) => {
            const res = await returnRequest(activeRequest.id, rm, v);
            if (!res.success) throw new Error(res.error || 'Return failed');
          }}
        />
      )}
    </div>
  );
};
