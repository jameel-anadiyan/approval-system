import React, { useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { MarkPaidModal } from '../../components/portals/MarkPaidModal';
import { RequestRecord } from '../../types/database';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { Search, Banknote, Clock, CheckCircle, ShieldCheck, Download, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const DisbursementPage: React.FC = () => {
  const { requests, markAsPaid } = useRequests();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'awaiting' | 'paid'>('awaiting');
  const [payTarget, setPayTarget] = useState<RequestRecord | null>(null);

  // Awaiting payment: status === 'approved'
  const awaitingQueue = requests.filter((r) => r.status === 'approved');

  // Paid history: status === 'paid'
  const paidQueue = requests.filter((r) => r.status === 'paid');

  const currentList = activeTab === 'awaiting' ? awaitingQueue : paidQueue;

  const filtered = currentList.filter((r) => {
    return (
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.requester_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.request_no && r.request_no.toLowerCase().includes(search.toLowerCase())) ||
      (r.approval_no && r.approval_no.toLowerCase().includes(search.toLowerCase()))
    );
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
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

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
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

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by Approval No (APR-…), Request No, or Requester…"
          className="w-full text-xs sm:text-sm pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-mono"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
      </div>

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
          {filtered.map((req) => (
            <div
              key={req.id}
              className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs hover:border-teal-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div
                onClick={() => navigate(`/requests/${req.id}`)}
                className="cursor-pointer flex-1"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                    {req.approval_no || req.request_no}
                  </span>
                  <span className="text-xs text-slate-500">
                    Dept: <strong>{req.department?.code}</strong>
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base hover:text-teal-600 transition-colors">
                  {req.title}
                </h3>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                  <span>Beneficiary: <strong>{req.requester_name}</strong></span>
                  <span>Approved: {formatISTDate(req.decided_at, false)}</span>
                  {req.payment_mode && (
                    <span className="font-semibold text-teal-700">
                      Paid via {req.payment_mode} (Ref: {req.payment_ref || 'N/A'})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-100">
                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                    Settlement Amount
                  </span>
                  <span className="font-display font-extrabold text-base sm:text-lg text-slate-900">
                    {formatINR(req.amount)}
                  </span>
                </div>

                {req.status === 'approved' ? (
                  <button
                    type="button"
                    onClick={() => setPayTarget(req)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all active:scale-95"
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Mark as Paid</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => alert(`Downloading payment voucher for ${req.approval_no}...`)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Voucher</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {payTarget && (
        <MarkPaidModal
          isOpen={true}
          onClose={() => setPayTarget(null)}
          request={payTarget}
          onMarkPaid={async (dt) => {
            await markAsPaid(payTarget.id, dt);
          }}
        />
      )}
    </div>
  );
};
