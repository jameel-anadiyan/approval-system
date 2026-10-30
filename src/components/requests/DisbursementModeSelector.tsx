import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Banknote, Building2, CheckCircle2, AlertTriangle, Loader2, Sparkles, RefreshCw, Info } from 'lucide-react';
import { verifyBankAccount, isValidIfsc, isValidAccountNumber, BankVerificationResult } from '../../lib/bankVerification';

export interface DisbursementModeSelectorProps {
  mode: 'cash' | 'bank';
  onModeChange: (mode: 'cash' | 'bank') => void;
  enterLater: boolean;
  onEnterLaterChange: (later: boolean) => void;
  accountNumber: string;
  onAccountNumberChange: (acc: string) => void;
  ifsc: string;
  onIfscChange: (ifsc: string) => void;
  bankName: string;
  onBankNameChange: (name: string) => void;
  branch: string;
  onBranchChange: (branch: string) => void;
  accountHolderName: string;
  onAccountHolderNameChange: (holder: string) => void;
  isVerified: boolean;
  onVerifiedChange: (verified: boolean) => void;
  verificationMessage?: string | null;
  onVerificationMessageChange?: (msg: string | null) => void;
  disabled?: boolean;
}

export const DisbursementModeSelector: React.FC<DisbursementModeSelectorProps> = ({
  mode,
  onModeChange,
  enterLater,
  onEnterLaterChange,
  accountNumber,
  onAccountNumberChange,
  ifsc,
  onIfscChange,
  bankName,
  onBankNameChange,
  branch,
  onBranchChange,
  accountHolderName,
  onAccountHolderNameChange,
  isVerified,
  onVerifiedChange,
  verificationMessage,
  onVerificationMessageChange,
  disabled = false,
}) => {
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const lastVerifiedKey = useRef<string>('');

  const runVerification = useCallback(
    async (acc: string, ifscCode: string) => {
      const cleanAcc = acc.trim();
      const cleanIfsc = ifscCode.trim().toUpperCase();

      if (!isValidIfsc(cleanIfsc) || !isValidAccountNumber(cleanAcc)) {
        return;
      }

      const currentKey = `${cleanIfsc}:::${cleanAcc}`;
      if (lastVerifiedKey.current === currentKey && isVerified) {
        return;
      }

      setIsVerifying(true);
      setVerifyError(null);

      try {
        const result: BankVerificationResult = await verifyBankAccount(cleanAcc, cleanIfsc);

        if (result.success && result.account_exists) {
          lastVerifiedKey.current = currentKey;
          onVerifiedChange(true);
          onAccountHolderNameChange(result.name_at_bank || '');
          onBankNameChange(result.bank_name || '');
          onBranchChange(result.branch || '');
          if (onVerificationMessageChange) {
            onVerificationMessageChange(result.message || 'Account verified successfully');
          }
          setVerifyError(null);
        } else {
          onVerifiedChange(false);
          if (result.bank_name && !bankName) onBankNameChange(result.bank_name);
          if (result.branch && !branch) onBranchChange(result.branch);
          const errMsg = result.message || 'Invalid account number or IFSC code provided.';
          setVerifyError(errMsg);
          if (onVerificationMessageChange) onVerificationMessageChange(errMsg);
        }
      } catch (err: any) {
        onVerifiedChange(false);
        const errMsg = err?.message || 'Verification service temporarily unavailable.';
        setVerifyError(errMsg);
        if (onVerificationMessageChange) onVerificationMessageChange(errMsg);
      } finally {
        setIsVerifying(false);
      }
    },
    [isVerified, onVerifiedChange, onAccountHolderNameChange, onBankNameChange, onBranchChange, onVerificationMessageChange, bankName, branch]
  );

  // Auto-trigger verification when user completes typing 11-digit IFSC and valid account number
  useEffect(() => {
    if (disabled || mode !== 'bank' || enterLater) return;

    const cleanAcc = accountNumber.trim();
    const cleanIfsc = ifsc.trim().toUpperCase();

    if (isValidIfsc(cleanIfsc) && isValidAccountNumber(cleanAcc)) {
      const timer = setTimeout(() => {
        runVerification(cleanAcc, cleanIfsc);
      }, 700);
      return () => clearTimeout(timer);
    } else {
      if (isVerified) {
        onVerifiedChange(false);
      }
    }
  }, [accountNumber, ifsc, mode, enterLater, disabled, runVerification, isVerified, onVerifiedChange]);

  const handleManualVerify = (e: React.MouseEvent) => {
    e.preventDefault();
    runVerification(accountNumber, ifsc);
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-xs transition-all">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
            {mode === 'bank' ? <Building2 className="w-5 h-5" /> : <Banknote className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 font-display">Disbursement Mode</h3>
            <p className="text-xs text-slate-500">Choose payout method for this request</p>
          </div>
        </div>

        {/* Mode Selector Checkbox / Pill buttons */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange('cash')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              mode === 'cash'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Banknote className="w-3.5 h-3.5" />
            <span>Cash</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange('bank')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              mode === 'bank'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Bank Transfer</span>
          </button>
        </div>
      </div>

      {mode === 'bank' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Option to enter bank details later */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-indigo-50/60 border border-indigo-100">
            <input
              id="enter-bank-details-later"
              type="checkbox"
              disabled={disabled}
              checked={enterLater}
              onChange={(e) => onEnterLaterChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <label htmlFor="enter-bank-details-later" className="text-xs font-medium text-slate-700 cursor-pointer select-none">
              <span className="font-bold text-slate-900 block">Enter bank details later</span>
              <span className="text-slate-600 text-[11px] block mt-0.5">
                You or your regional head, clerk, head, admin, or entry officer can fill/edit bank details anytime before the first payment is released.
              </span>
            </label>
          </div>

          {/* Prominent Transfer Notification Banner (Required by user) */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-bold">Notification:</span>{' '}
              <span>Only requests with bank account details entered will be automatically transferred.</span>
            </div>
          </div>

          {!enterLater ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  Bank Account Information
                </span>
                <span className="text-[11px] text-slate-500 font-medium">Auto-verified via Penny-Less API</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Account Number */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bank Account Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    disabled={disabled}
                    value={accountNumber}
                    onChange={(e) => {
                      onAccountNumberChange(e.target.value.replace(/\s+/g, ''));
                    }}
                    placeholder="e.g. 919010019387396"
                    className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                  />
                </div>

                {/* IFSC Code */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      Bank IFSC Code <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">11 Characters</span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      disabled={disabled}
                      maxLength={11}
                      value={ifsc}
                      onChange={(e) => {
                        onIfscChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      }}
                      placeholder="e.g. UTIB0002006"
                      className="w-full text-xs font-mono uppercase px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                    />
                    {isVerifying && (
                      <div className="absolute right-2.5 top-2.5">
                        <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Verify Button & Status Alert */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={disabled || isVerifying || !accountNumber || !ifsc}
                  onClick={handleManualVerify}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:pointer-events-none rounded-lg border border-indigo-200 transition-colors"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying with Bank...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Verify Account Now</span>
                    </>
                  )}
                </button>

                {isVerified && (
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>✓ Account Verified via Penny-Less</span>
                  </div>
                )}
              </div>

              {verifyError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Verification Error:</span> {verifyError}
                  </div>
                </div>
              )}

              {/* Auto-filled Readonly / Populated Information */}
              {(accountHolderName || bankName || branch || isVerified) && (
                <div className="rounded-xl border border-indigo-100 bg-white p-3.5 space-y-2.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-800 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Beneficiary Details (Auto-filled)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Account Holder Name</span>
                      <span className="font-bold text-slate-900 text-sm mt-0.5 block break-words">
                        {accountHolderName || '—'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Bank Name</span>
                      <span className="font-bold text-slate-800 text-xs mt-0.5 block break-words">
                        {bankName || '—'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Branch</span>
                      <span className="font-bold text-slate-800 text-xs mt-0.5 block break-words">
                        {branch || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center">
              <Info className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700">Bank Details Postponed</p>
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-md mx-auto">
                This request will be marked for Bank Transfer. Authorized staff can provide the verified bank account number and IFSC prior to releasing payment.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
