import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/common.ts";

const SANDBOX_API_KEY = Deno.env.get("SANDBOX_API_KEY") || "key_live_e7e42f3954444f1db9418f64d16ccad1";
const SANDBOX_API_SECRET = Deno.env.get("SANDBOX_API_SECRET") || "secret_live_f2c8e2f27dca4ca8bfa1653389d4bd61";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getSandboxToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const res = await fetch("https://api.sandbox.co.in/authenticate", {
    method: "POST",
    headers: {
      "x-api-key": SANDBOX_API_KEY,
      "x-api-secret": SANDBOX_API_SECRET,
      "x-api-version": "1.0.0",
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  const token = data.data?.access_token || data.access_token;
  if (!token) throw new Error(data.message || "Authentication failed with Sandbox");
  cachedToken = token;
  tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let ifsc = "";
    let accountNumber = "";

    if (req.method === "POST") {
      const body = await req.json();
      ifsc = body.ifsc || "";
      accountNumber = body.account_number || body.account_no || "";
    } else {
      const url = new URL(req.url);
      ifsc = url.searchParams.get("ifsc") || "";
      accountNumber = url.searchParams.get("account_number") || url.searchParams.get("account_no") || "";
    }

    const cleanIfsc = (ifsc || "").trim().toUpperCase();
    const cleanAcc = (accountNumber || "").trim();

    if (!cleanIfsc || !cleanAcc) {
      return new Response(
        JSON.stringify({
          success: false,
          account_exists: false,
          message: "Bank account number and IFSC are required",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const token = await getSandboxToken();

    // 1. Fetch bank and branch details
    let bankName = "";
    let branchName = "";
    let city = "";
    let state = "";

    try {
      const bRes = await fetch(`https://api.sandbox.co.in/bank/${cleanIfsc}`, {
        headers: {
          authorization: token,
          "x-api-key": SANDBOX_API_KEY,
          "x-api-version": "1.0.0",
        },
      });
      if (bRes.ok) {
        const bData = await bRes.json();
        bankName = bData.BANK || "";
        branchName = bData.BRANCH || "";
        city = bData.CITY || "";
        state = bData.STATE || "";
      }
    } catch {}

    if (!bankName) {
      try {
        const rRes = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`);
        if (rRes.ok) {
          const rData = await rRes.json();
          bankName = rData.BANK || "";
          branchName = rData.BRANCH || "";
          city = rData.CITY || "";
          state = rData.STATE || "";
        }
      } catch {}
    }

    // 2. Penny-less bank account verification
    const vRes = await fetch(
      `https://api.sandbox.co.in/bank/${cleanIfsc}/accounts/${cleanAcc}/penniless-verify`,
      {
        headers: {
          authorization: token,
          "x-api-key": SANDBOX_API_KEY,
          "x-api-version": "1.0.0",
          "x-accept-cache": "true",
        },
      }
    );
    const vData = await vRes.json();

    const accountExists = Boolean(vData.code === 200 && vData.data?.account_exists === true);
    const nameAtBank = vData.data?.name_at_bank || "";
    const message =
      vData.data?.message ||
      vData.message ||
      (accountExists ? "Bank Account details verified successfully." : "Invalid account number or IFSC provided");

    return new Response(
      JSON.stringify({
        success: accountExists,
        account_exists: accountExists,
        name_at_bank: nameAtBank,
        bank_name: bankName,
        branch: branchName,
        city,
        state,
        message,
        raw: vData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        account_exists: false,
        message: error?.message || "Verification service error",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
