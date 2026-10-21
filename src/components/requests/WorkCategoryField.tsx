import React, { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { useRequests, type CategoryOptions } from '../../context/RequestContext';

/** Loads the work categories the current user can pick (only needed when several clerks split the work).
 * Dynamically reloads when a different target Head is selected.
 */
export function useCategoryOptions(targetHeadId?: string | null) {
  const { loadCategoryOptions } = useRequests();
  const [options, setOptions] = useState<CategoryOptions>({ required: false, categories: [] });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    loadCategoryOptions(targetHeadId).then((o) => {
      if (!alive) return;
      setOptions(o);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [loadCategoryOptions, targetHeadId]);
  return { ...options, loaded };
}

/**
 * "Work category" picker shown on every request type when the department has more than one clerk.
 * The request then goes only to the clerk(s) handling that category.
 */
export const WorkCategoryField: React.FC<{
  options: CategoryOptions;
  value: string;
  onChange: (id: string) => void;
  /** Category saved on the request that is no longer offered (e.g. deactivated) */
  currentName?: string | null;
}> = ({ options, value, onChange, currentName }) => {
  if (!options.required) return null;
  const known = options.categories.some((c) => c.id === value);
  return (
    <div className="bg-indigo-50/50 border border-indigo-200/80 rounded-xl p-4">
      <label htmlFor="request-category" className="text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
        <Tags className="w-3.5 h-3.5 text-indigo-600" />
        Work Category <span className="text-rose-500">*</span>
      </label>
      <select
        id="request-category"
        value={known ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-base sm:text-sm p-3 rounded-xl border border-slate-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
      >
        <option value="">Select the kind of work…</option>
        {options.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500 mt-1.5">
        {value && !known && currentName
          ? `“${currentName}” is no longer available — pick another category.`
          : 'Your request goes to the clerk who handles this kind of work.'}
      </p>
    </div>
  );
};
