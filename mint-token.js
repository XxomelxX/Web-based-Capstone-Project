// Mint the exact next-auth session JWT format (JWE 'dir'/'A256GCM' with
// HKDF-derived encryption key) so we can send the session cookie to the
// server for read-only verification. No DB writes.
const crypto = require('crypto');
const { SignJWT, EncryptJWT } = require('jose');
const hkdf = require('@panva/hkdf');
const hkdfSyncImpl = hkdf.default || hkdf;

const SECRET = Buffer.from('29RSTTK7SBqeO4Cy7wd5rXbxX/nx7+hMjMu55PU+Nl4=', 'base64');
const INFO = Buffer.from('NextAuth.js Generated Encryption Key');

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const encKey = await hkdfSyncImpl('sha256', SECRET, Buffer.from(''), INFO, 32);
    sub: '1',
    name: 'Samuel Bioco',
    email: 'admin@jjmerchandisestore.shop',
    role: 'admin',
    id: '1',
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
  };
  // The plaintext JWT, signed with the same HKDF-derived key.
  const plaintext = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(3600)
    .setJti(claims.jti)
    .sign(ENC_KEY);
  // Mirror next-auth's encode(): encrypted with 'dir'/'A256GCM'.
  const jwe = await new EncryptJWT(plaintext)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(3600)
    .setJti(claims.jti)
    .encrypt(ENC_KEY);
  console.log('JWE_SESSION_TOKEN=' + jwe);
  console.log('COOKIE=next-auth.session-token=' + jwe);
})().catch(e => { console.error('ERR', e); process.exit(1); });
