import React, { useEffect, useState } from 'react';
import { Store, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { RequestShopOption, RequestType } from '../../types/database';

/** Request types where the requester tags the request with a shop. */
export const SHOP_PICK_TYPES: RequestType[] = ['general', 'non_cash'];
export const needsShopPick = (t: RequestType) => SHOP_PICK_TYPES.includes(t);

export interface RequestShopsState {
  options: RequestShopOption[];
  loading: boolean;
  /** User is tied to these shops (own shop / Regional Head coverage). */
  associated: boolean;
  /** More than one associated shop: the requester must pick one. */
  mustPick: boolean;
  /** Exactly one associated shop: it is assigned automatically. */
  autoShop: RequestShopOption | null;
}

/**
 * Shops the signed-in user can raise a General / Non-Cash request for.
 * Live mode asks the database (my_request_shops RPC) so Regional Head coverage is included.
 */
export function useRequestShops(): RequestShopsState {
  const { user, isBackendConnected } = useAuth();
  const [options, setOptions] = useState<RequestShopOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const fallback = (): RequestShopOption[] =>
      user?.shop ? [{ id: user.shop.id, name: user.shop.name, code: user.shop.code, associated: true }] : [];

    (async () => {
      setLoading(true);
      if (isBackendConnected && user) {
        const { data, error } = await supabase.rpc('my_request_shops');
        if (!alive) return;
        if (error) {
          console.warn('my_request_shops unavailable, using profile shop:', error.message);
          setOptions(fallback());
        } else {
          setOptions(((data as RequestShopOption[]) ?? []).map((s) => ({ ...s, associated: !!s.associated })));
        }
      } else {
        setOptions(fallback());
      }
      if (alive) setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [isBackendConnected, user?.id, user?.shop_id]);

  const associated = options.length > 0 && options.every((o) => o.associated);
  return {
    options,
    loading,
    associated,
    mustPick: associated && options.length > 1,
    autoShop: associated && options.length === 1 ? options[0] : null,
  };
}

interface RequestShopFieldProps {
  state: RequestShopsState;
  value: string;
  onChange: (shopId: string, shopName: string) => void;
  disabled?: boolean;
  /** Name of the currently saved shop (shown when it is no longer in the list) */
  currentName?: string | null;
}

export const RequestShopField: React.FC<RequestShopFieldProps> = ({ state, value, onChange, disabled, currentName }) => {
  const { options, loading, associated, mustPick, autoShop } = state;

  if (loading) {
    return (
      <div className="h-[62px] rounded-xl border border-slate-200 bg-slate-50 animate-pulse" aria-label="Loading shops" />
    );
  }
  if (options.length === 0) return null;

  if (autoShop) {
    return (
      <div
        id="request-shop-auto"
        className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50 to-white"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Store className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Shop</span>
            <span className="text-sm font-bold text-slate-900 truncate block">
              {autoShop.name} <span className="text-xs font-semibold text-slate-500">({autoShop.code})</span>
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-full shrink-0">
          <CheckCircle2 className="w-3 h-3" /> Auto-assigned
        </span>
      </div>
    );
  }

  const known = options.some((o) => o.id === value);

  return (
    <div>
      <label htmlFor="request-shop" className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-1">
        <Store className="w-3.5 h-3.5 text-indigo-500" />
        <span>Shop</span>
        {mustPick ? <span className="text-rose-500">*</span> : <span className="text-slate-400 font-normal">(optional)</span>}
      </label>
      <select
        id="request-shop"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const found = options.find((o) => o.id === e.target.value);
          onChange(e.target.value, found?.name ?? '');
        }}
        className={`w-full text-base sm:text-sm p-3 rounded-xl border bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors disabled:bg-slate-50 ${
          mustPick && !value ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'
        }`}
      >
        <option value="">{mustPick ? 'Select the shop for this request…' : 'No specific shop'}</option>
        {!known && value && currentName && <option value={value}>{currentName}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.code})
          </option>
        ))}
      </select>
      {mustPick && (
        <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
          You are assigned to {options.length} shops — choose the one this request is for.
        </p>
      )}
      {!associated && (
        <p className="mt-1 text-[11px] text-slate-400">No shop is assigned to your account; pick one if this request belongs to a shop.</p>
      )}
    </div>
  );
};
