import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSignedUrl } from '../../lib/files';
import { User, ZoomIn, X } from 'lucide-react';

interface UserAvatarProps {
  photoPath?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  shape?: 'circle' | 'rounded';
  className?: string;
  previewable?: boolean;
  border?: boolean;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-28 h-28 text-4xl',
};

const INITIAL_BG_GRADIENTS = [
  'from-teal-600 to-emerald-700 text-white',
  'from-cyan-600 to-teal-700 text-white',
  'from-slate-700 to-slate-900 text-white',
  'from-indigo-600 to-blue-700 text-white',
  'from-amber-600 to-amber-800 text-white',
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % INITIAL_BG_GRADIENTS.length;
  return INITIAL_BG_GRADIENTS[idx];
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  photoPath,
  name,
  size = 'md',
  shape = 'rounded',
  className = '',
  previewable = false,
  border = true,
}) => {
  const { isBackendConnected } = useAuth();
  const signed = useSignedUrl('profile-photos', photoPath, isBackendConnected);
  const [modalOpen, setModalOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const roundedClass = shape === 'circle' ? 'rounded-full' : size === '2xl' || size === 'xl' ? 'rounded-3xl' : 'rounded-2xl';
  const borderClass = border ? 'ring-2 ring-white/80 shadow-xs' : '';
  const initial = name?.trim() ? name.trim().charAt(0).toUpperCase() : '?';
  const gradient = getGradient(name || 'user');

  const photoUrl = !imgError && signed.url ? signed.url : null;

  return (
    <>
      <div
        className={`relative shrink-0 select-none overflow-hidden flex items-center justify-center font-bold font-display tracking-tight transition-transform ${
          SIZE_MAP[size]
        } ${roundedClass} ${borderClass} ${
          photoUrl ? 'bg-slate-100' : `bg-linear-to-br ${gradient}`
        } ${previewable && photoUrl ? 'cursor-pointer hover:opacity-95 hover:scale-102 active:scale-98' : ''} ${className}`}
        onClick={() => {
          if (previewable && photoUrl) setModalOpen(true);
        }}
        title={previewable && photoUrl ? `Click to view ${name}'s photo` : name}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initial}</span>
        )}

        {previewable && photoUrl && (
          <div className="absolute inset-0 bg-black/20 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-white">
            <ZoomIn className="w-3.5 h-3.5 drop-shadow-md" />
          </div>
        )}
      </div>

      {/* Full Photo Modal */}
      {modalOpen && photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative max-w-sm sm:max-w-md w-full bg-slate-900 rounded-3xl p-4 border border-slate-700 shadow-2xl text-center space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 pt-1">
              <div className="text-left min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{name}</h4>
                <p className="text-[11px] text-slate-400">Employee Profile Photo</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-square w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner">
              <img
                src={photoUrl}
                alt={name}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
