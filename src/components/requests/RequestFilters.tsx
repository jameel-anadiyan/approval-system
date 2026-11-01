import React, { useId, useMemo, useState } from 'react';
import type { RequestRecord, RequestStatus, RequestType } from '../../types/database';
import {
  getTodayIST,
  REQUEST_TYPES,
  STATUS_META,
  toISTDateKey,
  TYPE_LABELS,
  typeOf,
} from '../../lib/formatters';
import { Search, SlidersHorizontal, ArrowDownUp, Calendar, X } from 'lucide-react';

export type SortKey = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
export type FilterDateField = 'submitted' | 'approved';

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
  entryOfficer?: string; // entry user id / name or 'all'
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
  entryOfficer: 'all',
};

const rawDateOf = (r: RequestRecord, dateField: FilterDateField): string =>
  dateField === 'approved'
    ? r.decided_at || r.updated_at || r.created_at
    : r.submitted_at || r.created_at;

/** Pure filter + sort used by every listing page. */
export function applyFilters(
  list: RequestRecord[],
  f: FilterState,
  dateField: FilterDateField = 'submitted'
): RequestRecord[] {
  const q = f.q.trim().toLowerCase();
  const emp = f.employee.trim().toLowerCase();
  const effectiveDateField: FilterDateField =
    dateField === 'approved' || f.status === 'approved' || f.status === 'paid'
      ? 'approved'
      : 'submitted';
  const when = (r: RequestRecord) => new Date(rawDateOf(r, effectiveDateField)).getTime();

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
    if (f.entryOfficer && f.entryOfficer !== 'all') {
      const matchAssignedId = r.assigned_entry_user_id === f.entryOfficer;
      const matchAssignedName = r.assigned_entry_user_name === f.entryOfficer;
      const matchEntryCreator = (r.disbursement_entries || []).some(
        (e) => e.created_by === f.entryOfficer || e.created_by_name === f.entryOfficer
      );
      if (!matchAssignedId && !matchAssignedName && !matchEntryCreator) return false;
    }
    if (f.from || f.to) {
      const dateKey = toISTDateKey(rawDateOf(r, effectiveDateField));
      if (!dateKey) return false;
      if (f.from && dateKey < f.from) return false;
      if (f.to && dateKey > f.to) return false;
    }
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

export function useRequestFilters(
  list: RequestRecord[],
  initial: Partial<FilterState> = {},
  dateField: FilterDateField = 'submitted'
) {
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, ...initial });
  const result = useMemo(() => applyFilters(list, filters, dateField), [list, filters, dateField]);
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
  dateField?: FilterDateField;
  inlineDateFilter?: boolean;
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
  dateField = 'submitted',
  inlineDateFilter = false,
}) => {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...value, [k]: v });

  const effectiveDateField: FilterDateField =
    dateField === 'approved' || value.status === 'approved' || value.status === 'paid'
      ? 'approved'
      : 'submitted';
  const showInlineDates =
    inlineDateFilter || value.status === 'approved' || value.status === 'paid';
  const todayIST = getTodayIST();
  const isTodayOnly = value.from === todayIST && value.to === todayIST;

  const todayCount = useMemo(() => {
    return source.filter((r) => {
      if (value.status !== 'all' && r.status !== value.status) return false;
      return toISTDateKey(rawDateOf(r, effectiveDateField)) === todayIST;
    }).length;
  }, [source, value.status, effectiveDateField, todayIST]);

  const toggleTodayOnly = () => {
    const today = getTodayIST();
    if (value.from === today && value.to === today) {
      onChange({ ...value, from: '', to: '' });
    } else {
      onChange({ ...value, from: today, to: today });
    }
  };

  const handleFromChange = (fromVal: string) => {
    const nextTo = value.to && fromVal && fromVal > value.to ? fromVal : value.to;
    onChange({ ...value, from: fromVal, to: nextTo });
  };

  const handleToChange = (toVal: string) => {
    const nextFrom = value.from && toVal && toVal < value.from ? toVal : value.from;
    onChange({ ...value, from: nextFrom, to: toVal });
  };

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
    (value.to ? 1 : 0) +
    (value.entryOfficer && value.entryOfficer !== 'all' ? 1 : 0);

  const entryOfficers = useMemo(() => {
    const map = new Map<string, string>();
    source.forEach((r) => {
      if (r.assigned_entry_user_id && r.assigned_entry_user_name) {
        map.set(r.assigned_entry_user_id, r.assigned_entry_user_name);
      }
      (r.disbursement_entries || []).forEach((e) => {
        if (e.created_by && e.created_by_name) {
          map.set(e.created_by, e.created_by_name);
        }
      });
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [source]);

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

      {showInlineDates && (
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            id="filter-inline-today-only"
            onClick={toggleTodayOnly}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
              isTodayOnly
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-200'
                : 'bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Today Only</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                isTodayOnly ? 'bg-white/20 text-white' : 'bg-emerald-200/80 text-emerald-900'
              }`}
            >
              {todayCount}
            </span>
          </button>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">From</span>
              <input
                type="date"
                id="filter-inline-from"
                value={value.from}
                max={value.to || undefined}
                onChange={(e) => handleFromChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 outline-hidden cursor-pointer"
              />
            </label>

            <span className="text-slate-400 text-xs font-bold hidden sm:inline">→</span>

            <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">To</span>
              <input
                type="date"
                id="filter-inline-to"
                value={value.to}
                min={value.from || undefined}
                onChange={(e) => handleToChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 outline-hidden cursor-pointer"
              />
            </label>
          </div>
        </div>
      )}

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
            <span className="flex items-center justify-between">
              <span>From date</span>
              <button
                type="button"
                onClick={toggleTodayOnly}
                className={`text-[10px] font-bold normal-case px-1.5 py-0.2 rounded cursor-pointer ${
                  isTodayOnly ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:underline'
                }`}
              >
                Today Only
              </button>
            </span>
            <input
              id="filter-from"
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => handleFromChange(e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            To date
            <input
              id="filter-to"
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => handleToChange(e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          {entryOfficers.length > 0 && (
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Entry Officer
              <select
                id="filter-entry-officer"
                value={value.entryOfficer || 'all'}
                onChange={(e) => set('entryOfficer', e.target.value)}
                className={`${inputCls} mt-1`}
              >
                <option value="all">All entry officers</option>
                {entryOfficers.map((eo) => (
                  <option key={eo.id} value={eo.id}>
                    {eo.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
