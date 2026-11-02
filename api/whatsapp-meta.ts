// Vercel Serverless Function: Meta WhatsApp Cloud API Helper
// Handles server-side Resumable Upload (header_handle) for DOCUMENT header template
// registration and server-side Media Upload (media_id) without browser CORS barriers.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const config = {
  runtime: 'nodejs',
};

const GRAPH_VERSION = 'v21.0';
const DEFAULT_APP_ID = '3607856502698794';
const DEFAULT_WABA_ID = '1792622932047989';
const DEFAULT_PHONE_ID = '1391767714024374';

function cleanAscii(text: string): string {
  return String(text || '').replace(/[^\x20-\x7E]/g, ' ');
}

async function buildSamplePdfBytes(title: string): Promise<Uint8Array> {
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
  page.drawText(cleanAscii(title || 'Sample Approved / Disbursement Document'), {
    x: 50,
    y: 740,
    size: 12,
    font: regular,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(
    'This sample PDF is used for Meta WhatsApp Business Utility Template verification.',
    {
      x: 50,
      y: 710,
      size: 10,
      font: regular,
      color: rgb(0.35, 0.35, 0.35),
    }
  );

  return await pdf.save();
}

async function wrapImageIntoPdfIfNeeded(
  bytes: Uint8Array,
  mimeType: string,
  filename: string
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (filename || '').toLowerCase();
  const isPng = lowerMime === 'image/png' || lowerName.endsWith('.png');
  const isJpg =
    lowerMime === 'image/jpeg' ||
    lowerMime === 'image/jpg' ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg');

  if (!isPng && !isJpg) {
    return { bytes, mimeType: mimeType || 'application/pdf', filename };
  }

  const pdf = await PDFDocument.create();
  const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const maxWidth = 535;
  const maxHeight = 780;
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const pageW = Math.max(drawW + 60, 420);
  const pageH = Math.max(drawH + 60, 595);
  const page = pdf.addPage([pageW, pageH]);
  page.drawImage(img, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  });

  const pdfBytes = await pdf.save();
  const baseName = filename.replace(/\.[^.]+$/, '') || 'Disbursement_Receipt';
  return {
    bytes: pdfBytes,
    mimeType: 'application/pdf',
    filename: `${baseName}.pdf`,
  };
}

async function uploadResumableSampleHandle(
  accessToken: string,
  appId: string,
  sampleTitle: string
): Promise<string> {
  const pdfBytes = await buildSamplePdfBytes(sampleTitle);

  const sessionUrl =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(appId)}/uploads` +
    `?file_name=sample_document.pdf&file_length=${pdfBytes.byteLength}&file_type=application/pdf`;

  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const sessionData = (await sessionRes.json()) as any;
  if (!sessionRes.ok || !sessionData?.id) {
    throw new Error(
      sessionData?.error?.message || `Resumable upload session failed (${sessionRes.status})`
    );
  }

  const uploadRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${sessionData.id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: '0',
        'Content-Type': 'application/pdf',
      },
      body: Buffer.from(pdfBytes),
    }
  );
  const uploadData = (await uploadRes.json()) as any;
  if (!uploadRes.ok || !uploadData?.h) {
    throw new Error(
      uploadData?.error?.message || `Resumable binary upload failed (${uploadRes.status})`
    );
  }

  return String(uploadData.h);
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = String(body.action || '');
    const accessToken = String(body.access_token || '').trim();

    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Missing WhatsApp access token' });
    }

    if (action === 'register_template') {
      const wabaId = String(body.waba_id || DEFAULT_WABA_ID).trim();
      const appId = String(body.app_id || DEFAULT_APP_ID).trim();
      const name = String(body.name || '').trim();
      const category = String(body.category || 'UTILITY').trim();
      const language = String(body.language || 'en').trim();
      const headerFormat = body.header_format ? String(body.header_format).trim() : '';
      const bodyText = String(body.body_text || '');
      const sampleValues: string[] = Array.isArray(body.sample_values)
        ? body.sample_values.map((v: any) => String(v))
        : [];

      if (!name || !bodyText) {
        return res.status(400).json({ success: false, error: 'Template name and body_text required' });
      }

      // First check if template already exists in Meta WABA
      const checkRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as any;
        const existing = Array.isArray(checkData?.data)
          ? checkData.data.find((t: any) => t.name === name)
          : null;
        if (existing) {
          return res.status(200).json({
            success: true,
            templateId: existing.id,
            status: existing.status || 'APPROVED',
            alreadyExists: true,
          });
        }
      }

      const components: any[] = [];
      if (headerFormat === 'DOCUMENT') {
        const handle = await uploadResumableSampleHandle(
          accessToken,
          appId,
          body.title || name
        );
        components.push({
          type: 'HEADER',
          format: 'DOCUMENT',
          example: {
            header_handle: [handle],
          },
        });
      }

      components.push({
        type: 'BODY',
        text: bodyText,
        ...(sampleValues.length > 0
          ? {
              example: {
                body_text: [sampleValues],
              },
            }
          : {}),
      });

      const createRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name,
            category,
            language,
            components,
          }),
        }
      );
      const createData = (await createRes.json()) as any;
      if (!createRes.ok) {
        return res.status(400).json({
          success: false,
          error: createData?.error?.message || `Meta template registration failed (${createRes.status})`,
          raw: createData,
        });
      }

      return res.status(200).json({
        success: true,
        templateId: createData?.id,
        status: createData?.status || 'PENDING',
      });
    }

    if (action === 'upload_media') {
      const phoneId = String(body.phone_number_id || DEFAULT_PHONE_ID).trim();
      const rawFilename = String(body.filename || 'Document.pdf').trim();
      let rawMime = String(body.mime_type || '').trim();
      let fileBytes: Uint8Array | null = null;

      if (body.sample_pdf) {
        fileBytes = await buildSamplePdfBytes(String(body.sample_title || 'Sample Document'));
        rawMime = 'application/pdf';
      } else if (body.file_base64) {
        fileBytes = new Uint8Array(Buffer.from(String(body.file_base64), 'base64'));
      } else if (body.source_url) {
        const dlRes = await fetch(String(body.source_url));
        if (!dlRes.ok) {
          return res.status(400).json({
            success: false,
            error: `Could not download source document (${dlRes.status})`,
          });
        }
        const ab = await dlRes.arrayBuffer();
        fileBytes = new Uint8Array(ab);
        if (!rawMime) {
          rawMime = (dlRes.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
        }
      }

      if (!fileBytes || fileBytes.byteLength === 0) {
        return res.status(400).json({ success: false, error: 'No document bytes provided' });
      }

      const prepared = await wrapImageIntoPdfIfNeeded(
        fileBytes,
        rawMime || 'application/pdf',
        rawFilename
      );

      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      const blob = new Blob([Buffer.from(prepared.bytes)], { type: prepared.mimeType });
      form.append('file', blob, prepared.filename);

      const mediaRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}/media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        }
      );
      const mediaData = (await mediaRes.json()) as any;
      if (!mediaRes.ok || !mediaData?.id) {
        return res.status(400).json({
          success: false,
          error: mediaData?.error?.message || `WhatsApp media upload failed (${mediaRes.status})`,
          raw: mediaData,
        });
      }

      return res.status(200).json({
        success: true,
        media_id: String(mediaData.id),
        filename: prepared.filename,
        mime_type: prepared.mimeType,
      });
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'WhatsApp Meta proxy error',
    });
  }
}
