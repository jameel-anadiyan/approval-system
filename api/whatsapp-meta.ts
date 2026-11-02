// Vercel Serverless Function: Meta WhatsApp Cloud API Helper (Zero External Dependencies)
// Handles server-side Resumable Upload (header_handle) for DOCUMENT header template
// registration and server-side Media Upload (media_id) without browser CORS barriers.
export const config = {
  runtime: 'nodejs',
};

const GRAPH_VERSION = 'v21.0';
const DEFAULT_APP_ID = '3607856502698794';
const DEFAULT_WABA_ID = '1792622932047989';
const DEFAULT_PHONE_ID = '1391767714024374';

/**
 * Generates a valid, standards-compliant 1-page PDF-1.4 document with exact xref byte offsets
 * and zero external dependencies so Vercel Serverless (@vercel/node ESM) never fails bundling.
 */
function buildSamplePdfBytes(title: string): Buffer {
  const safeTitle = String(title || 'Sample Official Document')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[()\\]/g, '')
    .slice(0, 80);

  const contentStream =
    `BT\n` +
    `/F1 16 Tf\n` +
    `50 770 Td\n` +
    `(SWA DIAMONDS - OFFICIAL DOCUMENT) Tj\n` +
    `0 -26 Td\n` +
    `/F1 12 Tf\n` +
    `(${safeTitle}) Tj\n` +
    `0 -22 Td\n` +
    `/F1 10 Tf\n` +
    `(Sample PDF document for WhatsApp Business Utility Template header verification.) Tj\n` +
    `ET\n`;

  const streamLen = Buffer.byteLength(contentStream, 'ascii');

  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `5 0 obj\n<< /Length ${streamLen} >>\nstream\n${contentStream}endstream\nendobj\n`,
  ];

  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'ascii');
}

async function uploadResumableSampleHandle(
  accessToken: string,
  appId: string,
  sampleTitle: string
): Promise<string> {
  const pdfBuffer = buildSamplePdfBytes(sampleTitle);

  const sessionUrl =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(appId)}/uploads` +
    `?file_name=sample_document.pdf&file_length=${pdfBuffer.byteLength}&file_type=application/pdf`;

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
      body: new Uint8Array(pdfBuffer),
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

      // Check if this template + language already exists in Meta WABA
      const checkRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as any;
        const list = Array.isArray(checkData?.data) ? checkData.data : [];
        const exactMatch =
          list.find((t: any) => t.name === name && t.language === language) ||
          (!body.strict_language ? list.find((t: any) => t.name === name) : null);
        if (exactMatch) {
          return res.status(200).json({
            success: true,
            templateId: exactMatch.id,
            status: exactMatch.status || 'APPROVED',
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
      let rawMime = String(body.mime_type || 'application/pdf').trim();
      let fileBytes: Uint8Array | null = null;

      if (body.sample_pdf) {
        fileBytes = new Uint8Array(
          buildSamplePdfBytes(String(body.sample_title || 'Sample Document'))
        );
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
        if (!body.mime_type) {
          rawMime = (dlRes.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
        }
      }

      if (!fileBytes || fileBytes.byteLength === 0) {
        return res.status(400).json({ success: false, error: 'No document bytes provided' });
      }

      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      const blob = new Blob([Buffer.from(fileBytes)], { type: rawMime || 'application/pdf' });
      form.append('file', blob, rawFilename);

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
        filename: rawFilename,
        mime_type: rawMime,
      });
    }

    if (action === 'get_webhook_status') {
      const phoneId = String(body.phone_number_id || DEFAULT_PHONE_ID).trim();
      const statusRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,webhook_configuration`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const statusData = (await statusRes.json()) as any;
      if (!statusRes.ok) {
        return res.status(400).json({
          success: false,
          error: statusData?.error?.message || `Failed to inspect webhook (${statusRes.status})`,
        });
      }
      return res.status(200).json({
        success: true,
        display_phone_number: statusData?.display_phone_number || null,
        verified_name: statusData?.verified_name || null,
        webhook_configuration: statusData?.webhook_configuration || {},
      });
    }

    if (action === 'configure_webhook') {
      const phoneId = String(body.phone_number_id || DEFAULT_PHONE_ID).trim();
      const wabaId = String(body.waba_id || DEFAULT_WABA_ID).trim();
      const callbackUrl = String(body.callback_url || '').trim();
      const verifyToken = String(body.verify_token || 'swa_approval_verify_2026').trim();

      if (!callbackUrl || !callbackUrl.startsWith('https://')) {
        return res.status(400).json({
          success: false,
          error: 'A public HTTPS callback_url is required by Meta Cloud API',
        });
      }

      // 1. Set Phone-Number-Level Webhook Override on Meta Cloud API
      const overrideRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook_configuration: {
              override_callback_uri: callbackUrl,
              verify_token: verifyToken,
            },
          }),
        }
      );
      let overrideData = (await overrideRes.json().catch(() => ({}))) as any;

      if (!overrideRes.ok) {
        // Fallback: WABA-level subscribed_apps override if phone-level override is restricted
        const wabaRes = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              override_callback_uri: callbackUrl,
              verify_token: verifyToken,
            }),
          }
        );
        const wabaData = (await wabaRes.json().catch(() => ({}))) as any;
        if (!wabaRes.ok) {
          return res.status(400).json({
            success: false,
            error:
              overrideData?.error?.message ||
              wabaData?.error?.message ||
              `Meta webhook override failed (${overrideRes.status})`,
            raw: overrideData,
          });
        }
        overrideData = wabaData;
      }

      // 2. Ensure WABA app subscription is active
      await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).catch(() => {});

      // 3. Re-read live webhook_configuration
      const verifyRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name,webhook_configuration`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const verifyJson = (await verifyRes.json().catch(() => ({}))) as any;

      return res.status(200).json({
        success: true,
        result: overrideData,
        webhook_configuration: verifyJson?.webhook_configuration || {},
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
