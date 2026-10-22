import type { RequestRecord, Profile } from '../types/database';

export interface ExhibitionQuotaStatus {
  eventDate: string | null;
  regionId: string | null;
  regionName: string | null;
  canApplyStandard: boolean;
  mustUseWaitlist: boolean;
  standardCount: number;
  waitlistCount: number;
  bookedByOther: boolean;
  bookedByUserName?: string | null;
  message: string;
  existingRequests: RequestRecord[];
}

/** Extracts the YYYY-MM-DD date string from an event date or ISO timestamp. */
export function extractEventDate(eventStart?: string | null, eventDates?: string | null): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const toYMD = (d: Date) => {
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  if (eventStart && typeof eventStart === 'string') {
    const trimmed = eventStart.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const parsed = new Date(trimmed);
    const res = toYMD(parsed);
    if (res) return res;
  }

  if (eventDates && typeof eventDates === 'string') {
    const trimmed = eventDates.trim();
    const isoMatch = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    // Match DD Mon YYYY (e.g. 12 Nov 2026, 12 November 2026)
    const textDateMatch = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (textDateMatch) {
      const parsed = new Date(`${textDateMatch[1]} ${textDateMatch[2]} ${textDateMatch[3]}`);
      const res = toYMD(parsed);
      if (res) return res;
    }

    // Match Mon DD, YYYY (e.g. Nov 12, 2026)
    const usDateMatch = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (usDateMatch) {
      const parsed = new Date(`${usDateMatch[1]} ${usDateMatch[2]} ${usDateMatch[3]}`);
      const res = toYMD(parsed);
      if (res) return res;
    }

    const prefix = trimmed.split(/[,–—-]/)[0].trim();
    if (prefix) {
      const parsed = new Date(prefix);
      const res = toYMD(parsed);
      if (res) return res;
    }
  }
  return null;
}

/**
 * Evaluates exhibition booking limits for a specific date and region:
 * - Within a region on any single day, any ONE Regional Head can apply for up to 2 standard requests.
 * - If that Regional Head has 1 request, they can apply for 1 more.
 * - Other Regional Heads in the same region CANNOT apply for standard slots for that date.
 * - Other Regional Heads (or once 2 slots are filled) can apply for the Special Waiting List Exhibition.
 */
export function checkExhibitionQuota(params: {
  eventStart?: string | null;
  eventDates?: string | null;
  regionId?: string | null;
  regionName?: string | null;
  currentUser?: Profile | null;
  allRequests: RequestRecord[];
  excludeRequestId?: string | null;
}): ExhibitionQuotaStatus {
  const { eventStart, eventDates, regionId, regionName, currentUser, allRequests, excludeRequestId } = params;
  const eventDate = extractEventDate(eventStart, eventDates);

  if (!eventDate || !regionId) {
    return {
      eventDate,
      regionId: regionId ?? null,
      regionName: regionName ?? null,
      canApplyStandard: true,
      mustUseWaitlist: false,
      standardCount: 0,
      waitlistCount: 0,
      bookedByOther: false,
      message: !regionId
        ? 'No region specified for Regional Head. Standard slot booking available.'
        : 'Pick an event date to check regional booking availability.',
      existingRequests: [],
    };
  }

  // Active exhibition requests on this date in this region:
  // When a request is initiated (including drafts), it reserves the slot immediately.
  // Only rejected, withdrawn, or cancelled requests release the slot.
  const matchingRequests = allRequests.filter((r) => {
    if (r.id === excludeRequestId) return false;
    if (r.request_type !== 'exhibition') return false;
    if (r.status === 'rejected' || r.status === 'withdrawn' || r.status === 'cancelled') return false;

    // Check region match
    const rRegId = r.region_id || (r.details as any)?.region_id;
    const matchesRegion = rRegId ? rRegId === regionId : (r.region_name && regionName ? r.region_name === regionName : false);
    if (!matchesRegion) return false;

    // Check date match
    const rDate = extractEventDate(r.details?.event_start, r.details?.event_dates);
    return rDate === eventDate;
  });

  const standardRequests = matchingRequests.filter((r) => !r.is_waitlist);
  const waitlistRequests = matchingRequests.filter((r) => r.is_waitlist);

  const standardCount = standardRequests.length;
  const waitlistCount = waitlistRequests.length;

  // Case 1: 0 standard requests booked on this date in this region
  if (standardCount === 0) {
    return {
      eventDate,
      regionId,
      regionName: regionName ?? null,
      canApplyStandard: true,
      mustUseWaitlist: false,
      standardCount: 0,
      waitlistCount,
      bookedByOther: false,
      message: `Open: Standard Slot 1 of 2 is available in ${regionName || 'your region'} on this date.`,
      existingRequests: matchingRequests,
    };
  }

  // Case 2: One or more standard requests exist. Check who booked them.
  const myId = currentUser?.id;
  const firstBookerId = standardRequests[0]?.requester_id || standardRequests[0]?.regional_head_id;
  const firstBookerName = standardRequests[0]?.requester_name || standardRequests[0]?.regional_head_name || 'Another Regional Head';

  const isBookedByMe = myId && (firstBookerId === myId || standardRequests.every((r) => r.requester_id === myId || r.regional_head_id === myId));

  if (isBookedByMe) {
    if (standardCount < 2) {
      return {
        eventDate,
        regionId,
        regionName: regionName ?? null,
        canApplyStandard: true,
        mustUseWaitlist: false,
        standardCount,
        waitlistCount,
        bookedByOther: false,
        message: `Available: You have 1 exhibition booked on this date in ${regionName || 'this region'}. You can apply for your 2nd request (Slot 2 of 2).`,
        existingRequests: matchingRequests,
      };
    }

    // Already booked 2 requests
    return {
      eventDate,
      regionId,
      regionName: regionName ?? null,
      canApplyStandard: false,
      mustUseWaitlist: true,
      standardCount,
      waitlistCount,
      bookedByOther: false,
      message: `Daily Quota Reached: You have already booked 2 requests in ${regionName || 'this region'} on this date. You may only apply for the Special Waiting List.`,
      existingRequests: matchingRequests,
    };
  }

  // Case 3: Booked by another Regional Head in the same region
  return {
    eventDate,
    regionId,
    regionName: regionName ?? null,
    canApplyStandard: false,
    mustUseWaitlist: true,
    standardCount,
    waitlistCount,
    bookedByOther: true,
    bookedByUserName: firstBookerName,
    message: `Slot Claimed: Standard exhibition slot in ${regionName || 'this region'} on this date is already booked by ${firstBookerName}. Other Regional Heads may only apply for the Special Waiting List.`,
    existingRequests: matchingRequests,
  };
}
