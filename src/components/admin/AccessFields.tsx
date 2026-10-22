import React, { useState } from 'react';
import type { AppRole, Profile, Region, RequestType, Shop, WorkCategory } from '../../types/database';
import { REQUEST_TYPES, TYPE_LABELS, TYPE_DESCRIPTIONS } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { KeyRound, UserCheck, Tags, Users, Globe } from 'lucide-react';

export const rolesWithTypes: AppRole[] = ['employee', 'clerk', 'head', 'regional_head'];

/** Active Regional Heads of the department who cover the given shop. */
export function coveringRegionalHeads(users: Profile[], departmentId: string | null | undefined, shopId: string): Profile[] {
  if (!departmentId || !shopId) return [];
  return users.filter(
    (u) =>
      u.role === 'regional_head' &&
      u.is_active &&
      u.department_id === departmentId &&
      (u.rh_shops || []).some((s) => s.shop_id === shopId)
  );
}

export interface ExtraAccess {
  shopIds: string[];
  regionId: string;
  regionalHeadId: string;
  categoryIds: string[];
  headIds: string[];
  defaultHeadId: string;
}

interface AccessFieldsProps {
  role: AppRole;
  shops: Shop[];
  regions?: Region[];
  shopId: string;
  onShopChange: (id: string) => void;
  types: RequestType[];
  onTypesChange: (t: RequestType[]) => void;
  /** Department of the user being created / edited (drives Regional Head + category lists) */
  departmentId?: string | null;
  users?: Profile[];
  categories?: WorkCategory[];
  extra?: ExtraAccess;
  onExtraChange?: (e: ExtraAccess) => void;
}

const EMPTY_EXTRA: ExtraAccess = {
  shopIds: [],
  regionId: '',
  regionalHeadId: '',
  categoryIds: [],
  headIds: [],
  defaultHeadId: '',
};

/** Shop picker(s), Regional Head / work categories, Department Heads, and "may raise these request types" checkboxes. */
export const AccessFields: React.FC<AccessFieldsProps> = ({
  role, shops, regions = [], shopId, onShopChange, types, onTypesChange,
  departmentId, users = [], categories = [], extra = EMPTY_EXTRA, onExtraChange,
}) => {
  if (!rolesWithTypes.includes(role)) return null;
  const shopRequired = role === 'employee';
  const isRegional = role === 'regional_head';
  const activeShops = shops.filter((s) => s.is_active || s.id === shopId || extra.shopIds.includes(s.id));
  const availableHeads = users.filter((u) => u.role === 'head' && u.is_active);
  const toggle = (t: RequestType) =>
    onTypesChange(types.includes(t) ? types.filter((x) => x !== t) : REQUEST_TYPES.filter((x) => x === t || types.includes(x)));
  const setExtra = (patch: Partial<ExtraAccess>) => onExtraChange?.({ ...extra, ...patch });

  const covering = role === 'employee' ? coveringRegionalHeads(users, departmentId, shopId) : [];
  const deptCategories = categories.filter(
    (c) => c.department_id === departmentId && (c.is_active || extra.categoryIds.includes(c.id))
  );

  return (
    <div className="space-y-4">
      {isRegional ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="access-region" className="text-xs font-bold text-slate-700 block mb-1">
              Region of Regional Head <span className="text-rose-500">*</span>
            </label>
            <select
              id="access-region"
              value={extra.regionId || ''}
              onChange={(e) => setExtra({ regionId: e.target.value })}
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-hidden bg-white"
            >
              <option value="">Select Region (Admin Region Master)…</option>
              {regions
                .filter((r) => r.is_active || r.id === extra.regionId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">
              The Region Master is configured in Admin. Controls the 2-per-day exhibition booking quota for this region.
            </span>
          </div>

          <fieldset>
            <legend className="text-xs font-bold text-slate-700 mb-1.5">
              Shops under this Regional Head <span className="text-rose-500">*</span>
            </legend>
            {activeShops.length === 0 ? (
              <span className="text-[11px] text-amber-700 block">No shops yet. Admin can add them under Shops.</span>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {activeShops.map((s) => {
                  const on = extra.shopIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer text-xs transition-colors ${
                        on ? 'border-cyan-300 bg-cyan-50/70' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        id={`access-rh-shop-${s.id}`}
                        checked={on}
                        onChange={() =>
                          setExtra({ shopIds: on ? extra.shopIds.filter((x) => x !== s.id) : [...extra.shopIds, s.id] })
                        }
                        className="w-4 h-4 accent-cyan-600"
                      />
                      <span className="truncate">
                        <strong className="text-slate-800">{s.name}</strong> <span className="text-slate-400">({s.code})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <span className="text-[10px] text-slate-400 mt-1 block">
              Employees of these shops send their requests through this Regional Head.
            </span>
          </fieldset>
        </div>
      ) : (
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
      )}

      {role === 'employee' && (
        <div>
          <label htmlFor="access-regional-head" className="text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-cyan-600" />
            Regional Head {covering.length > 0 && <span className="text-rose-500">*</span>}
          </label>
          {!shopId ? (
            <span className="text-[11px] text-slate-400 block">Select the shop first.</span>
          ) : covering.length === 0 ? (
            <span className="text-[11px] text-slate-500 block">
              No Regional Head covers this shop, so requests go straight to the clerk.
            </span>
          ) : (
            <>
              <select
                id="access-regional-head"
                value={extra.regionalHeadId}
                onChange={(e) => setExtra({ regionalHeadId: e.target.value })}
                className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-hidden bg-white"
              >
                <option value="">Select Regional Head…</option>
                {covering.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                    {u.designation ? ` · ${u.designation}` : ''}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400 mt-1 block">
                This employee's requests go to the Regional Head first, who forwards them to the clerk.
              </span>
            </>
          )}
        </div>
      )}

      {role === 'clerk' && (
        <fieldset>
          <legend className="text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Tags className="w-3.5 h-3.5 text-indigo-600" />
            Work categories this clerk handles
          </legend>
          {deptCategories.length === 0 ? (
            <span className="text-[11px] text-slate-500 block">
              No work categories yet. Add them under <strong>Work Categories</strong> if several clerks share the work.
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deptCategories.map((c) => {
                const on = extra.categoryIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border cursor-pointer text-xs font-semibold transition-colors ${
                      on ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      id={`access-cat-${c.id}`}
                      checked={on}
                      onChange={() =>
                        setExtra({
                          categoryIds: on ? extra.categoryIds.filter((x) => x !== c.id) : [...extra.categoryIds, c.id],
                        })
                      }
                      className="w-3.5 h-3.5 accent-indigo-600"
                    />
                    {c.name}
                    {!c.is_active && <span className="text-[10px] text-slate-400">(inactive)</span>}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      {(role === 'employee' || role === 'regional_head') && (
        <fieldset>
          <legend className="text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Assigned Department Heads <span className="text-rose-500">*</span>
            </span>
            <span className="text-[10px] text-slate-400 font-normal">Choose which Heads can receive requests</span>
          </legend>
          {availableHeads.length === 0 ? (
            <span className="text-[11px] text-amber-700 block">No active Department Heads found.</span>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {availableHeads.map((h) => {
                  const isChecked = extra.headIds.includes(h.id);
                  const isDefault = extra.defaultHeadId === h.id || (extra.headIds.length === 1 && isChecked);
                  return (
                    <div
                      key={h.id}
                      className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs transition-colors ${
                        isChecked ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                        <input
                          type="checkbox"
                          id={`access-head-${h.id}`}
                          checked={isChecked}
                          onChange={() => {
                            const next = isChecked
                              ? extra.headIds.filter((id) => id !== h.id)
                              : [...extra.headIds, h.id];
                            let nextDef = extra.defaultHeadId;
                            if (!next.includes(nextDef)) {
                              nextDef = next[0] || '';
                            } else if (!nextDef && next.length > 0) {
                              nextDef = next[0];
                            }
                            setExtra({ headIds: next, defaultHeadId: nextDef });
                          }}
                          className="w-4 h-4 accent-indigo-600 shrink-0"
                        />
                        <div className="min-w-0">
                          <strong className="text-slate-800 block truncate">{h.full_name}</strong>
                          <span className="text-[10px] text-slate-500 block truncate">
                            {h.department?.name || h.designation || 'Dept Head'}
                          </span>
                        </div>
                      </label>
                      {isChecked && (
                        <button
                          type="button"
                          onClick={() => setExtra({ defaultHeadId: h.id })}
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md shrink-0 transition-all ${
                            isDefault
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                          }`}
                          title={isDefault ? 'Primary Default Head' : 'Click to make Primary Default Head'}
                        >
                          {isDefault ? 'Default' : 'Make Default'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="text-[10px] text-slate-400 block">
                Requests default to the primary Head, but the user can select any assigned Head when drafting a request.
              </span>
            </div>
          )}
        </fieldset>
      )}

      {role === 'head' && (
        <div>
          <label htmlFor="access-region-head" className="text-xs font-bold text-slate-700 block mb-1">
            Assigned Region <span className="text-[10px] font-normal text-slate-400">(Optional / Region Master)</span>
          </label>
          <select
            id="access-region-head"
            value={extra.regionId || ''}
            onChange={(e) => setExtra({ regionId: e.target.value })}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white"
          >
            <option value="">None / All Regions</option>
            {regions
              .filter((r) => r.is_active || r.id === extra.regionId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
          </select>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Optionally associate this Department Head with an enterprise region from Region Master.
          </span>
        </div>
      )}

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
export function validateAccess(
  role: AppRole,
  shopId: string,
  types: RequestType[],
  extra?: ExtraAccess & { coveringCount?: number }
): string | null {
  if (!rolesWithTypes.includes(role)) return null;
  if (role === 'employee' && !shopId) return "Select the employee's shop.";
  if (role === 'regional_head' && !extra?.regionId) return 'Select a region for the Regional Head from Region Master.';
  if (role === 'regional_head' && !(extra?.shopIds.length)) return 'Select at least one shop for the Regional Head.';
  if (role === 'employee' && (extra?.coveringCount ?? 0) > 0 && !extra?.regionalHeadId) {
    return "Select the employee's Regional Head.";
  }
  if ((role === 'employee' || role === 'regional_head') && extra && (!extra.headIds || extra.headIds.length === 0)) {
    return 'Select at least one Department Head for this user.';
  }
  if (types.length === 0) return 'Select at least one request type.';
  return null;
}

/** Edit an existing user's shop(s), Regional Head / categories and allowed request types. */
export const AccessModal: React.FC<{
  target: Profile;
  shops: Shop[];
  regions?: Region[];
  users?: Profile[];
  categories?: WorkCategory[];
  onClose: () => void;
  onSave: (access: {
    shop_id: string | null;
    allowed_types: RequestType[];
    shop_ids?: string[];
    region_id?: string | null;
    category_ids?: string[];
    regional_head_id?: string | null;
    head_ids?: string[];
    default_head_id?: string | null;
  }) => Promise<{ success: boolean; error?: string }>;
}> = ({ target, shops, regions = [], users = [], categories = [], onClose, onSave }) => {
  const [shopId, setShopId] = useState(target.shop_id ?? '');
  const [types, setTypes] = useState<RequestType[]>(target.allowed_types?.length ? target.allowed_types : ['general']);

  const initialHeadIds = (target.user_heads || []).map((uh) => uh.head_id);
  const fallbackHeadId =
    target.default_head_id ||
    (target.user_heads || []).find((uh) => uh.is_default)?.head_id ||
    users.find((u) => u.role === 'head' && u.department_id === target.department_id)?.id ||
    '';
  const resolvedHeadIds = initialHeadIds.length > 0 ? initialHeadIds : (fallbackHeadId ? [fallbackHeadId] : []);
  const resolvedDefaultHead =
    target.default_head_id ||
    (target.user_heads || []).find((uh) => uh.is_default)?.head_id ||
    resolvedHeadIds[0] ||
    '';

  const [extra, setExtra] = useState<ExtraAccess>({
    shopIds: (target.rh_shops || []).map((s) => s.shop_id),
    regionId: target.region_id ?? '',
    regionalHeadId: target.regional_head_id ?? '',
    categoryIds: (target.clerk_cats || []).map((c) => c.category_id),
    headIds: resolvedHeadIds,
    defaultHeadId: resolvedDefaultHead,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const covering = target.role === 'employee' ? coveringRegionalHeads(users, target.department_id, shopId) : [];
  // Changing the shop may leave a Regional Head who doesn't cover the new shop.
  const regionalHeadId = covering.some((u) => u.id === extra.regionalHeadId) ? extra.regionalHeadId : '';

  const save = async () => {
    const err = validateAccess(target.role, shopId, types, { ...extra, regionalHeadId, coveringCount: covering.length });
    if (err) return setError(err);
    setBusy(true);
    const finalDefaultHead = extra.defaultHeadId || (extra.headIds.length > 0 ? extra.headIds[0] : null);
    const res = await onSave({
      shop_id: target.role === 'regional_head' ? null : shopId || null,
      allowed_types: types,
      ...(target.role === 'regional_head' ? { shop_ids: extra.shopIds, region_id: extra.regionId || null } : {}),
      ...(target.role === 'head' ? { region_id: extra.regionId || null } : {}),
      ...(target.role === 'clerk' ? { category_ids: extra.categoryIds } : {}),
      ...(target.role === 'employee' ? { regional_head_id: regionalHeadId || null } : {}),
      ...(target.role === 'employee' || target.role === 'regional_head'
        ? { head_ids: extra.headIds, default_head_id: finalDefaultHead }
        : {}),
    });
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not save.');
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Access · ${target.full_name}`}
      description={
        target.role === 'regional_head'
          ? 'Region, shops covered, assigned Heads, and request types this Regional Head can raise.'
          : target.role === 'head'
            ? 'Region and request types this Department Head can raise.'
            : target.role === 'clerk'
              ? 'Work categories and request types this clerk can raise.'
              : 'Shop, Regional Head, assigned Heads, and request types this user can raise.'
      }
      maxWidth="md"
    >
      <div className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}
        <AccessFields
          role={target.role}
          shops={shops}
          regions={regions}
          shopId={shopId}
          onShopChange={setShopId}
          types={types}
          onTypesChange={setTypes}
          departmentId={target.department_id}
          users={users}
          categories={categories}
          extra={{ ...extra, regionalHeadId }}
          onExtraChange={setExtra}
        />
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
