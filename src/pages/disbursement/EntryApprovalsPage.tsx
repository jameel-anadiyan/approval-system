import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { useDirectory, fetchActiveEntryOfficers, isEntryCheckingUser } from '../../lib/directory';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/common/EmptyState';
import { Modal } from '../../components/common/Modal';
import {
  DisbursementEntry,
  RequestRecord,
  Profile,
  entryOutstanding,
  entryHasBalanceAwaitingApproval,
} from '../../types/database';
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
  Eye,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { SignedDocPreviewModal } from '../../components/requests/SignedDocPreviewModal';

interface EntryWithRequest {
  entry: DisbursementEntry;
  request: RequestRecord;
}

export interface EntryAccountOption {
  id: string;
  name: string;
  pendingCount: number;
  totalCount: number;
}

/** Robust matching of an entry/request against an Entry Only account */
function matchesEntryAccount(
  item: EntryWithRequest,
  targetId: string,
  options: { id: string; name: string }[]
): boolean {
  if (targetId === 'all') return true;
  if (targetId === '__unassigned__') {
    return !item.entry.created_by && !item.request.assigned_entry_user_id;
  }
  if (item.entry.created_by && item.entry.created_by === targetId) return true;
  if (item.request.assigned_entry_user_id && item.request.assigned_entry_user_id === targetId) return true;

  // Name match fallback (for mock accounts or when IDs differ)
  const opt = options.find((o) => o.id === targetId);
  if (opt) {
    const targetName = opt.name.trim().toLowerCase();
    const cName = (item.entry.created_by_name || '').trim().toLowerCase();
    const aName = (item.request.assigned_entry_user_name || '').trim().toLowerCase();
    if (cName && cName === targetName) return true;
    if (aName && aName === targetName) return true;
  }
  return false;
}

export const EntryApprovalsPage: React.FC = () => {
  const { isBackendConnected } = useAuth();
  const {
    requests,
    refreshRequests,
    approveDisbursementEntry,
    approveMultipleDisbursementEntries,
    rejectDisbursementEntry,
    holdDisbursementEntry,
    unholdDisbursementEntry,
  } = useRequests();
  const { users } = useDirectory();

  const [extraOfficers, setExtraOfficers] = useState<Profile[]>([]);
  const [directEntries, setDirectEntries] = useState<DisbursementEntry[]>([]);
  const [directRequests, setDirectRequests] = useState<Map<string, RequestRecord>>(new Map());
  const [isDirectLoading, setIsDirectLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'on_hold' | 'approved' | 'rejected'>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<EntryWithRequest | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [holdTarget, setHoldTarget] = useState<EntryWithRequest | null>(null);
  const [holdReason, setHoldReason] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [partialTarget, setPartialTarget] = useState<EntryWithRequest | null>(null);
  const [partialStr, setPartialStr] = useState<string>('');
  const [partialError, setPartialError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [modeFilter, setModeFilter] = useState<'all' | 'cash' | 'bank'>('all');
  const [entryAccountFilter, setEntryAccountFilter] = useState<string>('all');
  const [previewSignedDoc, setPreviewSignedDoc] = useState<{
    path: string;
    name: string;
    approvalNo?: string | null;
  } | null>(null);

  // Directly fetch disbursement entries and their joined requests from Supabase
  // (Ensures live entries always show even if context requests had RLS or loading delay)
  const loadDirectEntries = useCallback(async () => {
    if (!isBackendConnected) return;
    setIsDirectLoading(true);
    try {
      const { data, error } = await supabase
        .from('disbursement_entries')
        .select('*, request:requests(*, requester:profiles!requester_id(id, full_name, designation, photo_path), department:departments(*), signed_files(*))')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Direct disbursement entries fetch notice:', error.message);
      } else if (data && data.length > 0) {
        const dEntries: DisbursementEntry[] = [];
        const dReqMap = new Map<string, RequestRecord>();
        data.forEach((row: any) => {
          const { request: reqRow, ...entryFields } = row;
          const ne: DisbursementEntry = {
            ...entryFields,
            amount: Number(entryFields.amount),
            adjustment_amount: Number(entryFields.adjustment_amount ?? 0),
            tds_amount: Number(entryFields.tds_amount ?? 0),
            paid_amount: Number(entryFields.paid_amount ?? 0),
            approved_amount:
              entryFields.approved_amount === null || entryFields.approved_amount === undefined
                ? null
                : Number(entryFields.approved_amount),
          };
          dEntries.push(ne);
          if (reqRow && !dReqMap.has(reqRow.id)) {
            dReqMap.set(reqRow.id, reqRow as RequestRecord);
          }
        });
        setDirectEntries(dEntries);
        setDirectRequests(dReqMap);
      }
    } catch (err: any) {
      console.warn('loadDirectEntries exception:', err);
    } finally {
      setIsDirectLoading(false);
    }
  }, [isBackendConnected]);

  useEffect(() => {
    loadDirectEntries();
  }, [loadDirectEntries]);

  // Load active entry officers directly to ensure all active entry accounts are discovered
  useEffect(() => {
    let isMounted = true;
    fetchActiveEntryOfficers(isBackendConnected).then((officers) => {
      if (isMounted && officers && officers.length > 0) {
        setExtraOfficers(officers);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [isBackendConnected]);

  // Collect all entries across payable approved requests (combines context requests and direct entries)
  const allEntriesWithRequests: EntryWithRequest[] = useMemo(() => {
    const list: EntryWithRequest[] = [];
    const seenEntryIds = new Set<string>();

    // 1. Primary source: requests from RequestContext
    requests.forEach((r) => {
      if (typeOf(r) === 'discount' || typeOf(r) === 'stock_transfer' || typeOf(r) === 'non_cash') return;
      (r.disbursement_entries || []).forEach((e) => {
        if (e.status !== 'cancelled' && !seenEntryIds.has(e.id)) {
          seenEntryIds.add(e.id);
          list.push({ entry: e, request: r });
        }
      });
    });

    // 2. Supplemental source: direct entries from Supabase (ensures zero entries are missed)
    directEntries.forEach((e) => {
      if (e.status === 'cancelled' || seenEntryIds.has(e.id)) return;
      const r = requests.find((req) => req.id === e.request_id) || directRequests.get(e.request_id);
      if (r) {
        if (typeOf(r) === 'discount' || typeOf(r) === 'stock_transfer' || typeOf(r) === 'non_cash') return;
        seenEntryIds.add(e.id);
        list.push({ entry: e, request: r });
      }
    });

    // Sort: pending first by creation time, approved / rejected by updated/approved time
    return list.sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());
  }, [requests, directEntries, directRequests]);

  // An entry is partially approved and in progress with the cashier when:
  // - status === 'approved'
  // - approved_amount is set and < outstanding balance
  // - cashier has not yet settled the partial payment
  const isPartialInProgress = (e: DisbursementEntry) => {
    const outstanding = entryOutstanding(e);
    const approved = Number(e.approved_amount || 0);
    return (
      e.status === 'approved' &&
      approved > 0 &&
      outstanding > approved &&
      Number(e.paid_amount || 0) < Number(e.amount || 0)
    );
  };

  // Build the list of known Entry Only accounts (from active users + existing entries)
  const entryAccountOptions = useMemo<EntryAccountOption[]>(() => {
    const map = new Map<string, { id: string; name: string }>();

    // 1. Directory active entry officers (disbursement role + entry_only type, not entry checking)
    const directoryList = [...users, ...extraOfficers];
    for (const u of directoryList) {
      if (
        u.role === 'disbursement' &&
        (u.disbursement_type === 'entry_only' || !u.disbursement_type) &&
        !isEntryCheckingUser(u)
      ) {
        map.set(u.id, { id: u.id, name: u.full_name || u.username });
      }
    }

    // 2. Discover accounts from all entries across requests (creators & assigned officers)
    allEntriesWithRequests.forEach(({ entry, request }) => {
      const creatorId = entry.created_by;
      const creatorName = entry.created_by_name;
      if (creatorId && !map.has(creatorId)) {
        map.set(creatorId, { id: creatorId, name: creatorName || 'Entry Officer' });
      }
      const assignedId = request.assigned_entry_user_id;
      const assignedName = request.assigned_entry_user_name;
      if (assignedId && !map.has(assignedId)) {
        map.set(assignedId, { id: assignedId, name: assignedName || 'Assigned Entry Officer' });
      }
    });

    const list: EntryAccountOption[] = Array.from(map.values()).map((acc) => {
      const accEntries = allEntriesWithRequests.filter((item) =>
        matchesEntryAccount(item, acc.id, [acc])
      );
      const pendingCount = accEntries.filter(
        (item) =>
          item.entry.status === 'pending_approval' ||
          item.entry.status === 'pending' ||
          isPartialInProgress(item.entry)
      ).length;
      return {
        ...acc,
        pendingCount,
        totalCount: accEntries.length,
      };
    });

    // Check if any entries are direct / unassigned
    const unassignedEntries = allEntriesWithRequests.filter(
      (item) => !item.entry.created_by && !item.request.assigned_entry_user_id
    );
    if (unassignedEntries.length > 0) {
      const pendingCount = unassignedEntries.filter(
        (item) =>
          item.entry.status === 'pending_approval' ||
          item.entry.status === 'pending' ||
          isPartialInProgress(item.entry)
      ).length;
      list.push({
        id: '__unassigned__',
        name: 'Direct / Unassigned',
        pendingCount,
        totalCount: unassignedEntries.length,
      });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, extraOfficers, allEntriesWithRequests]);

  // Filter entries by selected entry account
  const accountEntries = useMemo(() => {
    if (entryAccountFilter === 'all') return allEntriesWithRequests;
    return allEntriesWithRequests.filter((item) =>
      matchesEntryAccount(item, entryAccountFilter, entryAccountOptions)
    );
  }, [allEntriesWithRequests, entryAccountFilter, entryAccountOptions]);

  // Tab queues scoped to the selected entry account
  const pendingQueue = useMemo(
    () =>
      accountEntries.filter(
        (item) =>
          item.entry.status !== 'on_hold' &&
          (item.entry.status === 'pending_approval' ||
            item.entry.status === 'pending' ||
            isPartialInProgress(item.entry))
      ),
    [accountEntries]
  );

  const onHoldQueue = useMemo(
    () => accountEntries.filter((item) => item.entry.status === 'on_hold'),
    [accountEntries]
  );

  const approvedQueue = useMemo(
    () => accountEntries.filter((item) => item.entry.status === 'approved' || item.entry.status === 'paid'),
    [accountEntries]
  );

  const rejectedQueue = useMemo(
    () => accountEntries.filter((item) => item.entry.status === 'rejected'),
    [accountEntries]
  );

  const currentQueue =
    activeTab === 'pending'
      ? pendingQueue
      : activeTab === 'on_hold'
      ? onHoldQueue
      : activeTab === 'approved'
      ? approvedQueue
      : rejectedQueue;

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
          item.entry.created_by_person_name,
          item.request.assigned_entry_user_name,
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
      loadDirectEntries();
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
      loadDirectEntries();
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
      loadDirectEntries();
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
      loadDirectEntries();
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

  const handleHoldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdTarget || !holdReason.trim()) return;

    setIsProcessing(true);
    setNotice(null);
    try {
      const res = await holdDisbursementEntry(holdTarget.entry.id, holdReason.trim());
      if (!res.success) throw new Error(res.error || 'Failed to place on hold');
      loadDirectEntries();
      setNotice({
        type: 'success',
        message: `Entry #${holdTarget.entry.entry_no} placed on hold and moved to 'On Hold' list.`,
      });
      selectedIds.delete(holdTarget.entry.id);
      setSelectedIds(new Set(selectedIds));
      setHoldTarget(null);
      setHoldReason('');
    } catch (err: unknown) {
      setNotice({ type: 'error', message: errMsg(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnhold = async (entryId: string, entryNo: number) => {
    setIsProcessing(true);
    setNotice(null);
    try {
      const res = await unholdDisbursementEntry(entryId);
      if (!res.success) throw new Error(res.error || 'Failed to unhold entry');
      loadDirectEntries();
      setNotice({
        type: 'success',
        message: `Entry #${entryNo} has been taken off hold and returned to Pending Approvals.`,
      });
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

  const selectedAccountName = useMemo(() => {
    if (entryAccountFilter === 'all') return 'All Entry Accounts';
    if (entryAccountFilter === '__unassigned__') return 'Direct / Unassigned';
    return (
      entryAccountOptions.find((o) => o.id === entryAccountFilter)?.name ||
      'Selected Entry Account'
    );
  }, [entryAccountFilter, entryAccountOptions]);

  const totalPendingAcrossAll = useMemo(
    () =>
      allEntriesWithRequests.filter(
        (item) =>
          item.entry.status === 'pending_approval' ||
          item.entry.status === 'pending' ||
          isPartialInProgress(item.entry)
      ).length,
    [allEntriesWithRequests]
  );

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-4 py-4 sm:py-8 space-y-6 pb-28">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 inline-block">
              Treasury Gatekeeper
            </span>
            {entryAccountFilter !== 'all' && (
              <span className="text-xs font-extrabold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-300 inline-flex items-center gap-1.5 shadow-2xs">
                <UserCheck className="w-3.5 h-3.5 text-sky-600" />
                <span>Account: {selectedAccountName}</span>
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Disbursement Entry Approvals
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {entryAccountFilter !== 'all'
              ? `Reviewing entries specifically recorded by or assigned to ${selectedAccountName}.`
              : 'Review and sign off on payment entries before they reach Cash & Bank payment desks.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            type="button"
            id="btn-refresh-entry-approvals"
            disabled={isDirectLoading}
            onClick={async () => {
              await Promise.all([refreshRequests(), loadDirectEntries()]);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-2xs transition-colors cursor-pointer"
            title="Refresh entries and requests from live database"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-slate-600 ${isDirectLoading ? 'animate-spin' : ''}`} />
            <span>{isDirectLoading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
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
            setActiveTab('on_hold');
            setSelectedIds(new Set());
          }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'on_hold'
              ? 'bg-amber-500 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <PauseCircle className="w-3.5 h-3.5" />
          <span>On Hold</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'on_hold' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {onHoldQueue.length}
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
      <div className="space-y-2.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
          {/* Search Input */}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search request #, title, requester name, department, officer…"
              className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-slate-50"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Entry Only Account Filter Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
              <UserCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <label htmlFor="filter-entry-account" className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                Entry Account:
              </label>
              <select
                id="filter-entry-account"
                value={entryAccountFilter}
                onChange={(e) => {
                  setEntryAccountFilter(e.target.value);
                  setSelectedIds(new Set());
                }}
                className="text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer pr-1 py-0.5 focus:text-indigo-600 max-w-[190px] truncate"
              >
                <option value="all">
                  All Entry Accounts ({totalPendingAcrossAll} pending)
                </option>
                {entryAccountOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name} ({opt.pendingCount} pending{opt.totalCount !== opt.pendingCount ? ` · ${opt.totalCount} total` : ''})
                  </option>
                ))}
              </select>
            </div>

            {/* Mode: All / Cash / Bank */}
            <div className="flex items-center gap-1.5">
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
        </div>

        {/* Quick filter chips if there are active entry accounts */}
        {entryAccountOptions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
            <span className="text-[11px] font-bold text-slate-400 shrink-0 uppercase tracking-wider flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-400" />
              Quick:
            </span>
            <button
              type="button"
              onClick={() => {
                setEntryAccountFilter('all');
                setSelectedIds(new Set());
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                entryAccountFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              All Accounts ({totalPendingAcrossAll} pending)
            </button>
            {entryAccountOptions.map((opt) => {
              const isSelected = entryAccountFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setEntryAccountFilter(isSelected ? 'all' : opt.id);
                    setSelectedIds(new Set());
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-600 text-white shadow-2xs ring-1 ring-sky-500'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-sky-50 hover:text-sky-800'
                  }`}
                >
                  <UserCheck className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-sky-600'}`} />
                  <span>{opt.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {opt.pendingCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Active Filter Notification Banner */}
        {entryAccountFilter !== 'all' && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-sky-50/90 border border-sky-200 rounded-xl text-xs text-sky-900 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <UserCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span>
                Filtering entries created by Entry Account:{' '}
                <strong className="font-extrabold text-sky-950">
                  {selectedAccountName}
                </strong>
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-200 text-sky-900">
                {currentQueue.length} {activeTab === 'pending' ? 'pending' : activeTab === 'approved' ? 'approved' : 'returned'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setEntryAccountFilter('all');
                setSelectedIds(new Set());
              }}
              className="text-sky-700 hover:text-sky-950 font-bold inline-flex items-center gap-1 text-[11px] hover:underline cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Clear Filter</span>
            </button>
          </div>
        )}
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
        <div className="space-y-3">
          <EmptyState
            icon={
              activeTab === 'pending'
                ? CheckCircle2
                : activeTab === 'on_hold'
                ? PauseCircle
                : activeTab === 'approved'
                ? ShieldCheck
                : XCircle
            }
            title={
              entryAccountFilter !== 'all'
                ? `No ${
                    activeTab === 'pending'
                      ? 'Pending'
                      : activeTab === 'on_hold'
                      ? 'On Hold'
                      : activeTab === 'approved'
                      ? 'Approved'
                      : 'Returned'
                  } Entries for ${selectedAccountName}`
                : activeTab === 'pending'
                ? 'No Entries Awaiting Approval'
                : activeTab === 'on_hold'
                ? 'No Entries On Hold'
                : activeTab === 'approved'
                ? 'No Approved Entries Found'
                : 'No Returned Entries'
            }
            description={
              entryAccountFilter !== 'all'
                ? `There are no ${
                    activeTab === 'pending'
                      ? 'pending'
                      : activeTab === 'on_hold'
                      ? 'on hold'
                      : activeTab === 'approved'
                      ? 'approved'
                      : 'returned'
                  } disbursement entries for ${selectedAccountName}${modeFilter !== 'all' ? ` in ${modeFilter} mode` : ''}.`
                : activeTab === 'pending'
                ? 'All disbursement entries created by entry officers have been reviewed.'
                : activeTab === 'on_hold'
                ? 'Entries placed on hold for verification or missing details will appear here.'
                : 'Entries that have been approved or paid will be listed in this audit record.'
            }
          />
          {entryAccountFilter !== 'all' && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setEntryAccountFilter('all');
                  setSelectedIds(new Set());
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Show Entries Across All Accounts</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredList.map(({ entry, request }) => {
            const isSelected = selectedIds.has(entry.id);
            const isCash = entry.entry_type === 'cash';
            const isPartialActive = isPartialInProgress(entry);
            const isPending = (entry.status === 'pending_approval' || entry.status === 'pending') && !isPartialActive;
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
                    : isPartialActive
                    ? 'border-amber-300 bg-amber-50/15'
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

                        {/* Entry Account Badge */}
                        {(() => {
                          const accName = entry.created_by_name || request.assigned_entry_user_name;
                          const accId = entry.created_by || request.assigned_entry_user_id;
                          if (!accName && !accId) return null;
                          const isCurrentActive =
                            entryAccountFilter !== 'all' &&
                            (entryAccountFilter === accId || entryAccountFilter === accName);
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (accId) {
                                  setEntryAccountFilter(isCurrentActive ? 'all' : accId);
                                  setSelectedIds(new Set());
                                }
                              }}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                                isCurrentActive
                                  ? 'bg-sky-600 text-white border-sky-700 shadow-2xs'
                                  : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 hover:border-sky-300'
                              }`}
                              title={
                                isCurrentActive
                                  ? 'Click to show all accounts'
                                  : `Click to filter by ${accName || 'this entry account'}`
                              }
                            >
                              <UserCheck className={`w-3 h-3 ${isCurrentActive ? 'text-white' : 'text-sky-600'}`} />
                              <span>Entry Acc: {accName || 'Entry Desk'}</span>
                            </button>
                          );
                        })()}

                        {/* Status */}
                        {isPartialActive ? (
                          <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1 shadow-xs">
                            <Clock className="w-3 h-3 text-amber-700 animate-pulse" />
                            <span>Partial Payment in Progress</span>
                          </span>
                        ) : isPending ? (
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
                        ) : entry.status === 'on_hold' ? (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                            <PauseCircle className="w-3 h-3 text-amber-700" />
                            <span>Placed on Hold</span>
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
                    {isPartialActive ? (
                      <>
                        <span className="text-[10px] font-bold uppercase text-amber-700 block">
                          Approved For Cashier
                        </span>
                        <span className="font-display font-extrabold text-base sm:text-xl text-teal-700">
                          {formatINR(Number(entry.approved_amount))}
                        </span>
                        <span className="text-[10px] font-bold text-slate-600 block mt-0.5">
                          Remaining Balance: {formatINR(outstanding - Number(entry.approved_amount))}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          {paidSoFar > 0 && isPending ? 'Balance To Verify' : 'Entry Amount'}
                        </span>
                        <span className="font-display font-extrabold text-base sm:text-xl text-slate-900">
                          {formatINR(isPending ? outstanding : entry.amount)}
                        </span>
                      </>
                    )}
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

                {/* Hold reason banner */}
                {entry.status === 'on_hold' && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 text-amber-900">
                        <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Placed on Hold</span>
                      </span>
                      {entry.held_at && (
                        <span className="text-[10px] font-mono text-amber-700">
                          {formatISTDate(entry.held_at)}
                        </span>
                      )}
                    </div>
                    {entry.held_by_name && (
                      <span className="text-[11px] text-amber-800">
                        Held by: <strong>{entry.held_by_name}</strong>
                      </span>
                    )}
                    {entry.hold_reason && (
                      <div className="mt-1 p-2 rounded-lg bg-white/80 border border-amber-200/80 text-amber-900">
                        <span className="font-bold">Hold Note: </span>
                        <span>{entry.hold_reason}</span>
                      </div>
                    )}
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/requests/${request.id}`}
                        className="font-mono font-bold text-indigo-700 hover:underline flex items-center gap-1"
                      >
                        <span>{request.approval_no || request.request_no}</span>
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                      {(() => {
                        const reqPacket = (request.signed_files || []).find((s) => s.is_packet) || (request.signed_files || [])[0];
                        if (!reqPacket) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewSignedDoc({
                                path: reqPacket.storage_path,
                                name: reqPacket.file_name || `${request.approval_no || request.request_no}_packet.pdf`,
                                approvalNo: request.approval_no,
                              })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                            title="Preview approved stamped document"
                          >
                            <Eye className="w-3 h-3 text-emerald-700" />
                            <span>Preview Doc</span>
                          </button>
                        );
                      })()}
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600 font-medium">Requester Name: <strong>{request.requester_name}</strong></span>
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
                {isPartialActive ? (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950">
                      <Clock className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
                      <div>
                        <strong>Partial Payment in Progress: </strong>
                        Cashier has been authorized to release <strong>{formatINR(Number(entry.approved_amount))}</strong>. Once paid by cashier, the remaining balance of <strong>{formatINR(outstanding - Number(entry.approved_amount))}</strong> will appear here for your next verification.
                      </div>
                    </div>
                  </div>
                ) : isPending && (
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
                      onClick={() => {
                        setHoldTarget({ entry, request });
                        setHoldReason('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs transition-colors cursor-pointer disabled:opacity-40"
                      title="Place this entry on hold with a note"
                    >
                      <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span>Hold</span>
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

                {/* Actions for On Hold entries */}
                {entry.status === 'on_hold' && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <span className="mr-auto text-xs text-amber-800 font-medium">
                      This entry is on hold and will not proceed to payment until unheld.
                    </span>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleUnhold(entry.id, entry.entry_no)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Unhold &amp; Return to Pending</span>
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

      {/* Hold Modal */}
      {holdTarget && (
        <Modal
          isOpen={true}
          onClose={() => setHoldTarget(null)}
          title={`Place Entry #${holdTarget.entry.entry_no} on Hold`}
          description={`Request ${holdTarget.request.approval_no || holdTarget.request.request_no} · ${holdTarget.request.requester_name}`}
          maxWidth="md"
        >
          <form onSubmit={handleHoldSubmit} className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span>Entry Amount:</span>
                <span className="font-bold text-slate-900">{formatINR(entryOutstanding(holdTarget.entry))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Payment Mode:</span>
                <span className="font-bold uppercase text-slate-900">{holdTarget.entry.entry_type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Requester Name:</span>
                <span className="font-bold text-slate-900">{holdTarget.request.requester_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Entered by:</span>
                <span>{holdTarget.entry.created_by_person_name || holdTarget.entry.created_by_name || 'Entry Officer'}</span>
              </div>
            </div>

            <div>
              <label htmlFor="hold-reason" className="text-xs font-bold text-slate-700 block mb-1">
                Reason for Placing on Hold <span className="text-amber-500">*</span>
              </label>
              <textarea
                id="hold-reason"
                required
                rows={3}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Explain why this entry is being placed on hold (e.g. Awaiting supporting invoice, verifying with vendor, waiting for clarification)…"
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden bg-white"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                This entry will be moved out of Pending Approvals and kept in the 'On Hold' list. You can unhold it at any time to return it back to Pending.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setHoldTarget(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing || !holdReason.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Placing on Hold…' : 'Place on Hold'}</span>
              </button>
            </div>
          </form>
        </Modal>
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
