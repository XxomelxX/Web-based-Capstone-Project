// Xendit server helper — secret key never leaves the server.
// Supports both legacy /ewallets/charges and current /payment_requests for GCash.

const XENDIT_API_BASE = 'https://api.xendit.co';

function getSecretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new Error('XENDIT_SECRET_KEY is not configured');
  return key;
}

function authHeader(): Record<string, string> {
  const key = getSecretKey();
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

export interface XenditChargeResult {
  paymentId: string;
  referenceId: string;
  status: string;
  checkoutUrl?: string;
  raw: unknown;
}

function extractCheckoutUrl(data: Record<string, unknown>): string | undefined {
  // Legacy shape: actions.desktop_web_checkout_url / mobile_web_checkout_url
  const actions = data.actions as Record<string, unknown> | undefined;
  if (actions && typeof actions === 'object') {
    if (typeof actions.desktop_web_checkout_url === 'string') return actions.desktop_web_checkout_url;
    if (typeof actions.mobile_web_checkout_url === 'string') return actions.mobile_web_checkout_url;
  }
  // v3 shape: actions[].type === REDIRECT_CUSTOMER
  if (Array.isArray(data.actions)) {
    for (const a of data.actions as Array<Record<string, unknown>>) {
      if (a.type === 'REDIRECT_CUSTOMER' && typeof a.value === 'string') return a.value;
      if (a.type === 'REDIRECT_CUSTOMER' && typeof a.url === 'string') return a.url as string;
    }
  }
  return undefined;
}

/** Create a one-time GCash charge. referenceId must be our clientUuid for idempotency. */
export async function createGcashCharge(args: {
  referenceId: string;
  amount: number;
  successReturnUrl?: string;
  failureReturnUrl?: string;
}): Promise<XenditChargeResult> {
  // Prefer Payment Requests API (matches PAYMENT REQUESTS V2 webhooks in current dashboards).
  try {
    return await createGcashPaymentRequest(args);
  } catch (err) {
    // Fallback to legacy eWallet endpoint for older accounts.
    if (err instanceof Error && /channel|not enabled|404/i.test(err.message)) {
      return createGcashEwalletCharge(args);
    }
    throw err;
  }
}

async function createGcashEwalletCharge(args: {
  referenceId: string;
  amount: number;
  successReturnUrl?: string;
  failureReturnUrl?: string;
}): Promise<XenditChargeResult> {
  const body = {
    reference_id: args.referenceId,
    currency: 'PHP',
    amount: Math.round(args.amount * 100) / 100,
    checkout_method: 'ONE_TIME_PAYMENT',
    channel_code: 'PH_GCASH',
    channel_properties: {
      success_redirect_url: args.successReturnUrl ?? process.env.XENDIT_SUCCESS_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
      failure_redirect_url: args.failureReturnUrl ?? process.env.XENDIT_FAILURE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
    },
  };

  const res = await fetch(`${XENDIT_API_BASE}/ewallets/charges`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : `Xendit charge failed (${res.status})`;
    throw new Error(msg);
  }
  const paymentId = typeof data.id === 'string' ? data.id : '';
  return {
    paymentId,
    referenceId: args.referenceId,
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    checkoutUrl: extractCheckoutUrl(data),
    raw: data,
  };
}

async function createGcashPaymentRequest(args: {
  referenceId: string;
  amount: number;
  successReturnUrl?: string;
  failureReturnUrl?: string;
}): Promise<XenditChargeResult> {
  const body = {
    reference_id: args.referenceId,
    type: 'PAY',
    country: 'PH',
    currency: 'PHP',
    request_amount: Math.round(args.amount * 100) / 100,
    channel_code: 'GCASH',
    channel_properties: {
      success_return_url: args.successReturnUrl ?? process.env.XENDIT_SUCCESS_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
      failure_return_url: args.failureReturnUrl ?? process.env.XENDIT_FAILURE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
    },
  };
  const res = await fetch(`${XENDIT_API_BASE}/payment_requests`, {
    method: 'POST',
    headers: { ...authHeader(), 'api-version': '2024-11-11' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.message === 'string' ? data.message : `Xendit payment request failed (${res.status})`;
    throw new Error(msg);
  }
  const paymentId =
    typeof data.payment_id === 'string' ? data.payment_id
    : typeof data.id === 'string' ? data.id : '';
  return {
    paymentId,
    referenceId: args.referenceId,
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    checkoutUrl: extractCheckoutUrl(data),
    raw: data,
  };
}

/** Fetch latest charge status (legacy). Returns null when not found. */
export async function getEwalletChargeStatus(paymentId: string): Promise<{ status: string; raw: unknown } | null> {
  const res = await fetch(`${XENDIT_API_BASE}/ewallets/charges/${encodeURIComponent(paymentId)}`, {
    headers: authHeader(),
  });
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Xendit status lookup failed (${res.status})`);
  return { status: typeof data.status === 'string' ? data.status : 'PENDING', raw: data };
}

export function verifyCallbackToken(token: string | null): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN;
  if (!expected) return false;
  return token === expected;
}

/** Normalize Xendit statuses to our Transaction.xenditStatus vocabulary. */
export function normalizeXenditStatus(s: string): 'PENDING' | 'REQUIRES_ACTION' | 'SUCCEEDED' | 'FAILED' {
  const u = s.toUpperCase();
  if (u === 'SUCCEEDED' || u === 'COMPLETED' || u === 'PAID' || u === 'SUCCESSFUL') return 'SUCCEEDED';
  if (u === 'FAILED' || u === 'EXPIRED' || u === 'CANCELLED' || u === 'VOIDED') return 'FAILED';
  if (u === 'REQUIRES_ACTION' || u === 'PENDING_ACTION') return 'REQUIRES_ACTION';
  return 'PENDING';
}
