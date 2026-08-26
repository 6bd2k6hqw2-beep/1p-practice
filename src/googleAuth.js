const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = `${ORIGIN}/account/google/callback`;

const isConfigured = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Decodes the id_token's payload without verifying the signature. That's
// fine for a practice/demo app where the only consequence of a forged token
// is fake data in a dummy account — a real integration should verify the
// signature against Google's published JWKS instead of trusting the payload
// as-is.
function decodeIdToken(idToken) {
  const payloadB64 = idToken.split('.')[1];
  const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
  return JSON.parse(json);
}

module.exports = {
  isConfigured,
  buildAuthUrl,
  exchangeCodeForTokens,
  decodeIdToken,
};
