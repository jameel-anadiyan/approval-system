import React, { useEffect, useState } from 'react';
import { Settings, Check, Save, ShieldAlert, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loadThreshold, saveThreshold } from '../../lib/directory';
import { formatINR } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';

export const AdminSettingsPage: React.FC = () => {
  const { isBackendConnected } = useAuth();
  const { reloadThreshold, deleteAllRequests } = useRequests();
  const [threshold, setThreshold] = useState<number>(10000);
  const [saving, setSaving] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
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

  const handleDeleteAllRequests = async () => {
    if (!confirm('Are you ABSOLUTELY sure you want to DELETE ALL REQUESTS? This action is permanent and cannot be undone.')) {
      return;
    }
    const check = prompt('Type DELETE to permanently erase all requests and reset counters:');
    if (check !== 'DELETE') {
      alert('Deletion cancelled: confirmation word did not match.');
      return;
    }
    setDeletingAll(true);
    const res = await deleteAllRequests();
    setDeletingAll(false);
    if (res.success) {
      setFlash({ text: 'All requests deleted successfully. Sequence numbers reset to 000001.', ok: true });
    } else {
      setFlash({ text: res.error || 'Failed to delete requests', ok: false });
    }
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

      {/* Danger Zone: Delete All Requests */}
      <div className="bg-rose-50/70 border border-rose-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="border-b border-rose-200/60 pb-3 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-rose-950">Danger Zone: Delete All Requests</h3>
            <p className="text-xs text-rose-700 mt-0.5 leading-relaxed">
              Permanently erase all operational requests, quotations, disbursement entries, approvals, and actions.
              Numbering counters will restart fresh at <span className="font-semibold font-mono">REQ-2026-000001</span>.
              Your user accounts, departments, and shops will remain safe and untouched.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={deletingAll}
          onClick={handleDeleteAllRequests}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-md shadow-rose-200 disabled:opacity-50 transition-colors"
        >
          {deletingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          <span>{deletingAll ? 'Deleting All Requests…' : 'Delete All Requests'}</span>
        </button>
      </div>
    </div>
  );
};
