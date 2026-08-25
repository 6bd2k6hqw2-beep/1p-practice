// Relying Party config for WebAuthn (passkeys).
// RP_ID must be the bare domain (no scheme/port) the app is served on,
// and must exactly match what's in the browser's address bar for
// passkeys to work. ORIGIN is the full https URL.
const RP_NAME = process.env.RP_NAME || '1Password Practice';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || `https://${RP_ID}`;

module.exports = { RP_NAME, RP_ID, ORIGIN };
