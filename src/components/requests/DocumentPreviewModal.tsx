import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

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
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

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

interface SingleDocViewerProps {
  file: DocumentPreviewItem;
  index: number;
  total: number;
  multiplier: number;
  onMultiplierChange: (m: number | ((prev: number) => number)) => void;
  containerWidth: number;
  isBackendConnected: boolean;
  onDeleteFile?: (file: DocumentPreviewItem) => Promise<boolean | void> | boolean | void;
  canDelete?: boolean;
  docRef: (el: HTMLDivElement | null) => void;
  approvalNo?: string | null;
}

const SingleDocViewer: React.FC<SingleDocViewerProps> = ({
  file,
  index,
  total,
  multiplier,
  onMultiplierChange,
  containerWidth,
  isBackendConnected,
  onDeleteFile,
  canDelete = false,
  docRef,
  approvalNo,
}) => {
  const bucket: Bucket = file.bucket || 'request-files';
  const signed = useSignedUrl(bucket, file.storagePath || null, isBackendConnected);

  const resolvedUrl =
    file.publicUrl &&
    (file.publicUrl.startsWith('blob:') ||
      file.publicUrl.startsWith('http') ||
      file.publicUrl.startsWith('data:'))
      ? file.publicUrl
      : isBackendConnected
      ? signed.url
      : file.publicUrl || null;

  const fileName = file.name || `Document #${index + 1}`;
  const isPdf =
    (file.mimeType && file.mimeType.includes('pdf')) ||
    fileName.toLowerCase().endsWith('.pdf');
  const isImage =
    (file.mimeType &&
      (file.mimeType.includes('image') ||
        file.mimeType.includes('jpeg') ||
        file.mimeType.includes('png') ||
        file.mimeType.includes('webp'))) ||
    fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/i);

  const [numPages, setNumPages] = useState<number | null>(file.pageCount || null);
  const [pdfError, setPdfError] = useState<boolean>(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (file.storagePath) {
        await downloadStoredFile(bucket, file.storagePath, fileName);
      } else if (resolvedUrl) {
        const a = document.createElement('a');
        a.href = resolvedUrl;
        a.download = fileName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteFile) return;
    if (!window.confirm(`Delete "${fileName}"? This will remove this attachment.`)) return;
    setDeleting(true);
    try {
      await onDeleteFile(file);
    } finally {
      setDeleting(false);
    }
  };

  // Responsive page width: fits mobile viewport or desktop max, scaled by zoom multiplier
  const isMobile = containerWidth < 640;
  const baseTargetWidth = isMobile
    ? Math.max(260, containerWidth - 28)
    : Math.max(340, Math.min(containerWidth - 64, 880));
  const pageWidth = Math.round(baseTargetWidth * multiplier);

  return (
    <div
      ref={docRef}
      id={`doc-preview-${index}`}
      className="scroll-mt-4 mb-8 flex flex-col items-center w-full"
    >
      {/* Document Section Header Card */}
      <div className="w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-xl p-3 sm:p-3.5 mb-3 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border ${
              approvalNo && index === 0
                ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40'
                : isPdf
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
            }`}
          >
            {approvalNo && index === 0 ? (
              <FileCheck className="w-4 h-4" />
            ) : isPdf ? (
              <FileText className="w-4 h-4" />
            ) : (
              <ImageIcon className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs sm:text-sm font-bold text-slate-100 truncate max-w-[200px] sm:max-w-md">
                {total > 1 && (
                  <span className="text-indigo-400 mr-1.5 font-mono">
                    Doc #{index + 1}:
                  </span>
                )}
                {fileName}
              </span>
              {file.badge && (
                <span className="text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60 px-1.5 py-0.2 rounded shrink-0">
                  {file.badge}
                </span>
              )}
              {multiplier > 1 && (
                <span className="text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/60 px-2 py-0.5 rounded-full shrink-0">
                  {multiplier}x Zoom
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              {file.sizeBytes && <span>{formatFileSize(file.sizeBytes)}</span>}
              {numPages ? <span>• {numPages} {numPages === 1 ? 'page' : 'pages'}</span> : null}
              {total > 1 && (
                <span className="text-slate-500 hidden sm:inline">
                  • Document {index + 1} of {total}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action icons and Zoom Controls for this specific document */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          {/* Dedicated Zoom Controls for this specific document */}
          <div className="flex items-center bg-slate-950/90 rounded-lg p-0.5 border border-slate-700/80 gap-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => onMultiplierChange((m) => Math.max(1, Math.round((m - 0.5) * 10) / 10))}
              disabled={multiplier <= 1}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-30 cursor-pointer"
              title={`Zoom Out Doc #${index + 1} (-)`}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            {[1, 2, 3].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMultiplierChange(m)}
                className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold font-mono transition-all cursor-pointer ${
                  multiplier === m
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
                title={`Set Doc #${index + 1} zoom to ${m}x`}
              >
                {m}x
              </button>
            ))}

            <button
              type="button"
              onClick={() => onMultiplierChange((m) => Math.min(5, Math.round((m + 0.5) * 10) / 10))}
              disabled={multiplier >= 5}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-30 cursor-pointer"
              title={`Zoom In Doc #${index + 1} (+)`}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            {multiplier > 1 && (
              <button
                type="button"
                onClick={() => onMultiplierChange(1)}
                className="p-1 hover:bg-slate-800 text-amber-400 hover:text-amber-300 rounded transition-colors ml-0.5 cursor-pointer"
                title={`Reset Doc #${index + 1} zoom to 1x`}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>

          {resolvedUrl && (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors inline-flex items-center gap-1 text-xs"
              title="Open document in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Open</span>
            </a>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || (!resolvedUrl && !file.storagePath)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-500 transition-colors inline-flex items-center gap-1 text-xs font-semibold disabled:opacity-50 cursor-pointer"
            title="Download document"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Download</span>
          </button>
          {(onDeleteFile || canDelete) && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white border border-rose-500 transition-colors inline-flex items-center text-xs disabled:opacity-50 cursor-pointer"
              title="Delete document"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Render Document Content */}
      <div className="w-full flex flex-col items-center">
        {signed.loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
            <span className="text-xs">Loading document…</span>
          </div>
        ) : !resolvedUrl && !file.storagePath ? (
          <div className="py-12 text-center text-slate-400">
            <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-semibold">Preview not available</p>
            <p className="text-[11px] text-slate-500 mt-1">Please use the download button to view this file.</p>
          </div>
        ) : isPdf && resolvedUrl ? (
          <div className="w-full flex flex-col items-center">
            {!pdfError ? (
              <Document
                file={resolvedUrl}
                onLoadSuccess={({ numPages: n }) => {
                  setNumPages(n);
                  setPdfError(false);
                }}
                onLoadError={(err) => {
                  console.warn('react-pdf render error, falling back to native frame:', err);
                  setPdfError(true);
                }}
                loading={
                  <div className="py-14 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    <span className="text-xs">Rendering PDF pages…</span>
                  </div>
                }
                error={
                  <div className="py-8 text-center text-xs text-rose-300">
                    Could not render pages via canvas. Using standard viewer below…
                  </div>
                }
                className="w-full flex flex-col items-center"
              >
                {Array.from({ length: numPages || 1 }, (_, pIdx) => (
                  <div
                    key={pIdx + 1}
                    className="my-2.5 sm:my-3.5 flex flex-col items-center w-full"
                  >
                    <div className="max-w-full overflow-x-auto flex justify-center">
                      <Page
                        pageNumber={pIdx + 1}
                        width={pageWidth}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="shadow-2xl rounded-lg overflow-hidden border border-slate-800 bg-white"
                        loading={
                          <div
                            style={{ width: pageWidth, height: Math.round(pageWidth * 1.35) }}
                            className="bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-xs"
                          >
                            <Loader2 className="w-5 h-5 animate-spin mr-2 text-indigo-400" />
                            <span>Page {pIdx + 1}…</span>
                          </div>
                        }
                      />
                    </div>
                    {(numPages || 1) > 1 && (
                      <span className="text-[10px] font-mono text-slate-400 mt-1 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                        Page {pIdx + 1} of {numPages}
                      </span>
                    )}
                  </div>
                ))}
              </Document>
            ) : (
              /* Fallback if PDF canvas fails (e.g. strict CORS or unsupported compression) */
              <div className="w-full max-w-4xl p-2 flex flex-col items-center">
                <iframe
                  src={`${resolvedUrl}#toolbar=1&navpanes=0`}
                  title={fileName}
                  className="w-full h-[600px] sm:h-[800px] rounded-xl border border-slate-800 bg-white shadow-xl"
                />
              </div>
            )}
          </div>
        ) : isImage && resolvedUrl ? (
          <div className="w-full flex justify-center p-2">
            <img
              src={resolvedUrl}
              alt={fileName}
              style={{
                width: multiplier > 1 ? `${pageWidth}px` : 'auto',
                maxWidth: multiplier > 1 ? undefined : '100%',
              }}
              className="max-h-[85vh] rounded-xl shadow-2xl object-contain border border-slate-800 mx-auto"
            />
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400">
            <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-semibold">{fileName}</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Direct preview is not available for this format. Please download the file to inspect it.
            </p>
          </div>
        )}
      </div>

      {/* Automatic Next Document Indicator Divider */}
      {index < total - 1 && (
        <div className="w-full max-w-3xl my-8 flex items-center justify-center gap-3 select-none">
          <div className="h-px bg-slate-800 flex-1" />
          <span className="text-[11px] font-semibold text-slate-400 bg-slate-900 px-3.5 py-1.5 rounded-full border border-slate-800 flex items-center gap-1.5 shadow-sm">
            <span>Scroll down for Doc #{index + 2}</span>
            <ChevronDown className="w-3.5 h-3.5 text-indigo-400 animate-bounce" />
          </span>
          <div className="h-px bg-slate-800 flex-1" />
        </div>
      )}
    </div>
  );
};

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
  const [docMultipliers, setDocMultipliers] = useState<Record<number, number>>({});
  const [isFullScreen, setIsFullScreen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const docRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [containerWidth, setContainerWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 800
  );

  const getDocMultiplier = useCallback(
    (idx: number) => docMultipliers[idx] ?? 1,
    [docMultipliers]
  );

  const setDocMultiplier = useCallback(
    (idx: number, m: number | ((prev: number) => number)) => {
      setDocMultipliers((prev) => {
        const cur = prev[idx] ?? 1;
        const nextVal = typeof m === 'function' ? m(cur) : m;
        const clamped = Math.max(1, Math.min(5, Math.round(nextVal * 10) / 10));
        return { ...prev, [idx]: clamped };
      });
    },
    []
  );

  // Measure scroll container width accurately for responsive rendering
  useEffect(() => {
    if (!isOpen) return;
    const updateSize = () => {
      if (scrollContainerRef.current) {
        setContainerWidth(scrollContainerRef.current.clientWidth);
      } else {
        setContainerWidth(window.innerWidth);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isOpen]);

  // Jump to initialIndex when opened
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(Math.max(0, Math.min(initialIndex, files.length - 1)));
      setDocMultipliers({});
      if (initialIndex > 0 && initialIndex < files.length) {
        setTimeout(() => {
          docRefs.current[initialIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }
    }
  }, [isOpen, initialIndex, files.length]);

  // Track active document during continuous scrolling
  useEffect(() => {
    if (!isOpen || files.length <= 1) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let closestIdx = 0;
      let minDistance = Infinity;

      docRefs.current.forEach((el, idx) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerTop);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = idx;
        }
      });

      setActiveIndex(closestIdx);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isOpen, files.length]);

  const scrollToDoc = (idx: number) => {
    setActiveIndex(idx);
    docRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Keyboard navigation: Escape to close, 1-5 for active document zoom
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        setDocMultiplier(activeIndex, parseInt(e.key, 10));
      } else if (e.key === '+' || e.key === '=') {
        setDocMultiplier(activeIndex, (m) => Math.min(5, m + 0.5));
      } else if (e.key === '-') {
        setDocMultiplier(activeIndex, (m) => Math.max(1, m - 0.5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, activeIndex, setDocMultiplier]);

  if (!isOpen || files.length === 0) return null;

  const currentFile = files[activeIndex] || files[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || currentFile?.name || 'Document Preview'}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-xs transition-all ${
        isFullScreen ? 'p-0' : 'p-0 sm:p-3 md:p-4'
      }`}
    >
      <div
        className={`bg-slate-950 flex flex-col overflow-hidden border border-slate-800 transition-all ${
          isFullScreen
            ? 'w-full h-full rounded-none'
            : 'w-full h-[100dvh] sm:h-[94vh] sm:max-w-6xl sm:rounded-2xl shadow-2xl'
        }`}
      >
        {/* Top Header Bar */}
        <div className="bg-slate-900 border-b border-slate-800 text-white px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-2.5 shrink-0">
          {/* Header Title & Document Count */}
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                approvalNo
                  ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40'
                  : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
              }`}
            >
              {approvalNo ? <FileCheck className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-100 truncate" title={currentFile?.name}>
                  {title || currentFile?.name}
                </h3>
                {approvalNo && (
                  <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-1.5 py-0.2 rounded shrink-0">
                    {approvalNo}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                {files.length > 1 ? (
                  <span className="text-indigo-400 font-semibold">
                    Document {activeIndex + 1} of {files.length} • Scroll down for all
                  </span>
                ) : (
                  <span>Official Document Preview</span>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Active Document Zoom Controls */}
            {(() => {
              const activeMultiplier = getDocMultiplier(activeIndex);
              return (
                <div className="flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-slate-700/80 gap-0.5">
                  {files.length > 1 && (
                    <span className="text-[10px] font-bold text-indigo-300 px-1.5 hidden md:inline">
                      Doc #{activeIndex + 1} Zoom:
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setDocMultiplier(activeIndex, (m) => Math.max(1, Math.round((m - 0.5) * 10) / 10))}
                    disabled={activeMultiplier <= 1}
                    className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-40 cursor-pointer"
                    title={`Zoom Out Doc #${activeIndex + 1} (-)`}
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>

                  {[1, 2, 3].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDocMultiplier(activeIndex, m)}
                      className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold font-mono transition-colors cursor-pointer ${
                        activeMultiplier === m
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-300 hover:text-white hover:bg-slate-700'
                      }`}
                      title={`Set Doc #${activeIndex + 1} zoom to ${m}x`}
                    >
                      {m}x
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setDocMultiplier(activeIndex, (m) => Math.min(5, Math.round((m + 0.5) * 10) / 10))}
                    disabled={activeMultiplier >= 5}
                    className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-40 cursor-pointer"
                    title={`Zoom In Doc #${activeIndex + 1} (+)`}
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>

                  {activeMultiplier > 1 && (
                    <button
                      type="button"
                      onClick={() => setDocMultiplier(activeIndex, 1)}
                      className="p-1 hover:bg-slate-700 text-amber-400 rounded transition-colors ml-0.5 cursor-pointer"
                      title={`Reset Doc #${activeIndex + 1} to 1x`}
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={() => setIsFullScreen((f) => !f)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer hidden sm:inline-flex"
              title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-200 hover:border-rose-800 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
              title="Close preview (Esc)"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>

        {/* Multi-Document Jump Bar (when multiple files attached) */}
        {files.length > 1 && (
          <div className="bg-slate-950 border-b border-slate-800 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
            <span className="text-[10px] uppercase font-bold text-slate-500 mr-1 hidden sm:inline shrink-0">
              Jump to Doc:
            </span>
            {files.map((file, idx) => {
              const active = idx === activeIndex;
              const fIsPdf =
                (file.mimeType && file.mimeType.includes('pdf')) ||
                file.name.toLowerCase().endsWith('.pdf');
              const docZoom = getDocMultiplier(idx);
              return (
                <button
                  key={file.id || `${file.name}-${idx}`}
                  type="button"
                  onClick={() => scrollToDoc(idx)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                      : 'bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800'
                  }`}
                >
                  {fIsPdf ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
                  <span>Doc #{idx + 1}</span>
                  {docZoom > 1 && (
                    <span className="text-[9px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1 rounded">
                      {docZoom}x
                    </span>
                  )}
                  <span className={`text-[10px] font-mono truncate max-w-[100px] sm:max-w-[140px] ${active ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {file.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Scrollable Continuous Preview Stream */}
        <div
          ref={scrollContainerRef}
          className="preview-scrollbars flex-1 w-full bg-slate-950 p-2 sm:p-4 select-none overflow-x-auto overflow-y-auto relative"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {files.map((file, idx) => (
            <SingleDocViewer
              key={file.id || `${file.name}-${idx}`}
              file={file}
              index={idx}
              total={files.length}
              multiplier={getDocMultiplier(idx)}
              onMultiplierChange={(m) => setDocMultiplier(idx, m)}
              containerWidth={containerWidth}
              isBackendConnected={isBackendConnected}
              onDeleteFile={onDeleteFile}
              canDelete={canDelete}
              approvalNo={approvalNo}
              docRef={(el) => {
                docRefs.current[idx] = el;
              }}
            />
          ))}
        </div>

        {/* Bottom Helper Bar */}
        <div className="bg-slate-900 border-t border-slate-800 px-3 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-2 truncate">
            {files.length > 1 ? (
              <span className="text-slate-300 font-medium">
                Continuous Scroll Active • Showing all {files.length} documents (zoom each independently)
              </span>
            ) : (
              <span>All pages rendered for continuous vertical scrolling.</span>
            )}
            {getDocMultiplier(activeIndex) > 1 && (
              <span className="text-indigo-400 font-bold ml-2">
                Doc #{activeIndex + 1} at {getDocMultiplier(activeIndex)}x
              </span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Esc</kbd>
            <span>to exit</span>
          </div>
        </div>
      </div>
    </div>
  );
};
