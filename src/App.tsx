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

// Route pages are code-split so phones only download what each role opens.
const page = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const NewRequestPage = page(() => import('./pages/shared/NewRequestPage'), 'NewRequestPage');
const RequestDetailPage = page(() => import('./pages/shared/RequestDetailPage'), 'RequestDetailPage');
const ProfilePage = page(() => import('./pages/shared/ProfilePage'), 'ProfilePage');
const VerifyPage = page(() => import('./pages/shared/VerifyPage'), 'VerifyPage');
const MyRequestsPage = page(() => import('./pages/employee/MyRequestsPage'), 'MyRequestsPage');
const ClerkInboxPage = page(() => import('./pages/clerk/ClerkInboxPage'), 'ClerkInboxPage');
const ClerkDeptRequestsPage = page(() => import('./pages/clerk/ClerkDeptRequestsPage'), 'ClerkDeptRequestsPage');
const HeadDashboardPage = page(() => import('./pages/head/HeadDashboardPage'), 'HeadDashboardPage');
const HeadReviewPage = page(() => import('./pages/head/HeadReviewPage'), 'HeadReviewPage');
const HeadUsersPage = page(() => import('./pages/head/HeadUsersPage'), 'HeadUsersPage');
const AdminDashboardPage = page(() => import('./pages/admin/AdminDashboardPage'), 'AdminDashboardPage');
const AdminApprovePage = page(() => import('./pages/admin/AdminApprovePage'), 'AdminApprovePage');
const AdminAllRequestsPage = page(() => import('./pages/admin/AdminAllRequestsPage'), 'AdminAllRequestsPage');
const AdminDepartmentsPage = page(() => import('./pages/admin/AdminDepartmentsPage'), 'AdminDepartmentsPage');
const AdminShopsPage = page(() => import('./pages/admin/AdminShopsPage'), 'AdminShopsPage');
const AdminHeadsPage = page(() => import('./pages/admin/AdminHeadsPage'), 'AdminHeadsPage');
const AdminDisbursementPage = page(() => import('./pages/admin/AdminDisbursementPage'), 'AdminDisbursementPage');
const AdminCredentialsPage = page(() => import('./pages/admin/AdminCredentialsPage'), 'AdminCredentialsPage');
const AdminSettingsPage = page(() => import('./pages/admin/AdminSettingsPage'), 'AdminSettingsPage');
const AdminAuditLogPage = page(() => import('./pages/admin/AdminAuditLogPage'), 'AdminAuditLogPage');
const DisbursementPage = page(() => import('./pages/disbursement/DisbursementPage'), 'DisbursementPage');
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
        <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-8">
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

                {/* Discount report (Admin + Heads with access) */}
                <Route element={<RequireDiscountReport />}>
                  <Route path="reports/discounts" element={<DiscountReportPage />} />
                </Route>

                {/* Roles that can raise requests */}
                <Route element={<RequireRole roles={['employee', 'clerk', 'head']} />}>
                  <Route path="my" element={<MyRequestsPage />} />
                  <Route path="new" element={<NewRequestPage />} />
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
                  <Route path="head/users" element={<HeadUsersPage />} />
                  <Route path="head/department" element={<ClerkDeptRequestsPage />} />
                </Route>

                {/* Admin routes */}
                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="admin" element={<AdminDashboardPage />} />
                  <Route path="admin/approve" element={<AdminApprovePage />} />
                  <Route path="admin/requests" element={<AdminAllRequestsPage />} />
                  <Route path="admin/departments" element={<AdminDepartmentsPage />} />
                  <Route path="admin/shops" element={<AdminShopsPage />} />
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
