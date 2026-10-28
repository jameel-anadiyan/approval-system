import React, { useId } from 'react';
import { KeyRound } from 'lucide-react';

export const isValidPasskey = (v: string) => /^\d{4}$/.test(v);

interface PasskeyFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  id?: string;
  /** Mask the digits (default). Set false when an Admin is *choosing* a passkey. */
  masked?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Plain 4-digit passkey box (digits only, no spinner, optionally masked). */
export const PasskeyField: React.FC<PasskeyFieldProps> = ({
  value,
  onChange,
  label = 'Your 4-digit Passkey',
  hint,
  id,
  masked = true,
  autoFocus,
  required = true,
  invalid,
  className = '',
}) => {
  const autoId = useId();
  const fieldId = id || `passkey-${autoId}`;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1">
          <KeyRound className="w-3.5 h-3.5 text-slate-500" />
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <input
        id={fieldId}
        type={masked ? 'password' : 'text'}
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        autoComplete="off"
        autoFocus={autoFocus}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="••••"
        className={`w-full text-base font-bold font-mono tracking-[0.5em] text-center p-2.5 rounded-xl border bg-white outline-hidden focus:ring-1 ${
          invalid
            ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
            : 'border-slate-200 focus:border-sky-500 focus:ring-sky-500'
        }`}
      />
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
};
