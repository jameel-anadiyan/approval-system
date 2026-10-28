import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, PackageCheck, PackageSearch, Truck, Layers, ListOrdered, Download, ChevronDown, ChevronUp,
  Scale, IndianRupee, Boxes, CheckCircle2, Clock, BarChart3, UserCheck, Eye,
} from 'lucide-react';
import { useRequests } from '../../context/RequestContext';
import { useAuth } from '../../context/AuthContext';
import { RequestFilters, useRequestFilters } from '../../components/requests/RequestFilters';
import { EmptyState } from '../../components/common/EmptyState';
import { CompleteTransferModal } from '../../components/portals/CompleteTransferModal';
import { SignedDocPreviewModal } from '../../components/requests/SignedDocPreviewModal';
import { formatINR, formatISTDate } from '../../lib/formatters';
import { downloadSignedPacket } from '../../lib/files';
import { canViewStockTransferReport } from '../../lib/stockTransferReport';
import type { RequestRecord } from '../../types/database';

type Tab = 'pending' | 'completed';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const transferStats = (r: RequestRecord) => {
  const d = r.details || {};
  return {
    pieces: num(d.total_pieces ?? d.pieces_count),
    weight: num(d.total_gross_weight),
    mrp: num(d.total_mrp ?? r.amount),
  };
};

/** Stock Transfer Monitor account (and Admin): approved transfers, split into pending and completed. */
export const StockTransferMonitorPage: React.FC = () => {
  const { requests, markTransferComplete } = useRequests();
  const { user, isBackendConnected } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const tabFromPath = (): Tab => (location.pathname.endsWith('/completed') ? 'completed' : 'pending');
  const [tab, setTab] = useState<Tab>(tabFromPath);
  const [target, setTarget] = useState<RequestRecord | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewSignedDoc, setPreviewSignedDoc] = useState<{
    path: string;
    name: string;
    approvalNo?: string | null;
  } | null>(null);

  useEffect(() => setTab(tabFromPath()), [location.pathname]);

  const approved = useMemo(
    () => requests.filter((r) => r.request_type === 'stock_transfer' && r.status === 'approved'),
    [requests]
  );
  const pendingList = useMemo(() => approved.filter((r) => !r.transfer_completed_at), [approved]);
  const completedList = useMemo(() => approved.filter((r) => !!r.transfer_completed_at), [approved]);
  const current = tab === 'pending' ? pendingList : completedList;

  const { filters, setFilters, result } = useRequestFilters(current, { sort: tab === 'pending' ? 'oldest' : 'newest' });
  useEffect(() => {
    setFilters((f) => ({ ...f, sort: tab === 'pending' ? 'oldest' : 'newest' }));
  }, [tab]);

  const sorted = useMemo(() => {
    if (tab !== 'completed') return result;
    return [...result].sort((a, b) => (b.transfer_completed_at || '').localeCompare(a.transfer_completed_at || ''));
  }, [result, tab]);

  const pendingTotals = useMemo(
    () =>
      pendingList.reduce(
        (acc, r) => {
          const s = transferStats(r);
          return { pieces: acc.pieces + s.pieces, weight: acc.weight + s.weight, mrp: acc.mrp + s.mrp };
        },
        { pieces: 0, weight: 0, mrp: 0 }
      ),
    [pendingList]
  );

  const switchTab = (t: Tab) => {
    setTab(t);
    navigate(t === 'completed' ? '/stock-transfers/completed' : '/stock-transfers', { replace: true });
  };

  const handleDownload = async (req: RequestRecord) => {
    setNotice(null);
    const res = await downloadSignedPacket(req, isBackendConnected);
    if (!res.success) setNotice({ ok: false, text: res.error || 'Download failed' });
  };

  return (
    <div className="max-w-5xl mx-auto px-1 sm:px-4 py-4 sm:py-8 space-y-6 pb-24">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl p-5 sm:p-7 text-white bg-gradient-to-br from-blue-700 via-indigo-700 to-slate-900 shadow-xl shadow-indigo-200/60">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute right-24 bottom-0 w-32 h-32 rounded-full bg-emerald-300/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/15 border border-white/20 px-2.5 py-1 rounded-full">
              <Truck className="w-3 h-3" /> Stock Transfer Monitor
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-display mt-2">Stock Transfers</h1>
            <p className="text-xs sm:text-sm text-blue-100 mt-1 max-w-lg">
              Approved shop-to-shop transfers. Mark each one complete once the stock reaches the destination shop.
            </p>
          </div>
          {canViewStockTransferReport(user) && (
            <button
              type="button"
              id="open-stock-transfer-report"
              onClick={() => navigate('/reports/stock-transfers')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-800 hover:bg-indigo-50 font-bold text-xs shadow-md self-start sm:self-auto transition-colors"
            >
              <BarChart3 className="w-4 h-4" /> Transfer Report
            </button>
          )}
        </div>

        <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <HeroStat icon={<Clock className="w-3.5 h-3.5" />} label="Pending transfer" value={String(pendingList.length)} />
          <HeroStat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Completed" value={String(completedList.length)} />
          <HeroStat icon={<Boxes className="w-3.5 h-3.5" />} label="Pieces pending" value={String(pendingTotals.pieces)} />
          <HeroStat icon={<IndianRupee className="w-3.5 h-3.5" />} label="MRP in transit" value={formatINR(pendingTotals.mrp)} />
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
            notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold opacity-60 hover:opacity-100" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-100 border border-slate-200 w-full sm:w-fit">
        <TabButton
          id="tab-transfer-pending"
          active={tab === 'pending'}
          onClick={() => switchTab('pending')}
          icon={<PackageSearch className="w-4 h-4" />}
          label="Not Completed"
          count={pendingList.length}
          tone="amber"
        />
        <TabButton
          id="tab-transfer-completed"
          active={tab === 'completed'}
          onClick={() => switchTab('completed')}
          icon={<PackageCheck className="w-4 h-4" />}
          label="Transfer Completed"
          count={completedList.length}
          tone="emerald"
        />
      </div>

      <RequestFilters value={filters} onChange={setFilters} source={current} resultCount={sorted.length} />

      {sorted.length === 0 ? (
        <EmptyState
          icon={tab === 'pending' ? PackageSearch : PackageCheck}
          title={filters.q ? 'No matching transfers' : tab === 'pending' ? 'No transfers waiting' : 'No completed transfers yet'}
          description={
            filters.q
              ? 'Try a different request number, shop or employee name.'
              : tab === 'pending'
              ? 'Approved stock transfers that still need to be completed will appear here.'
              : 'Transfers you mark as completed will be listed here.'
          }
        />
      ) : (
        <div className="space-y-4">
          {sorted.map((req) => {
            const d = req.details || {};
            const s = transferStats(req);
            const items = Array.isArray(d.items) ? d.items : [];
            const isOpen = !!expanded[req.id];
            const done = !!req.transfer_completed_at;
            return (
              <article
                key={req.id}
                className={`group bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition-all ${
                  done ? 'border-emerald-200/90' : 'border-slate-200/90 hover:border-blue-300 hover:shadow-md'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`/requests/${req.id}`)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        {req.approval_no || req.request_no}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                        {d.transfer_mode === 'bulk' ? <Layers className="w-3 h-3" /> : <ListOrdered className="w-3 h-3" />}
                        {d.transfer_mode === 'bulk' ? 'Bulk' : 'Itemized'}
                      </span>
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300">
                          <PackageCheck className="w-3 h-3" /> Transfer Completed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
                          <Clock className="w-3 h-3" /> Awaiting Transfer
                        </span>
                      )}
                    </div>

                    {/* Route */}
                    <div className="mt-3 flex items-center gap-2 sm:gap-3">
                      <ShopPill label="From" name={d.from_shop_name || '—'} />
                      <div className="w-7 h-7 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm group-hover:translate-x-0.5 transition-transform">
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                      <ShopPill label="To" name={d.to_shop_name || '—'} />
                    </div>

                    <div className="text-xs text-slate-500 mt-2.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
                      <span>
                        Requested by <strong className="text-slate-700">{req.requester_name}</strong>
                      </span>
                      <span>Approved {formatISTDate(req.decided_at, false)}</span>
                      {req.approver_name && <span>by {req.approver_name}</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:w-64 shrink-0">
                    <MiniStat icon={<Boxes className="w-3 h-3" />} label="Pieces" value={String(s.pieces)} />
                    <MiniStat icon={<Scale className="w-3 h-3" />} label="Gross" value={`${s.weight} g`} />
                    <MiniStat icon={<IndianRupee className="w-3 h-3" />} label="MRP" value={formatINR(s.mrp)} small />
                  </div>
                </div>

                {done && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      Completed by <strong>{req.transfer_completed_by_name || '—'}</strong> on{' '}
                      {formatISTDate(req.transfer_completed_at)}
                      {req.transfer_completed_remarks && (
                        <span className="block text-emerald-800/90 mt-0.5 break-words">“{req.transfer_completed_remarks}”</span>
                      )}
                    </div>
                  </div>
                )}

                {isOpen && items.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2 font-bold">#</th>
                          <th className="text-left px-3 py-2 font-bold">Barcode</th>
                          <th className="text-left px-3 py-2 font-bold">SKU</th>
                          <th className="text-left px-3 py-2 font-bold">Category</th>
                          <th className="text-right px-3 py-2 font-bold">Gross (g)</th>
                          <th className="text-right px-3 py-2 font-bold">MRP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((it, i) => (
                          <tr key={`${it.barcode}-${i}`}>
                            <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{it.barcode}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{it.sku}</td>
                            <td className="px-3 py-2 text-slate-600">{it.category_name || '—'}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{num(it.gross_weight)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatINR(num(it.mrp))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isOpen && items.length === 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Bulk transfer · {s.pieces} pieces{d.category_name ? ` · ${d.category_name}` : ' · Mixed categories'}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [req.id]: !e[req.id] }))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {isOpen ? 'Hide products' : items.length ? `Show ${items.length} product${items.length === 1 ? '' : 's'}` : 'Show details'}
                  </button>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      const packet = (req.signed_files || []).find((s) => s.is_packet) || (req.signed_files || [])[0];
                      if (!packet) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewSignedDoc({
                              path: packet.storage_path,
                              name: packet.file_name || `${req.approval_no || req.request_no}_packet.pdf`,
                              approvalNo: req.approval_no,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-xs transition-colors cursor-pointer"
                          title="Preview official approved signed document"
                        >
                          <Eye className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Preview Approved Doc</span>
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => handleDownload(req)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Signed PDF
                    </button>
                    {!done && (
                      <button
                        type="button"
                        id={`mark-transfer-complete-${req.id}`}
                        onClick={() => setTarget(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 transition-all active:scale-95 cursor-pointer"
                      >
                        <PackageCheck className="w-4 h-4" /> Mark Transfer Complete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {target && (
        <CompleteTransferModal
          isOpen
          request={target}
          onClose={() => setTarget(null)}
          onConfirm={async (remarks) => {
            const res = await markTransferComplete(target.id, remarks);
            if (res.success) {
              setNotice({ ok: true, text: `${target.approval_no || target.request_no} marked as Transfer Completed.` });
            }
            return res;
          }}
        />
      )}

      {/* Signed Document Preview Modal */}
      <SignedDocPreviewModal
        isOpen={Boolean(previewSignedDoc)}
        onClose={() => setPreviewSignedDoc(null)}
        storagePath={previewSignedDoc?.path || null}
        fileName={previewSignedDoc?.name || 'signed_approval.pdf'}
        approvalNo={previewSignedDoc?.approvalNo}
      />
    </div>
  );
};

const HeroStat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-2xl bg-white/10 border border-white/15 backdrop-blur-sm p-3 min-w-0">
    <span className="text-[10px] uppercase tracking-wider font-bold text-blue-100 flex items-center gap-1">
      {icon} {label}
    </span>
    <span className="text-lg sm:text-xl font-extrabold font-display block truncate mt-0.5">{value}</span>
  </div>
);

const TabButton: React.FC<{
  id: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: 'amber' | 'emerald';
}> = ({ id, active, onClick, icon, label, count, tone }) => (
  <button
    type="button"
    id={id}
    onClick={onClick}
    className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
      active
        ? tone === 'amber'
          ? 'bg-white text-amber-800 shadow-sm ring-1 ring-amber-200'
          : 'bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-200'
        : 'text-slate-500 hover:text-slate-800'
    }`}
  >
    {icon}
    <span>{label}</span>
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${
        active ? (tone === 'amber' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white') : 'bg-slate-200 text-slate-600'
      }`}
    >
      {count}
    </span>
  </button>
);

const ShopPill: React.FC<{ label: string; name: string }> = ({ label, name }) => (
  <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[220px] rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5">
    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block">{label}</span>
    <span className="text-sm font-bold text-slate-900 truncate block">{name}</span>
  </div>
);

const MiniStat: React.FC<{ icon: React.ReactNode; label: string; value: string; small?: boolean }> = ({ icon, label, value, small }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center min-w-0">
    <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 flex items-center justify-center gap-0.5">
      {icon} {label}
    </span>
    <span className={`${small ? 'text-[11px]' : 'text-sm'} font-extrabold text-slate-900 block truncate`}>{value}</span>
  </div>
);
