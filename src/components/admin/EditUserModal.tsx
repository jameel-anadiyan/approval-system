import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Profile } from '../../types/database';
import { UserCheck, ShieldAlert, Loader2 } from 'lucide-react';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: Pick<Profile, 'id' | 'full_name' | 'username' | 'designation'>;
  onSave: (data: {
    full_name: string;
    username: string;
    designation?: string | null;
  }) => Promise<{ success: boolean; error?: string }>;
  title?: string;
  description?: string;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  isOpen,
  onClose,
  user,
  onSave,
  title = 'Edit User',
  description = 'Update full name, username, and designation.',
}) => {
  const [fullName, setFullName] = useState(user.full_name || '');
  const [username, setUsername] = useState(user.username || '');
  const [designation, setDesignation] = useState(user.designation || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setFullName(user.full_name || '');
    setUsername(user.username || '');
    setDesignation(user.designation || '');
    setError(null);
  }, [user.id, user.full_name, user.username, user.designation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fName = fullName.trim();
    if (!fName) {
      setError('Please enter the full name.');
      return;
    }

    const uName = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(uName)) {
      setError('Username must be 3–30 characters using lowercase letters, numbers, dot, dash, or underscore.');
      return;
    }

    setBusy(true);
    try {
      const res = await onSave({
        full_name: fName,
        username: uName,
        designation: designation.trim() || null,
      });
      if (!res.success) {
        setError(res.error || 'Failed to update user details.');
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update user details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} maxWidth="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="edit-full-name" className="block text-xs font-bold text-slate-700 mb-1">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="edit-full-name"
            type="text"
            required
            maxLength={100}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Rahul Sharma"
            className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-medium"
          />
        </div>

        <div>
          <label htmlFor="edit-username" className="block text-xs font-bold text-slate-700 mb-1">
            Username <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-slate-400 font-mono text-sm">@</span>
            <input
              id="edit-username"
              type="text"
              required
              minLength={3}
              maxLength={30}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
              placeholder="username"
              className="w-full text-sm pl-7 pr-3 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">3–30 chars, lowercase letters, numbers, dot, dash, underscore.</p>
        </div>

        <div>
          <label htmlFor="edit-designation" className="block text-xs font-bold text-slate-700 mb-1">
            Designation (Optional)
          </label>
          <input
            id="edit-designation"
            type="text"
            maxLength={100}
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="e.g. Senior Store Manager, Accounts Officer"
            className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-medium"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 disabled:opacity-50 transition-all"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            <span>Save Changes</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
