import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Stamp, Upload, Check, ShieldCheck } from 'lucide-react';

interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  userRole: string;
  onSaveCredentials: (data: { sealFile?: File; signatureFile?: File }) => Promise<void>;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  isOpen,
  onClose,
  userName,
  userRole,
  onSaveCredentials,
}) => {
  const [sealFile, setSealFile] = useState<File | null>(null);
  const [sealPreview, setSealPreview] = useState<string | null>(null);
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [sigPreview, setSigPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSealChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSealFile(file);
      setSealPreview(URL.createObjectURL(file));
    }
  };

  const handleSigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSigFile(file);
      setSigPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSaveCredentials({
        sealFile: sealFile || undefined,
        signatureFile: sigFile || undefined,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Upload Seal & Signature"
      description={`Manage stamping credentials for ${userName} (${userRole})`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
          PNG files with transparent background recommended. These images are stored securely in the
          private credentials bucket and are stamped onto every approved document page.
        </div>

        {/* Seal Upload */}
        <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
          <label className="text-xs font-bold text-slate-800 block mb-1">
            Official Organization / Authority Seal (PNG)
          </label>
          <div className="flex items-center gap-4 mt-2">
            <div className="w-16 h-16 rounded-xl border border-dashed border-indigo-300 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
              {sealPreview ? (
                <img src={sealPreview} alt="Seal preview" className="w-full h-full object-contain p-1" />
              ) : (
                <Stamp className="w-6 h-6 text-indigo-400" />
              )}
            </div>
            <div className="flex-1">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs cursor-pointer shadow-xs">
                <Upload className="w-3.5 h-3.5" />
                <span>{sealFile ? 'Change Seal PNG' : 'Choose Seal PNG'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleSealChange}
                />
              </label>
              <p className="text-[10px] text-slate-400 mt-1">
                {sealFile ? sealFile.name : 'Circular or square stamp (max 2 MB)'}
              </p>
            </div>
          </div>
        </div>

        {/* Signature Upload */}
        <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60">
          <label className="text-xs font-bold text-slate-800 block mb-1">
            Approver Signature (PNG)
          </label>
          <div className="flex items-center gap-4 mt-2">
            <div className="w-24 h-16 rounded-xl border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
              {sigPreview ? (
                <img src={sigPreview} alt="Signature preview" className="w-full h-full object-contain p-1" />
              ) : (
                <span className="text-xs italic font-serif text-slate-400">Sign</span>
              )}
            </div>
            <div className="flex-1">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs cursor-pointer shadow-xs">
                <Upload className="w-3.5 h-3.5" />
                <span>{sigFile ? 'Change Signature' : 'Choose Signature PNG'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleSigChange}
                />
              </label>
              <p className="text-[10px] text-slate-400 mt-1">
                {sigFile ? sigFile.name : 'Clean signature on white or transparent (max 2 MB)'}
              </p>
            </div>
          </div>
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
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Save Credentials</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
