import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import {
  formatINR,
  formatISTDate,
  getTodayIST,
  toISTDateKey,
  TYPE_BADGES,
  TYPE_LABELS,
  typeOf,
} from '../../lib/formatters';
import {
  CheckCircle2,
  Search,
  Download,
  Eye,
  Calendar,
  ShieldCheck,
  Banknote,
  UserCheck,
  X,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';
import { canUserViewApprovedRequest } from '../../lib/workflow';
import { isDisbursementAssociated, isNonCashRequestType } from '../../types/database';
import { useDirectory } from '../../lib/directory';
import { AssignEntryAccountModal } from '../../components/portals/AssignEntryAccountModal';
import { SignedDocPreviewModal } from '../../components/requests/SignedDocPreviewModal';
import { downloadSignedPacket } from '../../lib/files';
import type { RequestRecord } from '../../types/database';

type DatePreset = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';

export const ApprovedRequestsPage: React.FC = () => {
  const { user, role, isBackendConnected } = useAuth();
  const { requests } = useRequests();
  const dir = useDirectory();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedShop, setSelectedShop] = useState<string>('all');
  const [adminOnly, setAdminOnly] = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<DatePreset>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [assignTarget, setAssignTarget] = useState<RequestRecord | null>(null);
  const [previewSignedDoc, setPreviewSignedDoc] = useState<{
    path: string;
    name: string;
    approvalNo?: string | null;
  } | null>(null);

  const isHeadRole = role === 'head' || role === 'regional_head';
  const canManageEntryAccount = role === 'admin' || role === 'clerk' || isHeadRole;
  const todayIST = getTodayIST();

  // Filter approved or paid requests that the current user has access to based on their role:
  // - Head: only respective head's approvals (approved by this head or by admin for their department/scope)
  // - Clerk: only applications they touched (routed by them or acted on)
  // - Regional Head: only applications they touched (forwarded/managed by them or acted on)
  // - Employee: strictly their own requests
  // - Admin: all approved
  // - Disbursement (payment_only): only associated approved/paid requests
  const approvedList = useMemo(() => {
    return requests
      .filter((r) => canUserViewApprovedRequest(r, user, dir.users))
      .sort(
        (a, b) =>
          new Date(b.decided_at || b.updated_at || b.created_at).getTime() -
          new Date(a.decided_at || a.updated_at || a.created_at).getTime()
      );
  }, [requests, user, dir.users]);

  const todayCount = useMemo(() => {
    return approvedList.filter(
      (r) => toISTDateKey(r.decided_at || r.updated_at || r.created_at) === todayIST
    ).length;
  }, [approvedList, todayIST]);

  const availableShops = useMemo(() => {
    const map = new Map<string, string>();
    (dir.shops || []).forEach((s) => {
      if (s.name && s.name.trim()) map.set(s.name.trim(), s.name.trim());
    });
    approvedList.forEach((r) => {
      if (r.shop_name && r.shop_name.trim()) {
        map.set(r.shop_name.trim(), r.shop_name.trim());
      }
      const conductingShop = (r.details as any)?.conducting_shop_name;
      if (conductingShop && typeof conductingShop === 'string' && conductingShop.trim()) {
        map.set(conductingShop.trim(), conductingShop.trim());
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [dir.shops, approvedList]);

  const adminApprovedCount = useMemo(() => {
    return approvedList.filter(
      (r) =>
        r.approver_role === 'admin' ||
        r.route === 'A' ||
        (r.actions || []).some(
          (a) =>
            (a.action === 'approved' || a.action === 'admin_approved') &&
            a.actor_role === 'admin'
        )
    ).length;
  }, [approvedList]);

  const handleToggleTodayOnly = () => {
    if (dateRange === 'today') {
      setDateRange('all');
      setFromDate('');
      setToDate('');
    } else {
      const today = getTodayIST();
      setDateRange('today');
      setFromDate(today);
      setToDate(today);
    }
  };

  const handlePresetChange = (preset: DatePreset) => {
    if (preset === 'today') {
      const today = getTodayIST();
      setDateRange('today');
      setFromDate(today);
      setToDate(today);
    } else if (preset === 'custom') {
      setDateRange('custom');
    } else {
      setDateRange(preset);
      setFromDate('');
      setToDate('');
    }
  };

  const handleFromDateChange = (val: string) => {
    setFromDate(val);
    const nextTo = toDate && val && val > toDate ? val : toDate;
    if (nextTo !== toDate) setToDate(nextTo);
    const today = getTodayIST();
    if (!val && !nextTo) {
      setDateRange('all');
    } else if (val === today && nextTo === today) {
      setDateRange('today');
    } else {
      setDateRange('custom');
    }
  };

  const handleToDateChange = (val: string) => {
    setToDate(val);
    const nextFrom = fromDate && val && val < fromDate ? val : fromDate;
    if (nextFrom !== fromDate) setFromDate(nextFrom);
    const today = getTodayIST();
    if (!nextFrom && !val) {
      setDateRange('all');
    } else if (nextFrom === today && val === today) {
      setDateRange('today');
    } else {
      setDateRange('custom');
    }
  };

  const hasActiveFilters =
    Boolean(query.trim()) ||
    selectedType !== 'all' ||
    selectedShop !== 'all' ||
    adminOnly ||
    dateRange !== 'all' ||
    Boolean(fromDate) ||
    Boolean(toDate);

  const clearAllFilters = () => {
    setQuery('');
    setSelectedType('all');
    setSelectedShop('all');
    setAdminOnly(false);
    setDateRange('all');
    setFromDate('');
    setToDate('');
  };

  const filtered = useMemo(() => {
    const today = getTodayIST();
    return approvedList.filter((r) => {
      // Type filter
      if (selectedType !== 'all' && typeOf(r) !== selectedType) return false;

      // Shop filter
      if (selectedShop !== 'all') {
        const sLower = selectedShop.toLowerCase().trim();
        const shopMatches = (r.shop_name || '').toLowerCase().trim() === sLower;
        const conductingMatches = ((r.details as any)?.conducting_shop_name || '').toLowerCase().trim() === sLower;
        const shopIdMatches = r.shop_id === selectedShop;
        if (!shopMatches && !conductingMatches && !shopIdMatches) return false;
      }

      // Admin Approved Only filter
      if (adminOnly) {
        const isApprovedByAdmin =
          r.approver_role === 'admin' ||
          r.route === 'A' ||
          (r.actions || []).some(
            (a) =>
              (a.action === 'approved' || a.action === 'admin_approved') &&
              a.actor_role === 'admin'
          );
        if (!isApprovedByAdmin) return false;
      }

      const approvedTs = r.decided_at || r.updated_at || r.created_at;
      const approvedDateKey = toISTDateKey(approvedTs);

      // Today Only / Custom From-To Date filter (exact IST calendar day comparison)
      if (dateRange === 'today') {
        if (approvedDateKey !== today) return false;
      } else if (fromDate || toDate) {
        if (!approvedDateKey) return false;
        if (fromDate && approvedDateKey < fromDate) return false;
        if (toDate && approvedDateKey > toDate) return false;
      } else if (dateRange === '7d' || dateRange === '30d' || dateRange === '90d') {
        const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
        const todayMidnightIST = new Date(`${today}T00:00:00+05:30`).getTime();
        const cutoffKey = toISTDateKey(new Date(todayMidnightIST - (days - 1) * 86400000));
        if (!approvedDateKey || approvedDateKey < cutoffKey) return false;
      }

      // Search query
      if (query.trim()) {
        const q = query.toLowerCase().trim();
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchReqNo = (r.request_no || '').toLowerCase().includes(q);
        const matchAppNo = (r.approval_no || '').toLowerCase().includes(q);
        const matchRequester = (r.requester_name || '').toLowerCase().includes(q);
        const matchShop = (r.shop_name || '').toLowerCase().includes(q);
        const matchDept = (r.department?.name || '').toLowerCase().includes(q);
        if (!matchTitle && !matchReqNo && !matchAppNo && !matchRequester && !matchShop && !matchDept) {
          return false;
        }
      }
      return true;
    });
  }, [approvedList, selectedType, dateRange, fromDate, toDate, query]);

  const handleDownloadPacket = async (r: RequestRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    const packet = (r.signed_files || []).find((s) => s.is_packet) || (r.signed_files || [])[0];
    if (packet) {
      await downloadSignedPacket(r, isBackendConnected);
    } else {
      const signed = (r.files || []).find((f) => f.kind === 'document' && f.original_name?.toLowerCase().includes('approval'));
      if (signed?.public_url) {
        window.open(signed.public_url, '_blank');
      } else {
        navigate(`/requests/${r.id}`);
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">Approved Requests</h1>
              <p className="text-xs sm:text-sm text-slate-500">
                {role === 'head'
                  ? 'Official approvals for your department, approved by you or admin.'
                  : role === 'clerk'
                  ? 'Official approvals for requests handled and routed by you.'
                  : role === 'regional_head'
                  ? 'Official approvals for requests submitted or forwarded by you.'
                  : role === 'employee'
                  ? 'Your official approved requests with signed approval documents.'
                  : 'Official approved and finalized requests with signed approval documents.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{filtered.length} Approved</span>
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, request no, approval no, shop, requester…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden bg-slate-50/50"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:border-emerald-500 outline-hidden font-medium text-slate-700 w-full sm:w-auto"
            >
              <option value="all">All Request Types</option>
              <option value="general">General</option>
              <option value="discount">Discount Approval</option>
              <option value="exhibition">Exhibition / Event</option>
              <option value="asset">Asset Buying</option>
              <option value="asset_below_20k">Asset Buying Below 20k</option>
              <option value="non_cash">Non Cash</option>
              <option value="stock_transfer">Stock Transfer</option>
              <option value="petty_cash">Petty Cash</option>
              <option value="agreement">Agreement</option>
              <option value="statutory_payment">Statutory Payment</option>
              <option value="audit_report">Audit Report</option>
            </select>

            <select
              value={selectedShop}
              onChange={(e) => setSelectedShop(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:border-emerald-500 outline-hidden font-medium text-slate-700 w-full sm:w-auto max-w-[200px]"
            >
              <option value="all">🏪 All Shops ({availableShops.length})</option>
              {availableShops.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={dateRange}
              onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
              className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white focus:border-emerald-500 outline-hidden font-medium text-slate-700 w-full sm:w-auto"
            >
              <option value="all">All Time</option>
              <option value="today">Today Only</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              {dateRange === 'custom' && <option value="custom">Custom Date Range</option>}
            </select>
          </div>
        </div>

        {/* Date-to-Date & Today Only Row */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              id="approved-today-only-btn"
              onClick={handleToggleTodayOnly}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                dateRange === 'today'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-200'
                  : 'bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Today Only</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                  dateRange === 'today'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-200/80 text-emerald-900'
                }`}
              >
                {todayCount}
              </span>
            </button>

            <button
              type="button"
              id="approved-admin-only-btn"
              onClick={() => setAdminOnly((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                adminOnly
                  ? 'bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-200 ring-2 ring-purple-400/30'
                  : 'bg-purple-50/70 hover:bg-purple-100 text-purple-800 border-purple-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin Approved Only</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                  adminOnly
                    ? 'bg-white/20 text-white'
                    : 'bg-purple-200/80 text-purple-900'
                }`}
              >
                {adminApprovedCount}
              </span>
            </button>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">From</span>
                <input
                  type="date"
                  id="approved-filter-from-date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-800 outline-hidden cursor-pointer"
                />
              </label>

              <span className="text-slate-400 text-xs font-bold hidden sm:inline">→</span>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">To</span>
                <input
                  type="date"
                  id="approved-filter-to-date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-800 outline-hidden cursor-pointer"
                />
              </label>
            </div>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              id="approved-clear-filters-btn"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors self-start sm:self-auto cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Requests List */}
      {approvedList.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No approved requests yet"
          description="Requests that have completed approval will appear in this panel."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching approved requests"
          description="Try changing your search keywords or filters."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((req) => {
            const t = typeOf(req);
            const isNonCash = isNonCashRequestType(t);
            const isPaid = req.status === 'paid';

            return (
              <div
                key={req.id}
                onClick={() => navigate(`/requests/${req.id}`)}
                className="group relative bg-white border border-slate-200/90 hover:border-emerald-300 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${TYPE_BADGES[t]}`}>
                        {TYPE_LABELS[t]}
                      </span>
                      {req.approval_no && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {req.approval_no}
                        </span>
                      )}
                      {isPaid && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 flex items-center gap-1">
                          <Banknote className="w-3 h-3 text-teal-600" />
                          <span>Paid</span>
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-extrabold font-display text-slate-900">
                        {isNonCash ? (
                          <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">Non Cash</span>
                        ) : req.request_type === 'stock_transfer' ? (
                          <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200 font-display">
                            MRP {formatINR(req.amount)}
                          </span>
                        ) : (
                          formatINR(req.amount)
                        )}
                      </div>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-2 mb-2">
                    {req.title}
                  </h3>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 mb-3 bg-slate-50/70 p-2.5 rounded-xl">
                    <div className="truncate">
                      <span className="text-slate-400 block text-[10px]">Requester</span>
                      <span className="font-semibold text-slate-700 truncate block">{req.requester_name}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-400 block text-[10px]">Shop</span>
                      <span className="font-semibold text-slate-700 truncate block">{req.shop_name || '—'}</span>
                    </div>
                    {req.owner_head_name && (
                      <div className="truncate">
                        <span className="text-slate-400 block text-[10px]">Approved By Head</span>
                        <span className="font-semibold text-slate-700 truncate block">{req.owner_head_name}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block text-[10px]">Approved On</span>
                      <span className="font-semibold text-slate-700 block">{formatISTDate(req.decided_at || req.updated_at)}</span>
                    </div>
                  </div>

                  {/* Disbursement Entry Account row for payment-needed requests */}
                  {isDisbursementAssociated(t) && (
                    <div className="mb-3 px-3 py-2 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block">
                            Disbursement Entry Account
                          </span>
                          <span className="text-xs font-bold text-slate-900 truncate block">
                            {req.assigned_entry_user_name ? (
                              <span className="text-indigo-950 font-extrabold">{req.assigned_entry_user_name}</span>
                            ) : (
                              <span className="text-amber-700 italic font-medium">Not assigned yet</span>
                            )}
                          </span>
                        </div>
                      </div>
                      {((req.disbursement_entries || []).filter((e) => e.status !== 'cancelled').length === 0) ? (
                        canManageEntryAccount && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAssignTarget(req);
                            }}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50 shadow-2xs transition-colors shrink-0 cursor-pointer"
                          >
                            {req.assigned_entry_user_id ? 'Change' : 'Assign'}
                          </button>
                        )
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">
                          Locked ({(req.disbursement_entries || []).filter((e) => e.status !== 'cancelled').length} entries)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {req.request_no || 'REQ'}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/requests/${req.id}`);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Details</span>
                    </button>
                    {(() => {
                      const packet = (req.signed_files || []).find((s) => s.is_packet) || (req.signed_files || [])[0];
                      if (!packet) return null;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewSignedDoc({
                              path: packet.storage_path,
                              name: packet.file_name || `${req.approval_no || req.request_no}_packet.pdf`,
                              approvalNo: req.approval_no,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs transition-colors cursor-pointer"
                          title="Preview official approved signed document"
                        >
                          <Eye className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Preview Approved Doc</span>
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={(e) => handleDownloadPacket(req, e)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Packet</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Entry Account Modal */}
      {assignTarget && (
        <AssignEntryAccountModal
          isOpen={true}
          onClose={() => setAssignTarget(null)}
          request={assignTarget}
        />
      )}

      {/* Signed Document Preview Modal */}
      <SignedDocPreviewModal
        isOpen={Boolean(previewSignedDoc)}
        onClose={() => setPreviewSignedDoc(null)}
        storagePath={previewSignedDoc?.path || null}
        fileName={previewSignedDoc?.name || 'signed_approval.pdf'}
        approvalNo={previewSignedDoc?.approvalNo}
      />
    </div>
  );
};
