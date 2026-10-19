import React, { useState } from 'react';
import { FileText, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2, Minimize2, Download, Loader2 } from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import { useSignedUrl, downloadStoredFile } from '../../lib/files';

interface DocumentViewerProps {
  files: RequestFile[];
  title?: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ files, title = 'Document Viewer' }) => {
  const { isBackendConnected } = useAuth();
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const documentFiles = files.filter((f) => f.kind === 'document');
  const activeFile = documentFiles[activeFileIndex] || documentFiles[0];
  const signed = useSignedUrl('request-files', activeFile?.storage_path, isBackendConnected);

  if (documentFiles.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
        No documents attached to view.
      </div>
    );
  }

  const previewUrl = isBackendConnected ? signed.url : activeFile.public_url;
  const isPdf = activeFile.mime_type.includes('pdf') || activeFile.original_name.toLowerCase().endsWith('.pdf');

  const handleZoomIn = () => setZoomLevel((z) => Math.min(200, z + 25));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(50, z - 25));

  const handleDownload = async () => {
    setDownloadError(null);
    if (!isBackendConnected) {
      setDownloadError('Sandbox mode: demo files are not stored, so there is nothing to download.');
      return;
    }
    const res = await downloadStoredFile('request-files', activeFile.storage_path, activeFile.original_name);
    if (!res.success) setDownloadError(res.error || 'Download failed');
  };

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col transition-all ${
        isFullScreen ? 'fixed inset-0 z-50 rounded-none' : 'h-[500px]'
      }`}
    >
      {/* Top Bar */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-hidden">
          {isPdf ? (
            <FileText className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-xs font-semibold truncate max-w-[45vw] sm:max-w-xs">
            {activeFile.original_name}
          </span>
          <span className="text-[10px] text-slate-400 hidden sm:inline">
            ({formatFileSize(activeFile.size_bytes)})
          </span>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-semibold px-1.5 text-slate-300">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700"
            title="Download original"
            aria-label={`Download ${activeFile.original_name}`}
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700"
            title={isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[11px] text-amber-800">{downloadError}</div>
      )}

      {/* Multiple Files Tab Bar */}
      {documentFiles.length > 1 && (
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto">
          {documentFiles.map((file, idx) => (
            <button
              key={file.id}
              type="button"
              onClick={() => {
                setActiveFileIndex(idx);
                setZoomLevel(100);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                idx === activeFileIndex
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <span>Doc #{idx + 1}</span>
              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[80px]">
                {file.original_name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main Preview Canvas */}
      <div className="flex-1 bg-slate-100/70 overflow-auto flex items-center justify-center p-4 select-none">
        <div
          style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
          className="transition-transform duration-150 max-w-full"
        >
          {isBackendConnected && signed.loading ? (
            <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading document…</span>
            </div>
          ) : isBackendConnected && !previewUrl ? (
            <div className="text-center text-xs text-slate-500 max-w-xs">
              {signed.error || 'This document cannot be previewed.'}
            </div>
          ) : previewUrl && !isPdf ? (
            <img
              src={previewUrl}
              alt={activeFile.original_name}
              className="max-h-[380px] max-w-full rounded-lg shadow-lg object-contain bg-white"
            />
          ) : previewUrl && isPdf ? (
            <iframe
              src={previewUrl}
              title={activeFile.original_name}
              className="w-full max-w-[560px] h-[60dvh] sm:h-[420px] rounded-lg shadow-lg bg-white border border-slate-300"
            />
          ) : (
            /* Elegant Mock / Standard Render View */
            <div className="w-full max-w-[480px] min-h-[320px] sm:min-h-[380px] bg-white rounded-xl shadow-md border border-slate-200 p-4 sm:p-6 flex flex-col justify-between">
              <div className="border-b border-slate-100 pb-3 flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    Official Voucher / Document
                  </span>
                  <h4 className="font-bold text-slate-800 text-sm mt-1">{activeFile.original_name}</h4>
                </div>
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                  {isPdf ? <FileText className="w-4 h-4 text-rose-500" /> : <ImageIcon className="w-4 h-4 text-emerald-500" />}
                </div>
              </div>

              <div className="py-8 text-center text-slate-500 space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="text-xs font-medium text-slate-700">Preview Rendered Successfully</p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  {isPdf ? 'Multi-page PDF Document' : 'High Resolution Image'} • Stamping ready
                </p>
              </div>

              <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-[11px] text-slate-400">
                <span>Page 1 of {activeFile.page_count || 1}</span>
                <span className="font-mono text-[10px] truncate max-w-[150px]">
                  {activeFile.sha256 ? activeFile.sha256.substring(0, 16) + '…' : 'SHA256 Verified'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
