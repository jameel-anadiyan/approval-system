import React from 'react';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { StatusBadge, TypeBadge } from '../../components/common/StatusBadge';
import { formatINR, typeOf, TYPE_LABELS } from '../../lib/formatters';
import { useDirectory } from '../../lib/directory';
import { Download, FileSpreadsheet, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RequestStatus } from '../../types/database';

const ALL_STATUSES: RequestStatus[] = [
  'submitted',
  'pending_head_review',
  'pending_head_approval',
  'pending_admin_approval',
  'approved',
  'paid',
  'returned',
  'rejected',
  'withdrawn',
  'cancelled',
];

export const AdminAllRequestsPage: React.FC = () => {
  const { requests } = useRequests();
  const { departments } = useDirectory();
  const navigate = useNavigate();

  const { filters, setFilters, result: filtered } = useRequestFilters(requests);

  const exportCSV = () => {
    const headers = [
      'Request No',
      'Type',
      'Title',
      'Requester',
      'Shop',
      'Department',
      'Amount (INR)',
      'Status',
      'Route',
      'Approval No',
      'Submitted Date',
      'Approved Date',
    ];

    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = filtered.map((r) => [
      q(r.request_no || 'DRAFT'),
      q(TYPE_LABELS[typeOf(r)]),
      q(r.title),
      q(r.requester_name),
      q(r.shop_name || ''),
      q(r.department?.code || ''),
      r.amount.toFixed(2),
      q(r.status),
      q(r.route || ''),
      q(r.approval_no || ''),
      q(r.submitted_at || r.created_at),
      q(r.decided_at || ''),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `approval_requests_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
            <span>All Enterprise Requests</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Complete database of money requests across all organizational departments.
          </p>
        </div>

        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors self-start sm:self-auto shadow-xs"
        >
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
      </div>

      <RequestFilters
        value={filters}
        onChange={setFilters}
        source={requests}
        showStatus
        statusOptions={ALL_STATUSES}
        departments={departments}
        resultCount={filtered.length}
      />

      {/* Responsive View: Cards on mobile (< 768px), Table on desktop (>= 768px) */}
      <div className="md:hidden space-y-4">
        {filtered.map((req) => (
          <RequestCard key={req.id} request={req} />
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200 tracking-wider">
              <tr>
                <th className="p-3.5">Request No</th>
                <th className="p-3.5">Title & Requester</th>
                <th className="p-3.5">Dept</th>
                <th className="p-3.5">Amount</th>
                <th className="p-3.5">Route</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Approval No</th>
                <th className="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filtered.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="p-3.5 font-mono font-bold text-slate-900">
                    {req.request_no || 'DRAFT'}
                    <div className="mt-1">
                      <TypeBadge type={typeOf(req)} />
                    </div>
                  </td>
                  <td className="p-3.5 max-w-xs">
                    <div className="font-bold text-slate-900 truncate">{req.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {req.requester_name}
                      {req.shop_name ? ` · ${req.shop_name}` : ''}
                    </div>
                  </td>
                  <td className="p-3.5 font-bold text-slate-700">
                    {req.department?.code || '—'}
                  </td>
                  <td className="p-3.5 font-bold text-slate-900 font-display">
                    {formatINR(req.amount)}
                  </td>
                  <td className="p-3.5">
                    {req.route ? (
                      <span className="font-bold text-indigo-700">Route {req.route}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3.5">
                    <StatusBadge status={req.status} requestType={typeOf(req)} size="sm" />
                  </td>
                  <td className="p-3.5 font-mono text-[11px] font-bold text-emerald-800">
                    {req.approval_no || '—'}
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/requests/${req.id}`)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title="View details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
