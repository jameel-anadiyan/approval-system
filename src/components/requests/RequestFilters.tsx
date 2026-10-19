import React, { useId, useMemo, useState } from 'react';
import type { RequestRecord, RequestStatus, RequestType } from '../../types/database';
import { REQUEST_TYPES, TYPE_LABELS, STATUS_META, typeOf } from '../../lib/formatters';
import { Search, SlidersHorizontal, ArrowDownUp, X } from 'lucide-react';

export type SortKey = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export interface FilterState {
  q: string;
  employee: string;
  shop: string; // shop name or 'all'
  type: RequestType | 'all';
  status: RequestStatus | 'all';
  dept: string; // department id or 'all'
  from: string; // yyyy-mm-dd
  to: string;
  sort: SortKey;
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  employee: '',
  shop: 'all',
  type: 'all',
  status: 'all',
  dept: 'all',
  from: '',
  to: '',
  sort: 'newest',
};

const when = (r: RequestRecord) => new Date(r.submitted_at || r.created_at).getTime();

/** Pure filter + sort used by every listing page. */
export function applyFilters(list: RequestRecord[], f: FilterState): RequestRecord[] {
  const q = f.q.trim().toLowerCase();
  const emp = f.employee.trim().toLowerCase();
  const fromTs = f.from ? new Date(`${f.from}T00:00:00+05:30`).getTime() : null;
  const toTs = f.to ? new Date(`${f.to}T23:59:59.999+05:30`).getTime() : null;

  const out = list.filter((r) => {
    if (q) {
      const hay = [r.title, r.request_no, r.approval_no, r.notes, r.shop_name, r.requester_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (emp && !r.requester_name.toLowerCase().includes(emp)) return false;
    if (f.shop !== 'all' && (r.shop_name || '') !== f.shop) return false;
    if (f.type !== 'all' && typeOf(r) !== f.type) return false;
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.dept !== 'all' && r.department_id !== f.dept) return false;
    const t = when(r);
    if (fromTs !== null && t < fromTs) return false;
    if (toTs !== null && t > toTs) return false;
    return true;
  });

  const cmp: Record<SortKey, (a: RequestRecord, b: RequestRecord) => number> = {
    newest: (a, b) => when(b) - when(a),
    oldest: (a, b) => when(a) - when(b),
    amount_desc: (a, b) => b.amount - a.amount,
    amount_asc: (a, b) => a.amount - b.amount,
  };
  return out.sort(cmp[f.sort]);
}

export function useRequestFilters(list: RequestRecord[], initial: Partial<FilterState> = {}) {
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, ...initial });
  const result = useMemo(() => applyFilters(list, filters), [list, filters]);
  return { filters, setFilters, result };
}

interface RequestFiltersProps {
  value: FilterState;
  onChange: (f: FilterState) => void;
  /** The un-filtered list; used to build shop / employee options. */
  source: RequestRecord[];
  showStatus?: boolean;
  statusOptions?: RequestStatus[];
  departments?: { id: string; name: string; code: string }[];
  showEmployee?: boolean;
  resultCount?: number;
}

const inputCls =
  'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

/** Search + sort bar with an expandable panel for shop / employee / type / status / date filters. */
export const RequestFilters: React.FC<RequestFiltersProps> = ({
  value,
  onChange,
  source,
  showStatus = false,
  statusOptions,
  departments,
  showEmployee = true,
  resultCount,
}) => {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...value, [k]: v });

  const shops = useMemo(
    () => Array.from(new Set(source.map((r) => r.shop_name).filter((s): s is string => !!s))).sort(),
    [source]
  );
  const employees = useMemo(() => Array.from(new Set(source.map((r) => r.requester_name))).sort(), [source]);
  const statuses = useMemo(
    () => statusOptions ?? (Array.from(new Set(source.map((r) => r.status))) as RequestStatus[]),
    [source, statusOptions]
  );

  const activeCount =
    (value.employee ? 1 : 0) +
    (value.shop !== 'all' ? 1 : 0) +
    (value.type !== 'all' ? 1 : 0) +
    (value.status !== 'all' ? 1 : 0) +
    (value.dept !== 'all' ? 1 : 0) +
    (value.from ? 1 : 0) +
    (value.to ? 1 : 0);

  const listId = `employees-${useId().replace(/:/g, '')}`;

  return (
    <div className="bg-white/80 backdrop-blur-sm border border-slate-200/90 rounded-2xl p-3 shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            id="filter-search"
            value={value.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search title, request / approval no, shop, employee…"
            className={`${inputCls} pl-9 font-medium`}
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>
        <div className="flex gap-2">
          <label className="relative flex-1 sm:flex-none">
            <span className="sr-only">Sort</span>
            <ArrowDownUp className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <select
              id="filter-sort"
              value={value.sort}
              onChange={(e) => set('sort', e.target.value as SortKey)}
              className={`${inputCls} pl-8 sm:w-48`}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount_desc">Amount: high → low</option>
              <option value="amount_asc">Amount: low → high</option>
            </select>
          </label>
          <button
            type="button"
            id="filter-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
              open || activeCount
                ? 'bg-brand-50 border-brand-300 text-brand-800'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeCount > 0 && (
              <span className="text-[10px] font-bold bg-brand-600 text-white rounded-full px-1.5">{activeCount}</span>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Shop
            <select id="filter-shop" value={value.shop} onChange={(e) => set('shop', e.target.value)} className={`${inputCls} mt-1`}>
              <option value="all">All shops</option>
              {shops.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {showEmployee && (
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Employee
              <input
                id="filter-employee"
                list={listId}
                value={value.employee}
                onChange={(e) => set('employee', e.target.value)}
                placeholder="Any employee"
                className={`${inputCls} mt-1 font-medium normal-case`}
              />
              <datalist id={listId}>
                {employees.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
          )}
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Request type
            <select
              id="filter-type"
              value={value.type}
              onChange={(e) => set('type', e.target.value as FilterState['type'])}
              className={`${inputCls} mt-1`}
            >
              <option value="all">All types</option>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {showStatus && (
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Status
              <select
                id="filter-status"
                value={value.status}
                onChange={(e) => set('status', e.target.value as FilterState['status'])}
                className={`${inputCls} mt-1`}
              >
                <option value="all">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s]?.label ?? s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {departments && departments.length > 0 && (
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Department
              <select id="filter-dept" value={value.dept} onChange={(e) => set('dept', e.target.value)} className={`${inputCls} mt-1`}>
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            From date
            <input id="filter-from" type="date" value={value.from} onChange={(e) => set('from', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            To date
            <input id="filter-to" type="date" value={value.to} onChange={(e) => set('to', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
        </div>
      )}

      {(activeCount > 0 || value.q || resultCount !== undefined) && (
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{resultCount !== undefined ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : ''}</span>
          {(activeCount > 0 || value.q) && (
            <button
              type="button"
              id="filter-clear"
              onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}
              className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-900"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};
