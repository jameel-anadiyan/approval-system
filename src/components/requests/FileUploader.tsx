import React, { useRef, useState } from 'react';
import { UploadCloud, Camera, FileText, FileSpreadsheet, Image as ImageIcon, Trash2, Eye, Download } from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { useDocumentMouseFollow } from './ZoomMultiplierControls';

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/x-icon',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXTENDED_ACCEPT =
  '.pdf,.xls,.xlsx,.xlsm,.csv,.ods,.doc,.docx,.odt,.rtf,.txt,.ppt,.pptx,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

function resolveMimeType(file: File): string {
  const raw = (file.type || '').trim();
  if (raw && raw !== 'application/octet-stream') return raw;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || raw || 'application/octet-stream';
}

function classifyDocKind(mime: string, name: string): 'pdf' | 'image' | 'spreadsheet' | 'word' | 'other' {
  const m = (mime || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (m.includes('pdf') || ext === 'pdf') return 'pdf';
  if (
    m.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'avif', 'heic', 'heif', 'ico'].includes(ext)
  ) {
    return 'image';
  }
  if (
    m.includes('spreadsheet') ||
    m.includes('ms-excel') ||
    m === 'text/csv' ||
    ['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)
  ) {
    return 'spreadsheet';
  }
  if (
    m.includes('wordprocessingml') ||
    m.includes('msword') ||
    m.includes('opendocument.text') ||
    ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)
  ) {
    return 'word';
  }
  return 'other';
}

interface FileUploaderProps {
  files: RequestFile[];
  onAddFiles: (newFiles: RequestFile[]) => void;
  onRemoveFile: (fileId: string) => void;
  disabled?: boolean;
  /** Allows Excel, Word, CSV, PDF, and any image file (used for Agreement, Statutory Payment, Audit Report). */
  allowExtendedDocs?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  files,
  onAddFiles,
  onRemoveFile,
  disabled = false,
  allowExtendedDocs = false,
}) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [inlinePreviewIndex, setInlinePreviewIndex] = useState(0);
  const [inlineMultiplier, setInlineMultiplier] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const {
    containerRef: uploaderCanvasRef,
    mouseFollowEnabled,
    handleMouseMove,
  } = useDocumentMouseFollow({ multiplier: inlineMultiplier });

  const handleFiles = (incomingFiles: FileList | null) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const validFiles: RequestFile[] = [];
    const maxBytes = (allowExtendedDocs ? 25 : 15) * 1024 * 1024;

    Array.from(incomingFiles).forEach((file) => {
      if (file.size > maxBytes) {
        alert(`File ${file.name} is too large. Maximum size is ${allowExtendedDocs ? '25 MB' : '15 MB'}.`);
        return;
      }

      const resolvedMime = resolveMimeType(file);
      const ext = (file.name.split('.').pop() || '').toLowerCase();

      if (allowExtendedDocs) {
        const isAllowedExt = Boolean(EXT_TO_MIME[ext]) || resolvedMime.startsWith('image/');
        if (!isAllowedExt) {
          alert(
            `File "${file.name}" is not supported. Upload Excel (.xls/.xlsx/.csv), Word (.doc/.docx), PDF, or any image file.`
          );
          return;
        }
      } else {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowed.includes(resolvedMime)) {
          alert(`Format ${file.type || ext} is not supported. Please upload PDF, JPG, or PNG.`);
          return;
        }
      }

      const tempUrl = URL.createObjectURL(file);

      validFiles.push({
        id: `file-temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        request_id: 'draft',
        kind: 'document',
        storage_path: `uploads/${file.name}`,
        original_name: file.name,
        mime_type: resolvedMime,
        size_bytes: file.size,
        page_count: resolvedMime === 'application/pdf' ? 1 : null,
        duration_sec: null,
        sha256: null,
        created_at: new Date().toISOString(),
        public_url: tempUrl,
        blob: file,
      });
    });

    if (validFiles.length > 0) {
      onAddFiles(validFiles);
    }
  };

  return (
    <div className="space-y-3">
      {/* Hidden Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={allowExtendedDocs ? EXTENDED_ACCEPT : '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        disabled={disabled}
      />

      {/* Upload Action Zone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Document / File Browser */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center p-5 rounded-2xl border-2 border-dashed border-indigo-200 hover:border-indigo-500 bg-indigo-50/40 hover:bg-indigo-50/80 transition-all text-center group cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-white text-indigo-600 flex items-center justify-center shadow-xs mb-2 group-hover:scale-105 transition-transform">
            <UploadCloud className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold text-slate-800">
            {allowExtendedDocs ? 'Upload Excel, Word, PDF or Image' : 'Upload PDF or Photo'}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            {allowExtendedDocs
              ? 'Excel, Word, CSV, PDF, PNG, JPG & any Image up to 25 MB'
              : 'PDF, JPG, PNG up to 15 MB'}
          </span>
        </button>

        {/* Camera Capture on Phones */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-col items-center justify-center p-5 rounded-2xl border-2 border-dashed border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 transition-all text-center group cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-xs mb-2 group-hover:scale-105 transition-transform">
            <Camera className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold text-slate-800">
            Take Photo with Camera
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            Quick snap bills & receipts
          </span>
        </button>
      </div>

      {/* Attached Files List */}
      {files.length > 0 && (
        <div className="space-y-2 mt-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 block">
              Attached Documents ({files.length})
            </label>
            <button
              type="button"
              onClick={() => setPreviewIndex(0)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview Attached</span>
            </button>
          </div>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
            {files.map((file, idx) => {
              const kind = classifyDocKind(file.mime_type, file.original_name);
              const isPdf = kind === 'pdf';
              const isSpreadsheet = kind === 'spreadsheet';
              const isWord = kind === 'word';
              return (
                <div
                  key={file.id}
                  className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isPdf
                          ? 'bg-rose-50 text-rose-600 border border-rose-200'
                          : isSpreadsheet
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : isWord
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                      }`}
                    >
                      {isPdf || isWord || kind === 'other' ? (
                        <FileText className="w-4 h-4" />
                      ) : isSpreadsheet ? (
                        <FileSpreadsheet className="w-4 h-4" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {file.original_name}
                      </p>
                      <span className="text-[10px] text-slate-400">
                        {formatFileSize(file.size_bytes)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(idx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-800 text-xs font-bold transition-colors cursor-pointer"
                      title={`Preview ${file.original_name}`}
                    >
                      <Eye className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="hidden sm:inline">Preview</span>
                    </button>

                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => {
                          onRemoveFile(file.id);
                          if (inlinePreviewIndex >= files.length - 1) {
                            setInlinePreviewIndex(Math.max(0, files.length - 2));
                          }
                        }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                        title="Remove file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Small Area Preview Window: Directly opens on upload with dual scrollbars and Preview button */}
          {(() => {
            const currentInline = files[inlinePreviewIndex] || files[0];
            if (!currentInline) return null;
            const inlineKind = classifyDocKind(currentInline.mime_type, currentInline.original_name);
            const isPdf = inlineKind === 'pdf';
            const isImage = inlineKind === 'image';
            const previewUrl = currentInline.public_url || currentInline.storage_path;
            return (
              <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-sm mt-3">
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        isPdf
                          ? 'bg-rose-500/20 text-rose-400'
                          : inlineKind === 'spreadsheet'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : inlineKind === 'word'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-indigo-500/20 text-indigo-400'
                      }`}
                    >
                      {inlineKind === 'spreadsheet' ? (
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                      ) : isImage ? (
                        <ImageIcon className="w-3.5 h-3.5" />
                      ) : (
                        <FileText className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-slate-200 truncate max-w-[220px]" title={currentInline.original_name}>
                      {currentInline.original_name}
                    </span>
                    <span className="text-[10px] text-slate-400 hidden sm:inline">
                      ({formatFileSize(currentInline.size_bytes)})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {previewUrl && (isPdf || isImage) && (
                      <div className="flex items-center bg-slate-800 rounded-md p-0.5 border border-slate-700 gap-0.5">
                        {[1, 2, 3].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setInlineMultiplier(m)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                              inlineMultiplier === m
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-300 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            {m}x
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setPreviewIndex(inlinePreviewIndex)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      title="Open large preview modal"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>
                  </div>
                </div>

                {files.length > 1 && (
                  <div className="bg-slate-950 border-b border-slate-800 px-2.5 py-1 flex items-center gap-1 overflow-x-auto scrollbar-none">
                    {files.map((f, idx) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setInlinePreviewIndex(idx);
                          setInlineMultiplier(1);
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          idx === inlinePreviewIndex
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        Doc #{idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                <div
                  ref={uploaderCanvasRef}
                  onMouseMove={handleMouseMove}
                  className="preview-scrollbars h-[320px] bg-slate-950 p-2 overflow-x-auto overflow-y-auto select-none flex flex-col items-center justify-start relative"
                >
                  {isPdf && previewUrl ? (
                    <div
                      style={{
                        minWidth: inlineMultiplier > 1 ? `${inlineMultiplier * 100}%` : '100%',
                        width: `${inlineMultiplier * 100}%`,
                        height: inlineMultiplier > 1 ? `${inlineMultiplier * 100}%` : '100%',
                      }}
                      className="relative transition-all duration-150 w-full"
                    >
                      <iframe
                        src={`${previewUrl}#toolbar=1&navpanes=0`}
                        title={currentInline.original_name}
                        className="w-full h-full min-h-[300px] border-0 rounded-lg shadow bg-white"
                      />
                      {inlineMultiplier > 1 && mouseFollowEnabled && (
                        <div
                          className="absolute inset-0 z-10 cursor-move bg-transparent"
                          onMouseMove={handleMouseMove}
                          title="Mouse Follow is active: move your mouse to glide through the zoomed document"
                        />
                      )}
                    </div>
                  ) : isImage && previewUrl ? (
                    <div
                      style={{
                        minWidth: inlineMultiplier > 1 ? `${inlineMultiplier * 100}%` : '100%',
                        width: `${inlineMultiplier * 100}%`,
                        minHeight: '100%',
                      }}
                      className="relative flex items-center justify-center p-2 transition-all duration-150 w-full"
                      onMouseMove={handleMouseMove}
                    >
                      <img
                        src={previewUrl}
                        alt={currentInline.original_name}
                        style={{ width: `${inlineMultiplier * 100}%`, maxWidth: 'none' }}
                        className="max-h-[290px] rounded-lg shadow bg-white object-contain border border-slate-800"
                      />
                    </div>
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center text-center p-6 gap-2.5">
                      <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400">
                        {inlineKind === 'spreadsheet' ? (
                          <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
                        ) : (
                          <FileText className="w-6 h-6 text-blue-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-200">{currentInline.original_name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {inlineKind === 'spreadsheet'
                            ? 'Excel / Spreadsheet Attachment'
                            : inlineKind === 'word'
                            ? 'Word / Document Attachment'
                            : 'Attached File'}{' '}
                          • {formatFileSize(currentInline.size_bytes)}
                        </p>
                      </div>
                      {previewUrl && (
                        <a
                          href={previewUrl}
                          download={currentInline.original_name}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download File</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-slate-900 border-t border-slate-800 px-3 py-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Scroll right bar (vertical) &amp; bottom bar (horizontal)</span>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(inlinePreviewIndex)}
                    className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                  >
                    Click to enlarge
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Preview Modal for Uploaded Files */}
      <DocumentPreviewModal
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        files={files.map((f) => ({
          id: f.id,
          name: f.original_name,
          publicUrl: f.public_url,
          storagePath: f.storage_path,
          mimeType: f.mime_type,
          sizeBytes: f.size_bytes,
          badge: 'Uploaded',
        }))}
        initialIndex={previewIndex ?? 0}
        title="Uploaded Document Preview"
        onDeleteFile={!disabled ? (item) => {
          if (item.id) {
            onRemoveFile(item.id);
            if (inlinePreviewIndex >= files.length - 1) {
              setInlinePreviewIndex(Math.max(0, files.length - 2));
            }
          }
        } : undefined}
      />
    </div>
  );
};
