import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { Profile } from '../../types/database';
import { DisbursementPerson, useDirectory } from '../../lib/directory';
import { Users, KeyRound, Plus, Pencil, Check, X, ShieldAlert, UserCheck, UserX, Loader2 } from 'lucide-react';

interface DisbursementPersonsModalProps {
  account: Profile;
  onClose: () => void;
  dir: ReturnType<typeof useDirectory>;
  onNotify?: (msg: string) => void;
}

export const DisbursementPersonsModal: React.FC<DisbursementPersonsModalProps> = ({
  account,
  onClose,
  dir,
  onNotify,
}) => {
  const [persons, setPersons] = useState<DisbursementPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add person form
  const [newName, setNewName] = useState('');
  const [newPasskey, setNewPasskey] = useState('');
  const [adding, setAdding] = useState(false);

  // Reset passkey inline state
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPasskey, setResetPasskey] = useState('');
  const [resetting, setResetting] = useState(false);

  // Rename inline state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Action busy states
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadPersons = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await dir.listDisbursementPersons(account.id);
      setPersons(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load authorized persons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPersons();
  }, [account.id]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = newName.trim();
    if (!cleanName) {
      setError('Please enter a person name.');
      return;
    }
    if (!/^\d{4}$/.test(newPasskey)) {
      setError('Passkey must be exactly 4 digits.');
      return;
    }

    const nameExists = persons.some(
      (p) => p.person_name.toLowerCase() === cleanName.toLowerCase()
    );
    if (nameExists) {
      setError(`A person named "${cleanName}" already exists on this account.`);
      return;
    }

    setAdding(true);
    try {
      const res = await dir.addDisbursementPerson(account.id, cleanName, newPasskey);
      if (res.success) {
        setNewName('');
        setNewPasskey('');
        onNotify?.(`Added ${cleanName} with 4-digit passkey.`);
        await loadPersons();
      } else {
        setError(res.error || 'Failed to add person.');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleResetPasskey = async (person: DisbursementPerson) => {
    setError(null);
    if (!/^\d{4}$/.test(resetPasskey)) {
      setError('New passkey must be exactly 4 digits.');
      return;
    }
    setResetting(true);
    try {
      const res = await dir.updateDisbursementPerson(person.id, undefined, resetPasskey);
      if (res.success) {
        setResetId(null);
        setResetPasskey('');
        onNotify?.(`Passkey updated for ${person.person_name}.`);
        await loadPersons();
      } else {
        setError(res.error || 'Failed to reset passkey.');
      }
    } finally {
      setResetting(false);
    }
  };

  const handleRename = async (person: DisbursementPerson) => {
    setError(null);
    const clean = editName.trim();
    if (!clean) {
      setError('Name cannot be empty.');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await dir.updateDisbursementPerson(person.id, clean);
      if (res.success) {
        setEditId(null);
        setEditName('');
        onNotify?.(`Person renamed to ${clean}.`);
        await loadPersons();
      } else {
        setError(res.error || 'Failed to rename person.');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (person: DisbursementPerson) => {
    setError(null);
    setTogglingId(person.id);
    try {
      const res = await dir.updateDisbursementPerson(person.id, undefined, undefined, !person.is_active);
      if (res.success) {
        onNotify?.(`${person.person_name} has been ${person.is_active ? 'deactivated' : 'activated'}.`);
        await loadPersons();
      } else {
        setError(res.error || 'Failed to update person status.');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = persons.filter((p) => p.is_active).length;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Disbursement Account Persons & Passkeys"
      description={`Manage the authorized individuals who share login credentials for @${account.username}. Each person stamps actions using their unique 4-digit passkey.`}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Account Info Pill */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-sky-50 border border-sky-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold text-xs font-display">
              {account.full_name?.charAt(0) || 'D'}
            </div>
            <div>
              <p className="text-xs font-bold text-sky-950">{account.full_name}</p>
              <p className="text-[11px] text-sky-800/80 font-mono">@{account.username}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-100 text-sky-800 border border-sky-200">
              {account.disbursement_type === 'entry_only'
                ? 'Entry Only'
                : account.disbursement_type === 'payment_only'
                ? 'Payment Only'
                : 'All in One'}
            </span>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {activeCount} active authorized {activeCount === 1 ? 'person' : 'people'}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Add Person Card */}
        <form onSubmit={handleAdd} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Plus className="w-3.5 h-3.5 text-sky-600" />
            <span>Add New Authorized Person</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div className="sm:col-span-7">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Person Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                4-Digit Passkey <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                value={newPasskey}
                onChange={(e) => setNewPasskey(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="w-full text-xs font-mono font-bold tracking-widest text-center px-2 py-2 rounded-xl border border-slate-200 bg-white focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-hidden"
              />
            </div>
            <div className="sm:col-span-2 flex items-end">
              <button
                type="submit"
                disabled={adding || !newName.trim() || newPasskey.length !== 4}
                className="w-full h-[38px] inline-flex items-center justify-center gap-1 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                <span>Add</span>
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-400">
            Passkeys are securely hashed with SHA-256 and never stored or visible in plain text.
          </p>
        </form>

        {/* Persons List */}
        <div>
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2">
            <Users className="w-3.5 h-3.5 text-slate-500" />
            <span>Authorized People on this Account</span>
          </label>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              <span>Loading authorized persons...</span>
            </div>
          ) : persons.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
              No authorized persons found. Add at least one person above so staff can enter their 4-digit passkey.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
              {persons.map((person) => {
                const isEditing = editId === person.id;
                const isResetting = resetId === person.id;

                return (
                  <div
                    key={person.id}
                    className={`p-3 rounded-xl border transition-all ${
                      person.is_active
                        ? 'bg-white border-slate-200 hover:border-slate-300'
                        : 'bg-slate-50/70 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* Name or Edit Name */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              autoFocus
                              className="text-xs font-semibold px-2 py-1 rounded-lg border border-sky-400 outline-hidden w-full max-w-xs"
                            />
                            <button
                              type="button"
                              disabled={savingEdit || !editName.trim()}
                              onClick={() => handleRename(person)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                              title="Save name"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditId(null);
                                setEditName('');
                              }}
                              className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800">{person.person_name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditId(person.id);
                                setEditName(person.person_name);
                              }}
                              className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 cursor-pointer"
                              title="Edit name"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                person.is_active
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-500 border border-slate-200'
                              }`}
                            >
                              {person.is_active ? 'Active' : 'Deactivated'}
                            </span>
                          </div>
                        )}
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Added {new Date(person.created_at).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (isResetting) {
                              setResetId(null);
                              setResetPasskey('');
                            } else {
                              setResetId(person.id);
                              setResetPasskey('');
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                            isResetting
                              ? 'bg-amber-50 text-amber-700 border-amber-300'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                          <span>{isResetting ? 'Cancel Reset' : 'Reset Passkey'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={togglingId === person.id}
                          onClick={() => handleToggleActive(person)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                            person.is_active
                              ? 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                          }`}
                        >
                          {person.is_active ? (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              <span>Deactivate</span>
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Activate</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Inline Reset Passkey Form */}
                    {isResetting && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 flex items-center gap-2 bg-amber-50/50 p-2 rounded-lg">
                        <span className="text-[11px] font-semibold text-amber-900 shrink-0">
                          New 4-Digit Passkey:
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{4}"
                          maxLength={4}
                          autoFocus
                          value={resetPasskey}
                          onChange={(e) => setResetPasskey(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="••••"
                          className="w-24 text-xs font-mono font-bold tracking-widest text-center px-2 py-1 rounded-md border border-amber-300 bg-white focus:border-amber-500 outline-hidden"
                        />
                        <button
                          type="button"
                          disabled={resetting || resetPasskey.length !== 4}
                          onClick={() => handleResetPasskey(person)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 cursor-pointer shadow-2xs"
                        >
                          {resetting ? 'Saving...' : 'Save New Passkey'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
