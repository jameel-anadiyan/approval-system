import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { RequestCard } from '../../components/requests/RequestCard';
import { EmptyState } from '../../components/common/EmptyState';
import { PlusCircle, Search, Filter, FileText } from 'lucide-react';
import { RequestStatus } from '../../types/database';

type TabKey = 'under_process' | 'returned' | 'approved' | 'rejected' | 'paid' | 'draft';

export const MyRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>('under_process');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter requests belonging to current user
  const myRequests = requests.filter((r) => r.requester_id === user?.id);

  const getRequestsForTab = (tab: TabKey) => {
    switch (tab) {
      case 'under_process':
        return myRequests.filter((r) =>
          [
            'submitted',
            'pending_head_review',
            'pending_head_approval',
            'pending_admin_approval',
            'approving',
          ].includes(r.status)
        );
      case 'returned':
        return myRequests.filter((r) => r.status === 'returned');
      case 'approved':
        return myRequests.filter((r) => r.status === 'approved');
      case 'rejected':
        return myRequests.filter((r) => r.status === 'rejected');
      case 'paid':
        return myRequests.filter((r) => r.status === 'paid');
      case 'draft':
        return myRequests.filter((r) => r.status === 'draft');
    }
  };

  const tabRequests = getRequestsForTab(activeTab);

  const filtered = tabRequests.filter(
    (r) =>
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.request_no && r.request_no.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.approval_no && r.approval_no.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'under_process', label: 'Under Process', count: getRequestsForTab('under_process').length },
    { key: 'returned', label: 'Returned', count: getRequestsForTab('returned').length },
    { key: 'approved', label: 'Approved', count: getRequestsForTab('approved').length },
    { key: 'paid', label: 'Paid', count: getRequestsForTab('paid').length },
    { key: 'rejected', label: 'Rejected', count: getRequestsForTab('rejected').length },
    { key: 'draft', label: 'Drafts', count: getRequestsForTab('draft').length },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
            My Money Requests
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Track status, edit returned items, and download officially stamped approval packets.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/new')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-200 transition-all active:scale-95 shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Raise New Request</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2 scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === tab.key
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title or request number…"
          className="w-full text-xs sm:text-sm pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
      </div>

      {/* Request Cards Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={searchQuery ? 'No matching requests' : `No ${activeTab.replace('_', ' ')} requests`}
          description={
            searchQuery
              ? 'Try adjusting your search keywords.'
              : 'Requests raised by you in this status category will appear here.'
          }
          actionText={activeTab === 'draft' || activeTab === 'under_process' ? 'Create New Request' : undefined}
          onAction={() => navigate('/new')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((req) => (
            <RequestCard key={req.id} request={req} showDepartment={false} />
          ))}
        </div>
      )}
    </div>
  );
};
