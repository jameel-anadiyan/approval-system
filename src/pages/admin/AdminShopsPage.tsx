import React, { useState } from 'react';
import { Store, Plus, Check, ShieldAlert, Pencil, Users } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useDirectory } from '../../lib/directory';
import { formatISTDate } from '../../lib/formatters';
import type { Shop } from '../../types/database';

const ShopModal: React.FC<{
  shop: Shop | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { id?: string; name: string; code: string; is_active?: boolean }) => Promise<{ success: boolean; error?: string }>;
}> = ({ shop, isOpen, onClose, onSave }) => {
  const [name, setName] = useState(shop?.name ?? '');
  const [code, setCode] = useState(shop?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanCode = code.trim().toUpperCase();
    if (!name.trim()) return setError('Enter the shop name.');
    if (!/^[A-Z0-9]{2,10}$/.test(cleanCode)) return setError('Shop code must be 2–10 uppercase letters or numbers (e.g. TVM, KCH01).');
    setBusy(true);
    const res = await onSave({ id: shop?.id, name: name.trim(), code: cleanCode, is_active: shop?.is_active ?? true });
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not save the shop.');
  };

  const input =
    'w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-hidden';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={shop ? 'Edit Shop' : 'Add Shop'} description="Showrooms / branches that employees belong to." maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}
        <div>
          <label htmlFor="shop-name" className="text-xs font-bold text-slate-700 block mb-1">
            Shop name <span className="text-rose-500">*</span>
          </label>
          <input id="shop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SWA Diamonds – Kochi" className={input} />
        </div>
        <div>
          <label htmlFor="shop-code" className="text-xs font-bold text-slate-700 block mb-1">
            Shop code <span className="text-rose-500">*</span>
          </label>
          <input
            id="shop-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. KCH"
            className={`${input} font-mono uppercase`}
          />
        </div>
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            id="shop-save"
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-200 disabled:opacity-50"
          >
            <Store className="w-3.5 h-3.5" />
            <span>{shop ? 'Save changes' : 'Add shop'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const AdminShopsPage: React.FC = () => {
  const dir = useDirectory();
  const [editing, setEditing] = useState<Shop | null | undefined>(undefined); // undefined = closed, null = new
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const show = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 5000);
  };
  const staffCount = (shopId: string) => dir.users.filter((u) => u.shop_id === shopId && u.is_active).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Store className="w-6 h-6 text-brand-600" />
            <span>Shops</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Master list of showrooms. Each employee is linked to one shop; requests carry the shop name.
          </p>
        </div>
        <button
          type="button"
          id="new-shop"
          onClick={() => setEditing(null)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-200 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Shop</span>
        </button>
      </div>

      {flash && (
        <div
          className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border ${
            flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {flash.ok ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{flash.text}</span>
        </div>
      )}

      {dir.loading ? (
        <LoadingSpinner label="Loading shops…" />
      ) : dir.shops.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No shops yet. Add your first showroom.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {dir.shops.map((shop) => (
            <div key={shop.id} className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col gap-4 hover:border-brand-300 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 border border-brand-200">
                    {shop.code}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 font-display mt-2 truncate">{shop.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {staffCount(shop.id)} active staff
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    shop.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {shop.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 gap-2">
                <span>Added {formatISTDate(shop.created_at, false)}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(shop)}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-200"
                    aria-label={`Edit ${shop.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await dir.saveShop({ id: shop.id, name: shop.name, code: shop.code, is_active: !shop.is_active });
                      show(res.success ? `${shop.name} ${shop.is_active ? 'deactivated' : 'reactivated'}.` : res.error!, res.success);
                    }}
                    className={`px-3 py-1 rounded-lg font-semibold text-xs border ${
                      shop.is_active
                        ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                        : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                  >
                    {shop.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <ShopModal
          key={editing?.id ?? 'new'}
          shop={editing}
          isOpen
          onClose={() => setEditing(undefined)}
          onSave={async (data) => {
            const res = await dir.saveShop(data);
            if (res.success) show(`Shop ${data.name} saved.`);
            return res;
          }}
        />
      )}
    </div>
  );
};
