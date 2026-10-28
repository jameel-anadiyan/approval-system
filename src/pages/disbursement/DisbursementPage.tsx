import React, { useEffect, useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { EmptyState } from '../../components/common/EmptyState';
import { TypeBadge } from '../../components/common/StatusBadge';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { AddDisbursementEntryModal } from '../../components/portals/AddDisbursementEntryModal';
import { EditDisbursementEntryModal } from '../../components/portals/EditDisbursementEntryModal';
import { AssignEntryAccountModal } from '../../components/portals/AssignEntryAccountModal';
import { DisbursementClarificationModal } from '../../components/portals/DisbursementClarificationModal';
import { DisbursementEntry, RequestRecord, paymentSummary, entryPayable, entryOutstanding, entryHasBalanceAwaitingApproval, entriesTotal, entryAvailable } from '../../types/database';
import { formatINR, formatISTDate, typeOf } from '../../lib/formatters';
import {
  Banknote,
  Clock,
  CheckCircle,
  ShieldCheck,
  Download,
  HelpCircle,
  PlusCircle,
  Wallet,
  FileText,
  AlertCircle,
  RotateCcw,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { downloadSignedPacket } from '../../lib/files';
import { SignedDocPreviewModal } from '../../components/requests/SignedDocPreviewModal';
import { useDirectory } from '../../lib/directory';
import {
  isPaymentUserAllowedForEntry,
  canPaymentUserViewAwaitingRequest,
  canPaymentUserViewPaidRequest,
  isEntryAssociatedWithPaymentUser,
} from '../../lib/disbursementRouting';

export const DisbursementPage: React.FC = () => {
  const { requests, markAsPaid, addDisbursementEntry, editRejectedDisbursementEntry } = useRequests();
  const { user, isBackendConnected } = useAuth();
  const dir = useDirectory();
  const navigate = useNavigate();
  const location = useLocation();

  const isDisbursement = user?.role === 'disbursement';
  const isAdmin = user?.role === 'admin';
  const isEntryOnly = isDisbursement && (user?.disbursement_type === 'entry_only' || !user?.disbursement_type);
  const isPaymentOnly = isDisbursement && user?.disbursement_type === 'payment_only';

  const canAddEntry = isEntryOnly || isAdmin;
  const canPay = isPaymentOnly || isAdmin;

  const [activeTab, setActiveTab] = useState<'awaiting' | 'clarification' | 'rejected' | 'paid'>(
    location.pathname.endsWith('/paid') ? 'paid' : 'awaiting'
  );
  const [payTarget, setPayTarget] = useState<{ request: RequestRecord; entry?: DisbursementEntry | null } | null>(null);
  const [entryModalTarget, setEntryModalTarget] = useState<RequestRecord | null>(null);
  const [editEntryTarget, setEditEntryTarget] = useState<{ request: RequestRecord; entry: DisbursementEntry } | null>(null);
  const [assignEntryTarget, setAssignEntryTarget] = useState<RequestRecord | null>(null);
  const [clarifyTarget, setClarifyTarget] = useState<RequestRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewSignedDoc, setPreviewSignedDoc] = useState<{
    path: string;
    name: string;
    approvalNo?: string | null;
  } | null>(null);

  useEffect(() => {
    setActiveTab(location.pathname.endsWith('/paid') ? 'paid' : 'awaiting');
  }, [location.pathname]);

  const handleDownload = async (req: RequestRecord) => {
    setNotice(null);
    const res = await downloadSignedPacket(req, isBackendConnected);
    if (!res.success) setNotice(res.error || 'Download failed');
  };

  // Discount approvals, Non-Cash, and Stock Transfers have no payment step, so they never reach Disbursement.
  const payable = requests.filter(
    (r) => typeOf(r) !== 'discount' && typeOf(r) !== 'stock_transfer' && typeOf(r) !== 'non_cash'
  );

  // Entry Only user only receives requests assigned to them (or unassigned requests)
  const entryFilteredPayable = isEntryOnly
    ? payable.filter((r) => !r.assigned_entry_user_id || r.assigned_entry_user_id === user?.id)
    : payable;

  // Awaiting payment: status === 'approved'
  // For Payment-Only Cashiers: ONLY show requests that have at least one verified (approved) entry ready to be paid by THIS cashier!
  const awaitingQueue = isPaymentOnly
    ? payable.filter((r) => canPaymentUserViewAwaitingRequest(user, r, dir.users))
    : entryFilteredPayable.filter((r) => r.status === 'approved');

  // Under Clarification: approved but waiting for Head's response
  const underClarificationQueue = awaitingQueue.filter((r) =>
    (r.disbursement_clarifications || []).some((c) => c.status === 'pending_head')
  );

  // Rejected entries for Entry Only user or Admin
  const rejectedEntries = payable.flatMap((r) =>
    (r.disbursement_entries || [])
      .filter((e) => e.status === 'rejected' && (isAdmin || e.created_by === user?.id))
      .map((e) => ({ entry: e, request: r }))
  );

  // Paid history: status === 'paid' or requests with entries paid by cashier
  // For Payment-Only Cashiers: ONLY show requests where THIS cashier made payments or associated entries are paid/settled!
  const paidQueue = isPaymentOnly
    ? payable.filter((r) => canPaymentUserViewPaidRequest(user, r, dir.users))
    : entryFilteredPayable.filter((r) => r.status === 'paid');

  const currentList =
    activeTab === 'awaiting'
      ? awaitingQueue
      : activeTab === 'clarification'
      ? underClarificationQueue
      : activeTab === 'paid'
      ? paidQueue
      : [];

  const { filters, setFilters, result: filtered } = useRequestFilters(currentList, {
    sort: activeTab === 'awaiting' ? 'oldest' : 'newest',
  });
  const search = filters.q;
  const partialCount = awaitingQueue.filter((r) => paymentSummary(r).partial).length;
  const awaitingBalance = awaitingQueue.reduce((s, r) => {
    if (isPaymentOnly) {
      const myEntries = (r.disbursement_entries || []).filter(
        (e) => e.status === 'approved' && isPaymentUserAllowedForEntry(user, e, r, dir.users).allowed
      );
      return s + myEntries.reduce((acc, e) => acc + entryPayable(e), 0);
    }
    return s + paymentSummary(r).balance;
  }, 0);

  return (
    <div className="max-w-5xl mx-auto px-1 sm:px-4 py-4 sm:py-8 space-y-6 pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200 inline-block mb-1">
            Treasury & Disbursement Portal
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Payment Settlement & Vouchers
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Disburse approved funds, create payment entries, verify digitally signed certificates, and record bank references.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/disbursement/verify')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-colors self-start sm:self-auto cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Verify QR Voucher</span>
        </button>
      </div>

      {/* Account Type Indicator Badge */}
      {(isDisbursement || isAdmin) && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
            isAdmin
              ? 'bg-purple-50/80 border-purple-200 text-purple-950'
              : isPaymentOnly
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : 'bg-sky-50/80 border-sky-200 text-sky-950'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl shrink-0 ${
                isAdmin
                  ? 'bg-purple-600 text-white'
                  : isPaymentOnly
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 text-white'
              }`}
            >
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs sm:text-sm">
                  {isAdmin
                    ? 'Administrator Access'
                    : isPaymentOnly
                    ? 'Payment Only Account'
                    : 'Entry Only Account'}
                </span>
                <span
                  className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full border ${
                    isAdmin
                      ? 'bg-purple-100 border-purple-300 text-purple-800'
                      : isPaymentOnly
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : 'bg-sky-100 border-sky-300 text-sky-800'
                  }`}
                >
                  Active Mode
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5">
                {isAdmin
                  ? 'You have full administrative privileges to create payment entries (+ Add Entry) and record payments.'
                  : isPaymentOnly
                  ? 'Authorized to pay amounts against approved entries (max amount strictly capped per entry). Entries will be marked as Paid.'
                  : 'Authorized to create sequential payment entries (Entry #1, #2...) with TDS cut/not cut indication. Disbursing is handled by Payment Only accounts.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">{notice}</div>
      )}

      {awaitingQueue.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white border border-slate-200 p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Balance to pay</span>
            <span className="text-lg sm:text-xl font-extrabold font-display text-slate-900">{formatINR(awaitingBalance)}</span>
          </div>
          <div className="rounded-2xl bg-white border border-amber-200 p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Partially paid</span>
            <span className="text-lg sm:text-xl font-extrabold font-display text-amber-800">{partialCount}</span>
            <span className="text-[11px] text-slate-500"> of {awaitingQueue.length} awaiting</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab('awaiting')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'awaiting'
              ? 'bg-teal-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Awaiting Payment</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'awaiting' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {awaitingQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('clarification')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'clarification'
              ? 'bg-amber-600 text-white shadow-xs'
              : underClarificationQueue.length > 0
              ? 'text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Under Head Clarification</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'clarification'
                ? 'bg-white/20 text-white'
                : underClarificationQueue.length > 0
                ? 'bg-amber-200 text-amber-900'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {underClarificationQueue.length}
          </span>
        </button>

        {(isEntryOnly || isAdmin) && (
          <button
            type="button"
            onClick={() => setActiveTab('rejected')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'rejected'
                ? 'bg-rose-600 text-white shadow-xs'
                : rejectedEntries.length > 0
                ? 'text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Rejected Entries</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'rejected' ? 'bg-white/20 text-white' : 'bg-rose-200 text-rose-800'
              }`}
            >
              {rejectedEntries.length}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('paid')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'paid'
              ? 'bg-teal-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          <span>Settled &amp; Paid</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'paid' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {paidQueue.length}
          </span>
        </button>
      </div>

      {activeTab === 'rejected' ? (
        rejectedEntries.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="No Rejected Entries"
            description="You have no rejected disbursement entries. Any entry returned with corrections needed by the Entry Approver will be listed here."
          />
        ) : (
          <div className="space-y-4">
            {rejectedEntries.map(({ entry: ent, request: req }) => (
              <div
                key={ent.id}
                className="bg-white rounded-2xl border border-rose-200 p-4 sm:p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                        {req.approval_no || req.request_no}
                      </span>
                      <TypeBadge type={typeOf(req)} />
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                        Entry #{ent.entry_no} Rejected
                      </span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${
                          ent.entry_type === 'cash'
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            : 'bg-blue-100 text-blue-900 border-blue-300'
                        }`}
                      >
                        {ent.entry_type === 'cash' ? 'Cash Entry' : 'Bank Entry'}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                      {req.title}
                    </h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                      <span>Beneficiary: <strong>{req.requester_name}</strong></span>
                      <span>Entry Amount: <strong className="text-slate-900 font-mono">{formatINR(ent.amount)}</strong></span>
                      {Number(ent.adjustment_amount || 0) > 0 && (
                        <span>Adj: <strong>{formatINR(Number(ent.adjustment_amount))}</strong></span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditEntryTarget({ request: req, entry: ent })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer transition-all active:scale-95"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Edit &amp; Resubmit Entry</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-semibold text-rose-800">
                    <span>Rejected by: <strong>{ent.rejected_by_name || 'Entry Approver'}</strong></span>
                    {ent.rejected_at && <span>At: {formatISTDate(ent.rejected_at, true)}</span>}
                  </div>
                  <p className="font-medium text-rose-950">
                    <strong>Reason:</strong> {ent.rejection_reason || 'Please correct entry details and resubmit.'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <RequestFilters value={filters} onChange={setFilters} source={currentList} resultCount={filtered.length} />

          {/* Results */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title={
                search
                  ? 'No matching vouchers'
                  : activeTab === 'awaiting'
                  ? 'All Payments Disbursed!'
                  : activeTab === 'clarification'
                  ? 'No Requests Under Clarification'
                  : 'No Paid Vouchers Yet'
              }
              description={
                search
                  ? 'Try searching with an exact approval number.'
                  : activeTab === 'awaiting'
                  ? 'No approved requests currently waiting for payment settlement.'
                  : activeTab === 'clarification'
                  ? 'There are currently no disbursement queries awaiting response from Department Heads.'
                  : 'Requests marked as paid will appear in this audit log.'
              }
            />
          ) : (
            <div className="space-y-4">
              {filtered.map((req) => {
                const pay = paymentSummary(req);
                const clarifications = req.disbursement_clarifications || [];
                const latestClarification = clarifications[0];
                const isPendingHead = latestClarification?.status === 'pending_head';
                const isClarified = latestClarification?.status === 'clarified';

                const entries: DisbursementEntry[] = (req.disbursement_entries || []).filter((e) => {
                  if (e.status === 'cancelled') return false;
                  if (isPaymentOnly) {
                    // Payment account strictly only sees entries associated with this payment cashier:
                    if (!isEntryAssociatedWithPaymentUser(user, e, req, dir.users)) {
                      return false;
                    }
                    if (activeTab === 'awaiting') {
                      return e.status === 'approved' && entryPayable(e) > 0;
                    }
                    if (activeTab === 'paid') {
                      return Number(e.paid_amount || 0) > 0 || e.status === 'paid';
                    }
                    return e.status === 'approved' || Number(e.paid_amount || 0) > 0;
                  }
                  return true;
                });
                const totalEntered = entriesTotal(entries);
                const remainingUnentered = entryAvailable(req);
                const nextEntryNo = entries.reduce((m, e) => Math.max(m, e.entry_no || 0), 0) + 1;

                return (
                  <div
                    key={req.id}
                    className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition-all space-y-4 ${
                      isPendingHead ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200/90 hover:border-teal-300'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div
                        onClick={() => navigate(`/requests/${req.id}`)}
                        className="cursor-pointer flex-1 min-w-0"
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                            {req.approval_no || req.request_no}
                          </span>
                          <TypeBadge type={typeOf(req)} />
                          {typeOf(req) !== 'discount' && typeOf(req) !== 'non_cash' && typeOf(req) !== 'stock_transfer' && (
                            <div className="flex items-center gap-1.5 text-xs text-sky-800 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                              <Wallet className="w-3 h-3 text-sky-600" />
                              <span>Entry: <strong>{req.assigned_entry_user_name || <span className="text-amber-700 italic font-medium">Not assigned yet</span>}</strong></span>
                              {entries.length === 0 && (isAdmin || user?.role === 'clerk' || user?.role === 'head' || user?.role === 'regional_head') && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAssignEntryTarget(req);
                                  }}
                                  className="ml-1 text-[10px] font-bold text-sky-700 underline hover:text-sky-900 cursor-pointer"
                                >
                                  {req.assigned_entry_user_id ? '[Change]' : '[Assign]'}
                                </button>
                              )}
                            </div>
                          )}
                          {isPendingHead && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                              <HelpCircle className="w-3 h-3 text-amber-600" />
                              Awaiting Head Clarification
                            </span>
                          )}
                          {isClarified && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                              Clarified by Head
                            </span>
                          )}
                          {pay.partial && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                              Partially paid
                            </span>
                          )}
                          <span className="text-xs text-slate-500">
                            Dept: <strong>{req.department?.code}</strong>
                          </span>
                          {req.shop_name && (
                            <span className="text-xs text-slate-500">
                              Shop: <strong>{req.shop_name}</strong>
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-slate-900 text-sm sm:text-base hover:text-teal-600 transition-colors break-words">
                          {req.title}
                        </h3>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                          <span>Beneficiary: <strong>{req.requester_name}</strong></span>
                          <span>Approved: {formatISTDate(req.decided_at, false)}</span>
                          {(req.payments?.length ?? 0) > 0 && (
                            <span className="font-semibold text-teal-700">
                              {req.payments!.length} payment{req.payments!.length === 1 ? '' : 's'} · last {formatISTDate(req.payments![req.payments!.length - 1].payment_date, false)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-100">
                        <div className="text-left sm:text-right">
                          {req.status === 'approved' && pay.paid > 0 ? (
                            <>
                              <span className="text-[10px] font-semibold uppercase text-amber-700 block">Balance</span>
                              <span className="font-display font-extrabold text-base sm:text-lg text-amber-800">{formatINR(pay.balance)}</span>
                              <span className="text-[11px] text-slate-500 block">
                                Paid {formatINR(pay.paid)} of {formatINR(req.amount)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                                {req.status === 'paid' ? 'Paid in full' : 'Amount to pay'}
                              </span>
                              <span className="font-display font-extrabold text-base sm:text-lg text-slate-900">
                                {formatINR(req.amount)}
                              </span>
                            </>
                          )}
                        </div>

                        {(() => {
                          const packet = (req.signed_files || []).find((s) => s.is_packet) || (req.signed_files || [])[0];
                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              {packet && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewSignedDoc({
                                      path: packet.storage_path,
                                      name: packet.file_name || `${req.approval_no || req.request_no}_packet.pdf`,
                                      approvalNo: req.approval_no,
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs transition-colors cursor-pointer"
                                  title="Preview official approved signed document"
                                >
                                  <Eye className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>Preview Approved Doc</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDownload(req)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Signed PDF</span>
                              </button>
                              {req.status === 'approved' && (
                                <button
                                  type="button"
                                  onClick={() => setClarifyTarget(req)}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs transition-colors cursor-pointer"
                                  title="Send back to Request Owner Head for clarification with voice or text message"
                                >
                                  <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                                  <span>{isPendingHead ? 'Ask More' : 'Ask Head'}</span>
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Disbursement Entries Card */}
                    <div className="pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-sky-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-900">
                            Disbursement Entries ({entries.length})
                          </span>
                          {entries.length > 0 && (
                            <span className="text-[11px] text-slate-500 font-mono">
                              · {formatINR(totalEntered)} entered of {formatINR(req.amount)}
                            </span>
                          )}
                        </div>

                        {canAddEntry && req.status === 'approved' && remainingUnentered > 0 && !isPendingHead && (
                          <button
                            type="button"
                            onClick={() => navigate(`/requests/${req.id}`)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-800 text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer shadow-2xs"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-sky-600" />
                            <span>Open Details to Add Entry #{nextEntryNo}</span>
                          </button>
                        )}
                      </div>

                      {entries.length === 0 ? (
                        <div className="text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>
                              {canAddEntry
                                ? 'No payment entries created yet. Please open the request to review approved documents before adding the entry.'
                                : 'Awaiting payment entries from an Entry Only account before disbursement can proceed.'}
                            </span>
                          </div>
                          {canAddEntry && req.status === 'approved' && !isPendingHead && (
                            <button
                              type="button"
                              onClick={() => navigate(`/requests/${req.id}`)}
                              className="shrink-0 self-start sm:self-auto px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                            >
                              <span>Open Request to Add Entry</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entries.map((ent) => {
                            const isEntryPendingApproval = ent.status === 'pending_approval' || ent.status === 'pending';
                            const isEntryApproved = ent.status === 'approved';
                            const isEntryRejected = ent.status === 'rejected';
                            const isEntryPaid = ent.status === 'paid';
                            const payCheck = isPaymentUserAllowedForEntry(user, ent, req, dir.users);
                            const canPayThisEntry = canPay && isEntryApproved && payCheck.allowed && !isPendingHead;
                            const isCashMode = ent.entry_type === 'cash';

                            return (
                              <div
                                key={ent.id}
                                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                                  isEntryRejected
                                    ? 'bg-rose-50/50 border-rose-200'
                                    : isEntryApproved
                                    ? 'bg-purple-50/30 border-purple-200'
                                    : isEntryPendingApproval
                                    ? 'bg-sky-50/40 border-sky-200'
                                    : 'bg-slate-50/60 border-slate-200'
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                  <span className="font-mono font-extrabold text-sky-900 bg-sky-100/90 px-2.5 py-0.5 rounded-md text-xs">
                                    Entry #{ent.entry_no}
                                  </span>
                                  <span
                                    className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${
                                      isCashMode
                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                        : 'bg-blue-100 text-blue-900 border-blue-300'
                                    }`}
                                  >
                                    {isCashMode ? 'Cash Entry' : 'Bank Entry'}
                                  </span>
                                  <span className="font-extrabold text-slate-900 font-mono text-sm">
                                    {formatINR(ent.amount)}
                                  </span>
                                  {Number(ent.adjustment_amount ?? 0) > 0 && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-50 text-violet-800 border-violet-200">
                                      + Old Bal. Adj. {formatINR(Number(ent.adjustment_amount))}
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                                      ent.tds_cut
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-slate-200 text-slate-700 border-slate-300'
                                    }`}
                                  >
                                    {ent.tds_cut
                                      ? Number(ent.tds_amount || 0) > 0
                                        ? `TDS Cut · ${formatINR(Number(ent.tds_amount))}`
                                        : 'TDS Cut'
                                      : 'TDS Not Cut'}
                                  </span>
                                  {Number(ent.paid_amount || 0) > 0 && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-teal-50 text-teal-800 border-teal-200">
                                      Paid {formatINR(Number(ent.paid_amount))} of {formatINR(Number(ent.amount))}
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                      isEntryPaid
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : isEntryApproved
                                        ? 'bg-purple-100 text-purple-800 border-purple-200'
                                        : isEntryRejected
                                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                                        : entryHasBalanceAwaitingApproval(ent)
                                        ? 'bg-violet-100 text-violet-800 border-violet-300'
                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                    }`}
                                  >
                                    {isEntryPaid
                                      ? 'Paid'
                                      : isEntryApproved
                                      ? entryPayable(ent) < entryOutstanding(ent)
                                        ? `Partially Approved · ${formatINR(entryPayable(ent))}`
                                        : 'Approved for Payment'
                                      : isEntryRejected
                                      ? 'Rejected'
                                      : entryHasBalanceAwaitingApproval(ent)
                                      ? `Balance ${formatINR(entryOutstanding(ent))} Awaiting Verification`
                                      : 'Pending Approver'}
                                  </span>
                                  {(ent.created_by_person_name || ent.paid_by_person_name) && (
                                    <span className="text-[10px] text-slate-500">
                                      {ent.created_by_person_name ? `Entry by ${ent.created_by_person_name}` : ''}
                                      {ent.created_by_person_name && ent.paid_by_person_name ? ' · ' : ''}
                                      {ent.paid_by_person_name ? `Paid by ${ent.paid_by_person_name}` : ''}
                                    </span>
                                  )}
                                  {ent.notes && (
                                    <span className="text-[11px] text-slate-500 italic truncate max-w-xs">
                                      · {ent.notes}
                                    </span>
                                  )}
                                  {isEntryRejected && ent.rejection_reason && (
                                    <span className="w-full block text-[11px] text-rose-700 font-semibold bg-rose-100/60 border border-rose-200 px-2 py-1 rounded-md mt-1">
                                      Rejection Reason: {ent.rejection_reason}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                  {isEntryApproved && !isEntryPaid ? (
                                    canPayThisEntry ? (
                                      <button
                                        type="button"
                                        onClick={() => setPayTarget({ request: req, entry: ent })}
                                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95 ${
                                          isCashMode ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-teal-600 hover:bg-teal-700'
                                        }`}
                                      >
                                        <Banknote className="w-3.5 h-3.5" />
                                        <span>
                                          {isCashMode ? 'Settle Cash Entry' : 'Pay Entry'} #{ent.entry_no} ({formatINR(entryPayable(ent))})
                                        </span>
                                      </button>
                                    ) : isPaymentOnly && !payCheck.allowed ? (
                                      <span
                                        className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded-md border border-amber-200 max-w-[240px] truncate"
                                        title={payCheck.reason}
                                      >
                                        {payCheck.reason || 'Restricted to linked cashier'}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                                        {isEntryOnly ? 'Awaiting Payment Account' : 'Payment on Hold'}
                                      </span>
                                    )
                                  ) : isEntryPendingApproval ? (
                                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                                      Awaiting Entry Approver
                                    </span>
                                  ) : isEntryRejected ? (
                                    (canAddEntry || ent.created_by === user?.id) && (
                                      <button
                                        type="button"
                                        onClick={() => setEditEntryTarget({ request: req, entry: ent })}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer"
                                      >
                                        Edit &amp; Resubmit
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200 flex items-center gap-1">
                                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Entry Paid</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add Disbursement Entry Modal */}
      {entryModalTarget && (
        <AddDisbursementEntryModal
          isOpen={true}
          onClose={() => setEntryModalTarget(null)}
          request={entryModalTarget}
          onAddEntry={async (amount, tdsCut, notes, adjustment, entryType, extra) => {
            const res = await addDisbursementEntry(entryModalTarget.id, amount, tdsCut, notes, adjustment, entryType, extra);
            if (!res.success) {
              throw new Error(res.error || 'Failed to add disbursement entry');
            }
            const adjText = adjustment > 0 ? ` · Old balance adjusted ${formatINR(adjustment)}` : '';
            const tdsText = tdsCut ? `TDS Cut ${formatINR(extra.tdsAmount)}` : 'TDS Not Cut';
            setNotice(
              amount <= 0
                ? `Entry recorded${adjText}. Nothing to pay — marked as Paid${res.fully_paid ? ', request closed' : ''}.`
                : `Entry added as ${entryType === 'cash' ? 'Cash Entry' : 'Bank Entry'}: ${formatINR(amount)} to pay (${tdsText})${adjText}. Sent to Approver for review.`
            );
          }}
        />
      )}

      {/* Edit Rejected Disbursement Entry Modal */}
      {editEntryTarget && (
        <EditDisbursementEntryModal
          isOpen={true}
          onClose={() => setEditEntryTarget(null)}
          request={editEntryTarget.request}
          entry={editEntryTarget.entry}
          onResubmit={async (entryId, amount, entryType, tdsCut, notes, adjustment, extra) => {
            const res = await editRejectedDisbursementEntry(
              entryId,
              amount,
              entryType,
              tdsCut,
              notes,
              adjustment,
              extra
            );
            if (!res.success) throw new Error(res.error || 'Failed to update entry');
            setEditEntryTarget(null);
            setNotice('Entry corrected and resubmitted for Approver review.');
          }}
        />
      )}

      {/* Assign Entry Account Modal */}
      {assignEntryTarget && (
        <AssignEntryAccountModal
          isOpen={true}
          onClose={() => {
            setAssignEntryTarget(null);
            setNotice('Assigned Entry Officer updated.');
          }}
          request={assignEntryTarget}
        />
      )}

      {/* Mark Paid Modal (supports paying against entry or request) */}
      {payTarget && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setPayTarget(null)}
          request={payTarget.request}
          entry={payTarget.entry}
          onMarkPaid={async (dt) => {
            const res = await markAsPaid(payTarget.request.id, dt);
            if (!res.success) throw new Error(res.error || 'Could not record payment');
            const balanceLeft = payTarget.entry
              ? Math.max(0, Math.round((Number(payTarget.entry.amount) - Number(payTarget.entry.paid_amount || 0) - (dt.amount || 0)) * 100) / 100)
              : 0;
            setNotice(
              payTarget.entry
                ? `Entry #${payTarget.entry.entry_no} paid (${formatINR(dt.amount || entryPayable(payTarget.entry))}).${balanceLeft > 0 ? ` Balance ${formatINR(balanceLeft)} sent back to the Entry Approver for verification.` : ''}`
                : res.fully_paid
                ? 'Paid in full — request closed.'
                : 'Partial payment recorded. Balance stays in Awaiting Payment.'
            );
          }}
        />
      )}

      {clarifyTarget && (
        <DisbursementClarificationModal
          isOpen={true}
          onClose={() => setClarifyTarget(null)}
          request={clarifyTarget}
          onSuccess={() => setNotice('Clarification query sent to Request Owner Head.')}
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
