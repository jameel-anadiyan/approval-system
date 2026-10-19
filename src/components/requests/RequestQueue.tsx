import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { SearchX } from 'lucide-react';
import type { RequestRecord } from '../../types/database';
import { RequestCard } from './RequestCard';
import { RequestFilters, useRequestFilters, type FilterState } from './RequestFilters';
import { EmptyState } from '../common/EmptyState';
import { BulkApproveBar, useSelection } from '../portals/BulkApprove';

interface RequestQueueProps {
  items: RequestRecord[];
  /** Show checkboxes + select-all + "Approve selected" (Head / Admin approval queues only). */
  bulkApprove?: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  initialFilters?: Partial<FilterState>;
  showStatus?: boolean;
  showDepartment?: boolean;
}

/** Filterable card grid used by the work queues, optionally with bulk approve. */
export const RequestQueue: React.FC<RequestQueueProps> = ({
  items,
  bulkApprove = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  initialFilters,
  showStatus = false,
  showDepartment = true,
}) => {
  const { filters, setFilters, result } = useRequestFilters(items, initialFilters);
  const selection = useSelection(result.map((r) => r.id));

  if (items.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="space-y-4">
      <RequestFilters value={filters} onChange={setFilters} source={items} showStatus={showStatus} resultCount={result.length} />
      {bulkApprove && <BulkApproveBar items={result} selection={selection} />}
      {result.length === 0 ? (
        <EmptyState icon={SearchX} title="No matching requests" description="Try clearing the filters." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {result.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              showDepartment={showDepartment}
              selectable={bulkApprove}
              selected={selection.selected.has(req.id)}
              onToggleSelect={selection.toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};
