import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import {
  formatINR,
  formatISTDate,
  TYPE_BADGES,
  TYPE_LABELS,
  ROLE_LABELS,
  typeOf,
} from '../../lib/formatters';
import {
  RotateCcw,
  Search,
  Eye,
  AlertTriangle,
  Building2,
  Store,
  Calendar,
  UserCheck,
  PlusCircle,
  CheckCircle2,
  Pencil,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';
import type { RequestRecord } from '../../types/database';

export const ReturnedRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine' | 'team'>('all');
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all');

  // All returned requests visible to the user under RLS
  const returnedList = useMemo(() => {
    return requests.filter((r) => r.status === 'returned');
  }, [requests]);

  // Breakdowns
  const myReturnedCount = useMemo(() => {
    return returnedList.filter((r) => r.requester_id === user?.id).length;
  }, [returnedList, user?.id]);

  const teamReturnedCount = useMemo(() => {
    return returnedList.filter((r) => r.requester_id !== user?.id).length;
  }, [returnedList, user?.id]);

  const totalHeldUpAmount = useMemo(() => {
    return returnedList.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  }, [returnedList]);

  // Helper to extract the most recent return action with remarks
  const getReturnAction = (r: RequestRecord) => {
    const returnActions = (r.actions || [])
      .filter((a) => a.action === 'returned' || a.action === 'return')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return returnActions[0] || null;
  };

  const filtered = useMemo(() => {
    return returnedList.filter((r) => {
      // Scope filter (Mine vs Team)
      if (scopeFilter === 'mine' && r.requester_id !== user?.id) return false;
      if (scopeFilter === 'team' && r.requester_id === user?.id) return false;

      // Type filter
      if (selectedType !== 'all' && typeOf(r) !== selectedType) return false;

      // Date range filter
      if (dateRange !== 'all') {
        const retAction = getReturnAction(r);
        const d = new Date(retAction?.created_at || r.updated_at).getTime();
        const now = Date.now();
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        if (now - d > days * 86400000) return false;
      }

      // Search query
      if (query.trim()) {
        const q = query.toLowerCase().trim();
        const retAction = getReturnAction(r);
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchReqNo = (r.request_no || '').toLowerCase().includes(q);
        const matchRequester = (r.requester_name || '').toLowerCase().includes(q);
        const matchShop = (r.shop_name || '').toLowerCase().includes(q);
        const matchDept = (r.department?.name || '').toLowerCase().includes(q);
        const matchRemarks = (retAction?.remarks || '').toLowerCase().includes(q);
        const matchActor = (retAction?.actor_name || '').toLowerCase().includes(q);
        if (
          !matchTitle &&
          !matchReqNo &&
          !matchRequester &&
          !matchShop &&
          !matchDept &&
          !matchRemarks &&
          !matchActor
        ) {
          return false;
        }
      }
      return true;
    });
  }, [returnedList, scopeFilter, selectedType, dateRange, query, user?.id]);

  const hasMultipleScopes = teamReturnedCount > 0 && myReturnedCount > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-200">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
                Returned for Correction
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Applications returned by reviewers for revisions, missing documents, or remarks.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
            <RotateCcw className="w-4 h-4 text-amber-600" />
            <span>{filtered.length} Applications</span>
          </span>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Total Returned</span>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 font-display">
            {returnedList.length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Across your visible scope</p>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-900">Requiring My Resubmission</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-extrabold text-amber-950 mt-1 font-display">
            {myReturnedCount}
          </p>
          <p className="text-[11px] text-amber-700/80 mt-0.5">
            {myReturnedCount > 0 ? 'Action needed from you' : 'No personal requests returned'}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Held Up Value</span>
            <span className="text-[11px] font-bold text-slate-400">INR</span>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 font-display">
            {formatINR(totalHeldUpAmount)}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">Awaiting correction & approval</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        {/* Scope Tabs if user has both personal & team requests */}
        {hasMultipleScopes && (
          <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 overflow-x-auto">
            <button
              type="button"
              onClick={() => setScopeFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scopeFilter === 'all'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Returned ({returnedList.length})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('mine')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scopeFilter === 'mine'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              My Requests ({myReturnedCount})
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('team')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scopeFilter === 'team'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Team / Store Requests ({teamReturnedCount})
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, request no, requester, shop, remarks…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden bg-slate-50/50"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:border-amber-500 outline-hidden font-medium text-slate-700 w-full sm:w-auto"
            >
              <option value="all">All Request Types</option>
              <option value="general">General</option>
              <option value="discount">Discount Approval</option>
              <option value="exhibition">Exhibition / Event</option>
              <option value="asset">Asset Buying</option>
              <option value="non_cash">Non Cash</option>
            </select>

            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:border-amber-500 outline-hidden font-medium text-slate-700 w-full sm:w-auto"
            >
              <option value="all">All Time</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Requests List */}
      {returnedList.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No applications returned for correction"
          description="All applications are either progressing through approval or have completed."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching returned applications"
          description="Try changing your search keywords or clearing your filters."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((req) => {
            const t = typeOf(req);
            const isNonCash = t === 'non_cash';
            const isOwner = req.requester_id === user?.id;
            const retAction = getReturnAction(req);

            return (
              <div
                key={req.id}
                onClick={() => navigate(`/requests/${req.id}`)}
                className="group relative bg-white border border-slate-200/90 hover:border-amber-300 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Types, Request No, Amount */}
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${TYPE_BADGES[t]}`}
                      >
                        {TYPE_LABELS[t]}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1">
                        <RotateCcw className="w-3 h-3 text-amber-600" />
                        <span>Returned</span>
                      </span>
                      {req.request_no && (
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                          {req.request_no}
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-extrabold font-display text-slate-900">
                        {isNonCash ? (
                          <span className="text-xs text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            Non Cash
                          </span>
                        ) : (
                          formatINR(req.amount)
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-amber-800 transition-colors line-clamp-2 mb-3">
                    {req.title}
                  </h3>

                  {/* Return Remarks Box */}
                  <div className="mb-3 p-3 rounded-xl bg-gradient-to-r from-amber-50/90 to-amber-50/40 border border-amber-200/90 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>
                          Returned by {retAction?.actor_name || 'Reviewer'}
                          {retAction?.actor_role
                            ? ` (${ROLE_LABELS[retAction.actor_role] || retAction.actor_role})`
                            : ''}
                        </span>
                      </div>
                      {retAction?.created_at && (
                        <span className="text-amber-700 font-medium text-[10px]">
                          {formatISTDate(retAction.created_at)}
                        </span>
                      )}
                    </div>

                    {retAction?.remarks ? (
                      <p className="text-slate-800 text-[11px] italic bg-white/80 p-2 rounded-lg border border-amber-100 font-medium line-clamp-3">
                        “{retAction.remarks}”
                      </p>
                    ) : (
                      <p className="text-amber-700/80 text-[11px] italic">
                        No specific written remarks provided.
                      </p>
                    )}

                    {(req.files || []).some((f) => f.kind === 'voice_note') && (
                      <div className="pt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded-md">
                          Voice note instructions attached
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 mb-3 bg-slate-50/70 p-2.5 rounded-xl">
                    <div className="truncate">
                      <span className="text-slate-400 block text-[10px]">Requester</span>
                      <span className="font-semibold text-slate-700 truncate block">
                        {req.requester_name}
                      </span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-400 block text-[10px]">Shop</span>
                      <span className="font-semibold text-slate-700 truncate block">
                        {req.shop_name || '—'}
                      </span>
                    </div>
                    {req.department?.name && (
                      <div className="truncate">
                        <span className="text-slate-400 block text-[10px]">Department</span>
                        <span className="font-semibold text-slate-700 truncate block">
                          {req.department.name}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block text-[10px]">Submitted On</span>
                      <span className="font-semibold text-slate-700 block">
                        {formatISTDate(req.created_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-medium text-slate-500">
                    {isOwner ? (
                      <span className="text-amber-700 font-semibold flex items-center gap-1">
                        <Pencil className="w-3 h-3" />
                        <span>Ready for your edit & resubmit</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">Awaiting requester edit</span>
                    )}
                  </span>

                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/requests/${req.id}`);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit & Resubmit</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/requests/${req.id}`);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Details</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
