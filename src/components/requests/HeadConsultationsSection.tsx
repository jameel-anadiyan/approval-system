import React, { useState } from 'react';
import { HeadConsultation } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { UserAvatar } from '../common/UserAvatar';
import { formatISTDate } from '../../lib/formatters';
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Send,
  Loader2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

interface HeadConsultationsSectionProps {
  consultations: HeadConsultation[];
  requestId: string;
}

export const HeadConsultationsSection: React.FC<HeadConsultationsSectionProps> = ({
  consultations,
  requestId,
}) => {
  const { user, role } = useAuth();
  const { respondHeadConsultation } = useRequests();

  const [responseRemarks, setResponseRemarks] = useState('');
  const [submittingAction, setSubmittingAction] = useState<'agreed' | 'disagreed' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!consultations || consultations.length === 0) return null;

  // Check if current logged-in user is one of the consulted heads
  const myConsultation = consultations.find((c) => c.head_id === user?.id);
  const canRespond = myConsultation && myConsultation.status === 'pending';

  const agreedCount = consultations.filter((c) => c.status === 'agreed').length;
  const disagreedCount = consultations.filter((c) => c.status === 'disagreed').length;
  const pendingCount = consultations.filter((c) => c.status === 'pending').length;

  const handleRespond = async (status: 'agreed' | 'disagreed') => {
    if (!myConsultation) return;
    setSubmittingAction(status);
    setError(null);
    try {
      const res = await respondHeadConsultation(
        myConsultation.id,
        status,
        responseRemarks.trim() || undefined
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to submit response');
      }
      setResponseRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingAction(null);
    }
  };

  const firstConsultation = consultations[0];

  return (
    <div className="bg-white rounded-2xl border border-purple-200/90 shadow-xs overflow-hidden">
      {/* Section Header */}
      <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-purple-50/80 to-indigo-50/50 border-b border-purple-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 font-display flex items-center gap-2">
              <span>Inter-Department Head Review</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                {consultations.length} Consulted
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Requested by <strong>{firstConsultation.requested_by_name}</strong>
            </p>
          </div>
        </div>

        {/* Status Pill Summary */}
        <div className="flex items-center gap-2 flex-wrap">
          {agreedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{agreedCount} Agreed</span>
            </span>
          )}
          {disagreedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
              <XCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>{disagreedCount} Disagreed</span>
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>{pendingCount} Pending</span>
            </span>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Forwarder's note/question */}
        {firstConsultation.request_note && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-start gap-2.5">
            <MessageSquare className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-800">Forwarder's Note / Question:</span>
              <p className="mt-0.5 text-slate-600 italic">"{firstConsultation.request_note}"</p>
            </div>
          </div>
        )}

        {/* If the current user is a consulted head awaiting response, show response box */}
        {canRespond && (
          <div className="p-4 bg-indigo-50/70 border-2 border-indigo-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Your Response is Requested</span>
              </span>
              <span className="text-[11px] text-indigo-700 font-medium">
                Choose Agree or Disagree with optional remarks
              </span>
            </div>

            <textarea
              rows={2}
              value={responseRemarks}
              onChange={(e) => setResponseRemarks(e.target.value)}
              placeholder="Add your remarks or reason for Agree / Disagree (optional)..."
              className="w-full text-xs p-3 rounded-xl border border-indigo-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
            />

            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={submittingAction !== null}
                onClick={() => handleRespond('disagreed')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs transition-all disabled:opacity-50 shadow-xs"
              >
                {submittingAction === 'disagreed' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ThumbsDown className="w-3.5 h-3.5" />
                )}
                <span>Disagree</span>
              </button>

              <button
                type="button"
                disabled={submittingAction !== null}
                onClick={() => handleRespond('agreed')}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 transition-all disabled:opacity-50"
              >
                {submittingAction === 'agreed' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="w-3.5 h-3.5" />
                )}
                <span>Agree</span>
              </button>
            </div>
          </div>
        )}

        {/* Consulted Heads Decision Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {consultations.map((c) => {
            const isAgreed = c.status === 'agreed';
            const isDisagreed = c.status === 'disagreed';
            const isPending = c.status === 'pending';

            return (
              <div
                key={c.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all ${
                  isAgreed
                    ? 'bg-emerald-50/30 border-emerald-200'
                    : isDisagreed
                    ? 'bg-rose-50/30 border-rose-200'
                    : 'bg-slate-50/50 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar
                      photoPath={c.head?.photo_path || c.head_photo_path}
                      name={c.head_name}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {c.head_name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {c.department_name || 'Department Head'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      isAgreed
                        ? 'bg-emerald-100 text-emerald-800'
                        : isDisagreed
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {isAgreed && <CheckCircle2 className="w-3 h-3" />}
                    {isDisagreed && <XCircle className="w-3 h-3" />}
                    {isPending && <Clock className="w-3 h-3" />}
                    <span className="capitalize">{c.status}</span>
                  </span>
                </div>

                {/* Remarks & timestamp */}
                {(c.response_remarks || c.responded_at) && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[11px] space-y-1">
                    {c.response_remarks && (
                      <p className="text-slate-700 italic">"{c.response_remarks}"</p>
                    )}
                    {c.responded_at && (
                      <div className="text-[10px] text-slate-400">
                        Responded {formatISTDate(c.responded_at)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
