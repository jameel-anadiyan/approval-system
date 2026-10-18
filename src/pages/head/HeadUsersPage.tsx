import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Profile, AppRole } from '../../types/database';
import { MOCK_USERS, MOCK_DEPARTMENTS } from '../../lib/mockData';
import { UserModal } from '../../components/admin/UserModal';
import { ROLE_LABELS, ROLE_BADGES, formatISTDate } from '../../lib/formatters';
import { Users, UserPlus, KeyRound, Check, ShieldAlert, UserCheck, Shield } from 'lucide-react';

export const HeadUsersPage: React.FC = () => {
  const { user } = useAuth();
  const [usersList, setUsersList] = useState<Profile[]>(() => {
    return MOCK_USERS.filter((u) => u.department_id === user?.department_id);
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateUser = async (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    department_id?: string | null;
    password?: string;
  }) => {
    // A head can only create clerks and employees in their own department
    if (data.role !== 'clerk' && data.role !== 'employee') {
      return { success: false, error: 'A Department Head can only create Clerk and Employee logins.' };
    }

    const newUser: Profile = {
      id: `user-${Date.now()}`,
      username: data.username,
      full_name: data.full_name,
      designation: data.designation || null,
      role: data.role,
      department_id: user?.department_id || 'dept-fin-001',
      is_active: true,
      must_change_password: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      department: user?.department,
    };

    setUsersList((prev) => [newUser, ...prev]);
    setSuccessMsg(`User @${newUser.username} created successfully with temporary password.`);
    setTimeout(() => setSuccessMsg(null), 4000);
    return { success: true };
  };

  const handleResetPassword = (username: string) => {
    alert(`Temporary password reset for @${username}. The user must set a new password on their next login.`);
  };

  const handleToggleActive = (id: string) => {
    setUsersList((prev) =>
      prev.map((u) => (u.id === id ? { ...u, is_active: !u.is_active } : u))
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />
            <span>Department Staff Logins</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage Clerk and Employee accounts assigned to {user?.department?.name || 'your department'}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-md shadow-purple-200 transition-all self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Staff Member</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Users List / Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Active Staff Members ({usersList.length})
          </h2>
        </div>

        <div className="divide-y divide-slate-100">
          {usersList.map((staff) => (
            <div
              key={staff.id}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center font-display text-sm shrink-0">
                  {staff.full_name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{staff.full_name}</span>
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${ROLE_BADGES[staff.role]}`}
                    >
                      {ROLE_LABELS[staff.role]}
                    </span>
                    {!staff.is_active && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                        Deactivated
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    @{staff.username} • {staff.designation || 'Staff'}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleResetPassword(staff.username)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs transition-colors"
                  title="Reset password"
                >
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>Reset Password</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleActive(staff.id)}
                  className={`px-3 py-1.5 rounded-lg font-semibold text-xs border transition-colors ${
                    staff.is_active
                      ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  }`}
                >
                  {staff.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create User Modal */}
      <UserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        departments={MOCK_DEPARTMENTS}
        allowedRoles={['clerk', 'employee']}
        onCreateUser={handleCreateUser}
      />
    </div>
  );
};
