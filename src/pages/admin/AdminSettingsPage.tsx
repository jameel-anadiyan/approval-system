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
  FileText,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loadThreshold, saveThreshold } from '../../lib/directory';
import { formatINR } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';
import {
  loadWhatsAppConfig,
  saveWhatsAppConfig,
  sendTestWhatsAppMessage,
  sendTestWhatsAppTemplate,
  fetchMetaTemplates,
  createMetaApprovalTemplate,
  registerAllMetaTemplates,
  META_TEMPLATES,
  META_TEMPLATE_SPEC,
  DEFAULT_WHATSAPP_CONFIG,
  cleanWhatsAppNumber,
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
  const [testPhone, setTestPhone] = useState('9846880713');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Multi-Template state
  const [templatesMap, setTemplatesMap] = useState<Record<string, { status: string; id?: string; language?: string }>>({});
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('approval_notification');
  const [loadingTemplateStatus, setLoadingTemplateStatus] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [registeringAll, setRegisteringAll] = useState(false);
  const [testingTemplate, setTestingTemplate] = useState(false);
  const [templateTestResult, setTemplateTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  const checkTemplateStatus = async (cfg = waConfig) => {
    setLoadingTemplateStatus(true);
    try {
      const res = await fetchMetaTemplates(cfg);
      if (res.success) {
        const map: Record<string, { status: string; id?: string; language?: string }> = {};
        for (const t of res.templates) {
          // If multiple language variants exist, prefer APPROVED
          if (!map[t.name] || map[t.name].status !== 'APPROVED') {
            map[t.name] = { status: t.status, id: t.id, language: t.language };
          }
        }
        setTemplatesMap(map);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTemplateStatus(false);
    }
  };

  useEffect(() => {
    if (waConfig.access_token && waConfig.phone_number_id) {
      checkTemplateStatus(waConfig);
    }
  }, [waConfig.access_token, waConfig.phone_number_id]);

  const handleRegisterTemplate = async (templateKey: string) => {
    setCreatingTemplate(true);
    try {
      const res = await createMetaApprovalTemplate(waConfig, templateKey);
      if (res.success) {
        setFlash({
          text: `Template "${templateKey}" submitted to Meta WABA (${res.status}).`,
          ok: true,
        });
        await checkTemplateStatus(waConfig);
      } else {
        setFlash({ text: res.error || 'Failed to register template in Meta.', ok: false });
      }
    } catch (e: unknown) {
      setFlash({ text: String(e), ok: false });
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleRegisterAll = async () => {
    setRegisteringAll(true);
    try {
      const res = await registerAllMetaTemplates(waConfig);
      setFlash({
        text: `Submitted standard templates to Meta WABA (${res.registeredCount} active/registered).`,
        ok: true,
      });
      await checkTemplateStatus(waConfig);
    } catch (e: unknown) {
      setFlash({ text: String(e), ok: false });
    } finally {
      setRegisteringAll(false);
    }
  };

  const handleTestTemplate = async (templateKey = selectedTemplateKey) => {
    const target = testPhone.trim() || waConfig.admin_phone_number || '9846880713';
    setTestingTemplate(true);
    setTemplateTestResult(null);
    try {
      const res = await sendTestWhatsAppTemplate(target, templateKey, waConfig);
      if (res.success) {
        setTemplateTestResult({
          ok: true,
          message: `Template "${templateKey}" delivered to ${cleanWhatsAppNumber(target)}! (Message ID: ${res.messageId || 'OK'})`,
        });
      } else {
        setTemplateTestResult({
          ok: false,
          message: res.error || `Failed to deliver template "${templateKey}".`,
        });
      }
    } catch (err: unknown) {
      setTemplateTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingTemplate(false);
    }
  };

  const handleCopyTemplateBody = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 3000);
  };

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
            placeholder="e.g. +91 98468 80713 (receives copy of every approved document)"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-hidden font-mono"
          />
          <span className="text-[10px] text-slate-400 mt-0.5 block">
            If provided, a duplicate copy of all approved document attachments will be sent to this phone number.
          </span>
        </div>

        {/* WhatsApp Multi-Template Configuration Section */}
        <div className="pt-2 border-t border-slate-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-900">Message Templates (Meta WABA UTILITY)</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Pre-approved 24/7 WhatsApp templates for every stage of the request lifecycle.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRegisterAll}
                disabled={registeringAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold transition-colors disabled:opacity-50"
                title="Register or update all 6 templates in Meta WABA"
              >
                {registeringAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>{registeringAll ? 'Syncing…' : 'Sync All in Meta'}</span>
              </button>
              <button
                type="button"
                onClick={() => checkTemplateStatus(waConfig)}
                disabled={loadingTemplateStatus}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
                title="Refresh Meta Template Status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTemplateStatus ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={waConfig.use_template !== false}
              onChange={(e) => setWaConfig({ ...waConfig, use_template: e.target.checked })}
              className="rounded text-emerald-600 focus:ring-emerald-500 mt-0.5"
            />
            <div>
              <span className="text-xs font-bold text-slate-800 block">
                Use Pre-Approved Meta Templates for Outbound Notifications
              </span>
              <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                Recommended for frequent delivery. Messages can be sent 24/7 without Meta&apos;s 24-hour response window restriction. If a template is pending or unapproved, the system automatically falls back to direct message delivery with companion attachments.
              </span>
            </div>
          </label>

          {/* Template Selector Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200/80">
            {Object.entries(META_TEMPLATES).map(([key, def]) => {
              const metaInfo = templatesMap[def.name];
              const isApproved = metaInfo?.status === 'APPROVED';
              const isPending = metaInfo?.status === 'PENDING';
              const isSelected = selectedTemplateKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedTemplateKey(key)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  <span>{def.title}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isApproved ? 'bg-emerald-300' : isPending ? 'bg-amber-300 animate-pulse' : 'bg-slate-300'
                    }`}
                    title={
                      isApproved
                        ? 'Meta Approved'
                        : isPending
                        ? 'Meta Review Pending'
                        : 'Not Registered'
                    }
                  />
                </button>
              );
            })}
          </div>

          {/* Active Template Details Card */}
          {(() => {
            const currentDef = META_TEMPLATES[selectedTemplateKey] || META_TEMPLATE_SPEC;
            const metaInfo = templatesMap[currentDef.name];
            const isApproved = metaInfo?.status === 'APPROVED';
            const isPending = metaInfo?.status === 'PENDING';
            const notRegistered = !metaInfo;

            return (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{currentDef.title}</span>
                      <span className="font-mono text-[11px] text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                        {currentDef.name}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Category: {currentDef.category} · Positional Format ({currentDef.variables.length} parameters)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {isApproved && (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Meta Approved (24/7 Delivery)
                      </span>
                    )}
                    {isPending && (
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Meta Review Pending (Auto-fallback active)
                      </span>
                    )}
                    {notRegistered && (
                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-300">
                        Not Registered
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopyTemplateBody(currentDef.bodyText)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 transition-colors shadow-2xs"
                    >
                      {copiedTemplate ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                      <span>{copiedTemplate ? 'Copied!' : 'Copy Body'}</span>
                    </button>

                    {notRegistered && (
                      <button
                        type="button"
                        onClick={() => handleRegisterTemplate(selectedTemplateKey)}
                        disabled={creatingTemplate}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs disabled:opacity-50 transition-colors"
                      >
                        {creatingTemplate ? 'Submitting…' : 'Register in Meta'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Formatted body preview */}
                <div className="p-3 bg-white rounded-lg border border-slate-200 font-mono text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {currentDef.bodyText}
                </div>

                {/* Positional variables mapping */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px]">
                  {currentDef.variables.map((v) => (
                    <div key={v.num} className="bg-white p-2 rounded-lg border border-slate-200/80">
                      <span className="font-mono font-bold text-emerald-700">{v.num}</span>{' '}
                      <span className="text-slate-600">{v.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSendTestMessage}
                disabled={sendingTest || !testPhone.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-all shrink-0 cursor-pointer"
                title="Send direct freeform test message"
              >
                {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{sendingTest ? 'Sending…' : 'Direct Test'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleTestTemplate(selectedTemplateKey)}
                disabled={testingTemplate || !testPhone.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-all shrink-0 cursor-pointer"
                title={`Send test message using "${selectedTemplateKey}" template`}
              >
                {testingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                <span>{testingTemplate ? 'Sending…' : `Test Template (${(META_TEMPLATES[selectedTemplateKey] || META_TEMPLATE_SPEC).title})`}</span>
              </button>
            </div>
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

          {templateTestResult && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                templateTestResult.ok ? 'bg-indigo-100 text-indigo-900' : 'bg-amber-100 text-amber-900'
              }`}
            >
              {templateTestResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{templateTestResult.message}</span>
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
