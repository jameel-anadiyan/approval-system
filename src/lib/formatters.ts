import { RequestStatus, AppRole, ApprovalRoute, RequestType } from '../types/database';

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** ₹ amount without forced decimals, e.g. ₹10,000 (used for policy labels). */
export function formatINRWhole(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatISTDate(dateString: string | Date | null | undefined, includeTime = true): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';

    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(includeTime
        ? {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }
        : {}),
    });

    const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
    const date = `${parts.day} ${parts.month} ${parts.year}`;
    if (!includeTime) return date;

    const period = parts.dayPeriod ? ` ${parts.dayPeriod.toUpperCase()}` : '';
    return `${date}, ${parts.hour}:${parts.minute}${period} IST`;
  } catch {
    return '—';
  }
}

export function formatRelativeTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return formatISTDate(dateString, false);
  } catch {
    return '';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface StatusMeta {
  label: string;
  badgeClass: string;
  bgLight: string;
  textColor: string;
  borderColor: string;
  description: string;
}

export const STATUS_META: Record<RequestStatus, StatusMeta> = {
  draft: {
    label: 'Draft',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    bgLight: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-200',
    description: 'Saved on your device; not yet sent.',
  },
  submitted: {
    label: 'Submitted (Waiting for Clerk)',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-300 ring-1 ring-sky-200',
    bgLight: 'bg-sky-50',
    textColor: 'text-sky-700',
    borderColor: 'border-sky-200',
    description: 'Waiting for department clerk to review and route.',
  },
  returned: {
    label: 'Returned for Correction',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 ring-1 ring-amber-200',
    bgLight: 'bg-amber-50',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-200',
    description: 'Sent back with remarks. Edit and resubmit.',
  },
  pending_head_review: {
    label: 'Under Head Review (Route A)',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-1 ring-indigo-200',
    bgLight: 'bg-indigo-50',
    textColor: 'text-indigo-700',
    borderColor: 'border-indigo-200',
    description: 'Waiting for Department Head to review and forward to Admin.',
  },
  pending_head_approval: {
    label: 'Pending Head Approval (Route B)',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-300 ring-1 ring-purple-200',
    bgLight: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200',
    description: 'Waiting for Department Head approval and signature.',
  },
  pending_admin_approval: {
    label: 'Pending Admin Approval',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-300 ring-1 ring-blue-200 font-semibold',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
    description: 'Waiting for Admin final approval and signature.',
  },
  approving: {
    label: 'Signing Documents…',
    badgeClass: 'bg-yellow-50 text-yellow-800 border-yellow-300 animate-pulse',
    bgLight: 'bg-yellow-50',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
    description: 'Stamping seal, signature, and approval number onto documents.',
  },
  approved: {
    label: 'Approved (Awaiting Disbursement)',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200 font-semibold',
    bgLight: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    description: 'Approved and signed. Stamped PDF ready; awaiting payment.',
  },
  paid: {
    label: 'Paid & Closed',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-300 ring-1 ring-teal-200 font-bold',
    bgLight: 'bg-teal-50',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-200',
    description: 'Payment disbursed. Workflow completed.',
  },
  rejected: {
    label: 'Rejected',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-300 ring-1 ring-rose-200',
    bgLight: 'bg-rose-50',
    textColor: 'text-rose-700',
    borderColor: 'border-rose-200',
    description: 'Request was rejected by approver.',
  },
  withdrawn: {
    label: 'Withdrawn',
    badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
    bgLight: 'bg-slate-50',
    textColor: 'text-slate-500',
    borderColor: 'border-slate-200',
    description: 'Withdrawn by requester.',
  },
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  head: 'Department Head',
  clerk: 'Clerk',
  employee: 'Employee',
  disbursement: 'Disbursement',
};

export const ROLE_BADGES: Record<AppRole, string> = {
  admin: 'bg-red-50 text-red-700 border-red-200',
  head: 'bg-purple-50 text-purple-700 border-purple-200',
  clerk: 'bg-blue-50 text-blue-700 border-blue-200',
  employee: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  disbursement: 'bg-amber-50 text-amber-700 border-amber-200',
};

export const ACTION_LABELS: Record<string, string> = {
  submitted: 'Submitted Request',
  resubmitted: 'Resubmitted after correction',
  routed_A: 'Routed to Route A (Admin)',
  routed_B: 'Routed to Route B (Head)',
  forwarded: 'Reviewed and forwarded to Admin',
  returned: 'Returned for correction',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  approved: 'Approved & Signed',
  paid: 'Payment Disbursed (Paid in full)',
  partial_payment: 'Partial payment recorded',
};

export const REQUEST_TYPES: RequestType[] = ['general', 'discount', 'exhibition'];

export const TYPE_LABELS: Record<RequestType, string> = {
  general: 'General',
  discount: 'Discount Approval',
  exhibition: 'Exhibition / Event',
};

export const TYPE_DESCRIPTIONS: Record<RequestType, string> = {
  general: 'Money request with invoices or bills. Clerk routes to Head (B) or Admin (A).',
  discount: 'Customer discount. Head approval (B-level). No payment step.',
  exhibition: 'Event sponsorship & promotion. Admin approval (A-level), then paid.',
};

export const TYPE_BADGES: Record<RequestType, string> = {
  general: 'bg-slate-100 text-slate-700 border-slate-200',
  discount: 'bg-amber-50 text-amber-800 border-amber-200',
  exhibition: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export const typeOf = (r: { request_type?: RequestType | null }): RequestType => r.request_type ?? 'general';

/** Status label that knows Discount approvals have no payment step. */
export function statusLabel(r: { status: RequestStatus; request_type?: RequestType | null }): string {
  if (r.status === 'approved' && typeOf(r) === 'discount') return 'Approved';
  return STATUS_META[r.status]?.label ?? r.status;
}

export const PROVIDE_LABELS: Record<string, string> = {
  stall_space: 'Stall space',
  table_chairs: 'Table & chairs',
  electricity_lights: 'Electricity & lights',
  logo_stage_banners: 'Logo on stage / banners',
  stage_announcements: 'Stage announcements',
  social_media: 'Social media mentions',
  other: 'Other',
};
