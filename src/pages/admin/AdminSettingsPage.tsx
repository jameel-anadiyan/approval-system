import React, { useState } from 'react';
import { MOCK_SETTINGS } from '../../lib/mockData';
import { formatINR } from '../../lib/formatters';
import { Settings, ShieldCheck, Check, Save } from 'lucide-react';

export const AdminSettingsPage: React.FC = () => {
  const [threshold, setThreshold] = useState<number>(MOCK_SETTINGS.high_value_threshold);
  const [approvalPrefix, setApprovalPrefix] = useState<string>(MOCK_SETTINGS.approval_prefix);
  const [requestPrefix, setRequestPrefix] = useState<string>(MOCK_SETTINGS.request_prefix);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    MOCK_SETTINGS.high_value_threshold = threshold;
    MOCK_SETTINGS.approval_prefix = approvalPrefix;
    MOCK_SETTINGS.request_prefix = requestPrefix;
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 4000);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-600" />
          <span>System & Workflow Settings</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Adjust policy threshold limits, automated voucher numbering prefixes, and routing governance.
        </p>
      </div>

      {isSaved && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Workflow settings updated and logged to audit trail!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Threshold Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">High-Value Policy Threshold (₹)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Requests above this amount cannot be approved by Department Heads (Route B is disabled)
              and are strictly mandated for Admin sign-off (Route A).
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Current Threshold in Rupees
            </label>
            <div className="relative max-w-xs">
              <span className="absolute left-3.5 top-3.5 font-bold text-slate-400">₹</span>
              <input
                type="number"
                min="1000"
                step="500"
                required
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
                className="w-full text-base sm:text-sm pl-8 pr-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-bold"
              />
            </div>
            <span className="text-xs text-indigo-600 font-bold mt-1.5 block">
              Formatted: {formatINR(threshold)}
            </span>
          </div>
        </div>

        {/* Numbering Prefixes Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">Atomic Numbering Prefixes</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Used in generating unique sequential voucher codes (e.g. REQ-2026-000045 & APR-2026-000123).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Request Number Prefix
              </label>
              <input
                type="text"
                required
                value={requestPrefix}
                onChange={(e) => setRequestPrefix(e.target.value.toUpperCase())}
                className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono uppercase"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Example: {requestPrefix}-2026-000001</span>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Approval Number Prefix
              </label>
              <input
                type="text"
                required
                value={approvalPrefix}
                onChange={(e) => setApprovalPrefix(e.target.value.toUpperCase())}
                className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono uppercase"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Example: {approvalPrefix}-2026-000001</span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 transition-all active:scale-98"
        >
          <Save className="w-4 h-4" />
          <span>Save System Settings</span>
        </button>
      </form>
    </div>
  );
};
