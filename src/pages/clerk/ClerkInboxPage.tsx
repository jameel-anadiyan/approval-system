import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { RouteModal } from '../../components/portals/RouteModal';
import { ReturnModal } from '../../components/portals/ReturnModal';
import { RequestRecord } from '../../types/database';
import { Inbox, CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatINRWhole } from '../../lib/formatters';
import { isMyRoutingRequest } from '../../lib/workflow';

export const ClerkInboxPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, routeRequest, returnRequest, threshold } = useRequests();
  const limit = formatINRWhole(threshold);

  const [activeRequest, setActiveRequest] = useState<RequestRecord | null>(null);
  const [modalType, setModalType] = useState<'route' | 'return' | null>(null);

  // Clerk inbox: submitted requests of own department in my work categories (oldest first by default)
  const pendingRouting = requests.filter((r) => isMyRoutingRequest(r, user));
  const otherClerksCount = requests.filter(
    (r) => r.status === 'submitted' && r.department_id === user?.department_id && !isMyRoutingRequest(r, user)
  ).length;
  const { filters, setFilters, result: visible } = useRequestFilters(pendingRouting, { sort: 'oldest' });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Clerk Routing Queue
          </h1>
          {pendingRouting.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
              {pendingRouting.length} waiting
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Review newly submitted department vouchers (oldest first) and assign approval routes.
          {otherClerksCount > 0 && (
            <span className="block text-[11px] text-slate-400 mt-0.5">
              {otherClerksCount} more waiting with other clerks (other work categories).
            </span>
          )}
        </p>
      </div>

      {/* High-value rule reminder */}
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

      {pendingRouting.length > 0 && (
        <RequestFilters value={filters} onChange={setFilters} source={pendingRouting} resultCount={visible.length} />
      )}

      {/* Queue Content */}
      {pendingRouting.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All Caught Up!"
          description="There are currently no new department requests waiting for routing."
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
          onRoute={async (rt, rm, v) => {
            const res = await routeRequest(activeRequest.id, rt, rm, v);
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
