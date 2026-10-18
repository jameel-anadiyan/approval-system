import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { Building2, Search, Filter } from 'lucide-react';
import { RequestStatus } from '../../types/database';

export const ClerkDeptRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const deptRequests = requests.filter(
    (r) => !user?.department_id || r.department_id === user.department_id
  );

  const filtered = deptRequests.filter((r) => {
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchesSearch =
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.requester_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.request_no && r.request_no.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.approval_no && r.approval_no.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <Building2 className="w-6 h-6 text-indigo-600" />
          <span>Department Requests — {user?.department?.name || 'Department'}</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Complete log of all requests raised within your department.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, requester, or request number…"
            className="w-full text-xs sm:text-sm pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="all">All Statuses ({deptRequests.length})</option>
          <option value="submitted">Submitted</option>
          <option value="pending_head_review">Pending Head Review (Route A)</option>
          <option value="pending_head_approval">Pending Head Approval (Route B)</option>
          <option value="pending_admin_approval">Pending Admin Approval</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="returned">Returned</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No Requests Found"
          description="No department requests match your current search or status filter."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((req) => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
};
