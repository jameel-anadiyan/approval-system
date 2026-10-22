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
  if (eventStart && eventStart.length >= 10) {
    return eventStart.slice(0, 10);
  }
  if (eventDates) {
    // Attempt to parse standard date strings
    const match = eventDates.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
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

  // Active exhibition requests on this date in this region (excluding rejected, withdrawn, or the current editing request)
  const matchingRequests = allRequests.filter((r) => {
    if (r.id === excludeRequestId) return false;
    if (r.request_type !== 'exhibition') return false;
    if (r.status === 'rejected' || r.status === 'withdrawn') return false;

    // Check region match
    const matchesRegion = r.region_id === regionId || (r.details as any)?.region_id === regionId;
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
