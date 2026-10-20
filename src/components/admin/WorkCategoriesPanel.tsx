import React, { useState } from 'react';
import { Tags, Plus, Pencil, Check, X, Info } from 'lucide-react';
import type { Department, Profile, WorkCategory } from '../../types/database';

interface Props {
  categories: WorkCategory[];
  users: Profile[];
  departments: Department[];
  /** Head: fixed to own department. Admin: picks a department. */
  fixedDepartmentId?: string | null;
  onSave: (input: { id?: string; name: string; is_active?: boolean; department_id?: string | null }) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

/**
 * Department work categories. When a department has several clerks, each clerk handles
 * one or more categories and the requester picks the category so the request reaches
 * only that clerk.
 */
export const WorkCategoriesPanel: React.FC<Props> = ({ categories, users, departments, fixedDepartmentId, onSave }) => {
  const [deptId, setDeptId] = useState<string>(fixedDepartmentId || departments.find((d) => d.is_active)?.id || '');
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departmentId = fixedDepartmentId || deptId;
  const list = categories.filter((c) => c.department_id === departmentId);
  const clerks = users.filter((u) => u.role === 'clerk' && u.is_active && u.department_id === departmentId);
  const clerksFor = (catId: string) => clerks.filter((u) => (u.clerk_cats || []).some((c) => c.category_id === catId));

  const run = async (input: Parameters<Props['onSave']>[0]) => {
    setBusy(true);
    setError(null);
    const res = await onSave({ ...input, department_id: departmentId });
    setBusy(false);
    if (!res.success) setError(res.error || 'Could not save.');
    return res.success;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await run({ name: newName.trim() })) setNewName('');
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4" aria-labelledby="work-cat-title">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 id="work-cat-title" className="text-sm font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Tags className="w-4 h-4 text-indigo-600" />
            Work Categories
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Split the clerks' work. Requesters pick a category and only that category's clerk gets the request.
          </p>
        </div>
        {!fixedDepartmentId && (
          <select
            id="work-cat-dept"
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="text-xs p-2.5 rounded-xl border border-slate-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        )}
      </div>

      {clerks.length <= 1 && (
        <div className="flex items-start gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <span>
            {clerks.length === 0 ? 'No active clerk yet.' : 'Only one active clerk, so requesters are not asked for a category.'}{' '}
            Categories take effect once the department has two or more clerks.
          </span>
        </div>
      )}

      {error && <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}

      <form onSubmit={add} className="flex gap-2">
        <input
          id="work-cat-new"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Purchase, Repairs, Marketing"
          className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
        />
        <button
          type="submit"
          id="work-cat-add"
          disabled={busy || newName.trim().length < 2 || !departmentId}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </form>

      {list.length === 0 ? (
        <p className="text-xs text-slate-400">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {list.map((c) => {
            const handling = clerksFor(c.id);
            return (
              <li key={c.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div className="min-w-0 flex-1">
                  {editId === c.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={60}
                        className="flex-1 text-xs p-2 rounded-lg border border-slate-200 focus:border-indigo-500 outline-hidden"
                      />
                      <button
                        type="button"
                        aria-label="Save name"
                        disabled={busy}
                        onClick={async () => {
                          if (await run({ id: c.id, name: editName, is_active: c.is_active })) setEditId(null);
                        }}
                        className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel"
                        onClick={() => setEditId(null)}
                        className="p-2 rounded-lg border border-slate-200 text-slate-500"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${c.is_active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                        {c.name}
                      </span>
                      {handling.length === 0 ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          No clerk assigned
                        </span>
                      ) : (
                        handling.map((u) => (
                          <span
                            key={u.id}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200"
                          >
                            {u.full_name}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {editId !== c.id && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(c.id);
                        setEditName(c.name);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-semibold hover:bg-slate-50"
                    >
                      <Pencil className="w-3 h-3" />
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run({ id: c.id, name: c.name, is_active: !c.is_active })}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold disabled:opacity-50 ${
                        c.is_active
                          ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                          : 'border-emerald-200 text-emerald-700 bg-emerald-50'
                      }`}
                    >
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10px] text-slate-400">Assign categories to a clerk from the clerk's <strong>Access</strong> button below.</p>
    </section>
  );
};
