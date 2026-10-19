import React from 'react';
import { UserAvatar } from '../common/UserAvatar';
import { RequestRecord } from '../../types/database';
import { ROLE_BADGES, ROLE_LABELS } from '../../lib/formatters';
import { Building2, Store, UserCheck, Briefcase, Calendar } from 'lucide-react';
import { formatISTDate } from '../../lib/formatters';

interface RequesterProfileCardProps {
  request: RequestRecord;
  className?: string;
}

export const RequesterProfileCard: React.FC<RequesterProfileCardProps> = ({
  request,
  className = '',
}) => {
  const photoPath = request.requester?.photo_path ?? request.requester_photo_path ?? null;
  const designation = request.requester?.designation;

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs overflow-hidden transition-all ${className}`}
    >
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5 text-teal-600" />
          <span>Requested Person</span>
        </h3>
        <span
          className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
            ROLE_BADGES[request.requester_role] || 'bg-slate-100 text-slate-700 border-slate-200'
          }`}
        >
          {ROLE_LABELS[request.requester_role] || request.requester_role}
        </span>
      </div>

      {/* Main Requester Details (Mobile & Desktop Responsive) */}
      <div className="flex items-start gap-3.5 sm:gap-4">
        {/* Employee Image Avatar with preview on click */}
        <div className="relative shrink-0">
          <UserAvatar
            photoPath={photoPath}
            name={request.requester_name}
            size="xl"
            previewable
            className="ring-3 ring-slate-100 shadow-md"
          />
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div>
            <h4 className="text-base font-extrabold text-slate-900 font-display leading-tight truncate">
              {request.requester_name}
            </h4>
            {designation && (
              <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-0.5 truncate">
                <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate">{designation}</span>
              </p>
            )}
          </div>

          <div className="pt-1 space-y-1 text-xs">
            {request.department && (
              <div className="flex items-center gap-1.5 text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">
                  <strong>{request.department.name}</strong>
                  {request.department.code ? ` (${request.department.code})` : ''}
                </span>
              </div>
            )}

            {request.shop_name && (
              <div className="flex items-center gap-1.5 text-slate-700">
                <Store className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span className="truncate font-medium text-teal-900">
                  {request.shop_name}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-slate-400 text-[11px] pt-0.5">
              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
              <span>Submitted {formatISTDate(request.submitted_at || request.created_at, false)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
