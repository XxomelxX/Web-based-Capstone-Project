const fs = require('fs'), path = require('path');
function r(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) { r(p); }
    else if (f.endsWith('.js')) {
      try { const c = fs.readFileSync(p, 'utf8');
        if (c.includes('jwtVerify') || c.includes('importJWK') || c.includes('jose')) console.log(p); }
      catch (e) { /* ignore */ }
    }
  }
}
r('node_modules/next-auth');