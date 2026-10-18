import React, { useState } from 'react';
import { Profile, AppRole } from '../../types/database';
import { MOCK_USERS, MOCK_DEPARTMENTS } from '../../lib/mockData';
import { UserModal } from '../../components/admin/UserModal';
import { Wallet, UserPlus, KeyRound, Check } from 'lucide-react';
import { formatISTDate } from '../../lib/formatters';

export const AdminDisbursementPage: React.FC = () => {
  const [users, setUsers] = useState<Profile[]>(() =>
    MOCK_USERS.filter((u) => u.role === 'disbursement')
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateUser = async (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    password?: string;
  }) => {
    const newUser: Profile = {
      id: `disb-${Date.now()}`,
      username: data.username,
      full_name: data.full_name,
      designation: data.designation || 'Treasury / Cashier',
      role: 'disbursement',
      department_id: null,
      is_active: true,
      must_change_password: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setUsers((prev) => [newUser, ...prev]);
    setSuccessMsg(`Disbursement user @${newUser.username} created successfully.`);
    setTimeout(() => setSuccessMsg(null), 4000);
    return { success: true };
  };

  const handleResetPassword = (username: string) => {
    alert(`Password reset for @${username}. Temporary password must be changed on next login.`);
  };

  const handleToggleActive = (id: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, is_active: !u.is_active } : u))
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Wallet className="w-6 h-6 text-teal-600" />
            <span>Disbursement & Cashier Logins</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Staff authorized to disburse funds, inspect signed vouchers, and record payment references.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-md shadow-teal-200 transition-all self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Cashier Login</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {users.map((staff) => (
          <div
            key={staff.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 font-bold flex items-center justify-center font-display text-base">
                  {staff.full_name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    {staff.full_name}
                  </h3>
                  <span className="text-xs text-slate-500 font-mono block">
                    @{staff.username} • {staff.designation}
                  </span>
                </div>
              </div>

              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  staff.is_active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {staff.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Created {formatISTDate(staff.created_at, false)}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleResetPassword(staff.username)}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                  title="Reset password"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleActive(staff.id)}
                  className={`px-3 py-1 rounded-lg font-semibold text-xs transition-colors border ${
                    staff.is_active
                      ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      : 'border-emerald-200 text-emerald-700 bg-emerald-50'
                  }`}
                >
                  {staff.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <UserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        departments={MOCK_DEPARTMENTS}
        allowedRoles={['disbursement']}
        onCreateUser={handleCreateUser}
      />
    </div>
  );
};
