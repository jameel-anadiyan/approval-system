import React, { useState } from 'react';
import { Department } from '../../types/database';
import { MOCK_DEPARTMENTS } from '../../lib/mockData';
import { DepartmentModal } from '../../components/admin/DepartmentModal';
import { Building2, Plus, Check } from 'lucide-react';
import { formatISTDate } from '../../lib/formatters';

export const AdminDepartmentsPage: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>(MOCK_DEPARTMENTS);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateDepartment = async (data: { name: string; code: string }) => {
    const newDept: Department = {
      id: `dept-${data.code.toLowerCase()}-${Date.now()}`,
      name: data.name,
      code: data.code,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setDepartments((prev) => [newDept, ...prev]);
    setSuccessMsg(`Department "${newDept.name} (${newDept.code})" created successfully.`);
    setTimeout(() => setSuccessMsg(null), 4000);
    return { success: true };
  };

  const handleToggleActive = (id: string) => {
    setDepartments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_active: !d.is_active } : d))
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-600" />
            <span>Departments & Cost Centers</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Configure organizational divisions, routing prefixes, and operational activity status.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Department</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Department Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {departments.map((dept) => (
          <div
            key={dept.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {dept.code}
                </span>
                <h3 className="text-base font-bold text-slate-900 font-display mt-2">
                  {dept.name}
                </h3>
              </div>

              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  dept.is_active
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {dept.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Created {formatISTDate(dept.created_at, false)}</span>
              <button
                type="button"
                onClick={() => handleToggleActive(dept.id)}
                className={`px-3 py-1 rounded-lg font-semibold text-xs transition-colors border ${
                  dept.is_active
                    ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                    : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                }`}
              >
                {dept.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <DepartmentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateDepartment={handleCreateDepartment}
      />
    </div>
  );
};
