import React, { useState } from 'react';
import { RequestRecord } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { formatISTDate } from '../../lib/formatters';
import {
  AlertTriangle,
  FileCheck2,
  FileText,
  UploadCloud,
  CheckCircle,
  Eye,
  Loader2,
  Clock,
} from 'lucide-react';
import { SubmitMissingBillModal } from '../portals/SubmitMissingBillModal';
import { SignedDocPreviewModal } from './SignedDocPreviewModal';

interface BillMissingBannerProps {
  request: RequestRecord;
  onRefresh?: () => void;
  compact?: boolean;
}

export const BillMissingBanner: React.FC<BillMissingBannerProps> = ({
  request,
  onRefresh,
  compact = false,
}) => {
  const { user } = useAuth();
  const { markBillReceived } = useRequests();

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [markingReceived, setMarkingReceived] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string } | null>(null);
  const [receiveNote, setReceiveNote] = useState('');
  const [isReceivePromptOpen, setIsReceivePromptOpen] = useState(false);

  if (!request.is_bill_missing) return null;

  const isAdmin = user?.role === 'admin';
  const isEntry = user?.role === 'disbursement'; // Entry account
  const isSubmitted = request.bill_missing_status === 'submitted';

  const handleMarkReceived = async () => {
    setMarkingReceived(true);
    try {
      const res = await markBillReceived(request.id, receiveNote);
      if (res.success) {
        setIsReceivePromptOpen(false);
        onRefresh?.();
      }
    } finally {
      setMarkingReceived(false);
    }
  };

  return (
    <>
      <div
        className={`rounded-2xl border transition-all ${
          isSubmitted
            ? 'bg-amber-50/80 border-amber-300 text-amber-950'
            : 'bg-rose-50/90 border-rose-300 shadow-md shadow-rose-500/10 text-rose-950 ring-1 ring-rose-400/40'
        } ${compact ? 'p-3 text-xs' : 'p-4 text-xs sm:text-sm'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                isSubmitted
                  ? 'bg-amber-500 text-white'
                  : 'bg-rose-600 text-white animate-pulse'
              }`}
            >
              {isSubmitted ? (
                <Clock className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0 space-y-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-rose-900 flex items-center gap-1.5">
                  <span>Original Bill Not Attached</span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                  </span>
                </span>

                {isSubmitted ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300">
                    Bill Submitted · Awaiting Entry Review
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 border border-rose-300">
                    Bill Missing
                  </span>
                )}

                {request.bill_missing_at && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    Flagged {formatISTDate(request.bill_missing_at)}
                  </span>
                )}
              </div>

              {request.bill_missing_note && (
                <div className="p-2.5 rounded-xl bg-white/80 border border-rose-200 text-xs text-rose-900">
                  <span className="font-bold text-rose-950">
                    Note from {request.bill_missing_by_name || 'Entry Officer'}:{' '}
                  </span>
                  <span>{request.bill_missing_note}</span>
                </div>
              )}

              {/* Submitted Bill Information */}
              {isSubmitted && (
                <div className="p-2.5 rounded-xl bg-amber-100/70 border border-amber-300 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2 mt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="font-semibold truncate">
                      {request.bill_submitted_file_name || 'Attached Bill Document'}
                    </span>
                    {request.bill_submitted_by_name && (
                      <span className="text-[11px] text-amber-800">
                        by {request.bill_submitted_by_name}
                      </span>
                    )}
                  </div>

                  {request.bill_submitted_file_path && (
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewDoc({
                          path: request.bill_submitted_file_path!,
                          name: request.bill_submitted_file_name || 'Submitted_Bill.pdf',
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview Bill</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0 self-center sm:self-auto">
            {/* If user can attach bill (Requester, Dept, etc.) */}
            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>{isSubmitted ? 'Re-upload Bill' : 'Attach & Submit Bill'}</span>
            </button>

            {/* If Entry Officer or Admin can mark as received */}
            {(isEntry || isAdmin) && (
              <button
                type="button"
                disabled={markingReceived}
                onClick={() => setIsReceivePromptOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {markingReceived ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5" />
                )}
                <span>Mark as Bill Received</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal for receiving bill confirmation */}
        {isReceivePromptOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-2.5 text-slate-900 font-bold text-sm">
                <FileCheck2 className="w-5 h-5 text-emerald-600" />
                <span>Confirm Original Bill Received</span>
              </div>
              <p className="text-xs text-slate-600">
                Are you sure you want to mark this request's original bill as received? This will clear the missing bill status across all user dashboards.
              </p>
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Optional Resolution Note:
                </label>
                <input
                  type="text"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                  placeholder="e.g. Original invoice verified and filed"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 outline-hidden focus:border-emerald-500 bg-white"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsReceivePromptOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={markingReceived}
                  onClick={handleMarkReceived}
                  className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                >
                  {markingReceived ? 'Marking…' : 'Yes, Mark as Bill Received'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Upload Missing Bill Modal */}
      <SubmitMissingBillModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        request={request}
        onSuccess={onRefresh}
      />

      {/* Preview Modal for Submitted File */}
      {previewDoc && (
        <SignedDocPreviewModal
          isOpen={Boolean(previewDoc)}
          onClose={() => setPreviewDoc(null)}
          storagePath={previewDoc.path}
          fileName={previewDoc.name}
          approvalNo={request.approval_no}
        />
      )}
    </>
  );
};
