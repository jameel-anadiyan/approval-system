import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { RequestProvider } from './context/RequestContext';
import { Header } from './components/common/Header';
import { Navigation } from './components/common/Navigation';

// Auth Pages
import { LoginPage } from './pages/auth/LoginPage';
import { ForcePasswordChangePage } from './pages/auth/ForcePasswordChangePage';

// Shared Pages
import { NewRequestPage } from './pages/shared/NewRequestPage';
import { RequestDetailPage } from './pages/shared/RequestDetailPage';
import { ProfilePage } from './pages/shared/ProfilePage';
import { VerifyPage } from './pages/shared/VerifyPage';

// Employee
import { MyRequestsPage } from './pages/employee/MyRequestsPage';

// Clerk
import { ClerkInboxPage } from './pages/clerk/ClerkInboxPage';
import { ClerkDeptRequestsPage } from './pages/clerk/ClerkDeptRequestsPage';

// Head
import { HeadDashboardPage } from './pages/head/HeadDashboardPage';
import { HeadReviewPage } from './pages/head/HeadReviewPage';
import { HeadUsersPage } from './pages/head/HeadUsersPage';

// Admin
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminApprovePage } from './pages/admin/AdminApprovePage';
import { AdminAllRequestsPage } from './pages/admin/AdminAllRequestsPage';
import { AdminDepartmentsPage } from './pages/admin/AdminDepartmentsPage';
import { AdminHeadsPage } from './pages/admin/AdminHeadsPage';
import { AdminDisbursementPage } from './pages/admin/AdminDisbursementPage';
import { AdminCredentialsPage } from './pages/admin/AdminCredentialsPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { AdminAuditLogPage } from './pages/admin/AdminAuditLogPage';

// Disbursement
import { DisbursementPage } from './pages/disbursement/DisbursementPage';
import { DisbursementVerifyPage } from './pages/disbursement/DisbursementVerifyPage';

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
          <Outlet />
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
              <Route path="/verify/:token?" element={<VerifyPage />} />

              {/* Protected Portal Routes */}
              <Route path="/" element={<AppLayout />}>
                <Route index element={<RoleRedirect />} />

                {/* Shared routes for all users who can raise/view requests */}
                <Route path="my" element={<MyRequestsPage />} />
                <Route path="new" element={<NewRequestPage />} />
                <Route path="requests/:id" element={<RequestDetailPage />} />
                <Route path="profile" element={<ProfilePage />} />

                {/* Clerk routes */}
                <Route path="clerk" element={<ClerkInboxPage />} />
                <Route path="clerk/department" element={<ClerkDeptRequestsPage />} />

                {/* Head routes */}
                <Route path="head" element={<HeadDashboardPage />} />
                <Route path="head/review" element={<HeadReviewPage />} />
                <Route path="head/users" element={<HeadUsersPage />} />
                <Route path="head/department" element={<ClerkDeptRequestsPage />} />

                {/* Admin routes */}
                <Route path="admin" element={<AdminDashboardPage />} />
                <Route path="admin/approve" element={<AdminApprovePage />} />
                <Route path="admin/requests" element={<AdminAllRequestsPage />} />
                <Route path="admin/departments" element={<AdminDepartmentsPage />} />
                <Route path="admin/heads" element={<AdminHeadsPage />} />
                <Route path="admin/disbursement" element={<AdminDisbursementPage />} />
                <Route path="admin/credentials" element={<AdminCredentialsPage />} />
                <Route path="admin/settings" element={<AdminSettingsPage />} />
                <Route path="admin/audit" element={<AdminAuditLogPage />} />

                {/* Disbursement routes */}
                <Route path="disbursement" element={<DisbursementPage />} />
                <Route path="disbursement/awaiting" element={<DisbursementPage />} />
                <Route path="disbursement/paid" element={<DisbursementPage />} />
                <Route path="disbursement/verify" element={<DisbursementVerifyPage />} />

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
