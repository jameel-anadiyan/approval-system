// POST /functions/v1/send-whatsapp
// Actions:
//   - "test": sends a verification/test message to specified phone number
//   - "send_approval": sends the approved document packet and message for a request
import { getCaller, handle, HttpError, json, readJson, requireString, requireUuid } from "../_shared/common.ts";

const DEFAULT_CONFIG = {
  enabled: true,
  access_token: "EAAzRU40ZBcyoBS1Uyk7UgqBlRIvb407NufgvmPdZBmZCjGsZAiDBervAm9MGZAhkVyou64W2lDt64ZByltVjcRVwvdkndcEPsUZAi0DvoISgKKbRUEZCQZABpLslfpvcrM1fE19UXaVyZCEhaz2ebIZAvuWGpvQG2KZBJNfrksm5vRN44PCuRpco8riA6NnSan6uUgZDZD",
  phone_number_id: "1391767714024374",
  display_phone_number: "+91 80893 04002",
};

function cleanPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d.startsWith("0") && d.length === 11 ? `91${d.slice(1)}` : d;
}

Deno.serve(handle(async (req) => {
  const { admin, me } = await getCaller(req);
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);
  const action = requireString(body.action, "Action");

  // Fetch whatsapp_config from app_settings
  const { data: settingRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "whatsapp_config")
    .maybeSingle();

  // deno-lint-ignore no-explicit-any
  const cfg = { ...DEFAULT_CONFIG, ...((settingRow?.value as any) ?? {}) };

  if (action === "test") {
    if (me.role !== "admin" && me.role !== "head") {
      throw new HttpError(403, "forbidden", "Only Admin or Head can test WhatsApp integration.");
    }
    const toRaw = requireString(body.to, "Recipient phone number");
    const to = cleanPhone(toRaw);
    if (!to || to.length < 10) throw new HttpError(400, "bad_request", "Invalid recipient phone number.");

    const testText =
      `🔔 *WhatsApp Cloud API Test Message*\n\n` +
      `Hello from *SWA Diamonds*!\n\n` +
      `Your WhatsApp Cloud API integration has been tested and is fully operational.\n\n` +
      `• Sender: ${cfg.display_phone_number || "+91 80893 04002"}\n` +
      `• Tested by: ${me.full_name} (${me.role})\n` +
      `• Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST\n\n` +
      `✅ Approved documents will be automatically sent to staff and heads when approved.`;

    const waUrl = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
    const res = await fetch(waUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: testText },
      }),
    });

    const resJson = await res.json();
    if (!res.ok) {
      const err = resJson?.error?.message || `WhatsApp API error (${res.status})`;
      throw new HttpError(400, "whatsapp_error", err);
    }

    return json({ ok: true, message_id: resJson?.messages?.[0]?.id });
  }

  if (action === "send_approval") {
    const requestId = requireUuid(body.request_id, "Request");
    const { data: r, error: rErr } = await admin
      .from("requests")
      .select("*, requester:profiles!requester_id(*)")
      .eq("id", requestId)
      .maybeSingle();

    if (rErr || !r) throw new HttpError(404, "not_found", "Request not found.");
    if (r.status !== "approved" && r.status !== "paid") {
      throw new HttpError(400, "bad_request", "This request is not approved yet.");
    }

    const { data: signedFiles } = await admin
      .from("signed_files")
      .select("*")
      .eq("request_id", requestId)
      .order("is_packet", { ascending: false });

    const packet = (signedFiles ?? []).find((f: { is_packet: boolean }) => f.is_packet) || signedFiles?.[0];
    if (!packet) throw new HttpError(404, "no_packet", "No approved signed document found for this request.");

    const { data: urlData } = await admin.storage
      .from("signed-documents")
      .createSignedUrl(packet.storage_path, 60 * 60 * 24 * 7);

    const docUrl = urlData?.signedUrl;
    if (!docUrl) throw new HttpError(500, "url_failed", "Could not generate document link.");

    let targetPhone = body.to ? cleanPhone(body.to) : "";
    let recipientName = body.recipient_name || "";
    if (!targetPhone) {
      targetPhone = cleanPhone(r.requester?.whatsapp_number || "");
      recipientName = r.requester?.full_name || r.requester_name;
    }
    if (!targetPhone) throw new HttpError(400, "no_phone", "No WhatsApp number found for this requester.");

    const caption = `✅ *Your approval has been approved!*\nRequest No: ${r.request_no}\nApproval No: ${r.approval_no}\nAmount: Rs. ${r.amount}`;
    const messageBody =
      `✅ *YOUR APPROVAL HAS BEEN APPROVED*\n\n` +
      `Dear *${recipientName || "Staff Member"}*,\n\n` +
      `Your request has been approved and officially sealed.\n\n` +
      `📋 *Request No:* ${r.request_no}\n` +
      `🎉 *Approval No:* ${r.approval_no}\n` +
      `📝 *Subject:* ${r.title || "—"}\n` +
      `💰 *Amount:* Rs. ${Number(r.amount).toLocaleString("en-IN")}\n` +
      `🏢 *Outlet:* ${r.shop_name || "—"}\n\n` +
      `📄 *The official signed approval document packet is attached above.*`;

    const waUrl = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
    const res = await fetch(waUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: targetPhone,
        type: "document",
        document: {
          link: docUrl,
          caption,
          filename: `${r.approval_no}_Approved_Document.pdf`,
        },
      }),
    });

    const resJson = await res.json();
    if (!res.ok) {
      const err = resJson?.error?.message || `WhatsApp API error (${res.status})`;
      throw new HttpError(400, "whatsapp_error", err);
    }

    // Follow-up text message
    await fetch(waUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: targetPhone,
        type: "text",
        text: { body: messageBody },
      }),
    }).catch(() => {});

    await admin.from("whatsapp_logs").insert({
      request_id: requestId,
      recipient_phone: targetPhone,
      recipient_name: recipientName || null,
      message_type: "document",
      status: "sent",
      meta_message_id: resJson?.messages?.[0]?.id || null,
      details: { approval_no: r.approval_no, request_no: r.request_no },
    }).catch(() => {});

    return json({ ok: true, message_id: resJson?.messages?.[0]?.id, recipient: targetPhone });
  }

  throw new HttpError(400, "bad_request", `Unknown action: ${action}`);
}));
