import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useRequests } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatISTDate, ROLE_LABELS } from '../../lib/formatters';
import { verifyApproval, VerifyResult } from '../../lib/verify';
import { ShieldCheck, CheckCircle2, Search, Building2, Loader2, ShieldX, ArrowRight } from 'lucide-react';

export const VerifyPage: React.FC = () => {
  const { token } = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const { requests } = useRequests();
  const { user, isBackendConnected, isLoading: authLoading } = useAuth();

  const [inputToken, setInputToken] = useState(token || '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verification is public: anyone holding the QR token can view it (no sign-in).

  const run = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setLoading(true);
      setError(null);
      const res = await verifyApproval(code, isBackendConnected, requests);
      setResult(res.result);
      setError(res.error || null);
      setSearched(true);
      setLoading(false);
    },
    [isBackendConnected, requests]
  );

  useEffect(() => {
    if (token && !authLoading) run(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authLoading, isBackendConnected]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    run(inputToken);
  };

  const packet = result?.files.find((f) => f.is_packet) || result?.files[0];

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-white flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto w-full pt-6 sm:pt-10">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 mb-3 shadow-lg shadow-emerald-500/10">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-white">
            Approval Verification
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Confirm that a stamped approval sheet is genuine and see its current payment status.
          </p>
        </div>

        {(
          <>
            <form onSubmit={handleSearch} className="mb-6">
              <div className="relative">
                <label htmlFor="verify-input" className="sr-only">Approval number or verification token</label>
                <input
                  id="verify-input"
                  type="text"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="Approval number, QR link or token"
                  className="w-full text-sm pl-4 pr-12 py-3.5 bg-slate-800 border border-slate-700 rounded-2xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-2 p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  aria-label="Verify"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </form>

            {result ? (
              <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl border border-emerald-500/40 p-6 sm:p-8 shadow-2xl space-y-6">
                <div className="flex items-center gap-3 border-b border-slate-700/80 pb-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-block">
                      Genuine approval
                    </span>
                    <h2 className="text-xl font-bold font-display text-white mt-0.5">{result.approval_no}</h2>
                  </div>
                </div>

                <dl className="space-y-3 text-xs">
                  <Row label="Request">{result.request_no} · {result.title}</Row>
                  <Row label="Approved Amount">
                    <span className="font-extrabold text-emerald-400 text-base font-display">{formatINR(result.amount)}</span>
                  </Row>
                  <Row label="Department">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {result.department || '—'}
                    </span>
                  </Row>
                  <Row label="Requester">{result.requester_name}</Row>
                  <Row label="Approved by">
                    {result.approver_name || '—'}
                    {result.approver_role ? ` (${ROLE_LABELS[result.approver_role] || result.approver_role})` : ''}
                  </Row>
                  <Row label="Approved at">
                    <span className="font-mono">{formatISTDate(result.decided_at)}</span>
                  </Row>
                  {result.shop_name && <Row label="Store">{result.shop_name}</Row>}
                  <Row label="Payment status">
                    <span
                      className={`font-bold px-2 py-0.5 rounded-md ${
                        result.status === 'paid' || (result.balance <= 0 && result.paid_amount > 0)
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          : result.paid_amount > 0
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {result.status === 'paid' || (result.balance <= 0 && result.paid_amount > 0)
                        ? `Paid in full${result.paid_at ? ` · ${formatISTDate(result.paid_at, false)}` : ''}`
                        : result.paid_amount > 0
                        ? 'Partially paid'
                        : 'Not yet paid'}
                    </span>
                  </Row>
                  {result.request_type !== 'discount' && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="rounded-xl bg-slate-900/70 border border-slate-700 p-2.5 text-center min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Approved</p>
                        <p className="font-bold text-slate-100 text-xs sm:text-sm truncate">{formatINR(result.amount)}</p>
                      </div>
                      <div className="rounded-xl bg-teal-500/10 border border-teal-500/30 p-2.5 text-center min-w-0">
                        <p className="text-[10px] text-teal-300 uppercase tracking-wide">Paid</p>
                        <p className="font-bold text-teal-200 text-xs sm:text-sm truncate">{formatINR(result.paid_amount)}</p>
                      </div>
                      <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 text-center min-w-0">
                        <p className="text-[10px] text-amber-300 uppercase tracking-wide">Balance</p>
                        <p className="font-bold text-amber-200 text-xs sm:text-sm truncate">{formatINR(result.balance)}</p>
                      </div>
                    </div>
                  )}
                  {result.payments.length > 0 && (
                    <div className="pt-1">
                      <span className="text-slate-400 block mb-1.5">Payments ({result.payments.length})</span>
                      <ul className="space-y-1">
                        {result.payments.map((p, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between bg-slate-900/60 border border-slate-700/70 rounded-lg px-3 py-1.5"
                          >
                            <span className="font-mono text-slate-300">{formatISTDate(p.payment_date, false)}</span>
                            <span className="font-semibold text-teal-200">{formatINR(p.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {packet && (
                    <div className="pt-2">
                      <span className="text-slate-400 block mb-1">
                        SHA-256 of signed packet ({packet.page_count} pages)
                      </span>
                      <p className="font-mono text-[10px] text-slate-300 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700 break-all">
                        {packet.sha256}
                      </p>
                    </div>
                  )}
                </dl>

                {result.can_open && user && (
                  <button
                    type="button"
                    onClick={() => navigate(`/requests/${result.request_id}`)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                  >
                    <span>Open request &amp; signed PDF</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : searched ? (
              <div className="bg-slate-800/80 rounded-2xl border border-rose-500/30 p-6 text-center text-xs text-rose-300 space-y-2">
                <ShieldX className="w-8 h-8 mx-auto text-rose-400" />
                <p className="font-semibold">No approved record matches this code.</p>
                <p className="text-rose-300/80">
                  {error || 'The sheet may be forged, the request may not be approved, or the code was mistyped.'}
                </p>
              </div>
            ) : (
              <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-6 text-center text-xs text-slate-400">
                Scan the QR code on the stamped sheet, or type the approval number above.
              </div>
            )}
          </>
        )}
      </div>

      <div className="text-center py-4 text-xs text-slate-500">
        <Link to="/" className="text-emerald-400 hover:text-emerald-300 font-semibold">
          {user ? 'Back to portal' : 'SWA Diamonds staff sign in'}
        </Link>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4 border-b border-slate-700/50 pb-2.5">
    <dt className="text-slate-400 shrink-0">{label}</dt>
    <dd className="font-semibold text-slate-200 text-right min-w-0 truncate">{children}</dd>
  </div>
);
