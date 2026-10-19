import React, { useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { UserAvatar } from '../common/UserAvatar';
import { compressAvatar } from '../../lib/imageUtils';
import { Camera, Trash2, Upload, Loader2, Check, AlertCircle } from 'lucide-react';

interface PhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  userRole?: string;
  currentPhotoPath?: string | null;
  onSavePhoto: (dataUrl: string) => Promise<{ success: boolean; error?: string }>;
  onRemovePhoto?: () => Promise<{ success: boolean; error?: string }>;
}

export const PhotoUploadModal: React.FC<PhotoUploadModalProps> = ({
  isOpen,
  onClose,
  userName,
  userRole,
  currentPhotoPath,
  onSavePhoto,
  onRemovePhoto,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setLoading(true);
      const dataUrl = await compressAvatar(file, 500, 0.88);
      setPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setLoading(false);
      // Reset input value so same file can be re-selected if needed
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setError(null);
    setLoading(true);
    try {
      const res = await onSavePhoto(preview);
      if (res.success) {
        onClose();
      } else {
        setError(res.error || 'Failed to save photo');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemovePhoto) return;
    setError(null);
    setLoading(true);
    try {
      const res = await onRemovePhoto();
      if (res.success) {
        onClose();
      } else {
        setError(res.error || 'Failed to remove photo');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Employee Profile Photo"
      description={`Update or remove the identification photo for ${userName}.`}
      maxWidth="sm"
    >
      <div className="space-y-5 text-center">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2 text-left">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Avatar Display / Live Preview */}
        <div className="flex flex-col items-center justify-center pt-2">
          <div className="relative group">
            {preview ? (
              <div className="w-28 h-28 rounded-3xl overflow-hidden ring-4 ring-indigo-500/30 shadow-lg bg-slate-100">
                <img src={preview} alt="New Preview" className="w-full h-full object-cover" />
              </div>
            ) : (
              <UserAvatar
                photoPath={currentPhotoPath}
                name={userName}
                size="2xl"
                border
                className="shadow-lg ring-4 ring-slate-100"
              />
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="absolute -bottom-2 -right-2 w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white flex items-center justify-center shadow-md transition-all border-2 border-white"
              title="Select image"
            >
              <Camera className="w-4 h-4" />
            </button>
          </div>

          <h3 className="font-bold text-slate-900 text-sm mt-3">{userName}</h3>
          {userRole && <p className="text-xs text-slate-500 capitalize">{userRole}</p>}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
          Upload a clear portrait photo. Photos will be automatically centered and scaled for identification on requests.
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {currentPhotoPath && !preview && onRemovePhoto ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleRemove}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Photo</span>
            </button>
          ) : preview ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setPreview(null)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
            >
              Reset
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {!preview ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Choose Photo</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Save Photo</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
