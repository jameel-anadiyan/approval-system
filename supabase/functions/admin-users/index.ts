// POST /functions/v1/admin-users
// Actions: create | reset_password | set_active | update | update_access | set_photo | remove_photo
// Admin manages Heads and Disbursement users; a Head manages Clerks, Regional Heads and Employees
// of own department.
// Regional Head: one or more shops (shop_ids). Employee: regional_head_id (required when an active
// Regional Head covers the employee's shop). Clerk: work category_ids.
import {
  audit, getCaller, handle, HttpError, json, LOGIN_DOMAIN, readJson, requireString, requireUuid,
  validatePassword, type Profile, type Role,
} from "../_shared/common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const REQUEST_TYPES = ["general", "discount", "exhibition", "asset", "non_cash"] as const;

const DEPT_ROLES: Role[] = ["head", "clerk", "employee", "regional_head"];

/** Request types the user may raise (only for roles that raise requests). */
function parseTypes(v: unknown, role: Role): string[] {
  if (!(role === "employee" || role === "clerk" || role === "head" || role === "regional_head")) return ["general"];
  const list = Array.isArray(v) ? v.filter((t) => (REQUEST_TYPES as readonly string[]).includes(t)) : [];
  const uniq = [...new Set(list as string[])];
  if (!uniq.length) throw new HttpError(400, "bad_request", "Select at least one request type.");
  return uniq;
}

async function parseShop(admin: SupabaseClient, v: unknown): Promise<string | null> {
  if (v === null || v === undefined || v === "") return null;
  const id = requireUuid(v, "Shop");
  const { data } = await admin.from("shops").select("id,is_active").eq("id", id).maybeSingle();
  if (!data || !data.is_active) throw new HttpError(400, "bad_request", "Shop not found or inactive.");
  return id;
}

/** Regional Head's shops: at least one, all existing and active. */
async function parseShopIds(admin: SupabaseClient, v: unknown): Promise<string[]> {
  const ids = [...new Set((Array.isArray(v) ? v : []).map((x) => requireUuid(x, "Shop")))];
  if (!ids.length) throw new HttpError(400, "bad_request", "Select at least one shop for the Regional Head.");
  const { data } = await admin.from("shops").select("id").in("id", ids).eq("is_active", true);
  if ((data ?? []).length !== ids.length) throw new HttpError(400, "bad_request", "A selected shop was not found or is inactive.");
  return ids;
}

/** Clerk's work categories: must belong to the clerk's department and be active. */
async function parseCategoryIds(admin: SupabaseClient, v: unknown, departmentId: string | null): Promise<string[]> {
  const ids = [...new Set((Array.isArray(v) ? v : []).map((x) => requireUuid(x, "Category")))];
  if (!ids.length) return [];
  const { data } = await admin.from("work_categories").select("id")
    .in("id", ids).eq("department_id", departmentId).eq("is_active", true);
  if ((data ?? []).length !== ids.length) throw new HttpError(400, "bad_request", "A selected work category was not found.");
  return ids;
}

/**
 * Employee's Regional Head. Must be an active Regional Head of the same department covering the
 * employee's shop. Required whenever such a Regional Head exists.
 */
async function parseRegionalHead(
  admin: SupabaseClient, v: unknown, departmentId: string | null, shopId: string | null,
): Promise<string | null> {
  const { data: rhs } = await admin.from("profiles")
    .select("id, regional_head_shops(shop_id)")
    .eq("role", "regional_head").eq("is_active", true).eq("department_id", departmentId);
  // deno-lint-ignore no-explicit-any
  const covering = ((rhs ?? []) as any[])
    .filter((p) => (p.regional_head_shops ?? []).some((s: { shop_id: string }) => s.shop_id === shopId))
    .map((p) => p.id as string);
  if (v === null || v === undefined || v === "") {
    if (covering.length) throw new HttpError(400, "bad_request", "Select the Regional Head for this employee's shop.");
    return null;
  }
  const id = requireUuid(v, "Regional Head");
  if (!covering.includes(id)) {
    throw new HttpError(400, "bad_request", "The selected Regional Head does not cover this employee's shop.");
  }
  return id;
}

async function saveRegionalShops(admin: SupabaseClient, userId: string, shopIds: string[]) {
  const { error: dErr } = await admin.from("regional_head_shops").delete().eq("regional_head_id", userId);
  if (dErr) throw new HttpError(400, "profile_error", dErr.message);
  const { error } = await admin.from("regional_head_shops")
    .insert(shopIds.map((shop_id) => ({ regional_head_id: userId, shop_id })));
  if (error) throw new HttpError(400, "profile_error", error.message);
}

async function saveClerkCategories(admin: SupabaseClient, userId: string, categoryIds: string[]) {
  const { error: dErr } = await admin.from("clerk_categories").delete().eq("clerk_id", userId);
  if (dErr) throw new HttpError(400, "profile_error", dErr.message);
  if (!categoryIds.length) return;
  const { error } = await admin.from("clerk_categories")
    .insert(categoryIds.map((category_id) => ({ clerk_id: userId, category_id })));
  if (error) throw new HttpError(400, "profile_error", error.message);
}

/** Parse assigned Heads for an employee or regional head, ensuring active heads and valid default. */
async function parseHeadIds(
  admin: SupabaseClient, v: unknown, defaultCandidate?: string | null,
): Promise<{ headIds: string[]; defaultHeadId: string | null }> {
  let ids = [...new Set((Array.isArray(v) ? v : []).map((x) => requireUuid(x, "Head")))];
  if (defaultCandidate && !ids.includes(defaultCandidate)) {
    ids.unshift(defaultCandidate);
  }
  if (!ids.length) {
    const { data: activeHeads } = await admin.from("profiles").select("id").eq("role", "head").eq("is_active", true);
    if (activeHeads?.length) ids = activeHeads.map((h) => h.id as string);
  }
  const { data } = await admin.from("profiles").select("id").in("id", ids).eq("role", "head").eq("is_active", true);
  const validIds = (data ?? []).map((h) => h.id as string);
  const defId = defaultCandidate && validIds.includes(defaultCandidate) ? defaultCandidate : (validIds[0] ?? null);
  return { headIds: validIds, defaultHeadId: defId };
}

async function saveUserHeads(admin: SupabaseClient, userId: string, headIds: string[], defaultHeadId: string | null) {
  const { error: dErr } = await admin.from("user_heads").delete().eq("user_id", userId);
  if (dErr) throw new HttpError(400, "profile_error", dErr.message);
  if (headIds.length) {
    const { error: insErr } = await admin.from("user_heads").insert(
      headIds.map((head_id) => ({
        user_id: userId,
        head_id,
        is_default: head_id === defaultHeadId,
      }))
    );
    if (insErr) throw new HttpError(400, "profile_error", insErr.message);
  }
  const { error: pErr } = await admin.from("profiles").update({ default_head_id: defaultHeadId }).eq("id", userId);
  if (pErr) throw new HttpError(400, "profile_error", pErr.message);
}


function canManage(me: Profile, target: { role: Role; department_id: string | null }): boolean {
  if (me.role === "admin") return true;
  if (me.role === "head") {
    return (target.role === "clerk" || target.role === "employee" || target.role === "regional_head") &&
      target.department_id === me.department_id;
  }
  return false;
}

async function loadTarget(admin: SupabaseClient, me: Profile, userId: string): Promise<Profile> {
  const { data } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!data || !canManage(me, data as Profile)) throw new HttpError(403, "forbidden", "You cannot manage this user.");
  return data as Profile;
}

Deno.serve(handle(async (req) => {
  const { admin, me } = await getCaller(req);
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);

  const isOwnPhoto = (body.action === "set_photo" || body.action === "remove_photo") &&
    (!body.user_id || body.user_id === me.id);

  if (!isOwnPhoto && me.role !== "admin" && me.role !== "head") {
    throw new HttpError(403, "forbidden", "Only Admin or a Head can manage users.");
  }

  switch (body.action) {
    case "create": {
      const username = requireString(body.username, "Username").toLowerCase();
      if (!USERNAME_RE.test(username)) {
        throw new HttpError(400, "bad_request", "Username: 3–30 characters, lowercase letters, digits, dot, dash or underscore.");
      }
      const full_name = requireString(body.full_name, "Full name", { max: 100 });
      const designation = typeof body.designation === "string" && body.designation.trim()
        ? body.designation.trim().slice(0, 100) : null;
      const role = body.role as Role;
      const password = validatePassword(body.password);
      const allowed_types = parseTypes(body.allowed_types, role);
      // A Regional Head covers several shops (shop_ids) instead of a single shop.
      const shop_id = role === "regional_head" ? null : await parseShop(admin, body.shop_id);
      if (role === "employee" && !shop_id) throw new HttpError(400, "bad_request", "Select the employee's shop.");
      let department_id: string | null = null;
      if (me.role === "head") {
        department_id = me.department_id;
      } else if (DEPT_ROLES.includes(role)) {
        department_id = requireUuid(body.department_id, "Department");
      }
      if (!canManage(me, { role, department_id })) {
        throw new HttpError(403, "forbidden", "You cannot create a user with this role or department.");
      }
      if (department_id) {
        const { data: dept } = await admin.from("departments").select("id,is_active").eq("id", department_id).maybeSingle();
        if (!dept || !dept.is_active) throw new HttpError(400, "bad_request", "Department not found or inactive.");
      }
      const shop_ids = role === "regional_head" ? await parseShopIds(admin, body.shop_ids) : [];
      const category_ids = role === "clerk" ? await parseCategoryIds(admin, body.category_ids, department_id) : [];
      const regional_head_id = role === "employee"
        ? await parseRegionalHead(admin, body.regional_head_id, department_id, shop_id) : null;
      const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) throw new HttpError(409, "username_taken", "That username is already taken.");
      if (role === "head") {
        const { data: head } = await admin.from("profiles").select("id")
          .eq("department_id", department_id).eq("role", "head").eq("is_active", true).maybeSingle();
        if (head) throw new HttpError(409, "head_exists", "This department already has an active Head. Deactivate them first.");
      }

      const { headIds, defaultHeadId } = (role === "employee" || role === "regional_head")
        ? await parseHeadIds(admin, body.head_ids, me.role === "head" ? me.id : (body.default_head_id ? requireUuid(body.default_head_id, "Default Head") : null))
        : { headIds: [], defaultHeadId: null };


      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${LOGIN_DOMAIN}`, password, email_confirm: true,
        user_metadata: { username, full_name },
      });
      if (error || !created.user) throw new HttpError(400, "auth_error", error?.message ?? "Could not create the login.");

      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, username, full_name, designation, role, department_id, shop_id, allowed_types,
        regional_head_id, must_change_password: true, created_by: me.id,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new HttpError(400, "profile_error", pErr.message);
      }
      try {
        if (role === "regional_head") await saveRegionalShops(admin, created.user.id, shop_ids);
        if (role === "clerk") await saveClerkCategories(admin, created.user.id, category_ids);
        if (role === "employee" || role === "regional_head") {
          await saveUserHeads(admin, created.user.id, headIds, defaultHeadId);
        }
      } catch (e) {
        await admin.from("profiles").delete().eq("id", created.user.id);
        await admin.auth.admin.deleteUser(created.user.id);
        throw e;
      }
      await audit(admin, me, "user_created", "user", created.user.id,
        { username, role, department_id, shop_id, allowed_types, shop_ids, category_ids, regional_head_id, head_ids: headIds, default_head_id: defaultHeadId });
      return json({ id: created.user.id, username });
    }

    case "reset_password": {
      const userId = requireUuid(body.user_id, "User");
      if (userId === me.id) throw new HttpError(400, "bad_request", "Use Change password for your own account.");
      const target = await loadTarget(admin, me, userId);
      const password = validatePassword(body.password);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw new HttpError(400, "auth_error", error.message);
      await admin.from("profiles").update({ must_change_password: true, updated_at: new Date().toISOString() }).eq("id", userId);
      await audit(admin, me, "password_reset", "user", userId, { username: target.username });
      return json({ ok: true });
    }

    case "set_active": {
      const userId = requireUuid(body.user_id, "User");
      if (userId === me.id) throw new HttpError(400, "bad_request", "You cannot deactivate yourself.");
      const target = await loadTarget(admin, me, userId);
      const active = body.active === true;
      if (active && target.role === "head") {
        const { data: head } = await admin.from("profiles").select("id")
          .eq("department_id", target.department_id).eq("role", "head").eq("is_active", true).neq("id", userId).maybeSingle();
        if (head) throw new HttpError(409, "head_exists", "This department already has an active Head.");
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
      if (error) throw new HttpError(400, "auth_error", error.message);
      const { error: pErr } = await admin.from("profiles")
        .update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", userId);
      if (pErr) throw new HttpError(400, "profile_error", pErr.message);
      await audit(admin, me, active ? "user_activated" : "user_deactivated", "user", userId, { username: target.username });
      return json({ ok: true });
    }

    case "update": {
      const userId = requireUuid(body.user_id, "User");
      const target = await loadTarget(admin, me, userId);
      const full_name = requireString(body.full_name, "Full name", { max: 100 });
      const designation = typeof body.designation === "string" && body.designation.trim()
        ? body.designation.trim().slice(0, 100) : null;
      await admin.from("profiles").update({ full_name, designation, updated_at: new Date().toISOString() }).eq("id", userId);
      await audit(admin, me, "user_updated", "user", userId, { username: target.username, full_name, designation });
      return json({ ok: true });
    }

    case "update_access": {
      const userId = requireUuid(body.user_id, "User");
      const target = await loadTarget(admin, me, userId);
      const allowed_types = parseTypes(body.allowed_types, target.role);
      const shop_id = target.role === "regional_head" ? null : await parseShop(admin, body.shop_id);
      if (target.role === "employee" && !shop_id) throw new HttpError(400, "bad_request", "Select the employee's shop.");
      const shop_ids = target.role === "regional_head" ? await parseShopIds(admin, body.shop_ids) : [];
      const category_ids = target.role === "clerk"
        ? await parseCategoryIds(admin, body.category_ids, target.department_id) : [];
      const regional_head_id = target.role === "employee"
        ? await parseRegionalHead(admin, body.regional_head_id, target.department_id, shop_id) : null;
      const { error } = await admin.from("profiles")
        .update({ shop_id, allowed_types, regional_head_id, updated_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw new HttpError(400, "profile_error", error.message);
      if (target.role === "regional_head") await saveRegionalShops(admin, userId, shop_ids);
      if (target.role === "clerk" && Array.isArray(body.category_ids)) await saveClerkCategories(admin, userId, category_ids);
      if ((target.role === "employee" || target.role === "regional_head") && (Array.isArray(body.head_ids) || body.default_head_id)) {
        const { headIds, defaultHeadId } = await parseHeadIds(
          admin, body.head_ids, body.default_head_id ? requireUuid(body.default_head_id, "Default Head") : null
        );
        await saveUserHeads(admin, userId, headIds, defaultHeadId);
      }
      await audit(admin, me, "user_access_updated", "user", userId,
        { username: target.username, shop_id, allowed_types, shop_ids, category_ids, regional_head_id });
      return json({ ok: true });
    }

    case "set_photo":
    case "remove_photo": {
      const userId = requireUuid(body.user_id, "User");
      let target: Profile;
      if (userId === me.id) {
        target = me;
      } else {
        target = await loadTarget(admin, me, userId);
      }
      const { data: cur } = await admin.from("profiles").select("photo_path").eq("id", userId).maybeSingle();
      let photo_path: string | null = null;
      if (body.action === "set_photo") {
        const dataUrl = typeof body.image === "string" ? body.image : "";
        const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!m) throw new HttpError(400, "bad_request", "Photo must be a JPEG, PNG or WebP image.");
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        if (bytes.byteLength > 2 * 1024 * 1024) throw new HttpError(400, "bad_request", "Photo must be under 2 MB.");
        const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
        photo_path = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await admin.storage.from("profile-photos")
          .upload(photo_path, bytes, { contentType: m[1], upsert: false });
        if (upErr) throw new HttpError(400, "storage_error", upErr.message);
      }
      const { error } = await admin.from("profiles")
        .update({ photo_path, updated_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw new HttpError(400, "profile_error", error.message);
      if (cur?.photo_path) await admin.storage.from("profile-photos").remove([cur.photo_path]);
      await audit(admin, me, body.action === "set_photo" ? "user_photo_updated" : "user_photo_removed", "user", userId,
        { username: target.username });
      return json({ ok: true, photo_path });
    }

    default:
      throw new HttpError(400, "bad_request", "Unknown action.");
  }
}));
