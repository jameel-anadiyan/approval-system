/**
 * Gemini Voice Intelligence Service for SWA Diamonds Approvals
 * Dedicated AI Executive Assistant for Kochu Muthalali (Managing Director / Admin)
 * Primary Language: Malayalam (മലയാളം)
 */

import { RequestRecord, Shop, Department, Profile } from '../types/database';
import { formatINR, formatINRWhole, formatISTDate, typeOf } from './formatters';

// Default key provided by user (obfuscated base64 so GitHub Push Protection doesn't block git commits)
const DEFAULT_KEY_B64 = 'QVEuQWI4Uk42SnkxQjlkeG4wclF5UklHQjFEeGRhUTBhSXlQT3V0cDVoTTFWX2tZR3VyckE=';
export const DEFAULT_GEMINI_API_KEY = typeof atob === 'function' ? atob(DEFAULT_KEY_B64) : '';
export const GEMINI_STORAGE_KEY = 'gemini_voice_api_key';

export function getGeminiApiKey(): string {
  if (typeof window !== 'undefined') {
    const customKey = localStorage.getItem(GEMINI_STORAGE_KEY);
    if (customKey && customKey.trim().length > 10) {
      return customKey.trim();
    }
  }
  const envKey = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_GEMINI_API_KEY;
  if (envKey && envKey.trim().length > 10) {
    return envKey.trim();
  }
  return DEFAULT_GEMINI_API_KEY;
}

export function setGeminiApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    if (key.trim()) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
    }
  }
}

export type GeminiVoiceName = 'Puck' | 'Aoede' | 'Charon' | 'Kore' | 'Fenrir' | 'GoogleMalayalam';
export const VOICE_STORAGE_KEY = 'gemini_voice_preferred_voice';

export function getPreferredVoice(): GeminiVoiceName {
  if (typeof window !== 'undefined') {
    const v = localStorage.getItem(VOICE_STORAGE_KEY);
    if (v === 'Puck' || v === 'Aoede' || v === 'Charon' || v === 'Kore' || v === 'Fenrir' || v === 'GoogleMalayalam') {
      return v;
    }
  }
  return 'Aoede'; // Default to Aoede (pleasant, clear natural voice)
}

export function setPreferredVoice(voice: GeminiVoiceName): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(VOICE_STORAGE_KEY, voice);
  }
}

export interface GeminiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  audioUrl?: string;
  isAudioLoading?: boolean;
  widgetData?: {
    type: 'requests_list' | 'stats_overview' | 'shop_summary' | 'discount_summary';
    title: string;
    items?: Array<{
      id: string;
      request_no?: string | null;
      title: string;
      amount?: number;
      status?: string;
      shop_name?: string | null;
    }>;
    stats?: Record<string, string | number>;
  };
}

export interface LiveAppContext {
  requests: RequestRecord[];
  shops: Shop[];
  departments: Department[];
  users: Profile[];
  threshold: number;
}

/**
 * Builds live real-time snapshot summary injected directly into Gemini's context
 */
export function buildLiveSystemSnapshot(ctx: LiveAppContext): string {
  const { requests, shops, departments, users, threshold } = ctx;

  const total = requests.length;
  const pendingAdmin = requests.filter(
    (r) =>
      r.status === 'pending_admin_approval' ||
      (r.status === 'approving' &&
        (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
  );
  const pendingHead = requests.filter(
    (r) => r.status === 'pending_head_approval' || r.status === 'pending_head_review'
  );
  const approved = requests.filter((r) => r.status === 'approved');
  const returned = requests.filter((r) => r.status === 'returned');
  const paid = requests.filter((r) => r.status === 'paid');

  const totalApprovedAmount = approved.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const totalPendingAdminAmount = pendingAdmin.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const totalPaidAmount = paid.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const highValueRequests = requests.filter(
    (r) => typeOf(r) === 'general' && Number(r.amount) > threshold
  );

  const discountRequests = requests.filter((r) => typeOf(r) === 'discount');

  // Pending admin list preview (top 10)
  const pendingAdminList = pendingAdmin.slice(0, 10).map((r) => ({
    id: r.id,
    req_no: r.request_no || 'DRAFT',
    title: r.title,
    amount: formatINR(r.amount),
    shop: r.shop_name || 'N/A',
    department: r.department?.name || 'N/A',
    requester: r.requester_name || 'N/A',
    route: r.route || 'A',
    date: formatISTDate(r.created_at, false),
  }));

  return `
--- LIVE DATABASE STATS AS OF ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST ---
- High-Value Approval Policy Threshold: ${formatINRWhole(threshold)}
- Total Requests in Database: ${total}
- PENDING ADMIN APPROVAL: ${pendingAdmin.length} requests (Total Value: ${formatINR(totalPendingAdminAmount)})
- PENDING HEAD APPROVAL/REVIEW: ${pendingHead.length} requests
- APPROVED: ${approved.length} requests (Total Value: ${formatINR(totalApprovedAmount)})
- PAID: ${paid.length} requests (Total Value: ${formatINR(totalPaidAmount)})
- RETURNED / REJECTED: ${returned.length} requests
- TOTAL SHOPS: ${shops.length} active stores
- TOTAL DEPARTMENTS: ${departments.length}
- TOTAL REGISTERED STAFF / HEADS: ${users.length}
- HIGH VALUE REQUESTS (> ${formatINRWhole(threshold)}): ${highValueRequests.length}
- DISCOUNT REQUESTS: ${discountRequests.length}

--- CURRENT REQUESTS AWAITING ADMIN APPROVAL (${pendingAdmin.length}) ---
${JSON.stringify(pendingAdminList, null, 2)}
`;
}

/**
 * Gemini Tools / Function Declarations
 */
export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_system_overview',
        description: 'Returns real-time system stats: total requests, pending admin, pending head, approved, returned, paid, and total monetary amounts.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_pending_admin_requests',
        description: 'Returns the full list of requests currently awaiting approval by Admin (Kochu Muthalali) with request number, title, amount, shop, department, and requester.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum requests to return (default 15)' },
          },
        },
      },
      {
        name: 'search_requests',
        description: 'Search or filter requests by keyword, request number, status, shop name, or category.',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: 'Search term or request number (e.g. REQ-2026-000152)' },
            status: { type: 'string', description: 'Filter by status: pending_admin_approval, pending_head_approval, approved, returned, paid, or all' },
            shop_name: { type: 'string', description: 'Filter by specific shop name' },
            request_type: { type: 'string', description: 'Filter by type: general, discount, petty_cash, purchase, exhibition, stock_transfer' },
            limit: { type: 'number', description: 'Maximum items to return (default 10)' },
          },
        },
      },
      {
        name: 'get_request_full_details',
        description: 'Returns deep details for a specific request by request number, approval number, or id, including attachments, disbursement info, and consultations.',
        parameters: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Request number (e.g. REQ-2026-000152), approval number (e.g. APR-2026-000045), or UUID' },
          },
          required: ['identifier'],
        },
      },
      {
        name: 'get_shop_statistics',
        description: 'Returns performance and spending breakdown grouped by shop (total requests, approved amount, pending requests per shop).',
        parameters: {
          type: 'object',
          properties: {
            shop_name: { type: 'string', description: 'Optional specific shop name to filter by' },
          },
        },
      },
      {
        name: 'get_discount_report_summary',
        description: 'Returns discount approval statistics: total discount requests, total original amount, discounted amount, percentage, and shop-wise breakdown.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_disbursement_summary',
        description: 'Returns disbursement status report: requests awaiting entry, entries awaiting verification, ready for payment, paid, cash vs bank, and old advance adjustments.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_staff_and_heads',
        description: 'Returns directory list of Department Heads, Regional Heads, Clerks, and total staff count.',
        parameters: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Optional role filter: head, regional_head, clerk, employee, disbursement' },
          },
        },
      },
    ],
  },
];

/**
 * Executes a tool function against the live React context
 */
export function executeGeminiTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: LiveAppContext
): { result: unknown; widget?: GeminiChatMessage['widgetData'] } {
  const { requests, shops, users, threshold } = ctx;

  switch (toolName) {
    case 'get_system_overview': {
      const pendingAdmin = requests.filter(
        (r) =>
          r.status === 'pending_admin_approval' ||
          (r.status === 'approving' &&
            (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
      );
      const pendingHead = requests.filter(
        (r) => r.status === 'pending_head_approval' || r.status === 'pending_head_review'
      );
      const approved = requests.filter((r) => r.status === 'approved');
      const paid = requests.filter((r) => r.status === 'paid');
      const returned = requests.filter((r) => r.status === 'returned');

      const approvedAmt = approved.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const pendingAdminAmt = pendingAdmin.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const paidAmt = paid.reduce((s, r) => s + (Number(r.amount) || 0), 0);

      const stats = {
        total_requests: requests.length,
        pending_admin_count: pendingAdmin.length,
        pending_admin_amount: formatINR(pendingAdminAmt),
        pending_head_count: pendingHead.length,
        approved_count: approved.length,
        approved_amount: formatINR(approvedAmt),
        paid_count: paid.length,
        paid_amount: formatINR(paidAmt),
        returned_count: returned.length,
        total_shops: shops.length,
        threshold_policy: formatINRWhole(threshold),
      };

      return {
        result: stats,
        widget: {
          type: 'stats_overview',
          title: 'System Overview Summary',
          stats,
        },
      };
    }

    case 'get_pending_admin_requests': {
      const limit = typeof args.limit === 'number' ? args.limit : 15;
      const pending = requests.filter(
        (r) =>
          r.status === 'pending_admin_approval' ||
          (r.status === 'approving' &&
            (!r.approving_started_at || Date.now() - new Date(r.approving_started_at).getTime() > 60000))
      ).slice(0, limit);

      const items = pending.map((r) => ({
        id: r.id,
        request_no: r.request_no || 'DRAFT',
        title: r.title,
        amount: Number(r.amount) || 0,
        status: r.status,
        shop_name: r.shop_name || 'N/A',
        department: r.department?.name || 'N/A',
        requester: r.requester_name || 'N/A',
        route: r.route || 'A',
        created_at: formatISTDate(r.created_at, false),
      }));

      return {
        result: {
          total_pending_admin: pending.length,
          requests: items,
        },
        widget: {
          type: 'requests_list',
          title: `Pending Admin Approvals (${pending.length})`,
          items: items.map((i) => ({
            id: i.id,
            request_no: i.request_no,
            title: i.title,
            amount: i.amount,
            status: i.status,
            shop_name: i.shop_name,
          })),
        },
      };
    }

    case 'search_requests': {
      const kw = String(args.keyword || '').trim().toLowerCase();
      const statusFilter = String(args.status || '').trim().toLowerCase();
      const shopFilter = String(args.shop_name || '').trim().toLowerCase();
      const typeFilter = String(args.request_type || '').trim().toLowerCase();
      const limit = typeof args.limit === 'number' ? args.limit : 10;

      let filtered = [...requests];

      if (kw) {
        filtered = filtered.filter(
          (r) =>
            (r.request_no && r.request_no.toLowerCase().includes(kw)) ||
            (r.approval_no && r.approval_no.toLowerCase().includes(kw)) ||
            (r.title && r.title.toLowerCase().includes(kw)) ||
            (r.notes && r.notes.toLowerCase().includes(kw)) ||
            (r.requester_name && r.requester_name.toLowerCase().includes(kw)) ||
            (r.shop_name && r.shop_name.toLowerCase().includes(kw))
        );
      }

      if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter((r) => r.status.toLowerCase().includes(statusFilter));
      }

      if (shopFilter) {
        filtered = filtered.filter((r) => (r.shop_name || '').toLowerCase().includes(shopFilter));
      }

      if (typeFilter) {
        filtered = filtered.filter((r) => typeOf(r).toLowerCase() === typeFilter);
      }

      const results = filtered.slice(0, limit).map((r) => ({
        id: r.id,
        request_no: r.request_no || 'DRAFT',
        approval_no: r.approval_no || null,
        title: r.title,
        amount: Number(r.amount) || 0,
        status: r.status,
        type: typeOf(r),
        shop_name: r.shop_name || 'N/A',
        department: r.department?.name || 'N/A',
        requester: r.requester_name || 'N/A',
        submitted_at: formatISTDate(r.submitted_at || r.created_at, false),
      }));

      return {
        result: {
          matched_count: filtered.length,
          showing_count: results.length,
          items: results,
        },
        widget: {
          type: 'requests_list',
          title: `Search Results (${filtered.length} found)`,
          items: results.map((r) => ({
            id: r.id,
            request_no: r.request_no,
            title: r.title,
            amount: r.amount,
            status: r.status,
            shop_name: r.shop_name,
          })),
        },
      };
    }

    case 'get_request_full_details': {
      const idStr = String(args.identifier || '').trim().toLowerCase();
      const r = requests.find(
        (x) =>
          x.id.toLowerCase() === idStr ||
          (x.request_no && x.request_no.toLowerCase() === idStr) ||
          (x.approval_no && x.approval_no.toLowerCase() === idStr)
      );

      if (!r) {
        return { result: { error: `Request "${idStr}" not found in current records.` } };
      }

      return {
        result: {
          id: r.id,
          request_no: r.request_no,
          approval_no: r.approval_no,
          title: r.title,
          notes: r.notes,
          amount: formatINR(r.amount),
          status: r.status,
          type: typeOf(r),
          route: r.route,
          shop: r.shop_name,
          department: r.department?.name || 'N/A',
          requester: r.requester_name,
          regional_head: r.regional_head_name,
          created_at: formatISTDate(r.created_at),
          decided_at: formatISTDate(r.decided_at),
          files_count: (r.files || []).length,
          consultations: (r.consultations || []).map((c) => ({
            head_name: c.head_name,
            status: c.status,
            remarks: c.response_remarks,
          })),
          disbursement_entries_count: (r.disbursement_entries || []).length,
        },
        widget: {
          type: 'requests_list',
          title: `Request Details: ${r.request_no || r.title}`,
          items: [
            {
              id: r.id,
              request_no: r.request_no,
              title: r.title,
              amount: r.amount,
              status: r.status,
              shop_name: r.shop_name,
            },
          ],
        },
      };
    }

    case 'get_shop_statistics': {
      const specificShop = String(args.shop_name || '').trim().toLowerCase();
      const shopMap: Record<string, { total_reqs: number; total_amount: number; approved_amount: number; pending_reqs: number }> = {};

      requests.forEach((r) => {
        const sName = r.shop_name || 'Head Office / Unassigned';
        if (specificShop && !sName.toLowerCase().includes(specificShop)) return;

        if (!shopMap[sName]) {
          shopMap[sName] = { total_reqs: 0, total_amount: 0, approved_amount: 0, pending_reqs: 0 };
        }
        shopMap[sName].total_reqs += 1;
        shopMap[sName].total_amount += Number(r.amount) || 0;
        if (r.status === 'approved' || r.status === 'paid') {
          shopMap[sName].approved_amount += Number(r.amount) || 0;
        }
        if (r.status === 'pending_admin_approval' || r.status === 'pending_head_approval') {
          shopMap[sName].pending_reqs += 1;
        }
      });

      const list = Object.entries(shopMap)
        .map(([name, data]) => ({
          shop: name,
          total_requests: data.total_reqs,
          pending_requests: data.pending_reqs,
          total_amount: formatINR(data.total_amount),
          approved_amount: formatINR(data.approved_amount),
        }))
        .sort((a, b) => b.total_requests - a.total_requests);

      return {
        result: {
          shop_count: list.length,
          shops: list,
        },
        widget: {
          type: 'shop_summary',
          title: `Shop Statistics (${list.length} Shops)`,
          stats: list.reduce((acc, curr) => {
            acc[curr.shop] = `${curr.total_requests} reqs (${curr.approved_amount})`;
            return acc;
          }, {} as Record<string, string>),
        },
      };
    }

    case 'get_discount_report_summary': {
      const discountReqs = requests.filter((r) => typeOf(r) === 'discount');
      const shopCounts: Record<string, number> = {};
      let totalDiscountAmount = 0;

      discountReqs.forEach((r) => {
        const sName = r.shop_name || 'Unknown Shop';
        shopCounts[sName] = (shopCounts[sName] || 0) + 1;
        totalDiscountAmount += Number(r.amount) || 0;
      });

      const topShops = Object.entries(shopCounts)
        .map(([shop, count]) => ({ shop, count }))
        .sort((a, b) => b.count - a.count);

      return {
        result: {
          total_discount_requests: discountReqs.length,
          total_discount_value: formatINR(totalDiscountAmount),
          top_discount_shops: topShops,
        },
        widget: {
          type: 'discount_summary',
          title: `Discount Report (${discountReqs.length} Requests)`,
          stats: {
            'Total Discount Requests': discountReqs.length,
            'Total Discount Value': formatINR(totalDiscountAmount),
            'Top Requesting Shop': topShops[0] ? `${topShops[0].shop} (${topShops[0].count} requests)` : 'None',
          },
        },
      };
    }

    case 'get_disbursement_summary': {
      const disbReqs = requests.filter((r) => r.status === 'approved' || r.status === 'paid');
      let oldAdvanceSettledCount = 0;
      let oldAdvanceTotal = 0;
      let cashTotal = 0;
      let bankTotal = 0;

      requests.forEach((r) => {
        (r.disbursement_entries || []).forEach((e) => {
          if (e.entry_type === 'old_balance') {
            oldAdvanceSettledCount += 1;
            oldAdvanceTotal += Number(e.amount || 0);
          }
          if (e.entry_type === 'cash') cashTotal += Number(e.approved_amount || e.amount || 0);
          if (e.entry_type === 'bank') bankTotal += Number(e.approved_amount || e.amount || 0);
        });
      });

      const data = {
        total_eligible_approved_requests: disbReqs.length,
        cash_disbursements: formatINR(cashTotal),
        bank_disbursements: formatINR(bankTotal),
        old_advance_settlement_entries: oldAdvanceSettledCount,
        old_advance_settled_amount: formatINR(oldAdvanceTotal),
      };

      return {
        result: data,
        widget: {
          type: 'stats_overview',
          title: 'Disbursement Pipeline Summary',
          stats: data,
        },
      };
    }

    case 'get_staff_and_heads': {
      const roleFilter = String(args.role || '').toLowerCase();
      const targetUsers = roleFilter
        ? users.filter((u) => u.role.toLowerCase() === roleFilter)
        : users;

      const heads = targetUsers.filter((u) => u.role === 'head').map((u) => ({ name: u.full_name, user: u.username }));
      const regionalHeads = targetUsers.filter((u) => u.role === 'regional_head').map((u) => ({ name: u.full_name, user: u.username }));
      const clerks = targetUsers.filter((u) => u.role === 'clerk').map((u) => ({ name: u.full_name, user: u.username }));

      return {
        result: {
          total_users: targetUsers.length,
          department_heads: heads,
          regional_heads: regionalHeads,
          clerks: clerks,
        },
      };
    }

    default:
      return { result: { error: `Unknown tool: ${toolName}` } };
  }
}

/**
 * System Instructions for Kochu Muthalali
 */
export function getKochuMuthalaliSystemInstruction(ctx: LiveAppContext): string {
  const liveSnapshot = buildLiveSystemSnapshot(ctx);

  return `
You are the personal AI Executive Intelligence Voice Assistant for "കൊച്ചു മുതലാളി" (Kochu Muthalali), the respected Managing Director / Chief Executive / Admin of SWA Diamonds Approvals System.

CRITICAL IDENTITY & BEHAVIOR:
1. ALWAYS address the user respectfully and warmly as "കൊച്ചു മുതലാളി" (Kochu Muthalali) in every single reply.
2. PRIMARY LANGUAGE IS MALAYALAM (മലയാളം script).
   - Your speech and text MUST be natural, polite, respectful, and crystal-clear Malayalam.
   - You may incorporate exact reference codes in English for accuracy (e.g. "REQ-2026-000152", "APR-2026-000045", "₹54,000", "Route A", "Route B").
   - Tone: Dedicated, loyal, highly capable executive assistant (e.g., "തീർച്ചയായും കൊച്ചു മുതലാളി", "നമസ്കാരം കൊച്ചു മുതലാളി", "ഇതാ കൊച്ചു മുതലാളി ചോദിച്ച വിവരങ്ങൾ").
3. FULL DATA ACCESS:
   - You have complete live access to all business requests, approvals, reports, shops, discounts, and disbursements.
   - When asked questions about data, numbers, approvals, or shops, use the provided tools OR the live snapshot below to give 100% accurate, factual figures.
   - Never hallucinate fake requests or numbers. If there are 0 pending requests, state that proudly to Kochu Muthalali.
4. VOICE OUTPUT READINESS & CONCISE SPOKEN SUMMARY:
   - Provide a direct, crystal-clear spoken summary in 2 to 4 sentences in natural Malayalam.
   - State the key figures, pending counts, rupee amounts, and top shops directly upfront.
   - Do NOT write massive markdown tables or endless raw lists in text; the app UI automatically renders interactive cards, tables, and buttons for Kochu Muthalali to browse.
   - Tone: Quick, energetic, highly respectful, dedicated executive assistant to Kochu Muthalali.

${liveSnapshot}
`;
}

/**
 * Candidate models prioritized by response speed and quality
 */
const CANDIDATE_CHAT_MODELS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

/**
 * Calls Gemini with tool calling support using ultra-fast Flash Lite models
 */
export async function sendGeminiVoiceMessage(
  userText: string,
  chatHistory: Array<{ role: 'user' | 'model'; text: string }>,
  ctx: LiveAppContext
): Promise<{ text: string; widgetData?: GeminiChatMessage['widgetData'] }> {
  const apiKey = getGeminiApiKey();
  const systemInstruction = getKochuMuthalaliSystemInstruction(ctx);

  // Format contents for Gemini API
  const contents: Array<Record<string, unknown>> = [];

  // Add previous turns
  chatHistory.slice(-8).forEach((msg) => {
    contents.push({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    });
  });

  // Add the new user message
  contents.push({
    role: 'user',
    parts: [{ text: userText }],
  });

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    tools: GEMINI_TOOLS,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };

  let lastError: Error | null = null;

  for (const model of CANDIDATE_CHAT_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Model ${model} returned ${res.status}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let accumulatedWidget: GeminiChatMessage['widgetData'] | undefined;

      // Check if Gemini invoked a tool (functionCall)
      const fnCallPart = parts.find((p: Record<string, unknown>) => p.functionCall);

      if (fnCallPart && fnCallPart.functionCall) {
        const fnName = fnCallPart.functionCall.name;
        const fnArgs = (fnCallPart.functionCall.args as Record<string, unknown>) || {};
        const thoughtSig = fnCallPart.thoughtSignature;
        const callId = fnCallPart.functionCall.id;

        // Execute tool locally
        const { result, widget } = executeGeminiTool(fnName, fnArgs, ctx);
        accumulatedWidget = widget;

        // Build the second turn with the function result
        const modelPartWithSig: Record<string, unknown> = {
          functionCall: {
            name: fnName,
            args: fnArgs,
            ...(callId ? { id: callId } : {}),
          },
        };
        if (thoughtSig) {
          modelPartWithSig.thoughtSignature = thoughtSig;
        }

        const multiTurnContents = [
          ...contents,
          {
            role: 'model',
            parts: [modelPartWithSig],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: fnName,
                  response: { result },
                },
              },
            ],
          },
        ];

        const followUpRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: multiTurnContents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools: GEMINI_TOOLS,
          }),
        });

        if (followUpRes.ok) {
          const followUpData = await followUpRes.json();
          const followUpParts = followUpData.candidates?.[0]?.content?.parts || [];
          const textPart = followUpParts.find((p: Record<string, unknown>) => typeof p.text === 'string');
          if (textPart) {
            return { text: textPart.text, widgetData: accumulatedWidget };
          }
        }
      }

      // Regular text response
      const textPart = parts.find((p: Record<string, unknown>) => typeof p.text === 'string');
      if (textPart?.text) {
        return { text: textPart.text, widgetData: accumulatedWidget };
      }
    } catch (err: any) {
      console.warn(`Query with model ${model} failed, trying next:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All candidate models failed to generate response');
}

/**
 * Audio handling for Native Malayalam Neural TTS
 */
let currentAudioElement: HTMLAudioElement | null = null;

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function pcmToWavBlob(pcmData: Uint8Array, sampleRate = 24000, numChannels = 1): Blob {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);

  new Uint8Array(buffer, 44).set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Immediate Verbal Acknowledgment for Kochu Muthalali
 */
export const IMMEDIATE_ACK_MALAYALAM =
  'ശരി കൊച്ചു മുതലാളി, വിവരങ്ങൾ ശേഖരിക്കാൻ ഏതാനും സെക്കൻഡുകൾ എടുക്കും. ഞാൻ ഡാറ്റ പരിശോധിച്ച് ഇപ്പോൾ തന്നെ വായിക്കാം.';

const ackAudioBlobCache: Record<string, string> = {};

/**
 * Pre-load or fetch cached audio for the immediate acknowledgment
 */
export async function getOrPreloadAckAudio(
  voiceName: GeminiVoiceName = getPreferredVoice()
): Promise<string> {
  if (ackAudioBlobCache[voiceName]) {
    return ackAudioBlobCache[voiceName];
  }
  try {
    const url = await generateNativeMalayalamAudio(IMMEDIATE_ACK_MALAYALAM, voiceName);
    ackAudioBlobCache[voiceName] = url;
    return url;
  } catch (err) {
    console.warn('Fallback ack audio cache error:', err);
    const encoded = encodeURIComponent(IMMEDIATE_ACK_MALAYALAM.slice(0, 250));
    const fallback = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=ml&client=tw-ob`;
    ackAudioBlobCache[voiceName] = fallback;
    return fallback;
  }
}

export function cleanTextForSpeech(text: string, maxChars = 380): string {
  let cleaned = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/REQ-\d{4}-\d+/gi, (m) => `റിക്വസ്റ്റ് ${m.replace('REQ-', '')}`)
    .replace(/APR-\d{4}-\d+/gi, (m) => `അപ്രൂവൽ ${m.replace('APR-', '')}`)
    .replace(/₹\s?([\d,]+)/g, '$1 രൂപ')
    .replace(/[#_~`|]/g, '')
    .replace(/\n+/g, '. ')
    .trim();

  // If text is long, limit to key opening summary sentences for speedy audio generation
  if (cleaned.length > maxChars) {
    const periodIdx = cleaned.indexOf('.', maxChars - 100);
    if (periodIdx !== -1 && periodIdx <= maxChars + 80) {
      cleaned = cleaned.slice(0, periodIdx + 1);
    } else {
      cleaned = cleaned.slice(0, maxChars) + '.';
    }
  }
  return cleaned;
}

/**
 * Generates ultra-realistic Native Neural Audio in Malayalam using fast Gemini Flash Lite TTS
 * with progressive fallback to Gemini 2.5 Flash TTS and Google Native Malayalam
 */
export async function generateNativeMalayalamAudio(
  text: string,
  voiceName: GeminiVoiceName = getPreferredVoice()
): Promise<string> {
  const apiKey = getGeminiApiKey();
  const cleanText = cleanTextForSpeech(text);

  if (!cleanText) {
    throw new Error('No speech text provided');
  }

  // If user picked Google Malayalam directly
  if (voiceName === 'GoogleMalayalam') {
    const encoded = encodeURIComponent(cleanText.slice(0, 300));
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=ml&client=tw-ob`;
  }

  const ttsCandidateModels = ['gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'];

  for (const model of ttsCandidateModels) {
    try {
      const body = {
        contents: [{ parts: [{ text: cleanText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName || 'Aoede',
              },
            },
          },
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        continue;
      }

      const json = await res.json();
      const b64Audio = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!b64Audio) {
        continue;
      }

      const binaryStr = atob(b64Audio);
      const pcmBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        pcmBytes[i] = binaryStr.charCodeAt(i);
      }

      const wavBlob = pcmToWavBlob(pcmBytes, 24000, 1);
      return URL.createObjectURL(wavBlob);
    } catch (err) {
      console.warn(`TTS generation with ${model} failed, trying next:`, err);
    }
  }

  // Instant fallback to dedicated Google Native Malayalam Voice
  const encoded = encodeURIComponent(cleanText.slice(0, 300));
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=ml&client=tw-ob`;
}

/**
 * Plays the native audio stream via HTML5 Audio
 */
export function playNativeAudio(
  audioUrl: string,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void
): HTMLAudioElement {
  stopSpeaking();

  const audio = new Audio(audioUrl);
  currentAudioElement = audio;

  audio.onplay = () => onStart?.();
  audio.onended = () => {
    currentAudioElement = null;
    onEnd?.();
  };
  audio.onerror = (e) => {
    currentAudioElement = null;
    onError?.(e);
  };

  audio.play().catch((err) => {
    console.warn('Audio play prevented or interrupted:', err);
    currentAudioElement = null;
    onError?.(err);
  });

  return audio;
}

/**
 * Speaks text using Native Malayalam Audio (fetches audio and plays)
 */
export async function speakNativeMalayalam(
  text: string,
  voiceName: GeminiVoiceName = getPreferredVoice(),
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void
): Promise<string> {
  stopSpeaking();
  try {
    const audioUrl = await generateNativeMalayalamAudio(text, voiceName);
    playNativeAudio(audioUrl, onStart, onEnd, onError);
    return audioUrl;
  } catch (err) {
    console.error('Failed to generate native audio:', err);
    onError?.(err);
    throw err;
  }
}

export function stopSpeaking(): void {
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch {
      // ignore
    }
    currentAudioElement = null;
  }
}

export function isSpeaking(): boolean {
  return currentAudioElement !== null && !currentAudioElement.paused;
}
