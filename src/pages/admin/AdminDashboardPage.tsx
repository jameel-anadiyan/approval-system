import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { formatINR } from '../../lib/formatters';
import { MOCK_DEPARTMENTS, MOCK_USERS } from '../../lib/mockData';
import {
  ShieldCheck,
  CheckCircle,
  TrendingUp,
  Building2,
  Users,
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  // Admin To-Approve: status === 'pending_admin_approval'
  const pendingApprovals = requests.filter((r) => r.status === 'pending_admin_approval');

  // Total Disbursed / Approved
  const totalApproved = requests
    .filter((r) => r.status === 'approved' || r.status === 'paid')
    .reduce((sum, r) => sum + r.amount, 0);

  // High Value requests
  const highValueCount = requests.filter((r) => r.amount > 10000).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-200 inline-block mb-1">
            System Executive Dashboard
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            Administrator Portal — {user?.full_name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Full enterprise oversight across all departments, digital signing, and treasury approvals.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/admin/requests')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors self-start sm:self-auto shadow-xs"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>All Requests Table</span>
        </button>
      </div>

      {/* KPI Tiles (2 per row on phone, 4 on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          onClick={() => navigate('/admin/approve')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-red-200/90 shadow-xs cursor-pointer hover:border-red-300 transition-all"
        >
          <div className="flex items-center justify-between text-red-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Awaiting Sign</span>
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-red-950 font-display">
            {pendingApprovals.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">A-route requests to approve</span>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-emerald-200/90 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total Sanctioned</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display truncate">
            {formatINR(totalApproved)}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Approved & Disbursed</span>
        </div>

        <div
          onClick={() => navigate('/admin/departments')}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs cursor-pointer hover:border-slate-300 transition-all"
        >
          <div className="flex items-center justify-between text-slate-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Departments</span>
            <Building2 className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
            {MOCK_DEPARTMENTS.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Active cost centers</span>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-amber-200/90 shadow-xs">
          <div className="flex items-center justify-between text-amber-600 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">High-Value (&gt; ₹10k)</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-950 font-display">
            {highValueCount}
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Admin mandated route</span>
        </div>
      </div>

      {/* Main Section: Admin To-Approve Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display flex items-center gap-2">
            <span>Awaiting Admin Digital Stamp & Sign</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
              {pendingApprovals.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => navigate('/admin/approve')}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <span>View Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-8 text-center text-slate-400 text-xs sm:text-sm">
            No requests currently pending Admin approval. All A-route items are up to date!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingApprovals.map((req) => (
              <RequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
        <button
          type="button"
          onClick={() => navigate('/admin/heads')}
          className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all group"
        >
          <Users className="w-5 h-5 text-indigo-600 mb-2 group-hover:scale-105 transition-transform" />
          <div className="font-bold text-xs sm:text-sm text-slate-900">Dept Heads</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Manage Head logins & seals</p>
        </button>

        <button
          type="button"
          onClick={() => navigate('/admin/disbursement')}
          className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all group"
        >
          <Building2 className="w-5 h-5 text-teal-600 mb-2 group-hover:scale-105 transition-transform" />
          <div className="font-bold text-xs sm:text-sm text-slate-900">Disbursement</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Cashier user accounts</p>
        </button>

        <button
          type="button"
          onClick={() => navigate('/admin/credentials')}
          className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all group"
        >
          <ShieldCheck className="w-5 h-5 text-purple-600 mb-2 group-hover:scale-105 transition-transform" />
          <div className="font-bold text-xs sm:text-sm text-slate-900">My Seal & Sign</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Upload Admin PNG stamps</p>
        </button>

        <button
          type="button"
          onClick={() => navigate('/admin/settings')}
          className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left transition-all group"
        >
          <TrendingUp className="w-5 h-5 text-amber-600 mb-2 group-hover:scale-105 transition-transform" />
          <div className="font-bold text-xs sm:text-sm text-slate-900">Settings</div>
          <p className="text-[11px] text-slate-400 mt-0.5">₹10,000 threshold & prefixes</p>
        </button>
      </div>
    </div>
  );
};
