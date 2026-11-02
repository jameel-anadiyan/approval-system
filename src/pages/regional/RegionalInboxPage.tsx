import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { CheckCircle2, Inbox, Info, Send, RotateCcw, AlertTriangle, FileWarning } from 'lucide-react';
import { isMyRegionalRequest, canUserViewBillMissingRequest } from '../../lib/workflow';
import type { RequestRecord } from '../../types/database';

/**
 * Regional Head queue:
 * 1. "To forward": employee requests waiting to be checked and forwarded to the clerk.
 * 2. "Forwarded": requests forwarded to the clerk, currently in routing/approval or finished.
 * 3. "Returned": requests returned for correction by Regional Head, Clerk, Head, or Admin.
 * 4. "Bill Missing": requests with original bill missing where the regional head or requester can upload and submit original bills.
 */
export const RegionalInboxPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const location = useLocation();
  const navigate = useNavigate();

  const tabFromPath = location.pathname.endsWith('/returned')
    ? 'returned'
    : location.pathname.endsWith('/forwarded')
    ? 'forwarded'
    : 'pending';

  const [tab, setTab] = useState<'pending' | 'forwarded' | 'returned' | 'bill_missing'>(tabFromPath);

  useEffect(() => {
    const nextTab = location.pathname.endsWith('/returned')
      ? 'returned'
      : location.pathname.endsWith('/forwarded')
      ? 'forwarded'
      : 'pending';
    setTab(nextTab);
  }, [location.pathname]);

  const handleTabChange = (newTab: 'pending' | 'forwarded' | 'returned' | 'bill_missing') => {
    if (newTab === 'returned') {
      navigate('/returned');
      return;
    }
    setTab(newTab);
    if (newTab !== 'bill_missing') {
      navigate(newTab === 'forwarded' ? '/regional/forwarded' : '/regional');
    }
  };

  // Scope: strictly requests belonging to this Regional Head (his own requests or employee requests assigned to him)
  const isRegionalScope = (r: RequestRecord) =>
    r.requester_id === user?.id || r.regional_head_id === user?.id;

  // 1. Pending (To forward): employee requests waiting for regional head action
  const pending = requests.filter((r) => isMyRegionalRequest(r, user));

  // 2. Returned for correction: requests in scope that were returned
  const returned = requests.filter((r) => isRegionalScope(r) && r.status === 'returned');

  // 3. Forwarded / in progress: all requests in scope that have been forwarded or submitted
  const forwarded = requests.filter(
    (r) =>
      isRegionalScope(r) &&
      r.status !== 'pending_regional_review' &&
      (r.status !== 'draft' || r.requester_id === user?.id)
  );

  // 4. Bill missing queue strictly associated with this regional head or their shops
  const billMissing = requests.filter((r) => canUserViewBillMissingRequest(r, user));

  const source =
    tab === 'pending'
      ? pending
      : tab === 'returned'
      ? returned
      : tab === 'bill_missing'
      ? billMissing
      : forwarded;

  const { filters, setFilters, result: visible } = useRequestFilters(source, {
    sort: tab === 'pending' ? 'oldest' : 'newest',
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">Regional Queue</h1>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
              {pending.length} waiting
            </span>
          )}
          {billMissing.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs font-bold shadow-xs shadow-rose-600/30 animate-pulse">
              {billMissing.length} bill missing
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Check requests from employees of your shops, track forwarded requests, and review requests returned for correction.
        </p>
      </div>

      <div className="bg-cyan-50/70 border border-cyan-200/80 rounded-2xl p-4 flex items-start gap-3 text-xs text-cyan-950">
        <Info className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed text-cyan-900">
          As Regional Head you <strong>forward</strong> or <strong>return</strong> requests. Approval is done later by the
          Department Head or Admin. Open a request to act on it.
        </p>
      </div>

      {billMissing.length > 0 && tab !== 'bill_missing' && (
        <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-xl flex items-center justify-between gap-3 text-xs text-rose-950 shadow-md shadow-rose-500/10 animate-in fade-in">
          <div className="flex items-center gap-2">
            <FileWarning className="w-4 h-4 text-rose-600 shrink-0 animate-bounce" />
            <span>
              <strong>{billMissing.length}</strong> request{billMissing.length === 1 ? '' : 's'} has <strong>original bill missing</strong>. Please attach original bills.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTab('bill_missing')}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs transition-all shadow-md shadow-rose-600/30"
          >
            View Bill Missing ({billMissing.length})
          </button>
        </div>
      )}

      {returned.length > 0 && tab !== 'returned' && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{returned.length}</strong> request{returned.length === 1 ? '' : 's'} returned for correction.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleTabChange('returned')}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0 shadow-2xs"
          >
            View Returned
          </button>
        </div>
      )}

      <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1 flex-wrap" role="tablist">
        {(
          [
            ['pending', `To forward (${pending.length})`, Inbox, pending.length > 0 ? 'bg-rose-500 text-white' : undefined],
            ['forwarded', `Forwarded (${forwarded.length})`, Send, undefined],
            ['returned', `Returned (${returned.length})`, RotateCcw, returned.length > 0 ? 'bg-amber-500 text-white' : undefined],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`regional-tab-${key}`}
            aria-selected={tab === key}
            onClick={() => handleTabChange(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${tab === key && key === 'returned' ? 'text-amber-600' : ''}`} />
            <span>{label}</span>
          </button>
        ))}

        {/* Glowing Red Bill Missing Tab */}
        <button
          type="button"
          role="tab"
          id="regional-tab-bill_missing"
          aria-selected={tab === 'bill_missing'}
          onClick={() => handleTabChange('bill_missing')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
            tab === 'bill_missing'
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 ring-2 ring-rose-400 ring-offset-2 animate-pulse'
              : billMissing.length > 0
              ? 'bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 hover:border-rose-400'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileWarning className={`w-3.5 h-3.5 ${tab === 'bill_missing' ? 'text-white' : 'text-rose-600'}`} />
          <span>Bill Missing</span>
          {billMissing.length > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                tab === 'bill_missing' ? 'bg-white text-rose-700' : 'bg-rose-600 text-white animate-bounce'
              }`}
            >
              {billMissing.length}
            </span>
          )}
        </button>
      </div>

      {source.length > 0 && (
        <RequestFilters value={filters} onChange={setFilters} source={source} showStatus resultCount={visible.length} />
      )}

      {source.length === 0 ? (
        <EmptyState
          icon={tab === 'pending' ? CheckCircle2 : tab === 'returned' ? RotateCcw : tab === 'bill_missing' ? FileWarning : Send}
          title={
            tab === 'pending'
              ? 'All Caught Up!'
              : tab === 'returned'
              ? 'No Returned Requests'
              : tab === 'bill_missing'
              ? 'No Missing Bills'
              : 'No Forwarded Requests'
          }
          description={
            tab === 'pending'
              ? 'No employee requests are waiting for you to forward.'
              : tab === 'returned'
              ? 'Requests returned for correction will appear here.'
              : tab === 'bill_missing'
              ? 'None of your associated shop requests have missing original bills.'
              : 'Requests you forward to the clerk or in progress will appear here.'
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
