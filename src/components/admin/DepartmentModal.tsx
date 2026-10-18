import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Building2 } from 'lucide-react';

interface DepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDepartment: (data: { name: string; code: string }) => Promise<{ success: boolean; error?: string }>;
}

export const DepartmentModal: React.FC<DepartmentModalProps> = ({
  isOpen,
  onClose,
  onCreateDepartment,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(cleanCode)) {
      setError('Department code must be 2–10 uppercase letters or numbers (e.g. FIN, OPS, IT).');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onCreateDepartment({
        name: name.trim(),
        code: cleanCode,
      });

      if (res.success) {
        setName('');
        setCode('');
        onClose();
      } else {
        setError(res.error || 'Failed to create department.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Department"
      description="Add an organizational division with its unique routing code."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Department Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Procurement & Supply Chain"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Department Code <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. SCM or FIN"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono uppercase"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">
            Used as prefix in tracking and routing (2-10 alphanumeric characters).
          </span>
        </div>

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
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Create Department</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
