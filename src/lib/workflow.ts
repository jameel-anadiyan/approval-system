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
