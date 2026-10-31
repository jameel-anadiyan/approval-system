import { supabase } from './supabase';
import { errMsg } from './errorUtils';
import type { RequestRecord, WhatsAppConfig } from '../types/database';
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
  template_name: 'approval_notification',
  template_language: 'en',
  use_template: true,
};

export interface MetaTemplateDefinition {
  name: string;
  title: string;
  category: 'UTILITY';
  language: string;
  bodyText: string;
  variables: { num: string; name: string; sample: string }[];
}

export const META_TEMPLATES: Record<string, MetaTemplateDefinition> = {
  approval_notification: {
    name: 'approval_notification',
    title: 'Approved Document Packet',
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
  payment_completed_notification: {
    name: 'payment_completed_notification',
    title: 'Payment Completed & Closed',
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
    title: 'Partial Payment Disbursed',
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
};

export const META_TEMPLATE_SPEC = META_TEMPLATES.approval_notification;

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
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
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

/** Registers or submits a template in Meta WABA */
export async function createMetaApprovalTemplate(
  config?: WhatsAppConfig,
  templateKey: string = 'approval_notification'
): Promise<{
  success: boolean;
  templateId?: string;
  status?: string;
  error?: string;
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const wabaId = cfg.waba_id || '1792622932047989';
  const token = cfg.access_token?.trim();
  if (!token || !wabaId) return { success: false, error: 'Missing access token or WABA ID' };

  const spec = META_TEMPLATES[templateKey] || META_TEMPLATE_SPEC;

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

/** Registers all standard lifecycle templates in Meta WABA */
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

export interface SendDirectParams {
  to: string;
  documentUrl?: string;
  documentFilename?: string;
  caption?: string;
  text?: string;
  config?: WhatsAppConfig;
  templateName?: string;
  templateLanguage?: string;
  templateBodyParams?: string[];
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

  const isRemoteDocUrl =
    Boolean(params.documentUrl) &&
    (params.documentUrl!.startsWith('https://') || params.documentUrl!.startsWith('http://'));

  // 1. Attempt Meta Pre-Approved Message Template dispatch if template parameters are supplied
  if (params.templateBodyParams && params.templateBodyParams.length > 0 && config.use_template !== false) {
    try {
      const templateName = params.templateName || config.template_name || 'approval_notification';
      const templateLanguage = params.templateLanguage || config.template_language || 'en';

      const templatePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            {
              type: 'body',
              parameters: params.templateBodyParams.map((p) => ({ type: 'text', text: String(p) })),
            },
          ],
        },
      };

      const tRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(templatePayload),
      });

      const tData = await tRes.json();
      if (tRes.ok) {
        const msgId = tData?.messages?.[0]?.id;

        // If a document was also provided, send it as companion attachment
        if (isRemoteDocUrl && params.documentUrl) {
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
                type: 'document',
                document: {
                  link: params.documentUrl,
                  caption: params.caption || 'Approved Document Packet',
                  filename: params.documentFilename || 'Approved_Document.pdf',
                },
              }),
            });
          } catch {
            /* ignore document companion failure if template succeeded */
          }
        }

        return { success: true, messageId: msgId };
      }

      console.warn('Meta template send returned error, falling back to direct document/text dispatch:', tData);
    } catch (tErr) {
      console.warn('Meta template dispatch exception, falling back to direct dispatch:', tErr);
    }
  }

  // 2. Direct Document Attachment dispatch (or fallback from template)
  if (isRemoteDocUrl && params.documentUrl) {
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
        console.warn('WhatsApp send document failed, falling back to text notification:', data);

        // Fallback to text message so notification is never lost
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
      console.warn('WhatsApp send document network exception, attempting text fallback:', e);
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
          /* ignore */
        }
      }
      return { success: false, error: errMsg(e) };
    }
  }

  // 2. Send Text-only message if no remote documentUrl
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
 * Resolves all target recipients for a request notification:
 * 1. Extra recipient (if provided)
 * 2. Requester (from profile or mock data)
 * 3. Department Head (from owner_head_id or mock data)
 * 4. Admin copy (cfg.admin_phone_number or +91 9846880713)
 */
export async function getNotificationRecipients(
  request: RequestRecord,
  cfg: WhatsAppConfig,
  extraRecipientPhone?: string
): Promise<{ phone: string; name?: string }[]> {
  const targets: { phone: string; name?: string }[] = [];

  // 1. Extra explicit recipient
  if (extraRecipientPhone) {
    targets.push({ phone: extraRecipientPhone, name: 'Specified Recipient' });
  }

  // 2. Requester
  if (cfg.notify_requester && request.requester_id) {
    let reqPhone: string | undefined;
    let reqName = request.requester_name;
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
    if (headId && headId !== request.requester_id) {
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
  targets.push({ phone: adminPhone, name: 'Admin Test Copy' });

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
 * Builds and dispatches the "your approval has been approved" WhatsApp message
 * along with the signed approval PDF attachment to the requester, head, and admin.
 */
export async function sendApprovalWhatsAppNotification(
  request: RequestRecord,
  signedPdfUrl: string,
  config?: WhatsAppConfig,
  extraRecipientPhone?: string,
  customApproverName?: string
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
    customApproverName ||
    (request.actions || []).find((a) => a.action === 'approved')?.actor_name ||
    'Authorized Head / Admin';

  const titleStr = request.title || 'Official Approval';
  const outletStr = request.shop_name || 'All Outlets';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

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
    `📄 *The official signed approval document packet has been stamped.*`;

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
  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  for (const target of targets) {
    const res = await sendWhatsAppDirect({
      to: target.phone,
      documentUrl: signedPdfUrl,
      documentFilename: filename,
      caption,
      text: messageBody,
      config: cfg,
      templateName: 'approval_notification',
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
        message_type: 'document',
        status: res.success ? 'sent' : 'failed',
        meta_message_id: res.messageId || null,
        error_message: res.error || null,
        details: { approval_no: approvalNo, request_no: requestNo, event: 'approval' },
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
 * Builds and dispatches the WhatsApp disbursement message for either:
 * - Complete paid and close (payment_completed_notification)
 * - Partial payment (partial_payment_notification)
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
  attachmentFilename?: string | null
): Promise<{
  success: boolean;
  results: { recipient: string; name?: string; ok: boolean; error?: string }[];
}> {
  const cfg = config || (await loadWhatsAppConfig(true));
  if (!cfg.enabled) return { success: false, results: [] };

  const approvalNo = request.approval_no || 'APPROVED';
  const requestNo = request.request_no || 'REQ';
  const titleStr = request.title || 'Official Request';
  const outletStr = request.shop_name || 'All Outlets';
  const modeStr = paymentMode || 'Bank Transfer';
  const refStr = paymentRef?.trim() || 'Processed';
  const dateStr =
    paymentDate || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const targets = await getNotificationRecipients(request, cfg, extraRecipientPhone);
  const results: { recipient: string; name?: string; ok: boolean; error?: string }[] = [];

  const defaultDocFilename = isFullyPaid
    ? `${approvalNo}_Payment_Settlement_Receipt.pdf`
    : `${approvalNo}_Partial_Payment_Receipt.pdf`;
  const finalFilename = attachmentFilename || defaultDocFilename;
  const companionCaption = isFullyPaid
    ? `✅ Payment Completed Receipt · ${approvalNo} · ${modeStr}`
    : `💳 Partial Payment Receipt · ${approvalNo} · ${modeStr}`;

  if (isFullyPaid) {
    const totalAmountStr = formatINR(request.amount || (request.paid_amount || 0));
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
      (attachmentUrl
        ? `📄 *Disbursement receipt attachment is delivered above.*\n\n`
        : '') +
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
        documentUrl: attachmentUrl || undefined,
        documentFilename: finalFilename,
        caption: companionCaption,
        text: messageBody,
        config: cfg,
        templateName: 'payment_completed_notification',
        templateLanguage: cfg.template_language || 'en',
        templateBodyParams,
      });

      results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

      try {
        await supabase.from('whatsapp_logs').insert({
          request_id: request.id,
          recipient_phone: target.phone,
          recipient_name: target.name || null,
          message_type: attachmentUrl ? 'document' : 'template',
          status: res.success ? 'sent' : 'failed',
          meta_message_id: res.messageId || null,
          error_message: res.error || null,
          details: {
            approval_no: approvalNo,
            request_no: requestNo,
            event: 'fully_paid',
            ref: refStr,
            has_attachment: Boolean(attachmentUrl),
          },
        });
      } catch {
        /* ignore */
      }
    }
  } else {
    // Partial payment
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
      (attachmentUrl
        ? `📄 *Disbursement receipt attachment is delivered above.*\n\n`
        : '') +
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
        documentUrl: attachmentUrl || undefined,
        documentFilename: finalFilename,
        caption: companionCaption,
        text: messageBody,
        config: cfg,
        templateName: 'partial_payment_notification',
        templateLanguage: cfg.template_language || 'en',
        templateBodyParams,
      });

      results.push({ recipient: target.phone, name: target.name, ok: res.success, error: res.error });

      try {
        await supabase.from('whatsapp_logs').insert({
          request_id: request.id,
          recipient_phone: target.phone,
          recipient_name: target.name || null,
          message_type: attachmentUrl ? 'document' : 'template',
          status: res.success ? 'sent' : 'failed',
          meta_message_id: res.messageId || null,
          error_message: res.error || null,
          details: {
            approval_no: approvalNo,
            request_no: requestNo,
            disbursed: disbursedAmount,
            remaining: remainingBalance,
            event: 'partial_paid',
            has_attachment: Boolean(attachmentUrl),
          },
        });
      } catch {
        /* ignore */
      }
    }
  }

  return { success: results.some((r) => r.ok), results };
}

/** Sends a test message using any specified Meta template (default: approval_notification) */
export async function sendTestWhatsAppTemplate(
  toPhone: string,
  templateKey: string = 'approval_notification',
  config?: WhatsAppConfig
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const cfg = config || (await loadWhatsAppConfig(true));
  const cleanTo = cleanWhatsAppNumber(toPhone);
  if (!cleanTo) return { success: false, error: 'Please enter a valid mobile number' };

  const spec = META_TEMPLATES[templateKey] || META_TEMPLATE_SPEC;
  const sampleParams = spec.variables.map((v) => v.sample);

  return sendWhatsAppDirect({
    to: cleanTo,
    templateName: spec.name,
    templateLanguage: cfg.template_language || 'en',
    templateBodyParams: sampleParams,
    config: cfg,
  });
}
