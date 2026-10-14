const fs = require('fs');
const p1 = 'node_modules/jose/dist/node/cjs/jwe/compact/index.js';
try { console.log('exists:', fs.existsSync(p1)); console.log(fs.statSync(p1).isSymbolicLink()); console.log(fs.readFileSync(p1, 'utf8').slice(0, 1500)); }
catch (e) { console.error('ERR', e.message); }
