import React from 'react';
import type { RequestRecord } from '../../types/database';
import { formatINR, PROVIDE_LABELS, typeOf } from '../../lib/formatters';
import { Percent, CalendarDays, Package, ArrowLeftRight, ArrowRight } from 'lucide-react';

const Row: React.FC<{ label: string; value?: React.ReactNode; wide?: boolean }> = ({ label, value, wide }) =>
  value === undefined || value === null || value === '' ? null : (
    <div className={wide ? 'col-span-2' : ''}>
      <span className="text-slate-400 font-medium block">{label}</span>
      <span className="font-semibold text-slate-800 mt-0.5 block whitespace-pre-wrap break-words">{value}</span>
    </div>
  );

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="pt-4 first:pt-0">
    <h4 className="text-[11px] font-bold uppercase tracking-wider text-gold-600 mb-2">{title}</h4>
    <div className="grid grid-cols-2 gap-3 text-xs">{children}</div>
  </div>
);

const money = (n?: number | null) => (n === undefined || n === null ? undefined : formatINR(Number(n)));

/** Read-only view of the type-specific form (Discount / Exhibition). Renders nothing for General. */
export const RequestDetailsPanel: React.FC<{ request: RequestRecord }> = ({ request }) => {
  const t = typeOf(request);
  const d = request.details || {};
  if (t === 'general') {
    if (!d.has_gst && !d.base_amount) return null;
    return (
      <div className="bg-white rounded-2xl border border-indigo-100 p-5 sm:p-6 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 font-display mb-3 flex items-center gap-2">
          <span>Amount & GST Breakdown</span>
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Base (Excl. GST)</span>
            <span className="text-xs sm:text-sm font-bold text-slate-800 break-words">{money(d.base_amount) ?? money(request.amount)}</span>
          </div>
          <div className="rounded-xl bg-indigo-50/50 border border-indigo-200/60 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-indigo-700 font-semibold block">GST ({d.has_gst ? `${d.gst_rate || 18}%` : '0%'})</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-800 break-words">{d.has_gst ? (money(d.gst_amount) ?? '—') : '₹0.00'}</span>
          </div>
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-indigo-800 font-semibold block">Total Payable</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-900 break-words">{money(request.amount)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (t === 'discount') {
    return (
      <div className="bg-white rounded-2xl border border-amber-200 p-5 sm:p-6 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 font-display mb-4 flex items-center gap-2">
          <Percent className="w-4 h-4 text-amber-600" /> Discount details
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center mb-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Before</span>
            <span className="text-xs sm:text-sm font-bold text-slate-800 break-words">{money(d.before_amount) ?? '—'}</span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">After</span>
            <span className="text-xs sm:text-sm font-bold text-slate-800 break-words">{money(d.after_amount) ?? '—'}</span>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold block">Discount</span>
            <span className="text-sm font-bold text-amber-800">
              {d.discount_pct !== undefined && d.discount_pct !== null ? `${Number(d.discount_pct).toFixed(2)}%` : '—'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Row label="Discount value" value={money(d.discount_amount ?? request.amount)} />
          <Row label="Customer" value={d.customer_name} />
          <Row label="Bill / reference" value={d.reference} wide />
        </div>
      </div>
    );
  }

  if (t === 'asset' || t === 'asset_below_20k') {
    return (
      <div className="bg-white rounded-2xl border border-teal-200 p-5 sm:p-6 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 font-display mb-4 flex items-center gap-2">
          <Package className="w-4 h-4 text-teal-600" /> Asset purchase
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Row label="Asset" value={d.asset_name} />
          <Row label="Quantity" value={d.quantity} />
          <Row label="Specification" value={d.specification} wide />
          <Row label="Purpose" value={d.purpose} wide />
        </div>
      </div>
    );
  }

  if (t === 'stock_transfer') {
    const isBulk = d.transfer_mode === 'bulk';
    const pieces = d.total_pieces ?? (d.items?.length || d.pieces_count || 0);
    const grossWeight = d.total_gross_weight ?? 0;
    const totalMrp = d.total_mrp ?? request.amount;

    return (
      <div className="bg-white rounded-2xl border border-blue-200 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900 font-display">
              Stock Transfer Details
            </h3>
          </div>
          <span className="text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 self-start sm:self-auto">
            {isBulk ? 'Bulk Transfer (4+ Items)' : 'Itemized Transfer'}
          </span>
        </div>

        {/* Origin to Destination Route */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">From Shop</span>
            <span className="text-xs sm:text-sm font-bold text-slate-800 truncate block">
              {d.from_shop_name || request.shop_name || '—'}
            </span>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <ArrowRight className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1 text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">To Shop</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-900 truncate block">
              {d.to_shop_name || '—'}
            </span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Total Pieces</span>
            <span className="text-xs sm:text-base font-bold text-slate-800 break-words mt-0.5 block">
              {pieces} {pieces === 1 ? 'pc' : 'pcs'}
            </span>
          </div>
          <div className="rounded-xl bg-blue-50/50 border border-blue-200/60 p-2.5 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-blue-700 font-semibold block">Total Gross Wt</span>
            <span className="text-xs sm:text-base font-bold text-blue-900 break-words mt-0.5 block">
              {grossWeight} g
            </span>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold block">Total MRP</span>
            <span className="text-xs sm:text-base font-bold text-emerald-900 break-words mt-0.5 block">
              {formatINR(totalMrp)}
            </span>
          </div>
        </div>

        {/* If Bulk: show category and details */}
        {isBulk ? (
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Product Category</span>
              <span className="font-bold text-slate-800">{d.category_name || 'Mixed / General'}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200/60 pt-2">
              <span className="text-slate-500 font-medium">Pieces Count</span>
              <span className="font-bold text-slate-800">{pieces}</span>
            </div>
          </div>
        ) : (
          /* Itemized table */
          d.items && d.items.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 block">
                Products List ({d.items.length})
              </span>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Barcode</th>
                      <th className="py-2 px-3">SKU</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Gross Wt (g)</th>
                      <th className="py-2 px-3 text-right">MRP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-medium text-slate-700">
                    {d.items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{it.barcode || '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{it.sku || '—'}</td>
                        <td className="py-2 px-3">{it.category_name || '—'}</td>
                        <td className="py-2 px-3 text-right font-mono">{it.gross_weight}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{formatINR(it.mrp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  const provides = (d.provides || []).map((p) => (p === 'other' && d.provides_other ? `Other: ${d.provides_other}` : PROVIDE_LABELS[p] || p));
  return (
    <div className="bg-white rounded-2xl border border-brand-200 p-5 sm:p-6 shadow-xs divide-y divide-slate-100">
      <h3 className="text-sm font-bold text-slate-900 font-display pb-3 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-brand-600" /> Exhibition / event sponsorship
      </h3>
      <Section title="Event details">
        <Row label="Event name" value={d.event_name} wide />
        <Row label="Organiser contact" value={d.organiser_contact} wide />
        <Row label="Venue" value={d.venue} />
        <Row label="Event date(s)" value={d.event_dates} />
        <Row label="Expected footfall" value={d.expected_footfall} />
        <Row label="Stall size / location" value={d.stall_size_location} />
      </Section>
      <Section title="Sponsorship amount">
        <Row label="Amount (excl. GST)" value={money(d.amount_excl_gst)} />
        <Row label={`GST${d.gst_pct !== undefined ? ` @ ${d.gst_pct}%` : ''}`} value={money(d.gst_amount)} />
        <Row label="Total (incl. GST)" value={money(d.total_incl_gst ?? request.amount)} />
        <Row label="Payment mode & due date" value={d.payment_mode_due} />
        <Row label="Organiser GSTIN" value={d.organiser_gstin} />
        <Row label="GST invoice" value={d.gst_invoice === undefined ? undefined : d.gst_invoice ? 'Yes' : 'No'} />
      </Section>
      {provides.length > 0 && (
        <Section title="Organiser provides">
          <div className="col-span-2 flex flex-wrap gap-1.5">
            {provides.map((p) => (
              <span key={p} className="px-2 py-0.5 rounded-md bg-brand-50 text-brand-800 border border-brand-200 font-semibold">
                {p}
              </span>
            ))}
          </div>
        </Section>
      )}
      <Section title="Vouchers & lucky draw">
        <Row label="₹1,000 vouchers" value={d.voucher_1000_qty ? `${d.voucher_1000_qty} pcs${d.voucher_1000_min ? ` · min bill ${formatINR(d.voucher_1000_min)}` : ''}` : undefined} />
        <Row label="₹500 vouchers" value={d.voucher_500_qty ? `${d.voucher_500_qty} pcs${d.voucher_500_min ? ` · min bill ${formatINR(d.voucher_500_min)}` : ''}` : undefined} />
        <Row label="Voucher validity" value={d.voucher_validity} />
        <Row label="Lucky draw" value={d.lucky_draw} />
        <Row label="Winners draw" value={d.winners_draw} />
      </Section>
      <Section title="Budget">
        <Row label="Other costs" value={money(d.other_costs)} />
        <Row label="Total budget" value={money(d.total_budget)} />
        <Row label="Purpose / expected benefit" value={d.purpose} wide />
      </Section>
    </div>
  );
};
