import React, { useEffect, useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { EmptyState } from '../../components/common/EmptyState';
import { TypeBadge } from '../../components/common/StatusBadge';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { AddDisbursementEntryModal } from '../../components/portals/AddDisbursementEntryModal';
import { DisbursementClarificationModal } from '../../components/portals/DisbursementClarificationModal';
import { DisbursementEntry, RequestRecord, paymentSummary, entryPayable, entriesTotal, entryAvailable } from '../../types/database';
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
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { downloadSignedPacket } from '../../lib/files';

export const DisbursementPage: React.FC = () => {
  const { requests, markAsPaid, addDisbursementEntry } = useRequests();
  const { user, isBackendConnected } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isDisbursement = user?.role === 'disbursement';
  const isAdmin = user?.role === 'admin';
  const isEntryOnly = isDisbursement && (user?.disbursement_type === 'entry_only' || !user?.disbursement_type);
  const isPaymentOnly = isDisbursement && user?.disbursement_type === 'payment_only';

  const canAddEntry = isEntryOnly || isAdmin;
  const canPay = isPaymentOnly || isAdmin;

  const [activeTab, setActiveTab] = useState<'awaiting' | 'clarification' | 'paid'>(
    location.pathname.endsWith('/paid') ? 'paid' : 'awaiting'
  );
  const [payTarget, setPayTarget] = useState<{ request: RequestRecord; entry?: DisbursementEntry | null } | null>(null);
  const [entryModalTarget, setEntryModalTarget] = useState<RequestRecord | null>(null);
  const [clarifyTarget, setClarifyTarget] = useState<RequestRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  // Awaiting payment: status === 'approved'
  const awaitingQueue = payable.filter((r) => r.status === 'approved');

  // Under Clarification: approved but waiting for Head's response
  const underClarificationQueue = awaitingQueue.filter((r) =>
    (r.disbursement_clarifications || []).some((c) => c.status === 'pending_head')
  );

  // Paid history: status === 'paid'
  const paidQueue = payable.filter((r) => r.status === 'paid');

  const currentList =
    activeTab === 'awaiting'
      ? awaitingQueue
      : activeTab === 'clarification'
      ? underClarificationQueue
      : paidQueue;

  const { filters, setFilters, result: filtered } = useRequestFilters(currentList, {
    sort: activeTab === 'awaiting' ? 'oldest' : 'newest',
  });
  const search = filters.q;
  const partialCount = awaitingQueue.filter((r) => paymentSummary(r).partial).length;
  const awaitingBalance = awaitingQueue.reduce((s, r) => s + paymentSummary(r).balance, 0);

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
          <span>Settled & Paid</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'paid' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {paidQueue.length}
          </span>
        </button>
      </div>

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

            const entries: DisbursementEntry[] = (req.disbursement_entries || []).filter(
              (e) => e.status !== 'cancelled'
            );
            const pendingEntries = entries.filter((e) => e.status === 'pending');
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

                    {req.status === 'approved' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setClarifyTarget(req)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs transition-colors cursor-pointer"
                          title="Send back to Request Owner Head for clarification with voice or text message"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                          <span>{isPendingHead ? 'Ask More' : 'Ask Head'}</span>
                        </button>

                        {/* Payments can only be released against an entry (no request-level Quick Pay) */}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDownload(req)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Signed PDF</span>
                      </button>
                    )}
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
                        onClick={() => setEntryModalTarget(req)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-300 bg-sky-50 text-sky-800 text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer shadow-2xs"
                      >
                        <PlusCircle className="w-3.5 h-3.5 text-sky-600" />
                        <span>+ Add Entry #{nextEntryNo}</span>
                      </button>
                    )}
                  </div>

                  {entries.length === 0 ? (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          {canAddEntry
                            ? 'No payment entries created yet. Click "+ Add Entry #1" to record the first entry with TDS indication.'
                            : 'Awaiting payment entries from an Entry Only account before disbursement can proceed.'}
                        </span>
                      </div>
                      {canAddEntry && req.status === 'approved' && !isPendingHead && (
                        <button
                          type="button"
                          onClick={() => setEntryModalTarget(req)}
                          className="shrink-0 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-sky-600 text-white font-bold text-xs hover:bg-sky-700 transition-colors cursor-pointer"
                        >
                          + Add Entry #1
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {entries.map((ent) => {
                        const isEntryPending = ent.status === 'pending';
                        return (
                          <div
                            key={ent.id}
                            className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                              isEntryPending
                                ? 'bg-sky-50/40 border-sky-200'
                                : 'bg-slate-50/60 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="font-mono font-extrabold text-sky-900 bg-sky-100/90 px-2.5 py-0.5 rounded-md text-xs">
                                Entry #{ent.entry_no}
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
                                {ent.tds_cut ? 'TDS Cut' : 'TDS Not Cut'}
                              </span>
                              <span
                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                  isEntryPending
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}
                              >
                                {isEntryPending ? 'Pending Payment' : 'Paid'}
                              </span>
                              {ent.notes && (
                                <span className="text-[11px] text-slate-500 italic truncate max-w-xs">
                                  · {ent.notes}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                              {isEntryPending ? (
                                canPay && !isPendingHead ? (
                                  <button
                                    type="button"
                                    onClick={() => setPayTarget({ request: req, entry: ent })}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                                  >
                                    <Banknote className="w-3.5 h-3.5" />
                                    <span>Pay Entry #{ent.entry_no} ({formatINR(entryPayable(ent))})</span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                                    {isEntryOnly ? 'Awaiting Payment Account' : 'Payment on Hold'}
                                  </span>
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

      {/* Add Disbursement Entry Modal */}
      {entryModalTarget && (
        <AddDisbursementEntryModal
          isOpen={true}
          onClose={() => setEntryModalTarget(null)}
          request={entryModalTarget}
          onAddEntry={async (amount, tdsCut, notes, adjustment = 0) => {
            const res = await addDisbursementEntry(entryModalTarget.id, amount, tdsCut, notes, adjustment);
            if (!res.success) {
              throw new Error(res.error || 'Failed to add disbursement entry');
            }
            const adjText = adjustment > 0 ? ` · Old balance adjusted ${formatINR(adjustment)}` : '';
            setNotice(
              amount <= 0
                ? `Entry recorded${adjText}. Nothing to pay — marked as Paid${res.fully_paid ? ', request closed' : ''}.`
                : `Entry added: ${formatINR(amount)} to pay (${tdsCut ? 'TDS Cut' : 'TDS Not Cut'})${adjText}. Ready for Payment.`
            );
          }}
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
            setNotice(
              payTarget.entry
                ? `Entry #${payTarget.entry.entry_no} marked as Paid (${formatINR(dt.amount || entryPayable(payTarget.entry))}).`
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
    </div>
  );
};
