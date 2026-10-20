import React, { useState } from 'react';
import { HeadConsultation } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { UserAvatar } from '../common/UserAvatar';
import { ActionVoiceField } from './ActionVoiceField';
import { ConsultationVoicePlayer } from './ConsultationVoicePlayer';
import { formatISTDate } from '../../lib/formatters';
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Edit3,
  X,
  RotateCcw,
} from 'lucide-react';

interface HeadConsultationsSectionProps {
  consultations: HeadConsultation[];
  requestId: string;
  canRequestMore?: boolean;
  requestStatus?: string;
  onRequestMore?: () => void;
  ownerHeadName?: string;
}

export const HeadConsultationsSection: React.FC<HeadConsultationsSectionProps> = ({
  consultations,
  requestId: _requestId,
  canRequestMore = false,
  requestStatus,
  onRequestMore,
  ownerHeadName,
}) => {
  const { user } = useAuth();
  const { respondHeadConsultation } = useRequests();

  const [responseRemarks, setResponseRemarks] = useState('');
  const [responseVoice, setResponseVoice] = useState<ActionVoice | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<'agreed' | 'disagreed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  if (!consultations || consultations.length === 0) return null;

  // Check if current logged-in user is one of the consulted heads
  const myConsultation = consultations.find((c) => c.head_id === user?.id);
  const isFinalized = requestStatus
    ? ['approved', 'rejected', 'paid', 'withdrawn', 'cancelled'].includes(requestStatus)
    : false;
  const isPending = myConsultation?.status === 'pending';
  const canRevise = Boolean(myConsultation && !isPending && !isFinalized);

  const agreedCount = consultations.filter((c) => c.status === 'agreed').length;
  const disagreedCount = consultations.filter((c) => c.status === 'disagreed').length;
  const pendingCount = consultations.filter((c) => c.status === 'pending').length;

  const handleRespond = async (status: 'agreed' | 'disagreed') => {
    if (!myConsultation) return;
    setSubmittingAction(status);
    setError(null);
    setSuccessBanner(null);
    try {
      const res = await respondHeadConsultation(
        myConsultation.id,
        status,
        responseRemarks.trim() || undefined,
        responseVoice,
        _requestId
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to submit response');
      }
      setIsRevising(false);
      setResponseVoice(null);
      setSuccessBanner(
        isPending
          ? `Recorded your response as ${status.toUpperCase()}.`
          : `Revised your decision to ${status.toUpperCase()}.`
      );
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
              Request Owner Head: <strong className="text-indigo-950 font-bold">{ownerHeadName || firstConsultation.requested_by_name}</strong>
              {ownerHeadName && firstConsultation.requested_by_name !== ownerHeadName && (
                <span className="text-slate-400"> (Forwarded by {firstConsultation.requested_by_name})</span>
              )}
            </p>
          </div>
        </div>

        {/* Status Pill Summary & Request More (only for Owning Head / Admin) */}
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

          {onRequestMore && canRequestMore && (
            <button
              type="button"
              id="request-other-head-card-btn"
              onClick={onRequestMore}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Request Other Head</span>
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Success Banner */}
        {successBanner && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
            <span>{successBanner}</span>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="font-bold text-emerald-700 hover:text-emerald-900"
            >
              ×
            </button>
          </div>
        )}

        {/* Forwarder's note/question and audio record */}
        {(firstConsultation.request_note || firstConsultation.request_voice_path) && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-2">
            <div className="flex items-start gap-2.5">
              <MessageSquare className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-800">Forwarder's Note / Question:</span>
                {firstConsultation.request_note ? (
                  <p className="mt-0.5 text-slate-600 italic">"{firstConsultation.request_note}"</p>
                ) : (
                  <p className="mt-0.5 text-slate-500 italic">Audio record attached below</p>
                )}
              </div>
            </div>

            {firstConsultation.request_voice_path && (
              <div className="pt-2 border-t border-slate-200/80">
                <ConsultationVoicePlayer
                  storagePath={firstConsultation.request_voice_path}
                  duration={firstConsultation.request_voice_duration}
                  title={`Audio Record from ${firstConsultation.requested_by_name}`}
                />
              </div>
            )}
          </div>
        )}

        {/* Case 1: Current user is a consulted head awaiting initial response */}
        {myConsultation && isPending && (
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

            <div>
              <ActionVoiceField
                onChange={setResponseVoice}
                label="Voice response (optional)"
              />
            </div>

            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                id="consultation-disagree-btn"
                disabled={submittingAction !== null}
                onClick={() => handleRespond('disagreed')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs transition-all disabled:opacity-50 shadow-xs cursor-pointer"
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
                id="consultation-agree-btn"
                disabled={submittingAction !== null}
                onClick={() => handleRespond('agreed')}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 transition-all disabled:opacity-50 cursor-pointer"
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

        {/* Case 2: Current user already responded, display their decision with revision option */}
        {myConsultation && !isPending && (
          <div
            className={`p-4 rounded-2xl border transition-all ${
              myConsultation.status === 'agreed'
                ? 'bg-emerald-50/60 border-emerald-300'
                : 'bg-rose-50/60 border-rose-300'
            }`}
          >
            {!isRevising ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-slate-800">
                      Your Consultation Decision:
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                        myConsultation.status === 'agreed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}
                    >
                      {myConsultation.status === 'agreed' ? (
                        <ThumbsUp className="w-3 h-3" />
                      ) : (
                        <ThumbsDown className="w-3 h-3" />
                      )}
                      <span>{myConsultation.status}</span>
                    </span>
                  </div>

                  {myConsultation.response_remarks ? (
                    <p className="text-xs text-slate-700 italic">
                      "{myConsultation.response_remarks}"
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">No remarks provided</p>
                  )}

                  {myConsultation.responded_at && (
                    <div className="text-[10px] text-slate-500">
                      Responded {formatISTDate(myConsultation.responded_at)}
                    </div>
                  )}
                </div>

                {canRevise && (
                  <button
                    type="button"
                    id="revise-decision-btn"
                    onClick={() => {
                      setResponseRemarks(myConsultation.response_remarks || '');
                      setIsRevising(true);
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:border-purple-400 text-slate-700 hover:text-purple-700 font-bold text-xs shadow-xs transition-all shrink-0 cursor-pointer self-start sm:self-auto"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-purple-600" />
                    <span>Change / Revise Decision</span>
                  </button>
                )}
              </div>
            ) : (
              /* Inline Revision Form */
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-bold text-slate-900">
                      Revise Your Decision (Currently:{' '}
                      <strong className="uppercase">{myConsultation.status}</strong>)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsRevising(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-xs font-bold inline-flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-600">
                  You can change between Agree and Disagree or update your remarks. Revising will
                  update the record and notify the owning head.
                </p>

                <textarea
                  rows={2}
                  value={responseRemarks}
                  onChange={(e) => setResponseRemarks(e.target.value)}
                  placeholder="Update your remarks or reason for this change..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-hidden"
                />

                <div>
                  <ActionVoiceField
                    onChange={setResponseVoice}
                    label="Voice response (optional)"
                  />
                </div>

                {error && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={submittingAction !== null}
                    onClick={() => setIsRevising(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold text-xs transition-colors"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={submittingAction !== null}
                    onClick={() => handleRespond('disagreed')}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-xs transition-all disabled:opacity-50 cursor-pointer ${
                      myConsultation.status === 'disagreed'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'bg-white border border-rose-300 text-rose-700 hover:bg-rose-50'
                    }`}
                  >
                    {submittingAction === 'disagreed' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ThumbsDown className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {myConsultation.status === 'disagreed'
                        ? 'Update Remarks (Keep Disagreed)'
                        : 'Switch to Disagree'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={submittingAction !== null}
                    onClick={() => handleRespond('agreed')}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-xs transition-all disabled:opacity-50 cursor-pointer ${
                      myConsultation.status === 'agreed'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {submittingAction === 'agreed' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ThumbsUp className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {myConsultation.status === 'agreed'
                        ? 'Update Remarks (Keep Agreed)'
                        : 'Switch to Agree'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Consulted Heads Decision Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {consultations.map((c) => {
            const isAgreed = c.status === 'agreed';
            const isDisagreed = c.status === 'disagreed';
            const isPendingConsult = c.status === 'pending';
            const isSelf = c.head_id === user?.id;

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
                      <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">
                        <span>{c.head_name}</span>
                        {isSelf && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-purple-100 text-purple-800">
                            You
                          </span>
                        )}
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
                    {isPendingConsult && <Clock className="w-3 h-3" />}
                    <span className="capitalize">{c.status}</span>
                  </span>
                </div>

                {/* Remarks, audio, & timestamp */}
                {(c.response_remarks || c.response_voice_path || c.responded_at) && (
                  <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[11px] space-y-1.5">
                    {c.response_remarks && (
                      <p className="text-slate-700 italic">"{c.response_remarks}"</p>
                    )}
                    {c.response_voice_path && (
                      <ConsultationVoicePlayer
                        storagePath={c.response_voice_path}
                        duration={c.response_voice_duration}
                        title={`Voice note from ${c.head_name}`}
                      />
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
