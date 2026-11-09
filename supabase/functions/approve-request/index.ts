// POST /functions/v1/approve-request   { request_id, app_url? }
// The signing run: begin_approval (service role) → download seal, signature, documents →
// stamp each file → build packet → upload (no overwrite) → finalize_approval.
// On any error: abort_approval (status goes back, approval number stays reserved).
import { getCaller, handle, HttpError, json, readJson, requireUuid } from "../_shared/common.ts";
import { buildFormPdf, buildPacket, type FormSection, stampDocument, type StampContext } from "./stamp.ts";

const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted", resubmitted: "Resubmitted after correction", routed_A: "Routed to A (Admin)",
  routed_B: "Routed to B (Head)", routed_own_A: "Routed own request to A", routed_own_B: "Routed own request to B",
  route_changed_A: "Head changed route to A (Admin)", route_changed_B: "Head changed route to B (Head)",
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
  general: "General", petty_cash: "Petty Cash (Below 1000)", discount: "Discount approval", exhibition: "Exhibition / event sponsorship",
  asset: "Asset buying", asset_below_20k: "Asset buying below 20k", non_cash: "Non-cash request",
  stock_transfer: "Stock transfer",
  agreement: "Agreement",
  statutory_payment: "Statutory payment",
  audit_report: "Audit report",
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
          ["Invoice No", txt(d.invoice_no)], ["Date of Bill", txt(d.bill_date)],
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
    // Skip duplicate server form if client already synced Exhibition_Event_Approval_Form.pdf into files
    // deno-lint-ignore no-explicit-any
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? "").toLowerCase().includes("exhibition_event_approval_form")
    );
    if (alreadyUploaded) return null;

    const provides = (Array.isArray(d.provides) ? d.provides : []).map((p: string) => PROVIDES[p] ?? p);
    if (d.provides_other) provides.push(`Other: ${d.provides_other}`);
    const exhShop = typeof d.conducting_shop_name === "string" && d.conducting_shop_name.trim()
      ? d.conducting_shop_name.trim()
      : "Not Assigned";
    const schedules = Array.isArray(d.daily_schedules) ? d.daily_schedules : [];
    const scheduleSummary = schedules.length > 0
      ? `${schedules.length} Day(s) (${Number(d.total_hours || 0).toFixed(1)} hrs total) · ${schedules.map((s: any) => `Day ${s.day_number || ''} [${s.date}]: ${s.from_time}-${s.to_time} (${s.hours}h)`).join(', ')}`
      : txt(d.event_dates);

    return {
      subtitle: "EVENT SPONSORSHIP & PROMOTION APPROVAL FORM",
      sections: [
        { title: "Request", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Outlet", exhShop],
        ] },
        { title: "1  Event details", rows: [
          ["Conducting Shop", exhShop],
          ["Event Name", txt(d.event_name)], ["Organiser & Contact", txt(d.organiser_contact)],
          ["Venue", txt(d.venue)], ["Event Date(s) & Time", txt(d.event_dates)],
          ["Daily Schedule & Hours", scheduleSummary],
          ["Expected Footfall", txt(d.expected_footfall)], ["Stall Size & Location", txt(d.stall_size_location)],
        ] },
        { title: "2  Sponsorship amount", rows: [
          ["Amount (excl. GST)", money(d.amount_excl_gst)],
          [d.gst_pct ? `GST Amount (~${Number(d.gst_pct)}%)` : "GST Amount", money(d.gst_amount)],
          ...(d.round_off ? [["Round-off (nearest Rs. 1)", money(d.round_off)]] : []),
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
  if (r.request_type === "non_cash") {
    const val = Number(d.associated_value || 0);
    return {
      subtitle: "NON-CASH APPROVAL FORM",
      sections: [
        { title: "Request", rows: [
          ["Request No", txt(r.request_no)], ["Date", submitted],
          ["Requested by", txt(r.requester_name)], ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)], ["Subject / Title", txt(r.title)],
          ["Payment Consideration", "Non-Cash (No direct disbursement)"],
        ] },
        ...(val > 0 || d.associated_notes ? [
          { title: "Associated Cash / Value / Adjustment (Not Paid Directly)", rows: [
            ...(val > 0 ? [["Associated Value", money(val)]] : []),
            ...(d.associated_notes ? [["Adjustment Details", txt(d.associated_notes)]] : []),
          ] }
        ] : []),
        ...(r.notes ? [{ title: "Remarks / Purpose", text: r.notes as string }] : []),
      ],
    };
  }
  if (r.request_type === "petty_cash") {
    // Skip duplicate server form if client already synced Petty_Cash_Form_Below_1000.pdf into files
    // deno-lint-ignore no-explicit-any
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? "").toLowerCase().includes("petty_cash_form_below_1000")
    );
    if (alreadyUploaded) return null;
    const payMode = String(r.disbursement_mode ?? d.disbursement_mode ?? "cash").toLowerCase() === "bank"
      ? "Bank Transfer"
      : "Cash (Default)";
    return {
      subtitle: "PETTY CASH FORM BELOW 1000",
      sections: [
        { title: "Petty Cash Voucher Details (Max Rs. 1,000.00)", rows: [
          ["Request No", txt(r.request_no)],
          ["Date", submitted],
          ["Requested by", txt(r.requester_name)],
          ["Outlet / Shop", txt(r.shop_name)],
          ["Petty Cash Dealing Head", txt(r.owner_head_name ?? r.department)],
          ["Disbursement Entry Account", txt(r.assigned_entry_user_name)],
          ["Payment Mode", payMode],
          ["Requested Amount (<= Rs. 1,000)", money(r.amount)],
        ] },
        { title: "Mandatory Note / Purpose", text: r.notes ?? "-" },
      ],
    };
  }
  if (r.request_type === "agreement") {
    // deno-lint-ignore no-explicit-any
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? "").toLowerCase().includes("agreement_approval_form")
    );
    if (alreadyUploaded) return null;
    return {
      subtitle: "AGREEMENT APPROVAL FORM",
      sections: [
        { title: "Agreement Request Details", rows: [
          ["Request No", txt(r.request_no)],
          ["Date", submitted],
          ["Requested by", txt(r.requester_name)],
          ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)],
          ["Agreement Title", txt(r.title)],
          ["Consideration", "Non-Cash Item (No Disbursement Required)"],
          ["Approval Route", "Route B — Department Head Approval Only"],
        ] },
        { title: "Description", text: r.notes ?? d.description ?? "-" },
      ],
    };
  }
  if (r.request_type === "statutory_payment") {
    // deno-lint-ignore no-explicit-any
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? "").toLowerCase().includes("statutory_payment_approval_form")
    );
    if (alreadyUploaded) return null;
    return {
      subtitle: "STATUTORY PAYMENT APPROVAL FORM",
      sections: [
        { title: "Statutory Payment Details", rows: [
          ["Request No", txt(r.request_no)],
          ["Date", submitted],
          ["Requested by", txt(r.requester_name)],
          ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)],
          ["Title", txt(r.title)],
          ["Payment Amount", money(d.payment_amount ?? r.amount)],
          ["Payment Date", txt(d.payment_date)],
          ["Due Date", txt(d.due_date)],
          ["Approval Route", "Route B — Department Head Approval Only"],
        ] },
        { title: "Description", text: r.notes ?? d.description ?? "-" },
      ],
    };
  }
  if (r.request_type === "audit_report") {
    // deno-lint-ignore no-explicit-any
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? "").toLowerCase().includes("audit_report_approval_form")
    );
    if (alreadyUploaded) return null;
    return {
      subtitle: "AUDIT REPORT APPROVAL FORM",
      sections: [
        { title: "Audit Report Details", rows: [
          ["Request No", txt(r.request_no)],
          ["Date", submitted],
          ["Requested by", txt(r.requester_name)],
          ["Outlet / Shop", txt(r.shop_name)],
          ["Department", txt(r.department)],
          ["Report Title", txt(r.title)],
          ["Audit Report of Which Firm", txt(d.audit_firm)],
          ["Audit Period", `${txt(d.audit_from_date)} to ${txt(d.audit_to_date)}`],
          ["Consideration", "Non-Cash Item (No Disbursement Required)"],
          ["Approval Authority", "Administrator Approval Only"],
        ] },
        { title: "Description", text: r.notes ?? d.description ?? "-" },
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
          : r.request_type === "agreement"
            ? "Agreement (Non-Cash)"
            : r.request_type === "audit_report"
              ? "Audit Report (Non-Cash)"
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
          : r.request_type === "petty_cash"
            ? "petty_cash_form_below_1000"
            : r.request_type === "agreement"
              ? "agreement_approval_form"
              : r.request_type === "statutory_payment"
                ? "statutory_payment_approval_form"
                : r.request_type === "audit_report"
                  ? "audit_report_approval_form"
                  : (r.request_type === "asset" || r.request_type === "asset_below_20k")
                    ? "asset_purchase_form"
                    : r.request_type === "stock_transfer"
                      ? "stock_transfer_form"
                      : r.request_type === "non_cash"
                        ? "non_cash_form"
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
        ["Amount", r.request_type === "stock_transfer" ? `Total MRP: ${inr(Number(r.amount))} (Stock Transfer)` : r.request_type === "non_cash" ? "Non-Cash (No payment)" : r.request_type === "agreement" ? "Agreement (Non-Cash · No Disbursement)" : r.request_type === "audit_report" ? "Audit Report (Non-Cash · No Disbursement)" : inr(Number(r.amount))],
        ["Department", r.department ?? "—"],
        ["Shop", r.request_type === "exhibition"
          ? ((typeof r.details?.conducting_shop_name === "string" && r.details.conducting_shop_name.trim()) ? r.details.conducting_shop_name.trim() : "Not Assigned")
          : (r.shop_name ?? "—")],
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

    // ------------------------------------------------------------------------
    // Automatic WhatsApp Cloud API Dispatch (when not delegated to client)
    // ------------------------------------------------------------------------
    const whatsappResults: { recipient: string; ok: boolean; error?: string }[] = [];
    if (!body.skip_whatsapp) {
      try {
        // 1. Get 7-day signed download URL for the packet PDF as fallback
        const { data: signUrlData } = await admin.storage
          .from("signed-documents")
          .createSignedUrl(packetPath, 60 * 60 * 24 * 7);

        const packetDownloadUrl = signUrlData?.signedUrl;

        // 2. Fetch WhatsApp settings
        const { data: settingRow } = await admin
          .from("app_settings")
          .select("value")
          .eq("key", "whatsapp_config")
          .maybeSingle();

        const defaultCfg = {
          enabled: true,
          access_token: "EAAzRU40ZBcyoBS1Uyk7UgqBlRIvb407NufgvmPdZBmZCjGsZAiDBervAm9MGZAhkVyou64W2lDt64ZByltVjcRVwvdkndcEPsUZAi0DvoISgKKbRUEZCQZABpLslfpvcrM1fE19UXaVyZCEhaz2ebIZAvuWGpvQG2KZBJNfrksm5vRN44PCuRpco8riA6NnSan6uUgZDZD",
          phone_number_id: "1391767714024374",
          notify_requester: true,
          notify_head: true,
          admin_phone_number: "+91 9846880713",
          template_language: "en",
          use_template: true,
        };

        // deno-lint-ignore no-explicit-any
        const cfg = { ...defaultCfg, ...((settingRow?.value as any) ?? {}) };

        if (cfg.enabled && cfg.access_token && cfg.phone_number_id) {
          // Upload stamped PDF bytes once to Meta Media API for DOCUMENT header template
          const docFilename = `${b.approval_no}_Approved_Document.pdf`;
          let mediaId: string | null = null;
          try {
            const mediaForm = new FormData();
            mediaForm.append("messaging_product", "whatsapp");
            mediaForm.append("type", "application/pdf");
            mediaForm.append(
              "file",
              new Blob([packet.bytes], { type: "application/pdf" }),
              docFilename
            );
            const mRes = await fetch(
              `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/media`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${cfg.access_token}` },
                body: mediaForm,
              }
            );
            const mJson = await mRes.json();
            if (mRes.ok && mJson?.id) {
              mediaId = String(mJson.id);
            }
          } catch (mErr) {
            console.warn("Edge media upload warning:", mErr);
          }

          // Collect recipients
          const recipients: { phone: string; name?: string }[] = [];

          // Requester WhatsApp
          if (cfg.notify_requester && r.requester_id) {
            const { data: reqProf } = await admin
              .from("profiles")
              .select("full_name, whatsapp_number, default_head_id")
              .eq("id", r.requester_id)
              .maybeSingle();

            if (reqProf?.whatsapp_number) {
              recipients.push({ phone: reqProf.whatsapp_number, name: reqProf.full_name || r.requester_name });
            }

            // Head WhatsApp
            if (cfg.notify_head && reqProf?.default_head_id) {
              const { data: headProf } = await admin
                .from("profiles")
                .select("full_name, whatsapp_number")
                .eq("id", reqProf.default_head_id)
                .maybeSingle();
              if (headProf?.whatsapp_number) {
                recipients.push({ phone: headProf.whatsapp_number, name: headProf.full_name || "Department Head" });
              }
            }
          }

          // Owner Head (if different)
          if (cfg.notify_head && r.owner_head_id && !recipients.some((x) => x.name?.includes("Head"))) {
            const { data: ownerProf } = await admin
              .from("profiles")
              .select("full_name, whatsapp_number")
              .eq("id", r.owner_head_id)
              .maybeSingle();
            if (ownerProf?.whatsapp_number) {
              recipients.push({ phone: ownerProf.whatsapp_number, name: ownerProf.full_name || "Head" });
            }
          }

          // Admin notification copy
          if (cfg.admin_phone_number && cfg.admin_phone_number.trim()) {
            recipients.push({ phone: cfg.admin_phone_number.trim(), name: "Admin Notification" });
          }

          const cleanPhone = (p: string) => {
            const d = p.replace(/\D/g, "");
            return d.length === 10 ? `91${d}` : d.startsWith("0") && d.length === 11 ? `91${d.slice(1)}` : d;
          };

          const seenPhones = new Set<string>();
          const uniqueRecipients = recipients.filter((x) => {
            const c = cleanPhone(x.phone);
            if (!c || c.length < 10 || seenPhones.has(c)) return false;
            seenPhones.add(c);
            return true;
          });

          const outletLabel =
            r.request_type === "exhibition"
              ? ((typeof r.details?.conducting_shop_name === "string" && r.details.conducting_shop_name.trim()) || r.shop_name || "All Outlets")
              : (r.shop_name || "All Outlets");

          const bodyParams = [
            r.requester_name || "Staff Member",
            r.request_no || "REQ",
            b.approval_no,
            r.title || "Official Approval",
            outletLabel,
            ctx.amount,
            approverObj.full_name || "Authorized Head / Admin",
            ctx.dateTime,
          ];

          const caption = `✅ *Your approval has been approved!*\nRequest No: ${r.request_no}\nApproval No: ${b.approval_no}\nAmount: ${ctx.amount}`;
          const waUrl = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;

          for (const target of uniqueRecipients) {
            const targetPhone = cleanPhone(target.phone);
            try {
              const docObj = mediaId
                ? { id: mediaId, filename: docFilename }
                : packetDownloadUrl
                  ? { link: packetDownloadUrl, filename: docFilename }
                  : null;

              let res = await fetch(waUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${cfg.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(
                  docObj && cfg.use_template !== false
                    ? {
                        messaging_product: "whatsapp",
                        recipient_type: "individual",
                        to: targetPhone,
                        type: "template",
                        template: {
                          name: "approval_document_packet",
                          language: { code: cfg.template_language || "en" },
                          components: [
                            {
                              type: "header",
                              parameters: [{ type: "document", document: docObj }],
                            },
                            {
                              type: "body",
                              parameters: bodyParams.map((p) => ({ type: "text", text: String(p) })),
                            },
                          ],
                        },
                      }
                    : {
                        messaging_product: "whatsapp",
                        recipient_type: "individual",
                        to: targetPhone,
                        type: "document",
                        document: mediaId
                          ? { id: mediaId, caption, filename: docFilename }
                          : { link: packetDownloadUrl, caption, filename: docFilename },
                      }
                ),
              });

              let resJson = await res.json();

              // Fallback to body-only template if approval_document_packet is still under Meta review
              if (!res.ok && docObj && cfg.use_template !== false) {
                if (mediaId || packetDownloadUrl) {
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
                      type: "document",
                      document: mediaId
                        ? { id: mediaId, caption, filename: docFilename }
                        : { link: packetDownloadUrl, caption, filename: docFilename },
                    }),
                  }).catch(() => {});
                }
                res = await fetch(waUrl, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${cfg.access_token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: targetPhone,
                    type: "template",
                    template: {
                      name: "approval_notification",
                      language: { code: cfg.template_language || "en" },
                      components: [
                        {
                          type: "body",
                          parameters: bodyParams.map((p) => ({ type: "text", text: String(p) })),
                        },
                      ],
                    },
                  }),
                });
                resJson = await res.json();
              }

              const isOk = res.ok;
              const metaId = resJson?.messages?.[0]?.id;
              const errStr = !isOk ? (resJson?.error?.message || `HTTP ${res.status}`) : undefined;

              whatsappResults.push({ recipient: targetPhone, ok: isOk, error: errStr });

              await admin.from("whatsapp_logs").insert({
                request_id: requestId,
                recipient_phone: targetPhone,
                recipient_name: target.name || null,
                message_type: "document_template",
                status: isOk ? "sent" : "failed",
                meta_message_id: metaId || null,
                error_message: errStr || null,
                details: { approval_no: b.approval_no, request_no: r.request_no, media_id: mediaId },
              }).catch(() => {});
            } catch (waErr) {
              console.error("WhatsApp dispatch error for " + targetPhone, waErr);
              whatsappResults.push({ recipient: targetPhone, ok: false, error: String(waErr) });
            }
          }
        }
      } catch (waOverallErr) {
        console.error("WhatsApp notification dispatch failed:", waOverallErr);
      }
    }

    return json({ approval_no: b.approval_no, files: records.length, pages: packet.pageCount, whatsapp_sent: whatsappResults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Signing failed:", msg);
    await admin.rpc("abort_approval", { p_request_id: requestId, p_approver_id: me.id, p_error: msg });
    throw new HttpError(500, "signing_failed", `Signing failed — try again. (${msg})`);
  }
}));
