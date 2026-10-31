import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests, type ActionVoice } from '../../context/RequestContext';
import { formatINR, formatISTDate, typeOf } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { invokeEdgeFunction, supabase } from '../../lib/supabase';
import { downloadStoredFile } from '../../lib/files';
import { sendApprovalWhatsAppNotification } from '../../lib/whatsapp';
import {
  CheckCircle2,
  FileCheck,
  ShieldCheck,
  Download,
  Stamp,
  Sparkles,
  AlertTriangle,
  Eye,
  MessageSquare,
} from 'lucide-react';
import { SignedDocPreviewModal } from '../requests/SignedDocPreviewModal';

interface ApproveModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onApprove: (voice?: ActionVoice | null) => Promise<{ success: boolean; approval_no?: string; error?: string }>;
}

export const ApproveModal: React.FC<ApproveModalProps> = ({
  isOpen,
  onClose,
  request,
  onApprove,
}) => {
  const { user, isBackendConnected } = useAuth();
  const { getRequestById } = useRequests();
  const [step, setStep] = useState<'preview' | 'signing' | 'success'>('preview');
  const [signingProgress, setSigningProgress] = useState(0);
  const [signingMessage, setSigningMessage] = useState('Initializing stamping process…');
  const [generatedApprovalNo, setGeneratedApprovalNo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ seal_url: string | null; signature_url: string | null } | null>(null);
  const [credsLoading, setCredsLoading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ path: string; name: string; approvalNo?: string | null } | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [waStatus, setWaStatus] = useState<string | null>(null);

  // Live: fetch my own seal/signature (short-lived URLs) so the approver sees exactly what gets stamped.
  useEffect(() => {
    if (!isOpen || !isBackendConnected) return;
    setCredsLoading(true);
    invokeEdgeFunction<{ seal_url: string | null; signature_url: string | null }>('credentials', { action: 'view' })
      .then(({ data }) => setCreds(data ?? { seal_url: null, signature_url: null }))
      .finally(() => setCredsLoading(false));
  }, [isOpen, isBackendConnected]);

  const missingCreds = isBackendConnected && !credsLoading && !!creds && (!creds.seal_url || !creds.signature_url);

  const consultations = request.consultations || [];
  const pendingConsultations = consultations.filter((c) => c.status === 'pending');
  const disagreedConsultations = consultations.filter((c) => c.status === 'disagreed');
  const isConsultationBlocked = pendingConsultations.length > 0 || disagreedConsultations.length > 0;

  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const rType = typeOf(request);
  const hasForm = rType !== 'general';
  const uploadedPages = request.files?.filter((f) => f.kind === 'document').reduce((acc, f) => acc + (f.page_count || 1), 0) || 0;
  const documentPagesCount = hasForm ? uploadedPages : uploadedPages || 1;

  const handleStartApproval = async () => {
    if (isConsultationBlocked) return;
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
      const res = await onApprove(voice);
      clearInterval(progressTimer);

      if (res.success) {
        setSigningProgress(100);
        setSigningMessage('Stamping completed successfully!');
        setGeneratedApprovalNo(res.approval_no || null);
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
      setErrorMessage(errMsg(err));
    }
  };

  const handleDownload = async () => {
    if (!isBackendConnected) {
      setErrorMessage('Sandbox mode: the signed packet is only generated on the live server.');
      return;
    }
    // The request list was reloaded after approval; read the fresh record for the packet path.
    const fresh = getRequestById(request.id);
    const packet = fresh?.signed_files?.find((s) => s.is_packet) || fresh?.signed_files?.[0];
    if (!packet) {
      setErrorMessage('Signed packet not found yet. Open the request page and try again.');
      return;
    }
    const res = await downloadStoredFile(
      'signed-documents',
      packet.storage_path,
      packet.file_name || `${generatedApprovalNo || 'approval'}_packet.pdf`
    );
    if (!res.success) setErrorMessage(res.error || 'Download failed');
  };

  const resetAndClose = () => {
    setStep('preview');
    setSigningProgress(0);
    setGeneratedApprovalNo(null);
    setErrorMessage(null);
    setVoice(null);
    setWaStatus(null);
    onClose();
  };

  const handleResendWhatsApp = async () => {
    setWaSending(true);
    setWaStatus(null);
    try {
      const fresh = getRequestById(request.id) || request;
      const packet = fresh.signed_files?.find((s) => s.is_packet) || fresh.signed_files?.[0];
      let url = '';
      if (packet?.storage_path && isBackendConnected) {
        const { data: signUrlData } = await supabase.storage
          .from('signed-documents')
          .createSignedUrl(packet.storage_path, 60 * 60 * 24 * 7);
        url = signUrlData?.signedUrl || '';
      } else if (fresh.files && fresh.files[0]?.storage_path && isBackendConnected) {
        const { data: srcUrlData } = await supabase.storage
          .from('request-files')
          .createSignedUrl(fresh.files[0].storage_path, 60 * 60 * 24 * 7);
        url = srcUrlData?.signedUrl || '';
      }
      const res = await sendApprovalWhatsAppNotification(
        fresh,
        url,
        undefined,
        undefined,
        user?.full_name
      );
      if (res.success) {
        setWaStatus('✅ Delivered to WhatsApp (+91 9846880713 & staff)!');
      } else {
        const errs = res.results.map((r) => r.error).filter(Boolean).join(', ');
        setWaStatus(`WhatsApp: ${errs || 'Failed'}`);
      }
    } catch (e: unknown) {
      setWaStatus(`Error: ${errMsg(e)}`);
    } finally {
      setWaSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title={step === 'success' ? 'Approval Completed' : 'Approve & Digital Sign'}
      description={
        rType === 'stock_transfer'
          ? `Stock Transfer ${request.request_no || ''} · Total MRP: ${formatINR(request.amount)}`
          : `Request ${request.request_no || ''} for ${formatINR(request.amount)}`
      }
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
            {request.owner_head_name && (
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <span className="text-xs font-semibold text-slate-500">Request Owner Head</span>
                <span className="text-xs font-bold text-indigo-900">{request.owner_head_name}</span>
              </div>
            )}
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
                {hasForm ? (rType === 'stock_transfer' ? 'Transfer form + ' : 'Request form + ') : ''}
                {documentPagesCount > 0 ? `${documentPagesCount} doc page${documentPagesCount > 1 ? 's' : ''} + ` : ''}Cover Sheet
              </span>
            </div>
            {rType === 'stock_transfer' && documentPagesCount === 0 && (
              <div className="text-[11px] text-blue-700 bg-blue-50/70 p-2 rounded-lg border border-blue-200">
                No external documents attached. The generated Stock Transfer form will be signed and sealed with official stamp and QR verification.
              </div>
            )}
          </div>

          {/* Credentials Preview: Seal and Signature */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Stamp className="w-4 h-4 text-indigo-600" />
                <span>Credentials on File</span>
              </span>
              {isBackendConnected ? (
                credsLoading ? (
                  <span className="text-[10px] text-slate-500 font-semibold">Checking…</span>
                ) : missingCreds ? (
                  <span className="text-[10px] text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                    Missing
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    On file
                  </span>
                )
              ) : (
                <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                  Sandbox preview
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="border border-dashed border-indigo-200 rounded-xl p-3 text-center bg-indigo-50/30 flex flex-col items-center justify-center min-h-[92px]">
                {isBackendConnected && creds?.seal_url ? (
                  <img src={creds.seal_url} alt="Your official seal" className="h-14 object-contain" />
                ) : (
                  <div className="w-12 h-12 rounded-full border-2 border-indigo-600 flex items-center justify-center text-indigo-700 text-[9px] font-bold uppercase tracking-tighter p-1 shadow-inner text-center leading-none">
                    {isBackendConnected ? 'NO SEAL' : 'OFFICIAL SEAL'}
                  </div>
                )}
                <span className="text-[10px] text-slate-500 font-medium mt-1.5">
                  Authority Seal
                </span>
              </div>

              <div className="border border-dashed border-slate-200 rounded-xl p-3 text-center bg-slate-50/50 flex flex-col items-center justify-center min-h-[92px]">
                {isBackendConnected && creds?.signature_url ? (
                  <img src={creds.signature_url} alt="Your signature" className="h-14 object-contain" />
                ) : (
                  <div className="h-12 flex items-center justify-center font-display italic text-lg text-slate-800 font-bold tracking-wider">
                    {isBackendConnected ? '—' : user?.full_name?.split(' ')[0] || 'Approved'}
                  </div>
                )}
                <span className="text-[10px] text-slate-500 font-medium mt-1.5">
                  Digital Signature
                </span>
              </div>
            </div>

            {isConsultationBlocked && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Inter-department consultation in progress:</span>
                  <p className="mt-0.5">
                    {pendingConsultations.length > 0 && disagreedConsultations.length > 0
                      ? 'Awaiting response from pending heads and received disagreement.'
                      : pendingConsultations.length > 0
                      ? `Waiting for review from ${pendingConsultations.map((c) => c.head_name).join(', ')}.`
                      : `Disagreed by ${disagreedConsultations.map((c) => c.head_name).join(', ')}.`}
                    {' '}Cannot approve until all consulted heads agree.
                  </p>
                </div>
              </div>
            )}

            {missingCreds && (
              <div className="mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Your seal and signature must both be uploaded by the Admin (Admin → Credentials) before you can approve.
                </span>
              </div>
            )}
          </div>

          <ActionVoiceField onChange={setVoice} label="Add a voice message (optional)" />

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
              disabled={isConsultationBlocked || (isBackendConnected && (credsLoading || missingCreds))}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-md shadow-emerald-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
              {rType === 'stock_transfer'
                ? 'Stock transfer approved and signed. Internal movement complete (no disbursement).'
                : rType === 'discount' || rType === 'non_cash'
                ? 'Request approved and signed. No disbursement is needed for this request.'
                : 'All documents stamped and ready for disbursement.'}
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

          {/* WhatsApp Notification Card */}
          <div className="bg-emerald-50/80 border border-emerald-200 p-3.5 rounded-2xl flex items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <span>WhatsApp Notification Dispatched</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5">
                  {waStatus || (
                    <>
                      Approved document & details sent to <span className="font-semibold text-emerald-950">+91 9846880713</span> & staff
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleResendWhatsApp}
              disabled={waSending}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-emerald-300 bg-white hover:bg-emerald-100 text-emerald-800 transition-colors cursor-pointer shrink-0 disabled:opacity-50 shadow-2xs"
            >
              {waSending ? 'Sending…' : 'Resend'}
            </button>
          </div>

          {errorMessage && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl">{errorMessage}</div>
          )}
          {/* Action buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            {(() => {
              const fresh = getRequestById(request.id);
              const packet = fresh?.signed_files?.find((s) => s.is_packet) || fresh?.signed_files?.[0];
              if (!packet) return null;
              return (
                <button
                  type="button"
                  onClick={() =>
                    setPreviewDoc({
                      path: packet.storage_path,
                      name: packet.file_name || `${generatedApprovalNo || 'approval'}_packet.pdf`,
                      approvalNo: generatedApprovalNo,
                    })
                  }
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs transition-all cursor-pointer shadow-xs"
                >
                  <Eye className="w-4 h-4 text-emerald-700" />
                  <span>Preview Approved Doc</span>
                </button>
              );
            })()}
            <button
              type="button"
              onClick={handleDownload}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Stamped Packet</span>
            </button>
            <button
              type="button"
              onClick={resetAndClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Signed Document Preview Modal */}
      <SignedDocPreviewModal
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        storagePath={previewDoc?.path || null}
        fileName={previewDoc?.name || 'signed_approval.pdf'}
        approvalNo={previewDoc?.approvalNo}
      />
    </Modal>
  );
};
