import React from 'react';
import { ArrowRight, Plus, Trash2, Store, Layers, ListOrdered, Tag, AlertCircle, Info, Sparkles } from 'lucide-react';
import type { Shop, ProductCategory, RequestDetails, StockTransferDetails } from '../../types/database';
import { formatINR } from '../../lib/formatters';

export interface StockItemRow {
  id: string;
  barcode: string;
  sku: string;
  category_id: string;
  category_name: string;
  gross_weight: string;
  mrp: string;
}

export interface StockTransferForm {
  transfer_mode: 'itemized' | 'bulk';
  from_shop_id: string;
  from_shop_name: string;
  to_shop_id: string;
  to_shop_name: string;
  items: StockItemRow[];
  pieces_count: string;
  total_gross_weight: string;
  total_mrp: string;
  bulk_category_id: string;
  bulk_category_name: string;
}

export const createInitialStockItem = (id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`): StockItemRow => ({
  id,
  barcode: '',
  sku: '',
  category_id: '',
  category_name: '',
  gross_weight: '',
  mrp: '',
});

export const emptyStockTransfer = (defaultShopId = '', defaultShopName = ''): StockTransferForm => ({
  transfer_mode: 'itemized',
  from_shop_id: defaultShopId,
  from_shop_name: defaultShopName,
  to_shop_id: '',
  to_shop_name: '',
  items: [createInitialStockItem('item-1')],
  pieces_count: '',
  total_gross_weight: '',
  total_mrp: '',
  bulk_category_id: '',
  bulk_category_name: '',
});

export const stockTransferFromDetails = (
  d?: RequestDetails | null,
  defaultShopId = '',
  defaultShopName = ''
): StockTransferForm => {
  if (!d) return emptyStockTransfer(defaultShopId, defaultShopName);

  const mode = d.transfer_mode === 'bulk' ? 'bulk' : 'itemized';
  const rawItems = Array.isArray(d.items) ? d.items : [];
  const items: StockItemRow[] = rawItems.length > 0
    ? rawItems.map((it, idx) => ({
        id: `item-${idx}-${Date.now()}`,
        barcode: String(it.barcode || ''),
        sku: String(it.sku || ''),
        category_id: String(it.category_id || ''),
        category_name: String(it.category_name || ''),
        gross_weight: it.gross_weight !== undefined && it.gross_weight !== null ? String(it.gross_weight) : '',
        mrp: it.mrp !== undefined && it.mrp !== null ? String(it.mrp) : '',
      }))
    : [createInitialStockItem('item-1')];

  return {
    transfer_mode: mode,
    from_shop_id: d.from_shop_id || defaultShopId,
    from_shop_name: d.from_shop_name || defaultShopName,
    to_shop_id: d.to_shop_id || '',
    to_shop_name: d.to_shop_name || '',
    items,
    pieces_count: d.pieces_count ? String(d.pieces_count) : '',
    total_gross_weight: d.total_gross_weight ? String(d.total_gross_weight) : '',
    total_mrp: d.total_mrp ? String(d.total_mrp) : '',
    bulk_category_id: d.category_id || '',
    bulk_category_name: d.category_name || '',
  };
};

export const stockTransferCalc = (f: StockTransferForm) => {
  if (f.transfer_mode === 'bulk') {
    const pieces = parseInt(f.pieces_count, 10) || 0;
    const grossWeight = parseFloat(f.total_gross_weight) || 0;
    const totalMrp = parseFloat(f.total_mrp) || 0;
    return {
      pieces,
      grossWeight: Math.round(grossWeight * 1000) / 1000,
      totalMrp: Math.round(totalMrp * 100) / 100,
    };
  }

  let grossWeight = 0;
  let totalMrp = 0;
  f.items.forEach((item) => {
    grossWeight += parseFloat(item.gross_weight) || 0;
    totalMrp += parseFloat(item.mrp) || 0;
  });

  return {
    pieces: f.items.length,
    grossWeight: Math.round(grossWeight * 1000) / 1000,
    totalMrp: Math.round(totalMrp * 100) / 100,
  };
};

export function toStockTransferDetails(f: StockTransferForm): StockTransferDetails {
  const calc = stockTransferCalc(f);
  if (f.transfer_mode === 'bulk') {
    return {
      transfer_mode: 'bulk',
      from_shop_id: f.from_shop_id,
      from_shop_name: f.from_shop_name || undefined,
      to_shop_id: f.to_shop_id,
      to_shop_name: f.to_shop_name || undefined,
      pieces_count: calc.pieces,
      total_pieces: calc.pieces,
      total_gross_weight: calc.grossWeight,
      total_mrp: calc.totalMrp,
      category_id: f.bulk_category_id || null,
      category_name: f.bulk_category_name || null,
    };
  }

  return {
    transfer_mode: 'itemized',
    from_shop_id: f.from_shop_id,
    from_shop_name: f.from_shop_name || undefined,
    to_shop_id: f.to_shop_id,
    to_shop_name: f.to_shop_name || undefined,
    items: f.items.map((it) => ({
      barcode: it.barcode.trim(),
      sku: it.sku.trim(),
      mrp: parseFloat(it.mrp) || 0,
      gross_weight: parseFloat(it.gross_weight) || 0,
      category_id: it.category_id || null,
      category_name: it.category_name || null,
    })),
    pieces_count: calc.pieces,
    total_pieces: calc.pieces,
    total_gross_weight: calc.grossWeight,
    total_mrp: calc.totalMrp,
  };
}

export function validateStockTransfer(f: StockTransferForm): string | null {
  if (!f.from_shop_id) return 'Please select the source (From) shop.';
  if (!f.to_shop_id) return 'Please select the destination (To) shop.';
  if (f.from_shop_id === f.to_shop_id) return 'Destination shop cannot be the same as the source shop.';

  if (f.transfer_mode === 'bulk') {
    const pieces = parseInt(f.pieces_count, 10);
    if (!Number.isFinite(pieces) || pieces <= 0) return 'Enter the number of pieces for bulk transfer.';
    const wt = parseFloat(f.total_gross_weight);
    if (!Number.isFinite(wt) || wt <= 0) return 'Enter the total gross weight (in grams).';
    const mrp = parseFloat(f.total_mrp);
    if (!Number.isFinite(mrp) || mrp <= 0) return 'Enter the total MRP value.';
    return null;
  }

  if (f.items.length === 0) return 'Add at least one product item to transfer.';

  for (let i = 0; i < f.items.length; i++) {
    const item = f.items[i];
    const n = i + 1;
    if (!item.barcode.trim()) return `Product #${n}: Enter the barcode.`;
    if (!item.sku.trim()) return `Product #${n}: Enter the SKU.`;
    if (!item.category_id) return `Product #${n}: Select a product category.`;
    const wt = parseFloat(item.gross_weight);
    if (!Number.isFinite(wt) || wt <= 0) return `Product #${n}: Enter valid gross weight.`;
    const mrp = parseFloat(item.mrp);
    if (!Number.isFinite(mrp) || mrp <= 0) return `Product #${n}: Enter valid MRP amount.`;
  }

  return null;
}

interface StockTransferFieldsProps {
  value: StockTransferForm;
  onChange: (val: StockTransferForm) => void;
  shops: Shop[];
  categories: ProductCategory[];
  disabled?: boolean;
}

export const StockTransferFields: React.FC<StockTransferFieldsProps> = ({
  value,
  onChange,
  shops,
  categories,
  disabled = false,
}) => {
  const activeShops = shops.filter((s) => s.is_active || s.id === value.from_shop_id || s.id === value.to_shop_id);
  const activeCategories = categories.filter((c) => c.is_active);

  const calc = stockTransferCalc(value);

  const handleFromShopChange = (shopId: string) => {
    const found = activeShops.find((s) => s.id === shopId);
    onChange({
      ...value,
      from_shop_id: shopId,
      from_shop_name: found?.name || '',
    });
  };

  const handleToShopChange = (shopId: string) => {
    const found = activeShops.find((s) => s.id === shopId);
    onChange({
      ...value,
      to_shop_id: shopId,
      to_shop_name: found?.name || '',
    });
  };

  const setTransferMode = (mode: 'itemized' | 'bulk') => {
    onChange({ ...value, transfer_mode: mode });
  };

  const handleItemChange = (index: number, patch: Partial<StockItemRow>) => {
    const updated = [...value.items];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...value, items: updated });
  };

  const addItem = () => {
    onChange({
      ...value,
      items: [...value.items, createInitialStockItem()],
    });
  };

  const removeItem = (index: number) => {
    if (value.items.length <= 1) return;
    const updated = value.items.filter((_, idx) => idx !== index);
    onChange({ ...value, items: updated });
  };

  const inputCls =
    'w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white disabled:bg-slate-50 disabled:text-slate-500 transition-colors';
  const labelCls = 'block text-xs font-bold text-slate-700 mb-1';

  return (
    <div className="space-y-5">
      {/* 1. Shop Route Selection */}
      <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white rounded-2xl border border-blue-200/90 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Transfer Route
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-11 gap-3 items-center">
          {/* From Shop */}
          <div className="sm:col-span-5">
            <label htmlFor="st-from-shop" className={labelCls}>
              Source (From) Shop <span className="text-rose-500">*</span>
            </label>
            <select
              id="st-from-shop"
              disabled={disabled}
              value={value.from_shop_id}
              onChange={(e) => handleFromShopChange(e.target.value)}
              className={inputCls}
            >
              <option value="">Select origin shop…</option>
              {activeShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          {/* Arrow */}
          <div className="sm:col-span-1 flex items-center justify-center pt-2 sm:pt-4">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* To Shop */}
          <div className="sm:col-span-5">
            <label htmlFor="st-to-shop" className={labelCls}>
              Destination (To) Shop <span className="text-rose-500">*</span>
            </label>
            <select
              id="st-to-shop"
              disabled={disabled}
              value={value.to_shop_id}
              onChange={(e) => handleToShopChange(e.target.value)}
              className={`${inputCls} ${
                value.from_shop_id && value.to_shop_id && value.from_shop_id === value.to_shop_id
                  ? 'border-rose-400 bg-rose-50/50'
                  : ''
              }`}
            >
              <option value="">Select destination shop…</option>
              {activeShops.map((s) => (
                <option key={s.id} value={s.id} disabled={s.id === value.from_shop_id}>
                  {s.name} ({s.code}) {s.id === value.from_shop_id ? '(Same as From Shop)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {value.from_shop_id && value.to_shop_id && value.from_shop_id === value.to_shop_id && (
          <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1.5 pt-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Destination shop cannot be the same as the origin shop.</span>
          </p>
        )}
      </div>

      {/* 2. Mode Selector */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
            Transfer Entry Mode
          </label>
          <span className="text-[11px] text-slate-500">
            For 4+ items, Bulk mode is supported.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setTransferMode('itemized')}
            className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
              value.transfer_mode === 'itemized'
                ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-100 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                value.transfer_mode === 'itemized' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <ListOrdered className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>Itemized Transfer</span>
                {value.transfer_mode === 'itemized' && (
                  <span className="text-[10px] uppercase font-extrabold px-1.5 py-0.2 rounded-md bg-blue-600 text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Add each product with Barcode, SKU, Category, Weight and MRP.
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => setTransferMode('bulk')}
            className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
              value.transfer_mode === 'bulk'
                ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-100 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                value.transfer_mode === 'bulk' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>Bulk Transfer (4+ Products)</span>
                {value.transfer_mode === 'bulk' && (
                  <span className="text-[10px] uppercase font-extrabold px-1.5 py-0.2 rounded-md bg-indigo-600 text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Specify total number of pieces, gross weight & total MRP together.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* 3. Product Entry Area */}
      {value.transfer_mode === 'bulk' ? (
        /* Bulk Entry Form */
        <div className="bg-white rounded-2xl border border-indigo-200/90 p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Bulk Stock Details
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="st-bulk-pieces" className={labelCls}>
                No. of Pieces <span className="text-rose-500">*</span>
              </label>
              <input
                id="st-bulk-pieces"
                type="number"
                min="1"
                step="1"
                disabled={disabled}
                placeholder="e.g. 5"
                value={value.pieces_count}
                onChange={(e) => onChange({ ...value, pieces_count: e.target.value })}
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="st-bulk-weight" className={labelCls}>
                Total Gross Weight (g) <span className="text-rose-500">*</span>
              </label>
              <input
                id="st-bulk-weight"
                type="number"
                min="0.001"
                step="0.001"
                disabled={disabled}
                placeholder="e.g. 24.500"
                value={value.total_gross_weight}
                onChange={(e) => onChange({ ...value, total_gross_weight: e.target.value })}
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="st-bulk-mrp" className={labelCls}>
                Total MRP (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                id="st-bulk-mrp"
                type="number"
                min="1"
                step="0.01"
                disabled={disabled}
                placeholder="e.g. 150000"
                value={value.total_mrp}
                onChange={(e) => onChange({ ...value, total_mrp: e.target.value })}
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="st-bulk-category" className={labelCls}>
                Product Category
              </label>
              <select
                id="st-bulk-category"
                disabled={disabled}
                value={value.bulk_category_id}
                onChange={(e) => {
                  const cat = activeCategories.find((c) => c.id === e.target.value);
                  onChange({
                    ...value,
                    bulk_category_id: e.target.value,
                    bulk_category_name: cat?.name || '',
                  });
                }}
                className={inputCls}
              >
                <option value="">Mixed / General Categories</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        /* Itemized Products Form */
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-600" />
                <span>Product Items ({value.items.length})</span>
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Fill Barcode, SKU, Category, Gross Weight and MRP for each product.
              </p>
            </div>

            {value.items.length >= 4 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>4+ items! You can switch to Bulk mode above.</span>
              </div>
            )}
          </div>

          {/* Items list */}
          <div className="space-y-3">
            {value.items.map((item, index) => (
              <div
                key={item.id}
                className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 sm:p-4 space-y-3 relative group"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                  <span className="text-xs font-extrabold text-blue-800 bg-blue-100/80 px-2 py-0.5 rounded-md">
                    Product #{index + 1}
                  </span>

                  {value.items.length > 1 && !disabled && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1 rounded-lg transition-colors"
                      title="Remove product"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div>
                    <label className={labelCls}>
                      Barcode <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={disabled}
                      placeholder="e.g. BAR892182"
                      value={item.barcode}
                      onChange={(e) => handleItemChange(index, { barcode: e.target.value })}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      SKU <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={disabled}
                      placeholder="e.g. RNG-DMD-01"
                      value={item.sku}
                      onChange={(e) => handleItemChange(index, { sku: e.target.value })}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Category <span className="text-rose-500">*</span>
                    </label>
                    <select
                      disabled={disabled}
                      value={item.category_id}
                      onChange={(e) => {
                        const cat = activeCategories.find((c) => c.id === e.target.value);
                        handleItemChange(index, {
                          category_id: e.target.value,
                          category_name: cat?.name || '',
                        });
                      }}
                      className={inputCls}
                    >
                      <option value="">Select category…</option>
                      {activeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>
                      Gross Wt (g) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      disabled={disabled}
                      placeholder="e.g. 4.250"
                      value={item.gross_weight}
                      onChange={(e) => handleItemChange(index, { gross_weight: e.target.value })}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      MRP (₹) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      disabled={disabled}
                      placeholder="e.g. 45000"
                      value={item.mrp}
                      onChange={(e) => handleItemChange(index, { mrp: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!disabled && (
            <button
              type="button"
              id="add-stock-item-btn"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-dashed border-blue-300 hover:border-blue-500 bg-blue-50/50 hover:bg-blue-50 text-blue-700 text-xs font-semibold transition-all w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              <span>Add Another Product</span>
            </button>
          )}
        </div>
      )}

      {/* 4. Live Computed Totals Summary Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md grid grid-cols-3 gap-3 text-center">
        <div className="border-r border-slate-800 pr-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Total Pieces
          </span>
          <span className="text-base sm:text-xl font-extrabold text-white font-display mt-0.5 block">
            {calc.pieces} {calc.pieces === 1 ? 'pc' : 'pcs'}
          </span>
        </div>

        <div className="border-r border-slate-800 px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Total Gross Wt
          </span>
          <span className="text-base sm:text-xl font-extrabold text-blue-300 font-display mt-0.5 block">
            {calc.grossWeight} g
          </span>
        </div>

        <div className="pl-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
            Total MRP
          </span>
          <span className="text-base sm:text-xl font-extrabold text-emerald-400 font-display mt-0.5 block">
            {formatINR(calc.totalMrp)}
          </span>
        </div>
      </div>
    </div>
  );
};
