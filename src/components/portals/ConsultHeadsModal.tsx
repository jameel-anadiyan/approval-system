import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, Profile } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { UserAvatar } from '../common/UserAvatar';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { Users, Check, AlertCircle, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface ConsultHeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onSuccess?: () => void;
}

export const ConsultHeadsModal: React.FC<ConsultHeadsModalProps> = ({
  isOpen,
  onClose,
  request,
  onSuccess,
}) => {
  const { user } = useAuth();
  const { loadConsultableHeads, requestHeadConsultations } = useRequests();

  const [heads, setHeads] = useState<Profile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [isLoadingHeads, setIsLoadingHeads] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map of heads already consulted for this request
  const alreadyConsultedMap = new Map<string, string>();
  (request.consultations || []).forEach((c) => {
    alreadyConsultedMap.set(c.head_id, c.status);
  });

  useEffect(() => {
    if (!isOpen) return;
    setIsLoadingHeads(true);
    loadConsultableHeads()
      .then((list) => {
        // Exclude current logged in user from list
        setHeads(list.filter((h) => h.id !== user?.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoadingHeads(false));
  }, [isOpen, loadConsultableHeads, user?.id]);

  const toggleHead = (id: string) => {
    if (alreadyConsultedMap.has(id)) return; // already consulted
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const selectable = heads
      .filter((h) => !alreadyConsultedMap.has(h.id))
      .map((h) => h.id);
    if (selectedIds.length === selectable.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectable);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIds.length) {
      setError('Please select at least one department head to consult.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await requestHeadConsultations(
        request.id,
        selectedIds,
        note.trim() || undefined,
        voice
      );
      if (!res.success) {
        throw new Error(res.error || 'Failed to send consultation requests');
      }
      setSelectedIds([]);
      setNote('');
      setVoice(null);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectableHeads = heads.filter((h) => !alreadyConsultedMap.has(h.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Consult Other Department Heads"
      description={`Request review & agreement from other heads on ${request.request_no || 'this request'}${request.owner_head_name ? ` · Owner Head: ${request.owner_head_name}` : ''}`}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-purple-50 border border-purple-200/80 rounded-xl text-xs text-purple-900 leading-relaxed flex items-start gap-2.5">
          <Users className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Inter-Department Head Review:</span> Selected department heads
            will receive a notification and request in their panel to review this document and indicate
            whether they <strong>Agree</strong> or <strong>Disagree</strong>. Both you and the Admin
            will see their decisions in the request timeline.
          </div>
        </div>

        {/* Head Selection List */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-800">
              Select Department Heads ({selectedIds.length} selected)
            </label>
            {selectableHeads.length > 1 && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {selectedIds.length === selectableHeads.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {isLoadingHeads ? (
            <div className="py-8 flex justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : heads.length === 0 ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
              No other active department heads found in the directory.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 border border-slate-200 rounded-xl">
              {heads.map((head) => {
                const isConsulted = alreadyConsultedMap.has(head.id);
                const consultedStatus = alreadyConsultedMap.get(head.id);
                const isSelected = selectedIds.includes(head.id);

                return (
                  <div
                    key={head.id}
                    onClick={() => !isConsulted && toggleHead(head.id)}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all ${
                      isConsulted
                        ? 'bg-slate-50/70 border-slate-200 opacity-75 cursor-not-allowed'
                        : isSelected
                        ? 'bg-indigo-50/90 border-indigo-300 ring-1 ring-indigo-400 cursor-pointer shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar
                        photoPath={head.photo_path}
                        name={head.full_name}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {head.full_name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {head.department?.name || head.designation || 'Department Head'}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isConsulted ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            consultedStatus === 'agreed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : consultedStatus === 'disagreed'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {consultedStatus === 'agreed' && <CheckCircle2 className="w-3 h-3" />}
                          {consultedStatus === 'disagreed' && <XCircle className="w-3 h-3" />}
                          {consultedStatus === 'pending' && <Clock className="w-3 h-3" />}
                          <span className="capitalize">{consultedStatus}</span>
                        </span>
                      ) : (
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Note / Message */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Note / Specific Question for Other Heads (Optional)
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please verify if your department agrees with this event stall sponsorship & budget allocation..."
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        {/* Audio Record / Voice Note */}
        <div>
          <ActionVoiceField
            onChange={setVoice}
            label="Audio Record / Voice Note for Other Heads (Optional)"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
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
            disabled={isSubmitting || selectedIds.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-md shadow-purple-200 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Users className="w-3.5 h-3.5" />
            )}
            <span>
              Send Request {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
