// Form fields for the Discount and Exhibition request types, shared by the
// New Request page and the Edit Draft modal. Values are kept as strings while
// typing and converted to RequestDetails with toDiscountDetails / toExhibitionDetails.
import React from 'react';
import { RequestDetails, ExhibitionProvide } from '../../types/database';
import { formatINR, PROVIDE_LABELS } from '../../lib/formatters';
import { Percent, CalendarDays, Megaphone, Target, IndianRupee } from 'lucide-react';

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
}

export const emptyDiscount: DiscountForm = { before: '', after: '', customer: '', reference: '' };

export const discountFromDetails = (d?: RequestDetails | null): DiscountForm => ({
  before: str(d?.before_amount),
  after: str(d?.after_amount),
  customer: str(d?.customer_name),
  reference: str(d?.reference),
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
  event_name: string;
  organiser_contact: string;
  venue: string;
  event_dates: string;
  event_start: string;
  event_end: string;
  expected_footfall: string;
  stall_size_location: string;
  amount_excl_gst: string;
  payment_mode_due: string;
  organiser_gstin: string;
  /** null until the requester answers Yes / No */
  gst_invoice: boolean | null;
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
}

export const emptyExhibition: ExhibitionForm = {
  event_name: '', organiser_contact: '', venue: '', event_dates: '', event_start: '', event_end: '',
  expected_footfall: '', stall_size_location: '',
  amount_excl_gst: '', payment_mode_due: '', organiser_gstin: '', gst_invoice: null,
  provides: [], provides_other: '', voucher_1000_qty: '', voucher_500_qty: '', voucher_1000_min: '', voucher_500_min: '',
  voucher_validity: '', lucky_draw: '', winners_draw: '', other_costs: '', total_budget: '', purpose: '',
};

export const exhibitionFromDetails = (d?: RequestDetails | null): ExhibitionForm => ({
  ...emptyExhibition,
  event_name: str(d?.event_name), organiser_contact: str(d?.organiser_contact), venue: str(d?.venue),
  event_dates: str(d?.event_dates), event_start: str(d?.event_start), event_end: str(d?.event_end),
  expected_footfall: str(d?.expected_footfall),
  stall_size_location: str(d?.stall_size_location), amount_excl_gst: str(d?.amount_excl_gst),
  payment_mode_due: str(d?.payment_mode_due), organiser_gstin: str(d?.organiser_gstin),
  gst_invoice: d?.gst_invoice === undefined || d?.gst_invoice === null ? null : !!d.gst_invoice,
  provides: (d?.provides ?? []) as ExhibitionProvide[],
  provides_other: str(d?.provides_other), voucher_1000_qty: str(d?.voucher_1000_qty || ''),
  voucher_500_qty: str(d?.voucher_500_qty || ''), voucher_1000_min: str(d?.voucher_1000_min),
  voucher_500_min: str(d?.voucher_500_min), voucher_validity: str(d?.voucher_validity),
  lucky_draw: str(d?.lucky_draw), winners_draw: str(d?.winners_draw), other_costs: str(d?.other_costs || ''),
  total_budget: str(d?.total_budget), purpose: str(d?.purpose),
});

export function exhibitionCalc(f: ExhibitionForm) {
  const excl = num(f.amount_excl_gst);
  const pct = f.gst_invoice ? GST_RATE : 0;
  const gst = Math.round(excl * pct) / 100;
  const total = excl + gst;
  const suggestedBudget = total + num(f.voucher_1000_qty) * 1000 + num(f.voucher_500_qty) * 500 + num(f.other_costs);
  const budget = f.total_budget.trim() ? num(f.total_budget) : suggestedBudget;
  return { excl, pct, gst, total, suggestedBudget, budget };
}

export function validateExhibition(f: ExhibitionForm): string | null {
  if (!f.event_name.trim()) return 'Event name is required.';
  if (!f.venue.trim()) return 'Venue is required.';
  if (!f.event_start) return 'Pick the event start date & time.';
  if (!f.event_end) return 'Pick the event end date & time.';
  if (f.event_end < f.event_start) return 'Event end must be after the start.';
  if (num(f.amount_excl_gst) <= 0) return 'Sponsorship amount (excl. GST) must be more than zero.';
  if (f.gst_invoice === null) return 'Select whether a GST invoice is provided (Yes / No).';
  if (!f.purpose.trim()) return 'Purpose / expected result is required.';
  return null;
}

export const toExhibitionDetails = (f: ExhibitionForm): RequestDetails => {
  const c = exhibitionCalc(f);
  const opt = (s: string) => (s.trim() ? num(s) : null);
  return {
    event_name: f.event_name.trim(), organiser_contact: f.organiser_contact.trim() || null, venue: f.venue.trim(),
    event_dates: f.event_start ? formatEventWindow(f.event_start, f.event_end) : f.event_dates.trim(),
    event_start: f.event_start || null, event_end: f.event_end || null,
    expected_footfall: f.expected_footfall.trim() || null,
    stall_size_location: f.stall_size_location.trim() || null, amount_excl_gst: c.excl, gst_pct: c.pct,
    payment_mode_due: f.payment_mode_due.trim() || null, organiser_gstin: f.organiser_gstin.trim() || null,
    gst_invoice: !!f.gst_invoice, provides: f.provides, provides_other: f.provides_other.trim() || null,
    voucher_1000_qty: opt(f.voucher_1000_qty), voucher_500_qty: opt(f.voucher_500_qty),
    voucher_1000_min: opt(f.voucher_1000_min), voucher_500_min: opt(f.voucher_500_min),
    voucher_validity: f.voucher_validity.trim() || null, lucky_draw: f.lucky_draw.trim() || null,
    winners_draw: f.winners_draw.trim() || null, other_costs: opt(f.other_costs),
    total_budget: c.budget, purpose: f.purpose.trim(),
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

export const ExhibitionFields: React.FC<{ value: ExhibitionForm; onChange: (v: ExhibitionForm) => void }> = ({ value, onChange }) => {
  const set = (k: keyof ExhibitionForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const c = exhibitionCalc(value);
  const toggle = (p: ExhibitionProvide) =>
    onChange({ ...value, provides: value.provides.includes(p) ? value.provides.filter((x) => x !== p) : [...value.provides, p] });

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
        className={inputCls}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Section n="1" title="Event details" icon={<CalendarDays className="w-3.5 h-3.5 text-amber-300" />}>
        {field('event_name', 'Event Name', { required: true })}
        {field('organiser_contact', 'Organiser & Contact')}
        {field('venue', 'Venue', { required: true })}
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
                // keep end valid: default / bump it to the start when empty or earlier
                const end = !value.event_end || value.event_end < start ? start : value.event_end;
                onChange({ ...value, event_start: start, event_end: end });
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
              onChange={set('event_end')}
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
        </div>
        {field('expected_footfall', 'Expected Footfall')}
        {field('stall_size_location', 'Stall Size & Location')}
      </Section>

      <Section n="2" title="Sponsorship amount" icon={<IndianRupee className="w-3.5 h-3.5 text-amber-300" />}>
        {field('amount_excl_gst', 'Amount (excl. GST) ₹', { required: true, type: 'number' })}
        <div>
          <label className={labelCls}>
            GST Invoice Provided <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                id={`exh-gst-invoice-${v ? 'yes' : 'no'}`}
                onClick={() => onChange({ ...value, gst_invoice: v })}
                className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  value.gst_invoice === v
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {v ? `Yes · GST ${GST_RATE}%` : 'No · GST 0%'}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              GST @ {value.gst_invoice === null ? '—' : `${c.pct}%`}
            </span>
            <span className="text-sm font-bold text-slate-800">{formatINR(c.gst)}</span>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Total incl. GST</span>
            <span className="text-lg font-extrabold font-display text-amber-900">{formatINR(c.total)}</span>
          </div>
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
