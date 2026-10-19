import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AppRole } from '../../types/database';
import { MOCK_USERS } from '../../lib/mockData';
import { Lock, ArrowRight, ShieldCheck, Sparkles, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login, isBackendConnected, switchMockRole } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Only allow returning to in-app verify links (no open redirects).
  const from = (location.state as { from?: string } | null)?.from;
  const returnTo = from && /^\/verify\/[\w-]*$/.test(from) ? from : '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await login(username, password);
      if (res.success) {
        navigate(returnTo);
      } else {
        setError(res.error || 'Failed to sign in. Please verify your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const quickLoginAs = (userProfile: (typeof MOCK_USERS)[0]) => {
    setUsername(userProfile.username);
    setPassword('ChangeMe@123');
    switchMockRole(userProfile.role);
    navigate('/');
  };

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-brand-950 text-white relative overflow-hidden">
      {/* Decorative gradient glow */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-brand-500/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-gold-400/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* App Logo */}
        <div className="flex justify-center mb-5">
          <div className="w-24 h-24 rounded-3xl bg-white overflow-hidden flex items-center justify-center shadow-2xl shadow-brand-500/30 ring-1 ring-gold-300/40">
            <img src="/swa-logo.jpg" alt="SWA Diamonds" className="w-full h-full object-contain scale-110" />
          </div>
        </div>

        <h1 className="text-center text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight">
          SWA Diamonds Approvals
        </h1>
        <p className="mt-1 text-center text-xs sm:text-sm text-brand-200/80">
          Digital request, multi-level review, stamping &amp; disbursement
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-brand-900/60 backdrop-blur-xl py-8 px-6 sm:px-10 shadow-2xl rounded-3xl border border-brand-700/60">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Username
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="Enter your assigned username"
                  className="w-full text-sm px-4 py-3 bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors font-mono"
                />
                <span className="absolute right-3.5 top-3.5 text-xs text-slate-500 font-mono">
                  @users
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full text-sm px-4 py-3 bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-linear-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-semibold text-sm shadow-lg shadow-brand-900/40 ring-1 ring-gold-300/30 transition-all active:scale-98 disabled:opacity-50"
            >
              <span>{isLoading ? 'Signing In…' : 'Sign In to Portal'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Demo personas: offline sandbox only — never shown against live Supabase */}
          {!isBackendConnected && (
          <div className="mt-8 pt-6 border-t border-slate-700/60">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Instant Demo Login (1-Click)</span>
              </span>
              <span className="text-[10px] text-slate-500">Pick any role</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {MOCK_USERS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => quickLoginAs(u)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-700/60 border border-slate-700/80 transition-all text-left text-xs group"
                >
                  <div>
                    <span className="font-semibold text-slate-200 group-hover:text-indigo-300">
                      {u.full_name}
                    </span>
                    <span className="text-slate-500 block text-[11px]">
                      @{u.username} • {u.designation || u.role}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                    {u.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
