const fs = require('fs');
const c = fs.readFileSync(process.argv[2], 'utf8');
const i = c.indexOf('method === "GET"');
console.log(c.slice(i, i + 2200));