// POST /functions/v1/sign-clarification-files   { request_id, app_url? }
// Stamps documents a Head attached while answering a Disbursement clarification and adds them to the
// request's Signed Documents. Each page gets an "ADDENDUM" badge with the attaching Head's own seal and
// signature (the original approver never saw these files), and the pages are appended to the packet.
// Idempotent: files that already have a signed copy are skipped.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { getCaller, handle, HttpError, json, readJson, requireUuid } from "../_shared/common.ts";
import { stampDocument, type StampContext } from "../approve-request/stamp.ts";

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
  if (me.role !== "admin" && me.role !== "head") throw new HttpError(403, "forbidden", "Only a Head or Admin can do this.");
  // deno-lint-ignore no-explicit-any
  const body = await readJson<any>(req);
  const requestId = requireUuid(body.request_id, "Request");

  const { data: r, error: rErr } = await admin
    .from("requests").select("*, department:departments(name)").eq("id", requestId).maybeSingle();
  if (rErr) throw new HttpError(500, "server_error", rErr.message);
  if (!r) throw new HttpError(404, "not_found", "Request not found.");
  if (!["approved", "paid"].includes(r.status) || !r.approval_no) {
    throw new HttpError(409, "not_approved", "Only approved requests can receive signed addenda.");
  }
  if (me.role === "head" && r.owner_head_id !== me.id && r.department_id !== me.department_id) {
    throw new HttpError(403, "forbidden", "Only the request owner Head can sign these files.");
  }

  const { data: files, error: fErr } = await admin
    .from("request_files").select("*")
    .eq("request_id", requestId).eq("kind", "document").not("clarification_id", "is", null)
    .order("created_at", { ascending: true });
  if (fErr) throw new HttpError(500, "server_error", fErr.message);
  const { data: signedRows, error: sErr } = await admin
    .from("signed_files").select("*").eq("request_id", requestId);
  if (sErr) throw new HttpError(500, "server_error", sErr.message);

  const alreadySigned = new Set((signedRows ?? []).map((s) => s.source_file_id).filter(Boolean));
  const pending = (files ?? []).filter((f) => !alreadySigned.has(f.id));
  if (!pending.length) return json({ signed: 0 });

  const { data: cred } = await admin
    .from("approver_credentials").select("seal_path, signature_path").eq("user_id", me.id).maybeSingle();
  if (!cred?.seal_path || !cred?.signature_path) {
    throw new HttpError(400, "no_credentials", "Your seal and signature are not set up yet. Ask Admin to add them, then try again.");
  }

  const download = async (bucket: string, path: string) => {
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) throw new HttpError(500, "download_failed", `Could not read ${path.split("/").pop()}`);
    return new Uint8Array(await data.arrayBuffer());
  };
  const [seal, signature] = await Promise.all([
    download("credentials", cred.seal_path), download("credentials", cred.signature_path),
  ]);

  let deptName: string | null = null;
  if (me.department_id) {
    const { data: d } = await admin.from("departments").select("name").eq("id", me.department_id).maybeSingle();
    deptName = d?.name ?? null;
  }
  const origin = appOrigin(body.app_url);
  const ctx: StampContext = {
    approvalNo: r.approval_no,
    headline: `ADDENDUM · Approval No: ${r.approval_no}`,
    byLabel: "Added by",
    approverLine: [me.full_name, me.designation, deptName ?? (me.role === "admin" ? "Administration" : null)]
      .filter(Boolean).join(", "),
    dateTime: ist(new Date()),
    requestNo: r.request_no,
    amount: inr(Number(r.amount)),
    reviewedLine: `Original approval: ${r.approver_name ?? "-"}${r.decided_at ? `, ${ist(r.decided_at, false)}` : ""}`,
    verifyUrl: origin ? `${origin}/verify/${r.verify_token}` : null,
    seal, signature,
  };

  let n = (signedRows ?? []).filter((s) => !s.is_packet).length;
  const newBytes: Uint8Array[] = [];
  const uploadedPaths: string[] = [];
  // deno-lint-ignore no-explicit-any
  const records: any[] = [];
  try {
    for (const f of pending) {
      const src = await download("request-files", f.storage_path);
      let out;
      try {
        out = await stampDocument(src, ctx);
      } catch (e) {
        throw new Error(`Could not stamp "${f.original_name}": ${e instanceof Error ? e.message : e}`);
      }
      const fileName = `${r.approval_no}_${String(++n).padStart(2, "0")}_addendum_${safeName(f.original_name)}_${crypto.randomUUID().slice(0, 6)}.pdf`;
      const path = `${requestId}/${fileName}`;
      const { error } = await admin.storage.from("signed-documents")
        .upload(path, out.bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      uploadedPaths.push(path);
      newBytes.push(out.bytes);
      records.push({
        request_id: requestId, source_file_id: f.id, is_packet: false, file_name: fileName, storage_path: path,
        sha256: await sha256(out.bytes), page_count: out.pageCount,
      });
    }

    // Append the new signed pages to the packet (new object; the old packet object is kept for audit).
    const packetRow = (signedRows ?? []).find((s) => s.is_packet);
    let packetUpdate: Record<string, unknown> | null = null;
    if (packetRow) {
      const packet = await PDFDocument.load(await download("signed-documents", packetRow.storage_path));
      for (const bytes of newBytes) {
        const src = await PDFDocument.load(bytes);
        const copied = await packet.copyPages(src, src.getPageIndices());
        copied.forEach((p) => packet.addPage(p));
      }
      const packetBytes = await packet.save({ useObjectStreams: true });
      const packetName = `${r.approval_no}_packet_rev${Date.now()}.pdf`;
      const packetPath = `${requestId}/${packetName}`;
      const { error } = await admin.storage.from("signed-documents")
        .upload(packetPath, packetBytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`Packet upload failed: ${error.message}`);
      uploadedPaths.push(packetPath);
      packetUpdate = {
        file_name: packetName, storage_path: packetPath, sha256: await sha256(packetBytes),
        page_count: packet.getPageCount(),
      };
    }

    const { error: insErr } = await admin.from("signed_files").insert(records);
    if (insErr) throw new Error(insErr.message);
    if (packetRow && packetUpdate) {
      const { error: upErr } = await admin.from("signed_files").update(packetUpdate).eq("id", packetRow.id);
      if (upErr) throw new Error(upErr.message);
    }
  } catch (e) {
    if (uploadedPaths.length) await admin.storage.from("signed-documents").remove(uploadedPaths);
    const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
    throw new HttpError(500, "signing_failed", `Could not add files to signed documents — try again. (${msg})`);
  }

  await admin.from("request_actions").insert({
    request_id: requestId, actor_id: me.id, actor_name: me.full_name, actor_role: me.role,
    action: "clarification_files_signed", from_status: r.status, to_status: r.status,
    remarks: `${records.length} clarification file(s) stamped and added to signed documents`,
    visible_to_requester: false,
  });

  return json({ signed: records.length });
}));
