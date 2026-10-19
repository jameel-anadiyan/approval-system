// PDF stamping (server only). Adds an approval band below every page's content by extending the
// page box on the edge that is visually at the bottom, so nothing on the original page is covered.
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import QRCode from "npm:qrcode@1.5.4";

const FONT_URLS = {
  regular: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  bold: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf",
};
let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

export async function loadFonts() {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all(
    [FONT_URLS.regular, FONT_URLS.bold].map(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Font download failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  );
  fontCache = { regular, bold };
  return fontCache;
}

export interface StampContext {
  approvalNo: string;
  approverLine: string; // "Name, Designation, Department"
  dateTime: string; // "08 Oct 2026, 06:01 PM IST"
  requestNo: string;
  amount: string; // "₹9,500.00"
  reviewedLine: string | null; // "Reviewed by: Head, 08 Oct 2026"
  verifyUrl: string | null;
  fonts: { regular: Uint8Array; bold: Uint8Array };
  seal: Uint8Array;
  signature: Uint8Array;
}

const GREEN = rgb(0.05, 0.42, 0.29);
const INK = rgb(0.1, 0.12, 0.16);
const GREY = rgb(0.42, 0.45, 0.5);
const A4 = { w: 595.28, h: 841.89 };

interface Assets { regular: PDFFont; bold: PDFFont; seal: PDFImage; signature: PDFImage }

async function embedAssets(doc: PDFDocument, ctx: StampContext): Promise<Assets> {
  doc.registerFontkit(fontkit);
  return {
    regular: await doc.embedFont(ctx.fonts.regular, { subset: true }),
    bold: await doc.embedFont(ctx.fonts.bold, { subset: true }),
    seal: await doc.embedPng(ctx.seal),
    signature: await doc.embedPng(ctx.signature),
  };
}

// A local drawing frame for the band: origin at the band's visual bottom-left, x to the visual right.
interface Frame { ox: number; oy: number; ux: [number, number]; uy: [number, number]; rot: number; W: number; H: number; s: number }

function at(f: Frame, lx: number, ly: number) {
  return { x: f.ox + lx * f.ux[0] + ly * f.uy[0], y: f.oy + lx * f.ux[1] + ly * f.uy[1] };
}

function extendPage(page: PDFPage): Frame {
  const rot = (((page.getRotation().angle ?? 0) % 360) + 360) % 360;
  const { x, y, width: w, height: h } = page.getCropBox();
  const W = rot === 90 || rot === 270 ? h : w;
  const s = Math.min(1, Math.max(0.4, W / A4.w));
  const H = 110 * s;
  const set = (bx: number, by: number, bw: number, bh: number) => {
    page.setMediaBox(bx, by, bw, bh);
    page.setCropBox(bx, by, bw, bh);
  };
  switch (rot) {
    case 90:
      set(x, y, w + H, h);
      return { ox: x + w + H, oy: y, ux: [0, 1], uy: [-1, 0], rot: 90, W, H, s };
    case 180:
      set(x, y, w, h + H);
      return { ox: x + w, oy: y + h + H, ux: [-1, 0], uy: [0, -1], rot: 180, W, H, s };
    case 270:
      set(x - H, y, w + H, h);
      return { ox: x - H, oy: y + h, ux: [0, -1], uy: [1, 0], rot: 270, W, H, s };
    default:
      set(x, y - H, w, h + H);
      return { ox: x, oy: y - H, ux: [1, 0], uy: [0, 1], rot: 0, W, H, s };
  }
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function drawImageFit(page: PDFPage, f: Frame, img: PDFImage, lx: number, ly: number, bw: number, bh: number) {
  const scale = Math.min(bw / img.width, bh / img.height);
  const w = img.width * scale, h = img.height * scale;
  const p = at(f, lx + (bw - w) / 2, ly + (bh - h) / 2);
  page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(f.rot) });
}

function drawQr(page: PDFPage, f: Frame, text: string, lx: number, ly: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n: number = qr.modules.size;
  const cell = size / (n + 2);
  const bg = at(f, lx, ly);
  page.drawRectangle({ x: bg.x, y: bg.y, width: size, height: size, color: rgb(1, 1, 1), rotate: degrees(f.rot) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      const p = at(f, lx + (c + 1) * cell, ly + size - (r + 2) * cell);
      page.drawRectangle({ x: p.x, y: p.y, width: cell + 0.05, height: cell + 0.05, color: INK, rotate: degrees(f.rot) });
    }
  }
}

function drawBand(page: PDFPage, a: Assets, ctx: StampContext, pageLabel: string) {
  const f = extendPage(page);
  const { W, H, s } = f;
  const rot = degrees(f.rot);
  const o = at(f, 0, 0);
  page.drawRectangle({ x: o.x, y: o.y, width: W, height: H, color: rgb(1, 1, 1), rotate: rot });
  const rule = at(f, 0, H - 1.6 * s);
  page.drawRectangle({ x: rule.x, y: rule.y, width: W, height: 1.6 * s, color: GREEN, rotate: rot });

  drawImageFit(page, f, a.seal, 12 * s, (H - 84 * s) / 2, 84 * s, 84 * s);
  drawImageFit(page, f, a.signature, 102 * s, (H - 64 * s) / 2, 124 * s, 64 * s);

  const qrSize = ctx.verifyUrl ? 78 * s : 0;
  const x0 = 236 * s;
  const maxW = W - x0 - (qrSize ? qrSize + 18 * s : 12 * s);
  const line = (text: string, ly: number, size: number, font: PDFFont, color = INK) => {
    const p = at(f, x0, ly);
    page.drawText(fit(text, font, size * s, maxW), { x: p.x, y: p.y, size: size * s, font, color, rotate: rot });
  };
  line(`APPROVED · Approval No: ${ctx.approvalNo}`, H - 22 * s, 11, a.bold, GREEN);
  line(`Approved by: ${ctx.approverLine}`, H - 39 * s, 8.5, a.regular);
  line(`Date & time: ${ctx.dateTime}`, H - 53 * s, 8.5, a.regular);
  line(`Request ${ctx.requestNo} · Amount ${ctx.amount} · ${pageLabel}`, H - 67 * s, 8.5, a.regular);
  if (ctx.reviewedLine) line(ctx.reviewedLine, H - 81 * s, 7.5, a.regular, GREY);
  if (ctx.verifyUrl) line("Scan the QR code to verify this approval", H - 95 * s, 7, a.regular, GREY);

  if (ctx.verifyUrl) drawQr(page, f, ctx.verifyUrl, W - qrSize - 10 * s, (H - qrSize) / 2, qrSize);
}

function isJpeg(b: Uint8Array) { return b[0] === 0xff && b[1] === 0xd8; }
function isPng(b: Uint8Array) { return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

/** Stamp one uploaded document (PDF, JPG or PNG). Returns a new PDF. */
export async function stampDocument(bytes: Uint8Array, ctx: StampContext): Promise<{ bytes: Uint8Array; pageCount: number }> {
  let doc: PDFDocument;
  if (isJpeg(bytes) || isPng(bytes)) {
    doc = await PDFDocument.create();
    const img = isJpeg(bytes) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const landscape = img.width > img.height;
    const pw = landscape ? A4.h : A4.w, ph = landscape ? A4.w : A4.h;
    const page = doc.addPage([pw, ph]);
    const m = 24;
    const scale = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  } else {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
    try { doc.getForm().flatten(); } catch { /* no form */ }
  }
  const a = await embedAssets(doc, ctx);
  const pages = doc.getPages();
  pages.forEach((p, i) => drawBand(p, a, ctx, `Page ${i + 1} of ${pages.length}`));
  doc.setProducer("Approval App");
  doc.setTitle(`${ctx.approvalNo}`);
  return { bytes: await doc.save({ useObjectStreams: true }), pageCount: pages.length };
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
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

/** Cover page + every signed document merged into one packet PDF. */
export async function buildPacket(info: PacketInfo, signed: Uint8Array[], ctx: StampContext) {
  const doc = await PDFDocument.create();
  const a = await embedAssets(doc, ctx);
  let page = doc.addPage([A4.w, A4.h]);
  const M = 48, maxW = A4.w - 2 * M;
  let y = A4.h - M;
  const newPageIfNeeded = (need: number) => {
    if (y - need < M) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; }
  };
  const text = (t: string, size: number, font = a.regular, color = INK, x = M) => {
    newPageIfNeeded(size + 6);
    page.drawText(t, { x, y: y - size, size, font, color });
    y -= size + 6;
  };

  text("APPROVAL PACKET", 10, a.bold, GREEN);
  text(fit(info.title, a.bold, 18, maxW), 18, a.bold);
  y -= 6;
  page.drawRectangle({ x: M, y, width: maxW, height: 1, color: GREEN });
  y -= 14;
  for (const [k, v] of info.rows) {
    newPageIfNeeded(18);
    page.drawText(k, { x: M, y: y - 10, size: 10, font: a.bold, color: GREY });
    const lines = wrap(v, a.regular, 10, maxW - 140);
    lines.forEach((l, i) => page.drawText(l, { x: M + 140, y: y - 10 - i * 14, size: 10, font: a.regular, color: INK }));
    y -= Math.max(1, lines.length) * 14 + 4;
  }
  if (info.notes) {
    y -= 8; text("Notes", 12, a.bold);
    for (const l of wrap(info.notes, a.regular, 9.5, maxW).slice(0, 40)) text(l, 9.5);
  }
  y -= 8; text("Documents", 12, a.bold);
  info.documents.forEach((d, i) => text(fit(`${i + 1}. ${d.name} — ${d.pages} page${d.pages === 1 ? "" : "s"}`, a.regular, 9.5, maxW), 9.5));
  y -= 8; text("Timeline", 12, a.bold);
  for (const t of info.timeline) {
    text(fit(`${t.when} · ${t.who} · ${t.what}`, a.regular, 9.5, maxW), 9.5);
    if (t.remarks) for (const l of wrap(`“${t.remarks}”`, a.regular, 9, maxW - 16).slice(0, 6)) text(l, 9, a.regular, GREY, M + 16);
  }
  const coverPages = doc.getPages();
  coverPages.forEach((p, i) => drawBand(p, a, ctx, coverPages.length > 1 ? `Cover ${i + 1} of ${coverPages.length}` : "Cover page"));

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
  heading: string, subtitle: string, sections: FormSection[], fonts: { regular: Uint8Array; bold: Uint8Array },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const M = 40, W = A4.w - 2 * M;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const header = () => {
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: NAVY });
    const hw = bold.widthOfTextAtSize(heading, 20);
    page.drawText(heading, { x: (A4.w - hw) / 2, y: y - 22, size: 20, font: bold, color: NAVY });
    const sw = bold.widthOfTextAtSize(subtitle, 9.5);
    page.drawText(subtitle, { x: (A4.w - sw) / 2, y: y - 40, size: 9.5, font: bold, color: GOLD });
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
    page.drawText(s.title.toUpperCase(), { x: M + 12, y: y - 13, size: 9, font: bold, color: rgb(1, 1, 1) });
    y -= 18;
    const rows = s.rows ?? [];
    // two label/value pairs per line
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2);
      const colW = W / 2, labW = 105, valW = colW - labW - 10;
      const lines = pair.map(([, v]) => wrap(v || "—", regular, 9, valW));
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
      const lines = wrap(s.text || "—", regular, 9.5, W - 16).slice(0, 30);
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
