import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { extractEventDate } from '../../lib/exhibitionQuota';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CalendarDays,
  MapPin,
  User,
  Store,
  ChevronRight,
  Filter,
  ShieldAlert,
  Clock,
  Sparkles,
  Search,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';

export const HeadExhibitionWaitlistPage: React.FC = () => {
  const { user } = useAuth();
  const { requests, decideExhibitionWaitlist } = useRequests();

  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');

  // Decision Modal state
  const [activeModal, setActiveModal] = useState<{
    requestId: string;
    action: 'approve' | 'reject';
    eventTitle: string;
  } | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // All exhibition waitlist requests that are active/submitted
  const allWaitlistRequests = useMemo(() => {
    return requests.filter((r) => {
      if (r.request_type !== 'exhibition') return false;
      if (!r.is_waitlist) return false;
      if (r.status === 'draft') return false;
      return true;
    });
  }, [requests]);

  // Extract unique regions for filter
  const regionsList = useMemo(() => {
    const map = new Map<string, string>();
    allWaitlistRequests.forEach((r) => {
      if (r.region_id && r.region_name) {
        map.set(r.region_id, r.region_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allWaitlistRequests]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return allWaitlistRequests.filter((r) => {
      // Status filter
      if (statusFilter === 'pending') {
        if (r.waitlist_approved_at || r.status === 'rejected' || r.status === 'withdrawn') return false;
      } else if (statusFilter === 'approved') {
        if (!r.waitlist_approved_at) return false;
      }

      // Region filter
      if (regionFilter !== 'all' && r.region_id !== regionFilter) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = r.title.toLowerCase().includes(q);
        const eventNameMatch = (r.details?.event_name || '').toLowerCase().includes(q);
        const requesterMatch = (r.requester_name || '').toLowerCase().includes(q);
        const venueMatch = (r.details?.venue || '').toLowerCase().includes(q);
        const regionMatch = (r.region_name || '').toLowerCase().includes(q);
        if (!titleMatch && !eventNameMatch && !requesterMatch && !venueMatch && !regionMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allWaitlistRequests, statusFilter, regionFilter, searchQuery]);

  const pendingCount = useMemo(() => {
    return allWaitlistRequests.filter((r) => !r.waitlist_approved_at && r.status !== 'rejected' && r.status !== 'withdrawn').length;
  }, [allWaitlistRequests]);

  const handleConfirmDecision = async () => {
    if (!activeModal) return;
    setIsProcessing(true);
    setActionError(null);
    try {
      const res = await decideExhibitionWaitlist(
        activeModal.requestId,
        activeModal.action,
        decisionRemarks.trim() || undefined
      );
      if (!res.success) {
        setActionError(res.error || 'Failed to update waitlist status.');
        return;
      }
      setActiveModal(null);
      setDecisionRemarks('');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Red-Themed Page Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-rose-900 via-red-900 to-slate-900 p-6 sm:p-8 text-white shadow-xl border border-rose-800/40">
        <div className="absolute right-0 top-0 -mt-12 -mr-12 w-64 h-64 bg-rose-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-200 border border-rose-400/30">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                Special Waiting List Tab
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-rose-100 border border-white/10">
                Low Chance of Approval
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display tracking-tight text-white">
              Special Waiting List Exhibitions
            </h1>
            <p className="text-sm text-rose-100/90 leading-relaxed">
              When a Regional Head books an exhibition date in their region, other Regional Heads can only apply via this Special Waiting List. These requests require your direct sign-off to proceed.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <div className="bg-rose-950/60 backdrop-blur-md rounded-2xl p-4 border border-rose-500/30 flex items-center gap-3 shadow-inner">
              <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center border border-rose-400/30 text-rose-200">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <div className="text-2xl font-black font-display text-white">{pendingCount}</div>
                <div className="text-[11px] font-semibold text-rose-200 uppercase tracking-wider">Awaiting Sign-off</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Pending Sign-off</span>
            {pendingCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${statusFilter === 'pending' ? 'bg-white/20 text-white' : 'bg-rose-500 text-white'}`}>
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === 'approved'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Approved
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === 'all'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Waitlist ({allWaitlistRequests.length})
          </button>
        </div>

        {/* Region & Search */}
        <div className="flex items-center gap-2 flex-1 sm:max-w-md">
          {regionsList.length > 0 && (
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="text-xs p-2 rounded-xl border border-slate-200 bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden shrink-0 font-medium"
            >
              <option value="all">All Regions</option>
              {regionsList.map((rg) => (
                <option key={rg.id} value={rg.id}>{rg.name}</option>
              ))}
            </select>
          )}

          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search event, venue, regional head…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden font-medium"
            />
          </div>
        </div>
      </div>

      {/* Requests List */}
      {filteredRequests.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto text-rose-500 mb-4">
            <Store className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No Special Waitlist Exhibitions</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {statusFilter === 'pending'
              ? 'There are currently no exhibition requests awaiting special waiting list sign-off.'
              : 'No exhibition waitlist requests matching the selected filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredRequests.map((r) => {
            const isApproved = Boolean(r.waitlist_approved_at);
            const isRejected = r.status === 'rejected';
            const eventDate = extractEventDate(r.details?.event_start, r.details?.event_dates);

            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-slate-200/90 hover:border-rose-300 shadow-xs transition-all overflow-hidden"
              >
                {/* Card Top Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-50/80 border-b border-slate-100 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-slate-700">{r.request_no || 'DRAFT-WAITLIST'}</span>
                    {r.region_name && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-800 text-[11px] font-semibold">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        {r.region_name}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      Special Waiting List
                    </span>
                  </div>

                  <div>
                    {isApproved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Waitlist Approved {r.waitlist_approved_at ? `(${formatISTDate(r.waitlist_approved_at)})` : ''}
                      </span>
                    ) : isRejected ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full">
                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        Rejected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        Pending Head Sign-off
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Main Body */}
                <div className="p-5 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <h3 className="text-base font-bold text-slate-900 font-display">
                        {r.details?.event_name || r.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-600">
                        {r.details?.venue && (
                          <span className="inline-flex items-center gap-1">
                            <Store className="w-3.5 h-3.5 text-slate-400" />
                            {r.details.venue}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                          {r.details?.event_dates || eventDate || 'Date not specified'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          Requester: <strong className="text-slate-800">{r.requester_name}</strong>
                          {r.requester_role === 'regional_head' ? ' (Regional Head)' : ''}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs text-slate-500 font-medium">Budget / Sponsorship</div>
                      <div className="text-lg font-black font-display text-slate-900">
                        {formatINR(r.details?.total_budget || r.amount)}
                      </div>
                    </div>
                  </div>

                  {/* Quota Conflict Details */}
                  <div className="p-3 bg-rose-50/70 border border-rose-200/90 rounded-xl text-xs flex items-start gap-2.5 text-rose-950">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-rose-900">Why this request is on Special Waiting List: </strong>
                      <span className="text-rose-800">
                        In {r.region_name || 'this region'}, the standard daily exhibition slot limit for this date is already claimed by another Regional Head. Under company policy, secondary applications have a low chance of approval and require prior review & sign-off from the Department Head.
                      </span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <Link
                      to={`/requests/${r.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-indigo-600 transition-colors"
                    >
                      <span>View Full Request Details</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>

                    {!isApproved && !isRejected && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveModal({
                              requestId: r.id,
                              action: 'reject',
                              eventTitle: r.details?.event_name || r.title,
                            })
                          }
                          className="px-3.5 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer"
                        >
                          Reject Waitlist
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveModal({
                              requestId: r.id,
                              action: 'approve',
                              eventTitle: r.details?.event_name || r.title,
                            })
                          }
                          className="px-4 py-1.5 text-xs font-bold text-white bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve Special Waitlist
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Decision Confirmation Modal */}
      {activeModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            if (!isProcessing) setActiveModal(null);
          }}
          title={
            activeModal.action === 'approve'
              ? 'Approve Special Waiting List Exhibition'
              : 'Reject Special Waiting List Exhibition'
          }
        >
          <div className="space-y-4">
            <div
              className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                activeModal.action === 'approve'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              {activeModal.action === 'approve' ? (
                <p>
                  You are approving this Special Waiting List exhibition request for{' '}
                  <strong>{activeModal.eventTitle}</strong>. This grants permission for this secondary regional slot and allows the request to continue along its approval workflow.
                </p>
              ) : (
                <p>
                  You are rejecting this Special Waiting List exhibition request for{' '}
                  <strong>{activeModal.eventTitle}</strong>. The requester will be notified that the secondary slot could not be accommodated.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Remarks / Decision Note (Optional)
              </label>
              <textarea
                rows={3}
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                placeholder={
                  activeModal.action === 'approve'
                    ? 'Add any conditions or reasons for approving this waitlist slot…'
                    : 'Provide the reason for rejecting this slot…'
                }
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-hidden"
              />
            </div>

            {actionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {actionError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirmDecision}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition-all cursor-pointer ${
                  activeModal.action === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isProcessing
                  ? 'Processing…'
                  : activeModal.action === 'approve'
                  ? 'Confirm Approval'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
