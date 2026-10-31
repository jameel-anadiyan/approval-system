import React, { useState } from 'react';
import { Bell, LogOut, KeyRound, CheckCircle2, User, ChevronDown, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { ROLE_LABELS, ROLE_BADGES, formatRelativeTime } from '../../lib/formatters';
import { AppRole } from '../../types/database';
import { Link, useNavigate } from 'react-router-dom';

export const Header: React.FC = () => {
  const { user, role, logout, switchMockRole, isBackendConnected } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roles: { role: AppRole; label: string; short: string }[] = [
    { role: 'admin', label: 'Admin (Approver)', short: 'ADMIN' },
    { role: 'head', label: 'Head (Approver)', short: 'HEAD' },
    { role: 'regional_head', label: 'Regional Head (South)', short: 'REGIONAL' },
    { role: 'clerk', label: 'Clerk (Router)', short: 'CLERK' },
    { role: 'employee', label: 'Employee (Requester)', short: 'EMPLOYEE' },
    { role: 'disbursement', label: 'Disbursement (Cashier)', short: 'DISB' },
  ];

  const getRoleRoute = (r: AppRole): string => {
    switch (r) {
      case 'admin':
        return '/admin';
      case 'head':
        return '/head';
      case 'clerk':
        return '/clerk';
      case 'disbursement':
        return '/disbursement';
      case 'regional_head':
        return '/regional';
      case 'employee':
      default:
        return '/my';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-11 h-11 rounded-xl bg-white border border-brand-100 overflow-hidden flex items-center justify-center shadow-sm shadow-brand-100 group-hover:scale-105 transition-transform">
              <img src="/swa-logo.jpg" alt="SWA Diamonds" className="w-full h-full object-contain scale-125" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-base sm:text-lg text-brand-800 leading-tight tracking-wide">
                  SWA Diamonds
                </span>
                <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-gold-50 text-gold-600 border border-gold-200">
                  Approvals
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden md:block">
                Secure digital sign &amp; disbursement
              </p>
            </div>
          </Link>
        </div>

        {/* Demo role switcher — offline sandbox only */}
        <div className={`${isBackendConnected ? 'hidden' : 'hidden lg:flex'} items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200`}>
          <span className="text-xs font-semibold text-slate-400 px-2 uppercase tracking-wider">
            Switch Role:
          </span>
          {roles.map((r) => (
            <button
              key={r.role}
              type="button"
              onClick={() => {
                switchMockRole(r.role);
                navigate(getRoleRoute(r.role));
              }}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                role === r.role
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              {r.short}
            </button>
          ))}
        </div>

        {/* Actions & Profile */}
        <div className="flex items-center gap-2">
          {/* Mobile demo role switcher — offline sandbox only */}
          <div className={isBackendConnected ? 'hidden' : 'relative lg:hidden'}>
            <button
              type="button"
              onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 border border-slate-200"
            >
              <span className="capitalize">{role}</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showRoleSwitcher && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  Switch Role
                </div>
                {roles.map((r) => (
                  <button
                    key={r.role}
                    type="button"
                    onClick={() => {
                      switchMockRole(r.role);
                      setShowRoleSwitcher(false);
                      navigate(getRoleRoute(r.role));
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                      role === r.role ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{r.label}</span>
                    {role === r.role && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Connection Status indicator */}
          <div
            title={
              isBackendConnected
                ? 'Supabase Edge & DB Connected'
                : 'Interactive Sandbox Mode (Connects automatically when Supabase project is active)'
            }
            className={`hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${
              isBackendConnected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>{isBackendConnected ? 'Live Supabase' : 'Sandbox Mode'}</span>
          </div>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors relative"
              aria-label="View notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-4 h-4 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white animate-in zoom-in">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifMenu && (
              <div className="fixed left-2 right-2 top-16 max-h-[70dvh] overflow-y-auto sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => markAllAsRead()}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-400">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          markAsRead(n.id);
                          if (n.request_id) {
                            navigate(`/requests/${n.request_id}`);
                            setShowNotifMenu(false);
                          }
                        }}
                        className={`p-3.5 text-left cursor-pointer transition-colors hover:bg-slate-50 flex gap-3 ${
                          !n.read_at ? 'bg-indigo-50/50' : ''
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            !n.read_at ? 'bg-indigo-600' : 'bg-transparent'
                          }`}
                        />
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed line-clamp-2">
                            {n.body}
                          </p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {formatRelativeTime(n.created_at)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="hidden sm:block text-left text-xs leading-tight">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <span>{user?.full_name || 'Guest'}</span>
                </div>
                <div className="text-[11px] text-slate-500 font-medium capitalize">
                  {role ? ROLE_LABELS[role] : 'User'}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{user?.full_name}</p>
                  <p className="text-[11px] text-slate-500 font-mono">@{user?.username}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {role && (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${ROLE_BADGES[role]}`}
                      >
                        {role}
                      </span>
                    )}
                    {user?.department && (
                      <span className="text-[10px] text-slate-500 font-medium">
                        • {user.department.code}
                      </span>
                    )}
                  </div>
                </div>

                <div className="py-1">
                  <Link
                    to="/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <User className="w-4 h-4 text-slate-400" />
                    <span>My Profile</span>
                  </Link>
                  <Link
                    to="/profile#whatsapp"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-600" />
                    <span>WhatsApp Notifications</span>
                  </Link>
                  <Link
                    to="/profile#password"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <KeyRound className="w-4 h-4 text-slate-400" />
                    <span>Change Password</span>
                  </Link>
                </div>

                <div className="border-t border-slate-100 pt-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 transition-colors text-left font-medium"
                  >
                    <LogOut className="w-4 h-4 text-rose-500" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
