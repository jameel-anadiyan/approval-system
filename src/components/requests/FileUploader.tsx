import React, { useRef } from 'react';
import { UploadCloud, Camera, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';
import { RequestFile } from '../../types/database';
import { formatFileSize } from '../../lib/formatters';

interface FileUploaderProps {
  files: RequestFile[];
  onAddFiles: (newFiles: RequestFile[]) => void;
  onRemoveFile: (fileId: string) => void;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  files,
  onAddFiles,
  onRemoveFile,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (incomingFiles: FileList | null) => {
    if (!incomingFiles || incomingFiles.length === 0) return;

    const validFiles: RequestFile[] = [];

    Array.from(incomingFiles).forEach((file) => {
      // Validate file size: 15 MB cap per build plan
      if (file.size > 15 * 1024 * 1024) {
        alert(`File ${file.name} is too large. Maximum size is 15 MB.`);
        return;
      }

      // Validate allowed formats
      const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowed.includes(file.type)) {
        alert(`Format ${file.type} is not supported. Please upload PDF, JPG, or PNG.`);
        return;
      }

      const tempUrl = URL.createObjectURL(file);

      validFiles.push({
        id: `file-temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        request_id: 'draft',
        kind: 'document',
        storage_path: `uploads/${file.name}`,
        original_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        page_count: file.type === 'application/pdf' ? 1 : 1,
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
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
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
            Upload PDF or Photo
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            PDF, JPG, PNG up to 15 MB
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
          <label className="text-xs font-semibold text-slate-600 block">
            Attached Documents ({files.length})
          </label>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
            {files.map((file) => {
              const isPdf = file.mime_type.includes('pdf');
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
                          : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                      }`}
                    >
                      {isPdf ? (
                        <FileText className="w-4 h-4" />
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

                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => onRemoveFile(file.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                      title="Remove file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
