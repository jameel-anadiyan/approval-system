import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { formatINR, formatISTDate, typeOf } from '../../lib/formatters';
import { StatusBadge, TypeBadge } from '../../components/common/StatusBadge';
import { UserAvatar } from '../../components/common/UserAvatar';
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  MessageSquare,
  Send,
  Inbox,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from 'lucide-react';

export const HeadConsultationsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, respondHeadConsultation } = useRequests();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [filter, setFilter] = useState<'all' | 'pending' | 'responded'>('all');
  const [actingId, setActingId] = useState<string | null>(null);

  // Consultations received by current user (where head_id = user.id)
  const receivedConsultations: { consultation: any; request: any }[] = [];
  // Consultations initiated by current user (where requested_by = user.id)
  const sentConsultations: { consultation: any; request: any }[] = [];

  requests.forEach((r) => {
    (r.consultations || []).forEach((c) => {
      if (c.head_id === user?.id) {
        receivedConsultations.push({ consultation: c, request: r });
      }
      if (c.requested_by === user?.id) {
        sentConsultations.push({ consultation: c, request: r });
      }
    });
  });

  const pendingReceivedCount = receivedConsultations.filter(
    (item) => item.consultation.status === 'pending'
  ).length;

  const filteredReceived = receivedConsultations.filter((item) => {
    if (filter === 'pending') return item.consultation.status === 'pending';
    if (filter === 'responded') return item.consultation.status !== 'pending';
    return true;
  });

  const handleQuickRespond = async (
    e: React.MouseEvent,
    consultationId: string,
    status: 'agreed' | 'disagreed'
  ) => {
    e.stopPropagation();
    setActingId(consultationId);
    try {
      await respondHeadConsultation(consultationId, status);
    } catch (err) {
      console.error(err);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
              Inter-Department Head Consultations
            </h1>
            {pendingReceivedCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-purple-600 text-white text-xs font-bold animate-pulse">
                {pendingReceivedCount} awaiting response
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Review requests sent by other department heads, or track opinions you requested.
          </p>
        </div>
      </div>

      {/* Main Mode Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('received')}
          className={`pb-3 px-4 font-bold text-xs sm:text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'received'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Inbox className="w-4 h-4" />
          <span>From Other Heads</span>
          {pendingReceivedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs font-bold">
              {pendingReceivedCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sent')}
          className={`pb-3 px-4 font-bold text-xs sm:text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'sent'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Send className="w-4 h-4" />
          <span>Requested by Me</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
            {sentConsultations.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Received from Other Heads */}
      {activeTab === 'received' && (
        <div className="space-y-4">
          {/* Sub-filter pills */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              All ({receivedConsultations.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === 'pending'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Awaiting My Response ({pendingReceivedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('responded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === 'responded'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Responded ({receivedConsultations.length - pendingReceivedCount})
            </button>
          </div>

          {filteredReceived.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-800 font-display">
                No Consultations Found
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {filter === 'pending'
                  ? 'You have answered all review requests from other department heads.'
                  : 'No inter-department consultations match the selected filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReceived.map(({ consultation: c, request: r }) => {
                const isPending = c.status === 'pending';
                const isAgreed = c.status === 'agreed';
                const isDisagreed = c.status === 'disagreed';
                const isActing = actingId === c.id;

                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 hover:border-purple-300 transition-all cursor-pointer shadow-xs hover:shadow-sm space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                          {r.request_no}
                        </span>
                        <TypeBadge type={typeOf(r)} />
                        <span className="text-xs text-slate-500">
                          Dept: <strong>{r.department?.name || 'Department'}</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
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
                          <span className="capitalize">
                            {isPending ? 'Action Required' : c.status}
                          </span>
                        </span>
                        <div className="text-sm font-extrabold text-slate-900 font-display">
                          {formatINR(r.amount)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900 font-display">
                        {r.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Requested by <strong>{c.requested_by_name}</strong> ·{' '}
                        {formatISTDate(c.created_at)}
                      </p>
                    </div>

                    {/* Forwarder's Note */}
                    {c.request_note && (
                      <div className="p-3 bg-purple-50/70 border border-purple-100 rounded-xl text-xs text-purple-950 flex items-start gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Note from {c.requested_by_name}:</span>
                          <p className="mt-0.5 italic">"{c.request_note}"</p>
                        </div>
                      </div>
                    )}

                    {/* Responded remarks */}
                    {c.response_remarks && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                        <span className="font-bold">Your Response: </span>
                        <span>"{c.response_remarks}"</span>
                      </div>
                    )}

                    {/* Quick Action Bar */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Click card to view invoices, vouchers & full request
                      </div>

                      <div className="flex items-center gap-2">
                        {isPending ? (
                          <>
                            <button
                              type="button"
                              disabled={isActing}
                              onClick={(e) => handleQuickRespond(e, c.id, 'disagreed')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-semibold transition-all disabled:opacity-50"
                            >
                              {isActing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ThumbsDown className="w-3 h-3" />
                              )}
                              <span>Disagree</span>
                            </button>
                            <button
                              type="button"
                              disabled={isActing}
                              onClick={(e) => handleQuickRespond(e, c.id, 'agreed')}
                              className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-all disabled:opacity-50"
                            >
                              {isActing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ThumbsUp className="w-3 h-3" />
                              )}
                              <span>Agree</span>
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            {!['approved', 'rejected', 'paid', 'withdrawn'].includes(r.status) && (
                              isAgreed ? (
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={(e) => handleQuickRespond(e, c.id, 'disagreed')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-[11px] font-semibold transition-all disabled:opacity-50 cursor-pointer"
                                  title="Change your decision to Disagree"
                                >
                                  {isActing ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ThumbsDown className="w-3 h-3" />
                                  )}
                                  <span>Switch to Disagree</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={(e) => handleQuickRespond(e, c.id, 'agreed')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-semibold transition-all disabled:opacity-50 cursor-pointer"
                                  title="Change your decision to Agree"
                                >
                                  {isActing ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <ThumbsUp className="w-3 h-3" />
                                  )}
                                  <span>Switch to Agree</span>
                                </button>
                              )
                            )}
                            <div className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800">
                              <span>Open Details</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sent Consultations */}
      {activeTab === 'sent' && (
        <div className="space-y-4">
          {sentConsultations.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <Send className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-800 font-display">
                No Sent Consultations
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                You have not requested opinions from other department heads yet. When viewing any of your
                department requests, click "Consult Other Heads…" to ask for reviews.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sentConsultations.map(({ consultation: c, request: r }) => {
                const isAgreed = c.status === 'agreed';
                const isDisagreed = c.status === 'disagreed';
                const isPending = c.status === 'pending';

                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 hover:border-indigo-300 transition-all cursor-pointer shadow-xs space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                          {r.request_no}
                        </span>
                        <StatusBadge status={r.status} requestType={typeOf(r)} size="sm" />
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
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
                        <span className="capitalize">
                          {c.head_name}: {c.status}
                        </span>
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900 font-display">
                        {r.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Consulted Head: <strong>{c.head_name}</strong> (
                        {c.department_name || 'Department Head'}) · Requested {formatISTDate(c.created_at)}
                      </p>
                    </div>

                    {c.response_remarks && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                        <span className="font-bold">Remarks from {c.head_name}: </span>
                        <p className="mt-0.5 italic">"{c.response_remarks}"</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
