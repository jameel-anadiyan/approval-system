import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { useDirectory } from '../../lib/directory';
import { supabase } from '../../lib/supabase';
import {
  RequestRecord,
  DisbursementEntry,
  isDisbursementAssociated,
  entryAvailable,
} from '../../types/database';
import {
  formatINR,
  formatISTDate,
  typeOf,
  STATUS_META,
} from '../../lib/formatters';
import { SignedDocPreviewModal } from '../../components/requests/SignedDocPreviewModal';
import { RequestTimeline } from '../../components/requests/RequestTimeline';
import {
  Search,
  Compass,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertCircle,
  FileText,
  Banknote,
  User,
  Building2,
  Store,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Wallet,
  Hash,
  Award,
  RotateCcw,
  FileCheck2,
  Users,
  Percent,
} from 'lucide-react';

export const HeadTrackingPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const dir = useDirectory();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isPettyCashDealer = Boolean(
    user?.role === 'head' &&
      (dir.users.find((u) => u.id === user.id)?.is_petty_cash_dealer ?? user.is_petty_cash_dealer)
  );

  // Search input state
  const initialQuery = searchParams.get('q') || searchParams.get('id') || searchParams.get('no') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeRequest, setActiveRequest] = useState<RequestRecord | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [previewSignedDoc, setPreviewSignedDoc] = useState<{ path: string; name: string } | null>(null);

  // Queue counts for in-page switcher tabs
  const toApproveQueue = requests.filter(
    (r) => r.status === 'pending_head_approval' && (r.owner_head_id === user?.id || r.department_id === user?.department_id)
  );
  const toReviewQueue = requests.filter(
    (r) => r.status === 'pending_head_review' && (r.owner_head_id === user?.id || r.department_id === user?.department_id)
  );
  const pendingAdminQueue = requests.filter(
    (r) => r.status === 'pending_admin_approval' && (r.owner_head_id === user?.id || r.department_id === user?.department_id)
  );

  // Quick suggestions: recent requests from this Head's department or owned by this Head
  const recentDeptRequests = useMemo(() => {
    return requests
      .filter((r) => {
        if (user?.role === 'admin') return true;
        return r.department_id === user?.department_id || r.owner_head_id === user?.id;
      })
      .slice(0, 8);
  }, [requests, user]);

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Tracking fetch logic: checks local context first, then queries RPC / Supabase
  const executeSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) {
        setActiveRequest(null);
        setSearchError(null);
        return;
      }

      setIsSearching(true);
      setSearchError(null);

      // 1. Search in local loaded context
      const localMatch = requests.find((r) => {
        const reqNo = r.request_no || '';
        const aprNo = r.approval_no || '';
        if (r.id.toLowerCase() === q.toLowerCase()) return true;
        if (reqNo.toLowerCase() === q.toLowerCase()) return true;
        if (aprNo.toLowerCase() === q.toLowerCase()) return true;
        if (reqNo.toLowerCase().includes(q.toLowerCase())) return true;
        if (aprNo.toLowerCase().includes(q.toLowerCase())) return true;
        return false;
      });

      if (localMatch) {
        setActiveRequest(localMatch);
        setIsSearching(false);
        return;
      }

      // 2. Try track_request RPC (works across all heads and departments via security definer)
      try {
        const { data: trackData, error: rpcErr } = await supabase.rpc('track_request', { p_query: q });
        if (!rpcErr && trackData && trackData.request) {
          const r = trackData.request;
          r.actions = trackData.actions || [];
          r.disbursement_entries = trackData.entries || [];
          r.files = trackData.files || [];
          r.signed_files = trackData.signed_files || [];
          r.consultations = trackData.consultations || [];
          setActiveRequest(r as RequestRecord);
          setIsSearching(false);
          return;
        }
      } catch (rpcErr) {
        console.warn('track_request RPC notice, falling back to direct table query:', rpcErr);
      }

      // 3. Fallback: Query Supabase directly (for older or un-cached requests)
      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

        let queryBuilder = supabase.from('requests').select(
          '*, department:departments(*), requester:profiles!requester_id(id, full_name, designation, photo_path, whatsapp_number), files:request_files!request_files_request_id_fkey(*), signed_files(*), actions:request_actions(*), payments:request_payments(*), consultations:head_consultations(*, head:profiles!head_id(id, full_name, designation, photo_path))'
        );

        if (isUUID) {
          queryBuilder = queryBuilder.or(`id.eq.${q},request_no.ilike.%${q}%,approval_no.ilike.%${q}%`);
        } else {
          queryBuilder = queryBuilder.or(`request_no.ilike.%${q}%,approval_no.ilike.%${q}%`);
        }

        const { data, error } = await queryBuilder.limit(1).maybeSingle();

        if (error) {
          console.warn('Primary fetch query error, falling back to basic query:', error.message);
          // Fallback to simpler query
          let fallbackBuilder = supabase.from('requests').select('*');
          if (isUUID) {
            fallbackBuilder = fallbackBuilder.or(`id.eq.${q},request_no.ilike.%${q}%,approval_no.ilike.%${q}%`);
          } else {
            fallbackBuilder = fallbackBuilder.or(`request_no.ilike.%${q}%,approval_no.ilike.%${q}%`);
          }
          const { data: fallbackData, error: fallbackErr } = await fallbackBuilder.limit(1).maybeSingle();
          if (fallbackErr || !fallbackData) {
            setSearchError(`No request found matching "${q}". Please verify the Request ID or Approval ID.`);
            setActiveRequest(null);
          } else {
            // Fetch actions and entries separately
            const [actionsRes, entriesRes] = await Promise.all([
              supabase.from('request_actions').select('*').eq('request_id', fallbackData.id).order('created_at', { ascending: true }),
              supabase.from('disbursement_entries').select('*').eq('request_id', fallbackData.id).order('entry_no', { ascending: true }),
            ]);
            fallbackData.actions = actionsRes.data || [];
            fallbackData.disbursement_entries = entriesRes.data || [];
            setActiveRequest(fallbackData as RequestRecord);
          }
        } else if (!data) {
          setSearchError(`No request found matching "${q}". Please check the ID for typos.`);
          setActiveRequest(null);
        } else {
          // Fetch disbursement entries if not included
          const { data: entries } = await supabase
            .from('disbursement_entries')
            .select('*')
            .eq('request_id', data.id)
            .order('entry_no', { ascending: true });
          data.disbursement_entries = entries || [];
          setActiveRequest(data as RequestRecord);
        }
      } catch (err: unknown) {
        console.error('Tracking fetch error:', err);
        setSearchError('Error fetching request tracking data. Please try again.');
        setActiveRequest(null);
      } finally {
        setIsSearching(false);
      }
    },
    [requests]
  );

  // Sync with searchParams on mount or param change (NO preset data or auto-fill)
  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('id') || searchParams.get('no') || '';
    if (q) {
      setSearchQuery(q);
      executeSearch(q);
    }
  }, [searchParams, executeSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchParams({ q: searchQuery.trim() });
    executeSearch(searchQuery.trim());
  };

  const handleSelectRecent = (req: RequestRecord) => {
    const term = req.approval_no || req.request_no || req.id;
    setSearchQuery(term);
    setSearchParams({ q: term });
    setActiveRequest(req);
    setSearchError(null);
  };

  const statusMeta = activeRequest ? STATUS_META[activeRequest.status] : null;

  // Disbursement entries calculation
  const entries: DisbursementEntry[] = useMemo(
    () => activeRequest?.disbursement_entries || [],
    [activeRequest?.disbursement_entries]
  );
  const totalApproved = activeRequest?.amount || 0;
  const totalEntered = entries.reduce((sum, e) => sum + (Number(e.amount) || 0) + (Number(e.adjustment_amount) || 0), 0);
  const totalPaid = entries
    .filter((e) => e.status === 'paid' || e.entry_type === 'old_balance' || (Number(e.adjustment_amount || 0) > 0 && Number(e.amount) === 0))
    .reduce((sum, e) => sum + (Number(e.amount) || 0) + (Number(e.adjustment_amount) || 0), 0);
  const availableBal = activeRequest ? entryAvailable(activeRequest) : 0;

  // Signed document preview helper
  const signedDoc = activeRequest?.signed_files && activeRequest.signed_files.length > 0
    ? activeRequest.signed_files[0]
    : null;

  // Stepper milestones determination
  const stepper = useMemo(() => {
    if (!activeRequest) return null;

    const isRouteA = activeRequest.route === 'A';
    const isSpecialNonCash = !isDisbursementAssociated(activeRequest.request_type);
    const isAuditReport = typeOf(activeRequest) === 'audit_report';

    // Step 1: Submission
    const step1Complete = Boolean(activeRequest.submitted_at || activeRequest.status !== 'draft');
    const step1Current = activeRequest.status === 'draft';

    // Step 2: Routing / Clerk
    const isDirectRouting = !activeRequest.routing_clerk_ids || activeRequest.routing_clerk_ids.length === 0;
    const step2Complete = step1Complete && activeRequest.status !== 'submitted' && activeRequest.status !== 'draft';
    const step2Current = activeRequest.status === 'submitted';

    // Step 3: Head Review / Approval
    let step3Complete = false;
    let step3Current = false;
    let step3Label = 'Department Head Review';

    if (isAuditReport) {
      step3Label = 'Head Verification';
      step3Complete = true; // Audit report approved by Admin
    } else if (!isRouteA) {
      step3Label = 'Head Approval (Route B)';
      step3Complete = Boolean(
        (activeRequest.decided_at && activeRequest.approver_role === 'head') ||
        activeRequest.status === 'approved' ||
        activeRequest.status === 'paid'
      );
      step3Current = activeRequest.status === 'pending_head_approval';
    } else {
      step3Label = 'Head Review (Route A)';
      step3Complete = Boolean(
        activeRequest.reviewed_at ||
        activeRequest.status === 'pending_admin_approval' ||
        activeRequest.status === 'approved' ||
        activeRequest.status === 'paid'
      );
      step3Current = activeRequest.status === 'pending_head_review';
    }

    // Step 4: Admin Approval & Seal
    const step4Needed = isRouteA || isAuditReport;
    const step4Complete = Boolean(
      (activeRequest.decided_at && activeRequest.approver_role === 'admin') ||
      (step4Needed && (activeRequest.status === 'approved' || activeRequest.status === 'paid'))
    );
    const step4Current = activeRequest.status === 'pending_admin_approval' || activeRequest.status === 'approving';

    // Step 5: Disbursement Entry Recording (Cash/Bank requests)
    const step5Needed = !isSpecialNonCash;
    const hasEntries = entries.length > 0;
    const isAllEntered = hasEntries && availableBal <= 0;
    const step5Complete = (activeRequest.status === 'approved' || activeRequest.status === 'paid') && (hasEntries || totalPaid >= totalApproved);
    const step5Current = activeRequest.status === 'approved' && !hasEntries && totalPaid < totalApproved;

    // Step 6: Payment Releasing & Settled
    const step6Needed = !isSpecialNonCash;
    const step6Complete = activeRequest.status === 'paid' || (totalPaid >= totalApproved && totalApproved > 0);
    const step6Current = activeRequest.status === 'approved' && hasEntries && totalPaid < totalApproved;

    return {
      step1: { complete: step1Complete, current: step1Current },
      step2: { complete: step2Complete, current: step2Current, isDirectRouting },
      step3: { complete: step3Complete, current: step3Current, label: step3Label },
      step4: { needed: step4Needed, complete: step4Complete, current: step4Current },
      step5: { needed: step5Needed, complete: step5Complete, current: step5Current, isAllEntered },
      step6: { needed: step6Needed, complete: step6Complete, current: step6Current },
    };
  }, [activeRequest, entries, availableBal, totalPaid, totalApproved]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Header & Navigation Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="w-6 h-6 text-purple-600" />
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
              Department Head Request Tracker
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Track real-time lifecycle status, approval progression, disbursement entries, and audit trail.
          </p>
        </div>

        {activeRequest && (
          <Link
            to={`/requests/${activeRequest.id}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition-colors self-start sm:self-auto cursor-pointer"
          >
            <span>Open Full Request Page</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Primary In-Page Tabs for Department Head */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-b border-slate-200/90 pt-1">
        <button
          type="button"
          onClick={() => navigate('/head')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
          <span>To Approve (Route B)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
            {toApproveQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/head/review')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>To Review (Route A)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
            {toReviewQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/head/review?tab=admin')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
          <span>Pending Admin Approval</span>
          {pendingAdminQueue.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">
              {pendingAdminQueue.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-700 text-white flex items-center gap-2 shrink-0 shadow-xs cursor-default"
        >
          <Search className="w-3.5 h-3.5 text-white" />
          <span>Track Request</span>
        </button>

        {isPettyCashDealer && (
          <button
            type="button"
            onClick={() => navigate('/petty-cash')}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-teal-600" />
            <span>Petty Cash</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/approved')}
          className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 hover:bg-slate-100 flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Approved</span>
        </button>
      </div>

      {/* Fetch & Search Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter Request ID (e.g. REQ-2026-000123) or Approval ID (e.g. APR-2026-000045)..."
              className="w-full pl-10 pr-24 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchParams({});
                  setActiveRequest(null);
                  setSearchError(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 px-1 py-0.5 rounded cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="px-5 py-2.5 bg-purple-700 hover:bg-purple-800 disabled:bg-purple-400 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer"
          >
            {isSearching ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Tracking...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Track Request</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Suggestion Chips */}
        {recentDeptRequests.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400 text-[11px] font-medium mr-1">Recent Dept Requests:</span>
            {recentDeptRequests.map((r) => {
              const label = r.approval_no || r.request_no || r.id;
              const isSelected = activeRequest?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleSelectRecent(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-purple-100 text-purple-900 border border-purple-300 ring-1 ring-purple-200'
                      : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/80'
                  }`}
                >
                  <Hash className="w-3 h-3 text-slate-400" />
                  <span>{label}</span>
                  <span className="text-[10px] text-slate-400">({r.title.slice(0, 15)}...)</span>
                </button>
              );
            })}
          </div>
        )}

        {searchError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Search Result:</span> {searchError}
            </div>
          </div>
        )}
      </div>

      {/* Initial Empty State when no request is tracked yet */}
      {!activeRequest && !isSearching && (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-8 sm:p-12 text-center shadow-xs space-y-4 max-w-2xl mx-auto my-4">
          <div className="w-14 h-14 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto border border-purple-100 shadow-xs">
            <Compass className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 font-display">
              Track Any Request Across All Departments
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              Enter any Request ID (e.g. <span className="font-mono font-semibold text-slate-700">REQ-2026-000123</span>) or Approval ID (e.g. <span className="font-mono font-semibold text-slate-700">APR-2026-000045</span>) above. You can track requests from any department head or location in real time.
            </p>
          </div>
          {recentDeptRequests.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-400 block mb-2 font-medium">Or pick from recent requests:</span>
              <div className="flex flex-wrap justify-center gap-2">
                {recentDeptRequests.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectRecent(r)}
                    className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-purple-50 text-slate-700 hover:text-purple-700 border border-slate-200 hover:border-purple-200 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Hash className="w-3 h-3 text-slate-400" />
                    <span>{r.approval_no || r.request_no || r.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Tracking Content (if active request found) */}
      {activeRequest && (
        <div className="space-y-6">
          {/* Live Status Header Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                    {activeRequest.request_no || activeRequest.id}
                  </span>

                  {activeRequest.approval_no && (
                    <span className="text-xs font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                      <Award className="w-3 h-3 text-emerald-600" />
                      <span>{activeRequest.approval_no}</span>
                    </span>
                  )}

                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                      statusMeta?.badgeClass || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                    <span>{statusMeta?.label || activeRequest.status}</span>
                  </span>

                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200">
                    Route {activeRequest.route}
                  </span>

                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 capitalize">
                    {activeRequest.request_type?.replace(/_/g, ' ')}
                  </span>
                </div>

                <h2 className="text-lg sm:text-xl font-bold text-slate-900 pt-1">
                  {activeRequest.title}
                </h2>
              </div>

              {/* Action Buttons: Copy ID, Preview Signed Doc */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(activeRequest.approval_no || activeRequest.request_no || activeRequest.id, 'id')}
                  className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Copy ID to clipboard"
                >
                  {copiedField === 'id' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{copiedField === 'id' ? 'Copied' : 'Copy ID'}</span>
                </button>

                {signedDoc && signedDoc.storage_path && (
                  <button
                    type="button"
                    onClick={() => setPreviewSignedDoc({ path: signedDoc.storage_path || '', name: signedDoc.file_name || 'signed_approval.pdf' })}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg border border-emerald-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>View Signed Doc</span>
                  </button>
                )}
              </div>
            </div>

            {/* Visual Lifecycle Stepper */}
            {stepper && (
              <div className="pt-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center justify-between">
                  <span>Lifecycle Progression Track</span>
                  <span className="text-[11px] font-normal text-slate-400">
                    Live Status: <span className="font-bold text-slate-700">{statusMeta?.label}</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {/* Step 1: Submission */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      stepper.step1.complete
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : stepper.step1.current
                        ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200 text-amber-950'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {stepper.step1.complete ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold">1. Submission</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      By {activeRequest.requester_name || 'Requester'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {formatISTDate(activeRequest.submitted_at || activeRequest.created_at, true)}
                    </p>
                  </div>

                  {/* Step 2: Routing / Clerk */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      stepper.step2.complete
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : stepper.step2.current
                        ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200 text-blue-950'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {stepper.step2.complete ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold">2. Routing</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      {stepper.step2.isDirectRouting ? 'Direct Routing' : 'Clerk Routing'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {stepper.step2.complete ? 'Completed' : 'Under Review'}
                    </p>
                  </div>

                  {/* Step 3: Department Head */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      activeRequest.status === 'returned'
                        ? 'bg-amber-50 border-amber-300 text-amber-950'
                        : stepper.step3.complete
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : stepper.step3.current
                        ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-200 text-purple-950'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {activeRequest.status === 'returned' ? (
                        <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : stepper.step3.complete ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-purple-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold">3. Head Action</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      {activeRequest.owner_head_name ? `Head: ${activeRequest.owner_head_name}` : stepper.step3.label}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {activeRequest.decided_at && activeRequest.approver_role === 'head'
                        ? formatISTDate(activeRequest.decided_at, false)
                        : activeRequest.reviewed_at
                        ? formatISTDate(activeRequest.reviewed_at, false)
                        : stepper.step3.current
                        ? 'Waiting for Head'
                        : 'Pending'}
                    </p>
                  </div>

                  {/* Step 4: Admin Approval & Seal */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      !stepper.step4.needed
                        ? 'bg-slate-50/50 border-dashed border-slate-200 text-slate-400'
                        : stepper.step4.complete
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : stepper.step4.current
                        ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200 text-blue-950 animate-pulse'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {!stepper.step4.needed ? (
                        <Check className="w-4 h-4 text-slate-300 shrink-0" />
                      ) : stepper.step4.complete ? (
                        <Award className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold">4. Admin Seal</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      {!stepper.step4.needed
                        ? 'Not Required (Route B)'
                        : stepper.step4.complete
                        ? `Approved by ${activeRequest.approver_name || 'Admin'}`
                        : stepper.step4.current
                        ? 'Pending Admin Approval'
                        : 'Awaiting Forward'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {activeRequest.decided_at && activeRequest.approver_role === 'admin'
                        ? formatISTDate(activeRequest.decided_at, false)
                        : ''}
                    </p>
                  </div>

                  {/* Step 5: Disbursement / Settlement */}
                  <div
                    className={`p-3 rounded-xl border transition-all ${
                      !stepper.step5.needed
                        ? 'bg-slate-50/50 border-dashed border-slate-200 text-slate-400'
                        : stepper.step6.complete
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : stepper.step5.complete || stepper.step6.current
                        ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 text-indigo-950'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {!stepper.step5.needed ? (
                        <Check className="w-4 h-4 text-slate-300 shrink-0" />
                      ) : stepper.step6.complete ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Banknote className="w-4 h-4 text-indigo-600 shrink-0" />
                      )}
                      <span className="text-xs font-bold">5. Disbursement</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      {!stepper.step5.needed
                        ? 'Non-cash item'
                        : stepper.step6.complete
                        ? 'Fully Paid / Settled'
                        : entries.length > 0
                        ? `${entries.length} entry recorded`
                        : 'Waiting for Entry'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {stepper.step6.complete && activeRequest.paid_at
                        ? formatISTDate(activeRequest.paid_at, false)
                        : formatINR(totalPaid)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Grid Layout: Essential Details + Disbursement Status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Request Details + Entries */}
            <div className="lg:col-span-2 space-y-6">
              {/* Essential Details Card */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 font-display flex items-center justify-between border-b border-slate-100 pb-3">
                  <span>Essential Request Information</span>
                  <span className="text-xs font-mono text-slate-500">{activeRequest.id}</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Approved Amount</span>
                    <span className="text-lg font-bold text-slate-900 font-display">
                      {formatINR(activeRequest.amount || 0)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Disbursement Dealing Mode</span>
                    <span className="text-xs font-bold text-slate-800 capitalize bg-slate-100 px-2.5 py-1 rounded-md inline-block">
                      {activeRequest.disbursement_mode?.replace(/_/g, ' ') || 'Not Decided Yet'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Requester</span>
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{activeRequest.requester_name || '—'}</span>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Shop / Location</span>
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-slate-400" />
                      <span>{activeRequest.shop_name || '—'}</span>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Department</span>
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>{activeRequest.department?.name || '—'}</span>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-400 block font-medium">Assigned Entry Officer</span>
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{activeRequest.assigned_entry_user_name || 'Not assigned'}</span>
                    </span>
                  </div>
                </div>

                {/* Discount Computation Card if Discount request */}
                {typeOf(activeRequest) === 'discount' && (() => {
                  const d = activeRequest.details;
                  const before = Number(d?.before_amount || 0);
                  const after = Number(d?.after_amount || 0);
                  const val = Number(d?.discount_amount ?? (before > 0 && after >= 0 ? before - after : activeRequest.amount));
                  const pct = d?.discount_pct !== undefined && d?.discount_pct !== null && !isNaN(Number(d.discount_pct))
                    ? Number(d.discount_pct)
                    : before > 0
                    ? (val / before) * 100
                    : 0;

                  return (
                    <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                          <Percent className="w-3.5 h-3.5 text-amber-600" />
                          <span>Discount Computation</span>
                        </span>
                        <span className="font-extrabold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-md border border-amber-300">
                          {pct.toFixed(1)}% OFF
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="bg-white/90 p-2 rounded-lg border border-amber-200/70">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block truncate">Before</span>
                          <span className="font-bold text-slate-800 truncate block">{before > 0 ? formatINR(before) : '—'}</span>
                        </div>
                        <div className="bg-white/90 p-2 rounded-lg border border-amber-200/70">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block truncate">After</span>
                          <span className="font-bold text-slate-800 truncate block">{after > 0 ? formatINR(after) : '—'}</span>
                        </div>
                        <div className="bg-amber-100/80 p-2 rounded-lg border border-amber-300/80">
                          <span className="text-[10px] font-black text-amber-900 uppercase block truncate">Discount %</span>
                          <span className="font-black text-amber-950 truncate block">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          <span className="text-[10px] font-bold text-emerald-800 uppercase block truncate">Discount Value</span>
                          <span className="font-black text-emerald-900 truncate block">{formatINR(val)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {activeRequest.notes && (
                  <div className="pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-400 block font-medium mb-1">Notes / Description:</span>
                    <p className="text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed whitespace-pre-wrap">
                      {activeRequest.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Disbursement Track & Entries (if cash request) */}
              {isDisbursementAssociated(activeRequest.request_type) && (
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-emerald-600" />
                      <span>Disbursement & Settlement Status</span>
                    </h3>
                    <span className="text-xs font-bold text-slate-500">
                      {entries.length} Entries Recorded
                    </span>
                  </div>

                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-xs">
                    <div>
                      <span className="text-[11px] text-slate-400 block font-medium">Total Approved</span>
                      <span className="text-sm font-bold text-slate-900">{formatINR(totalApproved)}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block font-medium">Total Entered</span>
                      <span className="text-sm font-bold text-indigo-700">{formatINR(totalEntered)}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block font-medium">Total Paid</span>
                      <span className="text-sm font-bold text-emerald-700">{formatINR(totalPaid)}</span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block font-medium">Available Balance</span>
                      <span className="text-sm font-bold text-purple-700">{formatINR(availableBal)}</span>
                    </div>
                  </div>

                  {/* Entries List */}
                  {entries.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      No disbursement entries created yet. Waiting for Entry Account ({activeRequest.assigned_entry_user_name || 'Disbursement Officer'}) to record payment entries.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/90 text-xs space-y-2 transition-colors"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md font-bold text-[11px] bg-slate-200 text-slate-800">
                                Entry #{entry.entry_no}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[11px] font-bold capitalize ${
                                  entry.entry_type === 'old_balance' || Number(entry.adjustment_amount || 0) > 0
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : entry.entry_type === 'cash'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}
                              >
                                {entry.entry_type?.replace(/_/g, ' ') || 'Payment Entry'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900 font-display">
                                {formatINR(Number(entry.amount) + Number(entry.adjustment_amount || 0))}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  entry.status === 'paid'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : entry.status === 'approved'
                                    ? 'bg-indigo-100 text-indigo-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {entry.status}
                              </span>
                            </div>
                          </div>

                          {/* Entry Metadata Details */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
                            {entry.paid_at && (
                              <div>
                                <span className="text-slate-400">Paid On: </span>
                                <span>{formatISTDate(entry.paid_at, false)}</span>
                              </div>
                            )}
                            {entry.paid_by_name && (
                              <div>
                                <span className="text-slate-400">Paid By: </span>
                                <span>{entry.paid_by_name}</span>
                              </div>
                            )}
                            {entry.approved_amount !== null && entry.approved_amount !== undefined && (
                              <div>
                                <span className="text-slate-400">Approved: </span>
                                <span className="font-bold">{formatINR(Number(entry.approved_amount))}</span>
                              </div>
                            )}
                            {entry.notes && (
                              <div className="sm:col-span-3 text-slate-500 italic">
                                "{entry.notes}"
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right 1 Col: Workflow Audit Trail + Consultations */}
            <div className="space-y-6">
              {/* Head Consultation Track Card (if any) */}
              {activeRequest.consultations && activeRequest.consultations.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3">
                  <h4 className="text-xs font-bold text-slate-900 font-display flex items-center gap-1.5 border-b border-slate-100 pb-2">
                    <Users className="w-4 h-4 text-purple-600" />
                    <span>Other Head Consultations</span>
                  </h4>
                  <div className="space-y-2">
                    {activeRequest.consultations.map((c) => (
                      <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">{c.head?.full_name || c.head_name || 'Consulted Head'}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              c.status === 'agreed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : c.status === 'disagreed'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {c.status}
                          </span>
                        </div>
                        {(c.response_remarks || c.request_note) && (
                          <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-lg border border-slate-100">
                            "{c.response_remarks || c.request_note}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workflow Audit Trail Card */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-xs font-bold text-slate-900 font-display flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span>Workflow Audit Trail</span>
                  </h3>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {activeRequest.actions?.length || 0} events
                  </span>
                </div>

                <RequestTimeline actions={activeRequest.actions || []} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Signed Document Preview Modal */}
      {previewSignedDoc && (
        <SignedDocPreviewModal
          isOpen={Boolean(previewSignedDoc)}
          onClose={() => setPreviewSignedDoc(null)}
          storagePath={previewSignedDoc.path}
          fileName={previewSignedDoc.name}
          approvalNo={activeRequest?.approval_no}
        />
      )}
    </div>
  );
};

export default HeadTrackingPage;
