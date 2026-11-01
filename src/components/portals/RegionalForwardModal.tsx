import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import type { RequestRecord, UserTargetHead } from '../../types/database';
import { ArrowRightLeft, Send, UserCheck } from 'lucide-react';
import { useRequests, type ActionVoice } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { useDirectory } from '../../lib/directory';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { useCategoryOptions, WorkCategoryField } from '../requests/WorkCategoryField';
import { errMsg } from '../../lib/errorUtils';

export interface RegionalForwardSelection {
  targetHeadId?: string | null;
  targetHeadName?: string | null;
  categoryId?: string | null;
  headChanged?: boolean;
}

interface RegionalForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onForward: (
    remarks?: string,
    voice?: ActionVoice | null,
    selection?: RegionalForwardSelection
  ) => Promise<void>;
}

interface HeadOption extends UserTargetHead {
  is_current_request_head?: boolean;
}

/** Regional Head checks an employee's request and passes it to the clerk (no approval). */
export const RegionalForwardModal: React.FC<RegionalForwardModalProps> = ({
  isOpen,
  onClose,
  request,
  onForward,
}) => {
  const { user } = useAuth();
  const { getUserTargetHeads } = useRequests();
  const dir = useDirectory();

  const canSelectHead = user?.role === 'regional_head' && request.request_type !== 'exhibition';

  const [rpcHeads, setRpcHeads] = useState<UserTargetHead[]>([]);
  const [pickedHeadId, setPickedHeadId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>(request.category_id || '');
  const [remarks, setRemarks] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !canSelectHead || !user?.id) return;
    let alive = true;
    getUserTargetHeads(user.id).then((list) => {
      if (!alive) return;
      setRpcHeads(list);
    });
    return () => {
      alive = false;
    };
  }, [isOpen, canSelectHead, getUserTargetHeads, user?.id]);

  const headOptions = useMemo<HeadOption[]>(() => {
    if (!canSelectHead || !user) return [];

    const byId = new Map<string, HeadOption>();
    for (const h of rpcHeads) {
      byId.set(h.head_id, {
        ...h,
        is_current_request_head: h.head_id === request.owner_head_id,
      });
    }

    // Merge Admin-allowed heads from directory state so live Staff Access updates reflect immediately
    const dirMe = dir.users.find((u) => u.id === user.id) || user;
    const uhEntries = dirMe.user_heads || [];
    const allowedIds = new Set<string>(uhEntries.map((u) => u.head_id));
    if (dirMe.default_head_id) allowedIds.add(dirMe.default_head_id);

    for (const hid of allowedIds) {
      if (byId.has(hid)) continue;
      const headUser = dir.users.find((u) => u.id === hid && u.role === 'head' && u.is_active);
      if (!headUser) continue;
      const isDef =
        uhEntries.some((u) => u.head_id === hid && u.is_default) || dirMe.default_head_id === hid;
      byId.set(hid, {
        head_id: headUser.id,
        head_name: headUser.full_name,
        department_id: headUser.department_id || '',
        department_name:
          headUser.department?.name ||
          dir.departments.find((d) => d.id === headUser.department_id)?.name ||
          'Department',
        is_default: isDef,
        is_current_request_head: headUser.id === request.owner_head_id,
      });
    }

    // Fallback to Regional Head's own department head if no explicit user_heads rows exist yet
    if (byId.size === 0 && dirMe.department_id) {
      const deptHead = dir.users.find(
        (u) => u.role === 'head' && u.is_active && u.department_id === dirMe.department_id
      );
      if (deptHead) {
        byId.set(deptHead.id, {
          head_id: deptHead.id,
          head_name: deptHead.full_name,
          department_id: deptHead.department_id || '',
          department_name:
            deptHead.department?.name ||
            dir.departments.find((d) => d.id === deptHead.department_id)?.name ||
            'Department',
          is_default: true,
          is_current_request_head: deptHead.id === request.owner_head_id,
        });
      }
    }

    const allowedList = Array.from(byId.values()).sort((a, b) =>
      a.is_default === b.is_default ? a.head_name.localeCompare(b.head_name) : a.is_default ? -1 : 1
    );

    // Ensure the request's current owner_head_id is always available so forwarding unchanged always works
    if (request.owner_head_id && !byId.has(request.owner_head_id)) {
      const reqHeadUser = dir.users.find((u) => u.id === request.owner_head_id);
      const currentOption: HeadOption = {
        head_id: request.owner_head_id,
        head_name: request.owner_head_name || reqHeadUser?.full_name || 'Assigned Head',
        department_id: request.department_id,
        department_name:
          request.department?.name ||
          reqHeadUser?.department?.name ||
          dir.departments.find((d) => d.id === request.department_id)?.name ||
          'Department',
        is_default: false,
        is_current_request_head: true,
      };
      return [currentOption, ...allowedList];
    }

    return allowedList;
  }, [
    canSelectHead,
    user,
    rpcHeads,
    dir.users,
    dir.departments,
    request.owner_head_id,
    request.owner_head_name,
    request.department_id,
    request.department?.name,
  ]);

  const selectedHeadId = useMemo(() => {
    if (!canSelectHead) return request.owner_head_id || '';
    if (pickedHeadId && headOptions.some((h) => h.head_id === pickedHeadId)) {
      return pickedHeadId;
    }
    const preferred =
      headOptions.find((h) => h.head_id === request.owner_head_id) ||
      headOptions.find((h) => h.is_default) ||
      headOptions[0];
    return preferred?.head_id || request.owner_head_id || '';
  }, [canSelectHead, pickedHeadId, headOptions, request.owner_head_id]);

  const categoryOptions = useCategoryOptions(canSelectHead ? selectedHeadId || null : null);

  const selectedHead = headOptions.find((h) => h.head_id === selectedHeadId) || null;
  const headChanged = Boolean(
    canSelectHead && selectedHeadId && selectedHeadId !== (request.owner_head_id || '')
  );

  const selectedCategoryName = useMemo(() => {
    if (categoryId) {
      const found = categoryOptions.categories.find((c) => c.id === categoryId);
      if (found) return found.name;
    }
    if (!headChanged && request.category_name) return request.category_name;
    return null;
  }, [categoryId, categoryOptions.categories, headChanged, request.category_name]);

  const handleHeadChange = (nextHeadId: string) => {
    setPickedHeadId(nextHeadId);
    setError(null);
    if (nextHeadId === (request.owner_head_id || '')) {
      setCategoryId(request.category_id || '');
    } else {
      setCategoryId('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRecording) {
      setError('Please stop your voice recording first before forwarding.');
      return;
    }
    if (canSelectHead && categoryOptions.required) {
      const validCat = Boolean(
        categoryId && categoryOptions.categories.some((c) => c.id === categoryId)
      );
      if (!validCat) {
        setError('Please select the work category for the chosen Department Head before forwarding.');
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onForward(remarks.trim() || undefined, voice, {
        targetHeadId: canSelectHead ? selectedHeadId || null : null,
        targetHeadName: selectedHead
          ? `${selectedHead.head_name} (${selectedHead.department_name})`
          : null,
        categoryId: canSelectHead ? categoryId || null : null,
        headChanged,
      });
      setRemarks('');
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Forward to Clerk"
      description={`Request ${request.request_no || ''} · ${request.requester_name}${request.shop_name ? ` · ${request.shop_name}` : ''}${
        request.category_name ? ` · ${request.category_name}` : ''
      }`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl text-xs text-cyan-900 leading-relaxed">
          You have checked this request and are passing it to the{' '}
          {selectedCategoryName ? <strong>{selectedCategoryName}</strong> : 'department'} clerk
          {selectedHead ? (
            <>
              {' '}
              under <strong>{selectedHead.head_name}</strong> ({selectedHead.department_name})
            </>
          ) : null}{' '}
          for routing. This is not an approval — the Department Head or Admin approves it later.
        </div>

        {canSelectHead && headOptions.length > 0 && (
          <div className="bg-sky-50/60 border border-sky-200/80 rounded-xl p-4 space-y-2">
            <label
              htmlFor="regional-forward-target-head"
              className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
            >
              <UserCheck className="w-4 h-4 text-sky-600" />
              <span>
                Approving Department Head <span className="text-rose-500">*</span>
              </span>
            </label>
            <select
              id="regional-forward-target-head"
              value={selectedHeadId}
              onChange={(e) => handleHeadChange(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-sm p-3 rounded-xl border border-slate-200 bg-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden font-medium"
            >
              {headOptions.map((h) => {
                const badges: string[] = [];
                if (h.is_default) badges.push('Main Head');
                if (h.is_current_request_head && !h.is_default) badges.push('Current Request Head');
                return (
                  <option key={h.head_id} value={h.head_id}>
                    {h.head_name} ({h.department_name})
                    {badges.length > 0 ? ` — ${badges.join(' · ')}` : ''}
                  </option>
                );
              })}
            </select>
            {headChanged && selectedHead ? (
              <div className="flex items-start gap-2 pt-1 text-[11px] font-medium text-amber-800">
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Redirecting this request to <strong>{selectedHead.head_name}</strong> (
                  {selectedHead.department_name}). It will go to their clerk queue for routing.
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                {headOptions.length > 1
                  ? 'Keep the current Head or choose another Admin-allowed Department Head assigned to you.'
                  : 'Forwarded to your assigned Main Department Head. Admin can allow additional Heads in Staff Access.'}
              </p>
            )}
          </div>
        )}

        {canSelectHead && categoryOptions.required && (
          <WorkCategoryField
            options={categoryOptions}
            value={categoryId}
            onChange={(id) => {
              setCategoryId(id);
              setError(null);
            }}
            currentName={!headChanged ? request.category_name : null}
          />
        )}

        <div>
          <label htmlFor="regional-remarks" className="text-xs font-bold text-slate-700 block mb-1">
            Remarks for the clerk (optional)
          </label>
          <textarea
            id="regional-remarks"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Checked the bills with the shop manager."
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-hidden"
          />
        </div>

        <ActionVoiceField
          onChange={setVoice}
          onRecordingStateChange={setIsRecording}
          label="Voice message for the clerk (optional)"
        />

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            {error}
          </div>
        )}

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
            id="regional-forward-confirm"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs shadow-md bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Forwarding…' : 'Forward to Clerk'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
