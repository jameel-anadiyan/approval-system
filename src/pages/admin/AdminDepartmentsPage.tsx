import React, { useState } from 'react';
import { Building2, Plus, Check, ShieldAlert } from 'lucide-react';
import { DepartmentModal } from '../../components/admin/DepartmentModal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useDirectory } from '../../lib/directory';
import { formatISTDate } from '../../lib/formatters';

export const AdminDepartmentsPage: React.FC = () => {
  const dir = useDirectory();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const show = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 5000);
  };

  const headOf = (deptId: string) =>
    dir.users.find((u) => u.role === 'head' && u.is_active && u.department_id === deptId);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-600" />
            <span>Departments</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Create departments, then appoint a Head for each under Dept Heads.
          </p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 self-start sm:self-auto">
          <Plus className="w-4 h-4" /><span>New Department</span>
        </button>
      </div>

      {flash && (
        <div className={`p-3.5 text-xs rounded-xl flex items-center gap-2 border ${
          flash.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {flash.ok ? <Check className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{flash.text}</span>
        </div>
      )}

      {dir.loading ? (
        <LoadingSpinner label="Loading departments…" />
      ) : dir.departments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No departments yet. Create the first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {dir.departments.map((dept) => {
            const head = headOf(dept.id);
            return (
              <div key={dept.id} className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {dept.code}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 font-display mt-2">{dept.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Head: {head ? <strong className="text-slate-700">{head.full_name}</strong> : <span className="text-amber-700 font-semibold">not appointed</span>}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    dept.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {dept.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>Created {formatISTDate(dept.created_at, false)}</span>
                  <button type="button"
                    onClick={async () => {
                      const res = await dir.saveDepartment({ id: dept.id, name: dept.name, code: dept.code, is_active: !dept.is_active });
                      show(res.success ? `${dept.code} ${dept.is_active ? 'deactivated' : 'reactivated'}.` : res.error!, res.success);
                    }}
                    className={`px-3 py-1 rounded-lg font-semibold text-xs border ${
                      dept.is_active
                        ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                        : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    }`}>
                    {dept.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DepartmentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateDepartment={async (data) => {
          const res = await dir.saveDepartment(data);
          if (res.success) show(`Department ${data.name} (${data.code}) created.`);
          return res;
        }}
      />
    </div>
  );
};
