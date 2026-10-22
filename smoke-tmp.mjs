import { encode } from 'next-auth/jwt';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
);

async function tokenFor(user) {
  return encode({
    token: { name: user.name, email: user.email, role: user.role, id: user.id, sub: user.id, checkedAt: Date.now() },
    secret: env.NEXTAUTH_SECRET, maxAge: 8 * 60 * 60,
  });
}
const admin = await tokenFor({ name: 'Romel Premacio', email: 'romelpremacio@gmail.com', role: 'admin', id: '1' });
const cashier = await tokenFor({ name: 'romel', email: 'romel@example.com', role: 'cashier', id: '12' });
const cookie = (t) => `__Secure-next-auth.session-token=${t}; next-auth.session-token=${t}`;

const BASE = 'http://localhost:3000';

// GET routes: read-only.
const GETS = [
  '/api/health', '/api/categories', '/api/customers', '/api/expenses', '/api/inventory/batches?productId=224',
  '/api/itemlog', '/api/lowstock', '/api/products', '/api/reports', '/api/reports/chart-data?range=all',
  '/api/settings', '/api/shift', '/api/shift/active-shifts', '/api/shift/cash-movement', '/api/shift/history',
  '/api/sync/pull', '/api/transactions', '/api/users', '/api/utang', '/api/void-requests',
];
// POST routes: deliberately invalid payloads -> they must reject with 4xx and write nothing.
const POSTS = [
  '/api/auth/forgot-password', '/api/auth/reset-password', '/api/categories', '/api/customers',
  '/api/expenses', '/api/inventory/adjust', '/api/pos/checkout', '/api/products', '/api/restock',
  '/api/shift', '/api/shift/cash-movement', '/api/sync', '/api/users', '/api/utang',
  '/api/utang/payment', '/api/void-requests',
];
// PATCH/DELETE on a non-existent id -> must 404 and write nothing.
const ID_MISSING = [
  ['PATCH', '/api/categories/999999'], ['PATCH', '/api/customers/999999'], ['PATCH', '/api/products/999999'],
  ['PATCH', '/api/utang/999999'], ['DELETE', '/api/categories/999999'], ['DELETE', '/api/customers/999999'],
  ['DELETE', '/api/products/999999'], ['DELETE', '/api/utang/999999'],
  ['DELETE', '/api/void-requests/999999/cancel'], ['DELETE', '/api/void-requests/999999/review'],
  ['GET', '/api/transactions/999999/void'],
];

async function call(method, path, body, tok) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: cookie(tok) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, text: text.slice(0, 220) };
  } catch (e) {
    return { status: 'ERR', ms: Date.now() - t0, text: String(e && e.message) };
  }
}

const problems = [];
console.log('=== GET (admin) ===');
for (const p of GETS) {
  const r = await call('GET', p, undefined, admin);
  const flag = r.status === 200 ? 'ok  ' : (r.status === 401 || r.status === 403 ? 'auth ' : 'FAIL');
  if (flag === 'FAIL') problems.push(`GET ${p} -> ${r.status} ${r.text}`);
  console.log(`${flag} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${p}`);
  if (r.status === 200 && /error|exception|prisma|not a valid|undefined is not/i.test(r.text)) {
    problems.push(`GET ${p} -> 200 but body looks wrong: ${r.text.slice(0, 120)}`);
  }
}

console.log('\n=== POST with invalid payload (expect 4xx, no writes) ===');
for (const p of POSTS) {
  const r = await call('POST', p, {}, admin);
  const ok = r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 409;
  if (!ok) problems.push(`POST ${p} {} -> ${r.status} ${r.text}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${p}`);
}

console.log('\n=== PATCH/DELETE on a missing id (expect 404) ===');
for (const [method, p] of ID_MISSING) {
  const r = await call(method, p, method === 'PATCH' ? {} : undefined, admin);
  const ok = r.status === 404 || r.status === 400 || r.status === 405;
  if (!ok) problems.push(`${method} ${p} -> ${r.status} ${r.text}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${method} ${p}`);
}

console.log('\n=== role gates: a CASHIER must be refused on admin-only routes ===');
const ADMIN_ONLY = [
  ['GET', '/api/users'], ['GET', '/api/shift/active-shifts'], ['PATCH', '/api/categories/1'],
  ['POST', '/api/products'], ['DELETE', '/api/products/1'], ['GET', '/api/shift/history'],
];
for (const [method, p] of ADMIN_ONLY) {
  const r = await call(method, p, method === 'POST' || method === 'PATCH' ? {} : undefined, cashier);
  const refused = r.status === 403 || r.status === 401;
  console.log(`${refused ? 'ok  ' : 'note'} ${String(r.status).padEnd(4)} ${method} ${p} (cashier)`);
  if (!refused) problems.push(`role gate: cashier got ${r.status} on ${method} ${p}`);
}

console.log('\n=== unauthenticated access must be refused ===');
for (const p of ['/api/products', '/api/shift', '/api/users', '/api/utang', '/api/transactions']) {
  const res = await fetch(BASE + p, { headers: { cookie: 'garbage=1' } });
  const refused = res.status === 401 || res.status === 307 || res.status === 302;
  console.log(`${refused ? 'ok  ' : 'FAIL'} ${String(res.status).padEnd(4)} ${p}`);
  if (!refused) problems.push(`unauthenticated GET ${p} -> ${res.status}`);
}

console.log('\n================ PROBLEMS ================');
if (problems.length === 0) console.log('none');
else for (const p of problems) console.log('-', p);
