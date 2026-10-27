import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Truck, Store, IndianRupee, Download, RotateCcw, Search, CalendarRange, BarChart3, ShieldAlert, X,
  Boxes, Scale, PackageCheck, Clock, ArrowRight, ArrowUpDown, ChevronDown, ChevronUp, Building2,
} from 'lucide-react';
import { useStockTransferReport, type StockTransferRow } from '../../lib/stockTransferReport';
import { formatINR, formatINRWhole, formatISTDate } from '../../lib/formatters';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import type { RequestStatus } from '../../types/database';

// ───────────────────────── helpers ─────────────────────────

type StatusGroup = 'completed' | 'pending_transfer' | 'approved' | 'in_approval' | 'rejected' | 'all';
const IN_APPROVAL: RequestStatus[] = [
  'pending_regional_review', 'submitted', 'returned', 'pending_head_approval', 'pending_head_review', 'pending_admin_approval', 'approving',
];
const REJECTED: RequestStatus[] = ['rejected', 'withdrawn', 'cancelled'];
const GROUP_LABELS: Record<StatusGroup, string> = {
  approved: 'Approved (all)',
  completed: 'Transfer completed',
  pending_transfer: 'Approved · not completed',
  in_approval: 'In approval',
  rejected: 'Rejected / Withdrawn / Cancelled',
  all: 'All submitted',
};
const matchGroup = (r: StockTransferRow, g: StatusGroup) => {
  switch (g) {
    case 'approved': return r.status === 'approved';
    case 'completed': return r.status === 'approved' && !!r.transfer_completed_at;
    case 'pending_transfer': return r.status === 'approved' && !r.transfer_completed_at;
    case 'in_approval': return IN_APPROVAL.includes(r.status);
    case 'rejected': return REJECTED.includes(r.status);
    default: return true;
  }
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

interface Group {
  key: string;
  name: string;
  count: number;
  pieces: number;
  weight: number;
  mrp: number;
  completed: number;
}
const groupBy = (rows: StockTransferRow[], key: (r: StockTransferRow) => string, name: (r: StockTransferRow) => string): Group[] => {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, name: name(r), count: 0, pieces: 0, weight: 0, mrp: 0, completed: 0 };
    g.count += 1;
    g.pieces += r.pieces;
    g.weight += r.gross_weight;
    g.mrp += r.total_mrp;
    if (r.transfer_completed_at) g.completed += 1;
    m.set(k, g);
  }
  return [...m.values()];
};

const fmtWeight = (g: number) => `${g.toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;

const inputCls =
  'w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-hidden bg-white';

// ───────────────────────── page ─────────────────────────

type ShopView = 'outflow' | 'inflow';
type RowSort = 'newest' | 'oldest' | 'mrp_desc' | 'pieces_desc' | 'completed_desc';

export const StockTransferReportPage: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('this_month');
  const [range, setRange] = useState(presetRange('this_month'));
  const { rows, loading, error } = useStockTransferReport(range.from, range.to);

  const [group, setGroup] = useState<StatusGroup>('approved');
  const [fromShop, setFromShop] = useState('');
  const [toShop, setToShop] = useState('');
  const [employee, setEmployee] = useState('');
  const [mode, setMode] = useState<'' | 'itemized' | 'bulk'>('');
  const [search, setSearch] = useState('');
  const [shopView, setShopView] = useState<ShopView>('outflow');
  const [rowSort, setRowSort] = useState<RowSort>('newest');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p));
  };

  const resetFilters = () => {
    setGroup('approved'); setFromShop(''); setToShop(''); setEmployee(''); setMode(''); setSearch('');
    choosePreset('this_month');
  };

  // option lists come from the date-window rows so they're always relevant
  const fromShops = useMemo(
    () => groupBy(rows, (r) => r.from_shop_id ?? 'none', (r) => r.from_shop_name).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const toShops = useMemo(
    () => groupBy(rows, (r) => r.to_shop_id ?? 'none', (r) => r.to_shop_name).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );
  const employees = useMemo(
    () => groupBy(rows, (r) => r.requester_id, (r) => r.requester_name).sort((a, b) => a.name.localeCompare(b.name)),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchGroup(r, group)) return false;
      if (fromShop && (r.from_shop_id ?? 'none') !== fromShop) return false;
      if (toShop && (r.to_shop_id ?? 'none') !== toShop) return false;
      if (employee && r.requester_id !== employee) return false;
      if (mode && r.transfer_mode !== mode) return false;
      if (q) {
        const skus = Array.isArray(r.details?.items) ? r.details!.items!.map((i) => `${i.barcode} ${i.sku}`).join(' ') : '';
        const hay = [r.request_no, r.approval_no, r.title, r.requester_name, r.from_shop_name, r.to_shop_name, skus]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, group, fromShop, toShop, employee, mode, search]);

  // ── aggregates ──
  const totals = useMemo(() => {
    const approved = filtered.filter((r) => r.status === 'approved');
    const completed = approved.filter((r) => r.transfer_completed_at);
    return {
      count: filtered.length,
      pieces: filtered.reduce((s, r) => s + r.pieces, 0),
      weight: filtered.reduce((s, r) => s + r.gross_weight, 0),
      mrp: filtered.reduce((s, r) => s + r.total_mrp, 0),
      approved: approved.length,
      completed: completed.length,
      pending: approved.length - completed.length,
      pendingMrp: approved.filter((r) => !r.transfer_completed_at).reduce((s, r) => s + r.total_mrp, 0),
    };
  }, [filtered]);
  const completionPct = totals.approved ? Math.round((totals.completed / totals.approved) * 100) : 0;

  const byShop = useMemo(() => {
    const g =
      shopView === 'outflow'
        ? groupBy(filtered, (r) => r.from_shop_id ?? 'none', (r) => r.from_shop_name)
        : groupBy(filtered, (r) => r.to_shop_id ?? 'none', (r) => r.to_shop_name);
    return g.sort((a, b) => b.mrp - a.mrp);
  }, [filtered, shopView]);
  const maxShopMrp = Math.max(1, ...byShop.map((s) => s.mrp));

  const byRoute = useMemo(
    () =>
      groupBy(
        filtered,
        (r) => `${r.from_shop_id ?? 'none'}>${r.to_shop_id ?? 'none'}`,
        (r) => `${r.from_shop_name} → ${r.to_shop_name}`
      )
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
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
  const maxMonthCount = Math.max(1, ...byMonth.map((m) => m.count));

  const sortedRows = useMemo(() => {
    const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
    const cmp: Record<RowSort, (a: StockTransferRow, b: StockTransferRow) => number> = {
      newest: (a, b) => t(b.submitted_at) - t(a.submitted_at),
      oldest: (a, b) => t(a.submitted_at) - t(b.submitted_at),
      mrp_desc: (a, b) => b.total_mrp - a.total_mrp,
      pieces_desc: (a, b) => b.pieces - a.pieces,
      completed_desc: (a, b) => t(b.transfer_completed_at) - t(a.transfer_completed_at),
    };
    return [...filtered].sort(cmp[rowSort]);
  }, [filtered, rowSort]);
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 50);

  const exportCsv = () => {
    const head = ['Request No', 'Approval No', 'Submitted', 'Approved', 'Status', 'Transfer Status', 'Completed On', 'Completed By',
      'Completion Remarks', 'From Shop', 'To Shop', 'Mode', 'Pieces', 'Gross Weight (g)', 'Total MRP (INR)', 'Employee', 'Department', 'Approver'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = sortedRows.map((r) => [
      r.request_no, r.approval_no,
      r.submitted_at ? formatISTDate(r.submitted_at, false) : '', r.decided_at ? formatISTDate(r.decided_at, false) : '',
      r.status, r.status === 'approved' ? (r.transfer_completed_at ? 'Completed' : 'Not completed') : '',
      r.transfer_completed_at ? formatISTDate(r.transfer_completed_at) : '', r.transfer_completed_by_name, r.transfer_completed_remarks,
      r.from_shop_name, r.to_shop_name, r.transfer_mode, r.pieces, r.gross_weight, r.total_mrp.toFixed(2),
      r.requester_name, r.department_name, r.approver_name,
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_transfer_report_${range.from || 'all'}_${range.to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeChips: { label: string; clear: () => void }[] = [
    ...(fromShop ? [{ label: `From: ${fromShops.find((s) => s.key === fromShop)?.name ?? '—'}`, clear: () => setFromShop('') }] : []),
    ...(toShop ? [{ label: `To: ${toShops.find((s) => s.key === toShop)?.name ?? '—'}`, clear: () => setToShop('') }] : []),
    ...(employee ? [{ label: `Employee: ${employees.find((e) => e.key === employee)?.name ?? '—'}`, clear: () => setEmployee('') }] : []),
    ...(mode ? [{ label: mode === 'bulk' ? 'Bulk only' : 'Itemized only', clear: () => setMode('') }] : []),
    ...(search ? [{ label: `“${search}”`, clear: () => setSearch('') }] : []),
  ];

  const transferChip = (r: StockTransferRow) =>
    r.status !== 'approved' ? null : r.transfer_completed_at ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
        <PackageCheck className="w-3 h-3" /> Completed
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
        <Clock className="w-3 h-3" /> Not completed
      </span>
    );

  return (
    <div className="max-w-7xl mx-auto px-1 sm:px-4 py-4 sm:py-6 space-y-6 pb-28">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
            <Truck className="w-3 h-3" /> Stock transfers only
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display mt-2">Stock Transfer Report</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Which shop sent what to whom, how much, and whether the transfer has been completed.
          </p>
        </div>
        <button
          type="button"
          id="stock-transfer-export"
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
              id={`stock-preset-${p}`}
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
            <label htmlFor="stock-from" className="text-[11px] font-bold text-slate-500 block mb-1">From date</label>
            <input id="stock-from" type="date" value={range.from} max={range.to || undefined}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="stock-to" className="text-[11px] font-bold text-slate-500 block mb-1">To date</label>
            <input id="stock-to" type="date" value={range.to} min={range.from || undefined}
              onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} className={inputCls} />
          </div>
          <div>
            <label htmlFor="stock-status" className="text-[11px] font-bold text-slate-500 block mb-1">Status</label>
            <select id="stock-status" value={group} onChange={(e) => setGroup(e.target.value as StatusGroup)} className={inputCls}>
              {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stock-from-shop" className="text-[11px] font-bold text-slate-500 block mb-1">From shop</label>
            <select id="stock-from-shop" value={fromShop} onChange={(e) => setFromShop(e.target.value)} className={inputCls}>
              <option value="">All shops</option>
              {fromShops.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stock-to-shop" className="text-[11px] font-bold text-slate-500 block mb-1">To shop</label>
            <select id="stock-to-shop" value={toShop} onChange={(e) => setToShop(e.target.value)} className={inputCls}>
              <option value="">All shops</option>
              {toShops.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stock-employee" className="text-[11px] font-bold text-slate-500 block mb-1">Employee</label>
            <select id="stock-employee" value={employee} onChange={(e) => setEmployee(e.target.value)} className={inputCls}>
              <option value="">All employees</option>
              {employees.map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-2 lg:col-span-3">
            <label htmlFor="stock-search" className="text-[11px] font-bold text-slate-500 block mb-1">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input id="stock-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Request no, shop, employee, barcode, SKU…" className={`${inputCls} pl-8`} />
            </div>
          </div>
          <div className="col-span-1 lg:col-span-2">
            <label htmlFor="stock-mode" className="text-[11px] font-bold text-slate-500 block mb-1">Transfer mode</label>
            <select id="stock-mode" value={mode} onChange={(e) => setMode(e.target.value as '' | 'itemized' | 'bulk')} className={inputCls}>
              <option value="">Itemized & Bulk</option>
              <option value="itemized">Itemized</option>
              <option value="bulk">Bulk</option>
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" id="stock-reset" onClick={resetFilters}
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
            <div className="col-span-2 lg:col-span-1 rounded-2xl p-5 text-white bg-linear-to-br from-blue-600 via-indigo-700 to-slate-900 shadow-lg shadow-indigo-200 relative overflow-hidden">
              <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-cyan-300/20 blur-2xl" />
              <div className="text-[10px] uppercase tracking-widest font-bold text-blue-100 flex items-center gap-1">
                <IndianRupee className="w-3 h-3" /> Stock value moved (MRP)
              </div>
              <div className="text-3xl font-extrabold font-display mt-1">{formatINRWhole(totals.mrp)}</div>
              <div className="text-[11px] text-blue-100 mt-1">
                {totals.count} transfer{totals.count === 1 ? '' : 's'} · {totals.pieces} pcs · {fmtWeight(totals.weight)}
              </div>
            </div>
            <div className="rounded-2xl p-4 sm:p-5 bg-white border border-slate-200/90 shadow-xs min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1">
                <PackageCheck className="w-3.5 h-3.5 text-emerald-600" /> Completion
              </div>
              <div className="text-xl sm:text-2xl font-extrabold font-display text-slate-900 mt-1">{completionPct}%</div>
              <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-linear-to-r from-emerald-400 to-emerald-600 transition-all duration-700" style={{ width: `${completionPct}%` }} />
              </div>
              <div className="text-[11px] text-slate-500 mt-1 truncate">{totals.completed} of {totals.approved} approved completed</div>
            </div>
            <Kpi icon={<Clock className="w-3.5 h-3.5" />} label="Awaiting transfer" value={String(totals.pending)}
              hint={totals.pending ? `${formatINRWhole(totals.pendingMrp)} MRP in transit` : 'nothing pending'} tone="amber" />
            <Kpi icon={<Boxes className="w-3.5 h-3.5" />} label="Pieces · Gross weight" value={String(totals.pieces)}
              hint={fmtWeight(totals.weight)} />
          </section>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
              <BarChart3 className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 mt-3">No stock transfers match these filters.</p>
              <p className="text-xs text-slate-500 mt-1">Try a wider date range or set Status to “All submitted”.</p>
            </div>
          ) : (
            <>
              {/* Shop-wise */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
                    <Store className="w-4 h-4 text-brand-600" /> Shop-wise {shopView === 'outflow' ? 'stock sent' : 'stock received'}
                  </h2>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100">
                    {([['outflow', 'Sent (from)'], ['inflow', 'Received (to)']] as [ShopView, string][]).map(([k, l]) => (
                      <button key={k} type="button" id={`stock-shop-view-${k}`} onClick={() => setShopView(k)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                          shopView === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                        }`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {byShop.map((s, i) => {
                    const active = shopView === 'outflow' ? fromShop === s.key : toShop === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() =>
                          shopView === 'outflow' ? setFromShop(active ? '' : s.key) : setToShop(active ? '' : s.key)
                        }
                        title="Click to filter by this shop"
                        className={`w-full text-left px-4 sm:px-5 py-3 hover:bg-slate-50 transition-colors ${active ? 'bg-brand-50/60' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-6 h-6 rounded-lg text-[11px] font-extrabold flex items-center justify-center shrink-0 ${
                              i === 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                            }`}>{i + 1}</span>
                            <span className="font-semibold text-sm text-slate-800 truncate">{s.name}</span>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-6 text-xs shrink-0">
                            <span className="text-slate-500 hidden sm:inline">{s.count} transfer{s.count === 1 ? '' : 's'}</span>
                            <span className="font-bold text-slate-600 w-16 text-right">{s.pieces} pcs</span>
                            <span className="font-extrabold text-slate-900 w-24 text-right">{formatINRWhole(s.mrp)}</span>
                          </div>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 bg-linear-to-r ${
                            shopView === 'outflow' ? 'from-blue-500 to-indigo-700' : 'from-emerald-400 to-teal-600'
                          }`} style={{ width: `${(s.mrp / maxShopMrp) * 100}%` }} />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-400 flex gap-3 flex-wrap">
                          <span className="sm:hidden">{s.count} transfers</span>
                          <span>Gross {fmtWeight(s.weight)}</span>
                          <span>{s.completed} completed</span>
                          <span>{totals.mrp ? ((s.mrp / totals.mrp) * 100).toFixed(1) : 0}% of value</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Monthly trend */}
                <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-4">
                    <BarChart3 className="w-4 h-4 text-brand-600" /> Monthly transfers
                  </h2>
                  <div className="flex items-end gap-2 h-44">
                    {byMonth.map((m) => (
                      <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full group min-w-0">
                        <span className="text-[9px] font-bold text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {m.count} · {formatINRWhole(m.mrp)}
                        </span>
                        <div className="w-full max-w-10 rounded-t-lg overflow-hidden flex flex-col justify-end transition-all duration-500"
                          style={{ height: `${Math.max(4, (m.count / maxMonthCount) * 100)}%` }}
                          title={`${m.name}: ${m.count} transfers · ${m.completed} completed · ${formatINR(m.mrp)}`}>
                          <div className="w-full bg-linear-to-t from-blue-700 to-blue-400 group-hover:from-indigo-600 group-hover:to-indigo-400"
                            style={{ height: `${((m.count - m.completed) / m.count) * 100}%` }} />
                          <div className="w-full bg-linear-to-t from-emerald-600 to-emerald-400"
                            style={{ height: `${(m.completed / m.count) * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1.5 truncate">{m.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Completed</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Other</span>
                  </div>
                </section>

                {/* Top routes */}
                <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2 mb-3">
                    <ArrowUpDown className="w-4 h-4 text-brand-600" /> Busiest routes
                  </h2>
                  <div className="space-y-2">
                    {byRoute.map((r) => {
                      const [fromName, toName] = r.name.split(' → ');
                      return (
                        <div key={r.key} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50">
                          <div className="flex items-center gap-1.5 min-w-0 text-xs">
                            <span className="font-semibold text-slate-800 truncate">{fromName}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="font-semibold text-slate-800 truncate">{toName}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-extrabold text-slate-900">{formatINRWhole(r.mrp)}</div>
                            <div className="text-[10px] text-slate-500">{r.count} × · {r.pieces} pcs</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Detail table */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
                    <Truck className="w-4 h-4 text-brand-600" /> Stock transfers ({filtered.length})
                  </h2>
                  <select id="stock-row-sort" value={rowSort} onChange={(e) => setRowSort(e.target.value as RowSort)}
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-white">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="mrp_desc">MRP high → low</option>
                    <option value="pieces_desc">Pieces high → low</option>
                    <option value="completed_desc">Recently completed</option>
                  </select>
                </div>

                {/* desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-bold">Request</th>
                        <th className="text-left px-3 py-2.5 font-bold">Route</th>
                        <th className="text-left px-3 py-2.5 font-bold">Employee</th>
                        <th className="text-right px-3 py-2.5 font-bold">Pieces</th>
                        <th className="text-right px-3 py-2.5 font-bold">Gross</th>
                        <th className="text-right px-3 py-2.5 font-bold">MRP</th>
                        <th className="text-left px-3 py-2.5 font-bold">Status</th>
                        <th className="text-left px-4 py-2.5 font-bold">Transfer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map((r) => {
                        const items = Array.isArray(r.details?.items) ? r.details!.items! : [];
                        const open = !!expanded[r.id];
                        return (
                          <React.Fragment key={r.id}>
                            <tr className="hover:bg-slate-50/80 align-top">
                              <td className="px-4 py-2.5">
                                <Link to={`/requests/${r.id}`} className="font-mono font-bold text-brand-700 hover:underline">
                                  {r.approval_no || r.request_no || '—'}
                                </Link>
                                <div className="text-[10px] text-slate-400">{r.submitted_at ? formatISTDate(r.submitted_at, false) : ''}</div>
                                <button type="button" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                                  className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-slate-800">
                                  {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  {r.transfer_mode === 'bulk' ? 'Bulk' : `${items.length} item${items.length === 1 ? '' : 's'}`}
                                </button>
                              </td>
                              <td className="px-3 py-2.5 text-slate-700">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold">{r.from_shop_name}</span>
                                  <ArrowRight className="w-3 h-3 text-blue-500 shrink-0" />
                                  <span className="font-semibold">{r.to_shop_name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-slate-700">
                                {r.requester_name}
                                {r.department_name && <div className="text-[10px] text-slate-400 flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />{r.department_name}</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-700">{r.pieces}</td>
                              <td className="px-3 py-2.5 text-right text-slate-700">{fmtWeight(r.gross_weight)}</td>
                              <td className="px-3 py-2.5 text-right font-bold text-slate-900">{formatINR(r.total_mrp)}</td>
                              <td className="px-3 py-2.5"><StatusBadge status={r.status} requestType="stock_transfer" size="sm" /></td>
                              <td className="px-4 py-2.5">
                                {transferChip(r) ?? <span className="text-slate-300">—</span>}
                                {r.transfer_completed_at && (
                                  <div className="text-[10px] text-slate-500 mt-1">
                                    {formatISTDate(r.transfer_completed_at, false)}
                                    {r.transfer_completed_by_name ? ` · ${r.transfer_completed_by_name}` : ''}
                                  </div>
                                )}
                              </td>
                            </tr>
                            {open && (
                              <tr className="bg-slate-50/60">
                                <td colSpan={8} className="px-4 py-3">
                                  <ItemsBlock row={r} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold text-slate-800">
                      <tr>
                        <td className="px-4 py-2.5" colSpan={3}>Total ({filtered.length})</td>
                        <td className="px-3 py-2.5 text-right">{totals.pieces}</td>
                        <td className="px-3 py-2.5 text-right">{fmtWeight(totals.weight)}</td>
                        <td className="px-3 py-2.5 text-right">{formatINR(totals.mrp)}</td>
                        <td colSpan={2} className="px-4 py-2.5 text-emerald-700">{totals.completed} completed · {totals.pending} pending</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* mobile cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {visibleRows.map((r) => (
                    <Link key={r.id} to={`/requests/${r.id}`} className="block px-4 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-xs text-brand-700">{r.approval_no || r.request_no || '—'}</span>
                        {transferChip(r) ?? <StatusBadge status={r.status} requestType="stock_transfer" size="sm" />}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-sm font-semibold text-slate-800 min-w-0">
                        <span className="truncate">{r.from_shop_name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">{r.to_shop_name}</span>
                      </div>
                      <div className="flex items-end justify-between gap-2 mt-1">
                        <div className="text-[11px] text-slate-500 truncate">
                          {r.requester_name} · {r.submitted_at ? formatISTDate(r.submitted_at, false) : ''}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-extrabold text-slate-900">{formatINRWhole(r.total_mrp)}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 justify-end">
                            <Boxes className="w-3 h-3" />{r.pieces} · <Scale className="w-3 h-3" />{fmtWeight(r.gross_weight)}
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

const ItemsBlock: React.FC<{ row: StockTransferRow }> = ({ row }) => {
  const d = row.details || {};
  const items = Array.isArray(d.items) ? d.items : [];
  return (
    <div className="space-y-2">
      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-3 py-1.5 font-bold">#</th>
                <th className="text-left px-3 py-1.5 font-bold">Barcode</th>
                <th className="text-left px-3 py-1.5 font-bold">SKU</th>
                <th className="text-left px-3 py-1.5 font-bold">Category</th>
                <th className="text-right px-3 py-1.5 font-bold">Gross (g)</th>
                <th className="text-right px-3 py-1.5 font-bold">MRP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it, i) => (
                <tr key={`${it.barcode}-${i}`}>
                  <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-700">{it.barcode}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-700">{it.sku}</td>
                  <td className="px-3 py-1.5 text-slate-600">{it.category_name || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-slate-700">{Number(it.gross_weight || 0)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{formatINR(Number(it.mrp || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-slate-600">
          Bulk transfer · {row.pieces} pieces{d.category_name ? ` · ${d.category_name}` : ' · Mixed categories'}
        </div>
      )}
      {row.transfer_completed_remarks && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
          Completion note: “{row.transfer_completed_remarks}”
        </div>
      )}
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: string; hint: string; tone?: 'amber' }> = ({ icon, label, value, hint, tone }) => (
  <div className="rounded-2xl p-4 sm:p-5 bg-white border border-slate-200/90 shadow-xs min-w-0">
    <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1">
      <span className={tone === 'amber' ? 'text-amber-600' : 'text-brand-600'}>{icon}</span> {label}
    </div>
    <div className={`text-xl sm:text-2xl font-extrabold font-display mt-1 truncate ${tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    <div className="text-[11px] text-slate-500 mt-0.5 truncate">{hint}</div>
  </div>
);
