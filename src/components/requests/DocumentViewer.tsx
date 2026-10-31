import React, { useState, useRef } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Eye,
  Download,
  Loader2,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Plus,
  FilePlus,
  Trash2,
  X,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { downloadStoredFile, useSignedUrl } from '../../lib/files';
import { errMsg } from '../../lib/errorUtils';
import { DocumentPreviewModal, DocumentPreviewItem } from './DocumentPreviewModal';
import { ZoomMultiplierControls, useDocumentMouseFollow } from './ZoomMultiplierControls';

interface DocumentViewerProps {
  files: RequestFile[];
  title?: string;
  requestId?: string;
  canAddDocs?: boolean;
  canDeleteDocs?: boolean;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  files,
  title = 'Attached Invoices & Documents',
  requestId,
  canAddDocs = false,
  canDeleteDocs = false,
}) => {
  const { isBackendConnected, user } = useAuth();
  const { addExtraDocuments, removeExtraDocument } = useRequests();

  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialIndex, setModalInitialIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Extra document upload / delete states
  const [isAddDocModalOpen, setIsAddDocModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [confirmDeleteModal, setConfirmDeleteModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    containerRef: canvasRef,
    mouseFollowEnabled,
    setMouseFollowEnabled,
    handleMouseMove,
  } = useDocumentMouseFollow({ multiplier });

  const documentFiles = files.filter((f) => f.kind === 'document');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      const valid = selected.filter((f) =>
        ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type) ||
        f.name.toLowerCase().match(/\.(pdf|jpe?g|png)$/i)
      );
      if (valid.length < selected.length) {
        setUploadError('Some files were skipped. Only PDF, JPG, and PNG are supported.');
      } else {
        setUploadError(null);
      }
      setUploadFiles((prev) => [...prev, ...valid]);
    }
  };

  const handleRemoveSelectedFile = (idx: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUploadExtraDocs = async () => {
    if (!requestId || uploadFiles.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await addExtraDocuments(requestId, uploadFiles);
      if (!res.success) {
        throw new Error(res.error || 'Failed to upload documents');
      }
      setUploadSuccess(`Successfully attached ${uploadFiles.length} extra document(s).`);
      setUploadFiles([]);
      setIsAddDocModalOpen(false);
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err) {
      setUploadError(errMsg(err));
    } finally {
      setIsUploading(false);
    }
  };

  const activeFile = documentFiles[activeFileIndex] || documentFiles[0];

  const handleDeleteActiveFile = async () => {
    if (!requestId || !activeFile) return;
    setIsDeletingFile(true);
    setUploadError(null);
    try {
      const res = await removeExtraDocument(requestId, activeFile.id);
      if (!res.success) {
        throw new Error(res.error || 'Failed to remove document');
      }
      setConfirmDeleteModal(false);
      setActiveFileIndex(0);
      setUploadSuccess(`Removed ${activeFile.original_name}.`);
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err) {
      setUploadError(errMsg(err));
    } finally {
      setIsDeletingFile(false);
    }
  };

  // Render Add Document Modal Dialog
  const renderAddDocModal = () => {
    if (!isAddDocModalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden text-left flex flex-col max-h-[90vh]">
          {/* Modal Header */}
          <div className="px-5 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
                <FilePlus className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 font-display">
                  Attach Extra Documents
                </h3>
                <p className="text-[11px] text-slate-500">
                  Department Head Review • Invoices, bills, or supporting receipts
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsAddDocModalOpen(false);
                setUploadFiles([]);
                setUploadError(null);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Content */}
          <div className="p-5 space-y-4 overflow-y-auto">
            {uploadError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Drop / Pick Zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-purple-200 hover:border-purple-400 bg-purple-50/40 hover:bg-purple-50/80 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/png,image/jpeg"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className="w-10 h-10 rounded-xl bg-white text-purple-600 border border-purple-100 flex items-center justify-center mx-auto shadow-xs">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div className="text-xs text-slate-700">
                <span className="font-bold text-purple-700">Click to choose files</span> or drag and drop
              </div>
              <p className="text-[11px] text-slate-400">PDF, JPG, PNG up to 25MB each</p>
            </div>

            {/* Selected Files List */}
            {uploadFiles.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Selected Documents ({uploadFiles.length})</span>
                  <button
                    type="button"
                    onClick={() => setUploadFiles([])}
                    className="text-[11px] text-rose-600 hover:underline cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {uploadFiles.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-purple-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate max-w-[260px]">
                          {f.name}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          ({formatFileSize(f.size)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSelectedFile(idx)}
                        className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => {
                setIsAddDocModalOpen(false);
                setUploadFiles([]);
                setUploadError(null);
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              id="confirm-upload-extra-docs-btn"
              disabled={isUploading || uploadFiles.length === 0}
              onClick={handleUploadExtraDocs}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-200 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Attach {uploadFiles.length > 0 ? `${uploadFiles.length} File(s)` : 'Documents'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render Delete Confirmation Modal Dialog
  const renderDeleteConfirmModal = () => {
    if (!confirmDeleteModal || !activeFile) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-5 space-y-4 text-left">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Delete Attached Document?</h3>
              <p className="text-[11px] text-slate-500">This action will be logged in the audit trail.</p>
            </div>
          </div>

          <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200 break-all">
            "{activeFile.original_name}"
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isDeletingFile}
              onClick={() => setConfirmDeleteModal(false)}
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeletingFile}
              onClick={handleDeleteActiveFile}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isDeletingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              <span>Yes, Delete</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (documentFiles.length === 0) {
    if (canAddDocs && requestId) {
      return (
        <div className="bg-white rounded-2xl border-2 border-dashed border-purple-200 p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100 flex items-center justify-center mx-auto shadow-xs">
            <FilePlus className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-800 font-display">No Documents Attached Yet</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              As Department Head, you can attach invoices, receipts, or supporting bills before approval.
            </p>
          </div>
          <button
            type="button"
            id="add-first-extra-doc-btn"
            onClick={() => setIsAddDocModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md shadow-purple-200 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Extra Documents</span>
          </button>

          {renderAddDocModal()}
        </div>
      );
    }

    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-xs font-medium">
        No documents attached to view.
      </div>
    );
  }

  const signed = useSignedUrl('request-files', activeFile?.storage_path, isBackendConnected);
  const previewUrl = isBackendConnected ? signed.url : activeFile.public_url;
  const isPdf =
    activeFile.mime_type.includes('pdf') ||
    activeFile.original_name.toLowerCase().endsWith('.pdf');
  const isImage =
    activeFile.mime_type.includes('image') ||
    activeFile.original_name.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/i);

  const canDeleteActiveFile = Boolean(
    requestId &&
    activeFile &&
    (
      canDeleteDocs ||
      (canAddDocs && (activeFile.added_by === user?.id || user?.role === 'admin'))
    )
  );

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
      <div className="bg-slate-900 text-white px-3.5 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              isPdf ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {isPdf ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-xs font-bold text-slate-100 truncate max-w-[180px] sm:max-w-xs"
                title={activeFile.original_name}
              >
                {activeFile.original_name}
              </span>
              {activeFile.added_by_name && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-purple-500/30 text-purple-200 border border-purple-500/40">
                  Added by: {activeFile.added_by_name}
                </span>
              )}
            </div>
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
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {/* Zoom Multipliers (1x, 2x, 3x, 4x) */}
          <div className="hidden sm:flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 gap-0.5">
            {[1, 2, 3, 4].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMultiplier(m)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                  multiplier === m
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title={`Zoom ${m}x`}
              >
                {m}x
              </button>
            ))}
          </div>

          {/* Add Extra Docs Button for Head/Admin before approval */}
          {canAddDocs && requestId && (
            <button
              type="button"
              id="toolbar-add-extra-doc-btn"
              onClick={() => setIsAddDocModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
              title="Attach extra invoices, bills, or receipts"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Docs</span>
            </button>
          )}

          {/* Delete Active File (if attached by current user/admin) */}
          {canDeleteActiveFile && (
            <button
              type="button"
              id="delete-attached-doc-btn"
              onClick={() => setConfirmDeleteModal(true)}
              disabled={isDeletingFile}
              className="p-1.5 bg-slate-800 hover:bg-rose-900/50 text-slate-300 hover:text-rose-300 rounded-lg border border-slate-700 hover:border-rose-700 transition-colors cursor-pointer"
              title="Delete this attached document"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

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

          {/* Prominent Preview Button */}
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

      {uploadSuccess && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-[11px] text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{uploadSuccess}</span>
          </span>
          <button type="button" onClick={() => setUploadSuccess(null)} className="font-bold text-emerald-700">
            ×
          </button>
        </div>
      )}

      {downloadError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[11px] text-amber-800">
          {downloadError}
        </div>
      )}

      {/* Tabs strip */}
      {(documentFiles.length > 1 || canAddDocs) && (
        <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center justify-between gap-1.5 overflow-x-auto scrollbar-none shrink-0">
          <div className="flex items-center gap-1.5">
            {documentFiles.map((file, idx) => (
              <button
                key={file.id}
                type="button"
                onClick={() => {
                  setActiveFileIndex(idx);
                  setMultiplier(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  idx === activeFileIndex
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                <span>Doc #{idx + 1}</span>
                {file.added_by_name && (
                  <span className="text-[9px] font-bold px-1 rounded bg-purple-100 text-purple-700">
                    Extra
                  </span>
                )}
                <span className="text-[10px] text-slate-400 font-mono truncate max-w-[90px]">
                  {file.original_name}
                </span>
              </button>
            ))}
          </div>

          {canAddDocs && requestId && (
            <button
              type="button"
              onClick={() => setIsAddDocModalOpen(true)}
              className="text-xs font-bold text-purple-700 hover:text-purple-900 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-purple-100/60 transition-colors shrink-0 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add Document</span>
            </button>
          )}
        </div>
      )}

      {/* Small Area Preview Canvas */}
      <div
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        className="preview-scrollbars h-[480px] sm:h-[500px] bg-slate-950 p-2 sm:p-3 select-none flex flex-col items-center justify-start overflow-x-auto overflow-y-auto relative"
      >
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
              minWidth: multiplier > 1 ? `${multiplier * 100}%` : '100%',
              width: `${multiplier * 100}%`,
              height: multiplier > 1 ? `${multiplier * 100}%` : '100%',
              minHeight: '440px',
            }}
            className="relative mx-auto flex flex-col items-stretch transition-all duration-150 w-full"
          >
            <iframe
              src={`${previewUrl}#toolbar=1&navpanes=0`}
              title={activeFile.original_name}
              className="w-full h-full min-h-[440px] border-0 rounded-lg shadow-lg bg-white"
            />
            {multiplier > 1 && mouseFollowEnabled && (
              <div
                className="absolute inset-0 z-10 cursor-move bg-transparent"
                onMouseMove={handleMouseMove}
                title="Mouse Follow is active: move your mouse to glide through the zoomed document"
              />
            )}
          </div>
        ) : previewUrl && isImage ? (
          <div
            style={{
              minWidth: multiplier > 1 ? `${multiplier * 100}%` : '100%',
              width: `${multiplier * 100}%`,
              minHeight: '100%',
            }}
            className="relative mx-auto flex items-center justify-center p-2 transition-all duration-150 w-full"
            onMouseMove={handleMouseMove}
          >
            <img
              src={previewUrl}
              alt={activeFile.original_name}
              style={{
                width: `${multiplier * 100}%`,
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

        {/* Floating Transparent Zoom Multiplier Controls with Mouse Follow */}
        {previewUrl && (
          <ZoomMultiplierControls
            multiplier={multiplier}
            onSelectMultiplier={setMultiplier}
            mouseFollowEnabled={mouseFollowEnabled}
            onToggleMouseFollow={() => setMouseFollowEnabled((f) => !f)}
          />
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

      {/* Large Full-Screen Modal Preview with Dual Scrollbars */}
      <DocumentPreviewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        files={previewItems}
        initialIndex={modalInitialIndex}
        title={title}
      />

      {/* Add Extra Documents Modal */}
      {renderAddDocModal()}

      {/* Delete Attached Document Confirmation */}
      {renderDeleteConfirmModal()}
    </div>
  );
};
