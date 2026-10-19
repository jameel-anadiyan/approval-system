import React, { useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatISTDate, ROLE_LABELS } from '../../lib/formatters';
import { verifyApproval, VerifyResult } from '../../lib/verify';
import { QrCode, CheckCircle2, AlertTriangle, ArrowRight, Loader2, Banknote } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const DisbursementVerifyPage: React.FC = () => {
  const { requests } = useRequests();
  const { isBackendConnected } = useAuth();
  const navigate = useNavigate();

  const [inputCode, setInputCode] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await verifyApproval(inputCode, isBackendConnected, requests);
    setResult(res.result);
    setError(res.error || null);
    setHasSearched(true);
    setLoading(false);
  };

  const packet = result?.files.find((f) => f.is_packet) || result?.files[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <QrCode className="w-6 h-6 text-teal-600" />
          <span>Verify an Approval Sheet</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Scan the QR code on the stamped sheet with your phone camera (it opens the verify link), or paste the link or
          approval number here before paying out.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <form onSubmit={handleVerify} className="space-y-3">
          <label htmlFor="disb-verify-input" className="text-xs font-bold text-slate-700 block">
            QR link / token / approval number
          </label>
          <div className="flex gap-2">
            <input
              id="disb-verify-input"
              type="text"
              required
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="e.g. APR-2026-000123"
              className="flex-1 min-w-0 text-sm p-3.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden font-mono"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-teal-200 transition-all shrink-0 disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Verify</span>
            </button>
          </div>
        </form>
      </div>

      {result ? (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                Genuine approval
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-display mt-0.5">{result.approval_no}</h2>
            </div>
          </div>

          {result.status === 'paid' && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Already paid</strong> on {formatISTDate(result.paid_at)}. Do not pay this sheet again.
              </span>
            </div>
          )}
          {result.status === 'approved' && result.paid_amount > 0 && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-300 text-xs text-sky-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Partially paid:</strong> {formatINR(result.paid_amount)} paid, balance{' '}
                <strong>{formatINR(result.balance)}</strong> due. Pay only the balance.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs pt-3 border-t border-emerald-200">
            <div className="col-span-2">
              <span className="text-slate-500 block">Title</span>
              <span className="font-bold text-slate-800 mt-0.5 block">{result.title}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Amount</span>
              <span className="font-extrabold text-slate-900 text-base font-display block">{formatINR(result.amount)}</span>
              {result.paid_amount > 0 && (
                <span className="text-[11px] text-slate-500 block">
                  Paid {formatINR(result.paid_amount)} · Balance {formatINR(result.balance)}
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500 block">Requester</span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {result.requester_name}
                {result.department ? ` · ${result.department}` : ''}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Approved by</span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {result.approver_name || '—'}
                {result.approver_role ? ` (${ROLE_LABELS[result.approver_role]})` : ''}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Approved at</span>
              <span className="font-mono text-slate-700 block mt-0.5">{formatISTDate(result.decided_at)}</span>
            </div>
            {packet && (
              <div className="col-span-2">
                <span className="text-slate-500 block">Packet SHA-256 ({packet.page_count} pages)</span>
                <span className="font-mono text-[10px] text-slate-600 break-all block mt-0.5">{packet.sha256}</span>
              </div>
            )}
          </div>

          {result.can_open && (
            <div className="pt-3 border-t border-emerald-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navigate(`/requests/${result.request_id}`)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline"
              >
                <span>Open request &amp; signed PDF</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              {result.status === 'approved' && (
                <button
                  type="button"
                  onClick={() => navigate(`/requests/${result.request_id}`)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs"
                >
                  <Banknote className="w-4 h-4" />
                  <span>{result.paid_amount > 0 ? 'Go to Pay Balance' : 'Go to Record Payment'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : hasSearched ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-rose-800 space-y-2">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <h3 className="font-bold text-sm">Not a valid approval</h3>
          <p className="text-xs text-rose-600 max-w-sm mx-auto">
            {error ||
              `No approved record matches "${inputCode}". The sheet may be forged or not yet approved. Do not pay.`}
          </p>
        </div>
      ) : null}
    </div>
  );
};
