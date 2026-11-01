import React, { useEffect, useRef, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useRequests } from '../../context/RequestContext';
import type { UserTargetHead } from '../../types/database';

export const TargetHeadField: React.FC<{
  value: string;
  onChange: (headId: string) => void;
  userId?: string;
  disabled?: boolean;
  /** Optional currently assigned Head on an existing/returned request so it remains selectable even if assigned by a Regional Head */
  currentHead?: {
    head_id: string;
    head_name: string;
    department_id: string;
    department_name: string;
  } | null;
}> = ({ value, onChange, userId, disabled, currentHead }) => {
  const { getUserTargetHeads } = useRequests();
  const [heads, setHeads] = useState<UserTargetHead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const initialPickDone = useRef(false);

  useEffect(() => {
    let alive = true;
    getUserTargetHeads(userId).then((list) => {
      if (!alive) return;
      setHeads(list);
      setLoaded(true);
      // Auto-select default head on initial mount only if none selected yet
      if (!initialPickDone.current && list.length > 0) {
        initialPickDone.current = true;
        if (!value) {
          const def = list.find((h) => h.is_default) || list[0];
          onChange(def.head_id);
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [getUserTargetHeads, userId]);

  const displayHeads: UserTargetHead[] =
    currentHead?.head_id && !heads.some((h) => h.head_id === currentHead.head_id)
      ? [{ ...currentHead, is_default: false }, ...heads]
      : heads;

  if (!loaded || displayHeads.length <= 1) return null;

  return (
    <div className="bg-sky-50/60 border border-sky-200/80 rounded-xl p-4 space-y-2">
      <label htmlFor="target-head-select" className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
        <UserCheck className="w-4 h-4 text-sky-600" />
        <span>Approving Department Head <span className="text-rose-500">*</span></span>
      </label>
      <select
        id="target-head-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full text-base sm:text-sm p-3 rounded-xl border border-slate-200 bg-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden font-medium"
      >
        {displayHeads.map((h) => (
          <option key={h.head_id} value={h.head_id}>
            {h.head_name} ({h.department_name}){h.is_default ? ' — Main Head' : ''}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500">
        You can direct this request to your main Head or another department Head assigned to you.
      </p>
    </div>
  );
};
