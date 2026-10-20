import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { CheckCircle2, Inbox, Info, History } from 'lucide-react';
import { isMyRegionalRequest } from '../../lib/workflow';

/**
 * Regional Head queue: employee requests waiting to be checked and forwarded to the clerk.
 * A Regional Head only forwards or returns — approval stays with the Head / Admin.
 */
export const RegionalInboxPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  const pending = requests.filter((r) => isMyRegionalRequest(r, user));
  const history = requests.filter(
    (r) => r.regional_head_id === user?.id && r.status !== 'pending_regional_review' && r.requester_id !== user?.id
  );
  const source = tab === 'pending' ? pending : history;
  const { filters, setFilters, result: visible } = useRequestFilters(source, { sort: tab === 'pending' ? 'oldest' : 'newest' });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">Regional Queue</h1>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">{pending.length} waiting</span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Check requests from employees of your shops and forward them to the clerk, or return them for correction.
        </p>
      </div>

      <div className="bg-cyan-50/70 border border-cyan-200/80 rounded-2xl p-4 flex items-start gap-3 text-xs text-cyan-950">
        <Info className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed text-cyan-900">
          As Regional Head you <strong>forward</strong> or <strong>return</strong> requests. Approval is done later by the
          Department Head or Admin. Open a request to act on it.
        </p>
      </div>

      <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200" role="tablist">
        {(
          [
            ['pending', `To forward (${pending.length})`, Inbox],
            ['history', `Forwarded / returned (${history.length})`, History],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`regional-tab-${key}`}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {source.length > 0 && (
        <RequestFilters value={filters} onChange={setFilters} source={source} resultCount={visible.length} />
      )}

      {source.length === 0 ? (
        <EmptyState
          icon={tab === 'pending' ? CheckCircle2 : History}
          title={tab === 'pending' ? 'All Caught Up!' : 'Nothing yet'}
          description={
            tab === 'pending'
              ? 'No employee requests are waiting for you.'
              : 'Requests you forward or return will appear here.'
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState icon={Inbox} title="No matching requests" description="Try clearing the filters." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((req) => (
            <RequestCard key={req.id} request={req} showDepartment={false} />
          ))}
        </div>
      )}
    </div>
  );
};
