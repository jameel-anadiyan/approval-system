import React, { useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Eye,
  Download,
  Loader2,
  ZoomIn,
  ZoomOut,
  ExternalLink,
} from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import { downloadStoredFile, useSignedUrl } from '../../lib/files';
import { DocumentPreviewModal, DocumentPreviewItem } from './DocumentPreviewModal';

interface DocumentViewerProps {
  files: RequestFile[];
  title?: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  files,
  title = 'Attached Invoices & Documents',
}) => {
  const { isBackendConnected } = useAuth();
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialIndex, setModalInitialIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const documentFiles = files.filter((f) => f.kind === 'document');

  if (documentFiles.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-xs font-medium">
        No documents attached to view.
      </div>
    );
  }

  const activeFile = documentFiles[activeFileIndex] || documentFiles[0];
  const signed = useSignedUrl('request-files', activeFile?.storage_path, isBackendConnected);
  const previewUrl = isBackendConnected ? signed.url : activeFile.public_url;
  const isPdf =
    activeFile.mime_type.includes('pdf') ||
    activeFile.original_name.toLowerCase().endsWith('.pdf');
  const isImage =
    activeFile.mime_type.includes('image') ||
    activeFile.original_name.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/i);

  const handleZoomIn = () => setZoomLevel((z) => Math.min(200, z + 25));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(50, z - 25));

  const handleDownload = async (file: RequestFile) => {
    setDownloadError(null);
    setDownloading(true);
    if (file.storage_path) {
      const res = await downloadStoredFile('request-files', file.storage_path, file.original_name);
      if (!res.success) setDownloadError(res.error || 'Download failed');
    } else if (file.public_url) {
      const a = document.createElement('a');
      a.href = file.public_url;
      a.download = file.original_name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setDownloading(false);
  };

  const previewItems: DocumentPreviewItem[] = documentFiles.map((f) => ({
    id: f.id,
    name: f.original_name,
    storagePath: f.storage_path,
    publicUrl: f.public_url,
    bucket: 'request-files',
    mimeType: f.mime_type,
    sizeBytes: f.size_bytes,
    pageCount: f.page_count,
    badge: f.mime_type.includes('pdf') ? 'PDF' : 'Photo',
  }));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shadow-xs transition-all">
      {/* Top Bar for Small Preview Window */}
      <div className="bg-slate-900 text-white px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              isPdf ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {isPdf ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <span
              className="text-xs font-bold text-slate-100 truncate block max-w-[180px] sm:max-w-xs"
              title={activeFile.original_name}
            >
              {activeFile.original_name}
            </span>
            <span className="text-[10px] text-slate-400 block truncate">
              {formatFileSize(activeFile.size_bytes)}
              {activeFile.page_count ? ` • ${activeFile.page_count} pg` : ''}
              {documentFiles.length > 1
                ? ` • Doc ${activeFileIndex + 1} of ${documentFiles.length}`
                : ''}
            </span>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Zoom controls for small window */}
          <div className="hidden sm:flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold px-1.5 text-slate-300">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Download Original */}
          <button
            type="button"
            onClick={() => handleDownload(activeFile)}
            disabled={downloading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Download document"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Open in New Window */}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition-colors hidden sm:inline-flex"
              title="Open document in new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {/* Prominent Preview Button (Opens the full modal preview with dual scrollbars) */}
          <button
            type="button"
            id="open-full-preview-modal-btn"
            onClick={() => {
              setModalInitialIndex(activeFileIndex);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
            title="Open large preview modal"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[11px] text-amber-800">
          {downloadError}
        </div>
      )}

      {/* Multiple Files Tab Bar */}
      {documentFiles.length > 1 && (
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
          {documentFiles.map((file, idx) => (
            <button
              key={file.id}
              type="button"
              onClick={() => {
                setActiveFileIndex(idx);
                setZoomLevel(100);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                idx === activeFileIndex
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <span>Doc #{idx + 1}</span>
              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[100px]">
                {file.original_name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Small Area Preview Canvas:
          Equipped with .preview-scrollbars providing both vertical scrollbar on right & horizontal scrollbar at bottom! */}
      <div className="preview-scrollbars h-[480px] sm:h-[500px] bg-slate-950 p-2 sm:p-3 select-none flex flex-col items-center justify-start overflow-x-auto overflow-y-auto relative">
        {isBackendConnected && signed.loading ? (
          <div className="h-full min-h-[350px] flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span>Loading document preview…</span>
          </div>
        ) : isBackendConnected && !previewUrl ? (
          <div className="h-full min-h-[350px] flex flex-col items-center justify-center text-center text-xs text-slate-400 p-4">
            <FileText className="w-8 h-8 text-slate-600 mb-2" />
            <p>{signed.error || 'This document cannot be previewed.'}</p>
          </div>
        ) : previewUrl && isPdf ? (
          <div
            style={{
              minWidth: `${Math.max(760, Math.round((zoomLevel / 100) * 820))}px`,
              width: `${Math.max(100, zoomLevel)}%`,
              height: '100%',
              minHeight: '440px',
            }}
            className="mx-auto flex flex-col items-stretch transition-all duration-150"
          >
            <iframe
              src={`${previewUrl}#toolbar=1&navpanes=0`}
              title={activeFile.original_name}
              className="w-full h-full min-h-[440px] border-0 rounded-lg shadow-lg bg-white"
            />
          </div>
        ) : previewUrl && isImage ? (
          <div
            style={{
              minWidth: `${Math.max(520, Math.round((zoomLevel / 100) * 650))}px`,
              width: `${Math.max(100, zoomLevel)}%`,
              minHeight: '100%',
            }}
            className="mx-auto flex items-center justify-center p-2 transition-all duration-150"
          >
            <img
              src={previewUrl}
              alt={activeFile.original_name}
              style={{
                width: `${zoomLevel}%`,
                maxWidth: 'none',
              }}
              className="rounded-lg shadow-lg bg-white object-contain border border-slate-800"
            />
          </div>
        ) : (
          <div className="h-full min-h-[350px] flex flex-col items-center justify-center text-center text-xs text-slate-400 p-4">
            <FileText className="w-8 h-8 text-slate-600 mb-2" />
            <p>Document preview ready</p>
          </div>
        )}
      </div>

      {/* Bottom Bar: Quick link to open large preview */}
      <div className="bg-slate-900 border-t border-slate-800 px-3.5 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-2">
          <span>Scroll right bar (vertical) &amp; bottom bar (horizontal)</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalInitialIndex(activeFileIndex);
            setIsModalOpen(true);
          }}
          className="text-indigo-400 hover:text-indigo-300 font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Click to open large preview</span>
        </button>
      </div>

      {/* Large Full-Screen Modal Preview with Dual Scrollbars (Vertical on Right + Horizontal at Bottom) */}
      <DocumentPreviewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        files={previewItems}
        initialIndex={modalInitialIndex}
        title={title}
      />
    </div>
  );
};
