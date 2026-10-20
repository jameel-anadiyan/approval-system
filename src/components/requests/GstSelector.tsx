import React, { useState } from 'react';
import { formatINR } from '../../lib/formatters';
import { Percent } from 'lucide-react';

const STANDARD_RATES = [5, 12, 18, 28];

interface GstSelectorProps {
  hasGst: boolean;
  onHasGstChange: (hasGst: boolean) => void;
  gstRate: number;
  onGstRateChange: (rate: number) => void;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  baseLabel?: string;
  totalLabel?: string;
}

export const GstSelector: React.FC<GstSelectorProps> = ({
  hasGst,
  onHasGstChange,
  gstRate,
  onGstRateChange,
  baseAmount,
  gstAmount,
  totalAmount,
  baseLabel = 'Base Amount (Excl. GST)',
  totalLabel = 'Total (Incl. GST)',
}) => {
  const [isCustomRate, setIsCustomRate] = useState(!STANDARD_RATES.includes(gstRate));

  const handleSelectStandardRate = (rate: number) => {
    setIsCustomRate(false);
    onGstRateChange(rate);
  };

  const handleCustomRateToggle = () => {
    setIsCustomRate(true);
  };

  const handleCustomRateInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      onGstRateChange(val);
    } else if (e.target.value === '') {
      onGstRateChange(0);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
          <span>
            Is GST applicable? <span className="text-rose-500">*</span>
          </span>
          {hasGst && (
            <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
              GST {gstRate}% Applied
            </span>
          )}
        </label>

        {/* GST Toggle Buttons: No GST vs Yes, Add GST (18% default) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            id="gst-toggle-no"
            onClick={() => onHasGstChange(false)}
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
              if (!gstRate) onGstRateChange(18);
            }}
            className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              hasGst
                ? 'bg-indigo-50 border-indigo-600 text-indigo-700 shadow-xs ring-1 ring-indigo-600'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            Yes, Add GST (18% Default)
          </button>
        </div>
      </div>

      {/* Slabs / Rate Selector (when GST is applicable) */}
      {hasGst && (
        <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <Percent className="w-3 h-3 text-indigo-600" />
              <span>Select GST Rate Slab (Change if needed):</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {STANDARD_RATES.map((rate) => {
              const isSelected = !isCustomRate && gstRate === rate;
              return (
                <button
                  key={rate}
                  type="button"
                  id={`gst-rate-${rate}`}
                  onClick={() => handleSelectStandardRate(rate)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
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
              id="gst-rate-custom-toggle"
              onClick={handleCustomRateToggle}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                isCustomRate
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              Custom %
            </button>
          </div>

          {/* Custom % input field */}
          {isCustomRate && (
            <div className="pt-1 flex items-center gap-2">
              <span className="text-xs text-slate-600 font-medium">Custom Rate:</span>
              <div className="relative w-28">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={gstRate}
                  onChange={handleCustomRateInput}
                  className="w-full px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden pr-6"
                  placeholder="e.g. 18"
                />
                <span className="absolute right-2 top-1 text-xs font-bold text-slate-400 pointer-events-none">
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Real-time Calculation Breakdown */}
      {baseAmount > 0 && hasGst && (
        <div className="pt-2 border-t border-slate-200/80 space-y-1.5 text-xs text-slate-600">
          <div className="flex justify-between items-center">
            <span>{baseLabel}:</span>
            <span className="font-mono font-medium">{formatINR(baseAmount)}</span>
          </div>
          <div className="flex justify-between items-center text-indigo-700 font-medium">
            <span>GST @ {gstRate}%:</span>
            <span className="font-mono font-bold">+{formatINR(gstAmount)}</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-dashed border-slate-200 text-sm font-bold text-slate-900">
            <span>{totalLabel}:</span>
            <span className="font-mono text-indigo-600 font-extrabold">{formatINR(totalAmount)}</span>
          </div>
        </div>
      )}

      {baseAmount > 0 && !hasGst && (
        <div className="pt-2 border-t border-slate-200/80 flex justify-between items-center text-sm font-bold text-slate-900">
          <span className="text-xs text-slate-600">Total Payable Amount (No GST):</span>
          <span className="font-mono text-indigo-600 font-extrabold">{formatINR(totalAmount)}</span>
        </div>
      )}
    </div>
  );
};
