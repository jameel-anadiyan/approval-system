// POST /functions/v1/bootstrap-admin
// One-time seed: creates the `admin` login only if no Admin exists yet.
// The first-login password comes from the ADMIN_INITIAL_PASSWORD secret (never committed).
import { handle, HttpError, json, LOGIN_DOMAIN, serviceClient } from "../_shared/common.ts";

Deno.serve(handle(async () => {
  const admin = serviceClient();
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if ((count ?? 0) > 0) throw new HttpError(409, "already_seeded", "An Admin already exists.");
  const password = Deno.env.get("ADMIN_INITIAL_PASSWORD");
  if (!password || password.length < 8) {
    throw new HttpError(500, "missing_secret", "Set the ADMIN_INITIAL_PASSWORD secret (8+ characters) first.");
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: `admin@${LOGIN_DOMAIN}`, password, email_confirm: true,
    user_metadata: { username: "admin", full_name: "Administrator" },
  });
  if (error || !data.user) throw new HttpError(400, "auth_error", error?.message ?? "Could not create admin.");
  const { error: pErr } = await admin.from("profiles").insert({
    id: data.user.id, username: "admin", full_name: "Administrator", designation: "Administrator",
    role: "admin", must_change_password: true,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new HttpError(500, "profile_error", pErr.message);
  }
  await admin.from("audit_log").insert({
    actor_id: data.user.id, actor_name: "System", action: "admin_seeded", target_type: "user", target_id: data.user.id,
  });
  return json({ ok: true, username: "admin" });
}));
