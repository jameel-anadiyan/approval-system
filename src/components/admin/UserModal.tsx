import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { AppRole, Department, RequestType, Shop } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, ShieldAlert, Camera, Trash2 } from 'lucide-react';
import { AccessFields, rolesWithTypes, validateAccess } from './AccessFields';
import { compressAvatar } from '../../lib/imageUtils';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  departments: Department[];
  shops?: Shop[];
  allowedRoles?: AppRole[];
  onCreateUser: (data: {
    username: string;
    full_name: string;
    designation?: string;
    role: AppRole;
    department_id?: string | null;
    password?: string;
    shop_id?: string | null;
    allowed_types?: RequestType[];
    photo?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  departments,
  shops = [],
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
  const [shopId, setShopId] = useState('');
  const [types, setTypes] = useState<RequestType[]>(['general']);
  const [password, setPassword] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file, 400, 0.85);
      setPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid image file');
    } finally {
      e.target.value = '';
    }
  };

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

    const accessErr = validateAccess(role, shopId, types);
    if (accessErr) {
      setError(accessErr);
      return;
    }
    const withTypes = rolesWithTypes.includes(role);

    setIsSubmitting(true);
    try {
      const res = await onCreateUser({
        username: cleanUsername,
        full_name: fullName.trim(),
        designation: designation.trim() || undefined,
        role,
        department_id: isDepartmentRequired ? departmentId : null,
        password,
        shop_id: withTypes ? shopId || null : null,
        allowed_types: withTypes ? types : undefined,
        photo: photo || undefined,
      });

      if (res.success) {
        setUsername('');
        setFullName('');
        setDesignation('');
        setShopId('');
        setTypes(['general']);
        setPhoto(null);
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

        {/* Employee Profile Photo Selector */}
        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-200 border-2 border-white shadow-xs flex items-center justify-center font-bold text-slate-500 font-display text-lg">
              {photo ? (
                <img src={photo} alt="Avatar Preview" className="w-full h-full object-cover" />
              ) : (
                fullName.trim() ? fullName.trim().charAt(0).toUpperCase() : <Camera className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
              title="Upload photo"
            >
              <Camera className="w-3 h-3" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">Employee Photo</span>
              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Portrait photo for requests &amp; approval sheets.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoSelect}
            />
          </div>
        </div>

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

        <AccessFields
          role={role}
          shops={shops}
          shopId={shopId}
          onShopChange={setShopId}
          types={types}
          onTypesChange={setTypes}
        />

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
