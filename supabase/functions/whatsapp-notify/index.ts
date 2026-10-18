// POST /functions/v1/whatsapp-notify
// 1) Database hook (header x-hook-secret): { notification_id } -> send that
//    notification to the recipient's WhatsApp via Twilio. Called by the
//    notifications_whatsapp trigger (pg_net). Idempotent: each row is claimed once.
// 2) Admin test (Bearer token): { action: "test", phone } -> send a test message.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//          TWILIO_WHATSAPP_FROM (default sandbox +14155238886),
//          TWILIO_CONTENT_SID (optional approved template; vars 1=title 2=details 3=link),
//          APP_URL (link base, e.g. https://your-app.vercel.app)
import { getCaller, handle, HttpError, json, readJson, serviceClient } from "../_shared/common.ts";

const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

async function sendWhatsApp(to: string, body: string, vars: Record<string, string>): Promise<string> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  if (!sid || !token) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  let from = env("TWILIO_WHATSAPP_FROM", "+14155238886");
  if (!from.startsWith("whatsapp:")) from = `whatsapp:${from}`;

  const form = new URLSearchParams({ From: from, To: `whatsapp:${to}` });
  const contentSid = env("TWILIO_CONTENT_SID");
  if (contentSid) {
    form.set("ContentSid", contentSid);
    form.set("ContentVariables", JSON.stringify(vars));
  } else {
    form.set("Body", body);
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data?.message ?? "send failed"}`);
  return String(data?.sid ?? "");
}

function inr(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "";
}

Deno.serve(handle(async (req) => {
  const admin = serviceClient();
  const hookSecret = req.headers.get("x-hook-secret");

  // ── admin test message ──────────────────────────────────────────────────
  if (!hookSecret) {
    const { me } = await getCaller(req);
    if (me.role !== "admin") throw new HttpError(403, "forbidden", "Only Admin can send a test message.");
    // deno-lint-ignore no-explicit-any
    const body = await readJson<any>(req);
    if (body.action !== "test") throw new HttpError(400, "bad_request", "Unknown action.");
    const phone = typeof body.phone === "string" ? body.phone.replace(/[\s\-().]/g, "") : "";
    if (!PHONE_RE.test(phone)) throw new HttpError(400, "bad_request", "Phone must look like +919876543210.");
    const link = env("APP_URL", "");
    try {
      const sid = await sendWhatsApp(phone,
        `✅ *Approval App*\nWhatsApp alerts are working.${link ? `\n${link}` : ""}`,
        { "1": "Test message", "2": "WhatsApp alerts are working", "3": link || "-" });
      return json({ ok: true, sid });
    } catch (e) {
      throw new HttpError(502, "whatsapp_failed", e instanceof Error ? e.message : "Send failed");
    }
  }

  // ── database hook ───────────────────────────────────────────────────────
  const { data: cfg } = await admin.from("whatsapp_hook").select("hook_secret").eq("id", 1).maybeSingle();
  if (!cfg || cfg.hook_secret !== hookSecret) throw new HttpError(401, "unauthorized", "Bad hook secret.");

  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);
  const id = Number(body.notification_id);
  if (!Number.isInteger(id)) throw new HttpError(400, "bad_request", "notification_id required.");

  // claim the row once (protects against retries / duplicate calls)
  const { data: n } = await admin.from("notifications")
    .update({ wa_status: "sending" })
    .eq("id", id).is("wa_status", null).eq("whatsapp", true)
    .select("id, user_id, request_id, title, body").maybeSingle();
  if (!n) return json({ ok: true, skipped: "already handled" });

  const mark = (wa_status: string, wa_error: string | null = null) =>
    admin.from("notifications").update({
      wa_status, wa_error, wa_sent_at: wa_status === "sent" ? new Date().toISOString() : null,
    }).eq("id", id);

  const { data: user } = await admin.from("profiles").select("full_name, phone, is_active").eq("id", n.user_id).maybeSingle();
  if (!user?.is_active || !user.phone) {
    await mark("no_phone");
    return json({ ok: true, skipped: "no phone" });
  }

  let details = n.body ?? "";
  let link = env("APP_URL", "");
  if (n.request_id) {
    const { data: r } = await admin.from("requests")
      .select("request_no, title, amount, requester_name, approval_no, department:departments(name)")
      .eq("id", n.request_id).maybeSingle();
    if (r) {
      // deno-lint-ignore no-explicit-any
      const dept = (r as any).department?.name ?? "";
      details = [
        `${r.request_no ?? "Request"} – ${r.title}`,
        `Amount: ${inr(r.amount)}`,
        dept ? `Department: ${dept}` : "",
        `Raised by: ${r.requester_name}`,
        r.approval_no ? `Approval No: ${r.approval_no}` : "",
      ].filter(Boolean).join("\n");
    }
    if (link) link = `${link.replace(/\/$/, "")}/requests/${n.request_id}`;
  }

  const text = `🔔 *${n.title}*\n\nHello ${user.full_name},\n${details}${link ? `\n\nOpen: ${link}` : ""}`;
  try {
    await sendWhatsApp(user.phone, text, { "1": n.title, "2": details.replace(/\n/g, " | "), "3": link || "-" });
    await mark("sent");
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    console.error("whatsapp-notify:", msg);
    await mark("failed", msg.slice(0, 500));
    return json({ ok: false, error: msg });
  }
}));
