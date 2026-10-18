// One-off: warm-hit timing — same endpoints hit twice back-to-back.
import { encode } from 'next-auth/jwt';
const cookie = `next-auth.session-token=${await encode({
  token: { id: 1, sub: '1', name: 'diag', email: 'diag@example.com', role: 'admin' },
  secret: process.env.NEXTAUTH_SECRET, maxAge: 30 * 24 * 60 * 60,
})}`;
async function hit(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://localhost:3000${url}`, { headers: { cookie }, redirect: 'manual' });
    const body = await res.arrayBuffer();
    return `${Math.round(performance.now() - t0)}ms (HTTP ${res.status}, ${(body.length / 1024).toFixed(0)}KB)`;
  } catch (e) { return 'FAIL ' + (e?.message ?? e); }
}
for (const api of ['/api/products', '/api/transactions?limit=200', '/api/utang', '/api/expenses', '/api/shift/active-shifts', '/api/reports?range=all']) {
  console.log(api.padEnd(30), '1st:', await hit(api), '| 2nd:', await hit(api));
}
