import React, { useState, useMemo } from 'react';
import { Tag, Plus, Check, ShieldAlert, Pencil, Search, Layers, CheckCircle2, XCircle } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useDirectory } from '../../lib/directory';
import { formatISTDate } from '../../lib/formatters';
import type { ProductCategory } from '../../types/database';

const ProductCategoryModal: React.FC<{
  category: ProductCategory | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { id?: string; name: string; is_active?: boolean }) => Promise<{ success: boolean; error?: string }>;
}> = ({ category, isOpen, onClose, onSave }) => {
  const [name, setName] = useState(category?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state if editing changes
  React.useEffect(() => {
    setName(category?.name ?? '');
    setError(null);
  }, [category, isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Enter the product category name.');
    setBusy(true);
    const res = await onSave({
      id: category?.id,
      name: name.trim(),
      is_active: category?.is_active ?? true,
    });
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not save category.');
  };

  const inputCls =
    'w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={category ? 'Edit Product Category' : 'Add Product Category'}
      description="Product category master for Stock Transfers and item classification."
      maxWidth="md"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div>
          <label htmlFor="pcat-name" className="text-xs font-bold text-slate-700 block mb-1">
            Category Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="pcat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Diamond Rings, Gold Necklaces, Earrings…"
            className={inputCls}
            autoFocus
          />
        </div>
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="pcat-save"
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 disabled:opacity-50 transition-colors"
          >
            <Tag className="w-3.5 h-3.5" />
            <span>{category ? 'Save changes' : 'Add category'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const AdminProductCategoriesPage: React.FC = () => {
  const dir = useDirectory();
  const [editing, setEditing] = useState<ProductCategory | null | undefined>(undefined); // undefined = closed, null = new
  const [searchTerm, setSearchTerm] = useState('');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const show = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 5000);
  };

  const categories = dir.productCategories;

  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return categories;
    const q = searchTerm.toLowerCase();
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, searchTerm]);

  const activeCount = useMemo(() => categories.filter((c) => c.is_active).length, [categories]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Tag className="w-6 h-6 text-indigo-600" />
            <span>Product Categories</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Master catalogue of product categories used for stock transfer requests and inventory tracking.
          </p>
        </div>
        <button
          type="button"
          id="add-category-btn"
          onClick={() => setEditing(null)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 self-start sm:self-auto transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Product Category</span>
        </button>
      </div>

      {flash && (
        <div
          className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border animate-in fade-in ${
            flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {flash.ok ? <Check className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span>{flash.text}</span>
        </div>
      )}

      {/* Stats and Search bar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-slate-600">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span>Total: <strong className="text-slate-900 font-bold">{categories.length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 font-medium text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Active: <strong className="text-emerald-700 font-bold">{activeCount}</strong></span>
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search categories…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>
      </div>

      {dir.loading ? (
        <LoadingSpinner label="Loading product categories…" />
      ) : filteredCategories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          {searchTerm ? 'No product categories matching your search.' : 'No product categories yet. Add your first category.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredCategories.map((cat) => (
            <div
              key={cat.id}
              className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs flex flex-col justify-between gap-3 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                      <Tag className="w-3.5 h-3.5" />
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 font-display truncate">
                      {cat.name}
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 pl-9">
                    Added {formatISTDate(cat.created_at, false)}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                    cat.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {cat.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setEditing(cat)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 font-medium transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const res = await dir.setProductCategoryActive(cat.id, !cat.is_active);
                    show(
                      res.success
                        ? `${cat.name} ${cat.is_active ? 'deactivated' : 'reactivated'}.`
                        : res.error || 'Failed to update category',
                      res.success
                    );
                  }}
                  className={`px-2.5 py-1 rounded-lg font-semibold text-xs border transition-colors ${
                    cat.is_active
                      ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  }`}
                >
                  {cat.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <ProductCategoryModal
          category={editing}
          isOpen={true}
          onClose={() => setEditing(undefined)}
          onSave={async (data) => {
            const res = await dir.saveProductCategory(data);
            if (res.success) {
              show(editing ? 'Category updated.' : 'Category added.');
            }
            return res;
          }}
        />
      )}
    </div>
  );
};
