import React, { useEffect, useState } from 'react';
import {
  Settings,
  Check,
  Save,
  ShieldAlert,
  Trash2,
  Loader2,
  AlertTriangle,
  MessageSquare,
  Send,
  CheckCircle2,
  Eye,
  EyeOff,
  Phone,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loadThreshold, saveThreshold } from '../../lib/directory';
import { formatINR } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';
import {
  loadWhatsAppConfig,
  saveWhatsAppConfig,
  sendTestWhatsAppMessage,
  DEFAULT_WHATSAPP_CONFIG,
} from '../../lib/whatsapp';
import type { WhatsAppConfig } from '../../types/database';

export const AdminSettingsPage: React.FC = () => {
  const { isBackendConnected } = useAuth();
  const { reloadThreshold, deleteAllRequests } = useRequests();
  const [threshold, setThreshold] = useState<number>(10000);
  const [saving, setSaving] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  // WhatsApp Configuration State
  const [waConfig, setWaConfig] = useState<WhatsAppConfig>(DEFAULT_WHATSAPP_CONFIG);
  const [savingWa, setSavingWa] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    loadThreshold(isBackendConnected).then(setThreshold);
    loadWhatsAppConfig(isBackendConnected).then(setWaConfig);
  }, [isBackendConnected]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await saveThreshold(isBackendConnected, threshold);
    if (res.success) await reloadThreshold();
    setSaving(false);
    setFlash(
      res.success
        ? { text: 'Threshold saved and recorded in the audit log.', ok: true }
        : { text: res.error!, ok: false }
    );
    setTimeout(() => setFlash(null), 5000);
  };

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWa(true);
    const res = await saveWhatsAppConfig(isBackendConnected, waConfig);
    setSavingWa(false);
    setFlash(
      res.success
        ? { text: 'WhatsApp Cloud API settings saved successfully.', ok: true }
        : { text: res.error || 'Failed to save WhatsApp settings.', ok: false }
    );
    setTimeout(() => setFlash(null), 5000);
  };

  const handleSendTestMessage = async () => {
    if (!testPhone.trim()) {
      setTestResult({ ok: false, message: 'Please enter a WhatsApp mobile number to test.' });
      return;
    }
    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await sendTestWhatsAppMessage(testPhone.trim(), waConfig);
      if (res.success) {
        setTestResult({
          ok: true,
          message: `Test message sent successfully to ${testPhone.trim()}! Please check WhatsApp.`,
        });
      } else {
        setTestResult({
          ok: false,
          message: res.error || 'Failed to deliver test message.',
        });
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSendingTest(false);
    }
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
        <p className="text-xs sm:text-sm text-slate-500 mt-1">Workflow policy, WhatsApp Cloud API notifications, and master settings.</p>
      </div>

      {flash && (
        <div
          className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border ${
            flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {flash.ok ? <Check className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span>{flash.text}</span>
        </div>
      )}

      {/* WhatsApp Cloud API Notification Settings */}
      <form onSubmit={handleSaveWhatsApp} className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="border-b border-slate-100 pb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              <span>WhatsApp Cloud API — Approval Notifications</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              When any document or request is approved, the official approved PDF packet and notification message are automatically delivered to WhatsApp.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>SWA Diamonds ({waConfig.display_phone_number || '+91 80893 04002'})</span>
          </div>
        </div>

        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <div>
            <span className="text-xs font-bold text-slate-800 block">Enable WhatsApp Notifications</span>
            <span className="text-[11px] text-slate-500">
              Deliver stamped approved documents to staff and heads via WhatsApp
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={waConfig.enabled}
              onChange={(e) => setWaConfig({ ...waConfig, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:after:w-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {/* Recipients check boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={waConfig.notify_requester}
              onChange={(e) => setWaConfig({ ...waConfig, notify_requester: e.target.checked })}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-800 block">Notify Requester / Staff</span>
              <span className="text-[10px] text-slate-400">Sends approved PDF to staff who submitted</span>
            </div>
          </label>

          <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={waConfig.notify_head}
              onChange={(e) => setWaConfig({ ...waConfig, notify_head: e.target.checked })}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-800 block">Notify Department Head</span>
              <span className="text-[10px] text-slate-400">Sends approved copy to Department Head</span>
            </div>
          </label>
        </div>

        {/* Access Token */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Meta WhatsApp Access Token <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              required
              value={waConfig.access_token}
              onChange={(e) => setWaConfig({ ...waConfig, access_token: e.target.value })}
              placeholder="EAAzRU40..."
              className="w-full text-xs p-3 pr-10 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Meta Cloud API System User Access Token with whatsapp_business_messaging permission.
          </span>
        </div>

        {/* Phone Number ID & Business ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Phone Number ID <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={waConfig.phone_number_id}
              onChange={(e) => setWaConfig({ ...waConfig, phone_number_id: e.target.value })}
              placeholder="1391767714024374"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden font-mono"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">From WhatsApp Manager → API Setup</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Display Phone Number
            </label>
            <input
              type="text"
              value={waConfig.display_phone_number || ''}
              onChange={(e) => setWaConfig({ ...waConfig, display_phone_number: e.target.value })}
              placeholder="+91 80893 04002"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden font-mono"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">WhatsApp Business Number</span>
          </div>
        </div>

        {/* Admin Notification Copy */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Admin Notification WhatsApp Number (Optional)
          </label>
          <input
            type="tel"
            value={waConfig.admin_phone_number || ''}
            onChange={(e) => setWaConfig({ ...waConfig, admin_phone_number: e.target.value })}
            placeholder="e.g. +91 98765 43210 (receives copy of every approved document)"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden font-mono"
          />
          <span className="text-[10px] text-slate-400 mt-0.5 block">
            If provided, a duplicate copy of all approved document attachments will be sent to this phone number.
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="submit"
            disabled={savingWa}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-emerald-200 disabled:opacity-50 transition-colors"
          >
            {savingWa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{savingWa ? 'Saving WhatsApp Settings…' : 'Save WhatsApp Settings'}</span>
          </button>
        </div>

        {/* Test Connection Box */}
        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>Test WhatsApp Connection &amp; Message Delivery</span>
          </div>
          <p className="text-[11px] text-emerald-800">
            Enter your mobile number to send an immediate live verification WhatsApp message from SWA Diamonds.
          </p>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="relative flex-1 min-w-[200px]">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="e.g. +91 98765 43210 or 9876543210"
                className="w-full text-xs p-2.5 pl-9 rounded-lg border border-slate-200 bg-white focus:border-emerald-500 outline-hidden font-mono"
              />
            </div>
            <button
              type="button"
              onClick={handleSendTestMessage}
              disabled={sendingTest || !testPhone.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-all shrink-0 cursor-pointer"
            >
              {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{sendingTest ? 'Sending…' : 'Send Test WhatsApp'}</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                testResult.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </form>

      {/* Threshold policy form */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">High-value threshold (₹)</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Above this amount the Clerk can only route to Admin (Route A). At or below it, the Clerk may pick A or B.
          </p>
        </div>
        <div className="relative max-w-xs">
          <span className="absolute left-3.5 top-3 font-bold text-slate-400">₹</span>
          <input
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            required
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)}
            className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-display font-bold"
          />
        </div>
        <span className="text-xs text-indigo-600 font-bold block">{formatINR(threshold)}</span>
        <button
          type="submit"
          disabled={saving || threshold <= 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving…' : 'Save threshold'}</span>
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
