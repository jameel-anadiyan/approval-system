import React from 'react';
import { RequestStatus, RequestType } from '../../types/database';
import { STATUS_META, TYPE_BADGES, TYPE_LABELS } from '../../lib/formatters';

interface StatusBadgeProps {
  status: RequestStatus;
  size?: 'sm' | 'md' | 'lg';
  showDescription?: boolean;
  /** Discount approvals end at "Approved" (no payment step). */
  requestType?: RequestType | null;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showDescription = false,
  requestType,
}) => {
  const base = STATUS_META[status] || {
    label: status,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    description: '',
  };
  const isNoDisbursement =
    requestType === 'discount' ||
    requestType === 'non_cash' ||
    requestType === 'stock_transfer';

  const meta =
    status === 'approved'
      ? isNoDisbursement
        ? {
            ...base,
            label: 'Approved',
            description:
              requestType === 'stock_transfer'
                ? 'Stock transfer approved and signed. Internal movement complete.'
                : requestType === 'non_cash'
                ? 'Non-cash request approved. No disbursement needed.'
                : 'Discount approved and signed. No payment step.',
          }
        : {
            ...base,
            label: 'Approved (Awaiting Disbursement)',
            description: 'Approved and signed. Stamped PDF ready; awaiting payment.',
          }
      : base;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 rounded-md font-medium',
    md: 'text-xs sm:text-sm px-2.5 py-1 rounded-full font-medium',
    lg: 'text-sm px-3.5 py-1.5 rounded-full font-semibold',
  };

  return (
    <div className="inline-flex flex-col">
      <span
        className={`inline-flex items-center gap-1.5 border transition-all ${meta.badgeClass} ${sizeClasses[size]}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        {meta.label}
      </span>
      {showDescription && meta.description && (
        <span className="text-xs text-slate-500 mt-1">{meta.description}</span>
      )}
    </div>
  );
};

/** Small pill showing General / Discount / Exhibition. */
export const TypeBadge: React.FC<{ type?: RequestType | null; className?: string }> = ({ type, className = '' }) => {
  const t = type ?? 'general';
  return (
    <span
      className={`inline-flex items-center text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${TYPE_BADGES[t]} ${className}`}
    >
      {TYPE_LABELS[t]}
    </span>
  );
};
