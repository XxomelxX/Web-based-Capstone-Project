const fs=require('fs'),path=require('path');
function r(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())r(p);else if(f.includes('dist')&&f.endsWith('.js')){const c=fs.readFileSync(p,'utf8');if(c.includes('not supported by NextAuth'))console.log(p);}}}r('node_modules/next-auth');

