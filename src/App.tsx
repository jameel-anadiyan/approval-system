import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { RequestProvider } from './context/RequestContext';
import { Header } from './components/common/Header';
import { Navigation } from './components/common/Navigation';

import { LoginPage } from './pages/auth/LoginPage';
import { ForcePasswordChangePage } from './pages/auth/ForcePasswordChangePage';
import type { AppRole } from './types/database';
import { canViewDiscountReport } from './lib/discountReport';

import { NewRequestPage } from './pages/shared/NewRequestPage';
import { RequestDetailPage } from './pages/shared/RequestDetailPage';
import { ProfilePage } from './pages/shared/ProfilePage';
import { MyRequestsPage } from './pages/employee/MyRequestsPage';
import { ClerkInboxPage } from './pages/clerk/ClerkInboxPage';
import { RegionalInboxPage } from './pages/regional/RegionalInboxPage';
import { ClerkDeptRequestsPage } from './pages/clerk/ClerkDeptRequestsPage';
import { HeadDashboardPage } from './pages/head/HeadDashboardPage';
import { HeadReviewPage } from './pages/head/HeadReviewPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminApprovePage } from './pages/admin/AdminApprovePage';
import { AdminAllRequestsPage } from './pages/admin/AdminAllRequestsPage';
import { AdminCredentialsPage } from './pages/admin/AdminCredentialsPage';
import { DisbursementPage } from './pages/disbursement/DisbursementPage';
import { ApprovedRequestsPage } from './pages/shared/ApprovedRequestsPage';
import { ReturnedRequestsPage } from './pages/shared/ReturnedRequestsPage';

// Secondary pages are code-split
const page = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const VerifyPage = page(() => import('./pages/shared/VerifyPage'), 'VerifyPage');
const HeadUsersPage = page(() => import('./pages/head/HeadUsersPage'), 'HeadUsersPage');
const HeadConsultationsPage = page(() => import('./pages/head/HeadConsultationsPage'), 'HeadConsultationsPage');
const AdminDepartmentsPage = page(() => import('./pages/admin/AdminDepartmentsPage'), 'AdminDepartmentsPage');
const AdminShopsPage = page(() => import('./pages/admin/AdminShopsPage'), 'AdminShopsPage');
const AdminHeadsPage = page(() => import('./pages/admin/AdminHeadsPage'), 'AdminHeadsPage');
const AdminStaffPage = page(() => import('./pages/admin/AdminStaffPage'), 'AdminStaffPage');
const AdminDisbursementPage = page(() => import('./pages/admin/AdminDisbursementPage'), 'AdminDisbursementPage');
const AdminSettingsPage = page(() => import('./pages/admin/AdminSettingsPage'), 'AdminSettingsPage');
const AdminAuditLogPage = page(() => import('./pages/admin/AdminAuditLogPage'), 'AdminAuditLogPage');
const DisbursementVerifyPage = page(() => import('./pages/disbursement/DisbursementVerifyPage'), 'DisbursementVerifyPage');
const DiscountReportPage = page(() => import('./pages/reports/DiscountReportPage'), 'DiscountReportPage');

const PageSpinner: React.FC = () => (
  <div className="min-h-[50vh] flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin" />
  </div>
);

/** UI guard only; the database (RLS + RPC checks) is the real enforcement. */
const RequireRole: React.FC<{ roles: AppRole[] }> = ({ roles }) => {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <RoleRedirect />;
  return <Outlet />;
};

/** Admin, or a Head that Admin granted Discount Report access. */
const RequireDiscountReport: React.FC = () => {
  const { user } = useAuth();
  if (!canViewDiscountReport(user)) return <RoleRedirect />;
  return <Outlet />;
};

const AppLayout: React.FC = () => {
  const { user, role, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) {
    return <Navigate to="/force-password-change" replace />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50 text-slate-900">
      <Header />
      <div className="flex-1 flex w-full">
        <Navigation />
        <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8">
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

const RoleRedirect: React.FC = () => {
  const { role } = useAuth();
  if (!role) return <Navigate to="/login" replace />;

  switch (role) {
    case 'admin':
      return <Navigate to="/admin" replace />;
    case 'head':
      return <Navigate to="/head" replace />;
    case 'clerk':
      return <Navigate to="/clerk" replace />;
    case 'disbursement':
      return <Navigate to="/disbursement" replace />;
    case 'regional_head':
      return <Navigate to="/regional" replace />;
    case 'employee':
    default:
      return <Navigate to="/my" replace />;
  }
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <RequestProvider>
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/force-password-change" element={<ForcePasswordChangePage />} />
              <Route
                path="/verify/:token?"
                element={
                  <Suspense fallback={<PageSpinner />}>
                    <VerifyPage />
                  </Suspense>
                }
              />

              {/* Protected Portal Routes */}
              <Route path="/" element={<AppLayout />}>
                <Route index element={<RoleRedirect />} />

                {/* Everyone signed in */}
                <Route path="requests/:id" element={<RequestDetailPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="approved" element={<ApprovedRequestsPage />} />
                <Route path="returned" element={<ReturnedRequestsPage />} />

                {/* Discount report (Admin + Heads with access) */}
                <Route element={<RequireDiscountReport />}>
                  <Route path="reports/discounts" element={<DiscountReportPage />} />
                </Route>

                {/* Roles that can raise requests */}
                <Route element={<RequireRole roles={['employee', 'clerk', 'head', 'regional_head']} />}>
                  <Route path="my" element={<MyRequestsPage />} />
                  <Route path="new" element={<NewRequestPage />} />
                </Route>

                {/* Regional Head routes */}
                <Route element={<RequireRole roles={['regional_head']} />}>
                  <Route path="regional" element={<RegionalInboxPage />} />
                  <Route path="regional/forwarded" element={<RegionalInboxPage />} />
                  <Route path="regional/returned" element={<RegionalInboxPage />} />
                </Route>

                {/* Clerk routes */}
                <Route element={<RequireRole roles={['clerk']} />}>
                  <Route path="clerk" element={<ClerkInboxPage />} />
                  <Route path="clerk/department" element={<ClerkDeptRequestsPage />} />
                </Route>

                {/* Head routes */}
                <Route element={<RequireRole roles={['head']} />}>
                  <Route path="head" element={<HeadDashboardPage />} />
                  <Route path="head/review" element={<HeadReviewPage />} />
                  <Route path="head/consultations" element={<HeadConsultationsPage />} />
                  <Route path="head/users" element={<HeadUsersPage />} />
                  <Route path="head/department" element={<ClerkDeptRequestsPage />} />
                  <Route path="head/credentials" element={<AdminCredentialsPage />} />
                </Route>

                {/* Admin routes */}
                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="admin" element={<AdminDashboardPage />} />
                  <Route path="admin/approve" element={<AdminApprovePage />} />
                  <Route path="admin/requests" element={<AdminAllRequestsPage />} />
                  <Route path="admin/departments" element={<AdminDepartmentsPage />} />
                  <Route path="admin/shops" element={<AdminShopsPage />} />
                  <Route path="admin/staff" element={<AdminStaffPage />} />
                  <Route path="admin/heads" element={<AdminHeadsPage />} />
                  <Route path="admin/disbursement" element={<AdminDisbursementPage />} />
                  <Route path="admin/credentials" element={<AdminCredentialsPage />} />
                  <Route path="admin/settings" element={<AdminSettingsPage />} />
                  <Route path="admin/audit" element={<AdminAuditLogPage />} />
                </Route>

                {/* Disbursement routes */}
                <Route element={<RequireRole roles={['disbursement']} />}>
                  <Route path="disbursement" element={<DisbursementPage />} />
                  <Route path="disbursement/awaiting" element={<DisbursementPage />} />
                  <Route path="disbursement/paid" element={<DisbursementPage />} />
                  <Route path="disbursement/verify" element={<DisbursementVerifyPage />} />
                </Route>

                {/* Catch-all fallback */}
                <Route path="*" element={<RoleRedirect />} />
              </Route>
            </Routes>
          </RequestProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
