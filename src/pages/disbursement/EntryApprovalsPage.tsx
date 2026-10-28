import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { EmptyState } from '../../components/common/EmptyState';
import { Modal } from '../../components/common/Modal';
import { DisbursementEntry, RequestRecord, entryOutstanding, entryHasBalanceAwaitingApproval } from '../../types/database';
import { formatINR, formatISTDate, typeOf } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import {
  CheckSquare,
  Square,
  CheckCircle2,
  XCircle,
  Banknote,
  Landmark,
  ShieldCheck,
  Clock,
  AlertCircle,
  FileText,
  Building2,
  Store,
  ChevronRight,
  Filter,
  Check,
  X,
  RotateCcw,
  PieChart,
  Percent,
  UserCheck,
} from 'lucide-react';

interface EntryWithRequest {
  entry: DisbursementEntry;
  request: RequestRecord;
}

export const EntryApprovalsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, approveDisbursementEntry, approveMultipleDisbursementEntries, rejectDisbursementEntry } = useRequests();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<EntryWithRequest | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [partialTarget, setPartialTarget] = useState<EntryWithRequest | null>(null);
  const [partialStr, setPartialStr] = useState<string>('');
  const [partialError, setPartialError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [modeFilter, setModeFilter] = useState<'all' | 'cash' | 'bank'>('all');

  // Collect all entries across payable approved requests
  const allEntriesWithRequests: EntryWithRequest[] = useMemo(() => {
    const list: EntryWithRequest[] = [];
    requests.forEach((r) => {
      if (typeOf(r) === 'discount' || typeOf(r) === 'stock_transfer' || typeOf(r) === 'non_cash') return;
      (r.disbursement_entries || []).forEach((e) => {
        if (e.status !== 'cancelled') {
          list.push({ entry: e, request: r });
        }
      });
    });
    // Sort: pending first by creation time, approved / rejected by updated/approved time
    return list.sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());
  }, [requests]);

  // Tab queues
  const pendingQueue = useMemo(
    () =>
      allEntriesWithRequests.filter(
        (item) => item.entry.status === 'pending_approval' || item.entry.status === 'pending'
      ),
    [allEntriesWithRequests]
  );

  const approvedQueue = useMemo(
    () => allEntriesWithRequests.filter((item) => item.entry.status === 'approved' || item.entry.status === 'paid'),
    [allEntriesWithRequests]
  );

  const rejectedQueue = useMemo(
    () => allEntriesWithRequests.filter((item) => item.entry.status === 'rejected'),
    [allEntriesWithRequests]
  );

  const currentQueue =
    activeTab === 'pending' ? pendingQueue : activeTab === 'approved' ? approvedQueue : rejectedQueue;

  // Filtered by search and cash/bank mode
  const filteredList = useMemo(() => {
    return currentQueue.filter((item) => {
      if (modeFilter !== 'all' && item.entry.entry_type !== modeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = [
          item.request.approval_no,
          item.request.request_no,
          item.request.title,
          item.request.requester_name,
          item.request.department?.name,
          item.request.shop_name,
          item.entry.notes,
          item.entry.created_by_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [currentQueue, modeFilter, searchQuery]);

  // Bulk selection handling
  const allCurrentSelected =
    filteredList.length > 0 && filteredList.every((item) => selectedIds.has(item.entry.id));

  const toggleSelectAll = () => {
    if (allCurrentSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map((item) => item.entry.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Actions
  const handleApproveOne = async (item: EntryWithRequest) => {
    setIsProcessing(true);
    setNotice(null);
    try {
      const res = await approveDisbursementEntry(item.entry.id);
      if (!res.success) throw new Error(res.error || 'Approval failed');
      setNotice({
        type: 'success',
        message: `Entry #${item.entry.entry_no} (${formatINR(entryOutstanding(item.entry))} · ${item.entry.entry_type.toUpperCase()}) fully approved and routed to payment accounts.`,
      });
      selectedIds.delete(item.entry.id);
      setSelectedIds(new Set(selectedIds));
    } catch (err: unknown) {
      setNotice({ type: 'error', message: errMsg(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  const openPartial = (item: EntryWithRequest) => {
    setPartialTarget(item);
    setPartialStr('');
    setPartialError(null);
  };

  const handlePartialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partialTarget) return;
    const outstanding = entryOutstanding(partialTarget.entry);
    const amt = Math.round((parseFloat(partialStr) || 0) * 100) / 100;
    setPartialError(null);
    if (amt <= 0) {
      setPartialError('Enter the amount you approve for payment now.');
      return;
    }
    if (amt >= outstanding) {
      setPartialError(
        `A partial approval must be less than the entry balance (${formatINR(outstanding)}). Use "Approve Full" to approve all of it.`
      );
      return;
    }

    setIsProcessing(true);
    setNotice(null);
    try {
      const res = await approveDisbursementEntry(partialTarget.entry.id, undefined, amt);
      if (!res.success) throw new Error(res.error || 'Partial approval failed');
      setNotice({
        type: 'success',
        message: `Entry #${partialTarget.entry.entry_no}: ${formatINR(amt)} approved for payment. The balance ${formatINR(outstanding - amt)} stays here for your verification after this part is paid.`,
      });
      selectedIds.delete(partialTarget.entry.id);
      setSelectedIds(new Set(selectedIds));
      setPartialTarget(null);
      setPartialStr('');
    } catch (err: unknown) {
      setPartialError(errMsg(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Approve and route all ${selectedIds.size} selected entries to payment accounts?`)) {
      return;
    }

    setIsProcessing(true);
    setNotice(null);
    try {
      const idsArray = Array.from(selectedIds);
      const res = await approveMultipleDisbursementEntries(idsArray);
      if (!res.success) throw new Error(res.error || 'Bulk approval failed');
      setNotice({
        type: 'success',
        message: `Successfully approved ${res.approved_count ?? idsArray.length} disbursement entries.`,
      });
      setSelectedIds(new Set());
    } catch (err: unknown) {
      setNotice({ type: 'error', message: errMsg(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !rejectReason.trim()) return;

    setIsProcessing(true);
    setNotice(null);
    try {
      const res = await rejectDisbursementEntry(rejectTarget.entry.id, rejectReason.trim());
      if (!res.success) throw new Error(res.error || 'Rejection failed');
      setNotice({
        type: 'success',
        message: `Entry #${rejectTarget.entry.entry_no} returned for correction. Entry officer has been notified.`,
      });
      selectedIds.delete(rejectTarget.entry.id);
      setSelectedIds(new Set(selectedIds));
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: unknown) {
      setNotice({ type: 'error', message: errMsg(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  // Metrics
  const pendingTotalAmount = pendingQueue.reduce((s, item) => s + entryOutstanding(item.entry), 0);
  const pendingCashCount = pendingQueue.filter((item) => item.entry.entry_type === 'cash').length;
  const pendingBankCount = pendingQueue.filter((item) => item.entry.entry_type === 'bank').length;

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-4 py-4 sm:py-8 space-y-6 pb-28">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 inline-block mb-1">
            Treasury Gatekeeper
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Disbursement Entry Approvals
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Review and sign off on payment entries before they reach Cash &amp; Bank payment desks.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold font-mono">
            {pendingQueue.length} Waiting Sign-off
          </span>
        </div>
      </div>

      {/* Notice Message */}
      {notice && (
        <div
          className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="p-1 hover:bg-black/5 rounded-lg text-slate-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Pending Total</span>
          <span className="text-base sm:text-lg font-extrabold text-slate-900 font-display">
            {formatINR(pendingTotalAmount)}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-amber-700 block">Waiting Approval</span>
          <span className="text-base sm:text-lg font-extrabold text-amber-800 font-display">
            {pendingQueue.length}
          </span>
        </div>
        <div className="p-3.5 bg-white rounded-2xl border border-emerald-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-emerald-700 block">Cash Entries</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Banknote className="w-4 h-4 text-emerald-600" />
            <span className="text-base sm:text-lg font-extrabold text-emerald-800 font-display">
              {pendingCashCount}
            </span>
          </div>
        </div>
        <div className="p-3.5 bg-white rounded-2xl border border-indigo-200 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-indigo-700 block">Bank Entries</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Landmark className="w-4 h-4 text-indigo-600" />
            <span className="text-base sm:text-lg font-extrabold text-indigo-800 font-display">
              {pendingBankCount}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => {
            setActiveTab('pending');
            setSelectedIds(new Set());
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'pending'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending Approval</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'pending' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {pendingQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('approved');
            setSelectedIds(new Set());
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'approved'
              ? 'bg-teal-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Approved History</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'approved' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {approvedQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('rejected');
            setSelectedIds(new Set());
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'rejected'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>Returned for Correction</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'rejected' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {rejectedQueue.length}
          </span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search request #, title, beneficiary, department, officer…"
            className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-slate-50"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-slate-500">Mode:</span>
          <div className="inline-flex rounded-xl p-0.5 bg-slate-100 border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setModeFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                modeFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('cash')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                modeFilter === 'cash' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-emerald-700 hover:text-emerald-900'
              }`}
            >
              <Banknote className="w-3 h-3" />
              <span>Cash</span>
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('bank')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer flex items-center gap-1 ${
                modeFilter === 'bank' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-indigo-700 hover:text-indigo-900'
              }`}
            >
              <Landmark className="w-3 h-3" />
              <span>Bank</span>
            </button>
          </div>
        </div>
      </div>

      {/* Select All & Bulk Action Bar for Pending Tab */}
      {activeTab === 'pending' && filteredList.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 hover:text-indigo-600 cursor-pointer select-none"
            >
              {allCurrentSelected ? (
                <CheckSquare className="w-4 h-4 text-indigo-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>Select All Entries ({filteredList.length})</span>
            </button>
            {selectedIds.size > 0 && (
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded-full">
                {selectedIds.size} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedIds.size === 0 || isProcessing}
              onClick={handleBulkApprove}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed w-full sm:w-auto"
            >
              <Check className="w-4 h-4" />
              <span>Approve Selected ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredList.length === 0 ? (
        <EmptyState
          icon={activeTab === 'pending' ? CheckCircle2 : activeTab === 'approved' ? ShieldCheck : XCircle}
          title={
            activeTab === 'pending'
              ? 'No Entries Awaiting Approval'
              : activeTab === 'approved'
              ? 'No Approved Entries Found'
              : 'No Returned Entries'
          }
          description={
            activeTab === 'pending'
              ? 'All disbursement entries created by entry officers have been reviewed.'
              : 'Entries that have been approved or paid will be listed in this audit record.'
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredList.map(({ entry, request }) => {
            const isSelected = selectedIds.has(entry.id);
            const isCash = entry.entry_type === 'cash';
            const isPending = entry.status === 'pending_approval' || entry.status === 'pending';
            const outstanding = entryOutstanding(entry);
            const paidSoFar = Number(entry.paid_amount || 0);
            const tdsAmt = Number(entry.tds_amount || 0);
            const balanceAwaiting = entryHasBalanceAwaitingApproval(entry);
            const approvedPartial =
              entry.status === 'approved' &&
              entry.approved_amount !== null &&
              entry.approved_amount !== undefined &&
              Number(entry.approved_amount) < outstanding;

            return (
              <div
                key={entry.id}
                className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition-all space-y-3 ${
                  isSelected
                    ? 'border-indigo-500 ring-2 ring-indigo-200'
                    : isPending
                    ? 'border-slate-200/90 hover:border-amber-300'
                    : 'border-slate-200'
                }`}
              >
                {/* Header row: Checkbox, Entry #, Mode Badge, Amount */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => toggleSelectOne(entry.id)}
                        className="mt-0.5 text-slate-400 hover:text-indigo-600 cursor-pointer"
                        title={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-indigo-600" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400" />
                        )}
                      </button>
                    )}

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200">
                          Entry #{entry.entry_no}
                        </span>

                        {/* Mode badge: Cash vs Bank */}
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                            isCash
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-indigo-50 text-indigo-800 border-indigo-300'
                          }`}
                        >
                          {isCash ? (
                            <Banknote className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Landmark className="w-3 h-3 text-indigo-600" />
                          )}
                          <span>{isCash ? 'Cash Dealer' : 'Bank Dealer'}</span>
                        </span>

                        {/* TDS badge */}
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                            entry.tds_cut
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {entry.tds_cut && <Percent className="w-3 h-3" />}
                          {entry.tds_cut
                            ? tdsAmt > 0
                              ? `TDS Cut · ${formatINR(tdsAmt)}`
                              : 'TDS Cut'
                            : 'TDS Not Cut'}
                        </span>

                        {/* Status */}
                        {isPending ? (
                          balanceAwaiting ? (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-50 text-violet-800 border border-violet-200">
                              Balance Awaiting Verification
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                              Awaiting Approver
                            </span>
                          )
                        ) : entry.status === 'rejected' ? (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200">
                            Returned for Correction
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
                            {entry.status === 'paid'
                              ? 'Paid'
                              : approvedPartial
                              ? `Partially Approved · ${formatINR(Number(entry.approved_amount))} At Cashier`
                              : 'Approved · At Cashier'}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
                        <UserCheck className="w-3 h-3 text-slate-400" />
                        <span>
                          Recorded by{' '}
                          <strong>{entry.created_by_person_name || entry.created_by_name || 'Entry Officer'}</strong>
                          {entry.created_by_person_name && entry.created_by_name ? ` (${entry.created_by_name})` : ''} on{' '}
                          {formatISTDate(entry.created_at, false)}
                        </span>
                        {entry.paid_by_person_name && (
                          <span>
                            · Paid by <strong>{entry.paid_by_person_name}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Prominent Amount */}
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      {paidSoFar > 0 && isPending ? 'Balance To Verify' : 'Entry Amount'}
                    </span>
                    <span className="font-display font-extrabold text-base sm:text-xl text-slate-900">
                      {formatINR(isPending ? outstanding : entry.amount)}
                    </span>
                    {paidSoFar > 0 && (
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 block mt-0.5">
                        Paid so far: {formatINR(paidSoFar)} of {formatINR(Number(entry.amount))}
                      </span>
                    )}
                    {Number(entry.adjustment_amount || 0) > 0 && (
                      <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200 block mt-0.5">
                        + Adj: {formatINR(Number(entry.adjustment_amount))}
                      </span>
                    )}
                  </div>
                </div>

                {/* Entry Notes */}
                {entry.notes && (
                  <div className="p-2.5 bg-slate-50 rounded-xl text-xs text-slate-700 italic border border-slate-100">
                    Entry note: "{entry.notes}"
                  </div>
                )}

                {/* Rejection reason (if returned) */}
                {entry.status === 'rejected' && entry.rejection_reason && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                    <span className="font-bold">Return Reason:</span> {entry.rejection_reason}
                  </div>
                )}

                {/* Associated Request Summary Box */}
                <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/requests/${request.id}`}
                        className="font-mono font-bold text-indigo-700 hover:underline flex items-center gap-1"
                      >
                        <span>{request.approval_no || request.request_no}</span>
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600 font-medium">Beneficiary: <strong>{request.requester_name}</strong></span>
                    </div>

                    <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                      {request.department?.name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span>{request.department.name}</span>
                        </span>
                      )}
                      {request.shop_name && (
                        <span className="flex items-center gap-1">
                          <Store className="w-3 h-3 text-slate-400" />
                          <span>{request.shop_name}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-slate-900 line-clamp-1">
                    {request.title}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 border-t border-slate-200/60 pt-1.5 flex-wrap">
                    <span>
                      Total Request Amount: <strong>{formatINR(request.amount)}</strong>
                    </span>
                    <span>
                      Already Disbursed: <strong>{formatINR(request.paid_amount || 0)}</strong>
                    </span>
                    <span>
                      Balance: <strong>{formatINR(Math.max(0, request.amount - (request.paid_amount || 0)))}</strong>
                    </span>
                  </div>
                </div>

                {/* Decision buttons for pending entries: Reject / Approve Partial / Approve Full */}
                {isPending && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    {balanceAwaiting && (
                      <span className="mr-auto text-[11px] text-violet-800 font-semibold">
                        Part of this entry is already paid — verify the remaining {formatINR(outstanding)} to release it.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={isProcessing || paidSoFar > 0}
                      title={paidSoFar > 0 ? 'Part of this entry is already paid, it cannot be returned.' : undefined}
                      onClick={() => {
                        setRejectTarget({ entry, request });
                        setRejectReason('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject &amp; Return</span>
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => openPartial({ entry, request })}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 font-bold text-xs transition-colors cursor-pointer"
                    >
                      <PieChart className="w-3.5 h-3.5" />
                      <span>Approve Partial</span>
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleApproveOne({ entry, request })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve Full #{entry.entry_no} ({formatINR(outstanding)})</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Mobile Bulk Action Bar */}
      {activeTab === 'pending' && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-xl flex items-center justify-between gap-3 z-30 sm:hidden">
          <div className="text-xs font-bold text-slate-800">
            {selectedIds.size} {selectedIds.size === 1 ? 'entry' : 'entries'} selected
          </div>
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleBulkApprove}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Approve ({selectedIds.size})</span>
          </button>
        </div>
      )}

      {/* Partial Approval Modal */}
      {partialTarget && (
        <Modal
          isOpen={true}
          onClose={() => setPartialTarget(null)}
          title={`Partially Approve Entry #${partialTarget.entry.entry_no}`}
          description={`Request ${partialTarget.request.approval_no || partialTarget.request.request_no} · ${partialTarget.request.requester_name}`}
          maxWidth="md"
        >
          <form onSubmit={handlePartialSubmit} className="space-y-4">
            {partialError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{partialError}</div>
            )}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span>Entry balance to verify:</span>
                <span className="font-bold text-slate-900">{formatINR(entryOutstanding(partialTarget.entry))}</span>
              </div>
              {Number(partialTarget.entry.paid_amount || 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span>Already paid:</span>
                  <span className="font-bold text-teal-800">{formatINR(Number(partialTarget.entry.paid_amount))}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>Payment Mode:</span>
                <span className="font-bold uppercase text-slate-900">{partialTarget.entry.entry_type}</span>
              </div>
            </div>

            <div>
              <label htmlFor="partial-amount" className="text-xs font-bold text-slate-700 block mb-1">
                Amount to approve for payment now (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                id="partial-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoFocus
                required
                value={partialStr}
                onChange={(e) => setPartialStr(e.target.value)}
                placeholder="0.00"
                className="w-full text-base font-bold font-mono p-3 rounded-xl border border-slate-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-hidden bg-white"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                The Payment account can pay <strong>exactly</strong> this amount — no more, no less. The remaining balance
                comes back to you for verification before it can be paid.
              </span>
              {(() => {
                const amt = Math.round((parseFloat(partialStr) || 0) * 100) / 100;
                const out = entryOutstanding(partialTarget.entry);
                return amt > 0 && amt < out ? (
                  <span className="text-[11px] font-semibold text-violet-800 mt-1 block">
                    Balance left to verify later: {formatINR(out - amt)}
                  </span>
                ) : null;
              })()}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPartialTarget(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing || !(parseFloat(partialStr) > 0)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <PieChart className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Approving…' : 'Approve Partial Amount'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <Modal
          isOpen={true}
          onClose={() => setRejectTarget(null)}
          title={`Return Entry #${rejectTarget.entry.entry_no} for Correction`}
          description={`Request ${rejectTarget.request.approval_no || rejectTarget.request.request_no} · ${rejectTarget.request.requester_name}`}
          maxWidth="md"
        >
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span>Entry Amount:</span>
                <span className="font-bold text-slate-900">{formatINR(entryOutstanding(rejectTarget.entry))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Payment Mode:</span>
                <span className="font-bold uppercase text-slate-900">{rejectTarget.entry.entry_type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Entered by:</span>
                <span>{rejectTarget.entry.created_by_person_name || rejectTarget.entry.created_by_name || 'Entry Officer'}</span>
              </div>
            </div>

            <div>
              <label htmlFor="reject-reason" className="text-xs font-bold text-slate-700 block mb-1">
                Reason for Rejection / Required Correction <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="reject-reason"
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain what the entry officer needs to correct (e.g. wrong dealer mode, adjust amount, incorrect TDS status)…"
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden bg-white"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                The entry will be marked 'returned' and notified to the entry officer in their dedicated Rejected Entries tab. Only the person who made the entry can correct it and resubmit it with their passkey.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing || !rejectReason.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Returning…' : 'Return for Correction'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
