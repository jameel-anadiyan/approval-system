import React, { useEffect, useState } from 'react';
import { formatINR } from '../../lib/formatters';
import { IndianRupee, Percent } from 'lucide-react';

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
  gstRate = 18,
  onGstRateChange,
}) => {
  const [typedGstStr, setTypedGstStr] = useState<string>(() =>
    gstAmount > 0 ? String(gstAmount) : ''
  );
  const [selectedSlab, setSelectedSlab] = useState<number | null>(() => {
    if (gstRate && STANDARD_RATES.includes(gstRate)) return gstRate;
    return 18;
  });
  const [isCustomPct, setIsCustomPct] = useState<boolean>(() => {
    return Boolean(gstRate && !STANDARD_RATES.includes(gstRate) && gstRate > 0);
  });
  const [customPctStr, setCustomPctStr] = useState<string>(() => {
    return gstRate && !STANDARD_RATES.includes(gstRate) ? String(gstRate) : '';
  });
  const [isManualAmount, setIsManualAmount] = useState<boolean>(false);

  // Sync external changes
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

  // Recalculate amount if baseAmount changes and user hasn't explicitly entered a manual amount
  useEffect(() => {
    if (hasGst && !isManualAmount && baseAmount > 0) {
      const rate = isCustomPct ? (parseFloat(customPctStr) || 0) : (selectedSlab || 18);
      const calculated = Math.round(baseAmount * (rate / 100) * 100) / 100;
      setTypedGstStr(String(calculated));
      onGstAmountChange(calculated);
      onGstRateChange?.(rate);
    }
  }, [baseAmount]);

  const handleSlabClick = (rate: number) => {
    setIsManualAmount(false);
    setIsCustomPct(false);
    setSelectedSlab(rate);
    const calculated = Math.round(baseAmount * (rate / 100) * 100) / 100;
    setTypedGstStr(String(calculated));
    onGstAmountChange(calculated);
    onGstRateChange?.(rate);
  };

  const handleCustomPctToggle = () => {
    setIsManualAmount(false);
    setIsCustomPct(true);
    setSelectedSlab(null);
    const rate = parseFloat(customPctStr) || 0;
    const calculated = Math.round(baseAmount * (rate / 100) * 100) / 100;
    setTypedGstStr(String(calculated));
    onGstAmountChange(calculated);
    onGstRateChange?.(rate);
  };

  const handleCustomPctInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomPctStr(val);
    setIsManualAmount(false);
    setSelectedSlab(null);
    const pct = parseFloat(val) || 0;
    const calculated = Math.round(baseAmount * (pct / 100) * 100) / 100;
    setTypedGstStr(String(calculated));
    onGstAmountChange(calculated);
    onGstRateChange?.(pct);
  };

  const handleManualAmountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setTypedGstStr(valStr);
    setIsManualAmount(true);
    setSelectedSlab(null);
    setIsCustomPct(false);
    const parsed = parseFloat(valStr);
    const amt = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
    onGstAmountChange(amt);
    if (baseAmount > 0 && onGstRateChange) {
      const effRate = amt > 0 ? Math.round((amt / baseAmount) * 10000) / 100 : 0;
      onGstRateChange(effRate);
    }
  };

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
              {isManualAmount ? `~${effectivePct}% Effective GST (Manual/Mixed)` : `GST ${effectivePct}% Applied`}
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
              setIsManualAmount(false);
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
                const defaultRate = selectedSlab || 18;
                const defaultAmt = Math.round(baseAmount * (defaultRate / 100) * 100) / 100;
                setTypedGstStr(String(defaultAmt));
                onGstAmountChange(defaultAmt);
                if (onGstRateChange) onGstRateChange(defaultRate);
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

      {/* Dual Input Controls: Rate Percentage (%) & Manual Amount (₹) */}
      {hasGst && (
        <div className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3.5">
          {/* Option 1: Pick / Enter Percentage Rate (%) */}
          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-indigo-600" />
                <span>GST Rate Percentage (%):</span>
              </span>
              {isManualAmount && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                  Manual Total Active
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {STANDARD_RATES.map((rate) => {
                const isSelected = !isManualAmount && !isCustomPct && selectedSlab === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => handleSlabClick(rate)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                    }`}
                  >
                    {rate}% {rate === 18 ? '(Default)' : ''}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={handleCustomPctToggle}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                  !isManualAmount && isCustomPct
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                }`}
              >
                Custom %
              </button>
            </div>

            {/* Custom % Input field */}
            {!isManualAmount && isCustomPct && (
              <div className="pt-2 flex items-center gap-2">
                <span className="text-xs text-slate-600 font-medium">Custom % Rate:</span>
                <div className="relative w-28">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={customPctStr}
                    onChange={handleCustomPctInput}
                    placeholder="e.g. 18"
                    className="w-full px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden pr-6"
                  />
                  <span className="absolute right-2 top-1 text-xs font-bold text-slate-400 pointer-events-none">
                    %
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-indigo-100/90 w-full" />

          {/* Option 2: Direct / Manual GST Amount (₹) for mixed % items or specific bills */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <IndianRupee className="w-3.5 h-3.5 text-indigo-600" />
                <span>GST Amount in Rupees (₹)</span>
                <span className="text-rose-500">*</span>
              </span>
              {baseAmount > 0 && gstAmount > 0 && (
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
                onChange={handleManualAmountInput}
                placeholder="e.g. 180.00 (or type total GST for mixed % items)"
                className={`w-full pl-7 pr-3 py-2 text-sm font-bold rounded-xl border bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-all ${
                  isManualAmount
                    ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50/20'
                    : 'border-slate-300'
                }`}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {isManualAmount ? (
                <span className="text-amber-700 font-medium">
                  Custom/mixed GST amount entered manually. To revert to a standard rate slab, click one of the % buttons above.
                </span>
              ) : (
                <span>
                  Auto-calculated from rate percentage above. If a single bill has items with different % rates (e.g. 5% and 18%), you can type the total GST amount directly here.
                </span>
              )}
            </p>
          </div>
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
