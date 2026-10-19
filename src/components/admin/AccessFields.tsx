import React, { useState } from 'react';
import type { AppRole, Profile, RequestType, Shop } from '../../types/database';
import { REQUEST_TYPES, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { KeyRound } from 'lucide-react';

export const rolesWithTypes: AppRole[] = ['employee', 'clerk', 'head'];

/** Shop picker + "may raise these request types" checkboxes. */
export const AccessFields: React.FC<{
  role: AppRole;
  shops: Shop[];
  shopId: string;
  onShopChange: (id: string) => void;
  types: RequestType[];
  onTypesChange: (t: RequestType[]) => void;
}> = ({ role, shops, shopId, onShopChange, types, onTypesChange }) => {
  if (!rolesWithTypes.includes(role)) return null;
  const shopRequired = role === 'employee';
  const activeShops = shops.filter((s) => s.is_active || s.id === shopId);
  const toggle = (t: RequestType) =>
    onTypesChange(types.includes(t) ? types.filter((x) => x !== t) : REQUEST_TYPES.filter((x) => x === t || types.includes(x)));

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="access-shop" className="text-xs font-bold text-slate-700 block mb-1">
          Shop {shopRequired ? <span className="text-rose-500">*</span> : <span className="text-slate-400 font-normal">(optional)</span>}
        </label>
        <select
          id="access-shop"
          value={shopId}
          onChange={(e) => onShopChange(e.target.value)}
          className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-hidden bg-white"
        >
          <option value="">{shopRequired ? 'Select shop…' : 'No shop'}</option>
          {activeShops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
        {shops.length === 0 && (
          <span className="text-[10px] text-amber-700 mt-1 block">No shops yet. Admin can add them under Shops.</span>
        )}
      </div>

      <fieldset>
        <legend className="text-xs font-bold text-slate-700 mb-1.5">
          Request types this user can raise <span className="text-rose-500">*</span>
        </legend>
        <div className="grid gap-2">
          {REQUEST_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <label
                key={t}
                className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                  on ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  id={`access-type-${t}`}
                  checked={on}
                  onChange={() => toggle(t)}
                  className="mt-0.5 w-4 h-4 accent-brand-600"
                />
                <span>
                  <span className="text-xs font-bold text-slate-800 block">{TYPE_LABELS[t]}</span>
                  <span className="text-[11px] text-slate-500">{TYPE_DESCRIPTIONS[t]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
};

/** Returns an error message, or null when the access settings are valid. */
export function validateAccess(role: AppRole, shopId: string, types: RequestType[]): string | null {
  if (!rolesWithTypes.includes(role)) return null;
  if (role === 'employee' && !shopId) return "Select the employee's shop.";
  if (types.length === 0) return 'Select at least one request type.';
  return null;
}

/** Edit an existing user's shop + allowed request types. */
export const AccessModal: React.FC<{
  target: Profile;
  shops: Shop[];
  onClose: () => void;
  onSave: (access: { shop_id: string | null; allowed_types: RequestType[] }) => Promise<{ success: boolean; error?: string }>;
}> = ({ target, shops, onClose, onSave }) => {
  const [shopId, setShopId] = useState(target.shop_id ?? '');
  const [types, setTypes] = useState<RequestType[]>(target.allowed_types?.length ? target.allowed_types : ['general']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const err = validateAccess(target.role, shopId, types);
    if (err) return setError(err);
    setBusy(true);
    const res = await onSave({ shop_id: shopId || null, allowed_types: types });
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not save.');
  };

  return (
    <Modal isOpen onClose={onClose} title={`Access · ${target.full_name}`} description="Shop and the request types this user can raise." maxWidth="md">
      <div className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}
        <AccessFields role={target.role} shops={shops} shopId={shopId} onShopChange={setShopId} types={types} onTypesChange={setTypes} />
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            id="access-save"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md disabled:opacity-50"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Save access
          </button>
        </div>
      </div>
    </Modal>
  );
};
