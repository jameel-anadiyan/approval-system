import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRequests } from '../../context/RequestContext';
import { formatINR } from '../../lib/formatters';
import { extractEventDate } from '../../lib/exhibitionQuota';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  PlusCircle,
  Store,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  Info,
  Calendar as CalendarIcon,
  X,
  ExternalLink,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { RequestRecord } from '../../types/database';

export const ExhibitionCalendarPage: React.FC = () => {
  const { user } = useAuth();
  const { requests } = useRequests();
  const navigate = useNavigate();

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedRegionId, setSelectedRegionId] = useState<string>(() => user?.region_id || 'all');
  const [selectedDayEvents, setSelectedDayEvents] = useState<{
    dateStr: string;
    displayDate: string;
    events: RequestRecord[];
  } | null>(null);

  // Month navigation
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const gotoToday = () => setCurrentDate(new Date());

  // Active exhibition requests (all requested exhibitions count, not just approved)
  const exhibitionRequests = useMemo(() => {
    return requests.filter((r) => {
      if (r.request_type !== 'exhibition') return false;
      if (r.status === 'draft' || r.status === 'rejected' || r.status === 'withdrawn' || r.status === 'cancelled') return false;
      return true;
    });
  }, [requests]);

  // Extract distinct regions
  const regionsList = useMemo(() => {
    const map = new Map<string, string>();
    exhibitionRequests.forEach((r) => {
      if (r.region_id && r.region_name) {
        map.set(r.region_id, r.region_name);
      }
    });
    // Ensure user's own region is in the list
    if (user?.region_id && user?.region?.name) {
      map.set(user.region_id, user.region.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [exhibitionRequests, user]);

  // Filter requests by selected region (if not "all")
  const regionFilteredRequests = useMemo(() => {
    if (selectedRegionId === 'all') return exhibitionRequests;
    return exhibitionRequests.filter((r) => r.region_id === selectedRegionId);
  }, [exhibitionRequests, selectedRegionId]);

  // Group requests by YYYY-MM-DD
  const requestsByDate = useMemo(() => {
    const map = new Map<string, RequestRecord[]>();
    regionFilteredRequests.forEach((r) => {
      const date = extractEventDate(r.details?.event_start, r.details?.event_dates);
      if (date) {
        const arr = map.get(date) || [];
        arr.push(r);
        map.set(date, arr);
      }
    });
    return map;
  }, [regionFilteredRequests]);

  // Build calendar matrix (days in current month + padding)
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days = [];

    // Previous month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const dateStr = prevDate.toISOString().slice(0, 10);
      days.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: false,
      });
    }

    // Current month days
    const todayStr = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= daysInMonth; d++) {
      const curDate = new Date(year, month, d);
      const dateStr = curDate.toISOString().slice(0, 10);
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
      });
    }

    // Next month padding to fill a 35 or 42 grid
    const remaining = (7 - (days.length % 7)) % 7;
    for (let n = 1; n <= remaining; n++) {
      const nextDate = new Date(year, month + 1, n);
      const dateStr = nextDate.toISOString().slice(0, 10);
      days.push({
        dateStr,
        dayNum: n,
        isCurrentMonth: false,
        isToday: false,
      });
    }

    return days;
  }, [year, month]);

  const activeRegionName = useMemo(() => {
    if (selectedRegionId === 'all') return 'All Regions';
    return regionsList.find((r) => r.id === selectedRegionId)?.name || 'Selected Region';
  }, [selectedRegionId, regionsList]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header and Controls */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display">
                Exhibition Booking Calendar
              </h1>
              <p className="text-xs text-slate-500">
                Visual slot availability and booked dates across regions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Region Filter */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-1.5 text-xs font-semibold text-slate-700">
            <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
            <select
              value={selectedRegionId}
              onChange={(e) => setSelectedRegionId(e.target.value)}
              className="bg-transparent border-none outline-hidden cursor-pointer font-bold text-slate-800"
            >
              <option value="all">All Regions</option>
              {regionsList.map((rg) => (
                <option key={rg.id} value={rg.id}>
                  {rg.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Steppers */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={prevMonth}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-white transition-all cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={gotoToday}
              className="px-3 py-1 text-xs font-bold text-slate-700 hover:text-indigo-600 hover:bg-white rounded-xl transition-all cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-white transition-all cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick New Exhibition Request */}
          <Link
            to="/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-2xl shadow-xs transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Book Exhibition</span>
          </Link>
        </div>
      </div>

      {/* Month Label & Color Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-2">
          <span className="text-xl sm:text-2xl font-black font-display text-slate-900 tracking-tight">
            {monthNames[month]} {year}
          </span>
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {activeRegionName}
          </span>
        </div>

        {/* Color Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-2xs" />
            <span>Open (0/2 Booked)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-amber-500 shadow-2xs" />
            <span>1 Slot Booked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-indigo-600 shadow-2xs" />
            <span>2 Slots Booked (Full)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500 shadow-2xs" />
            <span>Special Waitlist</span>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Days of Week Header */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-bold text-slate-500 py-3">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>

        {/* Day Cells */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-100">
          {calendarDays.map((day, idx) => {
            const dayEvents = requestsByDate.get(day.dateStr) || [];
            const standardEvents = dayEvents.filter((r) => !r.is_waitlist);
            const waitlistEvents = dayEvents.filter((r) => r.is_waitlist);

            const standardCount = standardEvents.length;
            const waitlistCount = waitlistEvents.length;

            // Determine day badge and border color
            let tileBg = 'bg-white';
            let statusDot = 'bg-emerald-400';
            let statusLabel = 'Open';

            if (standardCount === 1) {
              tileBg = 'bg-amber-50/30';
              statusDot = 'bg-amber-500';
              statusLabel = '1 Booked';
            } else if (standardCount >= 2) {
              tileBg = 'bg-indigo-50/30';
              statusDot = 'bg-indigo-600';
              statusLabel = '2 Booked';
            }

            return (
              <div
                key={day.dateStr + idx}
                onClick={() => {
                  const dObj = new Date(day.dateStr + 'T00:00:00');
                  const disp = dObj.toLocaleDateString('en-IN', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  });
                  setSelectedDayEvents({
                    dateStr: day.dateStr,
                    displayDate: disp,
                    events: dayEvents,
                  });
                }}
                className={`min-h-[110px] sm:min-h-[130px] p-2.5 flex flex-col justify-between transition-all hover:bg-slate-50/80 cursor-pointer relative group ${
                  !day.isCurrentMonth ? 'opacity-40 bg-slate-50/50' : tileBg
                } ${day.isToday ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
              >
                {/* Date Header in cell */}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-bold ${
                      day.isToday
                        ? 'w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-extrabold shadow-xs'
                        : 'text-slate-800'
                    }`}
                  >
                    {day.dayNum}
                  </span>

                  {day.isCurrentMonth && (
                    <div className="flex items-center gap-1">
                      {waitlistCount > 0 && (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white"
                          title={`${waitlistCount} Waitlist Request(s)`}
                        />
                      )}
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${statusDot} ring-2 ring-white`}
                        title={statusLabel}
                      />
                    </div>
                  )}
                </div>

                {/* Day Events preview */}
                <div className="mt-1 space-y-1 flex-1 overflow-hidden">
                  {standardEvents.slice(0, 2).map((ev) => (
                    <div
                      key={ev.id}
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate bg-indigo-100/80 text-indigo-900 border border-indigo-200/60"
                      title={`${ev.details?.event_name || ev.title} (${ev.requester_name})`}
                    >
                      {ev.details?.event_name || ev.title}
                    </div>
                  ))}

                  {waitlistEvents.length > 0 && (
                    <div
                      className="px-1.5 py-0.5 rounded-md text-[10px] font-bold truncate bg-rose-100 text-rose-900 border border-rose-200 flex items-center gap-1"
                      title={`${waitlistCount} Special Waitlist`}
                    >
                      <AlertTriangle className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                      <span>{waitlistCount} Waitlist</span>
                    </div>
                  )}
                </div>

                {/* Bottom status hint on hover */}
                <div className="text-[10px] font-semibold text-slate-400 group-hover:text-indigo-600 transition-colors pt-1">
                  {standardCount === 0 ? (
                    <span className="text-emerald-700">Open (0/2)</span>
                  ) : standardCount === 1 ? (
                    <span className="text-amber-700">1 of 2 slots</span>
                  ) : (
                    <span className="text-indigo-700">Full (2/2)</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day Details Modal */}
      {selectedDayEvents && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedDayEvents(null)}
          title={`Bookings on ${selectedDayEvents.displayDate}`}
        >
          <div className="space-y-4">
            {/* Quota Summary for this day */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700">Daily Regional Quota</span>
                <span className="font-bold text-indigo-700">
                  {selectedDayEvents.events.filter((r) => !r.is_waitlist).length} / 2 Slots Booked
                </span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Rules: Any single Regional Head can book up to 2 slots on this date. Other Regional Heads in the same region must submit via the Special Waiting List.
              </p>
            </div>

            {/* List of bookings */}
            {selectedDayEvents.events.length === 0 ? (
              <div className="p-8 text-center bg-emerald-50/50 rounded-2xl border border-emerald-100">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-emerald-950">Date Fully Open</h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  No exhibitions booked on this date in {activeRegionName}.
                </p>
                <Link
                  to="/new"
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Book this Date</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Exhibitions on this Date ({selectedDayEvents.events.length})
                </h4>

                {selectedDayEvents.events.map((r) => (
                  <div
                    key={r.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      r.is_waitlist
                        ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                        : 'bg-white border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-sm">
                            {r.details?.event_name || r.title}
                          </span>
                          {r.is_waitlist ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 border border-rose-300">
                              <AlertTriangle className="w-3 h-3 text-rose-600" />
                              Special Waitlist
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200">
                              Standard Slot
                            </span>
                          )}
                          <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            r.status === 'approved' || r.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {r.status === 'approved' || r.status === 'paid' ? 'Approved' : 'Requested (Counts as Booked)'}
                          </span>
                        </div>

                        <div className="mt-1 text-xs text-slate-600 space-y-0.5">
                          {r.details?.venue && (
                            <div>Venue: <strong>{r.details.venue}</strong></div>
                          )}
                          <div>
                            Requester: <strong>{r.requester_name}</strong>{' '}
                            {r.region_name ? `(${r.region_name})` : ''}
                          </div>
                          <div>
                            Budget: <strong>{formatINR(r.details?.total_budget || r.amount)}</strong>
                          </div>
                        </div>
                      </div>

                      <Link
                        to={`/requests/${r.id}`}
                        className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                        title="View Request"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedDayEvents(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
