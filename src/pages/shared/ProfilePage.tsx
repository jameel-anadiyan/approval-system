import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS, ROLE_BADGES, formatISTDate } from '../../lib/formatters';
import { User, KeyRound, Building2, ShieldCheck, Check, LogOut, ShieldAlert, Camera, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { UserAvatar } from '../../components/common/UserAvatar';
import { PhotoUploadModal } from '../../components/admin/PhotoUploadModal';
import { EditUserModal } from '../../components/admin/EditUserModal';
import { useDirectory } from '../../lib/directory';

export const ProfilePage: React.FC = () => {
  const { user, role, updatePassword, logout, refreshProfile } = useAuth();
  const dir = useDirectory();
  const navigate = useNavigate();

  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 8) {
      setMessage({ text: 'New password must be at least 8 characters long.', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'New passwords do not match.', type: 'error' });
      return;
    }

    setIsUpdating(true);
    try {
      const res = await updatePassword(newPassword);
      if (res.success) {
        setMessage({ text: 'Password successfully changed!', type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ text: res.error || 'Failed to update password.', type: 'error' });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
          User Account Profile
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Manage your login credentials, role assignments, and personal security settings.
        </p>
      </div>

      {/* User Info Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
              <UserAvatar
                photoPath={user?.photo_path}
                name={user?.full_name || 'User'}
                size="xl"
                previewable
                className="shadow-sm"
              />
              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-md border-2 border-white transition-transform active:scale-95"
                title="Change profile photo"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 font-display">{user?.full_name}</h2>
                <button
                  type="button"
                  onClick={() => setPhotoModalOpen(true)}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold underline ml-1"
                >
                  Change photo
                </button>
              </div>
              <p className="text-xs text-slate-500 font-mono">@{user?.username}</p>
              <div className="flex items-center gap-2 mt-2">
                {role && (
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border ${ROLE_BADGES[role]}`}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                )}
                {user?.department && (
                  <span className="text-xs text-slate-600 font-medium flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    {user.department.name} ({user.department.code})
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs self-start sm:self-auto shadow-2xs"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-400" />
            <span>Edit Profile</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 text-xs">
          <div>
            <span className="text-slate-400 font-medium block">Designation</span>
            <span className="font-semibold text-slate-800 mt-0.5 block">
              {user?.designation || 'Not specified'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 font-medium block">Account Status</span>
            <span className="font-semibold text-emerald-700 mt-0.5 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          </div>
          <div>
            <span className="text-slate-400 font-medium block">Created Date</span>
            <span className="font-semibold text-slate-800 mt-0.5 block">
              {formatISTDate(user?.created_at, false)}
            </span>
          </div>
        </div>
      </div>

      {/* Change Password Card */}
      <div id="password" className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
          <KeyRound className="w-4 h-4 text-indigo-600" />
          <span>Change Password</span>
        </h3>

        {message && (
          <div
            className={`p-3.5 rounded-xl text-xs mb-4 flex items-start gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {message.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              New Password
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={isUpdating}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{isUpdating ? 'Updating…' : 'Update Password'}</span>
          </button>
        </form>
      </div>

      {/* Logout Action */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-slate-800">Sign Out of Session</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            End active session on this device securely.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      {photoModalOpen && user && (
        <PhotoUploadModal
          isOpen
          onClose={() => setPhotoModalOpen(false)}
          userId={user.id}
          userName={user.full_name}
          userRole={role ? ROLE_LABELS[role] : undefined}
          currentPhotoPath={user.photo_path}
          onSavePhoto={async (dataUrl) => {
            const res = await dir.setPhoto(user.id, dataUrl);
            if (res.success) {
              await refreshProfile();
              setMessage({ text: 'Profile photo updated successfully!', type: 'success' });
            }
            return res;
          }}
          onRemovePhoto={async () => {
            const res = await dir.removePhoto(user.id);
            if (res.success) {
              await refreshProfile();
              setMessage({ text: 'Profile photo removed.', type: 'success' });
            }
            return res;
          }}
        />
      )}

      {editModalOpen && user && (
        <EditUserModal
          isOpen
          user={user}
          onClose={() => setEditModalOpen(false)}
          onSave={async (input) => {
            const res = await dir.updateUserDetails(user.id, input);
            if (res.success) {
              await refreshProfile();
              setMessage({ text: 'Profile details updated successfully!', type: 'success' });
              setEditModalOpen(false);
            }
            return res;
          }}
        />
      )}
    </div>
  );
};
