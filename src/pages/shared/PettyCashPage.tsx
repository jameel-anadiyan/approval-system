import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { formatINR, typeOf } from '../../lib/formatters';
import { isOwningDepartmentHead } from '../../lib/workflow';
import { RequestRecord } from '../../types/database';
import { Wallet, PlusCircle, CheckCircle2, Clock, Inbox, FileCheck } from 'lucide-react';

type PettyTab = 'action' | 'in_progress' | 'approved' | 'all';

export const PettyCashPage: React.FC = () => {
  const { user, role } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const scopedPettyCash = useMemo<RequestRecord[]>(() => {
    if (!user || role !== 'head') return [];
    const allPetty = requests.filter((r) => typeOf(r) === 'petty_cash');
    return allPetty.filter(
      (r) =>
        (r.status !== 'draft' || r.requester_id === user.id) &&
        (r.owner_head_id === user.id ||
          r.requester_id === user.id ||
          (r.consultations || []).some((c) => c.head_id === user.id) ||
          (!r.owner_head_id && user.department_id && r.department_id === user.department_id))
    );
  }, [requests, user, role]);

  const actionItems = useMemo<RequestRecord[]>(() => {
    if (!user || role !== 'head') return [];
    return scopedPettyCash.filter(
      (r) =>
        (r.status === 'pending_head_approval' || r.status === 'pending_head_review') &&
        isOwningDepartmentHead(r, user)
    );
  }, [scopedPettyCash, user, role]);

  const inProgressItems = useMemo(
    () =>
      scopedPettyCash.filter((r) =>
        [
          'pending_regional_review',
          'submitted',
          'pending_head_review',
          'pending_head_approval',
          'pending_admin_approval',
          'approving',
        ].includes(r.status)
      ),
    [scopedPettyCash]
  );

  const approvedItems = useMemo(
    () => scopedPettyCash.filter((r) => r.status === 'approved' || r.status === 'paid'),
    [scopedPettyCash]
  );

  const [selectedTab, setSelectedTab] = useState<PettyTab | null>(null);
  const tab: PettyTab = selectedTab ?? (actionItems.length > 0 ? 'action' : 'all');

  const items =
    tab === 'action'
      ? actionItems
      : tab === 'in_progress'
      ? inProgressItems
      : tab === 'approved'
      ? approvedItems
      : scopedPettyCash;

  const totalApprovedAmount = useMemo(
    () => approvedItems.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [approvedItems]
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200 mb-1.5">
            <Wallet className="w-3.5 h-3.5 text-teal-600" />
            <span>Petty Cash Dealing Head · Below 1000</span>
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2.5">
            <span>Petty Cash Requests</span>
            {actionItems.length > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-teal-600 text-white text-xs font-bold">
                {actionItems.length} pending
              </span>
            )}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Expenses up to ₹1,000 routed directly to you as a Petty Cash Dealing Department Head.
          </p>
        </div>

        <button
          type="button"
          id="raise-petty-cash-btn"
          onClick={() => navigate('/new', { state: { defaultType: 'petty_cash' } })}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all self-start sm:self-auto cursor-pointer"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Raise Petty Cash</span>
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          onClick={() => setSelectedTab('action')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'action'
              ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-200/60'
              : 'bg-white border-slate-200 hover:border-teal-300'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700 block">To Approve</span>
          <span className="text-2xl font-extrabold text-teal-950 font-display mt-1 block">{actionItems.length}</span>
        </div>

        <div
          onClick={() => setSelectedTab('in_progress')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'in_progress'
              ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-200/60'
              : 'bg-white border-slate-200 hover:border-teal-300'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">In Progress</span>
          <span className="text-2xl font-extrabold text-slate-900 font-display mt-1 block">{inProgressItems.length}</span>
        </div>

        <div
          onClick={() => setSelectedTab('approved')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'approved'
              ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-200/60'
              : 'bg-white border-slate-200 hover:border-teal-300'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">Approved & Paid</span>
          <span className="text-2xl font-extrabold text-emerald-900 font-display mt-1 block">{approvedItems.length}</span>
        </div>

        <div
          onClick={() => setSelectedTab('all')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'all'
              ? 'bg-teal-50 border-teal-400 ring-2 ring-teal-200/60'
              : 'bg-white border-slate-200 hover:border-teal-300'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">Sanctioned Value</span>
          <span className="text-lg sm:text-xl font-extrabold text-slate-900 font-display mt-1 block truncate">
            {formatINR(totalApprovedAmount)}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1 flex-wrap" role="tablist">
        {(
          [
            ['action', `To Approve (${actionItems.length})`, Inbox],
            ['in_progress', `In Progress (${inProgressItems.length})`, Clock],
            ['approved', `Approved & Paid (${approvedItems.length})`, FileCheck],
            ['all', `All Petty Cash (${scopedPettyCash.length})`, Wallet],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`petty-tab-${key}`}
            aria-selected={tab === key}
            onClick={() => setSelectedTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              tab === key ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <RequestQueue
        items={items}
        bulkApprove={tab === 'action'}
        initialFilters={{ sort: tab === 'action' ? 'oldest' : 'newest' }}
        emptyIcon={tab === 'action' ? CheckCircle2 : Wallet}
        emptyTitle={tab === 'action' ? 'No Pending Petty Cash Requests' : 'No Petty Cash Requests Yet'}
        emptyDescription={
          tab === 'action'
            ? 'All Petty Cash requests requiring your action have been cleared.'
            : 'Petty Cash requests (up to ₹1,000) assigned to you will appear here.'
        }
      />
    </div>
  );
};
