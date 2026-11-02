import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabase } from './supabase';
import { errMsg } from './errorUtils';
import { isNonCashRequestType, type RequestRecord, type WhatsAppConfig } from '../types/database';
import { formatINR } from './formatters';
import { MOCK_USERS } from './mockData';

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: true,
  access_token:
    'EAAzRU40ZBcyoBS1Uyk7UgqBlRIvb407NufgvmPdZBmZCjGsZAiDBervAm9MGZAhkVyou64W2lDt64ZByltVjcRVwvdkndcEPsUZAi0DvoISgKKbRUEZCQZABpLslfpvcrM1fE19UXaVyZCEhaz2ebIZAvuWGpvQG2KZBJNfrksm5vRN44PCuRpco8riA6NnSan6uUgZDZD',
  phone_number_id: '1391767714024374',
  waba_id: '1792622932047989',
  app_id: '3607856502698794',
  business_id: '2416963001964565',
  display_phone_number: '+91 80893 04002',
  notify_requester: true,
  notify_head: true,
  admin_phone_number: '+91 9846880713',
  template_name: 'approval_document_packet',
  template_language: 'en',
  use_template: true,
};

export interface MetaTemplateDefinition {
  name: string;
  title: string;
  category: 'UTILITY';
  language: string;
  headerFormat?: 'DOCUMENT';
  bodyText: string;
  variables: { num: string; name: string; sample: string }[];
}

export const META_TEMPLATES: Record<string, MetaTemplateDefinition> = {
  approval_document_packet: {
    name: 'approval_document_packet',
    title: 'Approved Stamped Document',
    category: 'UTILITY',
    language: 'en',
    headerFormat: 'DOCUMENT',
    bodyText:
      `✅ *YOUR APPROVAL HAS BEEN APPROVED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `Your request has been approved and officially stamped with seal & signature. The stamped approval document packet is attached above.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💰 *Amount:* {{6}}\n` +
      `✍️ *Approved by:* {{7}}\n` +
      `📅 *Approved on:* {{8}}\n\n` +
      `📄 *Please download the attached stamped approval PDF above.*`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Event Sponsorship & Promotion' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Amount', sample: 'Rs. 50,000.00' },
      { num: '{{7}}', name: 'Approver Name', sample: 'Managing Director' },
      { num: '{{8}}', name: 'Approved Date', sample: '31 Oct 2026' },
    ],
  },
  payment_completed_document: {
    name: 'payment_completed_document',
    title: 'Payment Completed + Doc',
    category: 'UTILITY',
    language: 'en',
    headerFormat: 'DOCUMENT',
    bodyText:
      `💵 *PAYMENT COMPLETED & CLOSED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `The final payment for your approved request has been processed and this request is now closed. The disbursement payment document is attached above.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💰 *Total Amount:* {{6}}\n` +
      `💳 *Payment Mode:* {{7}}\n` +
      `🔢 *Ref / UTR No:* {{8}}\n` +
      `📅 *Payment Date:* {{9}}\n\n` +
      `All scheduled disbursements for this approval are complete.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Marketing Material' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Total Amount', sample: 'Rs. 50,000.00' },
      { num: '{{7}}', name: 'Payment Mode', sample: 'Bank Transfer' },
      { num: '{{8}}', name: 'Ref / UTR No', sample: 'UTR98472918471' },
      { num: '{{9}}', name: 'Payment Date', sample: '31 Oct 2026' },
    ],
  },
  partial_payment_document: {
    name: 'partial_payment_document',
    title: 'Partial Payment + Doc',
    category: 'UTILITY',
    language: 'en',
    headerFormat: 'DOCUMENT',
    bodyText:
      `💳 *PARTIAL PAYMENT DISBURSED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `A partial payment has been disbursed for your approved request. The disbursement payment document is attached above.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💵 *Disbursed Amount:* {{6}}\n` +
      `📊 *Remaining Balance:* {{7}}\n` +
      `💳 *Payment Mode:* {{8}}\n` +
      `🔢 *Ref / UTR No:* {{9}}\n` +
      `📅 *Payment Date:* {{10}}\n\n` +
      `The remaining balance will be disbursed in subsequent instalments.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Interior Work' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Disbursed Amount', sample: 'Rs. 25,000.00' },
      { num: '{{7}}', name: 'Remaining Balance', sample: 'Rs. 25,000.00' },
      { num: '{{8}}', name: 'Payment Mode', sample: 'Bank Transfer' },
      { num: '{{9}}', name: 'Ref / UTR No', sample: 'UTR102938472' },
      { num: '{{10}}', name: 'Payment Date', sample: '31 Oct 2026' },
    ],
  },
  approval_notification: {
    name: 'approval_notification',
    title: 'Approval Alert (Text Fallback)',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `✅ *YOUR APPROVAL HAS BEEN APPROVED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `Your request has been approved and officially stamped with seal & signature.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💰 *Amount:* {{6}}\n` +
      `✍️ *Approved by:* {{7}}\n` +
      `📅 *Approved on:* {{8}}\n\n` +
      `📄 *The official signed approval document packet has been stamped.*`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Event Sponsorship & Promotion' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Amount', sample: 'Rs. 50,000.00' },
      { num: '{{7}}', name: 'Approver Name', sample: 'Managing Director' },
      { num: '{{8}}', name: 'Approved Date', sample: '31 Oct 2026' },
    ],
  },
  payment_completed_notification: {
    name: 'payment_completed_notification',
    title: 'Payment Completed (No Doc)',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `💵 *PAYMENT COMPLETED & CLOSED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `The final payment for your approved request has been processed and this request is now closed.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💰 *Total Amount:* {{6}}\n` +
      `💳 *Payment Mode:* {{7}}\n` +
      `🔢 *Ref / UTR No:* {{8}}\n` +
      `📅 *Payment Date:* {{9}}\n\n` +
      `All scheduled disbursements for this approval are complete.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Marketing Material' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Total Amount', sample: 'Rs. 50,000.00' },
      { num: '{{7}}', name: 'Payment Mode', sample: 'Bank Transfer' },
      { num: '{{8}}', name: 'Ref / UTR No', sample: 'UTR98472918471' },
      { num: '{{9}}', name: 'Payment Date', sample: '31 Oct 2026' },
    ],
  },
  partial_payment_notification: {
    name: 'partial_payment_notification',
    title: 'Partial Payment (No Doc)',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `💳 *PARTIAL PAYMENT DISBURSED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `A partial payment has been disbursed for your approved request.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💵 *Disbursed Amount:* {{6}}\n` +
      `📊 *Remaining Balance:* {{7}}\n` +
      `💳 *Payment Mode:* {{8}}\n` +
      `🔢 *Ref / UTR No:* {{9}}\n` +
      `📅 *Payment Date:* {{10}}\n\n` +
      `The remaining balance will be disbursed in subsequent instalments.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Interior Work' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Disbursed Amount', sample: 'Rs. 25,000.00' },
      { num: '{{7}}', name: 'Remaining Balance', sample: 'Rs. 25,000.00' },
      { num: '{{8}}', name: 'Payment Mode', sample: 'Bank Transfer' },
      { num: '{{9}}', name: 'Ref / UTR No', sample: 'UTR102938472' },
      { num: '{{10}}', name: 'Payment Date', sample: '31 Oct 2026' },
    ],
  },
  rejection_notification: {
    name: 'rejection_notification',
    title: 'Request Rejected',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `❌ *YOUR REQUEST HAS BEEN REJECTED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `Your approval request has been reviewed and rejected.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `📝 *Subject:* {{3}}\n` +
      `🏢 *Outlet / Shop:* {{4}}\n` +
      `💰 *Amount:* {{5}}\n` +
      `✍️ *Decision by:* {{6}}\n` +
      `📅 *Date:* {{7}}\n` +
      `⚠️ *Reason:* {{8}}\n\n` +
      `Please contact your department head or administrator for further details.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Subject / Title', sample: 'Event Sponsorship' },
      { num: '{{4}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{5}}', name: 'Amount', sample: 'Rs. 50,000.00' },
      { num: '{{6}}', name: 'Decision by', sample: 'Managing Director' },
      { num: '{{7}}', name: 'Date', sample: '31 Oct 2026' },
      { num: '{{8}}', name: 'Reason', sample: 'Budget allocation exceeded for this quarter' },
    ],
  },
  cancellation_notification: {
    name: 'cancellation_notification',
    title: 'Approval Cancelled',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `⚠️ *APPROVAL HAS BEEN CANCELLED*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `The prior approval for your request has been cancelled.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `🎉 *Prior Approval No:* {{3}}\n` +
      `📝 *Subject:* {{4}}\n` +
      `🏢 *Outlet / Shop:* {{5}}\n` +
      `💰 *Amount:* {{6}}\n` +
      `✍️ *Cancelled by:* {{7}}\n` +
      `📅 *Date:* {{8}}\n` +
      `🛑 *Reason:* {{9}}\n\n` +
      `No further disbursements or actions will be processed against this approval.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Prior Approval No', sample: 'APR-2026-000054' },
      { num: '{{4}}', name: 'Subject / Title', sample: 'Event Sponsorship' },
      { num: '{{5}}', name: 'Outlet / Shop', sample: 'Calicut Showroom' },
      { num: '{{6}}', name: 'Amount', sample: 'Rs. 50,000.00' },
      { num: '{{7}}', name: 'Cancelled by', sample: 'Operations Head' },
      { num: '{{8}}', name: 'Date', sample: '31 Oct 2026' },
      { num: '{{9}}', name: 'Reason', sample: 'Vendor quotation revised' },
    ],
  },
  returned_notification: {
    name: 'returned_notification',
    title: 'Request Returned / Sent Back',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      `↩️ *REQUEST RETURNED FOR ACTION*\n\n` +
      `Dear *{{1}}*,\n\n` +
      `Your approval request has been returned for clarification or correction.\n\n` +
      `📋 *Request No:* {{2}}\n` +
      `📝 *Subject:* {{3}}\n` +
      `🏢 *Outlet / Shop:* {{4}}\n` +
      `💰 *Amount:* {{5}}\n` +
      `✍️ *Returned by:* {{6}}\n` +
      `📅 *Date:* {{7}}\n` +
      `💬 *Remarks / Notes:* {{8}}\n\n` +
      `Please review the remarks and update your request in the approval portal.`,
    variables: [
      { num: '{{1}}', name: 'Requester Name', sample: 'Rahul Sharma' },
      { num: '{{2}}', name: 'Request No', sample: 'REQ-2026-000054' },
      { num: '{{3}}', name: 'Subject / Title', sample: 'Store Renovation' },
      { num: '{{4}}', name: 'Outlet / Shop', sample: 'Kochi Showroom' },
      { num: '{{5}}', name: 'Amount', sample: 'Rs. 1,20,000.00' },
      { num: '{{6}}', name: 'Returned by', sample: 'Accounts Verifier' },
      { num: '{{7}}', name: 'Date', sample: '31 Oct 2026' },
      { num: '{{8}}', name: 'Remarks / Notes', sample: 'Please attach supporting tax invoices' },
    ],
  },
};

export const META_TEMPLATE_SPEC = META_TEMPLATES.approval_document_packet;

const DOCUMENT_TEMPLATE_KEYS = [
  'approval_document_packet',
  'payment_completed_document',
  'partial_payment_document',
] as const;

const STORAGE_KEY = 'approval_app_whatsapp_config';

/** Supported native document MIME types for Meta WhatsApp DOCUMENT headers */
const META_DOC_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

/**
 * Normalizes phone numbers to WhatsApp Cloud API format (E.164 without '+').
 */
export function cleanWhatsAppNumber(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  // 10 digits -> Indian mobile without country code
  if (digits.length === 10) {
    return `91${digits}`;
  }
  // 11 digits starting with 0 -> Indian mobile with leading 0
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

/** Formats a clean WhatsApp number for nice display in UI */
export function formatWhatsAppDisplay(phone?: string | null): string {
  const clean = cleanWhatsAppNumber(phone);
  if (!clean) return '';
  if (clean.startsWith('91') && clean.length === 12) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  }
  return `+${clean}`;
}

/** Loads WhatsApp configuration from Supabase app_settings or localStorage */
export async function loadWhatsAppConfig(isBackendConnected: boolean): Promise<WhatsAppConfig> {
  if (isBackendConnected) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'whatsapp_config')
        .maybeSingle();

      if (!error && data?.value && typeof data.value === 'object') {
        const val = data.value as Partial<WhatsAppConfig>;
        return {
          ...DEFAULT_WHATSAPP_CONFIG,
          ...val,
        };
      }
    } catch (e) {
      console.warn('Could not read whatsapp_config from Supabase:', e);
    }
  }

  // Local fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_WHATSAPP_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    /* ignore */
  }

  return DEFAULT_WHATSAPP_CONFIG;
}

/** Saves WhatsApp configuration to Supabase app_settings and localStorage */
export async function saveWhatsAppConfig(
  isBackendConnected: boolean,
  config: WhatsAppConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }

  if (isBackendConnected) {
    try {
      const { error } = await supabase.from('app_settings').upsert({
        key: 'whatsapp_config',
        value: config,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } catch (err: unknown) {
      return { success: false, error: errMsg(err) };
    }
  }

  return { success: true };
}

/** Builds a clean 1-page sample PDF Blob for testing or template registration */
export async function buildSamplePdfBlob(title: string): Promise<Blob> {
  const cleanAscii = (s: string) => String(s || '').replace(/[^\x20-\x7E]/g, ' ');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText('SWA DIAMONDS - OFFICIAL DOCUMENT', {
    x: 50,
    y: 770,
    size: 16,
    font: bold,
    color: rgb(0.05, 0.35, 0.25),
  });
  page.drawText(cleanAscii(title || 'Sample Document Attachment'), {
    x: 50,
    y: 740,
    size: 12,
    font: regular,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(
    cleanAscii(`Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`),
    {
      x: 50,
      y: 712,
      size: 10,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    }
  );

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

/** Converts raster images (PNG, JPEG, WEBP, etc.) into a 1-page PDF so Meta DOCUMENT headers accept them */
async function rasterImageBlobToPngBytes(blob: Blob): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!pngBlob) return null;
    return new Uint8Array(await pngBlob.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Ensures any file (PDF, JPG/PNG/WEBP payment screenshot, Word/Excel, etc.) is formatted
 * into a MIME type + extension supported by Meta WhatsApp DOCUMENT template headers.
 */
export async function ensureWhatsAppCompatibleDocument(
  blob: Blob,
  rawFilename: string
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const safeName = (rawFilename || 'Official_Document.pdf').trim();
  const extMatch = safeName.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const mime = (blob.type || '').split(';')[0].trim().toLowerCase();

  const isPng = mime === 'image/png' || ext === 'png';
  const isJpg = mime === 'image/jpeg' || mime === 'image/jpg' || ext === 'jpg' || ext === 'jpeg';
  const isOtherImage = mime.startsWith('image/') || ['webp', 'gif', 'bmp'].includes(ext);

  if (isPng || isJpg || isOtherImage) {
    try {
      const pdf = await PDFDocument.create();
      const rawBytes = new Uint8Array(await blob.arrayBuffer());
      let embedded;
      if (isPng) {
        embedded = await pdf.embedPng(rawBytes);
      } else if (isJpg) {
        embedded = await pdf.embedJpg(rawBytes);
      } else {
        const pngBytes = await rasterImageBlobToPngBytes(blob);
        if (!pngBytes) throw new Error('Image conversion unavailable');
        embedded = await pdf.embedPng(pngBytes);
      }

      const maxW = 535;
      const maxH = 780;
      const scale = Math.min(1, maxW / embedded.width, maxH / embedded.height);
      const drawW = embedded.width * scale;
      const drawH = embedded.height * scale;
      const pageW = Math.max(drawW + 60, 420);
      const pageH = Math.max(drawH + 60, 595);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(embedded, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH,
      });

      const pdfBytes = await pdf.save();
      const baseName = safeName.replace(/\.[^.]+$/, '') || 'Disbursement_Receipt';
      return {
        blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }),
        filename: `${baseName}.pdf`,
        mimeType: 'application/pdf',
      };
    } catch (convErr) {
      console.warn('Could not wrap image into PDF, keeping original:', convErr);
    }
  }

  if (ext && META_DOC_MIME_BY_EXT[ext]) {
    const targetMime = META_DOC_MIME_BY_EXT[ext];
    return {
      blob: blob.type === targetMime ? blob : new Blob([blob], { type: targetMime }),
      filename: safeName,
      mimeType: targetMime,
    };
  }

  if (mime === 'application/pdf') {
    const baseName = safeName.replace(/\.[^.]+$/, '') || 'Approved_Document';
    return {
      blob,
      filename: `${baseName}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  // Default fallback to PDF naming if extension was missing
  return {
    blob: new Blob([blob], { type: 'application/pdf' }),
    filename: ext ? safeName : `${safeName}.pdf`,
    mimeType: 'application/pdf',
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

/**
 * Uploads a document (Blob or remote URL) to Meta WhatsApp Media API (`/{PHONE_NUMBER_ID}/media`)
 * and returns a Meta `media_id` ready to embed in a DOCUMENT header template.
 */
export async function uploadWhatsAppDocumentMedia(params: {
  config: WhatsAppConfig;
  fileBlob?: Blob | null;
  documentUrl?: string | null;
  filename: string;
}): Promise<{ mediaId?: string; filename: string; fallbackUrl?: string }> {
  const { config, fileBlob, documentUrl, filename } = params;
  const token = config.access_token?.trim();
  const phoneId = config.phone_number_id?.trim();
  const isRemoteUrl =
    Boolean(documentUrl) &&
    (documentUrl!.startsWith('https://') || documentUrl!.startsWith('http://'));

  if (!token || !phoneId) {
    return { filename, fallbackUrl: isRemoteUrl ? documentUrl! : undefined };
  }

  // 1. Obtain Blob if we have it locally or can fetch it cleanly
  let workingBlob: Blob | null = fileBlob || null;
  if (!workingBlob && isRemoteUrl && documentUrl) {
    try {
      const dl = await fetch(documentUrl);
      if (dl.ok) {
        workingBlob = await dl.blob();
      }
    } catch {
      /* will try server-side /api/whatsapp-meta upload_media below */
    }
  }

  if (workingBlob && workingBlob.size > 0) {
    const prepared = await ensureWhatsAppCompatibleDocument(workingBlob, filename);

    // 1A. Try direct multipart upload to Meta WhatsApp Media endpoint
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append(
        'file',
        new File([prepared.blob], prepared.filename, { type: prepared.mimeType })
      );

      const mRes = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        }
      );
      const mData = await mRes.json();
      if (mRes.ok && mData?.id) {
        return {
          mediaId: String(mData.id),
          filename: prepared.filename,
          fallbackUrl: isRemoteUrl ? documentUrl! : undefined,
        };
      }
      console.warn('Direct WhatsApp media upload returned error, trying server proxy:', mData);
    } catch (directErr) {
      console.warn('Direct WhatsApp media upload exception, trying server proxy:', directErr);
    }

    // 1B. Fallback to Vercel Serverless /api/whatsapp-meta proxy
    try {
      const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
      // Base64 proxy for files up to ~3.2 MB (Vercel 4.5 MB body limit); larger files use source_url below
      if (bytes.byteLength <= 3_200_000) {
        const proxyRes = await fetch('/api/whatsapp-meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload_media',
            access_token: token,
            phone_number_id: phoneId,
            file_base64: uint8ToBase64(bytes),
            mime_type: prepared.mimeType,
            filename: prepared.filename,
          }),
        });
        const proxyData = await proxyRes.json();
        if (proxyRes.ok && proxyData?.media_id) {
          return {
            mediaId: String(proxyData.media_id),
            filename: proxyData.filename || prepared.filename,
            fallbackUrl: isRemoteUrl ? documentUrl! : undefined,
          };
        }
      }
    } catch (proxyErr) {
      console.warn('Proxy base64 WhatsApp media upload failed:', proxyErr);
    }

    if (isRemoteUrl && documentUrl) {
      try {
        const urlProxyRes = await fetch('/api/whatsapp-meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload_media',
            access_token: token,
            phone_number_id: phoneId,
            source_url: documentUrl,
            filename: prepared.filename,
          }),
        });
        const urlProxyData = await urlProxyRes.json();
        if (urlProxyRes.ok && urlProxyData?.media_id) {
          return {
            mediaId: String(urlProxyData.media_id),
            filename: urlProxyData.filename || prepared.filename,
            fallbackUrl: documentUrl,
          };
        }
      } catch {
        /* ignore */
      }
    }

    return {
      filename: prepared.filename,
      fallbackUrl: isRemoteUrl ? documentUrl! : undefined,
    };
  }

  // 2. If we didn't have a local Blob, ask /api/whatsapp-meta to fetch source_url & upload to Meta
  if (isRemoteUrl && documentUrl) {
    try {
      const proxyRes = await fetch('/api/whatsapp-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload_media',
          access_token: token,
          phone_number_id: phoneId,
          source_url: documentUrl,
          filename,
        }),
      });
      const proxyData = await proxyRes.json();
      if (proxyRes.ok && proxyData?.media_id) {
        return {
          mediaId: String(proxyData.media_id),
          filename: proxyData.filename || filename,
          fallbackUrl: documentUrl,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    filename,
    fallbackUrl: isRemoteUrl ? documentUrl! : undefined,
  };
}

/** Fetches existing message templates from Meta WhatsApp Business Account (WABA) */
export async function fetchMetaTemplates(config?: WhatsAppConfig): Promise<{
  success: boolean;
  templates: { id: string; name: string; status: string; category: string; language: string }[];
  error?: string;
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const wabaId = cfg.waba_id || '1792622932047989';
  const token = cfg.access_token?.trim();
  if (!token || !wabaId) return { success: false, templates: [], error: 'Missing access token or WABA ID' };

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, templates: [], error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { success: true, templates: data.data || [] };
  } catch (e: unknown) {
    return { success: false, templates: [], error: errMsg(e) };
  }
}

/** Registers or submits a template (including DOCUMENT header templates) in Meta WABA */
export async function createMetaApprovalTemplate(
  config?: WhatsAppConfig,
  templateKey: string = 'approval_document_packet'
): Promise<{
  success: boolean;
  templateId?: string;
  status?: string;
  error?: string;
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const wabaId = cfg.waba_id || '1792622932047989';
  const appId = cfg.app_id || DEFAULT_WHATSAPP_CONFIG.app_id || '3607856502698794';
  const token = cfg.access_token?.trim();
  if (!token || !wabaId) return { success: false, error: 'Missing access token or WABA ID' };

  const spec = META_TEMPLATES[templateKey] || META_TEMPLATE_SPEC;
  const targetLang = cfg.template_language || spec.language || 'en';

  // 0. Check Meta WABA directly first (CORS-allowed) — if already registered, return immediately
  try {
    const checkRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(spec.name)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (checkRes.ok) {
      const checkJson = (await checkRes.json()) as {
        data?: { id: string; name: string; status: string; language: string }[];
      };
      const list = Array.isArray(checkJson?.data) ? checkJson.data : [];
      const approved = list.find((t) => t.name === spec.name && t.status === 'APPROVED');
      const exact = list.find((t) => t.name === spec.name && t.language === targetLang);
      const found = approved || exact || list.find((t) => t.name === spec.name);
      if (found) {
        return {
          success: true,
          templateId: found.id,
          status: found.status || 'PENDING',
        };
      }
    }
  } catch {
    /* continue to proxy / creation */
  }

  // 1. Use /api/whatsapp-meta server proxy (handles DOCUMENT header resumable uploads)
  try {
    const proxyRes = await fetch('/api/whatsapp-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register_template',
        access_token: token,
        waba_id: wabaId,
        app_id: appId,
        name: spec.name,
        title: spec.title,
        category: spec.category,
        language: targetLang,
        header_format: spec.headerFormat || null,
        body_text: spec.bodyText,
        sample_values: spec.variables.map((v) => v.sample),
      }),
    });
    const proxyText = await proxyRes.text();
    let proxyData: { success?: boolean; templateId?: string; status?: string; error?: string } = {};
    try {
      proxyData = JSON.parse(proxyText);
    } catch {
      /* non-json error response */
    }
    if (proxyRes.ok && proxyData?.success) {
      return {
        success: true,
        templateId: proxyData.templateId,
        status: proxyData.status || 'PENDING',
      };
    }
    if (spec.headerFormat === 'DOCUMENT') {
      return {
        success: false,
        error: proxyData?.error || `Failed to register document template (${proxyRes.status})`,
      };
    }
  } catch (proxyErr) {
    if (spec.headerFormat === 'DOCUMENT') {
      return {
        success: false,
        error: `Could not reach /api/whatsapp-meta to upload sample PDF header: ${errMsg(proxyErr)}`,
      };
    }
  }

  // 2. Direct fallback for BODY-only templates
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: spec.name,
        category: spec.category,
        language: cfg.template_language || spec.language,
        components: [
          {
            type: 'BODY',
            text: spec.bodyText,
            example: {
              body_text: [spec.variables.map((v) => v.sample)],
            },
          },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { success: true, templateId: data?.id, status: data?.status || 'PENDING' };
  } catch (e: unknown) {
    return { success: false, error: errMsg(e) };
  }
}

/** Registers all standard lifecycle templates (including Document-header templates) in Meta WABA */
export async function registerAllMetaTemplates(config?: WhatsAppConfig): Promise<{
  success: boolean;
  registeredCount: number;
  results: { name: string; ok: boolean; status?: string; error?: string }[];
}> {
  const results: { name: string; ok: boolean; status?: string; error?: string }[] = [];
  const cfg = config || (await loadWhatsAppConfig(true));

  for (const [key, spec] of Object.entries(META_TEMPLATES)) {
    const res = await createMetaApprovalTemplate(cfg, key);
    results.push({
      name: spec.name,
      ok: res.success,
      status: res.status,
      error: res.error,
    });
  }

  return {
    success: results.some((r) => r.ok),
    registeredCount: results.filter((r) => r.ok).length,
    results,
  };
}

let lastDocTemplateSyncAt = 0;

/**
 * Ensures the 3 Document-header templates (approval_document_packet,
 * payment_completed_document, partial_payment_document) are registered in Meta WABA.
 */
export async function ensureDocumentTemplatesRegistered(config?: WhatsAppConfig): Promise<void> {
  const now = Date.now();
  if (now - lastDocTemplateSyncAt < 3 * 60 * 1000) return;
  lastDocTemplateSyncAt = now;

  try {
    const cfg = config || (await loadWhatsAppConfig(true));
    if (!cfg.enabled || !cfg.access_token?.trim()) return;

    const existing = await fetchMetaTemplates(cfg);
    if (!existing.success) return;

    const registeredNames = new Set(existing.templates.map((t) => t.name));
    for (const key of DOCUMENT_TEMPLATE_KEYS) {
      const spec = META_TEMPLATES[key];
      if (spec && !registeredNames.has(spec.name)) {
        await createMetaApprovalTemplate(cfg, key);
      }
    }
  } catch (e) {
    console.warn('Background Meta document template sync note:', e);
  }
}

export interface SendDirectParams {
  to: string;
  documentUrl?: string;
  documentMediaId?: string;
  documentFilename?: string;
  caption?: string;
  text?: string;
  config?: WhatsAppConfig;
  templateName?: string;
  fallbackTextTemplateName?: string;
  templateHasDocumentHeader?: boolean;
  templateLanguage?: string;
  templateBodyParams?: string[];
}

/** Sends a message or document-header template using WhatsApp Cloud API (Graph API) */
export async function sendWhatsAppDirect(
  params: SendDirectParams
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = params.config || (await loadWhatsAppConfig(true));
  if (!config.enabled) {
    return { success: false, error: 'WhatsApp notifications are disabled in settings' };
  }

  const token = config.access_token?.trim();
  const phoneId = config.phone_number_id?.trim();
  if (!token || !phoneId) {
    return { success: false, error: 'Missing WhatsApp Access Token or Phone Number ID' };
  }

  const recipient = cleanWhatsAppNumber(params.to);
  if (!recipient || recipient.length < 10) {
    return { success: false, error: `Invalid recipient phone number: "${params.to}"` };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  const isRemoteDocUrl =
    Boolean(params.documentUrl) &&
    (params.documentUrl!.startsWith('https://') || params.documentUrl!.startsWith('http://'));
  const hasDocumentAttachment = Boolean(params.documentMediaId || isRemoteDocUrl);
  const docFilename = params.documentFilename || 'Official_Document.pdf';

  // 1. Attempt Meta Pre-Approved Message Template dispatch
  if (params.templateBodyParams && params.templateBodyParams.length > 0 && config.use_template !== false) {
    const primaryTemplateName =
      params.templateName || config.template_name || 'approval_document_packet';
    const templateLanguage = params.templateLanguage || config.template_language || 'en';
    const spec = META_TEMPLATES[primaryTemplateName];
    const shouldIncludeDocHeader = Boolean(
      (params.templateHasDocumentHeader || spec?.headerFormat === 'DOCUMENT') &&
        hasDocumentAttachment
    );

    try {
      const components: Record<string, unknown>[] = [];
      if (shouldIncludeDocHeader) {
        const docObject = params.documentMediaId
          ? { id: params.documentMediaId, filename: docFilename }
          : { link: params.documentUrl!, filename: docFilename };
        components.push({
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: docObject,
            },
          ],
        });
      }

      components.push({
        type: 'body',
        parameters: params.templateBodyParams.map((p) => ({ type: 'text', text: String(p) })),
      });

      const templatePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'template',
        template: {
          name: primaryTemplateName,
          language: { code: templateLanguage },
          components,
        },
      };

      let tRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(templatePayload),
      });

      let tData = await tRes.json();
      if (tRes.ok) {
        return { success: true, messageId: tData?.messages?.[0]?.id };
      }

      // Try alternate English locale (en <-> en_US) in case the other variant was approved first
      if (templateLanguage === 'en' || templateLanguage === 'en_US') {
        const altLang = templateLanguage === 'en' ? 'en_US' : 'en';
        tRes = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...templatePayload,
            template: {
              ...templatePayload.template,
              language: { code: altLang },
            },
          }),
        });
        tData = await tRes.json();
        if (tRes.ok) {
          return { success: true, messageId: tData?.messages?.[0]?.id };
        }
      }

      console.warn(
        `Meta template "${primaryTemplateName}" returned error, triggering auto-registration & fallback:`,
        tData
      );

      // If the document-header template hasn't been registered or approved in Meta yet,
      // auto-register it right away so Meta approves it for subsequent sends!
      if (shouldIncludeDocHeader) {
        createMetaApprovalTemplate(config, primaryTemplateName).catch(() => {});
      }

      // While a newly registered DOCUMENT template is awaiting Meta's ~60s review:
      // (a) Try sending the document directly via media_id/link (delivers if 24h window is open)
      // (b) Also send the pre-approved fallback text template so the alert always arrives 24/7
      if (shouldIncludeDocHeader && params.fallbackTextTemplateName) {
        let docDeliveredMsgId: string | undefined;
        if (hasDocumentAttachment) {
          try {
            const directDocRes = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: recipient,
                type: 'document',
                document: params.documentMediaId
                  ? {
                      id: params.documentMediaId,
                      caption: params.caption || 'Official Document Attachment',
                      filename: docFilename,
                    }
                  : {
                      link: params.documentUrl!,
                      caption: params.caption || 'Official Document Attachment',
                      filename: docFilename,
                    },
              }),
            });
            const directDocData = await directDocRes.json();
            if (directDocRes.ok) {
              docDeliveredMsgId = directDocData?.messages?.[0]?.id;
            }
          } catch {
            /* ignore */
          }
        }

        try {
          const fbRes = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'template',
              template: {
                name: params.fallbackTextTemplateName,
                language: { code: templateLanguage },
                components: [
                  {
                    type: 'body',
                    parameters: params.templateBodyParams.map((p) => ({
                      type: 'text',
                      text: String(p),
                    })),
                  },
                ],
              },
            }),
          });
          const fbData = await fbRes.json();
          if (fbRes.ok) {
            return {
              success: true,
              messageId: docDeliveredMsgId || fbData?.messages?.[0]?.id,
            };
          }
        } catch {
          /* continue to direct fallback below */
        }
      }
    } catch (tErr) {
      console.warn('Meta template dispatch exception, falling back to direct dispatch:', tErr);
    }
  }

  // 2. Direct Document Attachment dispatch (when templates are disabled or unapproved)
  if (hasDocumentAttachment) {
    try {
      const docPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'document',
        document: params.documentMediaId
          ? {
              id: params.documentMediaId,
              caption: params.caption || 'Official Document Attachment',
              filename: docFilename,
            }
          : {
              link: params.documentUrl!,
              caption: params.caption || 'Official Document Attachment',
              filename: docFilename,
            },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(docPayload),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error?.message || `WhatsApp API error (${res.status})`;
        console.warn('WhatsApp send document failed, falling back to text notification:', data);

        if (params.text) {
          try {
            const fallbackRes = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: recipient,
                type: 'text',
                text: { body: params.text },
              }),
            });
            const fallbackData = await fallbackRes.json();
            if (fallbackRes.ok) {
              return { success: true, messageId: fallbackData?.messages?.[0]?.id };
            }
          } catch {
            /* ignore fallback error */
          }
        }
        return { success: false, error: errorMsg };
      }

      const msgId = data?.messages?.[0]?.id;

      if (params.text) {
        try {
          await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'text',
              text: { body: params.text },
            }),
          });
        } catch {
          /* text follow-up error ignored if document succeeded */
        }
      }

      return { success: true, messageId: msgId };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  }

  // 3. Send Text-only message if no document attachment
  if (params.text) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { body: params.text },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error?.message || `WhatsApp API error (${res.status})`;
        return { success: false, error: errorMsg };
      }

      return { success: true, messageId: data?.messages?.[0]?.id };
    } catch (e: unknown) {
      return { success: false, error: errMsg(e) };
    }
  }

  return { success: false, error: 'No message content or document specified' };
}

/** Sends a test message to verify the WhatsApp Business Cloud API integration */
export async function sendTestWhatsAppMessage(
  toPhone: string,
  config?: WhatsAppConfig
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const cleanTo = cleanWhatsAppNumber(toPhone);
  if (!cleanTo) {
    return { success: false, error: 'Please enter a valid mobile number with country code' };
  }

  const messageText =
    `🔔 *WhatsApp Cloud API Test Message*\n\n` +
    `Hello from *SWA Diamonds*!\n\n` +
    `Your WhatsApp Cloud API integration has been connected successfully.\n\n` +
    `• Phone Number ID: \`${cfg.phone_number_id}\`\n` +
    `• Sender: ${cfg.display_phone_number || '+91 80893 04002'}\n` +
    `• Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n\n` +
    `✅ Stamped approval PDFs and disbursement payment documents will be delivered directly via WhatsApp templates.`;

  return sendWhatsAppDirect({
    to: cleanTo,
    text: messageText,
    config: cfg,
  });
}

/**
 * Resolves all target recipients for a request notification:
 * 1. Extra recipient (if provided)
 * 2. Requester (via security-definer RPC get_request_whatsapp_recipients, profile, or mock data)
 * 3. Department Head (from owner_head_id / default_head_id)
 * 4. Admin copy (cfg.admin_phone_number or +91 9846880713)
 */
export async function getNotificationRecipients(
  request: RequestRecord,
  cfg: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{ phone: string; name?: string }[]> {
  const targets: { phone: string; name?: string }[] = [];

  if (extraRecipientPhone) {
    targets.push({ phone: extraRecipientPhone, name: 'Specified Recipient' });
  }

  // Try security-definer RPC first so Disbursement & Cross-Department Heads aren't blocked by profiles RLS
  type RpcRecipientInfo = {
    requester_phone?: string | null;
    requester_name?: string | null;
    head_phone?: string | null;
    head_name?: string | null;
  };
  let rpcInfo: RpcRecipientInfo | null = null;

  if (request.id) {
    try {
      const { data, error } = await supabase.rpc('get_request_whatsapp_recipients', {
        p_request_id: request.id,
      });
      if (!error && data && typeof data === 'object') {
        rpcInfo = data as RpcRecipientInfo;
      }
    } catch {
      /* RPC may not be applied yet; fallback below */
    }
  }

  // 2. Requester
  if (cfg.notify_requester && request.requester_id) {
    let reqPhone: string | undefined =
      rpcInfo?.requester_phone ||
      ((request.requester as unknown as { whatsapp_number?: string | null } | undefined)
        ?.whatsapp_number ?? undefined);
    let reqName = rpcInfo?.requester_name || request.requester_name;

    if (!reqPhone) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('whatsapp_number, full_name')
          .eq('id', request.requester_id)
          .maybeSingle();

        if (prof?.whatsapp_number) {
          reqPhone = prof.whatsapp_number;
          reqName = prof.full_name || reqName;
        }
      } catch {
        /* ignore */
      }
    }

    if (!reqPhone) {
      const mockReq = MOCK_USERS.find((u) => u.id === request.requester_id);
      if (mockReq?.whatsapp_number) {
        reqPhone = mockReq.whatsapp_number;
        reqName = mockReq.full_name || reqName;
      }
    }

    if (reqPhone) {
      targets.push({ phone: reqPhone, name: reqName });
    }
  }

  // 3. Head
  if (cfg.notify_head) {
    const headId = request.owner_head_id;
    if (rpcInfo?.head_phone && (!headId || headId !== request.requester_id)) {
      targets.push({
        phone: rpcInfo.head_phone,
        name: rpcInfo.head_name || 'Department Head',
      });
    } else if (headId && headId !== request.requester_id) {
      let headPhone: string | undefined;
      let headName = 'Department Head';
      try {
        const { data: headProf } = await supabase
          .from('profiles')
          .select('whatsapp_number, full_name')
          .eq('id', headId)
          .maybeSingle();

        if (headProf?.whatsapp_number) {
          headPhone = headProf.whatsapp_number;
          headName = headProf.full_name || headName;
        }
      } catch {
        /* ignore */
      }

      if (!headPhone) {
        const mockHead = MOCK_USERS.find((u) => u.id === headId);
        if (mockHead?.whatsapp_number) {
          headPhone = mockHead.whatsapp_number;
          headName = mockHead.full_name || headName;
        }
      }

      if (headPhone) {
        targets.push({ phone: headPhone, name: headName });
      }
    }
  }

  // 4. Admin copy
  const adminPhone = (cfg.admin_phone_number && cfg.admin_phone_number.trim()) || '+91 9846880713';
  targets.push({ phone: adminPhone, name: 'Admin Notification Copy' });

  // Deduplicate
  const seen = new Set<string>();
  return targets.filter((t) => {
    const clean = cleanWhatsAppNumber(t.phone);
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
}

/**
 * Builds and dispatches the "your approval has been approved" WhatsApp template
 * WITH the official stamped approval PDF attached directly in the template's DOCUMENT header.
 */
export async function sendApprovalWhatsAppNotification(
  request: RequestRecord,
  signedPdfUrl: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string,
  customApproverName?: string,
  signedPdfBlob?: Blob | null
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) {
    return { success: false, results: [] };
  }

  // Kick off non-blocking check so all 3 document templates exist in Meta WABA
  ensureDocumentTemplatesRegistered(cfg).catch(() => {});

  const approvalNo = request.approval_no || 'APPROVED';
  const requestNo = request.request_no || 'REQ';
  const amountStr =
    request.request_type === 'stock_transfer'
      ? `Stock Transfer (MRP: ${formatINR(request.amount || 0)})`
      : isNonCashRequestType(request.request_type)
      ? 'Non-Cash (No direct disbursement)'
      : formatINR(request.amount || 0);

  const approverName =
    customApproverName ||
    (request.actions || []).find((a) => a.action === 'approved')?.actor_name ||
    'Authorized Head / Admin';

  const titleStr = request.title || 'Official Approval';
  const outletStr =
    request.request_type === 'exhibition'
      ? ((request.details as { conducting_shop_name?: string } | null)?.conducting_shop_name?.trim() ||
          request.shop_name ||
          'All Outlets')
      : request.shop_name || 'All Outlets';
  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const caption =
    `✅ *Your approval has been approved!*\n` +
    `Request No: ${requestNo}\n` +
    `Approval No: ${approvalNo}\n` +
    `Amount: ${amountStr}`;

  const messageBody =
    `✅ *YOUR APPROVAL HAS BEEN APPROVED*\n\n` +
    `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
    `Your request has been approved and officially stamped with seal & signature.\n\n` +
    `📋 *Request No:* ${requestNo}\n` +
    `🎉 *Approval No:* ${approvalNo}\n` +
    `📝 *Subject:* ${titleStr}\n` +
    `🏢 *Outlet / Shop:* ${outletStr}\n` +
    `💰 *Amount:* ${amountStr}\n` +
    `✍️ *Approved by:* ${approverName}\n` +
    `📅 *Approved on:* ${dateStr}\n\n` +
    `📄 *The official signed approval document packet is attached above.*`;

  const templateBodyParams = [
    request.requester_name || 'Staff Member', // {{1}}
    requestNo,                                // {{2}}
    approvalNo,                               // {{3}}
    titleStr,                                 // {{4}}
    outletStr,                                // {{5}}
    amountStr,                                // {{6}}
    approverName,                             // {{7}}
    dateStr,                                  // {{8}}
  ];

  const filename = `${approvalNo}_Approved_Document.pdf`;

  // Upload the stamped PDF to Meta WhatsApp Media API once and share media_id across all recipients
  const uploadedDoc =
    signedPdfBlob || signedPdfUrl
      ? await uploadWhatsAppDocumentMedia({
          config: cfg,
          fileBlob: signedPdfBlob || null,
          documentUrl: signedPdfUrl || null,
          filename,
        })
      : { filename };

  const hasDoc = Boolean(uploadedDoc.mediaId || uploadedDoc.fallbackUrl);
  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  for (const target of targets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      documentMediaId: uploadedDoc.mediaId,
      documentUrl: uploadedDoc.fallbackUrl || signedPdfUrl || undefined,
      documentFilename: uploadedDoc.filename || filename,
      caption,
      text: messageBody,
      config: cfg,
      templateName: hasDoc ? 'approval_document_packet' : 'approval_notification',
      fallbackTextTemplateName: 'approval_notification',
      templateHasDocumentHeader: hasDoc,
      templateLanguage: cfg.template_language || 'en',
      templateBodyParams,
    });

    results.push({
      recipient: target.phone,
      name: target.name,
      ok: res.success,
      error: res.error,
    });

    try {
      await supabase.from('whatsapp_logs').insert({
        request_id: request.id,
        recipient_phone: target.phone,
        recipient_name: target.name || null,
        message_type: 'document_template',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: {
          approval_no: approvalNo,
          request_no: requestNo,
          event: 'approval',
          media_id: uploadedDoc.mediaId || null,
          has_document: hasDoc,
        },
      });
    } catch {
      /* ignore */
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/**
 * Builds and dispatches the "request rejected" WhatsApp message with reason.
 */
export async function sendRejectionWhatsAppNotification(
  request: RequestRecord,
  reason: string,
  decidedByName?: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) return { success: false, results: [] };

  const requestNo = request.request_no || 'REQ';
  const amountStr = formatINR(request.amount || 0);
  const titleStr = request.title || 'Official Request';
  const outletStr = request.shop_name || 'All Outlets';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const decider = decidedByName || 'Managing Authority';
  const reasonText = reason.trim() || 'No specific reason provided';

  const messageBody =
    `❌ *YOUR REQUEST HAS BEEN REJECTED*\n\n` +
    `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
    `Your approval request has been reviewed and rejected.\n\n` +
    `📋 *Request No:* ${requestNo}\n` +
    `📝 *Subject:* ${titleStr}\n` +
    `🏢 *Outlet / Shop:* ${outletStr}\n` +
    `💰 *Amount:* ${amountStr}\n` +
    `✍️ *Decision by:* ${decider}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `⚠️ *Reason:* ${reasonText}\n\n` +
    `Please contact your department head or administrator for further details.`;

  const templateBodyParams = [
    request.requester_name || 'Staff Member', // {{1}}
    requestNo,                                // {{2}}
    titleStr,                                 // {{3}}
    outletStr,                                // {{4}}
    amountStr,                                // {{5}}
    decider,                                  // {{6}}
    dateStr,                                  // {{7}}
    reasonText,                               // {{8}}
  ];

  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  for (const target of targets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      text: messageBody,
      config: cfg,
      templateName: 'rejection_notification',
      templateLanguage: cfg.template_language || 'en',
      templateBodyParams,
    });

    results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

    try {
      await supabase.from('whatsapp_logs').insert({
        request_id: request.id,
        recipient_phone: target.phone,
        recipient_name: target.name || null,
        message_type: 'template',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: { request_no: requestNo, reason: reasonText, event: 'rejected' },
      });
    } catch {
      /* ignore */
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/**
 * Builds and dispatches the "approval cancelled" WhatsApp message with reason.
 */
export async function sendCancellationWhatsAppNotification(
  request: RequestRecord,
  reason: string,
  cancelledByName?: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) return { success: false, results: [] };

  const approvalNo = request.approval_no || 'APPROVED';
  const requestNo = request.request_no || 'REQ';
  const amountStr = formatINR(request.amount || 0);
  const titleStr = request.title || 'Official Request';
  const outletStr = request.shop_name || 'All Outlets';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const canceller = cancelledByName || 'Department Head / Admin';
  const reasonText = reason.trim() || 'No specific reason provided';

  const messageBody =
    `⚠️ *APPROVAL HAS BEEN CANCELLED*\n\n` +
    `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
    `The prior approval for your request has been cancelled.\n\n` +
    `📋 *Request No:* ${requestNo}\n` +
    `🎉 *Prior Approval No:* ${approvalNo}\n` +
    `📝 *Subject:* ${titleStr}\n` +
    `🏢 *Outlet / Shop:* ${outletStr}\n` +
    `💰 *Amount:* ${amountStr}\n` +
    `✍️ *Cancelled by:* ${canceller}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `🛑 *Reason:* ${reasonText}\n\n` +
    `No further disbursements or actions will be processed against this approval.`;

  const templateBodyParams = [
    request.requester_name || 'Staff Member', // {{1}}
    requestNo,                                // {{2}}
    approvalNo,                               // {{3}}
    titleStr,                                 // {{4}}
    outletStr,                                // {{5}}
    amountStr,                                // {{6}}
    canceller,                                // {{7}}
    dateStr,                                  // {{8}}
    reasonText,                               // {{9}}
  ];

  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  for (const target of targets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      text: messageBody,
      config: cfg,
      templateName: 'cancellation_notification',
      templateLanguage: cfg.template_language || 'en',
      templateBodyParams,
    });

    results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

    try {
      await supabase.from('whatsapp_logs').insert({
        request_id: request.id,
        recipient_phone: target.phone,
        recipient_name: target.name || null,
        message_type: 'template',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: { approval_no: approvalNo, request_no: requestNo, reason: reasonText, event: 'cancelled' },
      });
    } catch {
      /* ignore */
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/**
 * Builds and dispatches the "request returned" WhatsApp message with remarks.
 */
export async function sendReturnedWhatsAppNotification(
  request: RequestRecord,
  remarks: string,
  returnedByName?: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) return { success: false, results: [] };

  const requestNo = request.request_no || 'REQ';
  const amountStr = formatINR(request.amount || 0);
  const titleStr = request.title || 'Official Request';
  const outletStr = request.shop_name || 'All Outlets';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const returner = returnedByName || 'Accounts Verifier / Head';
  const remarksText = remarks.trim() || 'Please check and resubmit';

  const messageBody =
    `↩️ *REQUEST RETURNED FOR ACTION*\n\n` +
    `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
    `Your approval request has been returned for clarification or correction.\n\n` +
    `📋 *Request No:* ${requestNo}\n` +
    `📝 *Subject:* ${titleStr}\n` +
    `🏢 *Outlet / Shop:* ${outletStr}\n` +
    `💰 *Amount:* ${amountStr}\n` +
    `✍️ *Returned by:* ${returner}\n` +
    `📅 *Date:* ${dateStr}\n` +
    `💬 *Remarks / Notes:* ${remarksText}\n\n` +
    `Please review the remarks and update your request in the approval portal.`;

  const templateBodyParams = [
    request.requester_name || 'Staff Member', // {{1}}
    requestNo,                                // {{2}}
    titleStr,                                 // {{3}}
    outletStr,                                // {{4}}
    amountStr,                                // {{5}}
    returner,                                 // {{6}}
    dateStr,                                  // {{7}}
    remarksText,                              // {{8}}
  ];

  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  for (const target of targets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      text: messageBody,
      config: cfg,
      templateName: 'returned_notification',
      templateLanguage: cfg.template_language || 'en',
      templateBodyParams,
    });

    results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

    try {
      await supabase.from('whatsapp_logs').insert({
        request_id: request.id,
        recipient_phone: target.phone,
        recipient_name: target.name || null,
        message_type: 'template',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: { request_no: requestNo, remarks: remarksText, event: 'returned' },
      });
    } catch {
      /* ignore */
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/**
 * Builds and dispatches the WhatsApp disbursement message:
 * - When the Payment Account attached a disbursement document: sends the DOCUMENT-header
 *   template (`payment_completed_document` or `partial_payment_document`) with that
 *   exact disbursement document attached directly inside the template header.
 * - When no document was attached: sends `payment_completed_notification` or `partial_payment_notification`.
 */
export async function sendPaymentDisbursedWhatsAppNotification(
  request: RequestRecord,
  disbursedAmount: number,
  remainingBalance: number,
  paymentMode?: string | null,
  paymentRef?: string | null,
  paymentDate?: string | null,
  isFullyPaid: boolean = false,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string,
  attachmentUrl?: string | null,
  attachmentFilename?: string | null,
  attachmentBlob?: Blob | null
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) return { success: false, results: [] };

  ensureDocumentTemplatesRegistered(cfg).catch(() => {});

  const approvalNo = request.approval_no || 'APPROVED';
  const requestNo = request.request_no || 'REQ';
  const titleStr = request.title || 'Official Request';
  const outletStr =
    request.request_type === 'exhibition'
      ? ((request.details as { conducting_shop_name?: string } | null)?.conducting_shop_name?.trim() ||
          request.shop_name ||
          'All Outlets')
      : request.shop_name || 'All Outlets';
  const modeStr = paymentMode || 'Bank Transfer';
  const refStr = paymentRef?.trim() || 'Processed';
  const dateStr =
    paymentDate ||
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const defaultDocFilename = isFullyPaid
    ? `${approvalNo}_Payment_Settlement_Receipt.pdf`
    : `${approvalNo}_Partial_Payment_Receipt.pdf`;
  const rawFilename = attachmentFilename || defaultDocFilename;

  // Upload the Payment Account's attached disbursement document to Meta WhatsApp Media API once
  const uploadedDoc =
    attachmentBlob || attachmentUrl
      ? await uploadWhatsAppDocumentMedia({
          config: cfg,
          fileBlob: attachmentBlob || null,
          documentUrl: attachmentUrl || null,
          filename: rawFilename,
        })
      : { filename: rawFilename };

  const hasDoc = Boolean(uploadedDoc.mediaId || uploadedDoc.fallbackUrl);
  const finalFilename = uploadedDoc.filename || rawFilename;
  const companionCaption = isFullyPaid
    ? `✅ Payment Completed Receipt · ${approvalNo} · ${modeStr}`
    : `💳 Partial Payment Receipt · ${approvalNo} · ${modeStr}`;

  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  if (isFullyPaid) {
    const totalAmountStr = formatINR(request.amount || request.paid_amount || disbursedAmount);
    const messageBody =
      `💵 *PAYMENT COMPLETED & CLOSED*\n\n` +
      `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
      `The final payment for your approved request has been processed and this request is now closed.\n\n` +
      `📋 *Request No:* ${requestNo}\n` +
      `🎉 *Approval No:* ${approvalNo}\n` +
      `📝 *Subject:* ${titleStr}\n` +
      `🏢 *Outlet / Shop:* ${outletStr}\n` +
      `💰 *Total Amount:* ${totalAmountStr}\n` +
      `💳 *Payment Mode:* ${modeStr}\n` +
      `🔢 *Ref / UTR No:* ${refStr}\n` +
      `📅 *Payment Date:* ${dateStr}\n\n` +
      (hasDoc ? `📄 *Disbursement payment document is attached above.*\n\n` : '') +
      `All scheduled disbursements for this approval are complete.`;

    const templateBodyParams = [
      request.requester_name || 'Staff Member', // {{1}}
      requestNo,                                // {{2}}
      approvalNo,                               // {{3}}
      titleStr,                                 // {{4}}
      outletStr,                                // {{5}}
      totalAmountStr,                           // {{6}}
      modeStr,                                  // {{7}}
      refStr,                                   // {{8}}
      dateStr,                                  // {{9}}
    ];

    for (const target of targets) {
      const res = await sendWhatsAppDirect({
        to: target.phone,
        documentMediaId: uploadedDoc.mediaId,
        documentUrl: uploadedDoc.fallbackUrl || undefined,
        documentFilename: finalFilename,
        caption: companionCaption,
        text: messageBody,
        config: cfg,
        templateName: hasDoc ? 'payment_completed_document' : 'payment_completed_notification',
        fallbackTextTemplateName: 'payment_completed_notification',
        templateHasDocumentHeader: hasDoc,
        templateLanguage: cfg.template_language || 'en',
        templateBodyParams,
      });

      results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

      try {
        await supabase.from('whatsapp_logs').insert({
          request_id: request.id,
          recipient_phone: target.phone,
          recipient_name: target.name || null,
          message_type: hasDoc ? 'document_template' : 'template',
          status: res.success ? 'sent' : 'failed',
          meta_message_id: res.messageId || null,
          error_message: res.error || null,
          details: {
            approval_no: approvalNo,
            request_no: requestNo,
            event: 'fully_paid',
            ref: refStr,
            media_id: uploadedDoc.mediaId || null,
            has_attachment: hasDoc,
          },
        });
      } catch {
        /* ignore */
      }
    }
  } else {
    const disbursedStr = formatINR(disbursedAmount);
    const balanceStr = formatINR(remainingBalance);
    const messageBody =
      `💳 *PARTIAL PAYMENT DISBURSED*\n\n` +
      `Dear *${request.requester_name || 'Staff Member'}*,\n\n` +
      `A partial payment has been disbursed for your approved request.\n\n` +
      `📋 *Request No:* ${requestNo}\n` +
      `🎉 *Approval No:* ${approvalNo}\n` +
      `📝 *Subject:* ${titleStr}\n` +
      `🏢 *Outlet / Shop:* ${outletStr}\n` +
      `💵 *Disbursed Amount:* ${disbursedStr}\n` +
      `📊 *Remaining Balance:* ${balanceStr}\n` +
      `💳 *Payment Mode:* ${modeStr}\n` +
      `🔢 *Ref / UTR No:* ${refStr}\n` +
      `📅 *Payment Date:* ${dateStr}\n\n` +
      (hasDoc ? `📄 *Disbursement payment document is attached above.*\n\n` : '') +
      `The remaining balance will be disbursed in subsequent instalments.`;

    const templateBodyParams = [
      request.requester_name || 'Staff Member', // {{1}}
      requestNo,                                // {{2}}
      approvalNo,                               // {{3}}
      titleStr,                                 // {{4}}
      outletStr,                                // {{5}}
      disbursedStr,                             // {{6}}
      balanceStr,                               // {{7}}
      modeStr,                                  // {{8}}
      refStr,                                   // {{9}}
      dateStr,                                  // {{10}}
    ];

    for (const target of targets) {
      const res = await sendWhatsAppDirect({
        to: target.phone,
        documentMediaId: uploadedDoc.mediaId,
        documentUrl: uploadedDoc.fallbackUrl || undefined,
        documentFilename: finalFilename,
        caption: companionCaption,
        text: messageBody,
        config: cfg,
        templateName: hasDoc ? 'partial_payment_document' : 'partial_payment_notification',
        fallbackTextTemplateName: 'partial_payment_notification',
        templateHasDocumentHeader: hasDoc,
        templateLanguage: cfg.template_language || 'en',
        templateBodyParams,
      });

      results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

      try {
        await supabase.from('whatsapp_logs').insert({
          request_id: request.id,
          recipient_phone: target.phone,
          recipient_name: target.name || null,
          message_type: hasDoc ? 'document_template' : 'template',
          status: res.success ? 'sent' : 'failed',
          meta_message_id: res.messageId || null,
          error_message: res.error || null,
          details: {
            approval_no: approvalNo,
            request_no: requestNo,
            disbursed: disbursedAmount,
            remaining: remainingBalance,
            event: 'partial_paid',
            media_id: uploadedDoc.mediaId || null,
            has_attachment: hasDoc,
          },
        });
      } catch {
        /* ignore */
      }
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/** Sends a test message using any specified Meta template (including DOCUMENT-header templates) */
export async function sendTestWhatsAppTemplate(
  toPhone: string,
  templateKey: string = 'approval_document_packet',
  config?: WhatsAppConfig
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const cleanTo = cleanWhatsAppNumber(toPhone);
  if (!cleanTo) return { success: false, error: 'Please enter a valid mobile number' };

  const spec = META_TEMPLATES[templateKey] || META_TEMPLATE_SPEC;
  const sampleParams = spec.variables.map((v) => v.sample);

  let docMediaId: string | undefined;
  let docFilename: string | undefined;

  if (spec.headerFormat === 'DOCUMENT') {
    await createMetaApprovalTemplate(cfg, templateKey).catch(() => {});
    const sampleBlob = await buildSamplePdfBlob(spec.title);
    const sampleName = `${spec.name}_sample.pdf`;
    const uploaded = await uploadWhatsAppDocumentMedia({
      config: cfg,
      fileBlob: sampleBlob,
      filename: sampleName,
    });
    docMediaId = uploaded.mediaId;
    docFilename = uploaded.filename;
  }

  return sendWhatsAppDirect({
    to: cleanTo,
    documentMediaId: docMediaId,
    documentFilename: docFilename,
    templateName: spec.name,
    templateHasDocumentHeader: spec.headerFormat === 'DOCUMENT',
    templateLanguage: cfg.template_language || 'en',
    templateBodyParams: sampleParams,
    config: cfg,
  });
}

// ---------------------------------------------------------------------------
// Interactive Admin WhatsApp Bot ("all" Command) Webhook Helpers
// ---------------------------------------------------------------------------

export interface WhatsAppWebhookBotSettings {
  bot_secret: string;
  verify_token: string;
  forward_webhook_url: string;
  migration_ready: boolean;
}

export async function loadWhatsAppWebhookSettings(
  isBackendConnected: boolean
): Promise<WhatsAppWebhookBotSettings> {
  if (isBackendConnected) {
    try {
      const { data, error } = await supabase.rpc('get_whatsapp_webhook_settings');
      if (!error && data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        return {
          bot_secret: String(d.bot_secret || ''),
          verify_token: String(d.verify_token || 'swa_approval_verify_2026'),
          forward_webhook_url: String(
            d.forward_webhook_url || 'https://whatsapp.swaloyalty.com/api/webhooks/whatsapp'
          ),
          migration_ready: Boolean(d.bot_secret),
        };
      }
    } catch {
      /* SQL migration 0077 may not be applied yet */
    }
  }

  return {
    bot_secret: '',
    verify_token: 'swa_approval_verify_2026',
    forward_webhook_url: 'https://whatsapp.swaloyalty.com/api/webhooks/whatsapp',
    migration_ready: false,
  };
}

export async function saveWhatsAppWebhookSettings(params: {
  forward_webhook_url: string;
  verify_token: string;
}): Promise<{ success: boolean; settings?: WhatsAppWebhookBotSettings; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('update_whatsapp_webhook_settings', {
      p_forward_webhook_url: params.forward_webhook_url,
      p_verify_token: params.verify_token,
    });
    if (error) throw error;
    const d = (data || {}) as Record<string, unknown>;
    return {
      success: true,
      settings: {
        bot_secret: String(d.bot_secret || ''),
        verify_token: String(d.verify_token || 'swa_approval_verify_2026'),
        forward_webhook_url: String(
          d.forward_webhook_url || 'https://whatsapp.swaloyalty.com/api/webhooks/whatsapp'
        ),
        migration_ready: Boolean(d.bot_secret),
      },
    };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err) };
  }
}

export async function fetchMetaWebhookStatus(config: WhatsAppConfig): Promise<{
  success: boolean;
  applicationCallback?: string;
  phoneCallback?: string;
  error?: string;
}> {
  if (!config.access_token || !config.phone_number_id) {
    return { success: false, error: 'Missing WhatsApp access token or Phone Number ID' };
  }
  try {
    const res = await fetch('/api/whatsapp-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_webhook_status',
        access_token: config.access_token,
        phone_number_id: config.phone_number_id,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || `HTTP ${res.status}` };
    }
    const wc = data.webhook_configuration || {};
    return {
      success: true,
      applicationCallback: wc.application || undefined,
      phoneCallback: wc.phone_number || wc.whatsapp_business_account || undefined,
    };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err) };
  }
}

export async function activateMetaWebhookOverride(params: {
  config: WhatsAppConfig;
  callbackUrl: string;
  verifyToken: string;
}): Promise<{
  success: boolean;
  phoneCallback?: string;
  applicationCallback?: string;
  error?: string;
}> {
  const { config, callbackUrl, verifyToken } = params;
  if (!config.access_token || !config.phone_number_id) {
    return { success: false, error: 'Missing WhatsApp access token or Phone Number ID' };
  }
  try {
    const res = await fetch('/api/whatsapp-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'configure_webhook',
        access_token: config.access_token,
        phone_number_id: config.phone_number_id,
        waba_id: config.waba_id || DEFAULT_WHATSAPP_CONFIG.waba_id,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || `HTTP ${res.status}` };
    }
    const wc = data.webhook_configuration || {};
    return {
      success: true,
      phoneCallback: wc.phone_number || wc.whatsapp_business_account || callbackUrl,
      applicationCallback: wc.application || undefined,
    };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err) };
  }
}
