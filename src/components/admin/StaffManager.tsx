import React, { useState } from 'react';
import { KeyRound, Stamp, UserPlus, Check, ShieldAlert, Building2, Store, SlidersHorizontal, Percent, LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectory } from '../../lib/directory';
import { ROLE_BADGES, ROLE_LABELS, TYPE_LABELS } from '../../lib/formatters';
import type { AppRole, Profile } from '../../types/database';
import { UserModal } from './UserModal';
import { AccessModal, rolesWithTypes } from './AccessFields';
import { CredentialsModal } from './CredentialsModal';
import { Modal } from '../common/Modal';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface StaffManagerProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Roles listed and creatable on this screen */
  roles: AppRole[];
  addLabel: string;
  /** Admin-only: manage seal & signature for listed users */
  showCredentials?: boolean;
}

export const StaffManager: React.FC<StaffManagerProps> = ({
  title, subtitle, icon: Icon, roles, addLabel, showCredentials = false,
}) => {
  const { user: me } = useAuth();
  const dir = useDirectory();
  const [createOpen, setCreateOpen] = useState(false);
  const [credTarget, setCredTarget] = useState<Profile | null>(null);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [accessTarget, setAccessTarget] = useState<Profile | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const show = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 5000);
  };

  const listed = dir.users.filter(
    (u) => roles.includes(u.role) && (me?.role !== 'head' || u.department_id === me.department_id)
  );

  const toggleActive = async (u: Profile) => {
    setBusyId(u.id);
    const res = await dir.setActive(u.id, !u.is_active);
    setBusyId(null);
    show(res.success ? `@${u.username} ${u.is_active ? 'deactivated' : 'activated'}.` : res.error!, res.success);
  };

  const toggleReport = async (u: Profile) => {
    setBusyId(u.id);
    const res = await dir.setDiscountReportAccess(u.id, !u.can_view_discount_report);
    setBusyId(null);
    show(
      res.success
        ? `Discount Report ${u.can_view_discount_report ? 'access removed for' : 'opened to'} ${u.full_name}.`
        : res.error!,
      res.success
    );
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    const res = await dir.resetPassword(resetTarget.id, resetPw);
    if (res.success) {
      show(`Temporary password set for @${resetTarget.username}. They must change it at next login.`);
      setResetTarget(null);
      setResetPw('');
    } else {
      show(res.error!, false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Icon className="w-6 h-6 text-indigo-600" />
            <span>{title}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>{addLabel}</span>
        </button>
      </div>

      {flash && (
        <div className={`p-3.5 text-xs rounded-xl flex items-start gap-2 border ${
          flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {flash.ok ? <Check className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span>{flash.text}</span>
        </div>
      )}

      {dir.loading ? (
        <LoadingSpinner label="Loading users…" />
      ) : listed.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No users yet. Use “{addLabel}” to create the first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {listed.map((u) => (
            <div key={u.id} className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center font-display shrink-0">
                    {u.full_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-sm truncate">{u.full_name}</span>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${ROLE_BADGES[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 font-mono block truncate">
                      @{u.username}{u.designation ? ` • ${u.designation}` : ''}
                    </span>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                  u.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {u.department && (
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 text-xs text-slate-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span><strong>{u.department.name}</strong> ({u.department.code})</span>
                </div>
              )}

              {rolesWithTypes.includes(u.role) && (
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600 min-w-0">
                    <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{u.shop ? `${u.shop.name} (${u.shop.code})` : 'No shop'}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {(u.allowed_types?.length ? u.allowed_types : ['general' as const]).map((t) => (
                      <span key={t} className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-brand-200 bg-brand-50 text-brand-700">
                        {TYPE_LABELS[t]}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {me?.role === 'admin' && u.role === 'head' && (
                <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/60 cursor-pointer">
                  <span className="flex items-center gap-2 text-xs text-slate-700">
                    <Percent className="w-3.5 h-3.5 text-brand-600" />
                    <span><strong>Discount Report</strong> access</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    id={`report-access-${u.id}`}
                    aria-checked={!!u.can_view_discount_report}
                    disabled={busyId === u.id}
                    onClick={() => toggleReport(u)}
                    className={`relative w-10 h-6 min-h-0 rounded-full transition-colors disabled:opacity-50 ${
                      u.can_view_discount_report ? 'bg-brand-600' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      u.can_view_discount_report ? 'translate-x-4' : ''
                    }`} />
                  </button>
                </label>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                {showCredentials && (u.role === 'head' || u.role === 'admin') ? (
                  <button type="button" onClick={() => setCredTarget(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200">
                    <Stamp className="w-3.5 h-3.5" /><span>Seal & Signature</span>
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {rolesWithTypes.includes(u.role) && (
                    <button type="button" id={`access-${u.id}`} onClick={() => setAccessTarget(u)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" /><span>Access</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setResetTarget(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" /><span>Reset password</span>
                  </button>
                  <button type="button" disabled={busyId === u.id} onClick={() => toggleActive(u)}
                    className={`px-3 py-1.5 rounded-lg font-semibold text-xs border disabled:opacity-50 ${
                      u.is_active
                        ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                        : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    }`}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <UserModal
          isOpen
          onClose={() => setCreateOpen(false)}
          departments={dir.departments.filter((d) => d.is_active)}
          shops={dir.shops}
          allowedRoles={roles}
          onCreateUser={async (input) => {
            const res = await dir.createUser(input);
            if (res.success) show(`@${input.username} created. They must change the temporary password at first login.`);
            return res;
          }}
        />
      )}

      {accessTarget && (
        <AccessModal
          target={accessTarget}
          shops={dir.shops}
          onClose={() => setAccessTarget(null)}
          onSave={async (access) => {
            const res = await dir.updateAccess(accessTarget.id, access);
            if (res.success) show(`Access updated for @${accessTarget.username}.`);
            return res;
          }}
        />
      )}

      {credTarget && (
        <CredentialsModal
          isOpen
          onClose={() => setCredTarget(null)}
          userName={credTarget.full_name}
          userRole={ROLE_LABELS[credTarget.role]}
          onSaveCredentials={async ({ sealFile, signatureFile }) => {
            for (const [kind, file] of [['seal', sealFile], ['signature', signatureFile]] as const) {
              if (!file) continue;
              const res = await dir.uploadCredential(credTarget.id, kind, file);
              if (!res.success) {
                show(`${kind}: ${res.error}`, false);
                throw new Error(res.error);
              }
            }
            show(`Seal & signature saved for ${credTarget.full_name}.`);
          }}
        />
      )}

      {resetTarget && (
        <Modal isOpen onClose={() => setResetTarget(null)} title="Reset password"
          description={`Set a temporary password for @${resetTarget.username}`}>
          <form onSubmit={submitReset} className="space-y-4">
            <input type="text" required minLength={8} value={resetPw} onChange={(e) => setResetPw(e.target.value)}
              placeholder="Temporary password (8+ chars, letters & digits)"
              className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs">Cancel</button>
              <button type="submit" className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs">Set password</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
