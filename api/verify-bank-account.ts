// Vercel Serverless Function: Bank Account Penny-Less Verification via Sandbox.co.in
export const config = {
  runtime: 'nodejs',
};

const SANDBOX_API_KEY = process.env.SANDBOX_API_KEY || 'key_live_e7e42f3954444f1db9418f64d16ccad1';
const SANDBOX_API_SECRET = process.env.SANDBOX_API_SECRET || 'secret_live_f2c8e2f27dca4ca8bfa1653389d4bd61';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getSandboxToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const res = await fetch('https://api.sandbox.co.in/authenticate', {
    method: 'POST',
    headers: {
      'x-api-key': SANDBOX_API_KEY,
      'x-api-secret': SANDBOX_API_SECRET,
      'x-api-version': '1.0.0',
      'Content-Type': 'application/json',
    },
  });
  const data = (await res.json()) as any;
  const token = data.data?.access_token || data.access_token;
  if (!token) throw new Error(data.message || 'Authentication failed with Sandbox');
  cachedToken = token;
  tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
  return token;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end('ok');
  }

  try {
    let ifsc = '';
    let accountNumber = '';

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      ifsc = body.ifsc || '';
      accountNumber = body.account_number || body.account_no || '';
    } else {
      ifsc = (req.query?.ifsc as string) || '';
      accountNumber = (req.query?.account_number as string) || (req.query?.account_no as string) || '';
    }

    const cleanIfsc = (ifsc || '').trim().toUpperCase();
    const cleanAcc = (accountNumber || '').trim();

    if (!cleanIfsc || !cleanAcc) {
      return res.status(400).json({
        success: false,
        account_exists: false,
        message: 'Bank account number and IFSC are required',
      });
    }

    const token = await getSandboxToken();

    // 1. Fetch bank and branch details
    let bankName = '';
    let branchName = '';
    let city = '';
    let state = '';

    try {
      const bRes = await fetch(`https://api.sandbox.co.in/bank/${cleanIfsc}`, {
        headers: {
          authorization: token,
          'x-api-key': SANDBOX_API_KEY,
          'x-api-version': '1.0.0',
        },
      });
      if (bRes.ok) {
        const bData = (await bRes.json()) as any;
        bankName = bData.BANK || '';
        branchName = bData.BRANCH || '';
        city = bData.CITY || '';
        state = bData.STATE || '';
      }
    } catch (err) {
      console.warn('Sandbox IFSC lookup warning:', err);
    }

    // Fallback to Razorpay IFSC API if Sandbox lookup did not populate
    if (!bankName) {
      try {
        const rRes = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`);
        if (rRes.ok) {
          const rData = (await rRes.json()) as any;
          bankName = rData.BANK || '';
          branchName = rData.BRANCH || '';
          city = rData.CITY || '';
          state = rData.STATE || '';
        }
      } catch {}
    }

    // 2. Penny-less bank account verification
    const vRes = await fetch(
      `https://api.sandbox.co.in/bank/${cleanIfsc}/accounts/${cleanAcc}/penniless-verify`,
      {
        headers: {
          authorization: token,
          'x-api-key': SANDBOX_API_KEY,
          'x-api-version': '1.0.0',
          'x-accept-cache': 'true',
        },
      }
    );
    const vData = (await vRes.json()) as any;

    const accountExists = Boolean(vData.code === 200 && vData.data?.account_exists === true);
    const nameAtBank = vData.data?.name_at_bank || '';
    const message =
      vData.data?.message ||
      vData.message ||
      (accountExists ? 'Bank Account details verified successfully.' : 'Invalid account number or IFSC provided');

    return res.status(200).json({
      success: accountExists,
      account_exists: accountExists,
      name_at_bank: nameAtBank,
      bank_name: bankName,
      branch: branchName,
      city,
      state,
      message,
      raw: vData,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      account_exists: false,
      message: error?.message || 'Verification service error',
    });
  }
}
