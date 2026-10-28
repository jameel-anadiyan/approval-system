// POST /functions/v1/approve-request   { request_id, app_url? }
// The signing run: begin_approval (service role) → download seal, signature, documents →
// stamp each file → build packet → upload (no overwrite) → finalize_approval.
// On any error: abort_approval (status goes back, approval number stays reserved).
import { getCaller, handle, HttpError, json, readJson, requireUuid } from "./common.ts";
import { buildPacket, stampDocument, type StampContext } from "./stamp.ts";

const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted", resubmitted: "Resubmitted after correction", routed_A: "Routed to A (Admin)",
  routed_B: "Routed to B (Head)", routed_own_A: "Routed own request to A", routed_own_B: "Routed own request to B",
  forwarded: "Reviewed and forwarded to Admin", returned: "Returned for correction", rejected: "Rejected",
  withdrawn: "Withdrawn", approved: "Approved", paid: "Marked as paid",
};

function ist(d: string | Date, withTime = true): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
    }).formatToParts(new Date(d)).map((p) => [p.type, p.value]),
  );
  const date = `${parts.day} ${parts.month} ${parts.year}`;
  return withTime ? `${date}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()} IST` : date;
}

const inr = (n: number) => `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

function safeName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || "document").slice(0, 40);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function appOrigin(v: unknown): string | null {
  if (typeof v !== "string") return Deno.env.get("APP_URL") ?? null;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
  } catch { /* ignore */ }
  return Deno.env.get("APP_URL") ?? null;
}

Deno.serve(handle(async (req) => {
  const { admin, me } = await getCaller(req);
  if (me.role !== "admin" && me.role !== "head") throw new HttpError(403, "forbidden", "Only a Head or Admin can approve.");
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);
  const requestId = requireUuid(body.request_id, "Request");

  const { data: begun, error: bErr } = await admin.rpc("begin_approval", { p_request_id: requestId, p_approver_id: me.id });
  if (bErr) throw new HttpError(409, "cannot_approve", bErr.message);
  // deno-lint-ignore no-explicit-any
  const b = begun as any;

  try {
    const download = async (bucket: string, path: string) => {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) throw new Error(`Could not read ${path.split("/").pop()}`);
      return new Uint8Array(await data.arrayBuffer());
    };
    const [seal, signature] = await Promise.all([
      download("credentials", b.seal_path), download("credentials", b.signature_path),
    ]);
    const origin = appOrigin(body.app_url);
    const r = b.request;
    const approverObj = b.approver ?? me;
    const approverLine = [approverObj.full_name, approverObj.designation, approverObj.department ?? (approverObj.role === "admin" || me.role === "admin" ? "Administration" : null)]
      .filter(Boolean).join(", ");
    const ctx: StampContext = {
      approvalNo: b.approval_no,
      approverLine,
      dateTime: ist(b.decided_at),
      requestNo: r.request_no,
      amount: r.request_type === "stock_transfer"
        ? `Stock Transfer (MRP: ${inr(Number(r.amount))})`
        : r.request_type === "non_cash"
          ? "Non-Cash (No payment)"
          : inr(Number(r.amount)),
      reviewedLine: r.route === "A" && r.reviewed_by_name && r.reviewed_at
        ? `Reviewed by: ${r.reviewed_by_name}, ${ist(r.reviewed_at, false)}` : null,
      verifyUrl: origin ? `${origin}/verify/${r.verify_token}` : null,
      seal, signature,
    };

    // Clear leftovers from an earlier failed run for this approval number (never finalized).
    const { data: existing } = await admin.storage.from("signed-documents").list(requestId, { limit: 100 });
    const stale = (existing ?? []).filter((o) => o.name.startsWith(b.approval_no)).map((o) => `${requestId}/${o.name}`);
    if (stale.length) await admin.storage.from("signed-documents").remove(stale);

    // deno-lint-ignore no-explicit-any
    const files: any[] = b.files;
    if (!files.length) throw new Error("No documents to sign");
    const signedBytes: Uint8Array[] = [];
    const records: Record<string, unknown>[] = [];
    const docsInfo: { name: string; pages: number }[] = [];

    // One file at a time to keep memory low.
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const src = await download("request-files", f.storage_path);
      let out;
      try {
        out = await stampDocument(src, ctx);
      } catch (e) {
        throw new Error(`Could not stamp "${f.original_name}": ${e instanceof Error ? e.message : e}`);
      }
      const fileName = `${b.approval_no}_${String(i + 1).padStart(2, "0")}_${safeName(f.original_name)}.pdf`;
      const path = `${requestId}/${fileName}`;
      const { error } = await admin.storage.from("signed-documents")
        .upload(path, out.bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      signedBytes.push(out.bytes);
      docsInfo.push({ name: f.original_name, pages: out.pageCount });
      records.push({ source_file_id: f.id, is_packet: false, file_name: fileName, storage_path: path,
        sha256: await sha256(out.bytes), page_count: out.pageCount });
    }

    const packet = await buildPacket({
      title: r.title,
      rows: [
        ["Approval No", b.approval_no],
        ["Request No", r.request_no],
        ["Amount", r.request_type === "stock_transfer" ? `Total MRP: ${inr(Number(r.amount))} (Stock Transfer)` : r.request_type === "non_cash" ? "Non-Cash (No payment)" : inr(Number(r.amount))],
        ["Department", r.department ?? "—"],
        ["Requested by", r.requester_name],
        ["Submitted", r.submitted_at ? ist(r.submitted_at) : "—"],
        ["Route", r.route === "A" ? "A — Admin approval" : "B — Head approval"],
        ["Approved by", approverLine],
        ["Approved on", ctx.dateTime],
      ],
      notes: r.notes,
      documents: docsInfo,
      // deno-lint-ignore no-explicit-any
      timeline: [...(b.timeline as any[]).map((t) => ({
        when: ist(t.created_at), who: t.actor_name, what: ACTION_LABEL[t.action] ?? t.action, remarks: t.remarks,
      })), { when: ctx.dateTime, who: approverObj.full_name, what: `Approved · ${b.approval_no}`, remarks: null }],
    }, signedBytes, ctx);
    const packetName = `${b.approval_no}_packet.pdf`;
    const packetPath = `${requestId}/${packetName}`;
    const { error: pErr } = await admin.storage.from("signed-documents")
      .upload(packetPath, packet.bytes, { contentType: "application/pdf", upsert: false });
    if (pErr) throw new Error(`Upload failed: ${pErr.message}`);
    records.unshift({ source_file_id: null, is_packet: true, file_name: packetName, storage_path: packetPath,
      sha256: await sha256(packet.bytes), page_count: packet.pageCount });

    const { error: fErr } = await admin.rpc("finalize_approval", {
      p_request_id: requestId, p_approver_id: me.id, p_files: records,
    });
    if (fErr) throw new Error(fErr.message);

    return json({ approval_no: b.approval_no, files: records.length, pages: packet.pageCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Signing failed:", msg);
    await admin.rpc("abort_approval", { p_request_id: requestId, p_approver_id: me.id, p_error: msg });
    throw new HttpError(500, "signing_failed", `Signing failed — try again. (${msg})`);
  }
}));
