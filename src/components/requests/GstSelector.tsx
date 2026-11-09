import React, { useEffect, useState } from 'react';
import { formatINR } from '../../lib/formatters';
import { IndianRupee } from 'lucide-react';

const STANDARD_RATES = [5, 12, 18, 28];

export interface GstSelectorProps {
  hasGst: boolean;
  onHasGstChange: (hasGst: boolean) => void;
  gstAmount: number;
  onGstAmountChange: (amount: number) => void;
  baseAmount: number;
  totalAmount: number;
  roundOff?: number;
  baseLabel?: string;
  totalLabel?: string;
  gstRate?: number;
  onGstRateChange?: (rate: number) => void;
}

export const GstSelector: React.FC<GstSelectorProps> = ({
  hasGst,
  onHasGstChange,
  gstAmount,
  onGstAmountChange,
  baseAmount,
  totalAmount,
  roundOff,
  baseLabel = 'Base Amount (Excl. GST)',
  totalLabel = 'Total (Incl. GST)',
  gstRate,
  onGstRateChange,
}) => {
  const [typedGstStr, setTypedGstStr] = useState<string>(() =>
    gstAmount > 0 ? String(gstAmount) : ''
  );

  // Keep local string in sync if parent changes gstAmount externally
  useEffect(() => {
    if (gstAmount > 0) {
      const parsed = parseFloat(typedGstStr);
      if (isNaN(parsed) || Math.abs(parsed - gstAmount) > 0.001) {
        setTypedGstStr(String(gstAmount));
      }
    } else if (!hasGst || gstAmount === 0) {
      if (typedGstStr !== '' && typedGstStr !== '0') {
        setTypedGstStr('');
      }
    }
  }, [gstAmount, hasGst]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setTypedGstStr(valStr);
    const parsed = parseFloat(valStr);
    const amt = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
    onGstAmountChange(amt);
    if (baseAmount > 0 && onGstRateChange) {
      const effRate = amt > 0 ? Math.round((amt / baseAmount) * 10000) / 100 : 0;
      onGstRateChange(effRate);
    }
  };

  const handleQuickFill = (rate: number) => {
    const calculated = Math.round(baseAmount * (rate / 100) * 100) / 100;
    setTypedGstStr(String(calculated));
    onGstAmountChange(calculated);
    if (onGstRateChange) {
      onGstRateChange(rate);
    }
  };

  // Calculate effective rate for display
  const effectivePct =
    baseAmount > 0 && gstAmount > 0
      ? ((gstAmount / baseAmount) * 100).toFixed(2).replace(/\.00$/, '')
      : gstRate
      ? String(gstRate)
      : null;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
          <span>
            Is GST applicable? <span className="text-rose-500">*</span>
          </span>
          {hasGst && effectivePct && (
            <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
              ~{effectivePct}% Effective GST
            </span>
          )}
        </label>

        {/* GST Toggle Buttons: No GST vs Yes, Add GST */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            id="gst-toggle-no"
            onClick={() => {
              onHasGstChange(false);
              onGstAmountChange(0);
              setTypedGstStr('');
              if (onGstRateChange) onGstRateChange(0);
            }}
            className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              !hasGst
                ? 'bg-white border-indigo-600 text-indigo-700 shadow-xs ring-1 ring-indigo-600'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            No GST (0%)
          </button>
          <button
            type="button"
            id="gst-toggle-yes"
            onClick={() => {
              onHasGstChange(true);
              if (gstAmount === 0 && baseAmount > 0) {
                const defaultAmt = Math.round(baseAmount * 0.18 * 100) / 100;
                setTypedGstStr(String(defaultAmt));
                onGstAmountChange(defaultAmt);
                if (onGstRateChange) onGstRateChange(18);
              }
            }}
            className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              hasGst
                ? 'bg-indigo-50 border-indigo-600 text-indigo-700 shadow-xs ring-1 ring-indigo-600'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            Yes, Add GST
          </button>
        </div>
      </div>

      {/* Typed GST Amount Input Field (When GST is applicable) */}
      {hasGst && (
        <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <IndianRupee className="w-3.5 h-3.5 text-indigo-600" />
                <span>GST Amount in Rupees (₹)</span>
                <span className="text-rose-500">*</span>
              </span>
              {effectivePct && (
                <span className="text-[11px] font-medium text-slate-500">
                  Approx. {effectivePct}% of base
                </span>
              )}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400 pointer-events-none">
                ₹
              </span>
              <input
                type="number"
                min="0"
                step="any"
                id="typed-gst-amount-input"
                value={typedGstStr}
                onChange={handleInputChange}
                placeholder="Type exact GST amount from bill (e.g. 180.00)"
                className="w-full pl-7 pr-3 py-2 text-sm font-bold rounded-xl border border-slate-300 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Type the exact GST amount shown on the bill/tax invoice copy.
            </p>
          </div>

          {/* Quick Auto-Fill Buttons based on standard slabs */}
          {baseAmount > 0 && (
            <div className="pt-2 border-t border-indigo-100/80">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-500 mr-0.5">
                  Quick calculate:
                </span>
                {STANDARD_RATES.map((rate) => {
                  const calculated = Math.round(baseAmount * (rate / 100) * 100) / 100;
                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleQuickFill(rate)}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 transition-colors cursor-pointer"
                      title={`Auto-fill ${rate}% GST: ₹${calculated}`}
                    >
                      {rate}% (₹{calculated})
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Real-time Calculation Breakdown */}
      {baseAmount > 0 && (
        <div className="pt-2 border-t border-slate-200/80 space-y-1.5 text-xs text-slate-600">
          <div className="flex justify-between items-center">
            <span>{baseLabel}:</span>
            <span className="font-mono font-medium">{formatINR(baseAmount)}</span>
          </div>

          {hasGst && (
            <div className="flex justify-between items-center text-indigo-700 font-medium">
              <span>GST Amount:</span>
              <span className="font-mono font-bold">+{formatINR(gstAmount)}</span>
            </div>
          )}

          {roundOff !== undefined && roundOff !== 0 && (
            <div className="flex justify-between items-center text-slate-500 text-[11px]">
              <span>Round-off (nearest ₹1):</span>
              <span className="font-mono font-semibold">
                {roundOff > 0 ? `+${formatINR(roundOff)}` : `-${formatINR(Math.abs(roundOff))}`}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center pt-1 border-t border-dashed border-slate-200 text-sm font-bold text-slate-900">
            <div>
              <span>{totalLabel}:</span>
              <span className="block text-[10px] font-normal text-slate-500">
                (Rounded to nearest ₹1)
              </span>
            </div>
            <span className="font-mono text-indigo-600 font-extrabold text-base">
              {formatINR(totalAmount)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
