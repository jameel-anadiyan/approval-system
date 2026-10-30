import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RequestRecord, isDisbursementAssociated } from '../../types/database';
import { formatINR, formatINRWhole, formatISTDate, typeOf } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { StatusBadge, TypeBadge } from '../common/StatusBadge';
import { ChevronRight, Paperclip, Mic, ShieldAlert, Store, UserCheck, HelpCircle, Tag, Trash2, PackageCheck, Truck, Landmark, Banknote } from 'lucide-react';

interface RequestCardProps {
  request: RequestRecord;
  showDepartment?: boolean;
  /** Bulk-approve mode: renders a checkbox instead of navigating on checkbox click. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const RequestCard: React.FC<RequestCardProps> = ({
  request,
  showDepartment = true,
  selectable = false,
  selected = false,
  onToggleSelect,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { threshold, deleteSpecificRequest } = useRequests();
  const rType = typeOf(request);
  const isHighValue = rType === 'general' && request.amount > threshold;

  const docCount = request.files?.filter((f) => f.kind === 'document').length || 0;
  const hasVoiceNote = request.files?.some((f) => f.kind === 'voice_note');
  const latestClarification = (request.disbursement_clarifications || [])[0];
  const isPendingClarification = latestClarification?.status === 'pending_head';

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const reqNo = request.request_no || 'this draft';
    if (!confirm(`Are you sure you want to PERMANENTLY DELETE ${reqNo}?\n\nThis will completely remove it from all departments, including disbursement and clerk queues.`)) {
      return;
    }
    await deleteSpecificRequest(request.id);
  };

  return (
    <div
      onClick={() => navigate(`/requests/${request.id}`)}
      className={`bg-white rounded-2xl border p-4 sm:p-5 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer relative group flex flex-col justify-between gap-3 ${
        selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200/90'
      }`}
    >
      {/* Top Header: Request No & Status Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {selectable && (
            <input
              type="checkbox"
              id={`select-${request.id}`}
              aria-label={`Select ${request.request_no || request.title}`}
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect?.(request.id)}
              className="w-4 h-4 rounded border-slate-300 accent-brand-600 cursor-pointer"
            />
          )}
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
            {request.request_no || 'DRAFT'}
          </span>
          <TypeBadge type={rType} />
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
              Above {formatINRWhole(threshold)}
            </span>
          )}
          {isPendingClarification && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
              <HelpCircle className="w-3 h-3 text-amber-600" />
              Clarification Needed
            </span>
          )}
          {request.category_name && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
              <Tag className="w-3 h-3" />
              {request.category_name}
            </span>
          )}
          {isDisbursementAssociated(rType) && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                request.disbursement_mode === 'bank'
                  ? request.bank_account_no
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              {request.disbursement_mode === 'bank' ? (
                <>
                  <Landmark className="w-3 h-3 text-indigo-600" />
                  <span>{request.bank_account_no ? (request.bank_name ? `Bank: ${request.bank_name}` : 'Bank Transfer') : 'Bank (Details Later)'}</span>
                </>
              ) : (
                <>
                  <Banknote className="w-3 h-3 text-emerald-600" />
                  <span>Cash</span>
                </>
              )}
            </span>
          )}
          {rType === 'stock_transfer' && request.status === 'approved' && (
            request.transfer_completed_at ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                <PackageCheck className="w-3 h-3" />
                Transfer Completed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                <Truck className="w-3 h-3" />
                Awaiting Transfer
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={request.status} requestType={rType} size="sm" />
          {user?.role === 'admin' && (
            <button
              type="button"
              id={`delete-card-${request.id}`}
              onClick={handleDelete}
              className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
              title="Permanently delete request"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
            {rType === 'discount' ? 'Discount' : rType === 'stock_transfer' ? 'Total MRP' : 'Amount'}
          </div>
          <div className="font-bold text-slate-900 text-base font-display">
            {rType === 'non_cash' ? (
              <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">Non Cash</span>
            ) : (
              formatINR(request.amount)
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="font-medium text-slate-700">
            {request.requester_name}
            {showDepartment && request.department && (
              <span className="text-slate-400 font-normal"> • {request.department.code}</span>
            )}
          </div>
          {request.owner_head_name && (
            <div className="text-[11px] text-indigo-700 font-medium flex items-center justify-end gap-1 mt-0.5">
              <UserCheck className="w-3 h-3 text-indigo-500 shrink-0" />
              <span>Head: <strong className="font-semibold text-slate-800">{request.owner_head_name}</strong></span>
            </div>
          )}
          {request.regional_head_name && (
            <div className="text-[11px] text-cyan-800 font-medium flex items-center justify-end gap-1 mt-0.5">
              <UserCheck className="w-3 h-3 text-cyan-600 shrink-0" />
              <span>Regional: <strong className="font-semibold text-slate-800">{request.regional_head_name}</strong></span>
            </div>
          )}
          {request.shop_name && (
            <div className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
              <Store className="w-3 h-3" />
              {request.shop_name}
            </div>
          )}
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
