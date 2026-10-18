import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RequestRecord } from '../../types/database';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { StatusBadge } from '../common/StatusBadge';
import { ChevronRight, Paperclip, Mic, ShieldAlert } from 'lucide-react';

interface RequestCardProps {
  request: RequestRecord;
  showDepartment?: boolean;
}

export const RequestCard: React.FC<RequestCardProps> = ({ request, showDepartment = true }) => {
  const navigate = useNavigate();
  const isHighValue = request.amount > 10000;

  const docCount = request.files?.filter((f) => f.kind === 'document').length || 0;
  const hasVoiceNote = request.files?.some((f) => f.kind === 'voice_note');

  return (
    <div
      onClick={() => navigate(`/requests/${request.id}`)}
      className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer relative group flex flex-col justify-between gap-3"
    >
      {/* Top Header: Request No & Status Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
            {request.request_no || 'DRAFT'}
          </span>
          {request.route && (
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                request.route === 'A'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-purple-50 text-purple-700 border border-purple-200'
              }`}
            >
              Route {request.route}
            </span>
          )}
          {isHighValue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
              <ShieldAlert className="w-3 h-3 text-amber-600" />
              Above ₹10k
            </span>
          )}
        </div>
        <StatusBadge status={request.status} size="sm" />
      </div>

      {/* Main Content: Title & Notes preview */}
      <div>
        <h3 className="font-semibold text-slate-900 text-sm sm:text-base group-hover:text-indigo-600 transition-colors line-clamp-2 leading-snug">
          {request.title}
        </h3>
        {request.notes && (
          <p className="text-xs text-slate-500 line-clamp-1 mt-1 leading-relaxed">
            {request.notes}
          </p>
        )}
      </div>

      {/* Footer: Amount & Metadata */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Amount
          </div>
          <div className="font-bold text-slate-900 text-base font-display">
            {formatINR(request.amount)}
          </div>
        </div>

        <div className="text-right">
          <div className="font-medium text-slate-700">
            {request.requester_name}
            {showDepartment && request.department && (
              <span className="text-slate-400 font-normal"> • {request.department.code}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            {formatISTDate(request.submitted_at || request.created_at, false)}
          </div>
        </div>
      </div>

      {/* Attachments indicators & Chevron */}
      <div className="flex items-center justify-between text-slate-400 pt-1 text-[11px]">
        <div className="flex items-center gap-2">
          {docCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              <span>{docCount}</span>
            </span>
          )}
          {hasVoiceNote && (
            <span className="flex items-center gap-0.5 text-indigo-600 font-medium">
              <Mic className="w-3.5 h-3.5" />
              <span>Voice</span>
            </span>
          )}
          {request.approval_no && (
            <span className="font-mono text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded-sm">
              {request.approval_no}
            </span>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
};
