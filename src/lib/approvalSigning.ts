// Browser-side document signing for approvals.
//
// Why this exists: Supabase Edge Functions have a hard CPU (~2s) and memory ceiling.
// Requests with many / large scanned pages exceeded it ("Function failed due to not having
// enough compute resources"). The heavy PDF work (stamping every page + building the packet)
// now runs here in the approver's browser, which has no such limit. The Edge Function only:
//   1. prepare  → reserves the approval (begin_approval), hands back signed download/upload URLs
//   2. finalize → verifies the uploaded files and calls finalize_approval
//   3. abort    → puts the request back if anything fails
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { supabase } from './supabase';

// ───────────────────────── types shared with the edge function ─────────────────────────

export interface StampCtxStrings {
  approvalNo: string;
  approverLine: string;
  dateTime: string;
  requestNo: string;
  amount: string;
  reviewedLine: string | null;
  verifyUrl: string | null;
  headline?: string;
  byLabel?: string;
  tone?: 'approved' | 'rejected';
}

export interface FormSection {
  title: string;
  rows?: [string, string][];
  text?: string | null;
}

export interface UploadSlot {
  path: string;
  token: string;
  file_name: string;
}

export interface PrepareResponse {
  mode: 'client_sign';
  request_id: string;
  approval_no: string;
  ctx: StampCtxStrings;
  seal_url: string;
  signature_url: string;
  form: { heading: string; subtitle: string; sections: FormSection[]; name: string; upload: UploadSlot } | null;
  files: {
    id: string;
    original_name: string;
    download_url: string;
    label: string;
    in_packet: boolean;
    ctx_override: Partial<StampCtxStrings> | null;
    upload: UploadSlot;
  }[];
  packet_upload: UploadSlot;
  cover: {
    title: string;
    rows: [string, string][];
    notes: string | null;
    timeline: { when: string; who: string; what: string; remarks: string | null }[];
  };
}

export interface SignedOutput {
  source_file_id: string | null;
  is_packet: boolean;
  file_name: string;
  storage_path: string;
  sha256: string;
  page_count: number;
}

interface StampContext extends StampCtxStrings {
  seal: Uint8Array;
  signature: Uint8Array;
  qrPngBytes: Uint8Array | null;
}

// ───────────────────────── drawing helpers (same look as the server stamp) ─────────────────────────

const GREEN = rgb(0.05, 0.42, 0.29);
const RED = rgb(0.72, 0.11, 0.11);
const INK = rgb(0.1, 0.12, 0.16);
const GREY = rgb(0.42, 0.45, 0.5);
const NAVY = rgb(0.12, 0.16, 0.27);
const GOLD = rgb(0.72, 0.56, 0.2);
const CREAM = rgb(0.96, 0.94, 0.9);
const LINE = rgb(0.82, 0.83, 0.87);
const A4 = { w: 595.28, h: 841.89 };

interface Assets {
  regular: PDFFont;
  bold: PDFFont;
  seal: PDFImage;
  signature: PDFImage;
  qr: PDFImage | null;
}

export function toSafePdfText(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/₹/g, 'Rs. ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
}

function isJpeg(b: Uint8Array) { return b[0] === 0xff && b[1] === 0xd8; }
function isPng(b: Uint8Array) { return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

async function embedImage(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  return isJpeg(bytes) ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

async function embedAssets(doc: PDFDocument, ctx: StampContext): Promise<Assets> {
  let qr: PDFImage | null = null;
  if (ctx.qrPngBytes) {
    try { qr = await doc.embedPng(ctx.qrPngBytes); } catch { qr = null; }
  }
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    seal: await embedImage(doc, ctx.seal),
    signature: await embedImage(doc, ctx.signature),
    qr,
  };
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safeText = toSafePdfText(text);
  if (font.widthOfTextAtSize(safeText, size) <= maxWidth) return safeText;
  let t = safeText;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxWidth) t = t.slice(0, -1);
  return t + '...';
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safeText = toSafePdfText(text);
  const out: string[] = [];
  for (const para of safeText.split(/\r?\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
      else { if (cur) out.push(cur); cur = fit(word, font, size, maxWidth); }
    }
    out.push(cur);
  }
  return out;
}

function drawImageFit(page: PDFPage, img: PDFImage, lx: number, ly: number, bw: number, bh: number) {
  const scale = Math.min(bw / img.width, bh / img.height);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: lx + (bw - w) / 2, y: ly + (bh - h) / 2, width: w, height: h });
}

function drawBand(page: PDFPage, a: Assets, ctx: StampContext, pageLabel: string, pw: number, bandH: number, s: number) {
  page.drawRectangle({ x: 0, y: 0, width: pw, height: bandH, color: rgb(1, 1, 1) });
  const accent = ctx.tone === 'rejected' ? RED : GREEN;
  page.drawRectangle({ x: 0, y: bandH - 1.6 * s, width: pw, height: 1.6 * s, color: accent });

  drawImageFit(page, a.seal, 12 * s, (bandH - 84 * s) / 2, 84 * s, 84 * s);
  drawImageFit(page, a.signature, 102 * s, (bandH - 64 * s) / 2, 124 * s, 64 * s);

  const qrSize = ctx.verifyUrl ? 78 * s : 0;
  const x0 = 236 * s;
  const maxW = pw - x0 - (qrSize ? qrSize + 18 * s : 12 * s);
  const line = (text: string, ly: number, size: number, font: PDFFont, color = INK) => {
    page.drawText(fit(text, font, size * s, maxW), { x: x0, y: ly, size: size * s, font, color });
  };
  line(ctx.headline ?? `APPROVED · Approval No: ${ctx.approvalNo}`, bandH - 22 * s, 11, a.bold, accent);
  line(`${ctx.byLabel ?? 'Approved by'}: ${ctx.approverLine}`, bandH - 39 * s, 8.5, a.regular);
  line(`Date & time: ${ctx.dateTime}`, bandH - 53 * s, 8.5, a.regular);
  line(`Request ${ctx.requestNo} · Amount ${ctx.amount} · ${pageLabel}`, bandH - 67 * s, 8.5, a.regular);
  if (ctx.reviewedLine) line(ctx.reviewedLine, bandH - 81 * s, 7.5, a.regular, GREY);
  if (ctx.verifyUrl) line('Scan the QR code to verify this approval', bandH - 95 * s, 7, a.regular, GREY);

  if (a.qr && ctx.verifyUrl) {
    page.drawImage(a.qr, { x: pw - qrSize - 10 * s, y: (bandH - qrSize) / 2, width: qrSize, height: qrSize });
  }
}

/** Gives the browser a chance to repaint between heavy steps so the UI never freezes. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Fits any uploaded document (PDF, JPG or PNG) onto standard A4 pages with the approval
 * band below the content (zero overlap). Runs entirely in the browser.
 */
async function stampDocument(bytes: Uint8Array, ctx: StampContext): Promise<{ doc: PDFDocument; pageCount: number }> {
  const target = await PDFDocument.create();
  const a = await embedAssets(target, ctx);

  if (isJpeg(bytes) || isPng(bytes)) {
    const img = isJpeg(bytes) ? await target.embedJpg(bytes) : await target.embedPng(bytes);
    const landscape = img.width > img.height * 1.15;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    const page = target.addPage([pw, ph]);
    const s = pw / A4.w;
    const bandH = 110 * s;
    const margin = 20 * s;
    const availW = pw - 2 * margin;
    const availH = ph - bandH - 2 * margin;
    const fitScale = Math.min(availW / img.width, availH / img.height);
    const scale = img.width <= availW && img.height <= availH ? Math.min(fitScale, 1) : fitScale;
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: bandH + margin + (availH - h) / 2, width: w, height: h });
    drawBand(page, a, ctx, 'Page 1 of 1', pw, bandH, s);
  } else {
    const src = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    try { src.getForm().flatten(); } catch { /* no form */ }
    const srcPages = src.getPages();
    const embedded = await target.embedPdf(src, src.getPageIndices());

    for (let i = 0; i < embedded.length; i++) {
      const e = embedded[i];
      const rot = (((srcPages[i].getRotation().angle ?? 0) % 360) + 360) % 360;
      const visW = rot === 90 || rot === 270 ? e.height : e.width;
      const visH = rot === 90 || rot === 270 ? e.width : e.height;
      const landscape = visW > visH * 1.15;
      const pw = landscape ? A4.h : A4.w;
      const ph = landscape ? A4.w : A4.h;
      const page = target.addPage([pw, ph]);
      const s = pw / A4.w;
      const bandH = 110 * s;
      const margin = 16 * s;
      const topPad = 14 * s;
      const bottomPad = 10 * s;
      const availW = pw - 2 * margin;
      const availH = ph - bandH - topPad - bottomPad;
      const scale = Math.min(availW / visW, availH / visH);
      const sw = visW * scale, sh = visH * scale;
      const dx = margin + (availW - sw) / 2;
      const dy = bandH + bottomPad + (availH - sh) / 2;

      if (rot === 90) page.drawPage(e, { x: dx + sw, y: dy, width: sh, height: sw, rotate: degrees(90) });
      else if (rot === 180) page.drawPage(e, { x: dx + sw, y: dy + sh, width: sw, height: sh, rotate: degrees(180) });
      else if (rot === 270) page.drawPage(e, { x: dx, y: dy + sh, width: sh, height: sw, rotate: degrees(270) });
      else page.drawPage(e, { x: dx, y: dy, width: sw, height: sh });

      drawBand(page, a, ctx, `Page ${i + 1} of ${embedded.length}`, pw, bandH, s);
      if (i % 5 === 4) await breathe();
    }
  }

  target.setProducer('Approval App');
  target.setTitle(ctx.approvalNo);
  return { doc: target, pageCount: target.getPageCount() };
}

async function buildFormPdf(heading: string, subtitle: string, sections: FormSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 40, W = A4.w - 2 * M;
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const header = () => {
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: NAVY });
    const safeH = toSafePdfText(heading);
    page.drawText(safeH, { x: (A4.w - bold.widthOfTextAtSize(safeH, 20)) / 2, y: y - 22, size: 20, font: bold, color: NAVY });
    const safeSub = toSafePdfText(subtitle);
    page.drawText(safeSub, { x: (A4.w - bold.widthOfTextAtSize(safeSub, 9.5)) / 2, y: y - 40, size: 9.5, font: bold, color: GOLD });
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
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2);
      const colW = W / 2, labW = 105, valW = colW - labW - 10;
      const lines = pair.map(([, v]) => wrap(v || '-', regular, 9, valW));
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
      const lines = wrap(s.text || '-', regular, 9.5, W - 16).slice(0, 30);
      const h = Math.max(36, lines.length * 13 + 12);
      ensure(h);
      page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: LINE, borderWidth: 0.6 });
      lines.forEach((l, n) => page.drawText(l, { x: M + 8, y: y - 16 - n * 13, size: 9.5, font: regular, color: INK }));
      y -= h;
    }
    y -= 12;
  }
  ensure(20);
  const foot = 'SWA Diamonds · Internal Approval Form';
  page.drawText(toSafePdfText(foot), { x: (A4.w - regular.widthOfTextAtSize(toSafePdfText(foot), 7.5)) / 2, y: M - 10, size: 7.5, font: regular, color: GREY });
  doc.setProducer('Approval App');
  return doc.save({ useObjectStreams: false });
}

async function buildCoverDoc(
  info: PrepareResponse['cover'] & { documents: { name: string; pages: number }[] },
  ctx: StampContext,
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const a = await embedAssets(doc, ctx);
  let page = doc.addPage([A4.w, A4.h]);
  const bandH = 110;
  const M = 48, maxW = A4.w - 2 * M;
  let y = A4.h - M;
  const newPageIfNeeded = (need: number) => {
    if (y - need < bandH + 20) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; }
  };
  const text = (t: string, size: number, font = a.regular, color = INK, x = M) => {
    newPageIfNeeded(size + 6);
    page.drawText(toSafePdfText(t), { x, y: y - size, size, font, color });
    y -= size + 6;
  };

  text('APPROVAL PACKET', 10, a.bold, GREEN);
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
    y -= 8; text('Notes', 12, a.bold);
    for (const l of wrap(info.notes, a.regular, 9.5, maxW).slice(0, 40)) text(l, 9.5);
  }
  y -= 8; text('Documents', 12, a.bold);
  info.documents.forEach((d, i) => text(fit(`${i + 1}. ${d.name} - ${d.pages} page${d.pages === 1 ? '' : 's'}`, a.regular, 9.5, maxW), 9.5));
  y -= 8; text('Timeline', 12, a.bold);
  for (const t of info.timeline) {
    text(fit(`${t.when} · ${t.who} · ${t.what}`, a.regular, 9.5, maxW), 9.5);
    if (t.remarks) for (const l of wrap(`"${t.remarks}"`, a.regular, 9, maxW - 16).slice(0, 6)) text(l, 9, a.regular, GREY, M + 16);
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => drawBand(p, a, ctx, pages.length > 1 ? `Cover ${i + 1} of ${pages.length}` : 'Cover page', A4.w, bandH, 1));
  return doc;
}

// ───────────────────────── I/O helpers ─────────────────────────

async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(`Could not download ${what} (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function uploadSigned(slot: UploadSlot, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  let lastMsg = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.storage
      .from('signed-documents')
      .uploadToSignedUrl(slot.path, slot.token, blob, { contentType: 'application/pdf', upsert: true });
    if (!error) return;
    lastMsg = error.message;
    // Already uploaded by an earlier attempt of this same run → fine.
    if (/exists|duplicate/i.test(lastMsg)) return;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`Upload failed for ${slot.file_name}: ${lastMsg}`);
}

async function makeQrPng(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 140, margin: 1, errorCorrectionLevel: 'M' });
    const bin = atob(dataUrl.split(',')[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ───────────────────────── main entry ─────────────────────────

/**
 * Stamps every document of a prepared approval in the browser, builds the packet,
 * uploads everything through the one-time signed upload URLs and returns the file records
 * that the edge function's `finalize` step needs.
 */
export async function signPreparedApproval(
  prep: PrepareResponse,
  onProgress?: (msg: string) => void,
): Promise<SignedOutput[]> {
  const progress = (m: string) => { try { onProgress?.(m); } catch { /* ignore */ } };

  progress('Loading seal & signature…');
  const [seal, signature, qrPngBytes] = await Promise.all([
    fetchBytes(prep.seal_url, 'authority seal'),
    fetchBytes(prep.signature_url, 'digital signature'),
    makeQrPng(prep.ctx.verifyUrl),
  ]);
  const ctx: StampContext = { ...prep.ctx, seal, signature, qrPngBytes };

  const packet = await PDFDocument.create();
  const outputs: SignedOutput[] = [];
  const docsInfo: { name: string; pages: number }[] = [];

  const addToPacket = async (doc: PDFDocument) => {
    const copied = await packet.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => packet.addPage(p));
  };

  if (prep.form) {
    progress('Stamping request form…');
    const formBytes = await buildFormPdf(prep.form.heading, prep.form.subtitle, prep.form.sections);
    const { doc, pageCount } = await stampDocument(formBytes, ctx);
    const bytes = await doc.save({ useObjectStreams: false });
    await uploadSigned(prep.form.upload, bytes);
    outputs.push({
      source_file_id: null, is_packet: false, file_name: prep.form.upload.file_name,
      storage_path: prep.form.upload.path, sha256: await sha256Hex(bytes), page_count: pageCount,
    });
    docsInfo.push({ name: prep.form.name, pages: pageCount });
    await addToPacket(doc);
  }

  for (let i = 0; i < prep.files.length; i++) {
    const f = prep.files[i];
    progress(`Stamping document ${i + 1} of ${prep.files.length}: ${f.original_name}`);
    await breathe();
    const src = await fetchBytes(f.download_url, `"${f.original_name}"`);
    const fileCtx: StampContext = f.ctx_override ? { ...ctx, ...f.ctx_override } : ctx;
    let stamped: { doc: PDFDocument; pageCount: number };
    try {
      stamped = await stampDocument(src, fileCtx);
    } catch (e) {
      throw new Error(`Could not stamp "${f.original_name}": ${e instanceof Error ? e.message : String(e)}`);
    }
    const bytes = await stamped.doc.save({ useObjectStreams: false });
    progress(`Uploading signed copy of ${f.original_name}…`);
    await uploadSigned(f.upload, bytes);
    outputs.push({
      source_file_id: f.id, is_packet: false, file_name: f.upload.file_name,
      storage_path: f.upload.path, sha256: await sha256Hex(bytes), page_count: stamped.pageCount,
    });
    if (f.in_packet) {
      docsInfo.push({ name: f.label, pages: stamped.pageCount });
      await addToPacket(stamped.doc);
    }
  }

  progress('Building approval packet…');
  await breathe();
  const cover = await buildCoverDoc({ ...prep.cover, documents: docsInfo }, ctx);
  const coverPages = await packet.copyPages(cover, cover.getPageIndices());
  coverPages.forEach((cp, idx) => packet.insertPage(idx, cp));
  packet.setProducer('Approval App');
  packet.setTitle(`${prep.approval_no} packet`);
  const packetBytes = await packet.save({ useObjectStreams: false });

  progress('Uploading approval packet…');
  await uploadSigned(prep.packet_upload, packetBytes);
  outputs.unshift({
    source_file_id: null, is_packet: true, file_name: prep.packet_upload.file_name,
    storage_path: prep.packet_upload.path, sha256: await sha256Hex(packetBytes), page_count: packet.getPageCount(),
  });

  return outputs;
}

