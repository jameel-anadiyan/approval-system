import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

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

async function verifyBank(ifsc: string, accountNumber: string) {
  const cleanIfsc = (ifsc || '').trim().toUpperCase();
  const cleanAcc = (accountNumber || '').trim();

  if (!cleanIfsc || !cleanAcc) {
    return {
      success: false,
      account_exists: false,
      message: 'Account number and IFSC are required',
    };
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

  return {
    success: accountExists,
    account_exists: accountExists,
    name_at_bank: nameAtBank,
    bank_name: bankName,
    branch: branchName,
    city,
    state,
    message,
    raw: vData,
  };
}

function sandboxVerificationPlugin(): Plugin {
  return {
    name: 'sandbox-verification-plugin',
    configureServer(server) {
      server.middlewares.use('/api/verify-bank-account', async (req, res) => {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        let ifsc = url.searchParams.get('ifsc') || '';
        let accountNumber = url.searchParams.get('account_number') || url.searchParams.get('account_no') || '';

        if (req.method === 'POST') {
          let bodyStr = '';
          for await (const chunk of req) {
            bodyStr += chunk;
          }
          if (bodyStr) {
            try {
              const parsed = JSON.parse(bodyStr);
              ifsc = parsed.ifsc || ifsc;
              accountNumber = parsed.account_number || parsed.account_no || accountNumber;
            } catch {}
          }
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end('ok');
          return;
        }

        try {
          const result = await verifyBank(ifsc, accountNumber);
          res.statusCode = 200;
          res.end(JSON.stringify(result));
        } catch (error: any) {
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              success: false,
              account_exists: false,
              message: error?.message || 'Verification service error',
            })
          );
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), sandboxVerificationPlugin()],
});
