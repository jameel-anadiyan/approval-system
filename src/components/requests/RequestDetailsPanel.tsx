import React from 'react';
import type { RequestRecord } from '../../types/database';
import {
  formatINR,
  formatINRWhole,
  formatISTDate,
  getExhibitionShopName,
  getPettyCashCategoryLabel,
  getPettyCashLimit,
  PROVIDE_LABELS,
  typeOf,
} from '../../lib/formatters';
import { Percent, CalendarDays, Package, ArrowLeftRight, ArrowRight, FileCheck, Pencil, Store, Wallet, UserCheck, Building2, ShieldCheck, Clock, Sparkles } from 'lucide-react';
import type { ExhibitionDaySchedule } from '../../types/database';
import { generateDailySchedules } from './TypedRequestFields';

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
export const RequestDetailsPanel: React.FC<{
  request: RequestRecord;
  onEditExhibitionShop?: () => void;
  onEditEntryAccount?: () => void;
}> = ({ request, onEditExhibitionShop, onEditEntryAccount }) => {
  const t = typeOf(request);
  const d = request.details || {};
  if (t === 'petty_cash') {
    const category = d.petty_cash_category;
    const catLabel = getPettyCashCategoryLabel(category);
    const catLimit = getPettyCashLimit(category);
    const modeLabel = (request.disbursement_mode || d.disbursement_mode || 'cash') === 'bank' ? 'Bank Transfer' : 'Cash';
    const bottleQty = d.bottle_qty ? Number(d.bottle_qty) : null;
    const perBottlePrice = d.per_bottle_price
      ? Number(d.per_bottle_price)
      : (bottleQty && request.amount ? Math.round((request.amount / bottleQty) * 100) / 100 : null);

    return (
      <div className="bg-white rounded-2xl border border-teal-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-teal-950 font-display flex items-center gap-1.5">
                <span>{catLabel}</span>
              </h3>
              <p className="text-[11px] text-teal-700 font-medium">Petty Cash Request</p>
            </div>
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
            Max {formatINRWhole(catLimit)} · Skips Clerk
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-teal-50/70 border border-teal-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-teal-700 font-bold block">Petty Cash Amount</span>
            <span className="text-sm sm:text-base font-extrabold text-teal-950 font-display mt-0.5 block">
              {money(request.amount)}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">Payment Mode</span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block">{modeLabel}</span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">Petty Cash Dealing Head</span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">
              {request.owner_head_name || '—'}
            </span>
          </div>
        </div>

        {category === 'water_bottle' && bottleQty && (
          <div className="p-3 bg-teal-50/50 border border-teal-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[11px] text-teal-700 font-bold block">Number of Water Bottles</span>
              <span className="text-sm font-extrabold text-teal-950">{bottleQty} Bottles</span>
            </div>
            <div>
              <span className="text-[11px] text-teal-700 font-bold block">Price Per Bottle</span>
              <span className="text-sm font-extrabold text-teal-950">
                ₹{perBottlePrice?.toFixed(2) ?? '—'} / bottle
                {perBottlePrice && perBottlePrice <= 6 && (
                  <span className="text-[11px] font-normal text-teal-600 ml-1.5">(Compliant: ≤ ₹6.00)</span>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="p-3 rounded-xl bg-teal-50/40 border border-teal-200/80 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block">Disbursement Entry Account</span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
              <UserCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="truncate">{request.assigned_entry_user_name || 'Not assigned yet'}</span>
            </span>
          </div>
          {onEditEntryAccount && (
            <button
              type="button"
              id="edit-petty-entry-account-btn"
              onClick={onEditEntryAccount}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-teal-50 text-teal-800 border border-teal-300 text-xs font-bold transition-colors cursor-pointer shrink-0"
            >
              <Pencil className="w-3 h-3" />
              <span>{request.assigned_entry_user_id ? 'Edit Entry Account' : 'Assign Entry Account'}</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-500">
          Stamping is applied on <strong>{catLabel} Form</strong> along with any attached supporting documents.
        </p>
      </div>
    );
  }

  if (t === 'agreement') {
    return (
      <div className="bg-white rounded-2xl border border-violet-200 p-5 sm:p-6 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 pb-3">
          <h3 className="text-sm font-bold text-violet-950 font-display flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-violet-600" />
            <span>Agreement Details</span>
          </h3>
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-800 border border-violet-200">
            Non-Cash · Head Approval Only
          </span>
        </div>
        <div className="p-3 bg-violet-50/60 border border-violet-200/70 rounded-xl text-xs text-violet-900 flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-violet-600 shrink-0" />
          <span>Non-cash agreement request — no disbursement or payout is required. Approved by Department Head only.</span>
        </div>
      </div>
    );
  }

  if (t === 'statutory_payment') {
    const modeLabel =
      (request.disbursement_mode || d.disbursement_mode || '') === 'bank'
        ? 'Bank Transfer'
        : (request.disbursement_mode || d.disbursement_mode || '') === 'cash'
        ? 'Cash'
        : 'Standard';
    return (
      <div className="bg-white rounded-2xl border border-orange-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-3">
          <h3 className="text-sm font-bold text-orange-950 font-display flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-orange-600" />
            <span>Statutory Payment Details</span>
          </h3>
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
            Head Approval Only
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-orange-50/70 border border-orange-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-orange-700 font-bold block">Payment Amount</span>
            <span className="text-sm sm:text-base font-extrabold text-orange-950 font-display mt-0.5 block">
              {money(d.payment_amount ?? request.amount)}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">Payment Date</span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block">
              {d.payment_date ? formatISTDate(d.payment_date, false) : '—'}
            </span>
          </div>
          <div className="rounded-xl bg-rose-50/60 border border-rose-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-rose-700 font-bold block">Due Date</span>
            <span className="text-xs sm:text-sm font-bold text-rose-950 mt-0.5 block">
              {d.due_date ? formatISTDate(d.due_date, false) : '—'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs pt-1">
          <Row label="Payment Mode" value={modeLabel} />
          <Row label="Department Head" value={request.owner_head_name} />
        </div>

        {(request.assigned_entry_user_name || onEditEntryAccount) && (
          <div className="p-3 rounded-xl bg-orange-50/40 border border-orange-200/80 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block">Disbursement Entry Account</span>
              <span className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
                <UserCheck className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                <span className="truncate">{request.assigned_entry_user_name || 'Not assigned yet'}</span>
              </span>
            </div>
            {onEditEntryAccount && (
              <button
                type="button"
                onClick={onEditEntryAccount}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-orange-50 text-orange-800 border border-orange-300 text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                <Pencil className="w-3 h-3" />
                <span>{request.assigned_entry_user_id ? 'Edit Entry Account' : 'Assign Entry Account'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (t === 'audit_report') {
    return (
      <div className="bg-white rounded-2xl border border-cyan-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-100 pb-3">
          <h3 className="text-sm font-bold text-cyan-950 font-display flex items-center gap-2">
            <Building2 className="w-4 h-4 text-cyan-700" />
            <span>Audit Report Details</span>
          </h3>
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-900 border border-cyan-300">
            Non-Cash · Admin Approval Only
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-cyan-50/70 border border-cyan-200 p-3 sm:col-span-1">
            <span className="text-[10px] uppercase tracking-wider text-cyan-800 font-bold block">
              Audit Report of Which Firm
            </span>
            <span className="text-xs sm:text-sm font-extrabold text-cyan-950 mt-0.5 block break-words">
              {d.audit_firm || '—'}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
              Audit Period From
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block">
              {d.audit_from_date ? formatISTDate(d.audit_from_date, false) : '—'}
            </span>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
              Audit Period To
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block">
              {d.audit_to_date ? formatISTDate(d.audit_to_date, false) : '—'}
            </span>
          </div>
        </div>

        <div className="p-3 bg-cyan-50/50 border border-cyan-200/70 rounded-xl text-xs text-cyan-900 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-cyan-700 shrink-0" />
          <span>Non-cash audit report — no disbursement step. Approved exclusively by the Administrator.</span>
        </div>
      </div>
    );
  }
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
            <span className="text-[10px] uppercase tracking-wider text-indigo-700 font-semibold block">GST Amount{d.has_gst && d.gst_rate ? ` (~${d.gst_rate}%)` : ''}</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-800 break-words">{d.has_gst ? (money(d.gst_amount) ?? '—') : '₹0.00'}</span>
          </div>
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2 sm:p-3 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-indigo-800 font-semibold block">Total Payable</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-900 break-words">{money(request.amount)}</span>
          </div>
        </div>
        {d.round_off ? (
          <p className="text-[11px] text-slate-500 text-center mt-2.5">
            Includes round-off adjustment of {d.round_off > 0 ? `+${money(d.round_off)}` : money(d.round_off)} (rounded to nearest ₹1)
          </p>
        ) : null}
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
          <Row label="Invoice Number" value={d.invoice_no} />
          <Row label="Date of Bill" value={d.bill_date ? formatISTDate(d.bill_date, false) : undefined} />
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

  if (t === 'non_cash') {
    const val = Number(d.associated_value || 0);
    const notes = d.associated_notes || null;
    return (
      <div className="bg-white rounded-2xl border border-emerald-200/80 p-5 sm:p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-emerald-600" /> Non-Cash Request Details
        </h3>

        <div className="p-3 bg-emerald-50/70 border border-emerald-200/60 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Operational / administrative request. No direct cash payout or disbursement is required.</span>
        </div>

        {val > 0 || notes ? (
          <Section title="Associated Value / Adjustment (Not Paid Directly)">
            {val > 0 && <Row label="Associated Value" value={money(val)} />}
            {notes && <Row label="Adjustment Nature / Details" value={notes} wide={!val} />}
          </Section>
        ) : (
          <div className="text-xs text-slate-500 italic py-1">
            No nominal cash, value, or adjustment was recorded for this request.
          </div>
        )}
      </div>
    );
  }

  if (t === 'exhibition') {
    const provides = (d.provides || []).map((p) => (p === 'other' && d.provides_other ? `Other: ${d.provides_other}` : PROVIDE_LABELS[p] || p));
    const exhShopName = getExhibitionShopName(request);
    const isNotAssigned = exhShopName === 'Not Assigned';
    const rawSchedules = Array.isArray(d.daily_schedules) ? (d.daily_schedules as ExhibitionDaySchedule[]) : [];
    const schedules: ExhibitionDaySchedule[] = rawSchedules.length > 0
      ? rawSchedules
      : generateDailySchedules(d.event_start, d.event_end);
    const totalDays = schedules.length > 0 ? schedules.length : Number(d.total_days || 1);
    const totalHours = schedules.reduce((s, row) => s + (Number(row.hours) || 0), 0) || Number(d.total_hours || 0);

    return (
      <div className="bg-white rounded-2xl border border-brand-200 p-5 sm:p-6 shadow-xs divide-y divide-slate-100">
        <h3 className="text-sm font-bold text-slate-900 font-display pb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-brand-600" /> Exhibition / event sponsorship
        </h3>

        {/* Prominently Highlighted Event Schedule Section */}
        <div className="pt-4 first:pt-0">
          <div className="rounded-2xl border-2 border-indigo-200 bg-linear-to-br from-indigo-50/90 via-white to-indigo-50/50 p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-extrabold text-indigo-950 font-display">
                    Event Schedule & Daily Timing
                  </h4>
                  <p className="text-[11px] text-indigo-700 font-medium">
                    {d.event_dates || 'Event Duration Breakdown'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-indigo-600 text-white text-xs font-extrabold shadow-xs flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>{totalDays} Day{totalDays === 1 ? '' : 's'}</span>
                  <span>•</span>
                  <span>{totalHours.toFixed(1)} Hours Total</span>
                </span>
              </div>
            </div>

            {/* Day-by-Day Table / Grid */}
            {schedules.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-indigo-100 bg-white shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-indigo-900 text-white font-bold text-[10px] uppercase tracking-wider">
                      <th className="py-2 px-3">Day</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">From Time</th>
                      <th className="py-2 px-3">To Time</th>
                      <th className="py-2 px-3 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {schedules.map((row, idx) => (
                      <tr key={row.date || idx} className={idx % 2 === 1 ? 'bg-indigo-50/30' : 'bg-white'}>
                        <td className="py-2.5 px-3 font-extrabold text-indigo-700">
                          Day {row.day_number || idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">
                          {row.day_name ? `${row.day_name} (${row.date})` : row.date}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700">
                          {row.from_time}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700">
                          {row.to_time}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 font-extrabold text-[11px]">
                            {Number(row.hours || 0).toFixed(1)} hrs
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-indigo-50/80 border-t border-indigo-200 font-extrabold text-indigo-950 text-xs">
                      <td colSpan={4} className="py-2 px-3">Total Duration across {totalDays} Day(s)</td>
                      <td className="py-2 px-3 text-right text-indigo-900 font-display font-extrabold">
                        {totalHours.toFixed(1)} hrs
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-3 bg-white rounded-xl border border-indigo-100 text-xs text-indigo-900 flex items-center justify-between">
                <span>Window: <strong>{d.event_dates || '-'}</strong></span>
                {totalHours > 0 && <span>Duration: <strong>{totalHours.toFixed(1)} hrs</strong></span>}
              </div>
            )}
          </div>
        </div>

        <Section title="Event details">
          <div className="col-span-2 flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="min-w-0">
              <span className="text-slate-400 font-medium block text-[11px]">Conducting shop</span>
              <span className="font-bold mt-0.5 flex items-center gap-1.5 flex-wrap">
                <Store className={`w-3.5 h-3.5 shrink-0 ${isNotAssigned ? 'text-amber-600' : 'text-indigo-600'}`} />
                <span className={isNotAssigned ? 'text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-md text-xs' : 'text-slate-900 text-xs sm:text-sm'}>
                  {exhShopName}
                </span>
              </span>
            </div>
            {onEditExhibitionShop && (
              <button
                type="button"
                id="edit-exhibition-shop-btn"
                onClick={onEditExhibitionShop}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                  isNotAssigned
                    ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-2xs'
                    : 'bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200'
                }`}
              >
                <Pencil className="w-3 h-3" />
                <span>{isNotAssigned ? 'Assign Shop' : 'Change Shop'}</span>
              </button>
            )}
          </div>
          <Row label="Event name" value={d.event_name} wide />
          <Row label="Organiser contact" value={d.organiser_contact} wide />
          <Row label="Venue" value={d.venue} />
          <Row label="Event date(s)" value={d.event_dates} />
          <Row label="Expected footfall" value={d.expected_footfall} />
          <Row label="Stall size / location" value={d.stall_size_location} />
        </Section>
        <Section title="Sponsorship amount">
          <Row label="Amount (excl. GST)" value={money(d.amount_excl_gst)} />
          <Row label={`GST Amount${d.gst_pct ? ` (~${d.gst_pct}%)` : ''}`} value={money(d.gst_amount)} />
          {d.round_off ? <Row label="Round-off" value={d.round_off > 0 ? `+${money(d.round_off)}` : money(d.round_off)} /> : null}
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
  }

  return null;
};
