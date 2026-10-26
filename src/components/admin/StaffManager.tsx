import React, { useState } from 'react';
import { KeyRound, Stamp, UserPlus, Check, ShieldAlert, Building2, Store, SlidersHorizontal, Percent, LucideIcon, Camera, UserCheck, Tags, Users, Globe, AlertOctagon, Pencil, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectory } from '../../lib/directory';
import { ROLE_BADGES, ROLE_LABELS, TYPE_LABELS } from '../../lib/formatters';
import type { AppRole, Profile } from '../../types/database';
import { UserModal } from './UserModal';
import { EditUserModal } from './EditUserModal';
import { AccessModal, coveringRegionalHeads, rolesWithTypes } from './AccessFields';
import { WorkCategoriesPanel } from './WorkCategoriesPanel';
import { CredentialsModal } from './CredentialsModal';
import { PhotoUploadModal } from './PhotoUploadModal';
import { UserAvatar } from '../common/UserAvatar';
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
  /** Show the department Work Categories panel (clerk split) */
  manageCategories?: boolean;
}

export const StaffManager: React.FC<StaffManagerProps> = ({
  title, subtitle, icon: Icon, roles, addLabel, showCredentials = false, manageCategories = false,
}) => {
  const { user: me } = useAuth();
  const dir = useDirectory();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteBlockReason, setDeleteBlockReason] = useState<string | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [credTarget, setCredTarget] = useState<Profile | null>(null);
  const [photoTarget, setPhotoTarget] = useState<Profile | null>(null);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [accessTarget, setAccessTarget] = useState<Profile | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const show = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 5000);
  };

  const handleDeleteClick = async (u: Profile) => {
    setCheckingDelete(true);
    setBusyId(u.id);
    const res = await dir.checkCanDeleteUser(u.id);
    setBusyId(null);
    setCheckingDelete(false);
    if (!res.canDelete) {
      setDeleteBlockReason(
        res.reason ||
          'This user cannot be deleted because they have associated requests or activity. You can deactivate their account instead.'
      );
      setDeleteTarget(u);
    } else {
      setDeleteBlockReason(null);
      setDeleteTarget(u);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    const res = await dir.deleteUser(target.id);
    setDeleting(false);
    if (res.success) {
      show(`User @${target.username} has been permanently deleted.`);
      setDeleteTarget(null);
      setDeleteBlockReason(null);
    } else {
      show(res.error || 'Failed to delete user.', false);
      setDeleteBlockReason(res.error || 'Failed to delete user.');
    }
  };

  const listed = dir.users.filter(
    (u) => roles.includes(u.role) && (me?.role !== 'head' || u.department_id === me.department_id)
  );
  const shopName = (id: string) => {
    const s = dir.shops.find((x) => x.id === id);
    return s ? s.name : 'Unknown shop';
  };
  const userName = (id?: string | null) => dir.users.find((x) => x.id === id)?.full_name;
  const categoryName = (id: string) => dir.categories.find((c) => c.id === id)?.name ?? 'Unknown';

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

  const toggleWaitlist = async (u: Profile) => {
    setBusyId(u.id);
    const res = await dir.setExhibitionWaitlistAccess(u.id, !u.can_view_exhibition_waitlist);
    setBusyId(null);
    show(
      res.success
        ? `Special Waiting List tab ${u.can_view_exhibition_waitlist ? 'access removed for' : 'opened to'} ${u.full_name}.`
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

      {manageCategories && !dir.loading && (
        <WorkCategoriesPanel
          categories={dir.categories}
          users={dir.users}
          departments={dir.departments}
          fixedDepartmentId={me?.role === 'head' ? me.department_id : null}
          onSave={dir.saveCategory}
        />
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
                  <button
                    type="button"
                    onClick={() => setPhotoTarget(u)}
                    className="relative group shrink-0 rounded-2xl overflow-hidden focus:outline-hidden"
                    title="Click to view or change photo"
                  >
                    <UserAvatar
                      photoPath={u.photo_path}
                      name={u.full_name}
                      size="md"
                      previewable={false}
                      className="group-hover:opacity-90 transition-opacity"
                    />
                    <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <Camera className="w-3.5 h-3.5" />
                    </div>
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-sm truncate">{u.full_name}</span>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${ROLE_BADGES[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                      {u.role === 'disbursement' && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          u.disbursement_type === 'payment_only'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-sky-50 text-sky-800 border-sky-300'
                        }`}>
                          {u.disbursement_type === 'payment_only' ? 'Payment Only' : 'Entry Only'}
                        </span>
                      )}
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
                    <span className="truncate">
                      {u.role === 'regional_head'
                        ? (u.rh_shops || []).length
                          ? (u.rh_shops || []).map((s) => shopName(s.shop_id)).join(', ')
                          : 'No shops assigned'
                        : u.shop ? `${u.shop.name} (${u.shop.code})` : 'No shop'}
                    </span>
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

              {(u.role === 'regional_head' || u.role === 'head') && (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-200/80">
                  <div className="flex items-center gap-1.5 text-xs text-indigo-900 min-w-0">
                    <Globe className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="truncate">
                      Region: <strong>{u.region?.name || dir.regions.find((r) => r.id === u.region_id)?.name || 'Not assigned'}</strong>
                    </span>
                  </div>
                  <select
                    id={`quick-region-${u.id}`}
                    value={u.region_id || ''}
                    disabled={busyId === u.id}
                    onChange={async (e) => {
                      const newReg = e.target.value || null;
                      setBusyId(u.id);
                      const res = await dir.setUserRegion(u.id, newReg);
                      setBusyId(null);
                      show(
                        res.success
                          ? `Region updated for ${u.full_name}.`
                          : res.error || 'Failed to update region',
                        res.success
                      );
                    }}
                    className="text-[11px] font-semibold py-1 px-2 rounded-lg border border-indigo-200 bg-white text-indigo-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 shadow-2xs cursor-pointer"
                  >
                    <option value="">{u.role === 'head' ? 'No Region' : 'Select Region…'}</option>
                    {dir.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {u.role === 'employee' && u.regional_head_id && (
                <div className="flex items-center gap-1.5 text-xs text-cyan-800">
                  <UserCheck className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  <span className="truncate">Regional Head: <strong>{userName(u.regional_head_id) ?? '—'}</strong></span>
                </div>
              )}
              {u.role === 'employee' && u.is_active && !u.regional_head_id &&
                coveringRegionalHeads(dir.users, u.department_id, u.shop_id ?? '').length > 0 && (
                <button
                  type="button"
                  onClick={() => setAccessTarget(u)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5 text-left"
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  Regional Head not assigned — tap to assign
                </button>
              )}

              {(u.role === 'employee' || u.role === 'regional_head') && (
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-600">
                  <Users className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="font-semibold text-slate-700">Heads:</span>
                  {(u.user_heads && u.user_heads.length > 0) ? (
                    u.user_heads.map((uh) => {
                      const hName = userName(uh.head_id) ?? 'Unknown Head';
                      const isDef = uh.is_default || u.default_head_id === uh.head_id;
                      return (
                        <span
                          key={uh.head_id}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isDef
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          {hName} {isDef && '★'}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">None assigned</span>
                  )}
                </div>
              )}

              {u.role === 'clerk' && (u.clerk_cats || []).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <Tags className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  {(u.clerk_cats || []).map((c) => (
                    <span key={c.category_id} className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
                      {categoryName(c.category_id)}
                    </span>
                  ))}
                </div>
              )}

              {u.role === 'disbursement' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-sky-200/80 bg-sky-50/60">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2 text-xs text-sky-950 font-bold">
                      <Wallet className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>Account Type: <strong className={u.disbursement_type === 'payment_only' ? 'text-emerald-700' : 'text-sky-700'}>{u.disbursement_type === 'payment_only' ? 'Payment Only' : 'Entry Only'}</strong></span>
                    </span>
                    <p className="text-[11px] text-sky-800/80 mt-0.5">
                      {u.disbursement_type === 'payment_only'
                        ? 'Can pay amount against each entry (max = entry amount). Cannot create entries.'
                        : 'Can create entries with automatic numbering (1, 2...) & TDS status. Cannot pay.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={busyId === u.id || u.disbursement_type === 'entry_only' || !u.disbursement_type}
                      onClick={async () => {
                        setBusyId(u.id);
                        const res = await dir.setDisbursementType(u.id, 'entry_only');
                        setBusyId(null);
                        show(res.success ? `Updated to Entry Only for ${u.full_name}.` : (res.error || 'Failed to update account type'), res.success);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        u.disbursement_type === 'entry_only' || !u.disbursement_type
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Entry Only
                    </button>
                    <button
                      type="button"
                      disabled={busyId === u.id || u.disbursement_type === 'payment_only'}
                      onClick={async () => {
                        setBusyId(u.id);
                        const res = await dir.setDisbursementType(u.id, 'payment_only');
                        setBusyId(null);
                        show(res.success ? `Updated to Payment Only for ${u.full_name}.` : (res.error || 'Failed to update account type'), res.success);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        u.disbursement_type === 'payment_only'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Payment Only
                    </button>
                  </div>
                </div>
              )}

              {me?.role === 'admin' && u.role === 'head' && (
                <div className="space-y-2">
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

                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-rose-200/80 bg-rose-50/60 cursor-pointer">
                    <span className="flex items-center gap-2 text-xs text-rose-800">
                      <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                      <span><strong>Special Waiting List</strong> Exhibition tab</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      id={`waitlist-access-${u.id}`}
                      aria-checked={!!u.can_view_exhibition_waitlist}
                      disabled={busyId === u.id}
                      onClick={() => toggleWaitlist(u)}
                      className={`relative w-10 h-6 min-h-0 rounded-full transition-colors disabled:opacity-50 ${
                        u.can_view_exhibition_waitlist ? 'bg-rose-600' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        u.can_view_exhibition_waitlist ? 'translate-x-4' : ''
                      }`} />
                    </button>
                  </label>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                {showCredentials && (u.role === 'head' || u.role === 'admin') ? (
                  <button type="button" onClick={() => setCredTarget(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200">
                    <Stamp className="w-3.5 h-3.5" /><span>Seal & Signature</span>
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => setEditTarget(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs"
                    title="Edit name, username, or designation"
                  >
                    <Pencil className="w-3.5 h-3.5 text-slate-400" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoTarget(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs"
                  >
                    <Camera className="w-3.5 h-3.5 text-slate-400" />
                    <span>Photo</span>
                  </button>
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
                  {u.id !== me?.id && (
                    <button
                      type="button"
                      disabled={busyId === u.id || checkingDelete || deleting}
                      onClick={() => handleDeleteClick(u)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-700 font-semibold text-xs disabled:opacity-50"
                      title="Delete user if no requests associated"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      <span>Delete</span>
                    </button>
                  )}
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
          regions={dir.regions}
          users={dir.users}
          categories={dir.categories}
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
          regions={dir.regions}
          users={dir.users}
          categories={dir.categories}
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

      {photoTarget && (
        <PhotoUploadModal
          isOpen
          onClose={() => setPhotoTarget(null)}
          userId={photoTarget.id}
          userName={photoTarget.full_name}
          userRole={ROLE_LABELS[photoTarget.role]}
          currentPhotoPath={photoTarget.photo_path}
          onSavePhoto={async (dataUrl) => {
            const res = await dir.setPhoto(photoTarget.id, dataUrl);
            if (res.success) show(`Photo updated for ${photoTarget.full_name}.`);
            return res;
          }}
          onRemovePhoto={async () => {
            const res = await dir.removePhoto(photoTarget.id);
            if (res.success) show(`Photo removed for ${photoTarget.full_name}.`);
            return res;
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

      {editTarget && (
        <EditUserModal
          isOpen
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (input) => {
            const res = await dir.updateUserDetails(editTarget.id, input);
            if (res.success) {
              show(`User details updated for @${input.username}.`);
              setEditTarget(null);
            }
            return res;
          }}
        />
      )}

      {deleteTarget && (
        <Modal
          isOpen
          onClose={() => { setDeleteTarget(null); setDeleteBlockReason(null); }}
          title={deleteBlockReason ? "Cannot Delete User" : "Delete User Account"}
          description={
            deleteBlockReason
              ? "Deletion is not permitted due to existing request records."
              : `Permanently delete @${deleteTarget.username} (${deleteTarget.full_name})?`
          }
        >
          {deleteBlockReason ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs leading-relaxed flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{deleteBlockReason}</span>
              </div>
              <p className="text-xs text-slate-500">
                Users who have created requests, approved/returned requests, uploaded files, or had payments recorded cannot be removed to preserve complete audit trails. You can <strong>Deactivate</strong> their account instead to revoke login access.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setDeleteTarget(null); setDeleteBlockReason(null); }}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"
                >
                  Understood
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs leading-relaxed flex items-start gap-2.5">
                <Trash2 className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-rose-950">This action cannot be undone.</p>
                  <p className="mt-1 text-rose-800">
                    Since this user has <strong>0 associated requests</strong>, their account profile, login credentials, and assigned role access will be permanently deleted.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => { setDeleteTarget(null); setDeleteBlockReason(null); }}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={confirmDelete}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-xs hover:bg-rose-700 flex items-center gap-2"
                >
                  {deleting ? (
                    <>
                      <LoadingSpinner size="sm" />
                      <span>Deleting…</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Delete User</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
