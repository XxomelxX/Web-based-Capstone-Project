// One-off: list $transaction( call sites and whether an options block
// (maxWait/timeout) follows within 45 lines.
import fs from 'node:fs';
for (const file of ['app/api/sync/route.ts', 'app/api/utang/route.ts', 'app/api/utang/payment/route.ts', 'app/api/shift/cash-movement/route.ts', 'app/api/customers/[id]/route.ts', 'app/api/restock/route.ts', 'lib/server/void-transaction.ts']) {
  const s = fs.readFileSync(file, 'utf8').split('\n');
  s.forEach((l, i) => {
    if (l.includes('$transaction(')) {
      const near = s.slice(i + 1, i + 45);
      const hasOpts = near.some((x) => /maxWait|timeout:/.test(x));
      console.log(`${file}:${i + 1} ${hasOpts ? 'HAS-OPTIONS' : 'NO-OPTIONS'}`);
    }
  });
}
