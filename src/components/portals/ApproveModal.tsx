import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatISTDate } from '../../lib/formatters';
import {
  CheckCircle2,
  FileCheck,
  ShieldCheck,
  Download,
  Stamp,
  Sparkles,
} from 'lucide-react';

interface ApproveModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onApprove: () => Promise<{ success: boolean; approval_no?: string; error?: string }>;
}

export const ApproveModal: React.FC<ApproveModalProps> = ({
  isOpen,
  onClose,
  request,
  onApprove,
}) => {
  const { user } = useAuth();
  const [step, setStep] = useState<'preview' | 'signing' | 'success'>('preview');
  const [signingProgress, setSigningProgress] = useState(0);
  const [signingMessage, setSigningMessage] = useState('Initializing stamping process…');
  const [generatedApprovalNo, setGeneratedApprovalNo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const documentPagesCount = request.files?.reduce((acc, f) => acc + (f.page_count || 1), 0) || 1;

  const handleStartApproval = async () => {
    setStep('signing');
    setSigningProgress(15);
    setSigningMessage('Verifying credentials & acquiring lock…');
    setErrorMessage(null);

    const progressTimer = setInterval(() => {
      setSigningProgress((prev) => {
        if (prev < 40) {
          setSigningMessage('Applying official seal & signature stamps to pages…');
          return prev + 15;
        }
        if (prev < 75) {
          setSigningMessage('Flattening PDF form fields and formatting Unicode ₹ symbols…');
          return prev + 20;
        }
        if (prev < 90) {
          setSigningMessage('Computing cryptographic SHA-256 hash & building approval packet…');
          return prev + 10;
        }
        return prev;
      });
    }, 400);

    try {
      const res = await onApprove();
      clearInterval(progressTimer);

      if (res.success) {
        setSigningProgress(100);
        setSigningMessage('Stamping completed successfully!');
        setGeneratedApprovalNo(res.approval_no || 'APR-2026-000125');
        setTimeout(() => {
          setStep('success');
        }, 500);
      } else {
        setStep('preview');
        setErrorMessage(res.error || 'Failed to complete approval. Please try again.');
      }
    } catch (err: unknown) {
      clearInterval(progressTimer);
      setStep('preview');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = () => {
    alert(`Downloading signed approval packet (${generatedApprovalNo || request.approval_no})...`);
  };

  const resetAndClose = () => {
    setStep('preview');
    setSigningProgress(0);
    setGeneratedApprovalNo(null);
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title={step === 'success' ? 'Approval Completed' : 'Approve & Digital Sign'}
      description={`Request ${request.request_no || ''} for ${formatINR(request.amount)}`}
      maxWidth="md"
    >
      {step === 'preview' && (
        <div className="space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              {errorMessage}
            </div>
          )}

          {/* Stamping Summary Card */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
              <span className="text-xs font-semibold text-slate-500">Approver</span>
              <span className="text-xs font-bold text-slate-800">{user?.full_name}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
              <span className="text-xs font-semibold text-slate-500">Designation</span>
              <span className="text-xs font-medium text-slate-700">{user?.designation || 'Authority'}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
              <span className="text-xs font-semibold text-slate-500">Timestamp</span>
              <span className="text-xs font-mono font-medium text-slate-700">
                {formatISTDate(new Date())}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Pages to Stamp</span>
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                {documentPagesCount} page{documentPagesCount > 1 ? 's' : ''} + Cover Sheet
              </span>
            </div>
          </div>

          {/* Credentials Preview: Seal and Signature */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Stamp className="w-4 h-4 text-indigo-600" />
                <span>Credentials on File</span>
              </span>
              <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Verified PNG
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Simulated Seal Box */}
              <div className="border border-dashed border-indigo-200 rounded-xl p-3 text-center bg-indigo-50/30 flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full border-2 border-indigo-600 flex items-center justify-center text-indigo-700 text-[9px] font-bold uppercase tracking-tighter p-1 shadow-inner text-center leading-none">
                  OFFICIAL SEAL
                </div>
                <span className="text-[10px] text-slate-500 font-medium mt-1.5">
                  Authority Seal
                </span>
              </div>

              {/* Simulated Signature Box */}
              <div className="border border-dashed border-slate-200 rounded-xl p-3 text-center bg-slate-50/50 flex flex-col items-center justify-center">
                <div className="h-12 flex items-center justify-center font-display italic text-lg text-slate-800 font-bold tracking-wider">
                  {user?.full_name?.split(' ')[0] || 'Approved'}
                </div>
                <span className="text-[10px] text-slate-500 font-medium mt-1.5">
                  Digital Signature
                </span>
              </div>
            </div>
          </div>

          {/* Stamping Info note */}
          <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200 leading-relaxed">
            Approving this request will apply the bottom metadata band, your official seal, signature,
            current IST timestamp, and assign the atomic approval number.
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={resetAndClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStartApproval}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 transition-all active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirm & Approve</span>
            </button>
          </div>
        </div>
      )}

      {/* Signing Progress State */}
      {step === 'signing' && (
        <div className="py-8 text-center space-y-5">
          <div className="relative w-16 h-16 mx-auto">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
              <Stamp className="w-6 h-6 animate-pulse" />
            </div>
          </div>

          <div>
            <h3 className="text-base font-bold text-slate-900 font-display">
              Stamping Documents
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">{signingMessage}</p>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              style={{ width: `${signingProgress}%` }}
              className="h-full bg-indigo-600 rounded-full transition-all duration-300"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400">{signingProgress}% completed</span>
        </div>
      )}

      {/* Success State */}
      {step === 'success' && (
        <div className="py-4 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mx-auto shadow-sm">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              Officially Signed
            </span>
            <h3 className="text-lg font-bold text-slate-900 font-display mt-2">
              Request Approved!
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              All documents stamped and ready for disbursement.
            </p>
          </div>

          {/* Generated Approval Number Badge */}
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              Official Approval Number
            </span>
            <span className="font-mono text-lg font-bold text-indigo-700 bg-white px-3 py-1 rounded-lg border border-indigo-200 shadow-xs inline-block">
              {generatedApprovalNo}
            </span>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Download Stamped Packet</span>
            </button>
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
