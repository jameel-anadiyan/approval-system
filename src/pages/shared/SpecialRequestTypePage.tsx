import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestQueue } from '../../components/requests/RequestQueue';
import { formatINR, TYPE_LABELS, typeOf } from '../../lib/formatters';
import {
  isMyRegionalRequest,
  isMyRoutingRequest,
  isOwningDepartmentHead,
} from '../../lib/workflow';
import type { RequestRecord } from '../../types/database';
import {
  FileSignature,
  Landmark,
  ClipboardCheck,
  PlusCircle,
  CheckCircle2,
  Clock,
  Inbox,
  FileCheck,
  type LucideIcon,
} from 'lucide-react';

export type SpecialPageRequestType = 'agreement' | 'statutory_payment' | 'audit_report';

type SpecialTab = 'action' | 'in_progress' | 'approved' | 'all';

interface SpecialRequestTypePageProps {
  requestType: SpecialPageRequestType;
}

const THEME_CONFIG: Record<
  SpecialPageRequestType,
  {
    pluralTitle: string;
    raiseLabel: string;
    approvalRuleTag: string;
    subtitle: string;
    icon: LucideIcon;
    badgePill: string;
    iconText: string;
    buttonBg: string;
    activeCard: string;
    hoverCard: string;
    activeTabBg: string;
    countPill: string;
    isPayable: boolean;
  }
> = {
  agreement: {
    pluralTitle: 'Agreement Requests',
    raiseLabel: 'New Agreement',
    approvalRuleTag: 'Head Approval Only · Non-Cash',
    subtitle:
      'Agreements, MOUs, and contracts with Excel, Word, PDF, or image attachments — approved directly by the Department Head (no disbursement needed).',
    icon: FileSignature,
    badgePill: 'text-violet-800 bg-violet-50 border-violet-200',
    iconText: 'text-violet-600',
    buttonBg: 'bg-violet-600 hover:bg-violet-700 shadow-violet-200',
    activeCard: 'bg-violet-50 border-violet-400 ring-2 ring-violet-200/60',
    hoverCard: 'hover:border-violet-300',
    activeTabBg: 'bg-violet-600 text-white shadow-sm',
    countPill: 'bg-violet-600 text-white',
    isPayable: false,
  },
  statutory_payment: {
    pluralTitle: 'Statutory Payment Requests',
    raiseLabel: 'New Statutory Payment',
    approvalRuleTag: 'Head Approval Only · Payable',
    subtitle:
      'Statutory dues, taxes, and compliance filings with payment amount, payment date, due date, and full document support — approved by the Department Head.',
    icon: Landmark,
    badgePill: 'text-cyan-900 bg-cyan-50 border-cyan-200',
    iconText: 'text-cyan-700',
    buttonBg: 'bg-cyan-700 hover:bg-cyan-800 shadow-cyan-200',
    activeCard: 'bg-cyan-50 border-cyan-400 ring-2 ring-cyan-200/60',
    hoverCard: 'hover:border-cyan-300',
    activeTabBg: 'bg-cyan-700 text-white shadow-sm',
    countPill: 'bg-cyan-700 text-white',
    isPayable: true,
  },
  audit_report: {
    pluralTitle: 'Audit Report Requests',
    raiseLabel: 'New Audit Report',
    approvalRuleTag: 'Admin Approval Only · Non-Cash',
    subtitle:
      'Audit reports specifying the audited firm, audit period (From – To), and Excel/Word/PDF/image working papers — approved exclusively by the Administrator.',
    icon: ClipboardCheck,
    badgePill: 'text-amber-900 bg-amber-50 border-amber-200',
    iconText: 'text-amber-600',
    buttonBg: 'bg-amber-600 hover:bg-amber-700 shadow-amber-200',
    activeCard: 'bg-amber-50 border-amber-400 ring-2 ring-amber-200/60',
    hoverCard: 'hover:border-amber-300',
    activeTabBg: 'bg-amber-600 text-white shadow-sm',
    countPill: 'bg-amber-600 text-white',
    isPayable: false,
  },
};

export const SpecialRequestTypePage: React.FC<SpecialRequestTypePageProps> = ({ requestType }) => {
  const { user, role } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const cfg = THEME_CONFIG[requestType];
  const TypeIcon = cfg.icon;

  const canRaise =
    role === 'head' || role === 'clerk' || role === 'employee' || role === 'regional_head';

  const scopedRequests = useMemo<RequestRecord[]>(() => {
    if (!user || !role) return [];
    const matching = requests.filter((r) => typeOf(r) === requestType);

    if (role === 'admin') {
      return matching.filter((r) => r.status !== 'draft' || r.requester_id === user.id);
    }

    if (role === 'head') {
      return matching.filter(
        (r) =>
          (r.status !== 'draft' || r.requester_id === user.id) &&
          (r.owner_head_id === user.id ||
            r.requester_id === user.id ||
            (r.consultations || []).some((c) => c.head_id === user.id) ||
            Boolean(user.department_id && r.department_id === user.department_id))
      );
    }

    if (role === 'clerk') {
      return matching.filter(
        (r) =>
          (r.status !== 'draft' || r.requester_id === user.id) &&
          (r.requester_id === user.id ||
            r.routed_by === user.id ||
            Boolean(user.department_id && r.department_id === user.department_id))
      );
    }

    if (role === 'regional_head') {
      return matching.filter(
        (r) =>
          (r.status !== 'draft' || r.requester_id === user.id) &&
          (r.requester_id === user.id ||
            r.regional_head_id === user.id ||
            Boolean(user.department_id && r.department_id === user.department_id))
      );
    }

    // employee
    return matching.filter((r) => r.requester_id === user.id);
  }, [requests, user, role, requestType]);

  const actionMeta = useMemo<{ label: string; items: RequestRecord[]; canBulkApprove: boolean }>(() => {
    if (!user || !role) return { label: 'Action Needed', items: [], canBulkApprove: false };

    if (role === 'admin') {
      if (requestType === 'audit_report') {
        return {
          label: 'To Approve',
          canBulkApprove: true,
          items: scopedRequests.filter(
            (r) =>
              r.status === 'pending_admin_approval' ||
              (r.status === 'approving' &&
                (!r.approving_started_at ||
                  Date.now() - new Date(r.approving_started_at).getTime() > 60000))
          ),
        };
      }
      return {
        label: 'Awaiting Head',
        canBulkApprove: false,
        items: scopedRequests.filter((r) => r.status === 'pending_head_approval'),
      };
    }

    if (role === 'head') {
      if (requestType === 'audit_report') {
        return {
          label: 'To Review',
          canBulkApprove: false,
          items: scopedRequests.filter(
            (r) => r.status === 'pending_head_review' && isOwningDepartmentHead(r, user)
          ),
        };
      }
      return {
        label: 'To Approve',
        canBulkApprove: true,
        items: scopedRequests.filter(
          (r) => r.status === 'pending_head_approval' && isOwningDepartmentHead(r, user)
        ),
      };
    }

    if (role === 'clerk') {
      return {
        label: 'To Route',
        canBulkApprove: false,
        items: scopedRequests.filter((r) => isMyRoutingRequest(r, user)),
      };
    }

    if (role === 'regional_head') {
      return {
        label: 'To Forward',
        canBulkApprove: false,
        items: scopedRequests.filter((r) => isMyRegionalRequest(r, user)),
      };
    }

    return {
      label: 'Drafts & Returned',
      canBulkApprove: false,
      items: scopedRequests.filter((r) => r.status === 'returned' || r.status === 'draft'),
    };
  }, [scopedRequests, user, role, requestType]);

  const inProgressItems = useMemo(
    () =>
      scopedRequests.filter((r) =>
        [
          'pending_regional_review',
          'submitted',
          'pending_head_review',
          'pending_head_approval',
          'pending_admin_approval',
          'approving',
        ].includes(r.status)
      ),
    [scopedRequests]
  );

  const approvedItems = useMemo(
    () => scopedRequests.filter((r) => r.status === 'approved' || r.status === 'paid'),
    [scopedRequests]
  );

  const returnedCount = useMemo(
    () => scopedRequests.filter((r) => r.status === 'returned').length,
    [scopedRequests]
  );

  const totalApprovedAmount = useMemo(
    () => approvedItems.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [approvedItems]
  );

  const [selectedTab, setSelectedTab] = useState<SpecialTab | null>(null);
  const tab: SpecialTab = selectedTab ?? (actionMeta.items.length > 0 ? 'action' : 'all');

  const items =
    tab === 'action'
      ? actionMeta.items
      : tab === 'in_progress'
      ? inProgressItems
      : tab === 'approved'
      ? approvedItems
      : scopedRequests;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border mb-1.5 ${cfg.badgePill}`}
          >
            <TypeIcon className={`w-3.5 h-3.5 ${cfg.iconText}`} />
            <span>{cfg.approvalRuleTag}</span>
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2.5 flex-wrap">
            <span>{cfg.pluralTitle}</span>
            {actionMeta.items.length > 0 && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${cfg.countPill}`}>
                {actionMeta.items.length} pending
              </span>
            )}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-3xl">{cfg.subtitle}</p>
        </div>

        {canRaise && (
          <button
            type="button"
            id={`raise-${requestType}-btn`}
            onClick={() => navigate('/new', { state: { defaultType: requestType } })}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-xs shadow-md transition-all self-start sm:self-auto cursor-pointer shrink-0 ${cfg.buttonBg}`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>{cfg.raiseLabel}</span>
          </button>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          onClick={() => setSelectedTab('action')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'action' ? cfg.activeCard : `bg-white border-slate-200 ${cfg.hoverCard}`
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
            {actionMeta.label}
          </span>
          <span className="text-2xl font-extrabold text-slate-950 font-display mt-1 block">
            {actionMeta.items.length}
          </span>
        </div>

        <div
          onClick={() => setSelectedTab('in_progress')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'in_progress' ? cfg.activeCard : `bg-white border-slate-200 ${cfg.hoverCard}`
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            In Progress
          </span>
          <span className="text-2xl font-extrabold text-slate-900 font-display mt-1 block">
            {inProgressItems.length}
          </span>
        </div>

        <div
          onClick={() => setSelectedTab('approved')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'approved' ? cfg.activeCard : `bg-white border-slate-200 ${cfg.hoverCard}`
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
            {cfg.isPayable ? 'Approved & Paid' : 'Approved'}
          </span>
          <span className="text-2xl font-extrabold text-emerald-900 font-display mt-1 block">
            {approvedItems.length}
          </span>
        </div>

        <div
          onClick={() => setSelectedTab('all')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            tab === 'all' ? cfg.activeCard : `bg-white border-slate-200 ${cfg.hoverCard}`
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            {cfg.isPayable ? 'Sanctioned Amount' : `Total ${TYPE_LABELS[requestType]}s`}
          </span>
          <span className="text-lg sm:text-xl font-extrabold text-slate-900 font-display mt-1 block truncate">
            {cfg.isPayable ? formatINR(totalApprovedAmount) : scopedRequests.length}
          </span>
          {!cfg.isPayable && returnedCount > 0 && (
            <span className="text-[10px] font-semibold text-amber-700 mt-0.5 block">
              {returnedCount} returned for correction
            </span>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div
        className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1 flex-wrap"
        role="tablist"
      >
        {(
          [
            ['action', `${actionMeta.label} (${actionMeta.items.length})`, Inbox],
            ['in_progress', `In Progress (${inProgressItems.length})`, Clock],
            [
              'approved',
              `${cfg.isPayable ? 'Approved & Paid' : 'Approved'} (${approvedItems.length})`,
              FileCheck,
            ],
            ['all', `All (${scopedRequests.length})`, TypeIcon],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${requestType}-tab-${key}`}
            aria-selected={tab === key}
            onClick={() => setSelectedTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              tab === key ? cfg.activeTabBg : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <RequestQueue
        items={items}
        bulkApprove={tab === 'action' && actionMeta.canBulkApprove}
        initialFilters={{ sort: tab === 'action' ? 'oldest' : 'newest' }}
        emptyIcon={tab === 'action' ? CheckCircle2 : TypeIcon}
        emptyTitle={
          tab === 'action'
            ? `No Pending ${TYPE_LABELS[requestType]} Requests`
            : `No ${TYPE_LABELS[requestType]} Requests Yet`
        }
        emptyDescription={
          tab === 'action'
            ? `All ${TYPE_LABELS[requestType]} requests requiring action have been cleared.`
            : `${TYPE_LABELS[requestType]} requests in your department scope will appear here.`
        }
      />
    </div>
  );
};
