import React, { useState } from 'react';
import { useRequests } from '../../context/RequestContext';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { ShieldCheck, Search, QrCode, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const DisbursementVerifyPage: React.FC = () => {
  const { requests } = useRequests();
  const navigate = useNavigate();

  const [inputCode, setInputCode] = useState('');
  const [matchedRequest, setMatchedRequest] = useState<(typeof requests)[0] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
    const code = inputCode.trim().toLowerCase();
    const found = requests.find(
      (r) =>
        (r.approval_no && r.approval_no.toLowerCase() === code) ||
        (r.verify_token && r.verify_token.toLowerCase() === code) ||
        (r.request_no && r.request_no.toLowerCase() === code)
    );
    setMatchedRequest(found || null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <QrCode className="w-6 h-6 text-teal-600" />
          <span>Voucher QR Code Scanner & Verification</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Scan the QR code printed on signed approval sheets or manually verify the approval code before cash payout.
        </p>
      </div>

      {/* Verification Search Form */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <form onSubmit={handleVerify} className="space-y-3">
          <label className="text-xs font-bold text-slate-700 block">
            Scan Token / Approval Number
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              required
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="e.g. APR-2026-000123 or vtok-…"
              className="flex-1 text-sm p-3.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-hidden font-mono"
            />
            <button
              type="submit"
              className="px-5 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-teal-200 transition-all shrink-0"
            >
              Verify Voucher
            </button>
          </div>
        </form>
      </div>

      {/* Verification Result */}
      {matchedRequest ? (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6 shadow-xs space-y-4 animate-in zoom-in-95">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                Valid Approval Certificate
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-display mt-0.5">
                {matchedRequest.approval_no}
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs pt-3 border-t border-emerald-200">
            <div>
              <span className="text-slate-500 block">Title</span>
              <span className="font-bold text-slate-800 mt-0.5 block">{matchedRequest.title}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Amount to Disburse</span>
              <span className="font-extrabold text-slate-900 text-base font-display block">
                {formatINR(matchedRequest.amount)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Requester (Beneficiary)</span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {matchedRequest.requester_name} ({matchedRequest.department?.code})
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Approval Date</span>
              <span className="font-mono text-slate-700 block mt-0.5">
                {formatISTDate(matchedRequest.decided_at)}
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-emerald-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate(`/requests/${matchedRequest.id}`)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline"
            >
              <span>Open Request Details & Signed PDF</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : hasSearched ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-rose-800 space-y-2">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
          <h3 className="font-bold text-sm">Voucher Record Not Found</h3>
          <p className="text-xs text-rose-600 max-w-sm mx-auto">
            No matching approved certificate was found for &quot;{inputCode}&quot;. Please verify the approval code
            or inspect the printed voucher.
          </p>
        </div>
      ) : null}
    </div>
  );
};
