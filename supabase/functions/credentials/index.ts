// POST /functions/v1/credentials
// Actions: upload_url | confirm | view
// Only Admin uploads seals and signatures (for Admin or a Head) through a one-time signed upload link.
import { audit, getCaller, handle, HttpError, json, readJson, requireUuid } from "../_shared/common.ts";

const BUCKET = "credentials";
const MAX = 2 * 1024 * 1024;

Deno.serve(handle(async (req) => {
  const { admin, me } = await getCaller(req);
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);

  if (body.action === "view") {
    const userId = body.user_id ? requireUuid(body.user_id, "User") : me.id;
    if (me.role !== "admin" && !(me.role === "head" && userId === me.id)) {
      throw new HttpError(403, "forbidden", "You cannot view these credentials.");
    }
    const { data: c } = await admin.from("approver_credentials").select("*").eq("user_id", userId).maybeSingle();
    const sign = async (path: string | null) => {
      if (!path) return null;
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
      return data?.signedUrl ?? null;
    };
    return json({
      seal_url: await sign(c?.seal_path ?? null),
      signature_url: await sign(c?.signature_path ?? null),
      updated_at: c?.updated_at ?? null,
    });
  }

  const userId = body.user_id ? requireUuid(body.user_id, "User") : me.id;
  if (me.role !== "admin" && !(me.role === "head" && userId === me.id)) {
    throw new HttpError(403, "forbidden", "Only Admin or the Head themselves can upload their seal and signature.");
  }
  const kind = body.kind;
  if (kind !== "seal" && kind !== "signature") throw new HttpError(400, "bad_request", "Kind must be seal or signature.");
  const { data: target } = await admin.from("profiles").select("id,role,username").eq("id", userId).maybeSingle();
  if (!target || (target.role !== "admin" && target.role !== "head")) {
    throw new HttpError(400, "bad_request", "Seals and signatures are only for Admin and Heads.");
  }

  if (body.action === "upload_url") {
    const path = `${userId}/${kind}-${Date.now()}.png`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new HttpError(500, "storage_error", error?.message ?? "Could not create upload link.");
    return json({ path, token: data.token });
  }

  if (body.action === "confirm") {
    const path = typeof body.path === "string" ? body.path : "";
    if (!new RegExp(`^${userId}/${kind}-\\d+\\.png$`).test(path)) throw new HttpError(400, "bad_request", "Bad path.");
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !blob) throw new HttpError(400, "not_uploaded", "The file was not uploaded.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isPng || bytes.length > MAX) {
      await admin.storage.from(BUCKET).remove([path]);
      throw new HttpError(400, "bad_file", "Upload a PNG image under 2 MB.");
    }
    const col = kind === "seal" ? "seal_path" : "signature_path";
    const { data: existing } = await admin.from("approver_credentials").select("user_id").eq("user_id", userId).maybeSingle();
    const now = new Date().toISOString();
    const { error: uErr } = existing
      ? await admin.from("approver_credentials").update({ [col]: path, updated_by: me.id, updated_at: now }).eq("user_id", userId)
      : await admin.from("approver_credentials").insert({ user_id: userId, [col]: path, updated_by: me.id });
    if (uErr) throw new HttpError(500, "db_error", uErr.message);
    await audit(admin, me, kind === "seal" ? "seal_replaced" : "signature_replaced", "user", userId,
      { username: target.username, path });
    return json({ ok: true });
  }

  throw new HttpError(400, "bad_request", "Unknown action.");
}));
