import React, { useState } from 'react';
import { RequestRecord, DisbursementClarification } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { ConsultationVoicePlayer } from './ConsultationVoicePlayer';
import { formatISTDate } from '../../lib/formatters';
import {
  HelpCircle,
  MessageSquare,
  CheckCircle2,
  Clock,
  Send,
  CornerDownLeft,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { RespondClarificationModal } from '../portals/RespondClarificationModal';
import { DisbursementClarificationModal } from '../portals/DisbursementClarificationModal';
import { DocumentViewer } from './DocumentViewer';
import { Paperclip } from 'lucide-react';

interface DisbursementClarificationSectionProps {
  request: RequestRecord;
  isOwningHead: boolean;
}

export const DisbursementClarificationSection: React.FC<DisbursementClarificationSectionProps> = ({
  request,
  isOwningHead,
}) => {
  const { user } = useAuth();
  const [respondingTo, setRespondingTo] = useState<DisbursementClarification | null>(null);
  const [isAskingAgain, setIsAskingAgain] = useState(false);

  const clarifications = request.disbursement_clarifications || [];
  if (clarifications.length === 0) return null;

  const latest = clarifications[0];
  const isPending = latest.status === 'pending_head';
  const isDisbursement = user?.role === 'disbursement';
  const canRespond = isOwningHead && isPending && request.status === 'approved';
  const clarificationFiles = (request.files || []).filter((f) => f.kind === 'document' && f.clarification_id);

  return (
    <div className="space-y-3">
      {/* Active Pending Alert Banner */}
      {isPending ? (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-amber-950 font-display flex items-center gap-1.5">
                  <span>Disbursement Clarification Requested</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900">
                    Payment on hold
                  </span>
                </h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  Disbursement officer <strong>{latest.requested_by_name}</strong> sent this to Head <strong>{latest.head_name}</strong>.
                </p>
              </div>
            </div>

            {canRespond && (
              <button
                type="button"
                id="respond-clarification-btn"
                onClick={() => setRespondingTo(latest)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md shadow-teal-200 transition-all self-start sm:self-auto cursor-pointer"
              >
                <CornerDownLeft className="w-4 h-4" />
                <span>Send Clarification to Disbursement</span>
              </button>
            )}
          </div>

          {/* Question Details */}
          <div className="bg-white/90 rounded-xl p-3.5 border border-amber-200/80 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-500 text-[11px]">
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                <span>Question from Disbursement:</span>
              </span>
              <span>{formatISTDate(latest.created_at)}</span>
            </div>

            {latest.request_note && (
              <p className="text-slate-800 text-xs sm:text-sm font-medium leading-relaxed bg-amber-50/50 p-2.5 rounded-lg border border-amber-100">
                "{latest.request_note}"
              </p>
            )}

            {latest.request_voice_path && (
              <div className="pt-1">
                <span className="text-[11px] font-bold text-amber-900 block mb-1">
                  Audio Message from {latest.requested_by_name}:
                </span>
                <ConsultationVoicePlayer
                  storagePath={latest.request_voice_path}
                  duration={latest.request_voice_duration}
                  title="Disbursement Voice Query"
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200/90 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-teal-200/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-teal-950 font-display flex items-center gap-1.5">
                  <span>Clarification Provided by Head</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-teal-200/70 text-teal-900">
                    Ready for payment
                  </span>
                </h4>
                <p className="text-xs text-teal-800 mt-0.5">
                  Head <strong>{latest.head_name}</strong> responded and sent request back to Disbursement.
                </p>
              </div>
            </div>

            {isDisbursement && request.status === 'approved' && (
              <button
                type="button"
                onClick={() => setIsAskingAgain(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-teal-300 text-teal-800 hover:bg-teal-100 font-semibold text-xs transition-colors self-start sm:self-auto cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Ask Further Question</span>
              </button>
            )}
          </div>

          {/* Question & Answer Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Disbursement Query */}
            <div className="bg-white/80 rounded-xl p-3 border border-slate-200 space-y-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Disbursement Question ({latest.requested_by_name})
              </span>
              {latest.request_note && (
                <p className="text-slate-700 italic">"{latest.request_note}"</p>
              )}
              {latest.request_voice_path && (
                <ConsultationVoicePlayer
                  storagePath={latest.request_voice_path}
                  duration={latest.request_voice_duration}
                  title="Query Audio"
                />
              )}
            </div>

            {/* Head Response */}
            <div className="bg-white rounded-xl p-3 border border-teal-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-teal-900 flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-teal-600" />
                  <span>Head Answer ({latest.responded_by_name || latest.head_name})</span>
                </span>
                <span className="text-slate-400">{formatISTDate(latest.responded_at || latest.updated_at)}</span>
              </div>
              {latest.response_note && (
                <p className="text-slate-800 font-medium">"{latest.response_note}"</p>
              )}
              {latest.response_voice_path && (
                <ConsultationVoicePlayer
                  storagePath={latest.response_voice_path}
                  duration={latest.response_voice_duration}
                  title="Head Audio Response"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {clarificationFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-teal-800 uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5" />
              <span>Files added by Head during clarification</span>
            </h3>
            <span className="text-xs text-slate-400">{clarificationFiles.length} file(s)</span>
          </div>
          <DocumentViewer
            key={clarificationFiles.map((f) => f.id).join(',')}
            files={clarificationFiles}
            title="Clarification Documents"
          />
        </div>
      )}

      {/* Modals */}
      {respondingTo && (
        <RespondClarificationModal
          isOpen={true}
          onClose={() => setRespondingTo(null)}
          request={request}
          clarification={respondingTo}
        />
      )}

      {isAskingAgain && (
        <DisbursementClarificationModal
          isOpen={true}
          onClose={() => setIsAskingAgain(false)}
          request={request}
        />
      )}
    </div>
  );
};
