import { Profile, DisbursementEntry, RequestRecord, entryPayable } from '../types/database';

export interface PaymentAllowedResult {
  allowed: boolean;
  reason?: string;
  isRestrictedDealer?: boolean;
  isRestrictedAccount?: boolean;
}

/**
 * Resolves the full profile object (including connected_entry_accounts from directory if needed)
 */
export function getFullPaymentUser(
  currentUser: Profile | null | undefined,
  allUsers: Profile[] = []
): Profile | null | undefined {
  if (!currentUser) return currentUser;
  const inDir = allUsers.find((u) => u.id === currentUser.id);
  if (!inDir) return currentUser;
  return {
    ...currentUser,
    ...inDir,
    connected_entry_accounts:
      inDir.connected_entry_accounts && inDir.connected_entry_accounts.length > 0
        ? inDir.connected_entry_accounts
        : currentUser.connected_entry_accounts || [],
    payment_dealer_type: inDir.payment_dealer_type || currentUser.payment_dealer_type || 'both',
  };
}

/**
 * Validates whether the currently logged-in Payment Only cashier is allowed to disburse
 * payment for a given disbursement entry on a request.
 *
 * Enforces:
 * 1. Admin is always allowed.
 * 2. Only Payment Only disbursement accounts can pay.
 * 3. Dealer mode (cash vs bank) must match entry type.
 * 4. If current payment user has assigned connected entry accounts, entry must match.
 * 5. If the entry account is specifically linked to certain payment accounts in the organization,
 *    ONLY those linked payment accounts (or Admin) get the chance to pay!
 */
export function isPaymentUserAllowedForEntry(
  currentUser: Profile | null | undefined,
  entry: DisbursementEntry,
  request: RequestRecord,
  allUsers: Profile[] = []
): PaymentAllowedResult {
  if (!currentUser) return { allowed: false, reason: 'Must be logged in' };
  if (currentUser.role === 'admin') return { allowed: true };
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') {
    return { allowed: false, reason: 'Only Payment Only disbursement accounts can disburse payments' };
  }

  const user = getFullPaymentUser(currentUser, allUsers) || currentUser;

  // 1. Dealer mode check (cash vs bank)
  const mode = entry.entry_type || 'bank';
  const dealerType = user.payment_dealer_type || 'both';
  if (dealerType !== 'both' && dealerType !== mode) {
    return {
      allowed: false,
      isRestrictedDealer: true,
      reason: `Dealer mismatch: Your account handles ${dealerType.toUpperCase()} disbursements, but this entry is designated as ${mode.toUpperCase()}.`,
    };
  }

  const entryUserId = entry.created_by || request.assigned_entry_user_id;

  // 2. Check if current user is restricted to specific entry accounts
  const myConnectedIds = (user.connected_entry_accounts || []).map((c) =>
    typeof c === 'string' ? c : c.entry_user_id
  );
  if (myConnectedIds.length > 0) {
    if (!entryUserId || !myConnectedIds.includes(entryUserId)) {
      return {
        allowed: false,
        isRestrictedAccount: true,
        reason: 'Restricted: This entry is from an Entry Account not assigned to your payment account.',
      };
    }
  }

  // 3. Check if this entry account is specifically linked to certain payment cashiers
  if (entryUserId && allUsers.length > 0) {
    const paymentUsersLinkedToThisEntry = allUsers.filter(
      (u) =>
        u.role === 'disbursement' &&
        u.disbursement_type === 'payment_only' &&
        (u.connected_entry_accounts || []).some((c) =>
          typeof c === 'string' ? c === entryUserId : c.entry_user_id === entryUserId
        )
    );
    if (paymentUsersLinkedToThisEntry.length > 0) {
      const isMeLinked = paymentUsersLinkedToThisEntry.some((u) => u.id === user.id);
      if (!isMeLinked) {
        const linkedNames = paymentUsersLinkedToThisEntry.map((u) => u.full_name).join(', ');
        return {
          allowed: false,
          isRestrictedAccount: true,
          reason: `Routing restriction: Only the linked payment cashier (${linkedNames}) can disburse this entry.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Checks if a specific entry is associated with the payment user (either payable by them or paid by them)
 */
export function isEntryAssociatedWithPaymentUser(
  currentUser: Profile | null | undefined,
  entry: DisbursementEntry,
  request: RequestRecord,
  allUsers: Profile[] = []
): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  // Was it paid by me?
  if (entry.paid_by === currentUser.id) return true;
  if ((request.payments || []).some((p) => p.entry_id === entry.id && p.paid_by === currentUser.id)) return true;

  // If it was already fully settled/paid by someone else, it is not associated with this cashier
  if (
    entry.paid_by &&
    entry.paid_by !== currentUser.id &&
    entry.status === 'paid' &&
    Number(entry.paid_amount || 0) > 0
  ) {
    return false;
  }

  // Is it routable to me?
  return isPaymentUserAllowedForEntry(currentUser, entry, request, allUsers).allowed;
}

/**
 * Checks if a request belongs in the Awaiting Payment tab for a Payment-Only cashier:
 * 1. Request status is 'approved'
 * 2. Has at least one approved entry with payable balance that THIS cashier is authorized to pay.
 */
export function canPaymentUserViewAwaitingRequest(
  currentUser: Profile | null | undefined,
  request: RequestRecord,
  allUsers: Profile[] = []
): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return request.status === 'approved';
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  if (request.status !== 'approved') return false;

  return (request.disbursement_entries || []).some(
    (e) =>
      e.status === 'approved' &&
      entryPayable(e) > 0 &&
      isPaymentUserAllowedForEntry(currentUser, e, request, allUsers).allowed
  );
}

/**
 * Checks if a request belongs in the Settled & Paid tab for a Payment-Only cashier:
 * Shows ONLY requests where payments were actually disbursed by this cashier, or
 * entries associated with this cashier were paid/settled.
 */
export function canPaymentUserViewPaidRequest(
  currentUser: Profile | null | undefined,
  request: RequestRecord,
  allUsers: Profile[] = []
): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return request.status === 'paid';
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  // 1. Did I make any payment on this request?
  const hasMyPayment = (request.payments || []).some((p) => p.paid_by === currentUser.id);
  if (hasMyPayment) return true;

  // 2. Was any entry paid by me?
  const hasMyPaidEntry = (request.disbursement_entries || []).some(
    (e) => e.paid_by === currentUser.id && Number(e.paid_amount || 0) > 0
  );
  if (hasMyPaidEntry) return true;

  // 3. Or does it have an entry associated with me that is settled/paid?
  // (e.g. legacy data where paid_by was not captured, but entry is routable to me and NOT paid by someone else)
  const hasMyAssociatedSettledEntry = (request.disbursement_entries || []).some(
    (e) =>
      (Number(e.paid_amount || 0) > 0 || e.status === 'paid') &&
      (!e.paid_by || e.paid_by === currentUser.id) &&
      isPaymentUserAllowedForEntry(currentUser, e, request, allUsers).allowed
  );
  return hasMyAssociatedSettledEntry;
}

/**
 * Checks if a request is associated with a Payment-Only cashier in general (awaiting or paid)
 */
export function isRequestAssociatedWithPaymentUser(
  currentUser: Profile | null | undefined,
  request: RequestRecord,
  allUsers: Profile[] = []
): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') return false;

  return (
    canPaymentUserViewAwaitingRequest(currentUser, request, allUsers) ||
    canPaymentUserViewPaidRequest(currentUser, request, allUsers)
  );
}
