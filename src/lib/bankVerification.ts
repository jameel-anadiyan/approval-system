import { supabase } from './supabase';

export interface BankVerificationResult {
  success: boolean;
  account_exists: boolean;
  name_at_bank: string;
  bank_name: string;
  branch: string;
  city?: string;
  state?: string;
  message?: string;
}

export const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;

export function isValidIfsc(ifsc: string): boolean {
  if (!ifsc) return false;
  return IFSC_REGEX.test(ifsc.trim());
}

export function isValidAccountNumber(accountNo: string): boolean {
  if (!accountNo) return false;
  const clean = accountNo.trim();
  // Valid bank account numbers in India are 9 to 18 digits, but Sandbox supports up to 40
  return clean.length >= 6 && clean.length <= 40;
}

// In-memory cache for recent verifications
const cache = new Map<string, BankVerificationResult>();

/**
 * Verify a bank account using Sandbox.co.in Penny-Less Verification API.
 * Calls local Vite/Vercel `/api/verify-bank-account` endpoint with Supabase Edge Function fallback.
 */
export async function verifyBankAccount(
  accountNumber: string,
  ifsc: string
): Promise<BankVerificationResult> {
  const cleanAcc = (accountNumber || '').trim();
  const cleanIfsc = (ifsc || '').trim().toUpperCase();

  if (!cleanIfsc) {
    return {
      success: false,
      account_exists: false,
      name_at_bank: '',
      bank_name: '',
      branch: '',
      message: 'Please enter an 11-digit IFSC code.',
    };
  }

  if (!isValidIfsc(cleanIfsc)) {
    return {
      success: false,
      account_exists: false,
      name_at_bank: '',
      bank_name: '',
      branch: '',
      message: 'Invalid IFSC code format. IFSC must be 11 characters (e.g. UTIB0002006).',
    };
  }

  if (!cleanAcc || !isValidAccountNumber(cleanAcc)) {
    return {
      success: false,
      account_exists: false,
      name_at_bank: '',
      bank_name: '',
      branch: '',
      message: 'Please enter a valid bank account number (6 to 40 digits).',
    };
  }

  const cacheKey = `${cleanIfsc}:::${cleanAcc}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // 1. Try local dev / Vercel API endpoint
  try {
    const res = await fetch(
      `/api/verify-bank-account?ifsc=${encodeURIComponent(cleanIfsc)}&account_number=${encodeURIComponent(cleanAcc)}`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (res.ok) {
      const data: BankVerificationResult = await res.json();
      cache.set(cacheKey, data);
      return data;
    }
  } catch (apiErr) {
    console.warn('Local /api/verify-bank-account fetch error, trying Supabase Edge Function...', apiErr);
  }

  // 2. Fallback to Supabase Edge Function if available
  try {
    const { data, error } = await supabase.functions.invoke<BankVerificationResult>('verify-bank-account', {
      body: { ifsc: cleanIfsc, account_number: cleanAcc },
    });

    if (!error && data) {
      cache.set(cacheKey, data);
      return data;
    }
  } catch (edgeErr) {
    console.warn('Supabase edge function fallback error:', edgeErr);
  }

  // 3. Fallback: Lookup IFSC details directly if Razorpay/public is reachable
  try {
    const ifscRes = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`);
    if (ifscRes.ok) {
      const ifscData = await ifscRes.json();
      const fallbackResult: BankVerificationResult = {
        success: false,
        account_exists: false,
        name_at_bank: '',
        bank_name: ifscData.BANK || '',
        branch: ifscData.BRANCH || '',
        city: ifscData.CITY || '',
        state: ifscData.STATE || '',
        message: 'Could not connect to Penny-Less verification service. Please re-check account number.',
      };
      return fallbackResult;
    }
  } catch {}

  return {
    success: false,
    account_exists: false,
    name_at_bank: '',
    bank_name: '',
    branch: '',
    message: 'Bank verification service unavailable. Please check your network connection.',
  };
}
