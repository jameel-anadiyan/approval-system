import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, ApprovalRoute } from '../../types/database';
import { formatINR, formatINRWhole, TYPE_LABELS, typeOf } from '../../lib/formatters';
import { errMsg } from '../../lib/errorUtils';
import { useRequests, ActionVoice } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { canHeadChangeRouteToB } from '../../lib/workflow';
import { ActionVoiceField } from '../requests/ActionVoiceField';
import { ArrowLeftRight, ArrowRight, ShieldAlert, CheckCircle2, Clock } from 'lucide-react';

interface ChangeRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onChangeRoute: (
    newRoute: ApprovalRoute,
    remarks?: string,
    voice?: ActionVoice | null
  ) => Promise<void>;
}

export const ChangeRouteModal: React.FC<ChangeRouteModalProps> = ({
  isOpen,
  onClose,
  request,
  onChangeRoute,
}) => {
  const { user } = useAuth();
  const { threshold } = useRequests();
  const type = typeOf(request);
  const limit = formatINRWhole(threshold);

  const currentRoute: ApprovalRoute =
    request.status === 'pending_head_approval' ? 'B' : 'A';
  const defaultTargetRoute: ApprovalRoute = currentRoute === 'B' ? 'A' : 'B';

  const [selectedRoute, setSelectedRoute] = useState<ApprovalRoute>(defaultTargetRoute);
  const [remarks, setRemarks] = useState('');
  const [voice, setVoice] = useState<ActionVoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSwitchToB =
    currentRoute === 'B'
      ? true
      : canHeadChangeRouteToB(request, user, threshold);

  const isHighValue =
    type !== 'discount' &&
    type !== 'stock_transfer' &&
    type !== 'non_cash' &&
    request.amount > threshold;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoute === currentRoute) return;
    if (selectedRoute === 'B' && !canSwitchToB) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onChangeRoute(selectedRoute, remarks.trim() || undefined, voice);
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
      title="Change Approval Route"
      description={`Request ${request.request_no || ''} · Currently on Route ${currentRoute}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Request Summary Banner */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>{type === 'stock_transfer' ? 'Total MRP:' : 'Amount:'}</span>
            <span className="font-bold text-slate-900 text-sm font-display">
              {type === 'non_cash' ? 'Non Cash' : formatINR(request.amount)}
            </span>
          </div>
          <div className="text-xs font-semibold text-slate-800 line-clamp-1">
            {request.title}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center justify-between gap-2 flex-wrap">
            <span>
              {TYPE_LABELS[type]} · Requester: {request.requester_name} ({request.requester_role})
              {request.shop_name ? ` · ${request.shop_name}` : ''}
            </span>
            <span
              className={`font-bold px-2 py-0.5 rounded-md border text-[10px] ${
                currentRoute === 'B'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              Current: Route {currentRoute}
            </span>
          </div>
        </div>

        {/* Workflow Transition Preview */}
        {selectedRoute === 'A' && currentRoute === 'B' && (
          <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2 text-xs text-blue-950">
            <div className="font-bold flex items-center gap-2 text-blue-900">
              <ArrowLeftRight className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Switching Route B → Route A (Admin Approval)</span>
            </div>
            <p className="text-blue-800 leading-relaxed">
              This request will move from <strong>To Approve (Route B)</strong> into your{' '}
              <strong>To Review (Route A)</strong> tab. From there, you can review and forward it to{' '}
              <strong>Admin</strong> for final approval and digital signature.
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 pt-0.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800">
                To Approve (Route B)
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-blue-500" />
              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 flex items-center gap-1">
                <Clock className="w-3 h-3" /> To Review (Route A)
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-blue-500" />
              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900">
                Forward to Admin
              </span>
            </div>
          </div>
        )}

        {selectedRoute === 'B' && currentRoute === 'A' && canSwitchToB && (
          <div className="p-3.5 bg-purple-50/80 border border-purple-200 rounded-xl space-y-1.5 text-xs text-purple-950">
            <div className="font-bold flex items-center gap-2 text-purple-900">
              <ArrowLeftRight className="w-4 h-4 text-purple-600 shrink-0" />
              <span>Switching Route A → Route B (Direct Head Approval)</span>
            </div>
            <p className="text-purple-800 leading-relaxed">
              This request will move from <strong>To Review (Route A)</strong> into your{' '}
              <strong>To Approve (Route B)</strong> tab so you can approve and sign it directly.
            </p>
          </div>
        )}

        {/* Route Selection Options */}
        <div className="space-y-2.5">
          <label className="text-xs font-bold text-slate-700 block">Select Target Route</label>

          {/* Route A Option */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all ${
              currentRoute === 'A'
                ? 'opacity-60 cursor-not-allowed bg-slate-50 border-slate-200'
                : selectedRoute === 'A'
                ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-100 cursor-pointer'
                : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name="head-change-route"
              value="A"
              disabled={currentRoute === 'A'}
              checked={selectedRoute === 'A'}
              onChange={() => setSelectedRoute('A')}
              className="mt-1 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-900 text-sm">
                  Route A — Move to &ldquo;To Review&rdquo; (Admin Approval)
                </span>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700">
                  {currentRoute === 'A' ? 'Current Route' : 'Recommended for Escalation'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Places request in your <strong>To Review (Route A)</strong> queue so you can forward it to Admin for final sign-off.
              </p>
            </div>
          </label>

          {/* Route B Option */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all ${
              currentRoute === 'B' || !canSwitchToB
                ? 'opacity-60 cursor-not-allowed bg-slate-50 border-slate-200'
                : selectedRoute === 'B'
                ? 'border-purple-600 bg-purple-50/50 ring-2 ring-purple-100 cursor-pointer'
                : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name="head-change-route"
              value="B"
              disabled={currentRoute === 'B' || !canSwitchToB}
              checked={selectedRoute === 'B'}
              onChange={() => setSelectedRoute('B')}
              className="mt-1 text-purple-600 focus:ring-purple-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-900 text-sm">
                  Route B — Move to &ldquo;To Approve&rdquo; (Head Direct Approval)
                </span>
                {currentRoute === 'B' ? (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700">
                    Current Route
                  </span>
                ) : !canSwitchToB ? (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600">
                    {type === 'exhibition'
                      ? 'Exhibition requires Route A'
                      : isHighValue
                      ? `Disabled (> ${limit})`
                      : 'Not eligible'}
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Direct Sign
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Places request in your <strong>To Approve (Route B)</strong> queue for direct Head seal & signature
                {type === 'discount' || type === 'stock_transfer' || type === 'non_cash'
                  ? '.'
                  : ` (allowed up to ${limit}).`}
              </p>
            </div>
          </label>
        </div>

        {currentRoute === 'A' && !canSwitchToB && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Route B Restricted:</span>{' '}
              {type === 'exhibition'
                ? 'Exhibition requests require Administrator approval and must stay on Route A.'
                : isHighValue
                ? `Requests above ${limit} require Administrator approval and cannot be switched to Route B.`
                : 'This request must remain on Route A.'}
            </div>
          </div>
        )}

        {/* Remarks Input */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Route Change Remarks (Optional)
          </label>
          <textarea
            id="head-change-route-remarks"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              selectedRoute === 'A'
                ? 'e.g. Escalating to Route A so this request can be reviewed and forwarded to Admin…'
                : 'Add optional remarks for changing route…'
            }
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        <ActionVoiceField onChange={setVoice} label="Voice note (optional)" />

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="confirm-head-change-route-btn"
            disabled={isSubmitting || selectedRoute === currentRoute || (selectedRoute === 'B' && !canSwitchToB)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md shadow-indigo-200 transition-all disabled:opacity-50 cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>
              {isSubmitting
                ? 'Updating Route…'
                : `Change to Route ${selectedRoute}`}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
