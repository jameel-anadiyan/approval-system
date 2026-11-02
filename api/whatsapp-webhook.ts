// Vercel Serverless Function: Interactive WhatsApp Approval Webhook ("all" Command)
// 1. Handles Meta Cloud API Webhook Verification (GET) & Inbound Events (POST)
// 2. Transparently relays non-Admin-bot events & status updates to upstream webhook
//    (https://whatsapp.swaloyalty.com/api/webhooks/whatsapp) with raw body + signature
// 3. When Admin messages "all", lists all pending Admin To-Approve requests in serial
//    order with essential details and presents two interactive buttons:
//    "Approve All" and "Selected Only"
// 4. Executes full official PDF form generation, Seal + Signature + QR stamping,
//    signed-documents upload, finalize_approval, and outbound WhatsApp PDF delivery,
//    automatically reflecting live in open Web App sessions via Supabase Realtime.

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const pdfLib = require('pdf-lib') as typeof import('pdf-lib');
const QRCode = require('qrcode') as typeof import('qrcode');

const { PDFDocument, StandardFonts, rgb, degrees } = pdfLib;

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

const GRAPH_VERSION = 'v21.0';
const DEFAULT_SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://rwwbpyodelmofjujgtyf.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3d2JweW9kZWxtb2ZqdWpndHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjA1NzIsImV4cCI6MjEwNzAzNjU3Mn0.yJkXbQ332rTPz61xf6DZBf42iWgcINmVH7G2J3sjvu0';

const DEFAULT_FORWARD_WEBHOOK_URL = 'https://whatsapp.swaloyalty.com/api/webhooks/whatsapp';
const DEFAULT_VERIFY_TOKEN = 'swa_approval_verify_2026';

interface QueueSessionItem {
  serial: number;
  id: string;
  request_no: string | null;
  title: string;
  amount: number;
  request_type: string;
  shop_name: string;
  department_name: string;
  requester_name: string;
  reviewed_by_name?: string | null;
  notes?: string | null;
  submitted_at?: string | null;
  blocked_reason?: string | null;
}

interface QueueSession {
  id: string;
  admin_id: string;
  status: string;
  items: QueueSessionItem[];
  selected_serials: number[];
  app_url?: string | null;
}

interface RuntimeWhatsAppConfig {
  enabled: boolean;
  access_token: string;
  phone_number_id: string;
  notify_requester: boolean;
  notify_head: boolean;
  admin_phone_number?: string;
  template_language?: string;
  use_template?: boolean;
  forward_webhook_url?: string;
}

const DEFAULT_WA_RUNTIME: RuntimeWhatsAppConfig = {
  enabled: true,
  access_token:
    'EAAzRU40ZBcyoBS1Uyk7UgqBlRIvb407NufgvmPdZBmZCjGsZAiDBervAm9MGZAhkVyou64W2lDt64ZByltVjcRVwvdkndcEPsUZAi0DvoISgKKbRUEZCQZABpLslfpvcrM1fE19UXaVyZCEhaz2ebIZAvuWGpvQG2KZBJNfrksm5vRN44PCuRpco8riA6NnSan6uUgZDZD',
  phone_number_id: '1391767714024374',
  notify_requester: true,
  notify_head: true,
  admin_phone_number: '+91 9846880713',
  template_language: 'en',
  use_template: true,
  forward_webhook_url: DEFAULT_FORWARD_WEBHOOK_URL,
};

function getSupabase(): SupabaseClient {
  return createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Formatting & UTF-16 Safe Clipping Helpers (Meta Cloud API Strict Limits)
// ---------------------------------------------------------------------------

function clipUtf16(input: string, maxUnits: number): string {
  const s = String(input || '').trim();
  if (s.length <= maxUnits) return s;
  if (maxUnits <= 1) return s.slice(0, maxUnits);
  let cut = s.slice(0, maxUnits - 1);
  // Avoid splitting a UTF-16 surrogate pair at the end
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function cleanPhone(phone?: string | null): string {
  if (!phone) return '';
  const d = String(phone).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

const inr = (n: number) =>
  `Rs. ${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0))}`;

const inrShort = (n: number) =>
  `Rs.${new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: Number(n || 0) % 1 === 0 ? 0 : 2,
  }).format(Number(n || 0))}`;

function ist(d: string | Date, withTime = true): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
    })
      .formatToParts(new Date(d))
      .map((p) => [p.type, p.value])
  );
  const date = `${parts.day} ${parts.month} ${parts.year}`;
  return withTime
    ? `${date}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()} IST`
    : date;
}

const TYPE_LABEL: Record<string, string> = {
  general: 'General',
  petty_cash: 'Petty Cash',
  discount: 'Discount',
  exhibition: 'Exhibition',
  asset: 'Asset Buying',
  asset_below_20k: 'Asset (<20k)',
  non_cash: 'Non-Cash',
  stock_transfer: 'Stock Transfer',
};

const PACKET_TYPE_LABEL: Record<string, string> = {
  general: 'General',
  petty_cash: 'Petty Cash (Below 1000)',
  discount: 'Discount approval',
  exhibition: 'Exhibition / event sponsorship',
  asset: 'Asset buying',
  asset_below_20k: 'Asset buying below 20k',
  non_cash: 'Non-cash request',
  stock_transfer: 'Stock transfer',
};

const ACTION_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  resubmitted: 'Resubmitted after correction',
  routed_A: 'Routed to A (Admin)',
  routed_B: 'Routed to B (Head)',
  routed_own_A: 'Routed own request to A',
  routed_own_B: 'Routed own request to B',
  route_changed_A: 'Head changed route to A (Admin)',
  route_changed_B: 'Head changed route to B (Head)',
  forwarded: 'Reviewed and forwarded to Admin',
  returned: 'Returned for correction',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  approved: 'Approved',
  paid: 'Marked as paid',
  sent_for_quote_selection: 'Sent for quotation selection',
  quote_selected: 'Best quotation selected',
  regional_forwarded: 'Forwarded by Regional Head to clerk',
};

const PROVIDES: Record<string, string> = {
  stall_space: 'Stall space',
  table_chairs: 'Table & chairs',
  electricity_lights: 'Electricity & lights',
  logo_stage_banners: 'Logo on stage / banners',
  stage_announcements: 'Stage announcements',
  social_media: 'Social media mentions',
  other: 'Other',
};

function formatAmountDisplay(item: { request_type: string; amount: number }): string {
  if (item.request_type === 'non_cash') return 'Non-Cash';
  if (item.request_type === 'stock_transfer') return `MRP ${inr(item.amount)}`;
  return inr(item.amount);
}

// ---------------------------------------------------------------------------
// PDF Stamping & Packet Generation (100% Parity with Edge Function stamp.ts)
// ---------------------------------------------------------------------------

interface StampContext {
  approvalNo: string;
  approverLine: string;
  dateTime: string;
  requestNo: string;
  amount: string;
  reviewedLine: string | null;
  verifyUrl: string | null;
  seal: Uint8Array;
  signature: Uint8Array;
  headline?: string;
  byLabel?: string;
  tone?: 'approved' | 'rejected';
}

interface FormSection {
  title: string;
  rows?: [string, string][];
  text?: string | null;
}

interface PacketInfo {
  title: string;
  rows: [string, string][];
  notes: string | null;
  documents: { name: string; pages: number }[];
  timeline: { when: string; who: string; what: string; remarks: string | null }[];
}

const GREEN = rgb(0.05, 0.42, 0.29);
const RED = rgb(0.72, 0.11, 0.11);
const INK = rgb(0.1, 0.12, 0.16);
const GREY = rgb(0.42, 0.45, 0.5);
const NAVY = rgb(0.12, 0.16, 0.27);
const GOLD = rgb(0.72, 0.56, 0.2);
const CREAM = rgb(0.96, 0.94, 0.9);
const LINE = rgb(0.82, 0.83, 0.87);
const A4 = { w: 595.28, h: 841.89 };

function toSafePdfText(str: unknown): string {
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

function fitText(text: string, font: import('pdf-lib').PDFFont, size: number, maxWidth: number): string {
  const safeText = toSafePdfText(text);
  if (font.widthOfTextAtSize(safeText, size) <= maxWidth) return safeText;
  let t = safeText;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}...`;
}

function wrapText(text: string, font: import('pdf-lib').PDFFont, size: number, maxWidth: number): string[] {
  const safeText = toSafePdfText(text);
  const out: string[] = [];
  for (const para of safeText.split(/\r?\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        cur = next;
      } else {
        if (cur) out.push(cur);
        cur = fitText(word, font, size, maxWidth);
      }
    }
    out.push(cur);
  }
  return out;
}

async function embedAssets(doc: import('pdf-lib').PDFDocument, ctx: StampContext) {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    seal: await doc.embedPng(ctx.seal),
    signature: await doc.embedPng(ctx.signature),
  };
}

function drawImageFit(
  page: import('pdf-lib').PDFPage,
  img: import('pdf-lib').PDFImage,
  lx: number,
  ly: number,
  bw: number,
  bh: number
) {
  const scale = Math.min(bw / img.width, bh / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: lx + (bw - w) / 2, y: ly + (bh - h) / 2, width: w, height: h });
}

function drawQr(page: import('pdf-lib').PDFPage, text: string, lx: number, ly: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
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

function drawBand(
  page: import('pdf-lib').PDFPage,
  a: Awaited<ReturnType<typeof embedAssets>>,
  ctx: StampContext,
  pageLabel: string,
  pw: number,
  bandH: number,
  s: number
) {
  page.drawRectangle({ x: 0, y: 0, width: pw, height: bandH, color: rgb(1, 1, 1) });
  const accent = ctx.tone === 'rejected' ? RED : GREEN;
  page.drawRectangle({ x: 0, y: bandH - 1.6 * s, width: pw, height: 1.6 * s, color: accent });

  drawImageFit(page, a.seal, 12 * s, (bandH - 84 * s) / 2, 84 * s, 84 * s);
  drawImageFit(page, a.signature, 102 * s, (bandH - 64 * s) / 2, 124 * s, 64 * s);

  const qrSize = ctx.verifyUrl ? 78 * s : 0;
  const x0 = 236 * s;
  const maxW = pw - x0 - (qrSize ? qrSize + 18 * s : 12 * s);
  const line = (
    text: string,
    ly: number,
    size: number,
    font: import('pdf-lib').PDFFont,
    color = INK
  ) => {
    const safe = toSafePdfText(text);
    page.drawText(fitText(safe, font, size * s, maxW), { x: x0, y: ly, size: size * s, font, color });
  };

  line(ctx.headline ?? `APPROVED · Approval No: ${ctx.approvalNo}`, bandH - 22 * s, 11, a.bold, accent);
  line(`${ctx.byLabel ?? 'Approved by'}: ${ctx.approverLine}`, bandH - 39 * s, 8.5, a.regular);
  line(`Date & time: ${ctx.dateTime}`, bandH - 53 * s, 8.5, a.regular);
  line(`Request ${ctx.requestNo} · Amount ${ctx.amount} · ${pageLabel}`, bandH - 67 * s, 8.5, a.regular);
  if (ctx.reviewedLine) line(ctx.reviewedLine, bandH - 81 * s, 7.5, a.regular, GREY);
  if (ctx.verifyUrl) line('Scan the QR code to verify this approval', bandH - 95 * s, 7, a.regular, GREY);
  if (ctx.verifyUrl) drawQr(page, ctx.verifyUrl, pw - qrSize - 10 * s, (bandH - qrSize) / 2, qrSize);
}

function isJpeg(b: Uint8Array) {
  return b[0] === 0xff && b[1] === 0xd8;
}
function isPng(b: Uint8Array) {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

async function stampDocument(
  bytes: Uint8Array,
  ctx: StampContext
): Promise<{ bytes: Uint8Array; pageCount: number }> {
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
    const scale = img.width <= availW && img.height <= availH ? Math.min(fitScale, 1.0) : fitScale;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (pw - w) / 2;
    const y = bandH + margin + (availH - h) / 2;

    page.drawImage(img, { x, y, width: w, height: h });
    drawBand(page, a, ctx, 'Page 1 of 1', pw, bandH, s);
  } else {
    const srcDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    try {
      srcDoc.getForm().flatten();
    } catch {
      /* no form */
    }

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

      let drawOptions: {
        x: number;
        y: number;
        width: number;
        height: number;
        rotate?: ReturnType<typeof degrees>;
      } = {
        x: destX,
        y: destY,
        width: scaledW,
        height: scaledH,
      };

      if (rot === 90) {
        drawOptions = { x: destX + scaledW, y: destY, width: scaledH, height: scaledW, rotate: degrees(90) };
      } else if (rot === 180) {
        drawOptions = {
          x: destX + scaledW,
          y: destY + scaledH,
          width: scaledW,
          height: scaledH,
          rotate: degrees(180),
        };
      } else if (rot === 270) {
        drawOptions = { x: destX, y: destY + scaledH, width: scaledH, height: scaledW, rotate: degrees(270) };
      }

      targetPage.drawPage(embedded, drawOptions);
      drawBand(targetPage, a, ctx, `Page ${i + 1} of ${embeddedPages.length}`, pw, bandH, s);
    }
  }

  targetDoc.setProducer('Approval App');
  targetDoc.setTitle(`${ctx.approvalNo}`);
  return { bytes: await targetDoc.save({ useObjectStreams: true }), pageCount: targetDoc.getPageCount() };
}

async function buildFormPdf(heading: string, subtitle: string, sections: FormSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 40;
  const W = A4.w - 2 * M;
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
    if (y - need < M) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
      header();
    }
  };
  header();

  for (const s of sections) {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 18, width: W, height: 18, color: NAVY });
    page.drawRectangle({ x: M, y: y - 18, width: 4, height: 18, color: GOLD });
    page.drawText(toSafePdfText(s.title.toUpperCase()), {
      x: M + 12,
      y: y - 13,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y -= 18;
    const rows = s.rows ?? [];
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2);
      const colW = W / 2;
      const labW = 105;
      const valW = colW - labW - 10;
      const lines = pair.map(([, v]) => wrapText(v || '-', regular, 9, valW));
      const h = Math.max(24, Math.max(...lines.map((l) => l.length)) * 12 + 10);
      ensure(h);
      pair.forEach(([k], j) => {
        const x = M + j * colW;
        page.drawRectangle({
          x,
          y: y - h,
          width: labW,
          height: h,
          color: CREAM,
          borderColor: LINE,
          borderWidth: 0.6,
        });
        page.drawRectangle({
          x: x + labW,
          y: y - h,
          width: colW - labW,
          height: h,
          borderColor: LINE,
          borderWidth: 0.6,
        });
        wrapText(k, bold, 8.5, labW - 10)
          .slice(0, 3)
          .forEach((l, idx) =>
            page.drawText(l, { x: x + 6, y: y - 14 - idx * 11, size: 8.5, font: bold, color: NAVY })
          );
        lines[j].forEach((l, idx) =>
          page.drawText(l, { x: x + labW + 6, y: y - 14 - idx * 12, size: 9, font: regular, color: INK })
        );
      });
      y -= h;
    }
    if (s.text !== undefined) {
      const lines = wrapText(s.text || '-', regular, 9.5, W - 16).slice(0, 30);
      const h = Math.max(36, lines.length * 13 + 12);
      ensure(h);
      page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: LINE, borderWidth: 0.6 });
      lines.forEach((l, idx) =>
        page.drawText(l, { x: M + 8, y: y - 16 - idx * 13, size: 9.5, font: regular, color: INK })
      );
      y -= h;
    }
    y -= 12;
  }
  ensure(20);
  const foot = 'SWA Diamonds · Internal Approval Form';
  page.drawText(foot, {
    x: (A4.w - regular.widthOfTextAtSize(foot, 7.5)) / 2,
    y: M - 10,
    size: 7.5,
    font: regular,
    color: GREY,
  });
  doc.setProducer('Approval App');
  return await doc.save({ useObjectStreams: true });
}

async function buildPacket(info: PacketInfo, signed: Uint8Array[], ctx: StampContext) {
  const doc = await PDFDocument.create();
  const a = await embedAssets(doc, ctx);
  let page = doc.addPage([A4.w, A4.h]);
  const s = 1.0;
  const bandH = 110 * s;
  const M = 48;
  const maxW = A4.w - 2 * M;
  let y = A4.h - M;

  const newPageIfNeeded = (need: number) => {
    if (y - need < bandH + 20) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };
  const text = (t: string, size: number, font = a.regular, color = INK, x = M) => {
    const safe = toSafePdfText(t);
    newPageIfNeeded(size + 6);
    page.drawText(safe, { x, y: y - size, size, font, color });
    y -= size + 6;
  };

  text('APPROVAL PACKET', 10, a.bold, GREEN);
  text(fitText(info.title, a.bold, 18, maxW), 18, a.bold);
  y -= 6;
  page.drawRectangle({ x: M, y, width: maxW, height: 1, color: GREEN });
  y -= 14;
  for (const [k, v] of info.rows) {
    newPageIfNeeded(18);
    page.drawText(toSafePdfText(k), { x: M, y: y - 10, size: 10, font: a.bold, color: GREY });
    const lines = wrapText(v, a.regular, 10, maxW - 140);
    lines.forEach((l, i) =>
      page.drawText(l, { x: M + 140, y: y - 10 - i * 14, size: 10, font: a.regular, color: INK })
    );
    y -= Math.max(1, lines.length) * 14 + 4;
  }
  if (info.notes) {
    y -= 8;
    text('Notes', 12, a.bold);
    for (const l of wrapText(info.notes, a.regular, 9.5, maxW).slice(0, 40)) text(l, 9.5);
  }
  y -= 8;
  text('Documents', 12, a.bold);
  info.documents.forEach((d, i) =>
    text(fitText(`${i + 1}. ${d.name} - ${d.pages} page${d.pages === 1 ? '' : 's'}`, a.regular, 9.5, maxW), 9.5)
  );
  y -= 8;
  text('Timeline', 12, a.bold);
  for (const t of info.timeline) {
    text(fitText(`${t.when} · ${t.who} · ${t.what}`, a.regular, 9.5, maxW), 9.5);
    if (t.remarks) {
      for (const l of wrapText(`"${t.remarks}"`, a.regular, 9, maxW - 16).slice(0, 6)) {
        text(l, 9, a.regular, GREY, M + 16);
      }
    }
  }
  const coverPages = doc.getPages();
  coverPages.forEach((p, i) =>
    drawBand(
      p,
      a,
      ctx,
      coverPages.length > 1 ? `Cover ${i + 1} of ${coverPages.length}` : 'Cover page',
      A4.w,
      bandH,
      s
    )
  );

  for (const bytes of signed) {
    const src = await PDFDocument.load(bytes);
    const copied = await doc.copyPages(src, src.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
  }
  doc.setProducer('Approval App');
  doc.setTitle(`${ctx.approvalNo} packet`);
  return { bytes: await doc.save({ useObjectStreams: true }), pageCount: doc.getPageCount() };
}

function formSections(
  r: any,
  submitted: string,
  files: any[] = []
): { subtitle: string; label: string; sections: FormSection[] } | null {
  const d = r.details ?? {};
  const money = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : inr(Number(v)));
  const txt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

  if (r.request_type === 'discount') {
    return {
      subtitle: 'DISCOUNT APPROVAL FORM',
      label: 'discount_form',
      sections: [
        {
          title: 'Request',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet / Shop', txt(r.shop_name)],
            ['Department', txt(r.department)],
            ['Subject', txt(r.title)],
            ['Customer', txt(d.customer_name)],
            ['Bill / Ref No', txt(d.reference)],
            ['Invoice No', txt(d.invoice_no)],
            ['Date of Bill', txt(d.bill_date)],
          ],
        },
        {
          title: 'Discount',
          rows: [
            ['Amount before discount', money(d.before_amount)],
            ['Amount after discount', money(d.after_amount)],
            ['Discount amount', money(d.discount_amount)],
            ['Discount %', `${Number(d.discount_pct ?? 0).toFixed(2)} %`],
          ],
        },
        { title: 'Remarks', text: r.notes ?? '' },
      ],
    };
  }

  if (r.request_type === 'exhibition') {
    const provides = (Array.isArray(d.provides) ? d.provides : []).map((p: string) => PROVIDES[p] ?? p);
    if (d.provides_other) provides.push(`Other: ${d.provides_other}`);
    const exhShop =
      typeof d.conducting_shop_name === 'string' && d.conducting_shop_name.trim()
        ? d.conducting_shop_name.trim()
        : 'Not Assigned';
    return {
      subtitle: 'EVENT SPONSORSHIP & PROMOTION APPROVAL FORM',
      label: 'exhibition_form',
      sections: [
        {
          title: 'Request',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet', exhShop],
          ],
        },
        {
          title: '1  Event details',
          rows: [
            ['Conducting Shop', exhShop],
            ['Event Name', txt(d.event_name)],
            ['Organiser & Contact', txt(d.organiser_contact)],
            ['Venue', txt(d.venue)],
            ['Event Date(s) & Time', txt(d.event_dates)],
            ['Expected Footfall', txt(d.expected_footfall)],
            ['Stall Size & Location', txt(d.stall_size_location)],
          ],
        },
        {
          title: '2  Sponsorship amount',
          rows: [
            ['Amount (excl. GST)', money(d.amount_excl_gst)],
            [`GST ${Number(d.gst_pct ?? 0)} %`, money(d.gst_amount)],
            ['Total incl. GST', money(d.total_incl_gst)],
            ['Payment Mode & Due Date', txt(d.payment_mode_due)],
            ['Organiser GSTIN', txt(d.organiser_gstin)],
            ['GST Invoice Provided', d.gst_invoice ? 'Yes' : 'No'],
          ],
        },
        { title: '3  Event team will provide', text: provides.length ? provides.join('  ·  ') : '—' },
        {
          title: '4  Our promotion plan',
          rows: [
            ['Rs. 1,000 Vouchers (Qty)', txt(d.voucher_1000_qty)],
            ['Rs. 500 Vouchers (Qty)', txt(d.voucher_500_qty)],
            ['Rs. 1,000 Voucher Min. Purchase', money(d.voucher_1000_min)],
            ['Rs. 500 Voucher Min. Purchase', money(d.voucher_500_min)],
            ['Voucher Validity', txt(d.voucher_validity)],
            ['Lucky Draw Prize & Value', txt(d.lucky_draw)],
            ['No. of Winners & Draw Date', txt(d.winners_draw)],
            ['Other Costs (printing, branding, staff)', money(d.other_costs)],
            ['Total Budget', money(d.total_budget)],
          ],
        },
        { title: '5  Purpose / expected result', text: d.purpose ?? '' },
        ...(r.notes ? [{ title: 'Remarks', text: r.notes as string }] : []),
      ],
    };
  }

  if (r.request_type === 'asset' || r.request_type === 'asset_below_20k') {
    const quotes = (files ?? []).filter((f: any) => f.quote_amount !== null && f.quote_amount !== undefined);
    const lowest = quotes.length
      ? Math.min(...quotes.map((q: { quote_amount: number }) => Number(q.quote_amount)))
      : null;
    const quoteRows: [string, string][] = quotes.map((q: any, i: number) => [
      `Q${i + 1} · ${q.quote_vendor ?? q.original_name}`,
      [
        money(q.quote_amount),
        q.quote_status === 'selected' ? 'SELECTED' : 'REJECTED',
        q.quote_preferred ? "Requester's choice" : null,
        Number(q.quote_amount) === lowest ? 'Lowest' : null,
      ]
        .filter(Boolean)
        .join('  ·  '),
    ]);
    return {
      subtitle: 'ASSET PURCHASE APPROVAL FORM',
      label: 'asset_purchase_form',
      sections: [
        {
          title: 'Request',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet / Shop', txt(r.shop_name)],
            ['Department', txt(r.department)],
            ['Subject', txt(r.title)],
          ],
        },
        {
          title: 'Asset',
          rows: [
            ['Asset', txt(d.asset_name)],
            ['Quantity', txt(d.quantity)],
            ['Specification', txt(d.specification)],
          ],
        },
        {
          title: 'Quotation comparison',
          rows: [
            ...quoteRows,
            ['Approved amount', money(r.amount)],
            [
              'Quotation selected by',
              [r.quote_selected_by_name, r.quote_selected_at ? ist(r.quote_selected_at) : null]
                .filter(Boolean)
                .join(', ') || '—',
            ],
          ],
        },
        ...(d.purpose ? [{ title: 'Purpose', text: d.purpose as string }] : []),
        ...(r.notes ? [{ title: 'Remarks', text: r.notes as string }] : []),
      ],
    };
  }

  if (r.request_type === 'stock_transfer') {
    const isBulk = d.transfer_mode === 'bulk';
    const items = Array.isArray(d.items) ? d.items : [];
    const itemRows: [string, string][] = items.map((item: any, i: number) => [
      `Item ${i + 1} · ${item.category_name ?? 'Product'}`,
      `Barcode: ${item.barcode || '—'} | SKU: ${item.sku || '—'} | Wt: ${
        item.gross_weight_grams ?? item.gross_weight ? `${item.gross_weight_grams ?? item.gross_weight} g` : '—'
      } | MRP: ${money(item.mrp)}`,
    ]);
    const totalGross = d.total_gross_weight_grams ?? d.total_gross_weight;
    return {
      subtitle: 'STOCK TRANSFER APPROVAL FORM',
      label: 'stock_transfer_form',
      sections: [
        {
          title: 'Transfer Details',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Origin Shop (From)', txt(d.from_shop_name ?? r.shop_name)],
            ['Destination Shop (To)', txt(d.to_shop_name)],
            ['Transfer Mode', isBulk ? 'Bulk Transfer (4+ Items)' : 'Itemized Transfer'],
            ['Total Pieces', txt(d.total_pieces ?? items.length)],
            ['Total Gross Weight', totalGross ? `${totalGross} g` : '—'],
            ['Total MRP Value', money(d.total_mrp ?? r.amount)],
          ],
        },
        ...(isBulk
          ? [
              {
                title: 'Bulk Transfer Summary',
                rows: [
                  ['Product Category', txt(d.bulk_category_name ?? d.category_name)],
                  ['Pieces', txt(d.total_pieces)],
                  ['Gross Weight', totalGross ? `${totalGross} g` : '—'],
                  ['Total MRP', money(d.total_mrp ?? r.amount)],
                ] as [string, string][],
              },
            ]
          : items.length
          ? [{ title: 'Itemized Products', rows: itemRows }]
          : []),
        ...(r.notes ? [{ title: 'Remarks / Purpose', text: r.notes as string }] : []),
      ],
    };
  }

  if (r.request_type === 'non_cash') {
    const val = Number(d.associated_value || 0);
    return {
      subtitle: 'NON-CASH APPROVAL FORM',
      label: 'non_cash_form',
      sections: [
        {
          title: 'Request',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet / Shop', txt(r.shop_name)],
            ['Department', txt(r.department)],
            ['Subject / Title', txt(r.title)],
            ['Payment Consideration', 'Non-Cash (No direct disbursement)'],
          ],
        },
        ...(val > 0 || d.associated_notes
          ? [
              {
                title: 'Associated Cash / Value / Adjustment (Not Paid Directly)',
                rows: [
                  ...(val > 0 ? ([['Associated Value', money(val)]] as [string, string][]) : []),
                  ...(d.associated_notes
                    ? ([['Adjustment Details', txt(d.associated_notes)]] as [string, string][])
                    : []),
                ],
              },
            ]
          : []),
        ...(r.notes ? [{ title: 'Remarks / Purpose', text: r.notes as string }] : []),
      ],
    };
  }

  if (r.request_type === 'petty_cash') {
    const alreadyUploaded = (files ?? []).some((f: any) =>
      String(f?.original_name ?? '')
        .toLowerCase()
        .includes('petty_cash_form_below_1000')
    );
    if (alreadyUploaded) return null;
    const payMode =
      String(r.disbursement_mode ?? d.disbursement_mode ?? 'cash').toLowerCase() === 'bank'
        ? 'Bank Transfer'
        : 'Cash (Default)';
    return {
      subtitle: 'PETTY CASH FORM BELOW 1000',
      label: 'petty_cash_form_below_1000',
      sections: [
        {
          title: 'Petty Cash Voucher Details (Max Rs. 1,000.00)',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet / Shop', txt(r.shop_name)],
            ['Petty Cash Dealing Head', txt(r.owner_head_name ?? r.department)],
            ['Disbursement Entry Account', txt(r.assigned_entry_user_name)],
            ['Payment Mode', payMode],
            ['Requested Amount (<= Rs. 1,000)', money(r.amount)],
          ],
        },
        { title: 'Mandatory Note / Purpose', text: r.notes ?? '-' },
      ],
    };
  }

  // Fallback form if a general request has zero uploaded documents
  if (!files || files.length === 0) {
    return {
      subtitle: 'GENERAL APPROVAL FORM',
      label: 'general_approval_form',
      sections: [
        {
          title: 'Request Details',
          rows: [
            ['Request No', txt(r.request_no)],
            ['Date', submitted],
            ['Requested by', txt(r.requester_name)],
            ['Outlet / Shop', txt(r.shop_name)],
            ['Department', txt(r.department)],
            ['Subject / Title', txt(r.title)],
            ['Approved Amount', money(r.amount)],
          ],
        },
        { title: 'Notes / Description', text: r.notes ?? '-' },
      ],
    };
  }

  return null;
}

function safeName(name: string): string {
  const base = String(name || 'document')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (base || 'document').slice(0, 40);
}

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Meta Cloud API Messaging Helpers (Text, Interactive Buttons, Interactive List, PDF)
// ---------------------------------------------------------------------------

async function sendMetaPayload(cfg: RuntimeWhatsAppConfig, payload: Record<string, unknown>) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(cfg.phone_number_id)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { ok: res.ok, status: res.status, data };
}

async function markMessageRead(cfg: RuntimeWhatsAppConfig, messageId: string): Promise<boolean> {
  if (!messageId || !cfg.access_token || !cfg.phone_number_id) return true;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(cfg.phone_number_id)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
    return res.ok;
  } catch {
    return true;
  }
}

async function sendTextMessage(cfg: RuntimeWhatsAppConfig, to: string, body: string) {
  return sendMetaPayload(cfg, {
    to: cleanPhone(to),
    type: 'text',
    text: { preview_url: false, body: clipUtf16(body, 4000) },
  });
}

async function sendReplyButtons(
  cfg: RuntimeWhatsAppConfig,
  to: string,
  params: {
    headerText?: string;
    bodyText: string;
    footerText?: string;
    buttons: { id: string; title: string }[];
  }
) {
  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: clipUtf16(params.bodyText, 1020) },
    action: {
      buttons: params.buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: {
          id: clipUtf16(b.id, 250),
          title: clipUtf16(b.title, 20),
        },
      })),
    },
  };
  if (params.headerText) {
    interactive.header = { type: 'text', text: clipUtf16(params.headerText, 60) };
  }
  if (params.footerText) {
    interactive.footer = { text: clipUtf16(params.footerText, 60) };
  }
  const res = await sendMetaPayload(cfg, {
    to: cleanPhone(to),
    type: 'interactive',
    interactive,
  });
  if (!res.ok) {
    console.error('sendReplyButtons error:', JSON.stringify(res.data));
  }
  return res;
}

async function sendInteractiveList(
  cfg: RuntimeWhatsAppConfig,
  to: string,
  params: {
    headerText?: string;
    bodyText: string;
    footerText?: string;
    buttonLabel: string;
    sectionTitle: string;
    rows: { id: string; title: string; description?: string }[];
  }
) {
  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: clipUtf16(params.bodyText, 1020) },
    action: {
      button: clipUtf16(params.buttonLabel, 20),
      sections: [
        {
          title: clipUtf16(params.sectionTitle, 24),
          rows: params.rows.slice(0, 10).map((r) => ({
            id: clipUtf16(r.id, 200),
            title: clipUtf16(r.title, 24),
            ...(r.description ? { description: clipUtf16(r.description, 72) } : {}),
          })),
        },
      ],
    },
  };
  if (params.headerText) {
    interactive.header = { type: 'text', text: clipUtf16(params.headerText, 60) };
  }
  if (params.footerText) {
    interactive.footer = { text: clipUtf16(params.footerText, 60) };
  }
  const res = await sendMetaPayload(cfg, {
    to: cleanPhone(to),
    type: 'interactive',
    interactive,
  });
  if (!res.ok) {
    console.error('sendInteractiveList error:', JSON.stringify(res.data));
  }
  return res;
}

// ---------------------------------------------------------------------------
// Queue Formatting & Selection Helpers
// ---------------------------------------------------------------------------

function formatQueueLine(item: QueueSessionItem): string {
  const typeLabel = TYPE_LABEL[item.request_type] || 'Request';
  const amtStr = formatAmountDisplay(item);
  const shopDept = [
    item.shop_name && item.shop_name !== '—' ? item.shop_name : null,
    item.department_name && item.department_name !== '—' ? item.department_name : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const lines = [
    `*${item.serial}.* *${item.request_no || 'REQ'}* · *${amtStr}*`,
    `   📝 ${clipUtf16(item.title, 65)} _(${typeLabel})_`,
    `   🏢 ${clipUtf16(shopDept || 'General', 60)} · 👤 ${clipUtf16(item.requester_name, 30)}`,
  ];
  if (item.blocked_reason) {
    lines.push(`   ⚠️ _Blocked: ${item.blocked_reason}_`);
  }
  return lines.join('\n');
}

function chunkTextBlocks(blocks: string[], maxLen = 3600): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxLen) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = block.slice(0, maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseSerialNumbersFromText(text: string, maxSerial: number): number[] | null {
  const trimmed = text.trim();
  if (!trimmed || !/\d/.test(trimmed)) return null;
  // Match strings like "1", "1, 3", "1 2 4", "1-3", "1, 3-5 and 7", "#1 #2"
  if (!/^[#\d,\s\-and&]+$/i.test(trimmed)) return null;

  const cleaned = trimmed.replace(/#/g, '').replace(/\band\b/gi, ',').replace(/&/g, ',');
  const tokens = cleaned.split(/[,\s]+/).filter(Boolean);
  if (!tokens.length) return null;

  const out = new Set<number>();
  for (const tok of tokens) {
    const rangeMatch = tok.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let k = lo; k <= Math.min(hi, maxSerial + 50); k++) {
        out.add(k);
      }
    } else if (/^\d+$/.test(tok)) {
      out.add(parseInt(tok, 10));
    } else {
      return null;
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

async function sendAllQueueResponse(
  cfg: RuntimeWhatsAppConfig,
  to: string,
  sessionId: string,
  items: QueueSessionItem[],
  hasCredentials: boolean
) {
  const actionable = items.filter((i) => !i.blocked_reason);
  const totalAmount = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const blocks = items.map(formatQueueLine);

  const headerLine = `📋 *ADMIN TO APPROVE (${items.length})*`;
  const summaryFooter =
    `\n━━━━━━━━━━━━━━━\n` +
    `💰 *Total:* ${inr(totalAmount)} (${actionable.length}/${items.length} ready)` +
    (!hasCredentials
      ? `\n⚠️ _Note: Upload Admin Seal & Signature in Web App before stamping._`
      : '') +
    `\n\nChoose an option below:`;

  const singleBody = `${headerLine}\n\n${blocks.join('\n\n')}${summaryFooter}`;

  const buttons = [
    { id: `wa_all:${sessionId}`, title: '✅ Approve All' },
    { id: `wa_sel:${sessionId}:0`, title: '☑️ Selected Only' },
  ];

  // Meta Interactive Button body max = 1024 chars. If everything fits, send in 1 sleek card!
  if (singleBody.length <= 980) {
    await sendReplyButtons(cfg, to, {
      bodyText: singleBody,
      footerText: 'Or reply serial nos directly (e.g. 1, 3)',
      buttons,
    });
    return;
  }

  // Otherwise send full serial list in text message chunk(s) so zero items are truncated,
  // followed immediately by the Interactive 2-Button Action Card.
  const textChunks = chunkTextBlocks([headerLine, ...blocks], 3600);
  for (const chunk of textChunks) {
    await sendTextMessage(cfg, to, chunk);
  }

  await sendReplyButtons(cfg, to, {
    headerText: `Pending Approvals (${items.length})`,
    bodyText:
      `Listed *1 to ${items.length}* above.\n` +
      `💰 *Total Amount:* ${inr(totalAmount)}\n` +
      `✅ *Ready to Approve:* ${actionable.length} of ${items.length}` +
      (!hasCredentials
        ? `\n⚠️ _Upload Admin Seal & Signature in Web App before approving._`
        : '') +
      `\n\nSelect how you would like to proceed:`,
    footerText: 'Or reply serial nos directly (e.g. 1, 3)',
    buttons,
  });
}

async function sendInteractivePickerPage(
  cfg: RuntimeWhatsAppConfig,
  to: string,
  session: QueueSession,
  page: number
) {
  const items = session.items || [];
  const selectedSet = new Set(session.selected_serials || []);
  const totalItems = items.length;

  // Max 10 rows per WhatsApp Interactive List. If > 10 items, use 9 items per page + 1 Next/First page row.
  const pageSize = totalItems <= 10 ? 10 : 9;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = ((page % totalPages) + totalPages) % totalPages;
  const slice = items.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const rows: { id: string; title: string; description?: string }[] = slice.map((item) => {
    const isSel = selectedSet.has(item.serial);
    const mark = item.blocked_reason ? '⚠️' : isSel ? '✅' : '⬜';
    const amt = item.request_type === 'non_cash' ? 'NonCash' : inrShort(item.amount);
    const shopPart = item.shop_name && item.shop_name !== '—' ? ` · ${item.shop_name}` : '';
    return {
      id: `wa_tog:${session.id}:${item.serial}:${safePage}`,
      title: clipUtf16(`${mark} #${item.serial} · ${amt}`, 24),
      description: clipUtf16(
        item.blocked_reason
          ? `${item.request_no || 'REQ'} · Blocked: ${item.blocked_reason}`
          : `${item.request_no || 'REQ'} · ${item.title}${shopPart}`,
        72
      ),
    };
  });

  if (totalPages > 1) {
    const nextPage = (safePage + 1) % totalPages;
    const nextStart = nextPage * pageSize + 1;
    const nextEnd = Math.min((nextPage + 1) * pageSize, totalItems);
    rows.push({
      id: `wa_sel:${session.id}:${nextPage}`,
      title: clipUtf16(`➡️ Items #${nextStart}-#${nextEnd}`, 24),
      description: `View page ${nextPage + 1} of ${totalPages}`,
    });
  }

  const selList = session.selected_serials || [];
  const selSummary =
    selList.length > 0
      ? `Currently selected: *${selList.map((n) => `#${n}`).join(', ')}*`
      : `No requests selected yet.`;

  await sendInteractiveList(cfg, to, {
    headerText: 'Selected Only — Pick Requests',
    bodyText:
      `${selSummary}\n\n` +
      `1️⃣ Tap *"Choose Requests"* below to select/unselect items from the menu.\n` +
      `2️⃣ Or simply reply with serial numbers (for example: *1, 3* or *1-3*).`,
    footerText: totalPages > 1 ? `Page ${safePage + 1} of ${totalPages}` : 'Tap an item to toggle selection',
    buttonLabel: 'Choose Requests',
    sectionTitle: `Requests (${safePage * pageSize + 1}-${Math.min((safePage + 1) * pageSize, totalItems)})`,
    rows,
  });
}

async function sendSelectionConfirmationCard(
  cfg: RuntimeWhatsAppConfig,
  to: string,
  session: QueueSession,
  page = 0,
  extraNotice?: string
) {
  const items = session.items || [];
  const selectedSet = new Set(session.selected_serials || []);
  const chosen = items.filter((i) => selectedSet.has(i.serial));

  if (chosen.length === 0) {
    await sendReplyButtons(cfg, to, {
      headerText: 'No Requests Selected',
      bodyText:
        (extraNotice ? `${extraNotice}\n\n` : '') +
        `No requests are currently selected.\nTap *Choose Requests* to pick items or reply with serial numbers (e.g. *1, 2*).`,
      buttons: [
        { id: `wa_sel:${session.id}:${page}`, title: '📋 Choose Requests' },
        { id: `wa_can:${session.id}`, title: '❌ Cancel' },
      ],
    });
    return;
  }

  const totalAmt = chosen.reduce((s, i) => s + Number(i.amount || 0), 0);
  const chosenLines = chosen
    .slice(0, 12)
    .map((i) => `✅ *#${i.serial}* ${i.request_no || 'REQ'} — ${clipUtf16(i.title, 34)} (${formatAmountDisplay(i)})`)
    .join('\n');
  const moreSuffix = chosen.length > 12 ? `\n_...and ${chosen.length - 12} more selected_` : '';

  const body =
    (extraNotice ? `${extraNotice}\n\n` : '') +
    `☑️ *Selected Requests (${chosen.length} of ${items.length}):*\n\n` +
    `${chosenLines}${moreSuffix}\n\n` +
    `💰 *Selected Total:* ${inr(totalAmt)}\n\n` +
    `Tap *Approve (${chosen.length})* to sign & approve now, or *Edit Selection* to add/remove items.`;

  await sendReplyButtons(cfg, to, {
    bodyText: body,
    footerText: 'Or reply serial numbers to replace selection',
    buttons: [
      { id: `wa_ok:${session.id}`, title: `✅ Approve (${chosen.length})` },
      { id: `wa_sel:${session.id}:${page}`, title: '📋 Edit Selection' },
      { id: `wa_can:${session.id}`, title: '❌ Cancel' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Single Request Stamping + Finalization + Outbound WhatsApp PDF Dispatch
// ---------------------------------------------------------------------------

interface CredentialCache {
  sealPath?: string;
  sealBytes?: Uint8Array;
  signaturePath?: string;
  signatureBytes?: Uint8Array;
}

async function approveSingleRequestViaBot(params: {
  supabase: SupabaseClient;
  botSecret: string;
  senderPhone: string;
  requestId: string;
  appUrl: string | null;
  waCfg: RuntimeWhatsAppConfig;
  credCache: CredentialCache;
}): Promise<{ ok: boolean; approvalNo?: string; error?: string }> {
  const { supabase, botSecret, senderPhone, requestId, appUrl, waCfg, credCache } = params;

  const { data: begun, error: beginErr } = await supabase.rpc('whatsapp_bot_begin_approval', {
    p_bot_secret: botSecret,
    p_sender_phone: senderPhone,
    p_request_id: requestId,
  });

  if (beginErr || !begun) {
    return { ok: false, error: beginErr?.message || 'Could not start approval' };
  }

  const b = begun as any;
  const approverId: string = b.approver_id || b.approver?.id;

  try {
    const downloadBytes = async (bucket: string, storagePath: string): Promise<Uint8Array> => {
      const { data, error } = await supabase.storage.from(bucket).download(storagePath);
      if (error || !data) {
        throw new Error(`Could not read ${storagePath.split('/').pop() || storagePath}: ${error?.message || 'empty'}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    };

    if (!credCache.sealBytes || credCache.sealPath !== b.seal_path) {
      credCache.sealBytes = await downloadBytes('credentials', b.seal_path);
      credCache.sealPath = b.seal_path;
    }
    if (!credCache.signatureBytes || credCache.signaturePath !== b.signature_path) {
      credCache.signatureBytes = await downloadBytes('credentials', b.signature_path);
      credCache.signaturePath = b.signature_path;
    }

    const r = b.request;
    const approverObj = b.approver ?? {};
    const approverLine = [
      approverObj.full_name,
      approverObj.designation,
      approverObj.department ?? 'Administration',
    ]
      .filter(Boolean)
      .join(', ');

    const ctx: StampContext = {
      approvalNo: b.approval_no,
      approverLine,
      dateTime: ist(b.decided_at),
      requestNo: r.request_no,
      amount:
        r.request_type === 'stock_transfer'
          ? `Stock Transfer (MRP: ${inr(Number(r.amount))})`
          : r.request_type === 'non_cash'
          ? 'Non-Cash (No payment)'
          : inr(Number(r.amount)),
      reviewedLine:
        r.route === 'A' && r.reviewed_by_name && r.reviewed_at
          ? `Reviewed by: ${r.reviewed_by_name}, ${ist(r.reviewed_at, false)}`
          : null,
      verifyUrl: appUrl && r.verify_token ? `${appUrl}/verify/${r.verify_token}` : null,
      seal: credCache.sealBytes,
      signature: credCache.signatureBytes,
    };

    const files: any[] = Array.isArray(b.files) ? b.files : [];
    const form = formSections(r, r.submitted_at ? ist(r.submitted_at, false) : '—', files);
    if (!files.length && !form) {
      throw new Error('No documents to sign');
    }

    const signedBytes: Uint8Array[] = [];
    const records: Record<string, unknown>[] = [];
    const docsInfo: { name: string; pages: number }[] = [];

    const storeSignedPdf = async (
      bytes: Uint8Array,
      index: number,
      label: string,
      sourceId: string | null,
      pages: number,
      inPacket = true
    ) => {
      const fileName = `${b.approval_no}_${String(index).padStart(2, '0')}_${safeName(label)}.pdf`;
      const path = `${requestId}/${fileName}`;
      const { error } = await supabase.storage
        .from('signed-documents')
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      if (inPacket) {
        signedBytes.push(bytes);
        docsInfo.push({ name: label, pages });
      }
      records.push({
        source_file_id: sourceId,
        is_packet: false,
        file_name: fileName,
        storage_path: path,
        sha256: sha256Hex(bytes),
        page_count: pages,
      });
    };

    let n = 0;
    if (form) {
      const formPdf = await buildFormPdf('SWA DIAMONDS', form.subtitle, form.sections);
      const out = await stampDocument(formPdf, ctx);
      await storeSignedPdf(out.bytes, ++n, form.label, null, out.pageCount);
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const src = await downloadBytes('request-files', f.storage_path);
      const isQuote =
        (r.request_type === 'asset' || r.request_type === 'asset_below_20k') &&
        f.quote_amount !== null &&
        f.quote_amount !== undefined;
      const rejected = isQuote && f.quote_status !== 'selected';
      const fileCtx: StampContext = !isQuote
        ? ctx
        : rejected
        ? {
            ...ctx,
            tone: 'rejected',
            headline: `REJECTED QUOTATION · NOT SELECTED · Approval No: ${b.approval_no}`,
            byLabel: 'Rejected by',
            amount: `${inr(Number(f.quote_amount))} quoted (not selected)`,
          }
        : { ...ctx, headline: `APPROVED · SELECTED QUOTATION · Approval No: ${b.approval_no}` };

      const out = await stampDocument(src, fileCtx);
      const label = !isQuote
        ? f.original_name
        : `${rejected ? 'REJECTED' : 'SELECTED'}_${f.quote_vendor ?? 'quote'}_${f.original_name}`;
      await storeSignedPdf(out.bytes, ++n, label, f.id, out.pageCount, !rejected);
    }

    const packet = await buildPacket(
      {
        title: r.title,
        rows: [
          ['Approval No', b.approval_no],
          ['Request No', r.request_no],
          ['Type', PACKET_TYPE_LABEL[r.request_type] ?? 'General'],
          [
            'Amount',
            r.request_type === 'stock_transfer'
              ? `Total MRP: ${inr(Number(r.amount))} (Stock Transfer)`
              : r.request_type === 'non_cash'
              ? 'Non-Cash (No payment)'
              : inr(Number(r.amount)),
          ],
          ['Department', r.department ?? '—'],
          [
            'Shop',
            r.request_type === 'exhibition'
              ? typeof r.details?.conducting_shop_name === 'string' && r.details.conducting_shop_name.trim()
                ? r.details.conducting_shop_name.trim()
                : 'Not Assigned'
              : r.shop_name ?? '—',
          ],
          ['Requested by', r.requester_name],
          ['Submitted', r.submitted_at ? ist(r.submitted_at) : '—'],
          ['Route', r.route === 'A' ? 'A — Admin approval' : 'B — Head approval'],
          ['Approved by', approverLine],
          ['Approved on', ctx.dateTime],
        ],
        notes: r.notes,
        documents: docsInfo,
        timeline: [
          ...((b.timeline as any[]) || []).map((t) => ({
            when: ist(t.created_at),
            who: t.actor_name,
            what: ACTION_LABEL[t.action] ?? t.action,
            remarks: t.remarks,
          })),
          {
            when: ctx.dateTime,
            who: approverObj.full_name || 'Admin',
            what: `Approved via WhatsApp · ${b.approval_no}`,
            remarks: null,
          },
        ],
      },
      signedBytes,
      ctx
    );

    const packetName = `${b.approval_no}_packet.pdf`;
    const packetPath = `${requestId}/${packetName}`;
    const { error: pErr } = await supabase.storage
      .from('signed-documents')
      .upload(packetPath, packet.bytes, { contentType: 'application/pdf', upsert: true });
    if (pErr) throw new Error(`Packet upload failed: ${pErr.message}`);

    records.unshift({
      source_file_id: null,
      is_packet: true,
      file_name: packetName,
      storage_path: packetPath,
      sha256: sha256Hex(packet.bytes),
      page_count: packet.pageCount,
    });

    // Finalize in DB (automatically revokes temporary storage grants & broadcasts Realtime to Web App)
    const { error: finErr } = await supabase.rpc('whatsapp_bot_finalize_approval', {
      p_bot_secret: botSecret,
      p_sender_phone: senderPhone,
      p_request_id: requestId,
      p_approver_id: approverId,
      p_files: records,
    });
    if (finErr) throw new Error(finErr.message);

    // Dispatch stamped approval PDF packet on WhatsApp to Requester, Head & Admin
    await dispatchApprovedPacketNotifications({
      supabase,
      botSecret,
      waCfg,
      requestId,
      approvalNo: b.approval_no,
      requestObj: r,
      approverName: approverObj.full_name || 'Admin',
      amountStr: ctx.amount,
      dateTimeStr: ctx.dateTime,
      packetBytes: packet.bytes,
      recipientsInfo: b.recipients || {},
    });

    return { ok: true, approvalNo: b.approval_no };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`WhatsApp bot signing failed for ${requestId}:`, msg);
    try {
      await supabase.rpc('whatsapp_bot_abort_approval', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_request_id: requestId,
        p_approver_id: approverId,
        p_error: msg,
      });
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  }
}

async function dispatchApprovedPacketNotifications(params: {
  supabase: SupabaseClient;
  botSecret: string;
  waCfg: RuntimeWhatsAppConfig;
  requestId: string;
  approvalNo: string;
  requestObj: any;
  approverName: string;
  amountStr: string;
  dateTimeStr: string;
  packetBytes: Uint8Array;
  recipientsInfo: {
    requester_name?: string;
    requester_phone?: string;
    head_name?: string;
    head_phone?: string;
  };
}) {
  const {
    supabase,
    botSecret,
    waCfg,
    requestId,
    approvalNo,
    requestObj: r,
    approverName,
    amountStr,
    dateTimeStr,
    packetBytes,
    recipientsInfo,
  } = params;

  if (!waCfg.enabled || !waCfg.access_token || !waCfg.phone_number_id) return;

  const docFilename = `${approvalNo}_Approved_Document.pdf`;
  let mediaId: string | null = null;

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([Buffer.from(packetBytes)], { type: 'application/pdf' }), docFilename);
    const mRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(waCfg.phone_number_id)}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${waCfg.access_token}` },
        body: form,
      }
    );
    const mJson = (await mRes.json().catch(() => ({}))) as any;
    if (mRes.ok && mJson?.id) {
      mediaId = String(mJson.id);
    }
  } catch (e) {
    console.warn('Media upload warning in WhatsApp bot:', e);
  }

  if (!mediaId) return;

  const rawTargets: { phone: string; name: string }[] = [];
  if (waCfg.notify_requester && recipientsInfo.requester_phone) {
    rawTargets.push({
      phone: recipientsInfo.requester_phone,
      name: recipientsInfo.requester_name || r.requester_name || 'Requester',
    });
  }
  if (waCfg.notify_head && recipientsInfo.head_phone) {
    rawTargets.push({
      phone: recipientsInfo.head_phone,
      name: recipientsInfo.head_name || 'Department Head',
    });
  }
  if (waCfg.admin_phone_number && waCfg.admin_phone_number.trim()) {
    rawTargets.push({
      phone: waCfg.admin_phone_number.trim(),
      name: 'Admin Copy',
    });
  }

  const seen = new Set<string>();
  const targets = rawTargets.filter((t) => {
    const c = cleanPhone(t.phone);
    if (!c || c.length < 10 || seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  const outletLabel =
    r.request_type === 'exhibition'
      ? (typeof r.details?.conducting_shop_name === 'string' && r.details.conducting_shop_name.trim()) ||
        r.shop_name ||
        'All Outlets'
      : r.shop_name || 'All Outlets';

  const bodyParams = [
    r.requester_name || 'Staff Member',
    r.request_no || 'REQ',
    approvalNo,
    r.title || 'Official Approval',
    outletLabel,
    amountStr,
    approverName,
    dateTimeStr,
  ];

  const caption =
    `✅ *Your approval has been approved!*\n` +
    `Request No: ${r.request_no}\n` +
    `Approval No: ${approvalNo}\n` +
    `Amount: ${amountStr}`;

  for (const t of targets) {
    const targetPhone = cleanPhone(t.phone);
    try {
      let sent =
        waCfg.use_template !== false
          ? await sendMetaPayload(waCfg, {
              to: targetPhone,
              type: 'template',
              template: {
                name: 'approval_document_packet',
                language: { code: waCfg.template_language || 'en' },
                components: [
                  {
                    type: 'header',
                    parameters: [{ type: 'document', document: { id: mediaId, filename: docFilename } }],
                  },
                  {
                    type: 'body',
                    parameters: bodyParams.map((p) => ({ type: 'text', text: String(p) })),
                  },
                ],
              },
            })
          : await sendMetaPayload(waCfg, {
              to: targetPhone,
              type: 'document',
              document: { id: mediaId, caption, filename: docFilename },
            });

      if (!sent.ok && waCfg.use_template !== false) {
        await sendMetaPayload(waCfg, {
          to: targetPhone,
          type: 'document',
          document: { id: mediaId, caption, filename: docFilename },
        }).catch(() => {});

        sent = await sendMetaPayload(waCfg, {
          to: targetPhone,
          type: 'template',
          template: {
            name: 'approval_notification',
            language: { code: waCfg.template_language || 'en' },
            components: [
              {
                type: 'body',
                parameters: bodyParams.map((p) => ({ type: 'text', text: String(p) })),
              },
            ],
          },
        });
      }

      const metaId = sent.data?.messages?.[0]?.id || null;
      const errMsg = !sent.ok ? sent.data?.error?.message || `HTTP ${sent.status}` : null;

      await supabase.rpc('whatsapp_bot_log_delivery', {
        p_bot_secret: botSecret,
        p_request_id: requestId,
        p_recipient_phone: targetPhone,
        p_recipient_name: t.name,
        p_message_type: 'document_template',
        p_status: sent.ok ? 'sent' : 'failed',
        p_meta_message_id: metaId,
        p_error_message: errMsg,
        p_details: { approval_no: approvalNo, request_no: r.request_no, media_id: mediaId, source: 'whatsapp_bot' },
      });
    } catch {
      /* continue other recipients */
    }
  }
}

async function runBatchApprovalsAndReply(params: {
  supabase: SupabaseClient;
  botSecret: string;
  senderPhone: string;
  session: QueueSession;
  targetItems: QueueSessionItem[];
  skippedBlocked: QueueSessionItem[];
  modeLabel: 'Approve All' | 'Selected Only';
  waCfg: RuntimeWhatsAppConfig;
  fallbackAppUrl: string | null;
}) {
  const {
    supabase,
    botSecret,
    senderPhone,
    session,
    targetItems,
    skippedBlocked,
    modeLabel,
    waCfg,
    fallbackAppUrl,
  } = params;

  if (targetItems.length === 0) {
    await supabase.rpc('whatsapp_bot_update_session', {
      p_bot_secret: botSecret,
      p_sender_phone: senderPhone,
      p_session_id: session.id,
      p_status: 'selecting',
    });

    const blockedText = skippedBlocked
      .map((b) => `⚠️ *#${b.serial}* ${b.request_no}: ${b.blocked_reason}`)
      .join('\n');
    await sendTextMessage(
      waCfg,
      senderPhone,
      `⚠️ *No Actionable Requests to Approve*\n\n${blockedText || 'All chosen items are currently blocked.'}`
    );
    return;
  }

  await sendTextMessage(
    waCfg,
    senderPhone,
    `⏳ *${modeLabel}: Approving ${targetItems.length} request(s)...*\nStamping official PDF packets with Seal, Signature & QR code...`
  );

  const credCache: CredentialCache = {};
  const results: { item: QueueSessionItem; ok: boolean; approvalNo?: string; error?: string }[] = [];
  const effectiveAppUrl = session.app_url || fallbackAppUrl;

  for (const item of targetItems) {
    const res = await approveSingleRequestViaBot({
      supabase,
      botSecret,
      senderPhone,
      requestId: item.id,
      appUrl: effectiveAppUrl,
      waCfg,
      credCache,
    });
    results.push({ item, ...res });
  }

  await supabase.rpc('whatsapp_bot_update_session', {
    p_bot_secret: botSecret,
    p_sender_phone: senderPhone,
    p_session_id: session.id,
    p_status: 'completed',
  });

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const approvedTotal = results
    .filter((r) => r.ok)
    .reduce((sum, r) => sum + Number(r.item.amount || 0), 0);

  const resultLines = results.map((r) =>
    r.ok
      ? `✅ *#${r.item.serial}* ${r.item.request_no || 'REQ'} → *${r.approvalNo}* (${formatAmountDisplay(r.item)})`
      : `❌ *#${r.item.serial}* ${r.item.request_no || 'REQ'} — ${r.error || 'Failed'}`
  );

  if (skippedBlocked.length > 0) {
    for (const b of skippedBlocked) {
      resultLines.push(`⚠️ *#${b.serial}* ${b.request_no || 'REQ'} — Skipped (${b.blocked_reason})`);
    }
  }

  const remainingInSession = session.items.length - okCount;

  const summary =
    `🎉 *${modeLabel} Complete (${okCount}/${targetItems.length} Approved)*\n` +
    (okCount > 0 ? `💰 *Approved Total:* ${inr(approvedTotal)}\n` : '') +
    `\n${resultLines.join('\n')}\n\n` +
    `🔄 *Synced automatically to Web App.*` +
    (failCount === 0 && remainingInSession > 0
      ? `\n📌 _${remainingInSession} request(s) still in queue — send *all* anytime to view._`
      : '');

  const summaryChunks = chunkTextBlocks([summary], 3800);
  for (const chunk of summaryChunks) {
    await sendTextMessage(waCfg, senderPhone, chunk);
  }
}

// ---------------------------------------------------------------------------
// Upstream Webhook Relay (Preserves SWA Loyalty traffic on +91 80893 04002)
// ---------------------------------------------------------------------------

async function forwardWebhookUpstream(
  forwardUrl: string | undefined | null,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  selfHost: string
) {
  const target = (forwardUrl || DEFAULT_FORWARD_WEBHOOK_URL).trim();
  if (!target || !target.startsWith('https://')) return;
  try {
    const parsed = new URL(target);
    if (
      (selfHost && parsed.host.toLowerCase() === selfHost.toLowerCase()) ||
      parsed.pathname.includes('/api/whatsapp-webhook')
    ) {
      return;
    }

    const fwdHeaders: Record<string, string> = {
      'Content-Type': String(headers['content-type'] || 'application/json'),
    };
    const sig256 = headers['x-hub-signature-256'];
    const sig1 = headers['x-hub-signature'];
    const ua = headers['user-agent'];
    if (typeof sig256 === 'string') fwdHeaders['x-hub-signature-256'] = sig256;
    if (typeof sig1 === 'string') fwdHeaders['x-hub-signature'] = sig1;
    if (typeof ua === 'string') fwdHeaders['user-agent'] = ua;

    await fetch(target, {
      method: 'POST',
      headers: fwdHeaders,
      body: new Uint8Array(rawBody),
    });
  } catch (err) {
    console.warn('Upstream webhook relay warning:', err);
  }
}

async function readRawRequestBody(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Main HTTP Handler
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any) {
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost');
  const proto = host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const reqUrl = new URL(req.url || '/api/whatsapp-webhook', `${proto}://${host}`);
  const appOrigin = `${proto}://${host}`;
  const botSecret = (
    reqUrl.searchParams.get('key') ||
    reqUrl.searchParams.get('secret') ||
    process.env.WHATSAPP_BOT_SECRET ||
    ''
  ).trim();

  // 1. Meta Webhook Verification Handshake (GET)
  if (req.method === 'GET') {
    const mode = reqUrl.searchParams.get('hub.mode');
    const token = reqUrl.searchParams.get('hub.verify_token') || '';
    const challenge = reqUrl.searchParams.get('hub.challenge') || '';

    if (mode === 'subscribe' && challenge) {
      let verified = false;
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc('whatsapp_bot_verify_challenge', {
          p_bot_secret: botSecret,
          p_verify_token: token,
        });
        if (!error && data && (data as any).valid === true) {
          verified = true;
        } else if (error && token === DEFAULT_VERIFY_TOKEN) {
          verified = true;
        }
      } catch {
        if (token === DEFAULT_VERIFY_TOKEN) verified = true;
      }

      if (verified) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).end(challenge);
      }
      return res.status(403).json({ ok: false, error: 'Webhook verification token mismatch' });
    }

    return res.status(200).json({
      ok: true,
      service: 'swa-whatsapp-admin-approval-webhook',
    });
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // 2. Inbound Meta Webhook Event (POST)
  const rawBody = await readRawRequestBody(req);
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(200).json({ ok: true });
  }

  if (!botSecret) {
    await forwardWebhookUpstream(DEFAULT_FORWARD_WEBHOOK_URL, rawBody, req.headers || {}, host);
    return res.status(200).json({ ok: true, relayed: true });
  }

  const supabase = getSupabase();
  const { data: runtimeData, error: runtimeErr } = await supabase.rpc('whatsapp_bot_get_runtime_config', {
    p_bot_secret: botSecret,
  });

  if (runtimeErr || !runtimeData) {
    await forwardWebhookUpstream(DEFAULT_FORWARD_WEBHOOK_URL, rawBody, req.headers || {}, host);
    return res.status(200).json({ ok: true, relayed: true });
  }

  const waCfg: RuntimeWhatsAppConfig = {
    ...DEFAULT_WA_RUNTIME,
    ...(runtimeData as Partial<RuntimeWhatsAppConfig>),
  };

  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  const incomingMessages: any[] = [];
  for (const entry of entries) {
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const ch of changes) {
      const msgs: any[] = Array.isArray(ch?.value?.messages) ? ch.value.messages : [];
      for (const m of msgs) {
        incomingMessages.push(m);
      }
    }
  }

  // Status updates (delivered / read receipts) or non-message events -> forward upstream
  if (incomingMessages.length === 0) {
    await forwardWebhookUpstream(waCfg.forward_webhook_url, rawBody, req.headers || {}, host);
    return res.status(200).json({ ok: true });
  }

  let shouldRelayUpstream = false;

  for (const msg of incomingMessages) {
    const messageId = String(msg?.id || '');
    const senderPhone = String(msg?.from || '');
    const msgType = String(msg?.type || '');

    if (!senderPhone) continue;

    // Extract text or interactive action ID
    let rawText = '';
    let actionId = '';
    if (msgType === 'text') {
      rawText = String(msg?.text?.body || '').trim();
    } else if (msgType === 'interactive') {
      actionId = String(
        msg?.interactive?.button_reply?.id || msg?.interactive?.list_reply?.id || ''
      ).trim();
    } else if (msgType === 'button') {
      actionId = String(msg?.button?.payload || msg?.button?.text || '').trim();
    }

    const { data: claimData, error: claimErr } = await supabase.rpc('whatsapp_bot_claim_inbound', {
      p_bot_secret: botSecret,
      p_message_id: messageId,
      p_sender_phone: senderPhone,
    });

    if (claimErr || !claimData) {
      shouldRelayUpstream = true;
      continue;
    }

    const claim = claimData as {
      is_admin: boolean;
      duplicate: boolean;
      admin_id?: string;
      admin_name?: string;
      forward_webhook_url?: string;
      active_session?: QueueSession | null;
    };

    if (!claim.is_admin) {
      shouldRelayUpstream = true;
      continue;
    }

    if (claim.duplicate) {
      continue;
    }

    const lowerText = rawText.toLowerCase();
    const isAllCommand =
      lowerText === 'all' ||
      lowerText === '/all' ||
      lowerText === 'all requests' ||
      lowerText === 'to approve' ||
      lowerText === 'pending';

    const isCancelCommand = lowerText === 'cancel' || lowerText === '/cancel';
    const isBotAction = actionId.startsWith('wa_');
    const activeSession = claim.active_session || null;
    const parsedSerials =
      activeSession && rawText
        ? parseSerialNumbersFromText(rawText, (activeSession.items || []).length)
        : null;

    if (!isAllCommand && !isCancelCommand && !isBotAction && !parsedSerials) {
      // Unrelated message from Admin phone -> pass through to upstream webhook
      shouldRelayUpstream = true;
      continue;
    }

    // Verify genuine Meta message & mark read (blue double-ticks)
    const metaVerified = await markMessageRead(waCfg, messageId);
    if (!metaVerified) {
      continue;
    }

    // -----------------------------------------------------------------------
    // A. Admin sent "all" -> List all pending approvals in serial order + 2 options
    // -----------------------------------------------------------------------
    if (isAllCommand) {
      const { data: created, error: createErr } = await supabase.rpc('whatsapp_bot_create_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_app_url: appOrigin,
      });

      if (createErr || !created) {
        await sendTextMessage(
          waCfg,
          senderPhone,
          `⚠️ Could not load approval queue: ${createErr?.message || 'Database error'}`
        );
        continue;
      }

      const sessionRes = created as {
        session_id: string | null;
        has_credentials: boolean;
        items: QueueSessionItem[];
      };

      if (!sessionRes.items || sessionRes.items.length === 0 || !sessionRes.session_id) {
        await sendTextMessage(
          waCfg,
          senderPhone,
          `✅ *No Pending Admin Approvals*\n\nAll requests in your To-Approve queue have been processed.\n\nSend *all* anytime to check again.`
        );
        continue;
      }

      await sendAllQueueResponse(
        waCfg,
        senderPhone,
        sessionRes.session_id,
        sessionRes.items,
        sessionRes.has_credentials
      );
      continue;
    }

    // -----------------------------------------------------------------------
    // B. Admin clicked "Approve All" (wa_all:<sessionId>)
    // -----------------------------------------------------------------------
    if (actionId.startsWith('wa_all:')) {
      const sessionId = actionId.split(':')[1] || '';
      const { data: sData } = await supabase.rpc('whatsapp_bot_get_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: sessionId,
      });

      const session = sData as QueueSession | null;
      if (!session) {
        await sendTextMessage(waCfg, senderPhone, `ℹ️ Session expired. Send *all* to load the latest approval queue.`);
        continue;
      }
      if (session.status === 'completed' || session.status === 'processing') {
        await sendTextMessage(
          waCfg,
          senderPhone,
          `ℹ️ This approval batch has already been ${session.status}. Send *all* to check current pending requests.`
        );
        continue;
      }

      await supabase.rpc('whatsapp_bot_update_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: session.id,
        p_status: 'processing',
      });

      const actionable = (session.items || []).filter((i) => !i.blocked_reason);
      const blocked = (session.items || []).filter((i) => !!i.blocked_reason);

      await runBatchApprovalsAndReply({
        supabase,
        botSecret,
        senderPhone,
        session,
        targetItems: actionable,
        skippedBlocked: blocked,
        modeLabel: 'Approve All',
        waCfg,
        fallbackAppUrl: appOrigin,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // C. Admin clicked "Selected Only" / Page Navigation (wa_sel:<sessionId>:<page>)
    // -----------------------------------------------------------------------
    if (actionId.startsWith('wa_sel:')) {
      const parts = actionId.split(':');
      const sessionId = parts[1] || '';
      const page = parseInt(parts[2] || '0', 10) || 0;

      const { data: sData } = await supabase.rpc('whatsapp_bot_update_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: sessionId,
        p_status: 'selecting',
      });

      const session = sData as QueueSession | null;
      if (!session || session.status === 'completed' || session.status === 'processing') {
        await sendTextMessage(
          waCfg,
          senderPhone,
          `ℹ️ This session is no longer active. Send *all* to load the current approval queue.`
        );
        continue;
      }

      await sendInteractivePickerPage(waCfg, senderPhone, session, page);
      continue;
    }

    // -----------------------------------------------------------------------
    // D. Admin toggled a request row in Interactive List (wa_tog:<sessionId>:<serial>:<page>)
    // -----------------------------------------------------------------------
    if (actionId.startsWith('wa_tog:')) {
      const parts = actionId.split(':');
      const sessionId = parts[1] || '';
      const serial = parseInt(parts[2] || '0', 10);
      const page = parseInt(parts[3] || '0', 10) || 0;

      const { data: checkSession } = await supabase.rpc('whatsapp_bot_get_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: sessionId,
      });

      const existing = checkSession as QueueSession | null;
      if (!existing || existing.status === 'completed' || existing.status === 'processing') {
        await sendTextMessage(waCfg, senderPhone, `ℹ️ Session finished. Send *all* to view current pending approvals.`);
        continue;
      }

      const targetItem = (existing.items || []).find((i) => i.serial === serial);
      if (targetItem?.blocked_reason) {
        await sendSelectionConfirmationCard(
          waCfg,
          senderPhone,
          existing,
          page,
          `⚠️ *#${serial} (${targetItem.request_no})* cannot be selected: _${targetItem.blocked_reason}_`
        );
        continue;
      }

      const { data: updatedData } = await supabase.rpc('whatsapp_bot_update_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: sessionId,
        p_status: 'selecting',
        p_toggle_serial: serial,
      });

      const updated = (updatedData as QueueSession | null) || existing;
      await sendSelectionConfirmationCard(waCfg, senderPhone, updated, page);
      continue;
    }

    // -----------------------------------------------------------------------
    // E. Admin typed serial numbers directly (e.g. "1, 3" or "1-4")
    // -----------------------------------------------------------------------
    if (parsedSerials && activeSession) {
      const items = activeSession.items || [];
      const maxS = items.length;
      const validSerials: number[] = [];
      const blockedNotes: string[] = [];
      const outOfRange: number[] = [];

      for (const s of parsedSerials) {
        if (s < 1 || s > maxS) {
          outOfRange.push(s);
          continue;
        }
        const item = items.find((x) => x.serial === s);
        if (item?.blocked_reason) {
          blockedNotes.push(`#${s} (${item.blocked_reason})`);
          continue;
        }
        validSerials.push(s);
      }

      const warnings: string[] = [];
      if (outOfRange.length > 0) {
        warnings.push(`⚠️ Ignored invalid serial(s): ${outOfRange.join(', ')} (valid: 1-${maxS})`);
      }
      if (blockedNotes.length > 0) {
        warnings.push(`⚠️ Skipped blocked: ${blockedNotes.join('; ')}`);
      }

      const { data: updatedData } = await supabase.rpc('whatsapp_bot_update_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: activeSession.id,
        p_status: 'selecting',
        p_selected_serials: validSerials,
      });

      const updated = (updatedData as QueueSession | null) || {
        ...activeSession,
        status: 'selecting',
        selected_serials: validSerials,
      };
      await sendSelectionConfirmationCard(
        waCfg,
        senderPhone,
        updated,
        0,
        warnings.length > 0 ? warnings.join('\n') : undefined
      );
      continue;
    }

    // -----------------------------------------------------------------------
    // F. Admin confirmed "Approve (K)" for Selected Only (wa_ok:<sessionId>)
    // -----------------------------------------------------------------------
    if (actionId.startsWith('wa_ok:')) {
      const sessionId = actionId.split(':')[1] || '';
      const { data: sData } = await supabase.rpc('whatsapp_bot_get_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: sessionId,
      });

      const session = sData as QueueSession | null;
      if (!session) {
        await sendTextMessage(waCfg, senderPhone, `ℹ️ Session expired. Send *all* to load the latest queue.`);
        continue;
      }
      if (session.status === 'completed' || session.status === 'processing') {
        await sendTextMessage(
          waCfg,
          senderPhone,
          `ℹ️ This selection batch was already ${session.status}. Send *all* to view current pending requests.`
        );
        continue;
      }

      const selectedSet = new Set(session.selected_serials || []);
      const chosen = (session.items || []).filter((i) => selectedSet.has(i.serial));
      if (chosen.length === 0) {
        await sendInteractivePickerPage(waCfg, senderPhone, session, 0);
        continue;
      }

      await supabase.rpc('whatsapp_bot_update_session', {
        p_bot_secret: botSecret,
        p_sender_phone: senderPhone,
        p_session_id: session.id,
        p_status: 'processing',
      });

      const actionable = chosen.filter((i) => !i.blocked_reason);
      const blocked = chosen.filter((i) => !!i.blocked_reason);

      await runBatchApprovalsAndReply({
        supabase,
        botSecret,
        senderPhone,
        session,
        targetItems: actionable,
        skippedBlocked: blocked,
        modeLabel: 'Selected Only',
        waCfg,
        fallbackAppUrl: appOrigin,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // G. Cancel Selection (wa_can:<sessionId> or "cancel")
    // -----------------------------------------------------------------------
    if (actionId.startsWith('wa_can:') || isCancelCommand) {
      const sessionId = actionId.startsWith('wa_can:')
        ? actionId.split(':')[1] || ''
        : activeSession?.id || '';
      if (sessionId) {
        try {
          await supabase.rpc('whatsapp_bot_update_session', {
            p_bot_secret: botSecret,
            p_sender_phone: senderPhone,
            p_session_id: sessionId,
            p_status: 'cancelled',
          });
        } catch {
          /* ignore */
        }
      }
      await sendTextMessage(
        waCfg,
        senderPhone,
        `❎ Selection cancelled. Send *all* anytime to view pending approvals.`
      );
      continue;
    }
  }

  if (shouldRelayUpstream) {
    await forwardWebhookUpstream(waCfg.forward_webhook_url, rawBody, req.headers || {}, host);
  }

  return res.status(200).json({ ok: true });
}
