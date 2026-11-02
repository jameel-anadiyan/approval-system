import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { RequestRecord } from '../types/database';
import { formatISTDate } from './formatters';

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

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const safe = toSafePdfText(text).trim() || '-';
  const paragraphs = safe.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Generates the official "Petty Cash Form Below 1000" PDF (`Petty_Cash_Form_Below_1000.pdf`)
 * so that upon approval, both this form and any optional supporting documents are stamped
 * with the official SWA Diamonds seal, signature, QR code, and Approval No.
 */
export async function generatePettyCashFormPdf(
  req: Pick<
    RequestRecord,
    | 'request_no'
    | 'requester_name'
    | 'shop_name'
    | 'owner_head_name'
    | 'assigned_entry_user_name'
    | 'disbursement_mode'
    | 'amount'
    | 'notes'
    | 'submitted_at'
    | 'created_at'
    | 'bank_account_holder_name'
    | 'bank_account_no'
    | 'bank_ifsc'
    | 'bank_name'
    | 'enter_bank_details_later'
  > & { department_name?: string | null }
): Promise<{ bytes: Uint8Array; blob: Blob; pageCount: number }> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 width
  const pageHeight = 841.89; // A4 height
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Top Banner
  const bannerHeight = 68;
  const bannerTop = pageHeight - margin;
  page.drawRectangle({
    x: margin,
    y: bannerTop - bannerHeight,
    width: contentWidth,
    height: bannerHeight,
    color: rgb(0.05, 0.38, 0.35), // Deep Teal
  });

  page.drawText('SWA DIAMONDS', {
    x: margin + 18,
    y: bannerTop - 27,
    size: 16,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawText('PETTY CASH FORM BELOW 1000', {
    x: margin + 18,
    y: bannerTop - 48,
    size: 11.5,
    font: bold,
    color: rgb(0.84, 0.97, 0.94),
  });

  const amountVal = Number(req.amount || 0);
  const formattedAmt = `Rs. ${amountVal.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  // Amount Pill on Banner Right
  const amtBadgeText = `Amount: ${formattedAmt}`;
  const amtTextWidth = bold.widthOfTextAtSize(amtBadgeText, 11);
  const pillW = amtTextWidth + 24;
  page.drawRectangle({
    x: margin + contentWidth - pillW - 16,
    y: bannerTop - 46,
    width: pillW,
    height: 26,
    color: rgb(1, 1, 1),
  });
  page.drawText(amtBadgeText, {
    x: margin + contentWidth - pillW - 4,
    y: bannerTop - 37,
    size: 11,
    font: bold,
    color: rgb(0.05, 0.38, 0.35),
  });

  let y = bannerTop - bannerHeight - 22;

  // Section 1: Petty Cash Voucher Details
  page.drawText('1. PETTY CASH VOUCHER DETAILS (MAXIMUM LIMIT: Rs. 1,000.00)', {
    x: margin,
    y,
    size: 10,
    font: bold,
    color: rgb(0.05, 0.38, 0.35),
  });
  y -= 10;

  const mode = (req.disbursement_mode || 'cash').toLowerCase() === 'bank' ? 'Bank Transfer' : 'Cash (Default)';
  const rows: [string, string][] = [
    ['Request Number', toSafePdfText(req.request_no || 'Pending Assignment')],
    ['Submitted Date', toSafePdfText(formatISTDate(req.submitted_at || req.created_at, true))],
    ['Requested By', toSafePdfText(req.requester_name || '-')],
    ['Outlet / Shop', toSafePdfText(req.shop_name || 'Not Assigned')],
    ['Petty Cash Dealing Head', toSafePdfText(req.owner_head_name || '-')],
    ['Disbursement Entry Account', toSafePdfText(req.assigned_entry_user_name || '-')],
    ['Payment Mode', mode],
    ['Requested Amount (<= Rs. 1,000)', formattedAmt],
  ];

  if ((req.disbursement_mode || 'cash').toLowerCase() === 'bank') {
    if (req.enter_bank_details_later) {
      rows.push(['Bank Account Details', 'To be entered during Disbursement']);
    } else if (req.bank_account_no) {
      rows.push([
        'Beneficiary Bank Account',
        toSafePdfText(
          `${req.bank_account_holder_name || ''} | A/C: ${req.bank_account_no} | IFSC: ${req.bank_ifsc || '-'} (${req.bank_name || '-'})`
        ),
      ]);
    }
  }

  const labelColWidth = 175;
  const rowHeight = 24;

  rows.forEach(([label, val], idx) => {
    const rowTop = y;
    const rowBottom = rowTop - rowHeight;
    page.drawRectangle({
      x: margin,
      y: rowBottom,
      width: contentWidth,
      height: rowHeight,
      color: idx % 2 === 0 ? rgb(0.965, 0.985, 0.985) : rgb(1, 1, 1),
      borderColor: rgb(0.84, 0.89, 0.89),
      borderWidth: 0.6,
    });
    page.drawLine({
      start: { x: margin + labelColWidth, y: rowTop },
      end: { x: margin + labelColWidth, y: rowBottom },
      thickness: 0.6,
      color: rgb(0.84, 0.89, 0.89),
    });
    page.drawText(label, {
      x: margin + 10,
      y: rowBottom + 8,
      size: 9.2,
      font: bold,
      color: rgb(0.25, 0.3, 0.35),
    });

    const valLines = wrapText(val || '-', idx === rows.length - 1 ? bold : regular, 9.5, contentWidth - labelColWidth - 20);
    page.drawText(valLines[0] || '-', {
      x: margin + labelColWidth + 10,
      y: rowBottom + 8,
      size: 9.5,
      font: label.startsWith('Requested Amount') ? bold : regular,
      color: label.startsWith('Requested Amount') ? rgb(0.04, 0.36, 0.32) : rgb(0.1, 0.13, 0.18),
    });
    y = rowBottom;
  });

  // Section 2: Mandatory Note / Purpose
  y -= 22;
  page.drawText('2. MANDATORY NOTE / EXPENSE PURPOSE', {
    x: margin,
    y,
    size: 10,
    font: bold,
    color: rgb(0.05, 0.38, 0.35),
  });
  y -= 10;

  const noteLines = wrapText(req.notes || '-', regular, 10, contentWidth - 24).slice(0, 14);
  const noteBoxHeight = Math.max(64, noteLines.length * 14 + 22);
  page.drawRectangle({
    x: margin,
    y: y - noteBoxHeight,
    width: contentWidth,
    height: noteBoxHeight,
    color: rgb(0.99, 0.995, 0.995),
    borderColor: rgb(0.75, 0.86, 0.85),
    borderWidth: 0.8,
  });

  let textY = y - 18;
  for (const line of noteLines) {
    page.drawText(line, {
      x: margin + 12,
      y: textY,
      size: 10,
      font: regular,
      color: rgb(0.12, 0.15, 0.2),
    });
    textY -= 14;
  }

  y = y - noteBoxHeight - 16;
  page.drawText(
    'Workflow: Direct Petty Cash Approval (Clerk Forwarding Skipped)  |  Form: Petty Cash Form Below 1000',
    {
      x: margin,
      y,
      size: 8.5,
      font: regular,
      color: rgb(0.42, 0.47, 0.52),
    }
  );

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  return { bytes, blob, pageCount: pdfDoc.getPageCount() };
}
