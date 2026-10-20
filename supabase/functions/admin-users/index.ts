// POST /functions/v1/admin-users
// Actions: create | reset_password | set_active | update
// Admin manages Heads and Disbursement users; a Head manages Clerks and Employees of own department.
import {
  audit, getCaller, handle, HttpError, json, LOGIN_DOMAIN, readJson, requireString, requireUuid,
  validatePassword, type Profile, type Role,
} from "../_shared/common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const REQUEST_TYPES = ["general", "discount", "exhibition", "asset"] as const;

/** Request types the user may raise (only for roles that raise requests). */
function parseTypes(v: unknown, role: Role): string[] {
  if (!(role === "employee" || role === "clerk" || role === "head")) return ["general"];
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

function canManage(me: Profile, target: { role: Role; department_id: string | null }): boolean {
  if (me.role === "admin") return true;
  if (me.role === "head") {
    return (target.role === "clerk" || target.role === "employee") && target.department_id === me.department_id;
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
      const shop_id = await parseShop(admin, body.shop_id);
      if (role === "employee" && !shop_id) throw new HttpError(400, "bad_request", "Select the employee's shop.");
      let department_id: string | null = null;
      if (me.role === "head") {
        department_id = me.department_id;
      } else if (role === "head" || role === "clerk" || role === "employee") {
        department_id = requireUuid(body.department_id, "Department");
      }
      if (!canManage(me, { role, department_id })) {
        throw new HttpError(403, "forbidden", "You cannot create a user with this role or department.");
      }
      if (department_id) {
        const { data: dept } = await admin.from("departments").select("id,is_active").eq("id", department_id).maybeSingle();
        if (!dept || !dept.is_active) throw new HttpError(400, "bad_request", "Department not found or inactive.");
      }
      const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) throw new HttpError(409, "username_taken", "That username is already taken.");
      if (role === "head") {
        const { data: head } = await admin.from("profiles").select("id")
          .eq("department_id", department_id).eq("role", "head").eq("is_active", true).maybeSingle();
        if (head) throw new HttpError(409, "head_exists", "This department already has an active Head. Deactivate them first.");
      }

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${LOGIN_DOMAIN}`, password, email_confirm: true,
        user_metadata: { username, full_name },
      });
      if (error || !created.user) throw new HttpError(400, "auth_error", error?.message ?? "Could not create the login.");

      const { error: pErr } = await admin.from("profiles").insert({
        id: created.user.id, username, full_name, designation, role, department_id, shop_id, allowed_types,
        must_change_password: true, created_by: me.id,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new HttpError(400, "profile_error", pErr.message);
      }
      await audit(admin, me, "user_created", "user", created.user.id, { username, role, department_id, shop_id, allowed_types });
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
      const shop_id = await parseShop(admin, body.shop_id);
      if (target.role === "employee" && !shop_id) throw new HttpError(400, "bad_request", "Select the employee's shop.");
      const { error } = await admin.from("profiles")
        .update({ shop_id, allowed_types, updated_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw new HttpError(400, "profile_error", error.message);
      await audit(admin, me, "user_access_updated", "user", userId, { username: target.username, shop_id, allowed_types });
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
