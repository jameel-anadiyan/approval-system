import React, { useEffect, useState } from 'react';
import { Settings, Check, Save, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loadThreshold, saveThreshold } from '../../lib/directory';
import { formatINR } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';

export const AdminSettingsPage: React.FC = () => {
  const { isBackendConnected } = useAuth();
  const { reloadThreshold } = useRequests();
  const [threshold, setThreshold] = useState<number>(10000);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    loadThreshold(isBackendConnected).then(setThreshold);
  }, [isBackendConnected]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await saveThreshold(isBackendConnected, threshold);
    if (res.success) await reloadThreshold();
    setSaving(false);
    setFlash(res.success ? { text: 'Threshold saved and recorded in the audit log.', ok: true } : { text: res.error!, ok: false });
    setTimeout(() => setFlash(null), 5000);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-600" />
          <span>Settings</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">Workflow policy. Changes are enforced by the database and logged.</p>
      </div>

      {flash && (
        <div className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border ${
          flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {flash.ok ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{flash.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">High-value threshold (₹)</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Above this amount the Clerk can only route to Admin (Route A). At or below it, the Clerk may pick A or B.
          </p>
        </div>
        <div className="relative max-w-xs">
          <span className="absolute left-3.5 top-3 font-bold text-slate-400">₹</span>
          <input type="number" min="1" step="0.01" inputMode="decimal" required value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
            className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-bold" />
        </div>
        <span className="text-xs text-indigo-600 font-bold block">{formatINR(threshold)}</span>
        <button type="submit" disabled={saving || threshold <= 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 disabled:opacity-50">
          <Save className="w-4 h-4" /><span>{saving ? 'Saving…' : 'Save threshold'}</span>
        </button>
      </form>
    </div>
  );
};
