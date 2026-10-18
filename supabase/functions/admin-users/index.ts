// POST /functions/v1/admin-users
// Actions: create | reset_password | set_active | update
// Admin manages Heads and Disbursement users; a Head manages Clerks and Employees of own department.
import {
  audit, getCaller, handle, HttpError, json, LOGIN_DOMAIN, readJson, requireString, requireUuid,
  validatePassword, type Profile, type Role,
} from "../_shared/common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function canManage(me: Profile, target: { role: Role; department_id: string | null }): boolean {
  if (me.role === "admin") return target.role === "head" || target.role === "disbursement";
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
  if (me.role !== "admin" && me.role !== "head") throw new HttpError(403, "forbidden", "Only Admin or a Head can manage users.");
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);

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
      let department_id: string | null = null;
      if (me.role === "head") {
        department_id = me.department_id;
      } else if (role === "head") {
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
        id: created.user.id, username, full_name, designation, role, department_id,
        must_change_password: true, created_by: me.id,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new HttpError(400, "profile_error", pErr.message);
      }
      await audit(admin, me, "user_created", "user", created.user.id, { username, role, department_id });
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

    default:
      throw new HttpError(400, "bad_request", "Unknown action.");
  }
}));
