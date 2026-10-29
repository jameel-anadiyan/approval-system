import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSignedUrl, downloadStoredFile, Bucket } from '../../lib/files';
import { formatFileSize } from '../../lib/formatters';
import {
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from 'lucide-react';
import { ZoomMultiplierControls, useDocumentMouseFollow } from './ZoomMultiplierControls';

export interface DocumentPreviewItem {
  id?: string;
  name: string;
  storagePath?: string | null;
  publicUrl?: string | null;
  bucket?: Bucket;
  mimeType?: string;
  sizeBytes?: number;
  pageCount?: number | null;
  badge?: string;
}

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: DocumentPreviewItem[];
  initialIndex?: number;
  title?: string;
  approvalNo?: string | null;
  onDeleteFile?: (file: DocumentPreviewItem) => Promise<boolean | void> | boolean | void;
  canDelete?: boolean;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  onClose,
  files,
  initialIndex = 0,
  title,
  approvalNo,
  onDeleteFile,
  canDelete = false,
}) => {
  const { isBackendConnected } = useAuth();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [multiplier, setMultiplier] = useState(1);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    containerRef: canvasRef,
    mouseFollowEnabled,
    setMouseFollowEnabled,
    handleMouseMove,
  } = useDocumentMouseFollow({ multiplier });

  // Sync activeIndex whenever modal opens or initialIndex changes
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(Math.max(0, Math.min(initialIndex, files.length - 1)));
      setMultiplier(1);
    }
  }, [isOpen, initialIndex, files.length]);

  const current = files[activeIndex] || files[0];
  const bucket: Bucket = current?.bucket || 'request-files';
  const signed = useSignedUrl(bucket, current?.storagePath || null, isBackendConnected);

  // URL resolution priority:
  // 1. Direct public/blob URL if provided
  // 2. Resolved signed URL (Supabase or blob/data)
  // 3. Fallback to storagePath if it starts with blob:/http
  const resolvedUrl =
    (current?.publicUrl && (current.publicUrl.startsWith('blob:') || current.publicUrl.startsWith('http') || current.publicUrl.startsWith('data:')))
      ? current.publicUrl
      : isBackendConnected
      ? signed.url
      : current?.publicUrl || null;

  const fileName = current?.name || 'document';
  const isPdf =
    (current?.mimeType && current.mimeType.includes('pdf')) ||
    fileName.toLowerCase().endsWith('.pdf');
  const isImage =
    (current?.mimeType && (current.mimeType.includes('image') || current.mimeType.includes('jpeg') || current.mimeType.includes('png'))) ||
    fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/i);

  const handleDownload = async () => {
    if (!current) return;
    setDownloading(true);
    if (current.storagePath) {
      await downloadStoredFile(bucket, current.storagePath, fileName);
    } else if (resolvedUrl) {
      const a = document.createElement('a');
      a.href = resolvedUrl;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setDownloading(false);
  };

  const handleDeleteDoc = async () => {
    if (!current || !onDeleteFile) return;
    if (!window.confirm(`Delete "${fileName}"? This will remove this attachment.`)) return;
    setDeleting(true);
    try {
      const res = await onDeleteFile(current);
      if (res !== false) {
        if (files.length <= 1) {
          onClose();
        } else {
          setActiveIndex((prev) => Math.max(0, Math.min(prev, files.length - 2)));
        }
      }
    } finally {
      setDeleting(false);
    }
  };

  const handlePrevDoc = useCallback(() => {
    if (files.length <= 1) return;
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : files.length - 1));
    setMultiplier(1);
  }, [files.length]);

  const handleNextDoc = useCallback(() => {
    if (files.length <= 1) return;
    setActiveIndex((prev) => (prev < files.length - 1 ? prev + 1 : 0));
    setMultiplier(1);
  }, [files.length]);

  // Keyboard navigation: Escape to close, Arrows to navigate documents, 1-5 for zoom multipliers
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && files.length > 1) {
        handlePrevDoc();
      } else if (e.key === 'ArrowRight' && files.length > 1) {
        handleNextDoc();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        setMultiplier(parseInt(e.key, 10));
      } else if (e.key === '+' || e.key === '=') {
        setMultiplier((m) => Math.min(5, m + 1));
      } else if (e.key === '-') {
        setMultiplier((m) => Math.max(1, m - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, files.length, handlePrevDoc, handleNextDoc, onClose]);

  if (!isOpen || !current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || fileName}
      className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-xs transition-all ${
        isFullScreen ? 'p-0' : ''
      }`}
    >
      <div
        className={`bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700/80 transition-all ${
          isFullScreen ? 'w-full h-full rounded-none' : 'w-full max-w-6xl h-[92vh]'
        }`}
      >
        {/* Top Header Bar */}
        <div className="bg-slate-900 border-b border-slate-800 text-white px-3 sm:px-5 py-3 flex items-center justify-between gap-3 shrink-0">
          {/* File Information & Icon */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                approvalNo
                  ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40'
                  : isPdf
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
              }`}
            >
              {approvalNo ? (
                <FileCheck className="w-4 h-4" />
              ) : isPdf ? (
                <FileText className="w-4 h-4" />
              ) : (
                <ImageIcon className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate" title={fileName}>
                  {fileName}
                </h3>
                {approvalNo && (
                  <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded-md shrink-0">
                    {approvalNo}
                  </span>
                )}
                {current.badge && (
                  <span className="text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded-md shrink-0">
                    {current.badge}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                {current.sizeBytes && <span>{formatFileSize(current.sizeBytes)}</span>}
                {current.pageCount && <span>• {current.pageCount} pg</span>}
                <span>
                  {approvalNo
                    ? '• Official Stamped Packet'
                    : '• Original Review Document'}
                </span>
                {files.length > 1 && (
                  <span className="text-indigo-400 font-semibold">
                    ({activeIndex + 1} of {files.length})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Top Multiplier Zoom Buttons (1x, 2x, 3x, 4x, 5x) */}
            <div className="hidden sm:flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-slate-700/80 gap-0.5">
              <span className="text-[10px] font-bold text-slate-400 px-1.5 hidden md:inline">
                Zoom:
              </span>
              {[1, 2, 3, 4, 5].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMultiplier(m)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold font-mono transition-colors cursor-pointer ${
                    multiplier === m
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                  title={`Zoom ${m}x`}
                >
                  {m}x
                </button>
              ))}
              {multiplier > 1 && (
                <button
                  type="button"
                  onClick={() => setMultiplier(1)}
                  className="p-1 hover:bg-slate-700 text-amber-400 rounded transition-colors ml-0.5"
                  title="Reset to 1x"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Prev / Next Document navigation buttons (if multiple) */}
            {files.length > 1 && (
              <div className="flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-slate-700/80">
                <button
                  type="button"
                  onClick={handlePrevDoc}
                  className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors"
                  title="Previous document (Left Arrow)"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextDoc}
                  className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors"
                  title="Next document (Right Arrow)"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Open in New Window */}
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                title="Open document in new browser tab"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                <span className="hidden md:inline">New Tab</span>
              </a>
            )}

            {/* Direct Download */}
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || (!resolvedUrl && !current.storagePath)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              title="Download file"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Download</span>
            </button>

            {/* Delete Attachment Button */}
            {(onDeleteFile || canDelete) && (
              <button
                type="button"
                onClick={handleDeleteDoc}
                disabled={deleting}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                title="Delete this attachment"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete'}</span>
              </button>
            )}

            {/* Full Screen Toggle */}
            <button
              type="button"
              onClick={() => setIsFullScreen((f) => !f)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-200 hover:border-rose-800 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
              title="Close preview (Esc)"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>

        {/* Multi-Document Tab Bar (when multiple files attached) */}
        {files.length > 1 && (
          <div className="bg-slate-950 border-b border-slate-800 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
            {files.map((file, idx) => {
              const active = idx === activeIndex;
              const fIsPdf =
                (file.mimeType && file.mimeType.includes('pdf')) ||
                file.name.toLowerCase().endsWith('.pdf');
              return (
                <button
                  key={file.id || `${file.name}-${idx}`}
                  type="button"
                  onClick={() => {
                    setActiveIndex(idx);
                    setMultiplier(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  {fIsPdf ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
                  <span>Doc #{idx + 1}</span>
                  <span className={`text-[10px] font-mono truncate max-w-[130px] ${active ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {file.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Scrollable Preview Canvas:
            Dually scrollable with vertical scrollbar on the right AND horizontal scrollbar at the bottom!
            Uses .preview-scrollbars with overflow-x: scroll and overflow-y: scroll.
            When multiplier > 1, moving mouse glides document automatically according to cursor position. */}
        <div
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          className="preview-scrollbars flex-1 w-full bg-slate-950 p-2 sm:p-4 select-none relative overflow-x-auto overflow-y-auto"
        >
          {signed.loading ? (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-xs font-semibold">Loading document preview…</p>
            </div>
          ) : !resolvedUrl && !current.storagePath ? (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <FileText className="w-10 h-10 text-slate-600 mb-2" />
              <p className="text-xs font-semibold text-slate-300">Preview not available</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-1">
                This file does not have a preview URL. Use the Download button above to view it.
              </p>
            </div>
          ) : resolvedUrl && isPdf ? (
            /* PDF Document Canvas with horizontal + vertical scroll container */
            <div
              style={{
                minWidth: `${Math.max(820, multiplier * 880)}px`,
                width: `${multiplier * 100}%`,
                height: multiplier > 1 ? `${multiplier * 100}%` : '100%',
                minHeight: `${Math.max(740, multiplier * 700)}px`,
              }}
              className="relative mx-auto flex flex-col items-stretch transition-all duration-150"
            >
              <iframe
                src={`${resolvedUrl}#toolbar=1&navpanes=0`}
                title={fileName}
                className="w-full h-full min-h-[740px] border-0 rounded-xl shadow-2xl bg-white"
              />
              {/* Transparent overlay over iframe to capture smooth mouse panning when zoomed in */}
              {multiplier > 1 && mouseFollowEnabled && (
                <div
                  className="absolute inset-0 z-10 cursor-move bg-transparent"
                  onMouseMove={handleMouseMove}
                  title="Mouse Follow is active: move your mouse to glide through the zoomed document"
                />
              )}
            </div>
          ) : resolvedUrl && isImage ? (
            /* Image Canvas with horizontal + vertical scroll container */
            <div
              style={{
                minWidth: `${Math.max(600, multiplier * 750)}px`,
                width: `${multiplier * 100}%`,
                minHeight: '100%',
              }}
              className="relative mx-auto flex items-center justify-center p-2 transition-all duration-150"
              onMouseMove={handleMouseMove}
            >
              <img
                src={resolvedUrl}
                alt={fileName}
                style={{
                  width: `${multiplier * 100}%`,
                  maxWidth: 'none',
                }}
                className="rounded-xl shadow-2xl bg-white object-contain border border-slate-800"
              />
            </div>
          ) : resolvedUrl ? (
            /* General Document Fallback Canvas */
            <div
              style={{
                minWidth: `${Math.max(760, multiplier * 850)}px`,
                width: `${multiplier * 100}%`,
                height: multiplier > 1 ? `${multiplier * 100}%` : '100%',
                minHeight: `${Math.max(680, multiplier * 640)}px`,
              }}
              className="relative mx-auto flex flex-col items-stretch"
            >
              <iframe
                src={resolvedUrl}
                title={fileName}
                className="w-full h-full min-h-[680px] border-0 rounded-xl shadow-2xl bg-white"
              />
              {multiplier > 1 && mouseFollowEnabled && (
                <div
                  className="absolute inset-0 z-10 cursor-move bg-transparent"
                  onMouseMove={handleMouseMove}
                />
              )}
            </div>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center p-6 text-center space-y-3">
              <p className="text-xs text-rose-400 font-semibold">{signed.error || 'Failed to generate preview URL'}</p>
              <button
                type="button"
                onClick={handleDownload}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer"
              >
                Download Document Directly
              </button>
            </div>
          )}

          {/* Floating Transparent Zoom Multiplier Controls & Mouse Follow Toggle */}
          {resolvedUrl && (
            <ZoomMultiplierControls
              multiplier={multiplier}
              onSelectMultiplier={setMultiplier}
              mouseFollowEnabled={mouseFollowEnabled}
              onToggleMouseFollow={() => setMouseFollowEnabled((f) => !f)}
            />
          )}
        </div>

        {/* Bottom Helper Bar */}
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-3">
            <span>Scroll bars available (horizontal &amp; vertical).</span>
            {multiplier > 1 ? (
              <span className="text-indigo-400 font-bold flex items-center gap-1.5">
                <span>Zoom {multiplier}x</span>
                {mouseFollowEnabled && (
                  <span className="text-emerald-400 font-normal">
                    • Mouse follow active (cursor pans document)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-500">Select 2x, 3x, 4x to zoom with mouse-follow</span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Esc</kbd>
            <span>to exit</span>
          </div>
        </div>
      </div>
    </div>
  );
};
