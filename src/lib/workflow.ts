// Small workflow helpers shared by inbox pages, navigation badges and the request detail page.
import type { Profile, RequestRecord } from '../types/database';

type Me = Pick<Profile, 'id' | 'role' | 'department_id'> | null | undefined;

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
export function canUserViewApprovedRequest(r: RequestRecord, me: Me): boolean {
  if (!me || !me.role) return false;

  // Request must be approved or paid
  if (r.status !== 'approved' && r.status !== 'paid') return false;

  // 1. Admin sees all approved requests
  if (me.role === 'admin') return true;

  // 2. Disbursement sees approved/paid
  if (me.role === 'disbursement') return true;

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

