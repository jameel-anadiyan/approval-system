import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { Building2 } from 'lucide-react';

export const ClerkDeptRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();

  const deptRequests = requests.filter(
    (r) => !user?.department_id || r.department_id === user.department_id
  );
  const { filters, setFilters, result: filtered } = useRequestFilters(deptRequests);

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

      <RequestFilters
        value={filters}
        onChange={setFilters}
        source={deptRequests}
        showStatus
        resultCount={filtered.length}
      />

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
