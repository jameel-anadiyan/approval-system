import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Percent, Store, IndianRupee, TrendingUp, Download, RotateCcw, Search, Users, CalendarRange,
  BarChart3, Trophy, ShieldAlert, ArrowUpDown, X, Building2,
} from 'lucide-react';
import { useDiscountReport, type DiscountRow } from '../../lib/discountReport';
import { formatINR, formatINRWhole, formatISTDate } from '../../lib/formatters';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import type { RequestStatus } from '../../types/database';

// ───────────────────────── helpers ─────────────────────────

type StatusGroup = 'approved' | 'pending' | 'rejected' | 'all';
const STATUS_GROUPS: Record<Exclude<StatusGroup, 'all'>, RequestStatus[]> = {
  approved: ['approved', 'paid'],
  pending: ['submitted', 'returned', 'pending_head_approval', 'pending_head_review', 'pending_admin_approval', 'approving'],
  rejected: ['rejected', 'withdrawn'],
};
const GROUP_LABELS: Record<StatusGroup, string> = {
  approved: 'Approved', pending: 'Pending', rejected: 'Rejected / Withdrawn', all: 'All submitted',
};

type Preset = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'this_fy' | 'all' | 'custom';
const PRESET_LABELS: Record<Preset, string> = {
  this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', last_90: 'Last 90 days',
  this_fy: 'This financial year', all: 'All time', custom: 'Custom',
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case 'this_month': return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
    case 'last_month': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'last_30': return { from: ymd(new Date(y, m, now.getDate() - 29)), to: ymd(now) };
    case 'last_90': return { from: ymd(new Date(y, m, now.getDate() - 89)), to: ymd(now) };
    case 'this_fy': {
      const fyStart = m >= 3 ? y : y - 1; // Indian FY: 1 Apr – 31 Mar
      return { from: `${fyStart}-04-01`, to: ymd(now) };
    }
    default: return { from: '', to: '' };
  }
}

const BANDS = [
  { label: 'Up to 5%', min: 0, max: 5 },
  { label: '5 – 10%', min: 5, max: 10 },
  { label: '10 – 15%', min: 10, max: 15 },
  { label: '15 – 20%', min: 15, max: 20 },
  { label: 'Above 20%', min: 20, max: Infinity },
];

interface Group {
  key: string;
  name: string;
  count: number;
  value: number;
  before: number;
  maxPct: number;
}
const groupBy = (rows: DiscountRow[], key: (r: DiscountRow) => string, name: (r: DiscountRow) => string): Group[] => {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, name: name(r), count: 0, value: 0, before: 0, maxPct: 0 };
    g.count += 1;
    g.value += r.discount_amount;
    g.before += r.before_amount;
    g.maxPct = Math.max(g.maxPct, r.discount_pct);
    m.set(k, g);
  }
  return [...m.values()];
};
/** Weighted average: total discount ÷ total pre-discount value */
const avgPct = (g: { value: number; before: number }) => (g.before > 0 ? (g.value / g.before) * 100 : 0);

const inputCls =
  'w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-hidden bg-white';

// ───────────────────────── page ─────────────────────────

type ShopSort = 'value' | 'count' | 'avg' | 'name';
type RowSort = 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'pct_desc' | 'pct_asc';

export const DiscountReportPage: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('this_month');
  const [range, setRange] = useState(presetRange('this_month'));
  const { rows, loading, error } = useDiscountReport(range.from, range.to);

  const [group, setGroup] = useState<StatusGroup>('approved');
  const [shop, setShop] = useState('');
  const [dept, setDept] = useState('');
  const [employee, setEmployee] = useState('');
  const [search, setSearch] = useState('');
  const [minPct, setMinPct] = useState('');
  const [maxPct, setMaxPct] = useState('');
  const [shopSort, setShopSort] = useState<ShopSort>('value');
  const [rowSort, setRowSort] = useState<RowSort>('newest');
  const [showAll, setShowAll] = useState(false);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const resetFilters = () => {
    setGroup('approved'); setShop(''); setDept(''); setEmployee(''); setSearch('');
    setMinPct(''); setMaxPct(''); choosePreset('this_month');
  };

  // option lists come from the date-window rows so they're always relevant
  const shops = useMemo(() => groupBy(rows, (r) => r.shop_id ?? 'none', (r) => r.shop_name).sort((a, b) => a.name.localeCompare(b.name)), [rows]);
  const depts = useMemo(
    () => groupBy(rows, (r) => r.department_id ?? 'none', (r) => r.department_name ?? '—').sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const employees = useMemo(
    () => groupBy(rows, (r) => r.requester_id, (r) => r.requester_name).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lo = minPct.trim() ? Number(minPct) : null;
    const hi = maxPct.trim() ? Number(maxPct) : null;
    return rows.filter((r) => {
      if (group !== 'all' && !STATUS_GROUPS[group].includes(r.status)) return false;
      if (shop && (r.shop_id ?? 'none') !== shop) return false;
      if (dept && (r.department_id ?? 'none') !== dept) return false;
      if (employee && r.requester_id !== employee) return false;
      if (lo !== null && r.discount_pct < lo) return false;
      if (hi !== null && r.discount_pct > hi) return false;
      if (q) {
        const hay = [r.request_no, r.title, r.customer_name, r.reference, r.requester_name, r.shop_name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, group, shop, dept, employee, search, minPct, maxPct]);

  // ── aggregates ──
  const totals = useMemo(() => {
    const value = filtered.reduce((s, r) => s + r.discount_amount, 0);
    const before = filtered.reduce((s, r) => s + r.before_amount, 0);
    const after = filtered.reduce((s, r) => s + r.after_amount, 0);
    const highest = filtered.reduce<DiscountRow | null>((h, r) => (!h || r.discount_pct > h.discount_pct ? r : h), null);
    return { value, before, after, count: filtered.length, avg: avgPct({ value, before }), highest };
  }, [filtered]);

  const byShop = useMemo(() => {
    const g = groupBy(filtered, (r) => r.shop_id ?? 'none', (r) => r.shop_name);
    const cmp: Record<ShopSort, (a: Group, b: Group) => number> = {
      value: (a, b) => b.value - a.value,
      count: (a, b) => b.count - a.count,
      avg: (a, b) => avgPct(b) - avgPct(a),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return g.sort(cmp[shopSort]);
  }, [filtered, shopSort]);
  const topShop = useMemo(() => [...byShop].sort((a, b) => b.value - a.value)[0], [byShop]);
  const maxShopValue = Math.max(1, ...byShop.map((s) => s.value));

  const byEmployee = useMemo(
    () => groupBy(filtered, (r) => r.requester_id, (r) => r.requester_name).sort((a, b) => b.value - a.value).slice(0, 8),
    [filtered]
  );

  const byMonth = useMemo(() => {
    const g = groupBy(
      filtered.filter((r) => r.submitted_at),
      (r) => r.submitted_at!.slice(0, 7),
      (r) => new Date(r.submitted_at!).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    );
    return g.sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  }, [filtered]);
  const maxMonthValue = Math.max(1, ...byMonth.map((m) => m.value));

  const bands = useMemo(
    () => BANDS.map((b) => {
      const inBand = filtered.filter((r) => r.discount_pct >= b.min && (r.discount_pct < b.max || (b.max === Infinity)));
      return { ...b, count: inBand.length, value: inBand.reduce((s, r) => s + r.discount_amount, 0) };
    }),
    [filtered]
  );
  const maxBandCount = Math.max(1, ...bands.map((b) => b.count));

  const sortedRows = useMemo(() => {
    const t = (r: DiscountRow) => (r.submitted_at ? new Date(r.submitted_at).getTime() : 0);
    const cmp: Record<RowSort, (a: DiscountRow, b: DiscountRow) => number> = {
      newest: (a, b) => t(b) - t(a),
      oldest: (a, b) => t(a) - t(b),
      value_desc: (a, b) => b.discount_amount - a.discount_amount,
      value_asc: (a, b) => a.discount_amount - b.discount_amount,
      pct_desc: (a, b) => b.discount_pct - a.discount_pct,
      pct_asc: (a, b) => a.discount_pct - b.discount_pct,
    };
    return [...filtered].sort(cmp[rowSort]);
  }, [filtered, rowSort]);
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 50);

  const exportCsv = () => {
    const head = ['Request No', 'Submitted', 'Decided', 'Status', 'Shop', 'Department', 'Employee', 'Approver',
      'Customer', 'Reference', 'Before (INR)', 'After (INR)', 'Discount (INR)', 'Discount %', 'Subject'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = sortedRows.map((r) => [
      r.request_no, r.submitted_at ? formatISTDate(r.submitted_at, false) : '', r.decided_at ? formatISTDate(r.decided_at, false) : '',
      r.status, r.shop_name, r.department_name, r.requester_name, r.approver_name, r.customer_name, r.reference,
      r.before_amount.toFixed(2), r.after_amount.toFixed(2), r.discount_amount.toFixed(2), r.discount_pct.toFixed(2), r.title,
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discount_report_${range.from || 'all'}_${range.to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeChips: { label: string; clear: () => void }[] = [
    ...(shop ? [{ label: `Shop: ${shops.find((s) => s.key === shop)?.name ?? '—'}`, clear: () => setShop('') }] : []),
    ...(dept ? [{ label: `Dept: ${depts.find((d) => d.key === dept)?.name ?? '—'}`, clear: () => setDept('') }] : []),
    ...(employee ? [{ label: `Employee: ${employees.find((e) => e.key === employee)?.name ?? '—'}`, clear: () => setEmployee('') }] : []),
    ...(minPct || maxPct ? [{ label: `Discount ${minPct || '0'}% – ${maxPct || '∞'}%`, clear: () => { setMinPct(''); setMaxPct(''); } }] : []),
    ...(search ? [{ label: `“${search}”`, clear: () => setSearch('') }] : []),
  ];

  return (
    <div className="max-w-7xl mx-auto px-1 sm:px-4 py-4 sm:py-6 space-y-6 pb-28">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-gold-600 bg-gold-50 border border-gold-200 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
            <Percent className="w-3 h-3" /> Discount approvals only
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display mt-2">Discount Report</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            How much discount was given, in which shop, by whom — across all shops.
          </p>
        </div>
        <button
          type="button"
          id="discount-export"
          onClick={exportCsv}
          disabled={!filtered.length}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-200 disabled:opacity-40 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" /> Export CSV ({filtered.length})
        </button>
      </div>

      {/* Filters */}
      <section className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
          <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              id={`discount-preset-${p}`}
              onClick={() => choosePreset(p)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                preset === p ? 'bg-brand-600 text-white border-brand-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div>
            <label htmlFor="discount-from" className="text-[11px] font-bold text-slate-500 block mb-1">From</label>
            <input id="discount-from" type="date" value={range.from} max={range.to || undefined}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="discount-to" className="text-[11px] font-bold text-slate-500 block mb-1">To</label>
            <input id="discount-to" type="date" value={range.to} min={range.from || undefined}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="discount-status" className="text-[11px] font-bold text-slate-500 block mb-1">Status</label>
            <select id="discount-status" value={group} onChange={(e) => setGroup(e.target.value as StatusGroup)} className={inputCls}>
              {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="discount-shop" className="text-[11px] font-bold text-slate-500 block mb-1">Shop</label>
            <select id="discount-shop" value={shop} onChange={(e) => setShop(e.target.value)} className={inputCls}>
              <option value="">All shops</option>
              {shops.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="discount-dept" className="text-[11px] font-bold text-slate-500 block mb-1">Department</label>
            <select id="discount-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={inputCls}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="discount-employee" className="text-[11px] font-bold text-slate-500 block mb-1">Employee</label>
            <select id="discount-employee" value={employee} onChange={(e) => setEmployee(e.target.value)} className={inputCls}>
              <option value="">All employees</option>
              {employees.map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-2 lg:col-span-3">
            <label htmlFor="discount-search" className="text-[11px] font-bold text-slate-500 block mb-1">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input id="discount-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Request no, customer, bill ref, employee, shop…" className={`${inputCls} pl-8`} />
            </div>
          </div>
          <div>
            <label htmlFor="discount-min-pct" className="text-[11px] font-bold text-slate-500 block mb-1">Min %</label>
            <input id="discount-min-pct" type="number" min="0" max="100" step="0.5" inputMode="decimal" value={minPct}
              onChange={(e) => setMinPct(e.target.value)} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label htmlFor="discount-max-pct" className="text-[11px] font-bold text-slate-500 block mb-1">Max %</label>
            <input id="discount-max-pct" type="number" min="0" max="100" step="0.5" inputMode="decimal" value={maxPct}
              onChange={(e) => setMaxPct(e.target.value)} placeholder="100" className={inputCls} />
          </div>
          <div className="flex items-end">
            <button type="button" id="discount-reset" onClick={resetFilters}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeChips.map((c) => (
              <button key={c.label} type="button" onClick={c.clear}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100">
                {c.label} <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
      </section>

      {error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 shrink-0" /> {error}
        </div>
      ) : loading ? (
        <LoadingSpinner label="Building report…" />
      ) : (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="col-span-2 lg:col-span-1 rounded-2xl p-5 text-white bg-linear-to-br from-brand-600 via-brand-700 to-brand-900 shadow-lg shadow-brand-200 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-gold-300/20 blur-2xl" />
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-100 flex items-center gap-1">
                <IndianRupee className="w-3 h-3" /> Total discount given
              </div>
              <div className="text-3xl font-extrabold font-display mt-1">{formatINRWhole(totals.value)}</div>
              <div className="text-[11px] text-brand-100 mt-1">
                on {formatINRWhole(totals.before)} billed · {totals.count} request{totals.count === 1 ? '' : 's'}
              </div>
            </div>
            <Kpi icon={<Percent className="w-3.5 h-3.5" />} label="Average discount" value={`${totals.avg.toFixed(2)}%`}
              hint="total discount ÷ total before-discount" />
            <Kpi icon={<Store className="w-3.5 h-3.5" />} label="Top shop by discount" value={topShop?.name ?? '—'}
              hint={topShop ? `${formatINRWhole(topShop.value)} · ${topShop.count} req · ${avgPct(topShop).toFixed(1)}%` : 'no data'} />
            <Kpi icon={<TrendingUp className="w-3.5 h-3.5" />} label="Highest single discount"
              value={totals.highest ? `${totals.highest.discount_pct.toFixed(2)}%` : '—'}
              hint={totals.highest ? `${formatINR(totals.highest.discount_amount)} · ${totals.highest.shop_name}` : 'no data'}
              to={totals.highest ? `/requests/${totals.highest.id}` : undefined} />
          </section>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
              <BarChart3 className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 mt-3">No discount requests match these filters.</p>
              <p className="text-xs text-slate-500 mt-1">Try a wider date range or set Status to “All submitted”.</p>
            </div>
          ) : (
            <>
              {/* Shop-wise */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
                    <Store className="w-4 h-4 text-brand-600" /> Shop-wise discounts
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    {([['value', 'Value'], ['count', 'Count'], ['avg', 'Avg %'], ['name', 'Name']] as [ShopSort, string][]).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setShopSort(k)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          shopSort === k ? 'bg-brand-50 text-brand-700 border-brand-200' : 'text-slate-500 border-transparent hover:bg-slate-50'
                        }`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {byShop.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setShop(shop === s.key ? '' : s.key)}
                      title="Click to filter by this shop"
                      className={`w-full text-left px-4 sm:px-5 py-3 hover:bg-slate-50 transition-colors ${shop === s.key ? 'bg-brand-50/60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-6 h-6 rounded-lg text-[11px] font-extrabold flex items-center justify-center shrink-0 ${
                            i === 0 && shopSort === 'value' ? 'bg-gold-100 text-gold-600' : 'bg-slate-100 text-slate-500'
                          }`}>{i + 1}</span>
                          <span className="font-semibold text-sm text-slate-800 truncate">{s.name}</span>
                        </div>
                        <div className="flex items-center gap-3 sm:gap-6 text-xs shrink-0">
                          <span className="text-slate-500 hidden sm:inline">{s.count} req</span>
                          <span className="font-bold text-brand-700 w-14 text-right">{avgPct(s).toFixed(1)}%</span>
                          <span className="font-extrabold text-slate-900 w-24 text-right">{formatINRWhole(s.value)}</span>
                        </div>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-linear-to-r from-brand-500 to-brand-700 transition-all duration-500"
                          style={{ width: `${(s.value / maxShopValue) * 100}%` }} />
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400 flex gap-3">
                        <span className="sm:hidden">{s.count} req</span>
                        <span>Billed {formatINRWhole(s.before)}</span>
                        <span>Max {s.maxPct.toFixed(1)}%</span>
                        <span>{totals.value ? ((s.value / totals.value) * 100).toFixed(1) : 0}% of all discount</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Monthly trend */}
                <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4 text-brand-600" /> Monthly trend
                  </h2>
                  <div className="flex items-end gap-2 h-44">
                    {byMonth.map((m) => (
                      <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full group min-w-0">
                        <span className="text-[9px] font-bold text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {formatINRWhole(m.value)}
                        </span>
                        <div className="w-full max-w-10 rounded-t-lg bg-linear-to-t from-brand-700 to-brand-400 group-hover:from-gold-500 group-hover:to-gold-300 transition-all duration-500"
                          style={{ height: `${Math.max(4, (m.value / maxMonthValue) * 100)}%` }}
                          title={`${m.name}: ${formatINR(m.value)} · ${m.count} req · ${avgPct(m).toFixed(1)}%`} />
                        <span className="text-[10px] text-slate-500 mt-1.5 truncate">{m.name}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Discount % bands */}
                <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-4">
                    <Percent className="w-4 h-4 text-brand-600" /> Discount % spread
                  </h2>
                  <div className="space-y-3">
                    {bands.map((b) => (
                      <button key={b.label} type="button"
                        onClick={() => { setMinPct(String(b.min)); setMaxPct(b.max === Infinity ? '' : String(b.max)); }}
                        className="w-full text-left group" title="Click to filter this range">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 group-hover:text-brand-700">{b.label}</span>
                          <span className="text-slate-500">{b.count} req · <strong className="text-slate-800">{formatINRWhole(b.value)}</strong></span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${b.min >= 15 ? 'bg-linear-to-r from-amber-400 to-rose-500' : 'bg-linear-to-r from-brand-400 to-brand-600'}`}
                            style={{ width: `${(b.count / maxBandCount) * 100}%` }} />
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {/* Employees */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
                <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-gold-500" /> Top employees by discount value
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {byEmployee.map((e, i) => (
                    <button key={e.key} type="button" onClick={() => setEmployee(employee === e.key ? '' : e.key)}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors ${
                        employee === e.key ? 'border-brand-300 bg-brand-50' : 'border-slate-100 hover:bg-slate-50'
                      }`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{e.name}</div>
                          <div className="text-[11px] text-slate-500">{e.count} req · avg {avgPct(e).toFixed(1)}%</div>
                        </div>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900 shrink-0">{formatINRWhole(e.value)}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Detail table */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
                    <Users className="w-4 h-4 text-brand-600" /> Discount requests ({filtered.length})
                  </h2>
                  <select id="discount-row-sort" value={rowSort} onChange={(e) => setRowSort(e.target.value as RowSort)}
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-white">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="value_desc">Discount ₹ high → low</option>
                    <option value="value_asc">Discount ₹ low → high</option>
                    <option value="pct_desc">Discount % high → low</option>
                    <option value="pct_asc">Discount % low → high</option>
                  </select>
                </div>

                {/* desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-bold">Request</th>
                        <th className="text-left px-3 py-2.5 font-bold">Shop</th>
                        <th className="text-left px-3 py-2.5 font-bold">Employee</th>
                        <th className="text-left px-3 py-2.5 font-bold">Customer / Ref</th>
                        <th className="text-right px-3 py-2.5 font-bold">Before</th>
                        <th className="text-right px-3 py-2.5 font-bold">After</th>
                        <th className="text-right px-3 py-2.5 font-bold">Discount</th>
                        <th className="text-right px-3 py-2.5 font-bold">%</th>
                        <th className="text-left px-4 py-2.5 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5">
                            <Link to={`/requests/${r.id}`} className="font-mono font-bold text-brand-700 hover:underline">
                              {r.request_no ?? '—'}
                            </Link>
                            <div className="text-[10px] text-slate-400">{r.submitted_at ? formatISTDate(r.submitted_at, false) : ''}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{r.shop_name}</td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {r.requester_name}
                            {r.department_name && <div className="text-[10px] text-slate-400 flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />{r.department_name}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {r.customer_name || '—'}
                            {r.reference && <div className="text-[10px] text-slate-400 font-mono">{r.reference}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{formatINRWhole(r.before_amount)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{formatINRWhole(r.after_amount)}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-slate-900">{formatINR(r.discount_amount)}</td>
                          <td className={`px-3 py-2.5 text-right font-extrabold ${r.discount_pct >= 15 ? 'text-rose-600' : 'text-brand-700'}`}>
                            {r.discount_pct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5"><StatusBadge status={r.status} requestType="discount" size="sm" /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold text-slate-800">
                      <tr>
                        <td className="px-4 py-2.5" colSpan={4}>Total ({filtered.length})</td>
                        <td className="px-3 py-2.5 text-right">{formatINRWhole(totals.before)}</td>
                        <td className="px-3 py-2.5 text-right">{formatINRWhole(totals.after)}</td>
                        <td className="px-3 py-2.5 text-right">{formatINR(totals.value)}</td>
                        <td className="px-3 py-2.5 text-right text-brand-700">{totals.avg.toFixed(2)}%</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* mobile cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {visibleRows.map((r) => (
                    <Link key={r.id} to={`/requests/${r.id}`} className="block px-4 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-xs text-brand-700">{r.request_no ?? '—'}</span>
                        <StatusBadge status={r.status} requestType="discount" size="sm" />
                      </div>
                      <div className="flex items-end justify-between gap-2 mt-1.5">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{r.shop_name}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {r.requester_name}{r.customer_name ? ` · ${r.customer_name}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-extrabold text-slate-900">{formatINRWhole(r.discount_amount)}</div>
                          <div className={`text-[11px] font-bold ${r.discount_pct >= 15 ? 'text-rose-600' : 'text-brand-700'}`}>
                            {r.discount_pct.toFixed(2)}% of {formatINRWhole(r.before_amount)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                {sortedRows.length > 50 && (
                  <div className="p-3 text-center border-t border-slate-100">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-bold text-brand-700 hover:underline">
                      {showAll ? 'Show first 50' : `Show all ${sortedRows.length}`}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: string; hint: string; to?: string }> = ({ icon, label, value, hint, to }) => {
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1">
        <span className="text-brand-600">{icon}</span> {label}
      </div>
      <div className="text-xl sm:text-2xl font-extrabold font-display text-slate-900 mt-1 truncate">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 truncate">{hint}</div>
    </>
  );
  const cls = 'rounded-2xl p-4 sm:p-5 bg-white border border-slate-200/90 shadow-xs min-w-0 block';
  return to ? <Link to={to} className={`${cls} hover:border-brand-300 transition-colors`}>{body}</Link> : <div className={cls}>{body}</div>;
};
