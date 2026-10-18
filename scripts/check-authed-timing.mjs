// One-off diagnostic: mint a next-auth v4 JWT locally (secret stays in .env —
// never printed) and measure AUTHED dashboard route loads on the running dev
// server, first-vs-second (dev compile warm-up) plus the client data
// endpoints each page's mount triggers.
import { encode } from 'next-auth/jwt';

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) { console.error('NEXTAUTH_SECRET missing'); process.exit(1); }
const token = await encode({
  token: { id: 1, sub: '1', name: 'diag', email: 'diag@example.com', role: 'admin' },
  secret,
  maxAge: 30 * 24 * 60 * 60,
});
const cookie = `next-auth.session-token=${token}`;

async function hit(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://localhost:3000${url}`, {
      headers: { cookie }, redirect: 'manual',
    });
    await res.arrayBuffer();
    return `${Math.round(performance.now() - t0)}ms (HTTP ${res.status})`;
  } catch (e) { return 'FAIL ' + (e?.message ?? e); }
}

for (const p of ['/dashboard', '/reports', '/orders', '/credit', '/products', '/expenses', '/dashboard', '/orders']) {
  console.log(p.padEnd(11), await hit(p));
}
for (const api of ['/api/reports?range=all', '/api/reports/chart-data?range=all', '/api/transactions?limit=200', '/api/utang', '/api/products', '/api/expenses', '/api/shift/active-shifts']) {
  console.log(api.padEnd(30), await hit(api));
}
