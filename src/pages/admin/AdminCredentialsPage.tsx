import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Stamp, Upload, Check, ShieldCheck } from 'lucide-react';

export const AdminCredentialsPage: React.FC = () => {
  const { user } = useAuth();
  const [sealFile, setSealFile] = useState<File | null>(null);
  const [sealPreview, setSealPreview] = useState<string | null>(null);
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [sigPreview, setSigPreview] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const handleSealChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSealFile(file);
      setSealPreview(URL.createObjectURL(file));
      setIsSaved(false);
    }
  };

  const handleSigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSigFile(file);
      setSigPreview(URL.createObjectURL(file));
      setIsSaved(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 4000);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-purple-600" />
          <span>Administrator Official Seal & Signature</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          These official graphical assets are permanently stamped onto approved documents, cover sheets, and vouchers.
        </p>
      </div>

      {isSaved && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Official seal and signature credentials successfully saved!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Seal Upload Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Official Organization Seal (PNG)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Circular or emblem seal with transparent background.
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
              Required
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50/30 flex items-center justify-center p-2 shrink-0 overflow-hidden shadow-inner">
              {sealPreview ? (
                <img src={sealPreview} alt="Admin seal preview" className="w-full h-full object-contain" />
              ) : (
                <div className="w-20 h-20 rounded-full border-2 border-purple-600 flex items-center justify-center text-purple-700 text-[10px] font-bold text-center leading-none uppercase p-1">
                  OFFICIAL ADMIN SEAL
                </div>
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs cursor-pointer shadow-md shadow-purple-200 transition-all">
                <Upload className="w-4 h-4" />
                <span>Upload New Seal PNG</span>
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleSealChange} />
              </label>
              <p className="text-[11px] text-slate-400 mt-2">
                Format: PNG or JPG (transparent PNG recommended) • Max 2 MB
              </p>
            </div>
          </div>
        </div>

        {/* Signature Upload Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Administrator Signature (PNG)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Digital pen signature rendered over document footer bands.
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
              Required
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="w-40 h-24 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center p-2 shrink-0 overflow-hidden shadow-inner">
              {sigPreview ? (
                <img src={sigPreview} alt="Signature preview" className="w-full h-full object-contain" />
              ) : (
                <div className="font-display italic text-2xl font-bold text-slate-700 tracking-wider">
                  {user?.full_name?.split(' ')[0] || 'Jameel'}
                </div>
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs cursor-pointer shadow-xs transition-all">
                <Upload className="w-4 h-4" />
                <span>Upload Signature PNG</span>
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleSigChange} />
              </label>
              <p className="text-[11px] text-slate-400 mt-2">
                Clean handwritten signature image with high contrast • Max 2 MB
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 transition-all active:scale-98"
        >
          Save Administrator Credentials
        </button>
      </form>
    </div>
  );
};
