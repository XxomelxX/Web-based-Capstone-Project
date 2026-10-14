const fs = require('fs');
const c = fs.readFileSync(process.argv[2], 'utf8');
for (const kw of ['bodyParser', 'AppRouter', 'method', 'action', 'signIn']) {
  const i = c.indexOf(kw);
  console.log('=== ' + kw + ' @ ' + i + ' ===');
  console.log(c.slice(Math.max(0, i - 150), i + 250));
}