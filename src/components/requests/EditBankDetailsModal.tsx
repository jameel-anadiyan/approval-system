import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, DisbursementMode } from '../../types/database';
import { DisbursementModeSelector } from './DisbursementModeSelector';
import { useRequests } from '../../context/RequestContext';
import { errMsg } from '../../lib/errorUtils';
import { Save, Loader2, Building2, CheckCircle2 } from 'lucide-react';

interface EditBankDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
}

export const EditBankDetailsModal: React.FC<EditBankDetailsModalProps> = ({
  isOpen,
  onClose,
  request,
}) => {
  const { updateRequestBankDetails } = useRequests();

  const [mode, setMode] = useState<DisbursementMode>(
    request.disbursement_mode || (request.details?.disbursement_mode as DisbursementMode) || 'cash'
  );
  const [enterLater, setEnterLater] = useState<boolean>(
    Boolean(request.enter_bank_details_later ?? request.details?.enter_bank_details_later ?? false)
  );
  const [accountNumber, setAccountNumber] = useState<string>(
    request.bank_account_no || request.details?.bank_account_no || ''
  );
  const [ifsc, setIfsc] = useState<string>(
    request.bank_ifsc || request.details?.bank_ifsc || ''
  );
  const [bankName, setBankName] = useState<string>(
    request.bank_name || request.details?.bank_name || ''
  );
  const [branch, setBranch] = useState<string>(
    request.bank_branch || request.details?.bank_branch || ''
  );
  const [accountHolderName, setAccountHolderName] = useState<string>(
    request.bank_account_holder_name || request.details?.bank_account_holder_name || ''
  );
  const [isVerified, setIsVerified] = useState<boolean>(
    Boolean(request.bank_verified ?? request.details?.bank_verified ?? false)
  );
  const [verificationMessage, setVerificationMessage] = useState<string | null>(
    request.bank_verification_message || request.details?.bank_verification_message || null
  );

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    if (mode === 'bank' && !enterLater) {
      if (!accountNumber.trim()) {
        setError('Please enter a bank account number or select "Enter bank details later".');
        return;
      }
      if (!ifsc.trim()) {
        setError('Please enter the 11-digit bank IFSC code or select "Enter bank details later".');
        return;
      }
    }

    setIsSaving(true);
    try {
      const res = await updateRequestBankDetails(request.id, {
        disbursement_mode: mode,
        enter_bank_details_later: mode === 'bank' ? enterLater : false,
        bank_account_no: mode === 'bank' && !enterLater ? accountNumber.trim() : null,
        bank_ifsc: mode === 'bank' && !enterLater ? ifsc.trim().toUpperCase() : null,
        bank_name: mode === 'bank' && !enterLater ? bankName.trim() || null : null,
        bank_branch: mode === 'bank' && !enterLater ? branch.trim() || null : null,
        bank_account_holder_name: mode === 'bank' && !enterLater ? accountHolderName.trim() || null : null,
        bank_verified: mode === 'bank' && !enterLater ? isVerified : false,
        bank_verification_message: mode === 'bank' && !enterLater ? verificationMessage : null,
      });

      if (!res.success) {
        setError(res.error || 'Failed to update bank details');
        return;
      }

      setSuccessNotice('Disbursement bank details updated successfully!');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setError(errMsg(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Disbursement & Bank Account Details"
      description="Update payment mode and verified bank account information"
      maxWidth="2xl"
    >
      <form onSubmit={handleSave} className="space-y-4">
        <p className="text-xs text-slate-500">
          Update the payment mode and verified bank account information for request{' '}
          <strong className="text-slate-700 font-mono">{request.request_no || request.title}</strong>.
          Changes can be made until the first payment is released.
        </p>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            {error}
          </div>
        )}

        {successNotice && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{successNotice}</span>
          </div>
        )}

        <DisbursementModeSelector
          mode={mode}
          onModeChange={setMode}
          enterLater={enterLater}
          onEnterLaterChange={setEnterLater}
          accountNumber={accountNumber}
          onAccountNumberChange={setAccountNumber}
          ifsc={ifsc}
          onIfscChange={setIfsc}
          bankName={bankName}
          onBankNameChange={setBankName}
          branch={branch}
          onBranchChange={setBranch}
          accountHolderName={accountHolderName}
          onAccountHolderNameChange={setAccountHolderName}
          isVerified={isVerified}
          onVerifiedChange={setIsVerified}
          verificationMessage={verificationMessage}
          onVerificationMessageChange={setVerificationMessage}
          disabled={isSaving}
        />

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving Details...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Bank Details</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
