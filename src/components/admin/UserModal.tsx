import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { AppRole, Department, Profile } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, ShieldAlert } from 'lucide-react';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  departments: Department[];
  allowedRoles?: AppRole[];
  onCreateUser: (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    department_id?: string | null;
    password?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  departments,
  allowedRoles = ['head', 'clerk', 'employee', 'disbursement'],
  onCreateUser,
}) => {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<AppRole>(allowedRoles[0] || 'employee');
  const [departmentId, setDepartmentId] = useState<string>(
    user?.department_id || departments[0]?.id || ''
  );
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDepartmentRequired = role === 'head' || role === 'clerk' || role === 'employee';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      setError('Username must be 3–30 characters, lowercase letters, digits, dot, dash, or underscore.');
      return;
    }

    if (password.length < 8) {
      setError('Initial password must be at least 8 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onCreateUser({
        username: cleanUsername,
        full_name: fullName.trim(),
        designation: designation.trim() || undefined,
        role,
        department_id: isDepartmentRequired ? departmentId : null,
        password,
      });

      if (res.success) {
        setUsername('');
        setFullName('');
        setDesignation('');
        onClose();
      } else {
        setError(res.error || 'Failed to create user account.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Staff Account"
      description="Create a new login credential. The user will be required to change their password on first sign in."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Anand Kumar"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Username <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="e.g. anand_k"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
            <span className="absolute right-3 top-3 text-[11px] text-slate-400 font-mono">
              @users
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Used to log in. No email address is exposed to the user.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Portal Role <span className="text-rose-500">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden capitalize bg-white"
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Designation
            </label>
            <input
              type="text"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Senior Officer"
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
            />
          </div>
        </div>

        {isDepartmentRequired && (
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Department <span className="text-rose-500">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={user?.role === 'head'}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white disabled:bg-slate-100"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Initial Temporary Password <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">
            Min 8 characters. Must be changed on first login.
          </span>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create User</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
