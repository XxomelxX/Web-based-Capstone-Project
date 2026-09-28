const fs = require('fs');
const sw = fs.readFileSync('public/sw.js', 'utf8');
const checks = {
  'precacheAndRoute present': sw.includes('precacheAndRoute'),
  'offline precached': sw.includes('/offline'),
  'start-url NetworkOnly': sw.includes('registerRoute("/",new e.NetworkOnly('),
  'no NetworkFirst on start-url': !sw.includes('registerRoute("/",new e.NetworkFirst('),
  'setCatchHandler fallback': sw.includes('setCatchHandler(self.fallback)'),
  'api/health NetworkOnly route': sw.includes('/api\\/health') || sw.includes('/api/health'),
  'fallback bundle imported': sw.includes('fallback-'),
  'skipWaiting+clientsClaim': sw.includes('skipWaiting') && sw.includes('clientsClaim'),
};
let fail = 0;
for (const [k, v] of Object.entries(checks)) {
  console.log((v ? 'PASS' : 'FAIL') + ': ' + k);
  if (!v) fail++;
}
// Every runtime route must have a fallback handler (offline safety)
const routes = (sw.match(/registerRoute\(/g) || []).length;
const fallbacks = (sw.match(/handlerDidError/g) || []).length;
console.log(`INFO: ${routes} registerRoute calls, ${fallbacks} handlerDidError fallbacks`);
console.log('SW size:', sw.length);
process.exit(fail ? 1 : 0);
