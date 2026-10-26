// POST /functions/v1/approve-request   { request_id, app_url? }
// The signing run: begin_approval (service role) → download seal, signature, documents →
// stamp each file → build packet → upload (no overwrite) → finalize_approval.
// On any error: abort_approval (status goes back, approval number stays reserved).
import { getCaller, handle, HttpError, json, readJson, requireUuid } from "../_shared/common.ts";
import { buildFormPdf, buildPacket, type FormSection, stampDocument, type StampContext } from "./stamp.ts";

const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted", resubmitted: "Resubmitted after correction", routed_A: "Routed to A (Admin)",
  routed_B: "Routed to B (Head)", routed_own_A: "Routed own request to A", routed_own_B: "Routed own request to B",
  forwarded: "Reviewed and forwarded to Admin", returned: "Returned for correction", rejected: "Rejected",
  withdrawn: "Withdrawn", approved: "Approved", paid: "Marked as paid",
  sent_for_quote_selection: "Sent for quotation selection", quote_selected: "Best quotation selected",
  regional_forwarded: "Forwarded by Regional Head to clerk",
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

const TYPE_LABEL: Record<string, string> = {
  general: "General", discount: "Discount approval", exhibition: "Exhibition / event sponsorship",
  asset: "Asset buying", asset_below_20k: "Asset buying below 20k", non_cash: "Non-cash request",
  stock_transfer: "Stock transfer",
};
const PROVIDES: Record<string, string> = {
  stall_space: "Stall space", table_chairs: "Table & chairs", electricity_lights: "Electricity & lights",
  logo_stage_banners: "Logo on stage / banners", stage_announcements: "Stage announcements",
  social_media: "Social media mentions", other: "Other",
};

// deno-lint-ignore no-explicit-any
function formSections(r: any, submitted: string, files: any[] = []): { subtitle: string; sections: FormSection[] } | null {
  const d = r.details ?? {};
  const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : inr(Number(v)));
  const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  if (r.request_type === "discount") {
    return {
      subtitle: "DISCOUNT APPROVAL FORM",
      sections: [
        { title: "Request", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)], ["Subject", txt(r.title)],
          ["Customer", txt(d.customer_name)], ["Bill / Ref No", txt(d.reference)],
        ] },
        { title: "Discount", rows: [
          ["Amount before discount", money(d.before_amount)], ["Amount after discount", money(d.after_amount)],
          ["Discount amount", money(d.discount_amount)], ["Discount %", `${Number(d.discount_pct ?? 0).toFixed(2)} %`],
        ] },
        { title: "Remarks", text: r.notes ?? "" },
      ],
    };
  }
  if (r.request_type === "exhibition") {
    const provides = (Array.isArray(d.provides) ? d.provides : []).map((p: string) => PROVIDES[p] ?? p);
    if (d.provides_other) provides.push(`Other: ${d.provides_other}`);
    return {
      subtitle: "EVENT SPONSORSHIP & PROMOTION APPROVAL FORM",
      sections: [
        { title: "Request", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Outlet", txt(r.shop_name)],
        ] },
        { title: "1  Event details", rows: [
          ["Event Name", txt(d.event_name)], ["Organiser & Contact", txt(d.organiser_contact)],
          ["Venue", txt(d.venue)], ["Event Date(s) & Time", txt(d.event_dates)],
          ["Expected Footfall", txt(d.expected_footfall)], ["Stall Size & Location", txt(d.stall_size_location)],
        ] },
        { title: "2  Sponsorship amount", rows: [
          ["Amount (excl. GST)", money(d.amount_excl_gst)], [`GST ${Number(d.gst_pct ?? 0)} %`, money(d.gst_amount)],
          ["Total incl. GST", money(d.total_incl_gst)], ["Payment Mode & Due Date", txt(d.payment_mode_due)],
          ["Organiser GSTIN", txt(d.organiser_gstin)], ["GST Invoice Provided", d.gst_invoice ? "Yes" : "No"],
        ] },
        { title: "3  Event team will provide", text: provides.length ? provides.join("  ·  ") : "—" },
        { title: "4  Our promotion plan", rows: [
          ["Rs. 1,000 Vouchers (Qty)", txt(d.voucher_1000_qty)], ["Rs. 500 Vouchers (Qty)", txt(d.voucher_500_qty)],
          ["Rs. 1,000 Voucher Min. Purchase", money(d.voucher_1000_min)], ["Rs. 500 Voucher Min. Purchase", money(d.voucher_500_min)],
          ["Voucher Validity", txt(d.voucher_validity)], ["Lucky Draw Prize & Value", txt(d.lucky_draw)],
          ["No. of Winners & Draw Date", txt(d.winners_draw)], ["Other Costs (printing, branding, staff)", money(d.other_costs)],
          ["Total Budget", money(d.total_budget)],
        ] },
        { title: "5  Purpose / expected result", text: d.purpose ?? "" },
        ...(r.notes ? [{ title: "Remarks", text: r.notes as string }] : []),
      ],
    };
  }
  if (r.request_type === "asset" || r.request_type === "asset_below_20k") {
    // deno-lint-ignore no-explicit-any
    const quotes = (files ?? []).filter((f: any) => f.quote_amount !== null && f.quote_amount !== undefined);
    const lowest = quotes.length ? Math.min(...quotes.map((q: { quote_amount: number }) => Number(q.quote_amount))) : null;
    // deno-lint-ignore no-explicit-any
    const quoteRows: [string, string][] = quotes.map((q: any, i: number) => [
      `Q${i + 1} · ${q.quote_vendor ?? q.original_name}`,
      [money(q.quote_amount), q.quote_status === "selected" ? "SELECTED" : "REJECTED",
        q.quote_preferred ? "Requester's choice" : null,
        Number(q.quote_amount) === lowest ? "Lowest" : null].filter(Boolean).join("  ·  "),
    ]);
    return {
      subtitle: "ASSET PURCHASE APPROVAL FORM",
      sections: [
        { title: "Request", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)], ["Subject", txt(r.title)],
        ] },
        { title: "Asset", rows: [
          ["Asset", txt(d.asset_name)], ["Quantity", txt(d.quantity)],
          ["Specification", txt(d.specification)],
        ] },
        { title: "Quotation comparison", rows: [
          ...quoteRows,
          ["Approved amount", money(r.amount)],
          ["Quotation selected by", [r.quote_selected_by_name, r.quote_selected_at ? ist(r.quote_selected_at) : null].filter(Boolean).join(", ") || "—"],
        ] },
        ...(d.purpose ? [{ title: "Purpose", text: d.purpose as string }] : []),
        ...(r.notes ? [{ title: "Remarks", text: r.notes as string }] : []),
      ],
    };
  }
  if (r.request_type === "stock_transfer") {
    const isBulk = d.transfer_mode === "bulk";
    // deno-lint-ignore no-explicit-any
    const items = Array.isArray(d.items) ? d.items : [];
    // deno-lint-ignore no-explicit-any
    const itemRows: [string, string][] = items.map((item: any, i: number) => [
      `Item ${i + 1} · ${item.category_name ?? "Product"}`,
      `Barcode: ${item.barcode || "—"} | SKU: ${item.sku || "—"} | Wt: ${item.gross_weight_grams ? `${item.gross_weight_grams} g` : "—"} | MRP: ${money(item.mrp)}`,
    ]);

    return {
      subtitle: "STOCK TRANSFER APPROVAL FORM",
      sections: [
        { title: "Transfer Details", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Origin Shop (From)", txt(d.from_shop_name ?? r.shop_name)],
          ["Destination Shop (To)", txt(d.to_shop_name)], ["Transfer Mode", isBulk ? "Bulk Transfer (4+ Items)" : "Itemized Transfer"],
          ["Total Pieces", txt(d.total_pieces ?? items.length)],
          ["Total Gross Weight", d.total_gross_weight_grams ? `${d.total_gross_weight_grams} g` : "—"],
          ["Total MRP Value", money(d.total_mrp ?? r.amount)],
        ] },
        ...(isBulk ? [
          { title: "Bulk Transfer Summary", rows: [
            ["Product Category", txt(d.bulk_category_name)],
            ["Pieces", txt(d.total_pieces)],
            ["Gross Weight", d.total_gross_weight_grams ? `${d.total_gross_weight_grams} g` : "—"],
            ["Total MRP", money(d.total_mrp ?? r.amount)],
          ] }
        ] : items.length ? [
          { title: "Itemized Products", rows: itemRows }
        ] : []),
        ...(r.notes ? [{ title: "Remarks / Purpose", text: r.notes as string }] : []),
      ],
    };
  }
  return null;
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
    const approverLine = [b.approver.full_name, b.approver.designation, b.approver.department ?? (b.approver.role === "admin" ? "Administration" : null)]
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
    const form = formSections(r, r.submitted_at ? ist(r.submitted_at, false) : "—", b.files);
    if (!files.length && !form) throw new Error("No documents to sign");
    const signedBytes: Uint8Array[] = [];
    const records: Record<string, unknown>[] = [];
    const docsInfo: { name: string; pages: number }[] = [];

    const store = async (bytes: Uint8Array, index: number, label: string, sourceId: string | null, pages: number,
      inPacket = true) => {
      const fileName = `${b.approval_no}_${String(index).padStart(2, "0")}_${safeName(label)}.pdf`;
      const path = `${requestId}/${fileName}`;
      const { error } = await admin.storage.from("signed-documents")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      // Asset buying: the combined packet carries only the form + the selected quotation.
      if (inPacket) {
        signedBytes.push(bytes);
        docsInfo.push({ name: label, pages });
      }
      records.push({ source_file_id: sourceId, is_packet: false, file_name: fileName, storage_path: path,
        sha256: await sha256(bytes), page_count: pages });
    };

    let n = 0;
    if (form) {
      const formPdf = await buildFormPdf("SWA DIAMONDS", form.subtitle, form.sections);
      const out = await stampDocument(formPdf, ctx);
      await store(
        out.bytes,
        ++n,
        r.request_type === "discount"
          ? "discount_form"
          : (r.request_type === "asset" || r.request_type === "asset_below_20k")
            ? "asset_purchase_form"
            : r.request_type === "stock_transfer"
              ? "stock_transfer_form"
              : "exhibition_form",
        null,
        out.pageCount
      );
    }

    // One file at a time to keep memory low.
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const src = await download("request-files", f.storage_path);
      const isQuote = (r.request_type === "asset" || r.request_type === "asset_below_20k") && f.quote_amount !== null && f.quote_amount !== undefined;
      const rejected = isQuote && f.quote_status !== "selected";
      const fileCtx: StampContext = !isQuote ? ctx : rejected
        ? { ...ctx, tone: "rejected",
            headline: `REJECTED QUOTATION · NOT SELECTED · Approval No: ${b.approval_no}`,
            byLabel: "Rejected by",
            amount: `${inr(Number(f.quote_amount))} quoted (not selected)` }
        : { ...ctx, headline: `APPROVED · SELECTED QUOTATION · Approval No: ${b.approval_no}` };
      let out;
      try {
        out = await stampDocument(src, fileCtx);
      } catch (e) {
        throw new Error(`Could not stamp "${f.original_name}": ${e instanceof Error ? e.message : e}`);
      }
      const label = !isQuote ? f.original_name
        : `${rejected ? "REJECTED" : "SELECTED"}_${f.quote_vendor ?? "quote"}_${f.original_name}`;
      await store(out.bytes, ++n, label, f.id, out.pageCount, !rejected);
    }

    const packet = await buildPacket({
      title: r.title,
      rows: [
        ["Approval No", b.approval_no],
        ["Request No", r.request_no],
        ["Type", TYPE_LABEL[r.request_type] ?? "General"],
        ["Amount", r.request_type === "stock_transfer" ? `Total MRP: ${inr(Number(r.amount))} (Stock Transfer)` : r.request_type === "non_cash" ? "Non-Cash (No payment)" : inr(Number(r.amount))],
        ["Department", r.department ?? "—"],
        ["Shop", r.shop_name ?? "—"],
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
      })), { when: ctx.dateTime, who: b.approver.full_name, what: `Approved · ${b.approval_no}`, remarks: null }],
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
