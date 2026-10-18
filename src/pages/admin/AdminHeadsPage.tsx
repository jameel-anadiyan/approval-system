import React, { useState } from 'react';
import { Profile, AppRole } from '../../types/database';
import { MOCK_USERS, MOCK_DEPARTMENTS } from '../../lib/mockData';
import { UserModal } from '../../components/admin/UserModal';
import { CredentialsModal } from '../../components/admin/CredentialsModal';
import { Users, UserPlus, KeyRound, Stamp, ShieldCheck, Check, Building2 } from 'lucide-react';
import { formatISTDate } from '../../lib/formatters';

export const AdminHeadsPage: React.FC = () => {
  const [heads, setHeads] = useState<Profile[]>(() =>
    MOCK_USERS.filter((u) => u.role === 'head')
  );
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [credTarget, setCredTarget] = useState<Profile | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateHead = async (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    department_id?: string | null;
    password?: string;
  }) => {
    // Check one active head per department
    const existingActive = heads.find(
      (h) => h.department_id === data.department_id && h.is_active
    );
    if (existingActive) {
      return {
        success: false,
        error: `This department already has an active Head (${existingActive.full_name}). Deactivate the existing Head first.`,
      };
    }

    const dept = MOCK_DEPARTMENTS.find((d) => d.id === data.department_id);

    const newHead: Profile = {
      id: `head-${Date.now()}`,
      username: data.username,
      full_name: data.full_name,
      designation: data.designation || 'Department Head',
      role: 'head',
      department_id: data.department_id || null,
      is_active: true,
      must_change_password: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      department: dept,
    };

    setHeads((prev) => [newHead, ...prev]);
    setSuccessMsg(`Department Head @${newHead.username} created. Please upload their seal & signature.`);
    setTimeout(() => setSuccessMsg(null), 4000);
    return { success: true };
  };

  const handleResetPassword = (username: string) => {
    alert(`Temporary password reset for @${username}. They will be asked to set a new password on login.`);
  };

  const handleToggleActive = (id: string) => {
    setHeads((prev) =>
      prev.map((h) => (h.id === id ? { ...h, is_active: !h.is_active } : h))
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            <span>Department Heads Management</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Appoint active Heads per department and maintain their official digital seals and signatures.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsUserModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Appoint Head</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Heads Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {heads.map((head) => (
          <div
            key={head.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 font-bold flex items-center justify-center font-display text-base">
                    {head.full_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                      {head.full_name}
                    </h3>
                    <span className="text-xs text-slate-500 font-mono block">
                      @{head.username} • {head.designation || 'Head'}
                    </span>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    head.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {head.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {head.department && (
                <div className="mt-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 text-xs text-slate-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span>
                    <strong>{head.department.name}</strong> ({head.department.code})
                  </span>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setCredTarget(head)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200 transition-colors"
              >
                <Stamp className="w-3.5 h-3.5" />
                <span>Seal & Signature</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleResetPassword(head.username)}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs transition-colors"
                  title="Reset password"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleActive(head.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    head.is_active
                      ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      : 'border-emerald-200 text-emerald-700 bg-emerald-50'
                  }`}
                >
                  {head.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <UserModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        departments={MOCK_DEPARTMENTS}
        allowedRoles={['head']}
        onCreateUser={handleCreateHead}
      />

      {credTarget && (
        <CredentialsModal
          isOpen={true}
          onClose={() => setCredTarget(null)}
          userName={credTarget.full_name}
          userRole="Department Head"
          onSaveCredentials={async () => {
            alert(`Official seal and signature updated for ${credTarget.full_name}!`);
          }}
        />
      )}
    </div>
  );
};
