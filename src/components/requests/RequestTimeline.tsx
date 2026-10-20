import React from 'react';
import { RequestAction } from '../../types/database';
import { formatISTDate, ACTION_LABELS, ROLE_LABELS, ROLE_BADGES } from '../../lib/formatters';
import {
  CheckCircle2,
  Send,
  CornerDownRight,
  RotateCcw,
  XCircle,
  Banknote,
  Clock,
  ArrowRight,
  Users,
  HelpCircle,
} from 'lucide-react';

interface RequestTimelineProps {
  actions: RequestAction[];
}

export const RequestTimeline: React.FC<RequestTimelineProps> = ({ actions }) => {
  if (!actions || actions.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-slate-400">
        No workflow actions recorded yet.
      </div>
    );
  }

  // Sort chronological (oldest to newest)
  const sorted = [...actions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'submitted':
      case 'resubmitted':
        return <Send className="w-4 h-4 text-blue-600" />;
      case 'routed_A':
      case 'routed_B':
      case 'forwarded':
        return <CornerDownRight className="w-4 h-4 text-indigo-600" />;
      case 'consultation_requested':
        return <Users className="w-4 h-4 text-purple-600" />;
      case 'consultation_agreed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case 'consultation_disagreed':
        return <XCircle className="w-4 h-4 text-rose-600" />;
      case 'disbursement_clarification_requested':
        return <HelpCircle className="w-4 h-4 text-amber-600" />;
      case 'disbursement_clarification_provided':
        return <CheckCircle2 className="w-4 h-4 text-teal-600" />;
      case 'approved':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case 'returned':
        return <RotateCcw className="w-4 h-4 text-amber-600" />;
      case 'rejected':
      case 'withdrawn':
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-rose-600" />;
      case 'paid':
        return <Banknote className="w-4 h-4 text-teal-600" />;
      default:
        return <Clock className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="relative pl-6 space-y-6 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
      {sorted.map((action, idx) => {
        const isLatest = idx === sorted.length - 1;
        const roleLabel = ROLE_LABELS[action.actor_role] || action.actor_role;
        const roleBadge = ROLE_BADGES[action.actor_role] || 'bg-slate-100 text-slate-700';

        return (
          <div key={action.id} className="relative group">
            {/* Timeline icon node */}
            <div
              className={`absolute -left-6 top-0.5 w-6 h-6 rounded-full bg-white border-2 flex items-center justify-center transition-all ${
                isLatest
                  ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-xs'
                  : 'border-slate-300'
              }`}
            >
              {getActionIcon(action.action)}
            </div>

            {/* Event Content */}
            <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/80 hover:bg-slate-50 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                    {action.actor_name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${roleBadge}`}
                  >
                    {roleLabel}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  {formatISTDate(action.created_at)}
                </span>
              </div>

              {/* Action Description */}
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                <span>{ACTION_LABELS[action.action] || action.action}</span>
                {action.from_status && action.to_status && (
                  <span className="text-[11px] text-slate-500 font-normal inline-flex items-center gap-1">
                    ({action.from_status} <ArrowRight className="w-2.5 h-2.5" /> {action.to_status})
                  </span>
                )}
              </div>

              {/* Remarks */}
              {action.remarks && (
                <div className="mt-2 text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/70 italic leading-relaxed">
                  "{action.remarks}"
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
