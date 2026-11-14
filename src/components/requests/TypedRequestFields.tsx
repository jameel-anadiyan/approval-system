// Form fields for the Discount and Exhibition request types, shared by the
// New Request page and the Edit Draft modal. Values are kept as strings while
// typing and converted to RequestDetails with toDiscountDetails / toExhibitionDetails.
import React from 'react';
import { RequestDetails, ExhibitionProvide, ExhibitionDaySchedule, RequestShopChoice, RequestShopOption } from '../../types/database';
import { formatINR, PROVIDE_LABELS } from '../../lib/formatters';
import { Percent, CalendarDays, Megaphone, Target, IndianRupee, CheckCircle2, AlertTriangle, FileCheck, Store, Building2, ShieldCheck, Clock, Copy, Sparkles } from 'lucide-react';
import { GstSelector } from './GstSelector';
import type { ExhibitionQuotaStatus } from '../../lib/exhibitionQuota';

const inputCls =
  'w-full text-base sm:text-sm p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors bg-white';
const labelCls = 'block text-xs font-bold text-slate-700 mb-1';

const num = (s: string | undefined | null) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** GST rate applied when the organiser provides a GST invoice. */
export const GST_RATE = 18;

/** "2026-11-12T10:00" → "12 Nov 2026, 10:00 AM" */
const fmtDateTime = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};
const fmtTime = (s: string) => {
  const d = new Date(s);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
};

/** Human-readable event window, e.g. "12 Nov 2026, 10:00 am – 8:00 pm". */
export function formatEventWindow(start: string, end: string): string {
  if (!start) return '';
  if (!end) return fmtDateTime(start);
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay ? `${fmtDateTime(start)} – ${fmtTime(end)}` : `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
}

// ───────────────────────── Discount ─────────────────────────

export interface DiscountForm {
  before: string;
  after: string;
  customer: string;
  reference: string;
  invoice_no: string;
  bill_date: string;
}

export const emptyDiscount: DiscountForm = { before: '', after: '', customer: '', reference: '', invoice_no: '', bill_date: '' };

export const discountFromDetails = (d?: RequestDetails | null): DiscountForm => ({
  before: str(d?.before_amount),
  after: str(d?.after_amount),
  customer: str(d?.customer_name),
  reference: str(d?.reference),
  invoice_no: str(d?.invoice_no),
  bill_date: str(d?.bill_date),
});

export function discountCalc(f: DiscountForm) {
  const before = num(f.before);
  const after = num(f.after);
  const value = Math.max(0, before - after);
  const pct = before > 0 ? (value / before) * 100 : 0;
  return { before, after, value, pct };
}

export function validateDiscount(f: DiscountForm): string | null {
  const { before, after } = discountCalc(f);
  if (before <= 0) return 'Enter the amount before discount.';
  if (f.after.trim() === '' || after < 0) return 'Enter the amount after discount.';
  if (after >= before) return 'After-discount amount must be less than the amount before discount.';
  return null;
}

export const toDiscountDetails = (f: DiscountForm): RequestDetails => ({
  before_amount: num(f.before),
  after_amount: num(f.after),
  customer_name: f.customer.trim() || null,
  reference: f.reference.trim() || null,
  invoice_no: f.invoice_no.trim() || null,
  bill_date: f.bill_date.trim() || null,
});

export const DiscountFields: React.FC<{ value: DiscountForm; onChange: (v: DiscountForm) => void }> = ({ value, onChange }) => {
  const set = (k: keyof DiscountForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const c = discountCalc(value);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>
            Amount before discount (₹) <span className="text-rose-500">*</span>
          </label>
          <input id="discount-before" type="number" step="0.01" min="0" inputMode="decimal" value={value.before}
            onChange={set('before')} placeholder="0.00" className={`${inputCls} font-semibold`} />
        </div>
        <div>
          <label className={labelCls}>
            Amount after discount (₹) <span className="text-rose-500">*</span>
          </label>
          <input id="discount-after" type="number" step="0.01" min="0" inputMode="decimal" value={value.after}
            onChange={set('after')} placeholder="0.00" className={`${inputCls} font-semibold`} />
        </div>
        <div>
          <label className={labelCls}>Invoice Number</label>
          <input id="discount-invoice" type="text" value={value.invoice_no} onChange={set('invoice_no')}
            placeholder="e.g. INV-2026-0042" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Date of Bill</label>
          <input id="discount-bill-date" type="date" value={value.bill_date} onChange={set('bill_date')}
            className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Customer name</label>
          <input id="discount-customer" type="text" value={value.customer} onChange={set('customer')}
            placeholder="Optional" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Bill / Estimate / Ref No</label>
          <input id="discount-reference" type="text" value={value.reference} onChange={set('reference')}
            placeholder="Optional" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-4 shadow-md shadow-indigo-200">
          <div className="text-[10px] uppercase tracking-widest font-bold text-indigo-100 flex items-center gap-1">
            <Percent className="w-3 h-3" /> Discount
          </div>
          <div className="text-2xl font-extrabold font-display mt-1">{c.pct.toFixed(2)}%</div>
          <div className="text-[11px] text-indigo-100 mt-0.5">calculated automatically</div>
        </div>
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-amber-700 flex items-center gap-1">
            <IndianRupee className="w-3 h-3" /> Discount value
          </div>
          <div className="text-xl font-extrabold font-display text-amber-900 mt-1">{formatINR(c.value)}</div>
          <div className="text-[11px] text-amber-700 mt-0.5">this is the amount approved</div>
        </div>
      </div>
    </div>
  );
};

// ───────────────────────── Exhibition ─────────────────────────

export interface ExhibitionForm {
  conducting_shop_id: string;
  conducting_shop_name: string;
  event_name: string;
  organiser_contact: string;
  venue: string;
  event_dates: string;
  event_start: string;
  event_end: string;
  daily_schedules: ExhibitionDaySchedule[];
  total_days: number;
  total_hours: number;
  expected_footfall: string;
  stall_size_location: string;
  amount_excl_gst: string;
  payment_mode_due: string;
  organiser_gstin: string;
  /** null until the requester answers Yes / No */
  gst_invoice: boolean | null;
  gst_rate: string;
  gst_amount?: string;
  provides: ExhibitionProvide[];
  provides_other: string;
  voucher_1000_qty: string;
  voucher_500_qty: string;
  voucher_1000_min: string;
  voucher_500_min: string;
  voucher_validity: string;
  lucky_draw: string;
  winners_draw: string;
  other_costs: string;
  total_budget: string;
  purpose: string;
  is_waitlist?: boolean;
}

export function calculateScheduleHours(fromTime?: string, toTime?: string): number {
  if (!fromTime || !toTime) return 0;
  const [fH, fM] = fromTime.split(':').map((v) => parseInt(v, 10));
  const [tH, tM] = toTime.split(':').map((v) => parseInt(v, 10));
  if (isNaN(fH) || isNaN(fM) || isNaN(tH) || isNaN(tM)) return 0;
  let diffMin = tH * 60 + tM - (fH * 60 + fM);
  if (diffMin < 0) {
    diffMin += 24 * 60; // support timings extending past midnight
  }
  const hrs = Math.round((diffMin / 60) * 100) / 100;
  return Math.max(0, hrs);
}

export function generateDailySchedules(
  startDateStr?: string | null,
  endDateStr?: string | null,
  existingSchedules?: ExhibitionDaySchedule[]
): ExhibitionDaySchedule[] {
  if (!startDateStr) return [];
  const startDay = startDateStr.slice(0, 10);
  const endDay = (endDateStr || startDateStr).slice(0, 10);
  if (endDay < startDay) return [];

  const existingMap = new Map<string, ExhibitionDaySchedule>();
  if (Array.isArray(existingSchedules)) {
    for (const s of existingSchedules) {
      if (s && s.date) existingMap.set(s.date, s);
    }
  }

  const defaultFrom = existingSchedules?.[0]?.from_time || '09:00';
  const defaultTo = existingSchedules?.[0]?.to_time || '18:00';

  const result: ExhibitionDaySchedule[] = [];
  const cur = new Date(`${startDay}T00:00:00`);
  const end = new Date(`${endDay}T00:00:00`);
  let dayNum = 1;

  while (cur <= end && dayNum <= 60) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;
    const dayName = cur.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

    const existing = existingMap.get(dateKey);
    const from_time = existing?.from_time || defaultFrom;
    const to_time = existing?.to_time || defaultTo;
    const hours = calculateScheduleHours(from_time, to_time);

    result.push({
      date: dateKey,
      day_number: dayNum,
      day_name: dayName,
      from_time,
      to_time,
      hours,
    });

    cur.setDate(cur.getDate() + 1);
    dayNum += 1;
  }

  return result;
}

export const emptyExhibition: ExhibitionForm = {
  conducting_shop_id: '', conducting_shop_name: '',
  event_name: '', organiser_contact: '', venue: '', event_dates: '', event_start: '', event_end: '',
  daily_schedules: [], total_days: 0, total_hours: 0,
  expected_footfall: '', stall_size_location: '',
  amount_excl_gst: '', payment_mode_due: '', organiser_gstin: '',
  gst_invoice: true,
  gst_rate: '18',
  gst_amount: '',
  provides: [], provides_other: '', voucher_1000_qty: '', voucher_500_qty: '', voucher_1000_min: '', voucher_500_min: '',
  voucher_validity: '', lucky_draw: '', winners_draw: '', other_costs: '', total_budget: '', purpose: '',
  is_waitlist: false,
};

export const exhibitionFromDetails = (d?: RequestDetails | null): ExhibitionForm => {
  const rawStart = str(d?.event_start);
  const rawEnd = str(d?.event_end);
  const rawSchedules = Array.isArray(d?.daily_schedules) ? (d?.daily_schedules as ExhibitionDaySchedule[]) : [];
  const daily = rawSchedules.length > 0
    ? rawSchedules
    : generateDailySchedules(rawStart, rawEnd);
  const totalDays = Number(d?.total_days) || daily.length;
  const totalHours = Number(d?.total_hours) || daily.reduce((s, row) => s + (Number(row.hours) || 0), 0);

  return {
    ...emptyExhibition,
    conducting_shop_id: str(d?.conducting_shop_id),
    conducting_shop_name: str(d?.conducting_shop_name),
    event_name: str(d?.event_name), organiser_contact: str(d?.organiser_contact), venue: str(d?.venue),
    event_dates: str(d?.event_dates),
    event_start: rawStart,
    event_end: rawEnd,
    daily_schedules: daily,
    total_days: totalDays,
    total_hours: totalHours,
    expected_footfall: str(d?.expected_footfall),
    stall_size_location: str(d?.stall_size_location), amount_excl_gst: str(d?.amount_excl_gst),
    payment_mode_due: str(d?.payment_mode_due), organiser_gstin: str(d?.organiser_gstin),
    gst_invoice: d?.gst_invoice === undefined || d?.gst_invoice === null ? true : !!d.gst_invoice,
    gst_rate: d?.gst_pct !== undefined && d?.gst_pct !== null ? String(d.gst_pct) : '18',
    gst_amount: d?.gst_amount !== undefined && d?.gst_amount !== null
      ? String(d.gst_amount)
      : (d?.amount_excl_gst && d?.gst_pct ? String(Math.round(Number(d.amount_excl_gst) * (Number(d.gst_pct) / 100) * 100) / 100) : ''),
    provides: (d?.provides ?? []) as ExhibitionProvide[],
    provides_other: str(d?.provides_other), voucher_1000_qty: str(d?.voucher_1000_qty || ''),
    voucher_500_qty: str(d?.voucher_500_qty || ''), voucher_1000_min: str(d?.voucher_1000_min),
    voucher_500_min: str(d?.voucher_500_min), voucher_validity: str(d?.voucher_validity),
    lucky_draw: str(d?.lucky_draw), winners_draw: str(d?.winners_draw), other_costs: str(d?.other_costs || ''),
    total_budget: str(d?.total_budget), purpose: str(d?.purpose),
    is_waitlist: !!d?.is_waitlist,
  };
};

export function exhibitionCalc(f: ExhibitionForm) {
  const excl = num(f.amount_excl_gst);
  let gst = 0;
  if (f.gst_invoice) {
    if (f.gst_amount !== undefined && f.gst_amount !== '') {
      gst = num(f.gst_amount);
    } else {
      const rate = num(f.gst_rate) || 18;
      gst = Math.round(excl * (rate / 100) * 100) / 100;
    }
  }
  const unroundedTotal = excl + gst;
  const total = Math.round(unroundedTotal);
  const roundOff = Math.round((total - unroundedTotal) * 100) / 100;
  const pct = (excl > 0 && gst > 0)
    ? Math.round((gst / excl) * 10000) / 100
    : (f.gst_invoice ? (num(f.gst_rate) || 18) : 0);
  const suggestedBudget = total + num(f.voucher_1000_qty) * 1000 + num(f.voucher_500_qty) * 500 + num(f.other_costs);
  const budget = f.total_budget.trim() ? num(f.total_budget) : suggestedBudget;
  return { excl, pct, gst, total, roundOff, suggestedBudget, budget };
}

export function validateExhibition(
  f: ExhibitionForm,
  opts: { requireShop?: boolean } = {}
): string | null {
  if (opts.requireShop !== false && !f.conducting_shop_id.trim()) {
    return 'Select the shop conducting this exhibition / event.';
  }
  if (!f.event_name.trim()) return 'Event name is required.';
  if (!f.venue.trim()) return 'Venue is required.';
  if (!f.event_start) return 'Pick the event start date & time.';
  if (!f.event_end) return 'Pick the event end date & time.';
  if (f.event_end < f.event_start) return 'Event end must be after the start.';
  if (f.daily_schedules.length > 0) {
    for (let i = 0; i < f.daily_schedules.length; i++) {
      const row = f.daily_schedules[i];
      if (!row.from_time || !row.to_time) {
        return `Please set the From Time and To Time for Day ${row.day_number || i + 1} (${row.date}).`;
      }
      if (row.hours <= 0) {
        return `Day ${row.day_number || i + 1} (${row.date}) has zero duration. Check the from and to times.`;
      }
    }
  }
  if (num(f.amount_excl_gst) <= 0) return 'Sponsorship amount (excl. GST) must be more than zero.';
  if (f.gst_invoice === null) return 'Select whether a GST invoice is provided (Yes / No).';
  if (!f.purpose.trim()) return 'Purpose / expected result is required.';
  return null;
}

export const toExhibitionDetails = (f: ExhibitionForm): RequestDetails => {
  const c = exhibitionCalc(f);
  const opt = (s: string) => (s.trim() ? num(s) : null);
  const shopId = f.conducting_shop_id.trim() || null;
  const shopName = f.conducting_shop_name.trim() || null;
  const totalDays = f.daily_schedules.length > 0 ? f.daily_schedules.length : (f.total_days || 1);
  const totalHours = f.daily_schedules.reduce((s, row) => s + (Number(row.hours) || 0), 0) || f.total_hours;

  return {
    conducting_shop_id: shopId,
    conducting_shop_name: shopName,
    shop_id: shopId,
    shop_name: shopName,
    event_name: f.event_name.trim(), organiser_contact: f.organiser_contact.trim() || null, venue: f.venue.trim(),
    event_dates: f.event_start ? formatEventWindow(f.event_start, f.event_end) : f.event_dates.trim(),
    event_start: f.event_start || null, event_end: f.event_end || null,
    daily_schedules: f.daily_schedules,
    total_days: totalDays,
    total_hours: totalHours,
    expected_footfall: f.expected_footfall.trim() || null,
    stall_size_location: f.stall_size_location.trim() || null,
    amount_excl_gst: c.excl,
    gst_pct: c.pct,
    gst_amount: c.gst,
    round_off: c.roundOff,
    total_incl_gst: c.total,
    payment_mode_due: f.payment_mode_due.trim() || null,
    organiser_gstin: f.organiser_gstin.trim() || null,
    gst_invoice: !!f.gst_invoice, provides: f.provides, provides_other: f.provides_other.trim() || null,
    voucher_1000_qty: opt(f.voucher_1000_qty), voucher_500_qty: opt(f.voucher_500_qty),
    voucher_1000_min: opt(f.voucher_1000_min), voucher_500_min: opt(f.voucher_500_min),
    voucher_validity: f.voucher_validity.trim() || null, lucky_draw: f.lucky_draw.trim() || null,
    winners_draw: f.winners_draw.trim() || null, other_costs: opt(f.other_costs),
    total_budget: c.budget, purpose: f.purpose.trim(),
    is_waitlist: !!f.is_waitlist,
  };
};

const Section: React.FC<{ n: string; title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ n, title, icon, children }) => (
  <section className="rounded-2xl border border-slate-200/90 overflow-hidden">
    <div className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 border-l-4 border-amber-400">
      <span className="text-[11px] font-bold text-amber-300">{n}</span>
      {icon}
      <h3 className="text-[11px] font-bold uppercase tracking-widest">{title}</h3>
    </div>
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white">{children}</div>
  </section>
);

export const ExhibitionFields: React.FC<{
  value: ExhibitionForm;
  onChange: (v: ExhibitionForm) => void;
  quotaStatus?: ExhibitionQuotaStatus | null;
  shopOptions?: RequestShopOption[];
  shopsLoading?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, quotaStatus, shopOptions = [], shopsLoading = false, disabled = false }) => {
  const set = (k: keyof ExhibitionForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const c = exhibitionCalc(value);
  const toggle = (p: ExhibitionProvide) =>
    onChange({ ...value, provides: value.provides.includes(p) ? value.provides.filter((x) => x !== p) : [...value.provides, p] });
  const knownShop = shopOptions.some((s) => s.id === value.conducting_shop_id);

  // GstSelector fires several callbacks in one click (e.g. "No GST" → hasGst, amount, rate).
  // Merge them into the latest form state instead of the stale `value` from this render,
  // otherwise the last callback silently undoes the earlier ones (gst_invoice never turned off).
  const gstLatest = React.useRef(value);
  gstLatest.current = value;
  const applyGst = (patch: Partial<ExhibitionForm>) => {
    const next = { ...gstLatest.current, ...patch };
    gstLatest.current = next;
    onChange(next);
  };

  const field = (k: keyof ExhibitionForm, label: string, opts: { required?: boolean; type?: string; placeholder?: string; full?: boolean } = {}) => (
    <div className={opts.full ? 'sm:col-span-2' : ''}>
      <label className={labelCls}>
        {label} {opts.required && <span className="text-rose-500">*</span>}
      </label>
      <input
        id={`exh-${k}`}
        type={opts.type ?? 'text'}
        step={opts.type === 'number' ? '0.01' : undefined}
        min={opts.type === 'number' ? '0' : undefined}
        inputMode={opts.type === 'number' ? 'decimal' : undefined}
        value={value[k] as string}
        onChange={set(k)}
        placeholder={opts.placeholder}
        disabled={disabled}
        className={inputCls}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Section n="1" title="Event details" icon={<CalendarDays className="w-3.5 h-3.5 text-amber-300" />}>
        <div className="sm:col-span-2">
          <label htmlFor="exh-conducting_shop" className={`${labelCls} flex items-center gap-1.5`}>
            <Store className="w-3.5 h-3.5 text-indigo-600" />
            <span>Shop Conducting Exhibition / Event <span className="text-rose-500">*</span></span>
          </label>
          <select
            id="exh-conducting_shop"
            value={value.conducting_shop_id}
            disabled={disabled || shopsLoading}
            onChange={(e) => {
              const id = e.target.value;
              const found = shopOptions.find((s) => s.id === id);
              onChange({
                ...value,
                conducting_shop_id: id,
                conducting_shop_name: found ? found.name : '',
              });
            }}
            className={`${inputCls} font-semibold`}
          >
            <option value="">
              {shopsLoading
                ? 'Loading your shop list…'
                : shopOptions.length === 0
                ? 'No shops assigned to your account'
                : '-- Select Shop Conducting Exhibition / Event --'}
            </option>
            {!knownShop && value.conducting_shop_id && value.conducting_shop_name && (
              <option value={value.conducting_shop_id}>{value.conducting_shop_name}</option>
            )}
            {shopOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.code ? ` (${s.code})` : ''}
              </option>
            ))}
          </select>
        </div>
        {field('event_name', 'Event Name', { required: true })}
        {field('organiser_contact', 'Organiser & Contact')}
        {field('venue', 'Venue', { required: true })}
        <div className="sm:col-span-2 flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-700">Event Window & Schedule</span>
          <a
            href="/calendar/exhibitions"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200 transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Check Exhibition Calendar (Booked Dates) ↗</span>
          </a>
        </div>
        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="exh-event_start" className={labelCls}>
              Event starts <span className="text-rose-500">*</span>
            </label>
            <input
              id="exh-event_start"
              type="datetime-local"
              value={value.event_start}
              onChange={(e) => {
                const start = e.target.value;
                const end = !value.event_end || value.event_end < start ? start : value.event_end;
                const schedules = generateDailySchedules(start, end, value.daily_schedules);
                const totalDays = schedules.length;
                const totalHours = schedules.reduce((s, row) => s + (Number(row.hours) || 0), 0);
                onChange({
                  ...value,
                  event_start: start,
                  event_end: end,
                  daily_schedules: schedules,
                  total_days: totalDays,
                  total_hours: totalHours,
                });
              }}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="exh-event_end" className={labelCls}>
              Event ends <span className="text-rose-500">*</span>
            </label>
            <input
              id="exh-event_end"
              type="datetime-local"
              value={value.event_end}
              min={value.event_start || undefined}
              onChange={(e) => {
                const end = e.target.value;
                const schedules = generateDailySchedules(value.event_start, end, value.daily_schedules);
                const totalDays = schedules.length;
                const totalHours = schedules.reduce((s, row) => s + (Number(row.hours) || 0), 0);
                onChange({
                  ...value,
                  event_end: end,
                  daily_schedules: schedules,
                  total_days: totalDays,
                  total_hours: totalHours,
                });
              }}
              className={inputCls}
            />
          </div>
          {value.event_start ? (
            <span className="sm:col-span-2 text-[11px] text-indigo-700 font-semibold flex items-center gap-1">
              <CalendarDays className="w-3 h-3" /> {formatEventWindow(value.event_start, value.event_end)}
            </span>
          ) : value.event_dates ? (
            <span className="sm:col-span-2 text-[11px] text-amber-700">
              Previously entered: “{value.event_dates}”. Please pick the dates above.
            </span>
          ) : null}

          {/* Daily Schedule & Timings (Dynamic calculation for each day) */}
          {value.daily_schedules && value.daily_schedules.length > 0 && (
            <div className="sm:col-span-2 rounded-2xl border border-indigo-200/90 bg-indigo-50/40 p-3.5 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-950 uppercase tracking-wide">
                    Daily Schedule & Hours ({value.daily_schedules.length} Day{value.daily_schedules.length === 1 ? '' : 's'})
                  </span>
                </div>
                {value.daily_schedules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const day1 = value.daily_schedules[0];
                      if (!day1) return;
                      const updated = value.daily_schedules.map((row) => ({
                        ...row,
                        from_time: day1.from_time,
                        to_time: day1.to_time,
                        hours: calculateScheduleHours(day1.from_time, day1.to_time),
                      }));
                      const totalHours = updated.reduce((s, row) => s + (Number(row.hours) || 0), 0);
                      onChange({
                        ...value,
                        daily_schedules: updated,
                        total_hours: totalHours,
                      });
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-white hover:bg-indigo-100/80 border border-indigo-300 rounded-lg px-2.5 py-1 transition-colors cursor-pointer"
                    title="Copy Day 1 timings to all other days"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Apply Day 1 Timing to All Days</span>
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {value.daily_schedules.map((day, idx) => (
                  <div
                    key={day.date || idx}
                    className="bg-white rounded-xl border border-slate-200/90 p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="min-w-0 sm:w-1/3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-extrabold flex items-center justify-center shrink-0">
                          {day.day_number || idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {day.day_name || day.date}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 block ml-6.5">
                        {day.date}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 flex-1 flex-wrap sm:flex-nowrap">
                      <div className="flex-1 min-w-[110px]">
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">From Time</label>
                        <input
                          type="time"
                          value={day.from_time}
                          onChange={(e) => {
                            const newFrom = e.target.value;
                            const updated = value.daily_schedules.map((row, i) => {
                              if (i !== idx) return row;
                              const hrs = calculateScheduleHours(newFrom, row.to_time);
                              return { ...row, from_time: newFrom, hours: hrs };
                            });
                            const totalHours = updated.reduce((s, row) => s + (Number(row.hours) || 0), 0);
                            onChange({
                              ...value,
                              daily_schedules: updated,
                              total_hours: totalHours,
                            });
                          }}
                          disabled={disabled}
                          className="w-full text-xs font-semibold px-2 py-1.5 rounded-lg border border-slate-200 focus:border-indigo-500 outline-hidden bg-slate-50"
                        />
                      </div>
                      <div className="flex-1 min-w-[110px]">
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">To Time</label>
                        <input
                          type="time"
                          value={day.to_time}
                          onChange={(e) => {
                            const newTo = e.target.value;
                            const updated = value.daily_schedules.map((row, i) => {
                              if (i !== idx) return row;
                              const hrs = calculateScheduleHours(row.from_time, newTo);
                              return { ...row, to_time: newTo, hours: hrs };
                            });
                            const totalHours = updated.reduce((s, row) => s + (Number(row.hours) || 0), 0);
                            onChange({
                              ...value,
                              daily_schedules: updated,
                              total_hours: totalHours,
                            });
                          }}
                          disabled={disabled}
                          className="w-full text-xs font-semibold px-2 py-1.5 rounded-lg border border-slate-200 focus:border-indigo-500 outline-hidden bg-slate-50"
                        />
                      </div>
                      <div className="sm:w-28 shrink-0 text-right sm:text-center pt-2 sm:pt-0">
                        <span className="inline-block px-2.5 py-1 rounded-md bg-indigo-100 text-indigo-900 font-extrabold text-[11px]">
                          {day.hours.toFixed(1)} hrs
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-indigo-950 text-white text-xs font-bold shadow-xs">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Total Event Duration:</span>
                </span>
                <span className="text-amber-300 font-extrabold text-sm font-display">
                  {value.total_days} Day(s) · {value.total_hours.toFixed(1)} Hours Total
                </span>
              </div>
            </div>
          )}

          {quotaStatus && quotaStatus.eventDate && (
            <div className="sm:col-span-2">
              {quotaStatus.mustUseWaitlist ? (
                <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl flex items-start gap-3 text-xs text-rose-950 shadow-xs">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-rose-900 tracking-wide uppercase text-[10px] bg-rose-200/80 px-2 py-0.5 rounded-full border border-rose-300">
                        Special Waiting List Required
                      </span>
                      {quotaStatus.regionName && (
                        <span className="text-[11px] font-semibold text-rose-700">
                          Region: {quotaStatus.regionName}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-rose-900 leading-relaxed">
                      {quotaStatus.message}
                    </p>
                    <div className="p-2 bg-white/70 border border-rose-200 rounded-lg text-[11px] text-rose-800">
                      <strong>Note:</strong> Special Waiting List exhibitions have a lower chance of approval and require prior review & approval by the Department Head in their dedicated Waitlist tab.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-950">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-emerald-900">Standard Slot Available: </span>
                    <span className="text-emerald-800">{quotaStatus.message}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {field('expected_footfall', 'Expected Footfall')}
        {field('stall_size_location', 'Stall Size & Location')}
      </Section>

      <Section n="2" title="Sponsorship amount" icon={<IndianRupee className="w-3.5 h-3.5 text-amber-300" />}>
        {field('amount_excl_gst', 'Amount (excl. GST) ₹', { required: true, type: 'number' })}
        
        <div className="sm:col-span-2">
          <GstSelector
            hasGst={Boolean(value.gst_invoice)}
            onHasGstChange={(has) => {
              const cur = gstLatest.current;
              const curExcl = num(cur.amount_excl_gst);
              const defaultAmt = has
                ? (cur.gst_amount && cur.gst_amount !== '0'
                    ? cur.gst_amount
                    : (curExcl > 0 ? String(Math.round(curExcl * 0.18 * 100) / 100) : ''))
                : '0';
              applyGst({ gst_invoice: has, gst_amount: defaultAmt, ...(has ? {} : { gst_rate: '0' }) });
            }}
            gstAmount={c.gst}
            onGstAmountChange={(amt) => applyGst({ gst_amount: String(amt) })}
            baseAmount={c.excl}
            totalAmount={c.total}
            roundOff={c.roundOff}
            baseLabel="Sponsorship (Excl. GST)"
            totalLabel="Total Sponsorship (Incl. GST)"
            gstRate={c.pct}
            onGstRateChange={(r) => {
              const curExcl = num(gstLatest.current.amount_excl_gst);
              const calcAmt = Math.round(curExcl * (r / 100) * 100) / 100;
              applyGst({ gst_rate: String(r), gst_amount: String(calcAmt) });
            }}
          />
        </div>

        {field('payment_mode_due', 'Payment Mode & Due Date')}
        {field('organiser_gstin', 'Organiser GSTIN')}
      </Section>

      <section className="rounded-2xl border border-slate-200/90 overflow-hidden">
        <div className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 border-l-4 border-amber-400">
          <span className="text-[11px] font-bold text-amber-300">3</span>
          <h3 className="text-[11px] font-bold uppercase tracking-widest">Event team will provide</h3>
        </div>
        <div className="p-4 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(PROVIDE_LABELS) as ExhibitionProvide[]).map((p) => (
              <label
                key={p}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
                  value.provides.includes(p) ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  id={`exh-provide-${p}`}
                  checked={value.provides.includes(p)}
                  onChange={() => toggle(p)}
                  className="w-4 h-4 accent-indigo-600"
                />
                {PROVIDE_LABELS[p]}
              </label>
            ))}
          </div>
          {value.provides.includes('other') && (
            <input id="exh-provides_other" type="text" value={value.provides_other} onChange={set('provides_other')}
              placeholder="Other — please specify" className={`${inputCls} mt-3`} />
          )}
        </div>
      </section>

      <Section n="4" title="Our promotion plan" icon={<Megaphone className="w-3.5 h-3.5 text-amber-300" />}>
        {field('voucher_1000_qty', '₹1,000 Vouchers (Qty)', { type: 'number' })}
        {field('voucher_500_qty', '₹500 Vouchers (Qty)', { type: 'number' })}
        {field('voucher_1000_min', '₹1,000 Voucher Min. Purchase ₹', { type: 'number' })}
        {field('voucher_500_min', '₹500 Voucher Min. Purchase ₹', { type: 'number' })}
        {field('voucher_validity', 'Voucher Validity')}
        {field('lucky_draw', 'Lucky Draw Prize & Value')}
        {field('winners_draw', 'No. of Winners & Draw Date')}
        {field('other_costs', 'Other Costs ₹ (printing, branding, staff)', { type: 'number' })}
        <div className="sm:col-span-2">
          <label className={labelCls}>Total Budget ₹</label>
          <input id="exh-total_budget" type="number" step="0.01" min="0" inputMode="decimal" value={value.total_budget}
            onChange={set('total_budget')} placeholder={c.suggestedBudget ? c.suggestedBudget.toFixed(2) : '0.00'}
            className={`${inputCls} font-semibold`} />
          <span className="text-[11px] text-slate-500 mt-1 block">
            Leave empty to use {formatINR(c.suggestedBudget)} (sponsorship + vouchers + other costs).
          </span>
        </div>
      </Section>

      <section className="rounded-2xl border border-slate-200/90 overflow-hidden">
        <div className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 border-l-4 border-amber-400">
          <span className="text-[11px] font-bold text-amber-300">5</span>
          <Target className="w-3.5 h-3.5 text-amber-300" />
          <h3 className="text-[11px] font-bold uppercase tracking-widest">Purpose / expected result <span className="text-rose-300">*</span></h3>
        </div>
        <div className="p-4 bg-white">
          <textarea id="exh-purpose" rows={3} value={value.purpose} onChange={set('purpose')}
            placeholder="Why should we sponsor this event? Expected walk-ins, sales, brand reach…" className={inputCls} />
        </div>
      </section>
    </div>
  );
};

// ───────────────────────── Non-Cash ─────────────────────────

export interface NonCashForm {
  associated_value: string;
  associated_notes: string;
}

export const emptyNonCash: NonCashForm = { associated_value: '', associated_notes: '' };

export const nonCashFromDetails = (d?: RequestDetails | null): NonCashForm => ({
  associated_value:
    d?.associated_value !== undefined && d?.associated_value !== null
      ? String(d.associated_value)
      : '',
  associated_notes: str(d?.associated_notes ?? ''),
});

export const toNonCashDetails = (f: NonCashForm, shopChoice?: RequestShopChoice): RequestDetails => {
  const v = num(f.associated_value);
  return {
    ...(shopChoice || {}),
    associated_value: v > 0 ? v : null,
    associated_notes: f.associated_notes.trim() || null,
  };
};

export const NonCashFields: React.FC<{
  value: NonCashForm;
  onChange: (v: NonCashForm) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const set = (k: keyof NonCashForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });

  const valNum = num(value.associated_value);

  return (
    <div className="space-y-4">
      {/* Informative banner */}
      <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 leading-relaxed flex items-start gap-2.5">
        <FileCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-emerald-950 block mb-0.5">Non-Cash Operational Request</span>
          <p className="text-emerald-800">
            This request is for operational, administrative, or internal approvals where no direct cash payout or disbursement is required.
          </p>
        </div>
      </div>

      {/* Optional value / adjustment box */}
      <div className="p-4 bg-slate-50/80 border border-slate-200/90 rounded-2xl space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold text-slate-800">
            Associated Cash / Value / Adjustment (Not Paid Directly)
          </label>
          <span className="text-[11px] text-slate-500 font-medium bg-slate-200/60 px-2 py-0.5 rounded-md">
            Optional
          </span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          If this non-cash request involves any nominal value, offset, vendor adjustment, or internal consideration that is not paid directly, mention it here for review by Head, Clerk, and Admin.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className={labelCls}>
              Associated Value / Amount (₹) <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-3.5 font-bold text-slate-400 text-sm">₹</span>
              <input
                id="non-cash-value"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={value.associated_value}
                onChange={set('associated_value')}
                placeholder="0.00"
                disabled={disabled}
                className={`${inputCls} pl-8 font-semibold`}
              />
            </div>
            {valNum > 0 && (
              <span className="text-[11px] font-medium text-emerald-700 mt-1 block">
                Nominal value: {formatINR(valNum)} (Informational only · Not disbursed)
              </span>
            )}
          </div>

          <div>
            <label className={labelCls}>
              Adjustment Details / Nature <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="non-cash-notes"
              type="text"
              value={value.associated_notes}
              onChange={set('associated_notes')}
              placeholder="e.g. Adjusted against advance, barter, or write-off"
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ───────────────────────── Agreement ─────────────────────────

export const toAgreementDetails = (
  description: string,
  shopChoice?: RequestShopChoice
): RequestDetails => ({
  ...(shopChoice || {}),
  description: description.trim() || null,
});

export const AgreementBanner: React.FC = () => (
  <div className="p-3.5 bg-violet-50 border border-violet-200/80 rounded-xl text-xs text-violet-950 leading-relaxed flex items-start gap-2.5">
    <FileCheck className="w-4 h-4 text-violet-700 shrink-0 mt-0.5" />
    <div>
      <span className="font-bold text-violet-950 block mb-0.5">
        Agreement Request · Non-Cash · Department Head Approval Only
      </span>
      <p className="text-violet-800">
        No cash payout or disbursement is needed. Supports Excel, Word, CSV, PDF, PNG, JPG, and any image file. Approved directly by the Department Head (Admin approval is not required).
      </p>
    </div>
  </div>
);

// ───────────────────────── Statutory Payment ─────────────────────────

export interface StatutoryPaymentForm {
  payment_amount: string;
  payment_date: string;
  due_date: string;
}

export const emptyStatutoryPayment: StatutoryPaymentForm = {
  payment_amount: '',
  payment_date: '',
  due_date: '',
};

export const statutoryPaymentFromDetails = (
  d?: RequestDetails | null,
  fallbackAmount?: number | null
): StatutoryPaymentForm => ({
  payment_amount:
    d?.payment_amount !== undefined && d?.payment_amount !== null
      ? String(d.payment_amount)
      : fallbackAmount && fallbackAmount > 0
      ? String(fallbackAmount)
      : '',
  payment_date: str(d?.payment_date),
  due_date: str(d?.due_date),
});

export function validateStatutoryPayment(f: StatutoryPaymentForm): string | null {
  if (num(f.payment_amount) <= 0) return 'Enter a valid payment amount greater than zero.';
  if (!f.payment_date.trim()) return 'Select the Payment Date.';
  if (!f.due_date.trim()) return 'Select the Due Date.';
  return null;
}

export const toStatutoryPaymentDetails = (
  f: StatutoryPaymentForm,
  description: string,
  shopChoice?: RequestShopChoice
): RequestDetails => ({
  ...(shopChoice || {}),
  payment_amount: num(f.payment_amount),
  payment_date: f.payment_date.trim() || null,
  due_date: f.due_date.trim() || null,
  description: description.trim() || null,
});

export const StatutoryPaymentFields: React.FC<{
  value: StatutoryPaymentForm;
  onChange: (v: StatutoryPaymentForm) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const set = (k: keyof StatutoryPaymentForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const amt = num(value.payment_amount);

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-orange-50 border border-orange-200/80 rounded-xl text-xs text-orange-950 leading-relaxed flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-orange-950 block mb-0.5">
            Statutory Payment · Department Head Approval Only
          </span>
          <p className="text-orange-800">
            Approved directly by the Department Head (Admin approval is not required), then forwarded for payment disbursement.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="stat-payment-amount" className={labelCls}>
            Payment Amount (₹) <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-3 font-bold text-slate-400 text-sm">₹</span>
            <input
              id="stat-payment-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={value.payment_amount}
              onChange={set('payment_amount')}
              placeholder="0.00"
              disabled={disabled}
              className={`${inputCls} pl-8 font-bold`}
            />
          </div>
          {amt > 0 && (
            <span className="text-[11px] font-semibold text-orange-700 mt-1 block">
              {formatINR(amt)}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="stat-payment-date" className={labelCls}>
            Payment Date <span className="text-rose-500">*</span>
          </label>
          <input
            id="stat-payment-date"
            type="date"
            value={value.payment_date}
            onChange={set('payment_date')}
            disabled={disabled}
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="stat-due-date" className={labelCls}>
            Due Date <span className="text-rose-500">*</span>
          </label>
          <input
            id="stat-due-date"
            type="date"
            value={value.due_date}
            onChange={set('due_date')}
            disabled={disabled}
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
};

// ───────────────────────── Audit Report ─────────────────────────

export interface AuditReportForm {
  audit_from_date: string;
  audit_to_date: string;
  audit_firm: string;
}

export const emptyAuditReport: AuditReportForm = {
  audit_from_date: '',
  audit_to_date: '',
  audit_firm: '',
};

export const auditReportFromDetails = (d?: RequestDetails | null): AuditReportForm => ({
  audit_from_date: str(d?.audit_from_date),
  audit_to_date: str(d?.audit_to_date),
  audit_firm: str(d?.audit_firm),
});

export function validateAuditReport(f: AuditReportForm): string | null {
  if (!f.audit_firm.trim()) return 'Enter the firm name (Audit Report of Which Firm).';
  if (!f.audit_from_date.trim()) return 'Select the Audit Period From date.';
  if (!f.audit_to_date.trim()) return 'Select the Audit Period To date.';
  if (f.audit_to_date < f.audit_from_date) {
    return 'Audit Period To date cannot be earlier than From date.';
  }
  return null;
}

export const toAuditReportDetails = (
  f: AuditReportForm,
  description: string,
  shopChoice?: RequestShopChoice
): RequestDetails => ({
  ...(shopChoice || {}),
  audit_from_date: f.audit_from_date.trim() || null,
  audit_to_date: f.audit_to_date.trim() || null,
  audit_firm: f.audit_firm.trim() || null,
  description: description.trim() || null,
});

export const AuditReportFields: React.FC<{
  value: AuditReportForm;
  onChange: (v: AuditReportForm) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const set = (k: keyof AuditReportForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-cyan-50 border border-cyan-200/80 rounded-xl text-xs text-cyan-950 leading-relaxed flex items-start gap-2.5">
        <Building2 className="w-4 h-4 text-cyan-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-cyan-950 block mb-0.5">
            Audit Report · Non-Cash · Administrator Approval Only
          </span>
          <p className="text-cyan-800">
            Supports Excel, Word, CSV, PDF, PNG, JPG, and any image file. Non-cash request (no disbursement). Final approval is performed exclusively by the Administrator.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="audit-firm" className={labelCls}>
            Audit Report of Which Firm <span className="text-rose-500">*</span>
          </label>
          <input
            id="audit-firm"
            type="text"
            value={value.audit_firm}
            onChange={set('audit_firm')}
            placeholder="Enter the firm / entity name for this audit report"
            disabled={disabled}
            className={`${inputCls} font-semibold`}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="audit-from-date" className={labelCls}>
              Audit Period — From Date <span className="text-rose-500">*</span>
            </label>
            <input
              id="audit-from-date"
              type="date"
              value={value.audit_from_date}
              onChange={(e) => {
                const from = e.target.value;
                const to =
                  value.audit_to_date && value.audit_to_date < from ? from : value.audit_to_date;
                onChange({ ...value, audit_from_date: from, audit_to_date: to });
              }}
              disabled={disabled}
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="audit-to-date" className={labelCls}>
              Audit Period — To Date <span className="text-rose-500">*</span>
            </label>
            <input
              id="audit-to-date"
              type="date"
              value={value.audit_to_date}
              min={value.audit_from_date || undefined}
              onChange={set('audit_to_date')}
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
