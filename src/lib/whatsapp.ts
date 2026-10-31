import { supabase } from './supabase';
import { errMsg } from './errorUtils';
import type { RequestRecord, WhatsAppConfig } from '../types/database';
import { formatINR } from './formatters';

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
  admin_phone_number: '',
};

const STORAGE_KEY = 'approval_app_whatsapp_config';

/**
 * Normalizes phone numbers to WhatsApp Cloud API format (E.164 without '+').
 * Examples:
 *   "+91 80893 04002" -> "918089304002"
 *   "8089304002" -> "918089304002" (assumes India 91 for 10-digit numbers)
 *   "08089304002" -> "918089304002"
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

interface SendDirectParams {
  to: string;
  documentUrl?: string;
  documentFilename?: string;
  caption?: string;
  text?: string;
  config?: WhatsAppConfig;
}

/** Sends a message or document directly using WhatsApp Cloud API (Graph API) */
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

  // 1. Send Document Attachment if provided
  if (params.documentUrl) {
    try {
      const docPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'document',
        document: {
          link: params.documentUrl,
          caption: params.caption || 'Approved Document Attachment',
          filename: params.documentFilename || 'Approved_Document.pdf',
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
        console.error('WhatsApp send document failed:', data);
        return { success: false, error: errorMsg };
      }

      const msgId = data?.messages?.[0]?.id;

      // If there's also additional text, send it as a follow-up
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

  // 2. Send Text-only message if no documentUrl
  if (params.text) {
    try {
      const textPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { body: params.text },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(textPayload),
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error?.message || `WhatsApp API error (${res.status})`;
        console.error('WhatsApp send text failed:', data);
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
    `✅ When any document or request is approved, the official approved PDF will be delivered directly to this number with the approval details.`;

  return sendWhatsAppDirect({
    to: cleanTo,
    text: messageText,
    config: cfg,
  });
}

/**
 * Builds and dispatches the "your approval has been approved" WhatsApp message
 * along with the signed approval PDF attachment to the requester, head, and admin.
 */
export async function sendApprovalWhatsAppNotification(
  request: RequestRecord,
  signedPdfUrl: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) {
    return { success: false, results: [] };
  }

  const approvalNo = request.approval_no || 'APPROVED';
  const requestNo = request.request_no || 'REQ';
  const amountStr =
    request.request_type === 'stock_transfer'
      ? `Stock Transfer (MRP: ${formatINR(request.amount || 0)})`
      : request.request_type === 'non_cash'
      ? 'Non-Cash (No direct disbursement)'
      : formatINR(request.amount || 0);

  const approverName =
    (request.actions || []).find((a) => a.action === 'approved')?.actor_name ||
    'Authorized Head / Admin';

  const titleStr = request.title || 'Official Approval';
  const outletStr = request.shop_name || 'All Outlets';

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
    `📅 *Approved on:* ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}\n\n` +
    `📄 *The official signed approval document packet is attached above.*`;

  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  // Determine recipients
  const targets: { phone: string; name?: string }[] = [];

  // 1. Extra explicit recipient (e.g. from modal or parameter)
  if (extraRecipientPhone) {
    targets.push({ phone: extraRecipientPhone, name: 'Specified Recipient' });
  }

  // 2. Requester (from requester profile if available)
  if (cfg.notify_requester && request.requester_id) {
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('whatsapp_number, full_name')
        .eq('id', request.requester_id)
        .maybeSingle();

      if (prof?.whatsapp_number) {
        targets.push({ phone: prof.whatsapp_number, name: prof.full_name || request.requester_name });
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Head (from request owner_head_id or requester's default_head_id)
  if (cfg.notify_head) {
    const headId = request.owner_head_id;
    if (headId && headId !== request.requester_id) {
      try {
        const { data: headProf } = await supabase
          .from('profiles')
          .select('whatsapp_number, full_name')
          .eq('id', headId)
          .maybeSingle();

        if (headProf?.whatsapp_number) {
          targets.push({ phone: headProf.whatsapp_number, name: headProf.full_name || 'Department Head' });
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 4. Admin copy phone number
  if (cfg.admin_phone_number && cfg.admin_phone_number.trim()) {
    targets.push({ phone: cfg.admin_phone_number.trim(), name: 'Admin Copy' });
  }

  // Deduplicate by cleaned phone number
  const seen = new Set<string>();
  const uniqueTargets = targets.filter((t) => {
    const clean = cleanWhatsAppNumber(t.phone);
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });

  const filename = `${approvalNo}_Approved_Document.pdf`;

  for (const target of uniqueTargets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      documentUrl: signedPdfUrl,
      documentFilename: filename,
      caption,
      text: messageBody,
      config: cfg,
    });

    results.push({
      recipient: target.phone,
      name: target.name,
      ok: res.success,
      error: res.error,
    });

    // Log to whatsapp_logs if backend is connected
    try {
      await supabase.from('whatsapp_logs').insert({
        request_id: request.id,
        recipient_phone: target.phone,
        recipient_name: target.name || null,
        message_type: 'document',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: { approval_no: approvalNo, request_no: requestNo },
      });
    } catch {
      /* ignore logging error */
    }
  }

  return {
    success: results.some((r) => r.ok),
    results,
  };
}
