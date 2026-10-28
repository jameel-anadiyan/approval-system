import { Profile, DisbursementEntry, RequestRecord } from '../types/database';

export interface PaymentAllowedResult {
  allowed: boolean;
  reason?: string;
  isRestrictedDealer?: boolean;
  isRestrictedAccount?: boolean;
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
  allUsers: Profile[]
): PaymentAllowedResult {
  if (!currentUser) return { allowed: false, reason: 'Must be logged in' };
  if (currentUser.role === 'admin') return { allowed: true };
  if (currentUser.role !== 'disbursement' || currentUser.disbursement_type !== 'payment_only') {
    return { allowed: false, reason: 'Only Payment Only disbursement accounts can disburse payments' };
  }

  // 1. Dealer mode check (cash vs bank)
  const mode = entry.entry_type || 'bank';
  const dealerType = currentUser.payment_dealer_type || 'both';
  if (dealerType !== 'both' && dealerType !== mode) {
    return {
      allowed: false,
      isRestrictedDealer: true,
      reason: `Dealer mismatch: Your account handles ${dealerType.toUpperCase()} disbursements, but this entry is designated as ${mode.toUpperCase()}.`,
    };
  }

  const entryUserId = entry.created_by || request.assigned_entry_user_id;

  // 2. Check if current user is restricted to specific entry accounts
  const myConnectedIds = (currentUser.connected_entry_accounts || []).map((c) =>
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
  if (entryUserId) {
    const paymentUsersLinkedToThisEntry = allUsers.filter(
      (u) =>
        u.role === 'disbursement' &&
        u.disbursement_type === 'payment_only' &&
        (u.connected_entry_accounts || []).some((c) =>
          typeof c === 'string' ? c === entryUserId : c.entry_user_id === entryUserId
        )
    );
    if (paymentUsersLinkedToThisEntry.length > 0) {
      const isMeLinked = paymentUsersLinkedToThisEntry.some((u) => u.id === currentUser.id);
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
