// Small workflow helpers shared by inbox pages, navigation badges and the request detail page.
import type { Profile, RequestRecord } from '../types/database';
import { isRequestAssociatedWithPaymentUser } from './disbursementRouting';

type Me = (Profile | (Pick<Profile, 'id' | 'role' | 'department_id'> & Partial<Profile>)) | null | undefined;

/**
 * Clerk queue: a submitted request of my department whose work category is handled by me
 * (a category without an active clerk falls back to every clerk — the server computes
 * `routing_clerk_ids` for that).
 */
export function isMyRoutingRequest(r: RequestRecord, me: Me): boolean {
  if (!me || me.role !== 'clerk' || r.status !== 'submitted') return false;
  if (me.department_id && r.department_id !== me.department_id) return false;
  return !r.routing_clerk_ids || r.routing_clerk_ids.length === 0 || r.routing_clerk_ids.includes(me.id);
}

/** Regional Head queue: an employee's request waiting for me to forward or return it. */
export function isMyRegionalRequest(r: RequestRecord, me: Me): boolean {
  return !!me && me.role === 'regional_head' && r.status === 'pending_regional_review' && r.regional_head_id === me.id;
}

/**
 * Approved requests tab visibility:
 * - Admin: sees all approved requests across all departments/heads
 * - Disbursement: sees all approved/paid requests that require disbursement
 * - Requester: always sees their own approved requests
 * - Employee: strictly their own approved requests
 * - Regional Head: only applications they touched (forwarded/managed by them or acted on), approved by head or admin
 * - Clerk: only applications they touched (routed by them or acted on), approved by head or admin
 * - Head: only the respective head's approvals (approved by this head himself, or department/targeted requests
 *   approved by admin, or requests requested by this head, or consultations agreed by this head)
 */
export function canUserViewApprovedRequest(r: RequestRecord, me: Me, allUsers: Profile[] = []): boolean {
  if (!me || !me.role) return false;

  // Request must be approved or paid
  if (r.status !== 'approved' && r.status !== 'paid') return false;

  // 1. Admin sees all approved requests
  if (me.role === 'admin') return true;

  // 2. Disbursement: Payment-Only cashiers only see requests associated with their account
  if (me.role === 'disbursement') {
    if (me.disbursement_type === 'payment_only') {
      return isRequestAssociatedWithPaymentUser(me as Profile, r, allUsers);
    }
    return true;
  }

  // 3. User is the requester: always see their own approved requests
  if (r.requester_id === me.id) return true;

  // 4. Employee: strictly their own requests
  if (me.role === 'employee') {
    return r.requester_id === me.id;
  }

  // 5. Regional Head: only applications they touched (assigned regional head or acted on)
  if (me.role === 'regional_head') {
    if (r.regional_head_id === me.id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  // 6. Clerk: only applications they touched (routed by them or acted on)
  if (me.role === 'clerk') {
    if (r.routed_by === me.id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  // 7. Department Head:
  // "approved tab only show the respective heads approval only dont show all approved"
  // "approved by admin and thier on approved also showned"
  if (me.role === 'head') {
    // Approved by this head himself
    if (r.decided_by === me.id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id && a.action === 'approved')) return true;

    // Respective head's scope (owner_head_id, or department fallback without another head)
    const isRespectiveHead =
      r.owner_head_id === me.id ||
      (!r.owner_head_id && r.department_id === me.department_id);

    if (isRespectiveHead) return true;

    // Consulted on this request
    if ((r.consultations || []).some((c) => c.head_id === me.id)) return true;

    // Acted on this request
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;

    return false;
  }

  return false;
}

/**
 * Returned requests tab & notification visibility:
 * "in returned request now all head get notified, only the associated head and clerk know the return"
 *
 * - Admin: sees all returned requests across all departments
 * - Requester: always sees their own returned requests
 * - Employee: strictly their own returned requests
 * - Regional Head: strictly requests for their region (r.regional_head_id === me.id or r.requester_id === me.id)
 * - Associated Clerk: only applications of their department or routed by them
 *   (r.routed_by === me.id || (r.department_id && me.department_id && r.department_id === me.department_id) || acted on by me)
 * - Associated Head: only applications of their department or assigned to them as owner head
 *   (r.owner_head_id === me.id || (r.department_id && me.department_id && r.department_id === me.department_id) || acted on by me || consulted on it)
 */
export function canUserViewReturnedRequest(r: RequestRecord, me: Me): boolean {
  if (!me || !me.role) return false;
  if (r.status !== 'returned') return false;

  // 1. Admin sees all returned requests
  if (me.role === 'admin') return true;

  // 2. Requester always sees their own returned requests
  if (r.requester_id === me.id) return true;

  // 3. Employee: strictly their own requests
  if (me.role === 'employee') {
    return r.requester_id === me.id;
  }

  // 4. Regional Head: only if assigned regional head or requester
  if (me.role === 'regional_head') {
    return r.regional_head_id === me.id || r.requester_id === me.id;
  }

  // 5. Associated Clerk:
  // Must be the clerk who routed the request, or a clerk of the request's department, or acted on it
  if (me.role === 'clerk') {
    if (r.routed_by === me.id) return true;
    if (r.department_id && me.department_id && r.department_id === me.department_id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  // 6. Associated Head:
  // Must be the assigned owner head, or head of the request's department, or acted on it
  if (me.role === 'head') {
    if (r.owner_head_id === me.id) return true;
    if (r.department_id && me.department_id && r.department_id === me.department_id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    if ((r.consultations || []).some((c) => c.head_id === me.id)) return true;
    return false;
  }

  return false;
}

/**
 * Bill Missing visibility:
 * "only users that associated with specif request will get their requests only .
 * entry also they get only their specif requests only not every users bill not submmit will get it
 * need to filtered according to the users."
 */
export function canUserViewBillMissingRequest(r: RequestRecord, me: Me): boolean {
  if (!me || !me.role) return false;
  if (!r.is_bill_missing) return false;

  // 1. Admin sees all requests with missing bills
  if (me.role === 'admin') return true;

  // 2. Disbursement entry accounts:
  // Sees requests assigned to them, created by them, or flagged by them
  if (me.role === 'disbursement') {
    if (r.bill_missing_by === me.id) return true;
    if (r.assigned_entry_user_id === me.id) return true;
    if (!r.assigned_entry_user_id) return true; // unassigned available to entry officers
    if ((r.disbursement_entries || []).some((e) => e.created_by === me.id)) return true;
    return false;
  }

  // 3. Requester / Employee: strictly their own requests
  if (r.requester_id === me.id) return true;
  if (me.role === 'employee') {
    return r.requester_id === me.id;
  }

  // 4. Regional Head: their region's requests or covering shops
  if (me.role === 'regional_head') {
    if (r.regional_head_id === me.id) return true;
    if (r.shop_id && me.rh_shops && me.rh_shops.some((s) => s.shop_id === r.shop_id)) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  // 5. Clerk: of the request's department or routed by them
  if (me.role === 'clerk') {
    if (r.routed_by === me.id) return true;
    if (r.department_id && me.department_id && r.department_id === me.department_id) return true;
    if (r.routing_clerk_ids && r.routing_clerk_ids.includes(me.id)) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  // 6. Head: of the request's department or owner head
  if (me.role === 'head') {
    if (r.owner_head_id === me.id) return true;
    if (r.department_id && me.department_id && r.department_id === me.department_id) return true;
    if ((r.actions || []).some((a) => a.actor_id === me.id)) return true;
    return false;
  }

  return false;
}


