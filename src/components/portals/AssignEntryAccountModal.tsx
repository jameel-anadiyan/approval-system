import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Profile, RequestRecord } from '../../types/database';
import { useDirectory } from '../../lib/directory';
import { useRequests } from '../../context/RequestContext';
import { errMsg } from '../../lib/errorUtils';
import { UserCheck, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface AssignEntryAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
}

export const AssignEntryAccountModal: React.FC<AssignEntryAccountModalProps> = ({
  isOpen,
  onClose,
  request,
}) => {
  const { users } = useDirectory();
  const { assignDisbursementEntryUser } = useRequests();

  // Active Entry Only disbursement officers
  const entryOfficers = users.filter(
    (u) =>
      u.is_active &&
      (u.role === 'admin' || (u.role === 'disbursement' && (u.disbursement_type === 'entry_only' || !u.disbursement_type)))
  );

  const [selectedUserId, setSelectedUserId] = useState<string>(
    request.assigned_entry_user_id || (entryOfficers[0]?.id ?? '')
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeEntriesCount = (request.disbursement_entries || []).filter((e) => e.status !== 'cancelled').length;
  const isLocked = activeEntriesCount > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) {
      setError('Cannot change entry account: entries have already been created.');
      return;
    }
    if (!selectedUserId) {
      setError('Please select an entry-only disbursement account.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await assignDisbursementEntryUser(request.id, selectedUserId);
      if (!res.success) {
        throw new Error(res.error || 'Failed to assign entry account');
      }
      onClose();
    } catch (err: unknown) {
      setError(errMsg(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign Disbursement Entry Account"
      description={`Choose which Entry Only account creates entries for request ${request.request_no || ''}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isLocked ? (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Selection Locked:</span>
              <p className="mt-0.5 text-amber-800">
                Disbursement entries have already been created for this request. The assigned Entry Only account cannot be changed anymore.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 leading-relaxed">
            <span className="font-bold">Routing Rule:</span> Only the selected Entry Only account will receive and record payment entries for this request. You can change this selection at any time before the first entry is created.
          </div>
        )}

        <div>
          <label htmlFor="assign-entry-user" className="text-xs font-bold text-slate-700 block mb-1">
            Disbursement Entry Only Account <span className="text-rose-500">*</span>
          </label>
          <select
            id="assign-entry-user"
            required
            disabled={isLocked || isSubmitting}
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="">Select Entry Only Officer…</option>
            {entryOfficers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} (@{u.username})
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          {!isLocked && (
            <button
              type="submit"
              disabled={isSubmitting || !selectedUserId}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Saving…' : 'Save Assignment'}</span>
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
};
