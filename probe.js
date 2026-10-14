const base = 'http://localhost:3000';
(async () => {
  const probes = {};
  probes.get = await (await fetch(base + '/api/auth/[...nextauth]', { method: 'GET' })).text();
  probes.postJson = await (await fetch(base + '/api/auth/[...nextauth]', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })).text();
  probes.postFormSignIn = await (await fetch(base + '/api/auth/[...nextauth]', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=signIn&providerId=credentials&username=admin&password=admin123&callbackUrl=/dashboard'
  })).text();
  probes.postJsonBody = await (await fetch(base + '/api/auth/[...nextauth]', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signIn', providerId: 'credentials', username: 'admin', password: 'admin123', callbackUrl: '/dashboard' })
  })).text();
  console.log('POST_JSON_BODY:', probes.postJsonBody);
})().catch(e => console.error('ERR', e.message));
