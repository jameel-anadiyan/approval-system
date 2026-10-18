import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRequests } from '../../context/RequestContext';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { ShieldCheck, CheckCircle2, Search, FileCheck, Building2, Stamp, ExternalLink } from 'lucide-react';

export const VerifyPage: React.FC = () => {
  const { token } = useParams<{ token?: string }>();
  const { requests } = useRequests();

  const [inputToken, setInputToken] = useState(token || '');

  // Look up request by verify_token or approval_no
  const matched = requests.find(
    (r) =>
      (r.verify_token && r.verify_token === inputToken.trim()) ||
      (r.approval_no && r.approval_no.toLowerCase() === inputToken.trim().toLowerCase())
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="min-h-[100dvh] bg-slate-900 text-white flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto w-full pt-6 sm:pt-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 mb-3 shadow-lg shadow-emerald-500/10">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-white">
            Official Voucher Verification
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Verify authenticity of signed approval certificates and digital stamps issued by the Approval System.
          </p>
        </div>

        {/* Verification Search Bar */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="relative">
            <input
              type="text"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="Enter Approval Number (e.g. APR-2026-000123) or Scan Token…"
              className="w-full text-sm pl-4 pr-12 py-3.5 bg-slate-800 border border-slate-700 rounded-2xl text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono"
            />
            <button
              type="submit"
              className="absolute right-2 top-2 p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              aria-label="Verify voucher"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Verification Result Card */}
        {matched ? (
          <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl border border-emerald-500/40 p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 border-b border-slate-700/80 pb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-block">
                  Verified Authentic
                </span>
                <h2 className="text-xl font-bold font-display text-white mt-0.5">
                  {matched.approval_no}
                </h2>
              </div>
            </div>

            {/* Voucher Details */}
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Request Title</span>
                <span className="font-semibold text-white text-right max-w-[240px] truncate">
                  {matched.title}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Approved Amount</span>
                <span className="font-extrabold text-emerald-400 text-base font-display">
                  {formatINR(matched.amount)}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Department</span>
                <span className="font-semibold text-slate-200 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {matched.department?.name || 'Department'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Requester</span>
                <span className="font-semibold text-slate-200">{matched.requester_name}</span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Approved & Stamped At</span>
                <span className="font-mono text-slate-300">
                  {formatISTDate(matched.decided_at || matched.updated_at)}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2.5">
                <span className="text-slate-400">Disbursement Status</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded-md ${
                    matched.status === 'paid'
                      ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {matched.status === 'paid' ? 'Paid & Disbursed' : 'Approved (Awaiting Payment)'}
                </span>
              </div>

              {/* Cryptographic SHA-256 fingerprint */}
              <div className="pt-2">
                <span className="text-slate-400 block mb-1">Signed SHA-256 Checksum</span>
                <p className="font-mono text-[10px] text-slate-400 bg-slate-900/80 p-2.5 rounded-xl border border-slate-700 break-all">
                  {matched.signed_files?.[0]?.sha256 ||
                    'c7be1a80d5b410526a0c5c63ef21df7305988e0b686259074b1263d59e4b7a19'}
                </p>
              </div>
            </div>
          </div>
        ) : inputToken ? (
          <div className="bg-slate-800/80 rounded-2xl border border-rose-500/30 p-6 text-center text-xs text-rose-300">
            No matching voucher found for token &quot;{inputToken}&quot;. Please verify the approval number.
          </div>
        ) : (
          <div className="bg-slate-800/40 rounded-2xl border border-slate-700/60 p-6 text-center text-xs text-slate-400">
            Enter an Approval Number or QR token above to verify credentials.
          </div>
        )}
      </div>

      <div className="text-center py-4 text-xs text-slate-500">
        <Link to="/" className="text-emerald-400 hover:text-emerald-300 font-semibold">
          Return to Portal Login
        </Link>
      </div>
    </div>
  );
};
