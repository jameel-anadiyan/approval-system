import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { RequestRecord, ApprovalRoute } from '../../types/database';
import { formatINR, formatINRWhole } from '../../lib/formatters';
import { useRequests } from '../../context/RequestContext';
import { ShieldAlert, ArrowRight, UserCheck, ShieldCheck } from 'lucide-react';

interface RouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: RequestRecord;
  onRoute: (route: ApprovalRoute, remarks?: string) => Promise<void>;
}

export const RouteModal: React.FC<RouteModalProps> = ({
  isOpen,
  onClose,
  request,
  onRoute,
}) => {
  const [selectedRoute, setSelectedRoute] = useState<ApprovalRoute>('A');
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { threshold } = useRequests();
  const isHighValue = request.amount > threshold;
  const limit = formatINRWhole(threshold);
  const isRequesterHead = request.requester_role === 'head';

  const isRouteBDisabled = isHighValue || isRequesterHead;

  // Auto-select Route A if B is disabled
  React.useEffect(() => {
    if (isRouteBDisabled) {
      setSelectedRoute('A');
    }
  }, [isRouteBDisabled]);

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onRoute(selectedRoute, remarks);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Route Request for Approval"
      description={`Select the approval route for request ${request.request_no || ''}`}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Request Summary Banner */}
        <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Amount:</span>
            <span className="font-bold text-slate-900 text-sm font-display">
              {formatINR(request.amount)}
            </span>
          </div>
          <div className="text-xs font-semibold text-slate-800 line-clamp-1">
            {request.title}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Requester: {request.requester_name} ({request.requester_role})
          </div>
        </div>

        {/* High-value threshold notice */}
        {isHighValue && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">High Value Policy Rule:</span>
              <p className="mt-0.5 text-amber-800 leading-relaxed">
                Since the requested amount exceeds {limit}, this request must be routed via{' '}
                <strong>Route A</strong> for Department Head review and final Administrator sign-off.
              </p>
            </div>
          </div>
        )}

        {isRequesterHead && (
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-start gap-2.5 text-xs text-purple-900">
            <UserCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Head's Own Request:</span>
              <p className="mt-0.5 text-purple-800 leading-relaxed">
                A Department Head cannot approve their own expense. Automatically directed to Admin.
              </p>
            </div>
          </div>
        )}

        {/* Route Selection Options */}
        <div className="space-y-2.5">
          <label className="text-xs font-bold text-slate-700 block">Choose Route</label>

          {/* Route A Option */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
              selectedRoute === 'A'
                ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-100'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <input
              type="radio"
              name="route"
              value="A"
              checked={selectedRoute === 'A'}
              onChange={() => setSelectedRoute('A')}
              className="mt-1 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">Route A — Admin Sign-off</span>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700">
                  {isHighValue ? 'Mandatory' : 'Standard'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Reviewed by Department Head, then forwarded to Admin for official seal & digital signature.
              </p>
            </div>
          </label>

          {/* Route B Option */}
          <label
            className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all ${
              isRouteBDisabled
                ? 'opacity-50 cursor-not-allowed bg-slate-100/70 border-slate-200'
                : selectedRoute === 'B'
                ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-100 cursor-pointer'
                : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name="route"
              value="B"
              disabled={isRouteBDisabled}
              checked={selectedRoute === 'B'}
              onChange={() => setSelectedRoute('B')}
              className="mt-1 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">Route B — Head Direct Approval</span>
                {isRouteBDisabled ? (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600">
                    {isRequesterHead ? 'Not allowed' : `Disabled (> ${limit})`}
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700">
                    Fast-track
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Department Head approves directly with their official seal and signature (for requests ≤ {limit}).
              </p>
            </div>
          </label>
        </div>

        {/* Remarks Input */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">
            Clerk Routing Remarks (Optional)
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add notes for the reviewer or approver…"
            className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-hidden"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">{error}</div>
        )}

        {/* Actions */}
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
            <span>Confirm & Route</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </Modal>
  );
};
