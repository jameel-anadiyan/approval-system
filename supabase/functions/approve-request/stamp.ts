// PDF stamping (server only). Fits every document (PDF, JPG or PNG) onto standard A4 pages
// with the official approval badge positioned below the content, guaranteeing zero content overlap.
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.4";

// Lightweight stub for backwards-compatibility; StandardFonts are built-in and require no external download.
export async function loadFonts() {
  return null;
}

export function toSafePdfText(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/₹/g, "Rs. ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

export interface StampContext {
  approvalNo: string;
  approverLine: string; // "Name, Designation, Department"
  dateTime: string; // "08 Oct 2026, 06:01 PM IST"
  requestNo: string;
  amount: string; // "Rs. 9,500.00"
  reviewedLine: string | null; // "Reviewed by: Head, 08 Oct 2026"
  verifyUrl: string | null;
  fonts?: { regular?: Uint8Array; bold?: Uint8Array } | null;
  seal: Uint8Array;
  signature: Uint8Array;
  /** Overrides the first band line, e.g. "ADDENDUM · Approval No: X" */
  headline?: string;
  /** Label before approverLine; default "Approved by" */
  byLabel?: string;
}

const GREEN = rgb(0.05, 0.42, 0.29);
const INK = rgb(0.1, 0.12, 0.16);
const GREY = rgb(0.42, 0.45, 0.5);
const A4 = { w: 595.28, h: 841.89 };

interface Assets { regular: PDFFont; bold: PDFFont; seal: PDFImage; signature: PDFImage }

async function embedAssets(doc: PDFDocument, ctx: StampContext): Promise<Assets> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    seal: await doc.embedPng(ctx.seal),
    signature: await doc.embedPng(ctx.signature),
  };
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safeText = toSafePdfText(text);
  if (font.widthOfTextAtSize(safeText, size) <= maxWidth) return safeText;
  let t = safeText;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxWidth) t = t.slice(0, -1);
  return t + "...";
}

function drawImageFit(page: PDFPage, img: PDFImage, lx: number, ly: number, bw: number, bh: number) {
  const scale = Math.min(bw / img.width, bh / img.height);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: lx + (bw - w) / 2, y: ly + (bh - h) / 2, width: w, height: h });
}

function drawQr(page: PDFPage, text: string, lx: number, ly: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n: number = qr.modules.size;
  const cell = size / (n + 2);
  page.drawRectangle({ x: lx, y: ly, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      page.drawRectangle({
        x: lx + (c + 1) * cell,
        y: ly + size - (r + 2) * cell,
        width: cell + 0.05,
        height: cell + 0.05,
        color: INK,
      });
    }
  }
}

function drawBand(page: PDFPage, a: Assets, ctx: StampContext, pageLabel: string, pw: number, bandH: number, s: number) {
  page.drawRectangle({ x: 0, y: 0, width: pw, height: bandH, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: bandH - 1.6 * s, width: pw, height: 1.6 * s, color: GREEN });

  drawImageFit(page, a.seal, 12 * s, (bandH - 84 * s) / 2, 84 * s, 84 * s);
  drawImageFit(page, a.signature, 102 * s, (bandH - 64 * s) / 2, 124 * s, 64 * s);

  const qrSize = ctx.verifyUrl ? 78 * s : 0;
  const x0 = 236 * s;
  const maxW = pw - x0 - (qrSize ? qrSize + 18 * s : 12 * s);
  const line = (text: string, ly: number, size: number, font: PDFFont, color = INK) => {
    const safe = toSafePdfText(text);
    page.drawText(fit(safe, font, size * s, maxW), { x: x0, y: ly, size: size * s, font, color });
  };
  line(ctx.headline ?? `APPROVED · Approval No: ${ctx.approvalNo}`, bandH - 22 * s, 11, a.bold, GREEN);
  line(`${ctx.byLabel ?? "Approved by"}: ${ctx.approverLine}`, bandH - 39 * s, 8.5, a.regular);
  line(`Date & time: ${ctx.dateTime}`, bandH - 53 * s, 8.5, a.regular);
  line(`Request ${ctx.requestNo} · Amount ${ctx.amount} · ${pageLabel}`, bandH - 67 * s, 8.5, a.regular);
  if (ctx.reviewedLine) line(ctx.reviewedLine, bandH - 81 * s, 7.5, a.regular, GREY);
  if (ctx.verifyUrl) line("Scan the QR code to verify this approval", bandH - 95 * s, 7, a.regular, GREY);

  if (ctx.verifyUrl) drawQr(page, ctx.verifyUrl, pw - qrSize - 10 * s, (bandH - qrSize) / 2, qrSize);
}

function isJpeg(b: Uint8Array) { return b[0] === 0xff && b[1] === 0xd8; }
function isPng(b: Uint8Array) { return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

/** Fits any uploaded document (PDF, JPG or PNG) onto standard A4 pages with zero badge overlap. */
export async function stampDocument(bytes: Uint8Array, ctx: StampContext): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const targetDoc = await PDFDocument.create();
  const a = await embedAssets(targetDoc, ctx);

  if (isJpeg(bytes) || isPng(bytes)) {
    const img = isJpeg(bytes) ? await targetDoc.embedJpg(bytes) : await targetDoc.embedPng(bytes);
    const landscape = img.width > img.height * 1.15;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    const page = targetDoc.addPage([pw, ph]);

    const s = pw / A4.w;
    const bandH = 110 * s;
    const margin = 20 * s;
    const availW = pw - 2 * margin;
    const availH = ph - bandH - 2 * margin;

    const fitScale = Math.min(availW / img.width, availH / img.height);
    const scale = (img.width <= availW && img.height <= availH) ? Math.min(fitScale, 1.0) : fitScale;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (pw - w) / 2;
    const y = bandH + margin + (availH - h) / 2;

    page.drawImage(img, { x, y, width: w, height: h });
    drawBand(page, a, ctx, "Page 1 of 1", pw, bandH, s);
  } else {
    const srcDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    try { srcDoc.getForm().flatten(); } catch { /* no form */ }

    const srcPages = srcDoc.getPages();
    const pageIndices = srcDoc.getPageIndices();
    const embeddedPages = await targetDoc.embedPdf(srcDoc, pageIndices);

    for (let i = 0; i < embeddedPages.length; i++) {
      const embedded = embeddedPages[i];
      const srcPage = srcPages[i];
      const rot = (((srcPage.getRotation().angle ?? 0) % 360) + 360) % 360;

      const visW = rot === 90 || rot === 270 ? embedded.height : embedded.width;
      const visH = rot === 90 || rot === 270 ? embedded.width : embedded.height;

      const landscape = visW > visH * 1.15;
      const pw = landscape ? A4.h : A4.w;
      const ph = landscape ? A4.w : A4.h;
      const targetPage = targetDoc.addPage([pw, ph]);

      const s = pw / A4.w;
      const bandH = 110 * s;
      const margin = 16 * s;
      const topPad = 14 * s;
      const bottomPad = 10 * s;

      const availW = pw - 2 * margin;
      const availH = ph - bandH - topPad - bottomPad;

      const scale = Math.min(availW / visW, availH / visH);
      const scaledW = visW * scale;
      const scaledH = visH * scale;

      const destX = margin + (availW - scaledW) / 2;
      const destY = bandH + bottomPad + (availH - scaledH) / 2;

      let drawOptions: { x: number; y: number; width: number; height: number; rotate?: ReturnType<typeof degrees> } = {
        x: destX,
        y: destY,
        width: scaledW,
        height: scaledH,
      };

      if (rot === 90) {
        drawOptions = { x: destX + scaledW, y: destY, width: scaledH, height: scaledW, rotate: degrees(90) };
      } else if (rot === 180) {
        drawOptions = { x: destX + scaledW, y: destY + scaledH, width: scaledW, height: scaledH, rotate: degrees(180) };
      } else if (rot === 270) {
        drawOptions = { x: destX, y: destY + scaledH, width: scaledH, height: scaledW, rotate: degrees(270) };
      }

      targetPage.drawPage(embedded, drawOptions);
      drawBand(targetPage, a, ctx, `Page ${i + 1} of ${embeddedPages.length}`, pw, bandH, s);
    }
  }

  targetDoc.setProducer("Approval App");
  targetDoc.setTitle(`${ctx.approvalNo}`);
  return { bytes: await targetDoc.save({ useObjectStreams: true }), pageCount: targetDoc.getPageCount() };
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safeText = toSafePdfText(text);
  const out: string[] = [];
  for (const para of safeText.split(/\r?\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
      else { if (cur) out.push(cur); cur = fit(word, font, size, maxWidth); }
    }
    out.push(cur);
  }
  return out;
}

export interface PacketInfo {
  title: string;
  rows: [string, string][];
  notes: string | null;
  documents: { name: string; pages: number }[];
  timeline: { when: string; who: string; what: string; remarks: string | null }[];
}

/** Cover page + every signed document merged into one packet PDF. All pages standard A4. */
export async function buildPacket(info: PacketInfo, signed: Uint8Array[], ctx: StampContext) {
  const doc = await PDFDocument.create();
  const a = await embedAssets(doc, ctx);
  let page = doc.addPage([A4.w, A4.h]);
  const s = 1.0;
  const bandH = 110 * s;
  const M = 48, maxW = A4.w - 2 * M;
  let y = A4.h - M;
  const newPageIfNeeded = (need: number) => {
    if (y - need < bandH + 20) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; }
  };
  const text = (t: string, size: number, font = a.regular, color = INK, x = M) => {
    const safe = toSafePdfText(t);
    newPageIfNeeded(size + 6);
    page.drawText(safe, { x, y: y - size, size, font, color });
    y -= size + 6;
  };

  text("APPROVAL PACKET", 10, a.bold, GREEN);
  text(fit(info.title, a.bold, 18, maxW), 18, a.bold);
  y -= 6;
  page.drawRectangle({ x: M, y, width: maxW, height: 1, color: GREEN });
  y -= 14;
  for (const [k, v] of info.rows) {
    newPageIfNeeded(18);
    page.drawText(toSafePdfText(k), { x: M, y: y - 10, size: 10, font: a.bold, color: GREY });
    const lines = wrap(v, a.regular, 10, maxW - 140);
    lines.forEach((l, i) => page.drawText(l, { x: M + 140, y: y - 10 - i * 14, size: 10, font: a.regular, color: INK }));
    y -= Math.max(1, lines.length) * 14 + 4;
  }
  if (info.notes) {
    y -= 8; text("Notes", 12, a.bold);
    for (const l of wrap(info.notes, a.regular, 9.5, maxW).slice(0, 40)) text(l, 9.5);
  }
  y -= 8; text("Documents", 12, a.bold);
  info.documents.forEach((d, i) => text(fit(`${i + 1}. ${d.name} - ${d.pages} page${d.pages === 1 ? "" : "s"}`, a.regular, 9.5, maxW), 9.5));
  y -= 8; text("Timeline", 12, a.bold);
  for (const t of info.timeline) {
    text(fit(`${t.when} · ${t.who} · ${t.what}`, a.regular, 9.5, maxW), 9.5);
    if (t.remarks) for (const l of wrap(`"${t.remarks}"`, a.regular, 9, maxW - 16).slice(0, 6)) text(l, 9, a.regular, GREY, M + 16);
  }
  const coverPages = doc.getPages();
  coverPages.forEach((p, i) => drawBand(p, a, ctx, coverPages.length > 1 ? `Cover ${i + 1} of ${coverPages.length}` : "Cover page", A4.w, bandH, s));

  for (const bytes of signed) {
    const src = await PDFDocument.load(bytes);
    const copied = await doc.copyPages(src, src.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
  }
  doc.setProducer("Approval App");
  doc.setTitle(`${ctx.approvalNo} packet`);
  return { bytes: await doc.save({ useObjectStreams: true }), pageCount: doc.getPageCount() };
}

export interface FormSection {
  title: string;
  rows?: [string, string][];
  text?: string | null;
}

const NAVY = rgb(0.12, 0.16, 0.27);
const GOLD = rgb(0.72, 0.56, 0.2);
const CREAM = rgb(0.96, 0.94, 0.9);
const LINE = rgb(0.82, 0.83, 0.87);

/** The filled request form (Discount / Exhibition) as a clean A4 PDF, ready to be stamped. */
export async function buildFormPdf(
  heading: string, subtitle: string, sections: FormSection[], _fonts?: unknown,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 40, W = A4.w - 2 * M;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const header = () => {
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: NAVY });
    const safeH = toSafePdfText(heading);
    const hw = bold.widthOfTextAtSize(safeH, 20);
    page.drawText(safeH, { x: (A4.w - hw) / 2, y: y - 22, size: 20, font: bold, color: NAVY });
    const safeSub = toSafePdfText(subtitle);
    const sw = bold.widthOfTextAtSize(safeSub, 9.5);
    page.drawText(safeSub, { x: (A4.w - sw) / 2, y: y - 40, size: 9.5, font: bold, color: GOLD });
    page.drawRectangle({ x: M, y: y - 50, width: W, height: 1.2, color: GOLD });
    y -= 64;
  };
  const ensure = (need: number) => {
    if (y - need < M) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; header(); }
  };
  header();

  for (const s of sections) {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 18, width: W, height: 18, color: NAVY });
    page.drawRectangle({ x: M, y: y - 18, width: 4, height: 18, color: GOLD });
    page.drawText(toSafePdfText(s.title.toUpperCase()), { x: M + 12, y: y - 13, size: 9, font: bold, color: rgb(1, 1, 1) });
    y -= 18;
    const rows = s.rows ?? [];
    // two label/value pairs per line
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2);
      const colW = W / 2, labW = 105, valW = colW - labW - 10;
      const lines = pair.map(([, v]) => wrap(v || "-", regular, 9, valW));
      const h = Math.max(24, Math.max(...lines.map((l) => l.length)) * 12 + 10);
      ensure(h);
      pair.forEach(([k], j) => {
        const x = M + j * colW;
        page.drawRectangle({ x, y: y - h, width: labW, height: h, color: CREAM, borderColor: LINE, borderWidth: 0.6 });
        page.drawRectangle({ x: x + labW, y: y - h, width: colW - labW, height: h, borderColor: LINE, borderWidth: 0.6 });
        wrap(k, bold, 8.5, labW - 10).slice(0, 3).forEach((l, n) =>
          page.drawText(l, { x: x + 6, y: y - 14 - n * 11, size: 8.5, font: bold, color: NAVY }));
        lines[j].forEach((l, n) =>
          page.drawText(l, { x: x + labW + 6, y: y - 14 - n * 12, size: 9, font: regular, color: INK }));
      });
      y -= h;
    }
    if (s.text !== undefined) {
      const lines = wrap(s.text || "-", regular, 9.5, W - 16).slice(0, 30);
      const h = Math.max(36, lines.length * 13 + 12);
      ensure(h);
      page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: LINE, borderWidth: 0.6 });
      lines.forEach((l, n) => page.drawText(l, { x: M + 8, y: y - 16 - n * 13, size: 9.5, font: regular, color: INK }));
      y -= h;
    }
    y -= 12;
  }
  ensure(20);
  const foot = "SWA Diamonds · Internal Approval Form";
  page.drawText(foot, { x: (A4.w - regular.widthOfTextAtSize(foot, 7.5)) / 2, y: M - 10, size: 7.5, font: regular, color: GREY });
  doc.setProducer("Approval App");
  return await doc.save({ useObjectStreams: true });
}
