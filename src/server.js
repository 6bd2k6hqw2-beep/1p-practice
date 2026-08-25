const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL, generateUserID } = require('@simplewebauthn/server/helpers');

const db = require('./db');
const { RP_NAME, RP_ID, ORIGIN } = require('./webauthnConfig');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Serve the SimpleWebAuthn browser helper straight from node_modules so it
// stays in sync with the server-side library version.
app.use(
  '/vendor/simplewebauthn',
  express.static(path.join(__dirname, '..', 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle'))
);

app.set('trust proxy', 1); // behind Traefik

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '..', 'data') }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 4, // 4 hours
    },
  })
);

// ---------- helpers ----------
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function getCredentialsForUser(userId) {
  return db.prepare('SELECT * FROM credentials WHERE user_id = ?').all(userId);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
function requirePartialAuth(req, res, next) {
  // set after password step, before 2FA/passkey step is complete
  if (!req.session.pendingUserId) return res.redirect('/login');
  next();
}
function flash(req, msg, type = 'info') {
  req.session.flash = { msg, type };
}
function consumeFlash(req) {
  const f = req.session.flash;
  delete req.session.flash;
  return f;
}

// ---------- landing ----------
app.get('/', (req, res) => {
  res.render('index', { user: req.session.userId ? getUserById(req.session.userId) : null });
});

// ---------- signup ----------
app.get('/signup', (req, res) => {
  res.render('signup', { flash: consumeFlash(req) });
});

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    flash(req, 'Pick a username and a password of at least 8 characters.', 'error');
    return res.redirect('/signup');
  }
  const existing = getUserByUsername(username);
  if (existing) {
    flash(req, 'That username is taken in this practice environment. Try another.', 'error');
    return res.redirect('/signup');
  }
  const hash = await bcrypt.hash(password, 12);
  const webauthnUserId = isoBase64URL.fromBuffer(await generateUserID());
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, webauthn_user_id) VALUES (?, ?, ?)'
    )
    .run(username, hash, webauthnUserId);
  req.session.userId = info.lastInsertRowid;
  flash(req, 'Account created. This is a dummy account for practice only.', 'success');
  res.redirect('/account');
});

// ---------- login (password step) ----------
app.get('/login', (req, res) => {
  res.render('login', { flash: consumeFlash(req) });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username || '');
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    flash(req, 'Incorrect username or password.', 'error');
    return res.redirect('/login');
  }
  const hasPasskeys = getCredentialsForUser(user.id).length > 0;
  if (user.totp_enabled) {
    req.session.pendingUserId = user.id;
    return res.redirect('/login/2fa');
  }
  if (hasPasskeys) {
    // Passkey holders can still fall back to password-only login in this demo;
    // real sites vary here. Keep it simple: password success logs them in.
  }
  req.session.userId = user.id;
  res.redirect('/account');
});

// ---------- login: TOTP step ----------
app.get('/login/2fa', requirePartialAuth, (req, res) => {
  res.render('login-2fa', { flash: consumeFlash(req) });
});

app.post('/login/2fa', requirePartialAuth, (req, res) => {
  const user = getUserById(req.session.pendingUserId);
  const { token } = req.body;
  const valid = user.totp_secret && authenticator.check(String(token || '').trim(), user.totp_secret);
  if (!valid) {
    flash(req, 'That code was incorrect or expired. Check the code in 1Password and try again.', 'error');
    return res.redirect('/login/2fa');
  }
  req.session.userId = user.id;
  delete req.session.pendingUserId;
  res.redirect('/account');
});

// ---------- logout ----------
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- account dashboard ----------
app.get('/account', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const credentials = getCredentialsForUser(user.id);
  res.render('account', { user, credentials, flash: consumeFlash(req) });
});

// ---------- change password ----------
app.get('/account/password', requireAuth, (req, res) => {
  res.render('change-password', { flash: consumeFlash(req) });
});

app.post('/account/password', requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  const { current_password, new_password } = req.body;
  if (!(await bcrypt.compare(current_password || '', user.password_hash))) {
    flash(req, 'Current password is incorrect.', 'error');
    return res.redirect('/account/password');
  }
  if (!new_password || new_password.length < 8) {
    flash(req, 'New password must be at least 8 characters.', 'error');
    return res.redirect('/account/password');
  }
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  db.prepare('INSERT INTO password_history (user_id) VALUES (?)').run(user.id);
  flash(req, 'Password changed. Practice saving the update in 1Password when prompted.', 'success');
  res.redirect('/account');
});

// ---------- TOTP 2FA setup ----------
app.get('/account/2fa/setup', requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  if (user.totp_enabled) {
    flash(req, '2FA is already enabled. Disable it first to set up a new secret.', 'info');
    return res.redirect('/account');
  }
  const secret = authenticator.generateSecret();
  req.session.pendingTotpSecret = secret;
  const otpauth = authenticator.keyuri(user.username, RP_NAME, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  res.render('2fa-setup', { secret, qrDataUrl, flash: consumeFlash(req) });
});

app.post('/account/2fa/setup', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const secret = req.session.pendingTotpSecret;
  const { token } = req.body;
  if (!secret || !authenticator.check(String(token || '').trim(), secret)) {
    flash(req, 'That code did not match. Re-scan the QR code and try again.', 'error');
    return res.redirect('/account/2fa/setup');
  }
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').run(secret, user.id);
  delete req.session.pendingTotpSecret;
  flash(req, '2FA enabled. Future logins will ask for a code from 1Password.', 'success');
  res.redirect('/account');
});

app.post('/account/2fa/disable', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(req.session.userId);
  flash(req, '2FA disabled.', 'info');
  res.redirect('/account');
});

// ---------- WebAuthn: passkey registration ----------
app.post('/webauthn/register/options', requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  const existingCreds = getCredentialsForUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: isoBase64URL.toBuffer(user.webauthn_user_id),
    userName: user.username,
    attestationType: 'none',
    excludeCredentials: existingCreds.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  req.session.currentRegChallenge = options.challenge;
  res.json(options);
});

app.post('/webauthn/register/verify', requireAuth, async (req, res) => {
  const user = getUserById(req.session.userId);
  const expectedChallenge = req.session.currentRegChallenge;
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ verified: false });
    }
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    db.prepare(
      'INSERT INTO credentials (user_id, credential_id, public_key, counter, transports, nickname) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      user.id,
      credentialID,
      isoBase64URL.fromBuffer(credentialPublicKey),
      counter,
      JSON.stringify(req.body.response?.transports || req.body.transports || []),
      `Passkey ${new Date().toLocaleDateString()}`
    );
    delete req.session.currentRegChallenge;
    res.json({ verified: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ verified: false, error: err.message });
  }
});

app.post('/account/passkey/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  flash(req, 'Passkey removed.', 'info');
  res.redirect('/account');
});

// ---------- WebAuthn: passkey login ----------
app.get('/login/passkey', (req, res) => {
  res.render('login-passkey', { flash: consumeFlash(req) });
});

app.post('/webauthn/login/options', async (req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
  });
  req.session.currentAuthChallenge = options.challenge;
  res.json(options);
});

app.post('/webauthn/login/verify', async (req, res) => {
  const credentialId = req.body.id;
  const cred = db.prepare('SELECT * FROM credentials WHERE credential_id = ?').get(credentialId);
  if (!cred) return res.status(400).json({ verified: false, error: 'Unknown credential' });
  const user = getUserById(cred.user_id);
  const expectedChallenge = req.session.currentAuthChallenge;
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credential_id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
    if (!verification.verified) return res.status(400).json({ verified: false });
    db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      cred.id
    );
    delete req.session.currentAuthChallenge;
    req.session.userId = user.id;
    res.json({ verified: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ verified: false, error: err.message });
  }
});

// ---------- reset / delete dummy account ----------
app.post('/account/reset', requireAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.session.userId);
  req.session.destroy(() => res.redirect('/'));
});

// ---------- health check ----------
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`1Password practice app listening on :${PORT} (RP_ID=${RP_ID}, ORIGIN=${ORIGIN})`);
});
