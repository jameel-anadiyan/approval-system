import React from 'react';
import { RequestStatus } from '../../types/database';
import { STATUS_META } from '../../lib/formatters';

interface StatusBadgeProps {
  status: RequestStatus;
  size?: 'sm' | 'md' | 'lg';
  showDescription?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showDescription = false,
}) => {
  const meta = STATUS_META[status] || {
    label: status,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    description: '',
  };

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
