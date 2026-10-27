import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FileText,
  PlusCircle,
  Clock,
  CheckCircle,
  Building2,
  Users,
  Settings,
  ShieldCheck,
  Search,
  Wallet,
  Menu,
  X,
  FileCheck2,
  Inbox,
  UserCheck,
  History,
  FileSpreadsheet,
  Store,
  Percent,
  CheckCircle2,
  Send,
  RotateCcw,
  AlertTriangle,
  CalendarDays,
  MapPin,
  Globe,
  Tag,
  Truck,
  PackageCheck,
  PackageSearch,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { canViewDiscountReport } from '../../lib/discountReport';
import { canViewStockTransferReport, isStockMonitor } from '../../lib/stockTransferReport';
import { isMyRegionalRequest, isMyRoutingRequest } from '../../lib/workflow';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeVariant?: 'rose' | 'amber';
  highlight?: boolean;
  isWaitlistTab?: boolean;
}

export const Navigation: React.FC = () => {
  const { role, user } = useAuth();
  const { requests } = useRequests();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  if (!role) return null;

  // Compute live badge counts
  const returnedCount = requests.filter((r) => {
    if (r.status !== 'returned') return false;
    if (role === 'regional_head') {
      return r.regional_head_id === user?.id || r.requester_id === user?.id;
    }
    if (role === 'employee') {
      return r.requester_id === user?.id;
    }
    return true;
  }).length;

  const clerkToRouteCount = requests.filter((r) => isMyRoutingRequest(r, user)).length;

  const regionalToForwardCount = requests.filter((r) => isMyRegionalRequest(r, user)).length;

  const headToApproveCount = requests.filter(
    (r) => r.status === 'pending_head_approval' && (!user?.department_id || r.department_id === user.department_id)
  ).length;

  const headToReviewCount = requests.filter(
    (r) => r.status === 'pending_head_review' && (!user?.department_id || r.department_id === user.department_id)
  ).length;

  const headConsultationsCount = requests.reduce((count, r) => {
    const pendingForMe = (r.consultations || []).filter(
      (c) => c.head_id === user?.id && c.status === 'pending'
    ).length;
    return count + pendingForMe;
  }, 0);

  const adminToApproveCount = requests.filter(
    (r) => r.status === 'pending_admin_approval' || (r.status === 'approving' && (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
  ).length;

  const disbAwaitingCount = requests.filter(
    (r) => r.status === 'approved' && r.request_type !== 'discount' && r.request_type !== 'non_cash' && r.request_type !== 'stock_transfer'
  ).length;

  let mainNavItems: NavItem[] = [];
  let moreNavItems: NavItem[] = [];

  const hasExhibitionAccess =
    Boolean(user) &&
    (role === 'admin' || Boolean(user?.allowed_types?.includes('exhibition')));

  const headWaitlistCount = requests.filter(
    (r) => r.is_waitlist && r.status !== 'draft' && !r.waitlist_approved_at && r.status !== 'rejected' && r.status !== 'withdrawn'
  ).length;

  const transferPendingCount = requests.filter(
    (r) => r.request_type === 'stock_transfer' && r.status === 'approved' && !r.transfer_completed_at
  ).length;

  // Admin-granted report tab for non-admin, non-monitor users
  const stockReportItem: NavItem[] =
    role !== 'admin' && !isStockMonitor(user) && canViewStockTransferReport(user)
      ? [{ label: 'Stock Transfer Report', path: '/reports/stock-transfers', icon: Truck }]
      : [];

  switch (role) {
    case 'employee':
      mainNavItems = [
        { label: 'My Requests', path: '/my', icon: FileText },
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
        ...(hasExhibitionAccess ? [{ label: 'Calendar', path: '/calendar/exhibitions', icon: CalendarDays }] : []),
        { label: 'New Request', path: '/new', icon: PlusCircle, highlight: true },
      ];
      moreNavItems = [
        ...stockReportItem,
        { label: 'Profile', path: '/profile', icon: UserCheck },
      ];
      break;

    case 'regional_head':
      mainNavItems = [
        { label: 'To Forward', path: '/regional', icon: Inbox, badge: regionalToForwardCount },
        { label: 'Forwarded', path: '/regional/forwarded', icon: Send },
        ...(hasExhibitionAccess ? [{ label: 'Exhibition Calendar', path: '/calendar/exhibitions', icon: CalendarDays }] : []),
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
        { label: 'New Request', path: '/new', icon: PlusCircle, highlight: true },
      ];
      moreNavItems = [
        ...stockReportItem,
        { label: 'My Requests', path: '/my', icon: FileText },
        { label: 'Profile', path: '/profile', icon: UserCheck },
      ];
      break;

    case 'clerk':
      mainNavItems = [
        { label: 'To Route', path: '/clerk', icon: Inbox, badge: clerkToRouteCount },
        { label: 'Department', path: '/clerk/department', icon: Building2 },
        ...(hasExhibitionAccess ? [{ label: 'Calendar', path: '/calendar/exhibitions', icon: CalendarDays }] : []),
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
        { label: 'New Request', path: '/new', icon: PlusCircle, highlight: true },
      ];
      moreNavItems = [
        ...stockReportItem,
        { label: 'My Requests', path: '/my', icon: FileText },
        { label: 'Profile', path: '/profile', icon: UserCheck },
      ];
      break;

    case 'head':
      mainNavItems = [
        { label: 'To Approve', path: '/head', icon: CheckCircle, badge: headToApproveCount },
        { label: 'To Review', path: '/head/review', icon: Clock, badge: headToReviewCount },
        ...(user?.can_view_exhibition_waitlist
          ? [{ label: 'Waitlist Exhibitions', path: '/head/exhibition-waitlist', icon: AlertTriangle, badge: headWaitlistCount, badgeVariant: 'rose' as const, isWaitlistTab: true }]
          : []),
        ...(hasExhibitionAccess ? [{ label: 'Exhibition Calendar', path: '/calendar/exhibitions', icon: CalendarDays }] : []),
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
        { label: 'New Request', path: '/new', icon: PlusCircle, highlight: true },
      ];
      moreNavItems = [
        { label: 'From Other Heads', path: '/head/consultations', icon: Users, badge: headConsultationsCount },
        { label: 'My Seal & Sign', path: '/head/credentials', icon: ShieldCheck },
        ...(canViewDiscountReport(user) ? [{ label: 'Discount Report', path: '/reports/discounts', icon: Percent }] : []),
        ...stockReportItem,
        { label: 'Staff Users', path: '/head/users', icon: Users },
        { label: 'Dept Requests', path: '/head/department', icon: Building2 },
        { label: 'My Requests', path: '/my', icon: FileText },
        { label: 'Profile', path: '/profile', icon: UserCheck },
      ];
      break;

    case 'admin':
      mainNavItems = [
        { label: 'Dashboard', path: '/admin', icon: ShieldCheck },
        { label: 'To Approve', path: '/admin/approve', icon: CheckCircle, badge: adminToApproveCount },
        { label: 'Regions', path: '/admin/regions', icon: MapPin },
        { label: 'Regional Heads', path: '/admin/regional-heads', icon: Globe },
        { label: 'Waitlist Exhibitions', path: '/head/exhibition-waitlist', icon: AlertTriangle, badge: headWaitlistCount, badgeVariant: 'rose' as const, isWaitlistTab: true },
        { label: 'Exhibition Calendar', path: '/calendar/exhibitions', icon: CalendarDays },
        { label: 'All Requests', path: '/admin/requests', icon: FileSpreadsheet },
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
      ];
      moreNavItems = [
        { label: 'Stock Transfers', path: '/stock-transfers', icon: Truck, badge: transferPendingCount, badgeVariant: 'amber' },
        { label: 'Discount Report', path: '/reports/discounts', icon: Percent },
        { label: 'Stock Transfer Report', path: '/reports/stock-transfers', icon: FileSpreadsheet },
        { label: 'Departments', path: '/admin/departments', icon: Building2 },
        { label: 'Shops', path: '/admin/shops', icon: Store },
        { label: 'Product Categories', path: '/admin/product-categories', icon: Tag },
        { label: 'Staff & Employees', path: '/admin/staff', icon: Users },
        { label: 'Dept Heads', path: '/admin/heads', icon: UserCheck },
        { label: 'Disbursement Users', path: '/admin/disbursement', icon: Wallet },
        { label: 'Seal & Signature', path: '/admin/credentials', icon: FileCheck2 },
        { label: 'Settings', path: '/admin/settings', icon: Settings },
        { label: 'Audit Log', path: '/admin/audit', icon: History },
        { label: 'Profile', path: '/profile', icon: Users },
      ];
      break;

    case 'disbursement':
      if (isStockMonitor(user)) {
        mainNavItems = [
          { label: 'Not Completed', path: '/stock-transfers', icon: PackageSearch, badge: transferPendingCount, badgeVariant: 'amber' },
          { label: 'Transfer Completed', path: '/stock-transfers/completed', icon: PackageCheck },
          { label: 'Transfer Report', path: '/reports/stock-transfers', icon: FileSpreadsheet },
        ];
        moreNavItems = [
          { label: 'Profile', path: '/profile', icon: UserCheck },
        ];
        break;
      }
      mainNavItems = [
        { label: 'Search', path: '/disbursement', icon: Search },
        { label: 'Awaiting Pay', path: '/disbursement/awaiting', icon: Clock, badge: disbAwaitingCount },
        { label: 'Returned', path: '/returned', icon: RotateCcw, badge: returnedCount, badgeVariant: 'amber' },
        { label: 'Approved', path: '/approved', icon: CheckCircle2 },
      ];
      moreNavItems = [
        { label: 'Paid History', path: '/disbursement/paid', icon: CheckCircle },
        { label: 'Verify Scan', path: '/disbursement/verify', icon: ShieldCheck },
        ...stockReportItem,
        { label: 'Profile', path: '/profile', icon: UserCheck },
      ];
      break;
  }

  const allSidebarItems = [...mainNavItems, ...moreNavItems];

  return (
    <>
      {/* Desktop Left Sidebar (>= 1024px) */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200/80 min-h-[calc(100dvh-4rem)] p-4 shrink-0">
        <div className="space-y-1">
          {allSidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={
                item.path === '/admin' ||
                item.path === '/head' ||
                item.path === '/clerk' ||
                item.path === '/disbursement' ||
                item.path === '/stock-transfers' ||
                item.path === '/my' ||
                item.path === '/regional' ||
                item.path === '/approved' ||
                item.path === '/returned'
              }
              className={({ isActive }) =>
                `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? item.isWaitlistTab
                      ? 'bg-rose-600 text-white shadow-xs font-semibold'
                      : 'bg-indigo-600 text-white shadow-xs font-semibold'
                    : item.isWaitlistTab
                    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold border border-rose-200/80'
                    : item.highlight
                    ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-3">
                    <item.icon
                      className={`w-4 h-4 ${
                        isActive
                          ? 'text-white'
                          : item.isWaitlistTab
                          ? 'text-rose-600'
                          : item.highlight
                          ? 'text-indigo-600'
                          : 'text-slate-400'
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`px-2 py-0.5 text-xs font-bold rounded-full transition-all ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : item.badgeVariant === 'amber'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-rose-500 text-white shadow-xs'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar (< 1024px) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-[env(safe-area-inset-bottom)] shadow-lg">
        <div className="flex items-center justify-between overflow-x-auto h-16 px-1 gap-0.5 scrollbar-none">
          {mainNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={
                item.path === '/admin' ||
                item.path === '/head' ||
                item.path === '/clerk' ||
                item.path === '/disbursement' ||
                item.path === '/stock-transfers' ||
                item.path === '/my' ||
                item.path === '/regional' ||
                item.path === '/approved' ||
                item.path === '/returned'
              }
              className={({ isActive }) =>
                `flex flex-col items-center justify-center shrink-0 min-w-[54px] sm:min-w-[64px] px-1 h-full relative transition-colors ${
                  isActive
                    ? item.isWaitlistTab ? 'text-rose-600 font-bold' : 'text-indigo-600 font-semibold'
                    : item.isWaitlistTab
                    ? 'text-rose-600 font-bold bg-rose-50/60 rounded-xl my-1'
                    : item.highlight
                    ? 'text-indigo-700 font-medium'
                    : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              <div className="relative">
                <item.icon className={`w-5 h-5 ${item.isWaitlistTab ? 'text-rose-600' : ''}`} />
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full ${
                      item.badgeVariant === 'amber' ? 'bg-amber-500' : 'bg-rose-500'
                    } text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow-xs`}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-1 tracking-tight truncate max-w-[62px] ${item.isWaitlistTab ? 'text-rose-700 font-bold' : ''}`}>
                {item.label}
              </span>
            </NavLink>
          ))}

          {/* More Menu Trigger */}
          {moreNavItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMoreMenu(true)}
              className="flex flex-col items-center justify-center shrink-0 min-w-[50px] px-1 h-full text-slate-500 hover:text-slate-800"
              aria-label="More navigation items"
            >
              <Menu className="w-5 h-5" />
              <span className="text-[10px] mt-1 tracking-tight">More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile "More" Drawer Sheet */}
      {showMoreMenu && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={() => setShowMoreMenu(false)}
          />
          <div className="relative z-10 w-full bg-white rounded-t-3xl shadow-2xl p-6 border-t border-slate-200 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 font-display text-base">All Portal Sections</h3>
              <button
                type="button"
                onClick={() => setShowMoreMenu(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              {allSidebarItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setShowMoreMenu(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all ${
                      isActive
                        ? item.isWaitlistTab
                          ? 'bg-rose-50 border-rose-200 text-rose-700 font-bold'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : item.isWaitlistTab
                        ? 'border-rose-200 bg-rose-50/70 text-rose-800 font-bold hover:bg-rose-100'
                        : 'border-slate-100 bg-slate-50/60 text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  <div className="flex items-center gap-3 truncate">
                    <item.icon className={`w-4 h-4 shrink-0 ${item.isWaitlistTab ? 'text-rose-600' : 'text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`px-1.5 py-0.2 text-[10px] font-bold rounded-full ${
                        item.badgeVariant === 'amber' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
