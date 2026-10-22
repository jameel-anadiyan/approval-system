import React, { useState } from 'react';
import { Globe, Plus, Check, ShieldAlert, Pencil, Users, Search } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useDirectory } from '../../lib/directory';
import { formatISTDate } from '../../lib/formatters';
import type { Region } from '../../types/database';

const RegionModal: React.FC<{
  region: Region | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { id?: string; name: string; code: string; is_active?: boolean }) => Promise<{ success: boolean; error?: string }>;
}> = ({ region, isOpen, onClose, onSave }) => {
  const [name, setName] = useState(region?.name ?? '');
  const [code, setCode] = useState(region?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with prop when opened
  React.useEffect(() => {
    setName(region?.name ?? '');
    setCode(region?.code ?? '');
    setError(null);
  }, [region, isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanCode = code.trim().toUpperCase();
    if (!name.trim()) return setError('Enter the region name.');
    if (!/^[A-Z0-9]{2,10}$/.test(cleanCode)) return setError('Region code must be 2–10 uppercase letters or numbers (e.g. SOU, KER, GCC).');
    setBusy(true);
    const res = await onSave({ id: region?.id, name: name.trim(), code: cleanCode, is_active: region?.is_active ?? true });
    setBusy(false);
    if (res.success) onClose();
    else setError(res.error || 'Could not save the region.');
  };

  const inputCls =
    'w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={region ? 'Edit Region' : 'Add Region'}
      description="Admin Region Master. Regional Heads are assigned to these regions to enforce exhibition booking limits."
      maxWidth="md"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{error}</div>}
        <div>
          <label htmlFor="region-name" className="text-xs font-bold text-slate-700 block mb-1">
            Region Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="region-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. South Region, Kerala, UAE & GCC"
            className={inputCls}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="region-code" className="text-xs font-bold text-slate-700 block mb-1">
            Region Code <span className="text-rose-500">*</span>
          </label>
          <input
            id="region-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. SOU, KER, GCC"
            className={`${inputCls} font-mono uppercase`}
          />
          <p className="text-[11px] text-slate-400 mt-1">2 to 10 alphanumeric characters.</p>
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
            disabled={busy}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors shadow-xs disabled:opacity-50"
          >
            {busy ? 'Saving…' : region ? 'Save Changes' : 'Create Region'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const AdminRegionsPage: React.FC = () => {
  const { regions, users, loading, saveRegion, setRegionActive } = useDirectory();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Region | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const showFlash = (text: string, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 4000);
  };

  const filtered = regions.filter(
    (r) =>
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      r.code.toLowerCase().includes(query.toLowerCase())
  );

  const regionalHeadsByRegion = (regionId: string) => {
    return users.filter((u) => u.role === 'regional_head' && u.region_id === regionId);
  };

  const handleToggle = async (r: Region) => {
    setBusyId(r.id);
    const res = await setRegionActive(r.id, !r.is_active);
    setBusyId(null);
    showFlash(
      res.success
        ? `${r.name} (${r.code}) is now ${r.is_active ? 'inactive' : 'active'}.`
        : res.error || 'Failed to update region status',
      res.success
    );
  };

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <LoadingSpinner label="Loading Region Master…" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Globe className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight font-display">
              Region Master
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
              Admin Only
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
            Configure enterprise regions. When creating a Regional Head, their region is selected from here to manage daily exhibition request quotas (2 per day per regional head in a region).
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Region</span>
        </button>
      </div>

      {flash && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
            flash.ok
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {flash.ok ? <Check className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-rose-600" />}
          <span>{flash.text}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search regions by name or code…"
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
        />
      </div>

      {/* Grid of Regions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((region) => {
          const assignedHeads = regionalHeadsByRegion(region.id);
          return (
            <div
              key={region.id}
              className={`p-4 rounded-2xl border transition-all bg-white flex flex-col justify-between ${
                region.is_active ? 'border-slate-200/80 shadow-xs hover:border-slate-300' : 'border-slate-200/50 bg-slate-50/50 opacity-70'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                      {region.code}
                    </span>
                    <h3 className="font-bold text-slate-900 text-sm mt-1.5 truncate">{region.name}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(region);
                      setModalOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Edit Region"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    <strong>{assignedHeads.length}</strong> Regional Head{assignedHeads.length === 1 ? '' : 's'} assigned
                  </span>
                </div>

                {assignedHeads.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {assignedHeads.map((rh) => (
                      <span
                        key={rh.id}
                        className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium"
                      >
                        {rh.full_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">Created: {formatISTDate(region.created_at)}</span>
                <button
                  type="button"
                  disabled={busyId === region.id}
                  onClick={() => handleToggle(region)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    region.is_active
                      ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                      : 'border-slate-200 text-slate-500 bg-slate-100 hover:bg-slate-200'
                  }`}
                >
                  {region.is_active ? 'Active' : 'Inactive'}
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200">
            <Globe className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No regions found</p>
            <p className="text-xs text-slate-400 mt-1">
              {query ? 'No regions matched your search filter.' : 'Click "Add Region" above to create your first region.'}
            </p>
          </div>
        )}
      </div>

      <RegionModal
        isOpen={modalOpen}
        region={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={saveRegion}
      />
    </div>
  );
};

export default AdminRegionsPage;
