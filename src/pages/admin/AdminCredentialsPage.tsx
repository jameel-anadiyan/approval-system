import React, { useState } from 'react';
import { ShieldCheck, Check, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectory } from '../../lib/directory';
import { CredentialsModal } from '../../components/admin/CredentialsModal';

export const AdminCredentialsPage: React.FC = () => {
  const { user } = useAuth();
  const dir = useDirectory();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-purple-600" />
          <span>My Seal & Signature</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Stamped on every page of A-route requests you approve. PNG only, under 2 MB; stored in a private bucket.
        </p>
      </div>

      {flash && (
        <div className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border ${
          flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {flash.ok ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{flash.text}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{user?.full_name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Upload or replace your seal and signature images.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200">
          Upload seal & signature
        </button>
      </div>

      {open && user && (
        <CredentialsModal
          isOpen
          onClose={() => setOpen(false)}
          userName={user.full_name}
          userRole="Administrator"
          onSaveCredentials={async ({ sealFile, signatureFile }) => {
            for (const [kind, file] of [['seal', sealFile], ['signature', signatureFile]] as const) {
              if (!file) continue;
              const res = await dir.uploadCredential(user.id, kind, file);
              if (!res.success) {
                setFlash({ text: `${kind}: ${res.error}`, ok: false });
                throw new Error(res.error);
              }
            }
            setFlash({ text: 'Seal & signature saved.', ok: true });
          }}
        />
      )}
    </div>
  );
};
