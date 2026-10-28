import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { useSignedUrl, downloadStoredFile } from '../../lib/files';
import { Download, ExternalLink, FileCheck, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';

interface SignedDocPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  storagePath: string | null;
  fileName: string;
  approvalNo?: string | null;
}

export const SignedDocPreviewModal: React.FC<SignedDocPreviewModalProps> = ({
  isOpen,
  onClose,
  storagePath,
  fileName,
  approvalNo,
}) => {
  const { isBackendConnected } = useAuth();
  const signed = useSignedUrl('signed-documents', storagePath, isBackendConnected);
  const [downloading, setDownloading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const handleDownload = async () => {
    if (!storagePath || !isBackendConnected) return;
    setDownloading(true);
    await downloadStoredFile('signed-documents', storagePath, fileName);
    setDownloading(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-xs transition-all ${
        isFullScreen ? 'p-0' : ''
      }`}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 transition-all ${
          isFullScreen ? 'w-full h-full rounded-none' : 'w-full max-w-5xl h-[88vh]'
        }`}
      >
        {/* Header Bar */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <FileCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold truncate">{fileName}</h3>
                {approvalNo && (
                  <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded-md">
                    {approvalNo}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Official Stamped Approval Packet · Seal &amp; Digital Verification
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {signed.url && (
              <a
                href={signed.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                title="Open in new window"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden sm:inline">New Tab</span>
              </a>
            )}

            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || !signed.url}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
              title="Download PDF"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullScreen((f) => !f)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/50 hover:text-rose-200 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-slate-100 relative overflow-hidden flex flex-col items-center justify-center">
          {signed.loading ? (
            <div className="flex flex-col items-center gap-3 p-8 text-slate-500">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-xs font-medium">Loading signed document preview…</p>
            </div>
          ) : !isBackendConnected ? (
            <div className="max-w-md p-6 bg-white border border-slate-200 rounded-2xl text-center space-y-2 shadow-xs">
              <FileCheck className="w-8 h-8 text-slate-400 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">Sandbox Preview Mode</h4>
              <p className="text-xs text-slate-500">
                In local sandbox mode, signed approval PDFs are generated by the live server.
              </p>
            </div>
          ) : signed.error || !signed.url ? (
            <div className="max-w-md p-6 bg-white border border-rose-200 rounded-2xl text-center space-y-3 shadow-xs">
              <p className="text-xs text-rose-600 font-medium">{signed.error || 'Failed to generate preview URL'}</p>
              <button
                type="button"
                onClick={handleDownload}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
              >
                Try Direct Download
              </button>
            </div>
          ) : (
            <iframe
              src={`${signed.url}#toolbar=1&navpanes=0`}
              title={fileName}
              className="w-full h-full border-0 bg-slate-50"
            />
          )}
        </div>
      </div>
    </div>
  );
};
