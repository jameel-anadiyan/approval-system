import React, { useState } from 'react';
import { Store, Save, Loader2, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { RequestRecord } from '../../types/database';
import { useRequests } from '../../context/RequestContext';
import { useExhibitionShops } from './RequestShopField';
import { getExhibitionShopName } from '../../lib/formatters';

interface EditExhibitionShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onSaved?: (shopName: string) => void;
}

export const EditExhibitionShopModal: React.FC<EditExhibitionShopModalProps> = ({
  isOpen,
  onClose,
  request,
  onSaved,
}) => {
  const { updateExhibitionShop } = useRequests();
  const { options, loading } = useExhibitionShops(undefined, request.requester_id);

  const currentShopId = request.details?.conducting_shop_id || '';
  const currentShopLabel = getExhibitionShopName(request);

  const [pickedShopId, setPickedShopId] = useState<string | null>(null);
  const [pickedShopName, setPickedShopName] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveShopId =
    pickedShopId !== null
      ? pickedShopId
      : currentShopId || (options.length === 1 ? options[0].id : '');

  const effectiveShopName =
    pickedShopId !== null
      ? pickedShopName
      : options.find((o) => o.id === effectiveShopId)?.name ||
        request.details?.conducting_shop_name ||
        '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!effectiveShopId) {
      setError('Please select the shop conducting this exhibition / event.');
      return;
    }
    const found = options.find((o) => o.id === effectiveShopId);
    const finalName = found?.name || effectiveShopName.trim();
    if (!finalName) {
      setError('Invalid shop selection.');
      return;
    }

    setBusy(true);
    const res = await updateExhibitionShop(request.id, effectiveShopId, finalName);
    setBusy(false);

    if (!res.success) {
      setError(res.error || 'Could not update the conducting shop.');
      return;
    }

    onSaved?.(finalName);
    onClose();
  };

  const knownShop = options.some((s) => s.id === effectiveShopId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={currentShopLabel === 'Not Assigned' ? 'Assign Conducting Shop' : 'Change Conducting Shop'}
      description="Select the shop conducting this exhibition / event. This updates the request details and the Exhibition Calendar tile."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-3">
          <div>
            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] block">
              Event
            </span>
            <span className="font-bold text-slate-900 block mt-0.5">
              {request.details?.event_name || request.title}
            </span>
          </div>
          <div className="text-right shrink-0">
            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] block">
              Current Shop
            </span>
            <span
              className={`inline-block mt-0.5 px-2 py-0.5 rounded-md font-bold ${
                currentShopLabel === 'Not Assigned'
                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              {currentShopLabel}
            </span>
          </div>
        </div>

        <div>
          <label
            htmlFor="modal-exh-conducting-shop"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-1.5"
          >
            <Store className="w-3.5 h-3.5 text-indigo-600" />
            <span>Shop Conducting Exhibition / Event</span>
            <span className="text-rose-500">*</span>
          </label>

          {loading ? (
            <div className="h-[46px] rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />
          ) : (
            <select
              id="modal-exh-conducting-shop"
              value={effectiveShopId}
              disabled={busy || options.length === 0}
              onChange={(e) => {
                const id = e.target.value;
                const found = options.find((s) => s.id === id);
                setPickedShopId(id);
                setPickedShopName(found?.name || '');
                setError(null);
              }}
              className={`w-full text-sm p-3 rounded-xl border bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden transition-colors disabled:bg-slate-50 ${
                !effectiveShopId ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'
              }`}
            >
              <option value="">
                {options.length === 0
                  ? 'No shops available…'
                  : 'Select shop conducting this exhibition / event…'}
              </option>
              {!knownShop && effectiveShopId && effectiveShopName && (
                <option value={effectiveShopId}>{effectiveShopName}</option>
              )}
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="save-exhibition-shop-btn"
            disabled={busy || loading || options.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save Shop</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
