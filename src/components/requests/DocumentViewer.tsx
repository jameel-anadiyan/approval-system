import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Eye, Download, Loader2, Files, ChevronDown, ChevronUp } from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';
import { useAuth } from '../../context/AuthContext';
import { downloadStoredFile, useSignedUrl } from '../../lib/files';
import { DocumentPreviewModal, DocumentPreviewItem } from './DocumentPreviewModal';

interface DocumentViewerProps {
  files: RequestFile[];
  title?: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ files, title = 'Attached Invoices & Documents' }) => {
  const { isBackendConnected } = useAuth();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showInline, setShowInline] = useState(false);
  const [inlineIndex, setInlineIndex] = useState(0);

  const documentFiles = files.filter((f) => f.kind === 'document');

  if (documentFiles.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-xs font-medium">
        No documents attached to view.
      </div>
    );
  }

  const primaryFile = documentFiles[0];
  const activeInlineFile = documentFiles[inlineIndex] || primaryFile;
  const inlineSigned = useSignedUrl('request-files', activeInlineFile?.storage_path, isBackendConnected);
  const inlineUrl = isBackendConnected ? inlineSigned.url : activeInlineFile.public_url;
  const isInlinePdf = activeInlineFile.mime_type.includes('pdf') || activeInlineFile.original_name.toLowerCase().endsWith('.pdf');

  const handleDownload = async (file: RequestFile) => {
    setDownloadError(null);
    setDownloadingId(file.id);
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
    setDownloadingId(null);
  };

  // Convert RequestFiles to DocumentPreviewItem array for the full-screen modal
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
    <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Top Banner: Matching after-approval SignedDocuments layout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Files className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-sm">{title}</h4>
            <p className="text-xs text-slate-600 mt-0.5">
              <span className="font-semibold text-slate-800">{documentFiles.length} file{documentFiles.length > 1 ? 's' : ''} attached</span>
              {' '}• Review original invoices &amp; documents before signing
            </p>
          </div>
        </div>

        {/* Action Buttons: Preview Document (Eye) & Download */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            id="preview-review-doc-btn"
            onClick={() => setPreviewIndex(0)}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-900 font-bold text-xs shadow-xs transition-all cursor-pointer"
          >
            <Eye className="w-4 h-4 text-indigo-700" />
            <span>Preview Document</span>
          </button>

          <button
            type="button"
            id="download-review-doc-btn"
            onClick={() => handleDownload(primaryFile)}
            disabled={downloadingId === primaryFile.id}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all shrink-0 disabled:opacity-60 cursor-pointer"
          >
            {downloadingId === primaryFile.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>Download</span>
          </button>

          <button
            type="button"
            onClick={() => setShowInline((prev) => !prev)}
            className="p-2.5 rounded-xl border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-800 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title={showInline ? 'Hide quick inline view' : 'Show quick inline view'}
          >
            {showInline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
          {downloadError}
        </div>
      )}

      {/* List of Attached Files (always clear & detailed) */}
      <ul className="divide-y divide-indigo-100 bg-white/80 rounded-xl border border-indigo-100 overflow-hidden">
        {documentFiles.map((file, idx) => {
          const isPdf = file.mime_type.includes('pdf') || file.original_name.toLowerCase().endsWith('.pdf');
          return (
            <li
              key={file.id}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs hover:bg-indigo-50/40 transition-colors"
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  isPdf ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                }`}
              >
                {isPdf ? <FileText className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
              </div>

              <span className="flex-1 truncate font-semibold text-slate-800" title={file.original_name}>
                {file.original_name}
              </span>

              <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                {formatFileSize(file.size_bytes)}
              </span>

              {file.page_count && (
                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                  {file.page_count} pg
                </span>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewIndex(idx)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold text-xs transition-colors cursor-pointer"
                  title={`Preview ${file.original_name}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Preview</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 transition-colors cursor-pointer disabled:opacity-50"
                  title={`Download ${file.original_name}`}
                >
                  {downloadingId === file.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Optional Collapsible Inline View:
          Also equipped with .preview-scrollbars providing both vertical scrollbar on right & horizontal scrollbar at bottom */}
      {showInline && (
        <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden shadow-xs mt-3">
          {documentFiles.length > 1 && (
            <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              {documentFiles.map((file, idx) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setInlineIndex(idx)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                    idx === inlineIndex
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  <span>Doc #{idx + 1}</span>
                  <span className="text-[10px] text-slate-400 font-mono truncate max-w-[90px]">
                    {file.original_name}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="preview-scrollbars h-[480px] bg-slate-950 p-3 select-none flex items-center justify-center">
            {inlineSigned.loading ? (
              <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span>Loading document…</span>
              </div>
            ) : inlineUrl && isInlinePdf ? (
              <div style={{ minWidth: '760px', width: '100%', height: '100%' }}>
                <iframe
                  src={`${inlineUrl}#toolbar=1&navpanes=0`}
                  title={activeInlineFile.original_name}
                  className="w-full h-full border-0 rounded-lg shadow-lg bg-white"
                />
              </div>
            ) : inlineUrl ? (
              <img
                src={inlineUrl}
                alt={activeInlineFile.original_name}
                style={{ minWidth: '560px' }}
                className="max-h-[440px] rounded-lg shadow-lg object-contain bg-white"
              />
            ) : (
              <div className="text-center text-xs text-slate-400">
                {inlineSigned.error || 'Preview not available.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* High-Resolution Document Preview Modal with Dual Scrollbars (Vertical on Right + Horizontal at Bottom) */}
      <DocumentPreviewModal
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        files={previewItems}
        initialIndex={previewIndex ?? 0}
        title={title}
      />
    </div>
  );
};
