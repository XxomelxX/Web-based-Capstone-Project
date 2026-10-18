// One-off: time dashboard routes on the running dev server (twice each —
// first = includes webpack compile in dev, second = warm).
const routes = ['dashboard', 'products', 'orders', 'credit', 'reports', 'expenses'];
for (const r of routes) {
  const times = [];
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(`http://localhost:3000/${r}`, { redirect: 'manual' });
      await res.arrayBuffer();
      times.push(`${Math.round(performance.now() - t0)}ms (HTTP ${res.status})`);
    } catch (e) {
      times.push('FAIL ' + e?.message);
    }
  }
  console.log(`${r.padEnd(10)} first=${times[0]}  second=${times[1]}`);
}
// Reference: a tiny static-ish route and an API health endpoint
for (const p of ['login', 'api/health']) {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://localhost:3000/${p}`, { redirect: 'manual' });
    await res.arrayBuffer();
    console.log(`${p.padEnd(10)} ${Math.round(performance.now() - t0)}ms (HTTP ${res.status})`);
  } catch (e) {
    console.log(`${p} FAIL ${e?.message}`);
  }
}
