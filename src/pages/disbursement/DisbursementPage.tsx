import React, { useEffect, useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { EmptyState } from '../../components/common/EmptyState';
import { TypeBadge } from '../../components/common/StatusBadge';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { RequestRecord, paymentSummary } from '../../types/database';
import { formatINR, formatISTDate, typeOf } from '../../lib/formatters';
import { Banknote, Clock, CheckCircle, ShieldCheck, Download } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { downloadSignedPacket } from '../../lib/files';

export const DisbursementPage: React.FC = () => {
  const { requests, markAsPaid } = useRequests();
  const { isBackendConnected } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<'awaiting' | 'paid'>(
    location.pathname.endsWith('/paid') ? 'paid' : 'awaiting'
  );
  const [payTarget, setPayTarget] = useState<RequestRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(location.pathname.endsWith('/paid') ? 'paid' : 'awaiting');
  }, [location.pathname]);

  const handleDownload = async (req: RequestRecord) => {
    setNotice(null);
    const res = await downloadSignedPacket(req, isBackendConnected);
    if (!res.success) setNotice(res.error || 'Download failed');
  };

  // Discount approvals have no payment step, so they never reach Disbursement.
  const payable = requests.filter((r) => typeOf(r) !== 'discount');

  // Awaiting payment: status === 'approved'
  const awaitingQueue = payable.filter((r) => r.status === 'approved');

  // Paid history: status === 'paid'
  const paidQueue = payable.filter((r) => r.status === 'paid');

  const currentList = activeTab === 'awaiting' ? awaitingQueue : paidQueue;
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
            Disburse approved funds, verify official digitally signed certificates, and record bank references.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/disbursement/verify')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-colors self-start sm:self-auto"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Verify QR Voucher</span>
        </button>
      </div>

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
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
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
          onClick={() => setActiveTab('paid')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
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
          title={search ? 'No matching vouchers' : activeTab === 'awaiting' ? 'All Payments Disbursed!' : 'No Paid Vouchers Yet'}
          description={
            search
              ? 'Try searching with an exact approval number.'
              : activeTab === 'awaiting'
              ? 'No approved requests currently waiting for payment settlement.'
              : 'Requests marked as paid will appear in this audit log.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => {
            const pay = paymentSummary(req);
            return (
            <div
              key={req.id}
              className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs hover:border-teal-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div
                onClick={() => navigate(`/requests/${req.id}`)}
                className="cursor-pointer flex-1 min-w-0"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                    {req.approval_no || req.request_no}
                  </span>
                  <TypeBadge type={typeOf(req)} />
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
                  <button
                    type="button"
                    onClick={() => setPayTarget(req)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all active:scale-95"
                  >
                    <Banknote className="w-4 h-4" />
                    <span>{pay.paid > 0 ? 'Pay Balance' : 'Record Payment'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDownload(req)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Signed PDF</span>
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {payTarget && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setPayTarget(null)}
          request={payTarget}
          onMarkPaid={async (dt) => {
            const res = await markAsPaid(payTarget.id, dt);
            if (!res.success) throw new Error(res.error || 'Could not record payment');
            setNotice(res.fully_paid ? 'Paid in full — request closed.' : 'Partial payment recorded. Balance stays in Awaiting Payment.');
          }}
        />
      )}
    </div>
  );
};
