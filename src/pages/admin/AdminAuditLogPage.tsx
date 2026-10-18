import React from 'react';
import { MOCK_AUDIT_LOGS } from '../../lib/mockData';
import { formatISTDate } from '../../lib/formatters';
import { History, ShieldCheck, User, Building2, KeyRound } from 'lucide-react';

export const AdminAuditLogPage: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display flex items-center gap-2">
          <History className="w-6 h-6 text-indigo-600" />
          <span>System Audit Log</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Immutable audit record of user creations, password resets, role changes, and system modifications.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="divide-y divide-slate-100">
          {MOCK_AUDIT_LOGS.map((entry) => (
            <div key={entry.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-xs sm:text-sm">
                    {entry.actor_name}
                  </span>
                  <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {entry.action}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {formatISTDate(entry.created_at)}
                </span>
              </div>

              <div className="text-xs text-slate-600">
                Target: <strong className="text-slate-800">{entry.target_type}</strong>
                {entry.target_id && (
                  <span className="font-mono text-[11px] text-slate-400 ml-1">
                    ({entry.target_id})
                  </span>
                )}
              </div>

              {entry.details && (
                <pre className="mt-2 text-[11px] bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 text-slate-700 overflow-x-auto font-mono">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
