import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { useSignedUrl, downloadStoredFile, Bucket } from '../../lib/files';
import { formatFileSize, formatINR } from '../../lib/formatters';
import { canUserApproveRequest } from '../../lib/workflow';
import { ApproveModal } from '../portals/ApproveModal';
import { RequestRecord } from '../../types/database';
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
  RotateCw,
  ChevronDown,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
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
  request?: RequestRecord;
  canApprove?: boolean;
  approveDisabledReason?: string;
  onApprove?: () => void;
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
      (file.mimeType.startsWith('image/') ||
        file.mimeType.includes('jpeg') ||
        file.mimeType.includes('png') ||
        file.mimeType.includes('webp'))) ||
    Boolean(fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|bmp|svg|tif|tiff|avif|ico|heic|heif)$/i));
  const fileExt = (fileName.split('.').pop() || '').toUpperCase();

  const [numPages, setNumPages] = useState<number | null>(file.pageCount || null);
  const [pdfError, setPdfError] = useState<boolean>(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Individual page rotation state for PDFs: Record<pageNumber, degrees> (0, 90, 180, 270)
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  // Rotation for image documents: degrees (0, 90, 180, 270)
  const [imageRotation, setImageRotation] = useState<number>(0);

  const handleRotatePage = (pageNum: number) => {
    setPageRotations((prev) => ({
      ...prev,
      [pageNum]: ((prev[pageNum] || 0) + 90) % 360,
    }));
  };

  const handleResetPage = (pageNum: number) => {
    setPageRotations((prev) => {
      const copy = { ...prev };
      delete copy[pageNum];
      return copy;
    });
  };

  const handleRotateImage = () => {
    setImageRotation((prev) => (prev + 90) % 360);
  };

  const handleResetImage = () => {
    setImageRotation(0);
  };

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

          {/* Rotate control for Image */}
          {isImage && (
            <div className="flex items-center bg-slate-950/90 rounded-lg p-0.5 border border-slate-700/80 gap-0.5 shadow-2xs">
              <button
                type="button"
                onClick={handleRotateImage}
                className="px-2 py-1 rounded text-slate-200 hover:text-white hover:bg-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Rotate image 90° clockwise"
              >
                <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
                <span>Rotate{imageRotation > 0 ? ` (${imageRotation}°)` : ''}</span>
              </button>
              {imageRotation > 0 && (
                <button
                  type="button"
                  onClick={handleResetImage}
                  className="p-1 hover:bg-slate-800 text-amber-400 hover:text-amber-300 rounded transition-colors cursor-pointer"
                  title="Reset image rotation"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

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
                {Array.from({ length: numPages || 1 }, (_, pIdx) => {
                  const pageNum = pIdx + 1;
                  const rot = pageRotations[pageNum] || 0;
                  return (
                    <div
                      key={pageNum}
                      className="my-3 sm:my-4 flex flex-col items-center w-full"
                    >
                      {/* Individual Page Toolbar */}
                      <div
                        style={{ width: Math.min(pageWidth, containerWidth - 32) }}
                        className="flex items-center justify-between mb-1.5 px-1 text-xs select-none"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono font-bold text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800 shadow-2xs">
                            Page {pageNum}{(numPages || 1) > 1 ? ` of ${numPages}` : ''}
                          </span>
                          {rot > 0 && (
                            <span className="text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-700/60">
                              {rot}°
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleRotatePage(pageNum)}
                            className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                            title={`Rotate Page ${pageNum} 90° clockwise`}
                          >
                            <RotateCw className="w-3 h-3 text-indigo-400" />
                            <span>Rotate Page</span>
                          </button>
                          {rot > 0 && (
                            <button
                              type="button"
                              onClick={() => handleResetPage(pageNum)}
                              className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 border border-slate-700 text-[11px] transition-colors cursor-pointer"
                              title={`Reset Page ${pageNum} rotation`}
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="max-w-full overflow-x-auto flex justify-center">
                        <Page
                          pageNumber={pageNum}
                          width={pageWidth}
                          rotate={rot}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          className="shadow-2xl rounded-lg overflow-hidden border border-slate-800 bg-white"
                          loading={
                            <div
                              style={{ width: pageWidth, height: Math.round(pageWidth * 1.35) }}
                              className="bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-xs"
                            >
                              <Loader2 className="w-5 h-5 animate-spin mr-2 text-indigo-400" />
                              <span>Page {pageNum}…</span>
                            </div>
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </Document>
            ) : (
              /* Fallback if PDF canvas fails (e.g. strict CORS or unsupported compression) */
              <div
                style={{
                  width: multiplier > 1 ? `${pageWidth}px` : '100%',
                  maxWidth: multiplier > 1 ? 'none' : '56rem',
                }}
                className="w-full max-w-full overflow-x-auto p-2 flex flex-col items-center"
              >
                <iframe
                  src={`${resolvedUrl}#toolbar=1&navpanes=0`}
                  title={fileName}
                  style={{
                    width: multiplier > 1 ? `${pageWidth}px` : '100%',
                    height: multiplier > 1 ? `${Math.round(750 * multiplier)}px` : '750px',
                  }}
                  className="rounded-xl border border-slate-800 bg-white shadow-xl"
                />
              </div>
            )}
          </div>
        ) : isImage && resolvedUrl ? (
          <div className="w-full max-w-full overflow-x-auto overflow-y-auto flex justify-center p-4">
            <img
              src={resolvedUrl}
              alt={fileName}
              style={{
                width: multiplier > 1 ? `${pageWidth}px` : 'auto',
                maxWidth: multiplier > 1 ? 'none' : '100%',
                maxHeight: multiplier > 1 ? 'none' : '85vh',
                height: multiplier > 1 ? 'auto' : undefined,
                transform: `rotate(${imageRotation}deg)`,
                transition: 'transform 0.2s ease-in-out',
              }}
              className={`rounded-xl shadow-2xl transition-all duration-150 border border-slate-800 mx-auto ${
                multiplier > 1 ? 'object-contain' : 'max-h-[85vh] object-contain'
              }`}
            />
          </div>
        ) : (
          <div className="w-full max-w-xl my-6 bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-xl">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mx-auto mb-3 text-indigo-400">
              <FileText className="w-7 h-7" />
            </div>
            {fileExt && (
              <span className="inline-block text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-800 text-indigo-300 border border-slate-700 mb-2">
                {fileExt} Document
              </span>
            )}
            <p className="text-sm font-bold text-slate-100 break-all">{fileName}</p>
            {file.sizeBytes ? (
              <p className="text-xs text-slate-400 mt-1">{formatFileSize(file.sizeBytes)}</p>
            ) : null}
            <p className="text-xs text-slate-400 mt-2">
              Excel, Word, CSV, and Office documents can be downloaded directly to open in full fidelity.
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || (!resolvedUrl && !file.storagePath)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>Download {fileExt || 'File'}</span>
            </button>
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
  request,
  canApprove: propCanApprove,
  approveDisabledReason: propApproveDisabledReason,
  onApprove,
}) => {
  const { isBackendConnected, user } = useAuth();
  const { approveRequest } = useRequests();
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [docMultipliers, setDocMultipliers] = useState<Record<number, number>>({});
  const [isFullScreen, setIsFullScreen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const docRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [containerWidth, setContainerWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 800
  );

  // Preserve background scroll position and lock background scrolling while preview is open
  const savedScrollYRef = useRef<number | null>(null);
  const prevActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Capture the current scroll position of the window when entering preview
    const currentScrollY =
      window.scrollY ??
      document.documentElement.scrollTop ??
      document.body.scrollTop ??
      0;
    savedScrollYRef.current = currentScrollY;

    // Remember the element that had focus before opening the preview modal (e.g. Preview button on the card)
    if (document.activeElement instanceof HTMLElement) {
      prevActiveElementRef.current = document.activeElement;
    }

    // Lock body scrolling
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      // Restore body overflow
      document.body.style.overflow = originalOverflow;

      // Blur whatever element was active inside the modal before it unmounts
      // to prevent browser from scrolling to top upon activeElement removal
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      // Safely restore focus to previous trigger element without scrolling the page
      if (prevActiveElementRef.current && typeof prevActiveElementRef.current.focus === 'function') {
        try {
          prevActiveElementRef.current.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      }

      // Restore exact window scroll position immediately and on next frames
      const targetY = savedScrollYRef.current;
      if (typeof targetY === 'number') {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        });
        setTimeout(() => {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        }, 50);
      }
    };
  }, [isOpen]);

  // Compute approval permission if request is supplied
  const approvalCheck = useMemo(() => {
    if (!request || !user) return { canApprove: false };
    return canUserApproveRequest(request, user);
  }, [request, user]);

  const effectiveCanApprove = propCanApprove ?? (
    approvalCheck.canApprove ||
    (user?.role === 'head' && request?.status === 'pending_head_approval') ||
    (user?.role === 'admin' && request?.status === 'pending_admin_approval')
  );
  const effectiveApproveDisabledReason = propApproveDisabledReason ?? approvalCheck.blockedReason;

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

  // Set zoom for all documents (used by top bar controls so clicking 2x in top bar zooms ALL docs!)
  const setZoomAll = useCallback(
    (m: number | ((prev: number) => number)) => {
      setDocMultipliers((prev) => {
        const cur = prev[activeIndex] ?? 1;
        const nextVal = typeof m === 'function' ? m(cur) : m;
        const clamped = Math.max(1, Math.min(5, Math.round(nextVal * 10) / 10));
        const updated: Record<number, number> = {};
        files.forEach((_, idx) => {
          updated[idx] = clamped;
        });
        return updated;
      });
    },
    [files, activeIndex]
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

  // Jump to initialIndex when opened using container-only scrolling (never scrolling the window!)
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(Math.max(0, Math.min(initialIndex, files.length - 1)));
      setDocMultipliers({});
      if (initialIndex > 0 && initialIndex < files.length) {
        setTimeout(() => {
          const container = scrollContainerRef.current;
          const target = docRefs.current[initialIndex];
          if (container && target) {
            const containerRect = container.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const topOffset = container.scrollTop + (targetRect.top - containerRect.top);
            container.scrollTo({ top: Math.max(0, topOffset), behavior: 'smooth' });
          }
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

  // Scroll to doc strictly inside the modal container without affecting window scroll
  const scrollToDoc = (idx: number) => {
    setActiveIndex(idx);
    const container = scrollContainerRef.current;
    const target = docRefs.current[idx];
    if (container && target) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const topOffset = container.scrollTop + (targetRect.top - containerRect.top);
      container.scrollTo({ top: Math.max(0, topOffset), behavior: 'smooth' });
    }
  };

  // Keyboard navigation: Escape to close, 1-5 for zoom
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        setZoomAll(parseInt(e.key, 10));
      } else if (e.key === '+' || e.key === '=') {
        setZoomAll((m) => Math.min(5, m + 0.5));
      } else if (e.key === '-') {
        setZoomAll((m) => Math.max(1, m - 0.5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, setZoomAll]);

  if (!isOpen || files.length === 0) return null;

  const currentFile = files[activeIndex] || files[0];

  const modalNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || currentFile?.name || 'Document Preview'}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-xs transition-all ${
        isFullScreen ? 'p-0' : 'p-0 sm:p-3 md:p-4'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
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
                {request && typeof request.amount === 'number' && (
                  <span className="text-[10px] sm:text-[11px] font-extrabold text-emerald-300 font-display bg-emerald-950/90 border border-emerald-700/80 px-2 py-0.5 rounded shrink-0">
                    {formatINR(request.amount)}
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
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Approval Button in Doc Preview Window */}
            {effectiveCanApprove && (
              <button
                type="button"
                id="preview-doc-approve-btn"
                disabled={Boolean(effectiveApproveDisabledReason)}
                title={effectiveApproveDisabledReason || 'Approve & Digital Sign this request directly from preview'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onApprove) {
                    onApprove();
                  } else {
                    setShowApproveModal(true);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer shrink-0 ${
                  effectiveApproveDisabledReason
                    ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed shadow-none'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 hover:shadow-emerald-900/80 animate-pulse hover:animate-none'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-200" />
                <span>Approve & Sign</span>
              </button>
            )}

            {/* Main Top Bar Zoom Controls: Zooms all documents together */}
            {(() => {
              const activeMultiplier = getDocMultiplier(activeIndex);
              return (
                <div className="flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-slate-700/80 gap-0.5">
                  <span className="text-[10px] font-bold text-slate-400 px-1.5 hidden md:inline">
                    Zoom:
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomAll((m) => Math.max(1, Math.round((m - 0.5) * 10) / 10))}
                    disabled={activeMultiplier <= 1}
                    className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-40 cursor-pointer"
                    title="Zoom Out All (-)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>

                  {[1, 2, 3].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setZoomAll(m)}
                      className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold font-mono transition-colors cursor-pointer ${
                        activeMultiplier === m
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-300 hover:text-white hover:bg-slate-700'
                      }`}
                      title={`Zoom all documents to ${m}x`}
                    >
                      {m}x
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setZoomAll((m) => Math.min(5, Math.round((m + 0.5) * 10) / 10))}
                    disabled={activeMultiplier >= 5}
                    className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-40 cursor-pointer"
                    title="Zoom In All (+)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>

                  {activeMultiplier > 1 && (
                    <button
                      type="button"
                      onClick={() => setZoomAll(1)}
                      className="p-1 hover:bg-slate-700 text-amber-400 rounded transition-colors ml-0.5 cursor-pointer"
                      title="Reset all documents to 1x"
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
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

        {/* Approve Modal Triggered Directly From Preview Doc Window */}
        {showApproveModal && request && (
          <div className="relative z-[70]" onClick={(e) => e.stopPropagation()}>
            <ApproveModal
              isOpen={showApproveModal}
              onClose={() => setShowApproveModal(false)}
              request={request}
              onApprove={async (voice) => {
                const res = await approveRequest(request.id, voice);
                if (res.success) {
                  setTimeout(() => {
                    setShowApproveModal(false);
                    onClose();
                  }, 1200);
                }
                return res;
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalNode, document.body)
    : modalNode;
};
