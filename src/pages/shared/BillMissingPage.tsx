import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { canUserViewBillMissingRequest } from '../../lib/workflow';
import { formatINR, typeOf } from '../../lib/formatters';
import type { RequestRecord } from '../../types/database';
import {
  FileWarning,
  Search,
  CheckCircle2,
  Clock,
  Building2,
  Store,
  Filter,
  Receipt,
  AlertTriangle,
  Upload,
} from 'lucide-react';

export const BillMissingPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'submitted'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine' | 'team'>('all');

  // Strictly filter requests associated with this specific user
  const billMissingList = useMemo(() => {
    return requests.filter((r) => canUserViewBillMissingRequest(r, user));
  }, [requests, user]);

  // Breakdown counts
  const awaitingUploadCount = useMemo(() => {
    return billMissingList.filter((r) => !r.bill_missing_status || r.bill_missing_status === 'missing').length;
  }, [billMissingList]);

  const awaitingReviewCount = useMemo(() => {
    return billMissingList.filter((r) => r.bill_missing_status === 'submitted').length;
  }, [billMissingList]);

  const totalMissingAmount = useMemo(() => {
    return billMissingList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  }, [billMissingList]);

  const myRequestsCount = useMemo(() => {
    return billMissingList.filter((r) => r.requester_id === user?.id).length;
  }, [billMissingList, user?.id]);

  const teamRequestsCount = useMemo(() => {
    return billMissingList.filter((r) => r.requester_id !== user?.id).length;
  }, [billMissingList, user?.id]);

  // Filtered results
  const filtered = useMemo(() => {
    return billMissingList.filter((r) => {
      // Scope filter
      if (scopeFilter === 'mine' && r.requester_id !== user?.id) return false;
      if (scopeFilter === 'team' && r.requester_id === user?.id) return false;

      // Status filter
      if (statusFilter === 'missing' && r.bill_missing_status === 'submitted') return false;
      if (statusFilter === 'submitted' && r.bill_missing_status !== 'submitted') return false;

      // Type filter
      if (typeFilter !== 'all' && typeOf(r) !== typeFilter) return false;

      // Search query
      if (query.trim()) {
        const q = query.toLowerCase().trim();
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchReqNo = (r.request_no || '').toLowerCase().includes(q);
        const matchAppNo = (r.approval_no || '').toLowerCase().includes(q);
        const matchRequester = (r.requester_name || '').toLowerCase().includes(q);
        const matchShop = (r.shop_name || '').toLowerCase().includes(q);
        const matchDept = (r.department?.name || '').toLowerCase().includes(q);
        const matchNote = (r.bill_missing_note || '').toLowerCase().includes(q);
        const matchFlagBy = (r.bill_missing_by_name || '').toLowerCase().includes(q);

        if (
          !matchTitle &&
          !matchReqNo &&
          !matchAppNo &&
          !matchRequester &&
          !matchShop &&
          !matchDept &&
          !matchNote &&
          !matchFlagBy
        ) {
          return false;
        }
      }

      return true;
    });
  }, [billMissingList, scopeFilter, statusFilter, typeFilter, query, user?.id]);

  const isEntryOrAdmin = user?.role === 'admin' || user?.role === 'disbursement';

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-28">
      {/* Header Banner with Vibrant Red Glow */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-rose-700 via-red-600 to-rose-800 text-white p-6 sm:p-8 shadow-xl shadow-rose-600/30 border border-rose-500/50">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-xs font-bold tracking-wider uppercase shadow-xs">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>Critical Documentation Alert</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight flex items-center gap-3">
              <FileWarning className="w-8 h-8 text-rose-200 animate-pulse" />
              <span>Original Bill Missing Queue</span>
            </h1>
            <p className="text-xs sm:text-sm text-rose-100 leading-relaxed font-medium">
              These requests have been flagged by the Disbursement Entry desk because the original tax invoice or physical bill is missing.
              {isEntryOrAdmin
                ? ' Review submitted bills and mark them as received, or flag new requests.'
                : ' Please attach and submit the original bills to resume processing and payout.'}
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 flex flex-col items-center justify-center shrink-0 min-w-[160px] text-center shadow-lg">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-200">Total Held Value</span>
            <span className="text-2xl sm:text-3xl font-black font-display text-white mt-1">
              {formatINR(totalMissingAmount)}
            </span>
            <span className="text-[10px] text-rose-100 font-semibold mt-0.5">
              Across {billMissingList.length} request{billMissingList.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          onClick={() => setStatusFilter('all')}
          className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xs cursor-pointer transition-all ${
            statusFilter === 'all'
              ? 'bg-rose-50/90 border-rose-500 shadow-md shadow-rose-500/10 ring-2 ring-rose-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-rose-600 mb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider">All Bill Missing</span>
            <FileWarning className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-950 font-display">
            {billMissingList.length}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Total in your scope</span>
        </div>

        <div
          onClick={() => setStatusFilter('missing')}
          className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xs cursor-pointer transition-all ${
            statusFilter === 'missing'
              ? 'bg-rose-50/90 border-rose-500 shadow-md shadow-rose-500/10 ring-2 ring-rose-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-amber-600 mb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider">Awaiting Bill</span>
            <Upload className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-950 font-display flex items-center gap-2">
            <span>{awaitingUploadCount}</span>
            {awaitingUploadCount > 0 && (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping inline-block" />
            )}
          </div>
          <span className="text-[11px] text-amber-700 font-semibold mt-1 block">Needs upload & submit</span>
        </div>

        <div
          onClick={() => setStatusFilter('submitted')}
          className={`p-4 sm:p-5 rounded-2xl border-2 shadow-xs cursor-pointer transition-all ${
            statusFilter === 'submitted'
              ? 'bg-rose-50/90 border-rose-500 shadow-md shadow-rose-500/10 ring-2 ring-rose-300'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-indigo-600 mb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider">Bill Submitted</span>
            <Clock className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-950 font-display flex items-center gap-2">
            <span>{awaitingReviewCount}</span>
            {awaitingReviewCount > 0 && (
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-ping inline-block" />
            )}
          </div>
          <span className="text-[11px] text-indigo-700 font-semibold mt-1 block">Awaiting entry review</span>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Associated Scope</span>
            <Building2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 font-display truncate">
            {user?.role === 'employee' ? 'My Own Requests' : user?.department?.name || 'Department / Shops'}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            {myRequestsCount} mine • {teamRequestsCount} team
          </span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by request #, title, shop, requester, or bill missing note..."
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            />
          </div>

          {/* Scope Filter for non-employees */}
          {user?.role !== 'employee' && (
            <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1 text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  scopeFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({billMissingList.length})
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('mine')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  scopeFilter === 'mine' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                My Requests ({myRequestsCount})
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('team')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  scopeFilter === 'team' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Team ({teamRequestsCount})
              </button>
            </div>
          )}
        </div>

        {/* Sub-status and category filters */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-medium">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">Status:</span>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                statusFilter === 'all'
                  ? 'bg-rose-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All ({billMissingList.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('missing')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                statusFilter === 'missing'
                  ? 'bg-rose-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Awaiting Bill ({awaitingUploadCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('submitted')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                statusFilter === 'submitted'
                  ? 'bg-rose-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Bill Submitted ({awaitingReviewCount})
            </button>
          </div>
        </div>
      </div>

      {/* Results List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FileWarning}
          title="No Requests in Bill Missing Queue"
          description={
            query.trim() || statusFilter !== 'all' || scopeFilter !== 'all'
              ? 'No requests match your current search or filters.'
              : 'None of your associated requests currently have missing original bills. Everything is in order!'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
};
