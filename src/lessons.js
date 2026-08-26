// A "lesson" is complete when the underlying account data already proves it
// happened — no separate progress table to keep in sync. Lessons aren't
// locked/gated; someone can jump to any of them in any order, this is just
// used to show progress and suggest what's next.

const db = require('./db');

function hasChangedPassword(userId) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM password_history WHERE user_id = ?').get(userId);
  return row.count > 0;
}

const LESSONS = [
  {
    number: 1,
    slug: 'create-login',
    title: 'Create a login',
    short: 'Sign up and let 1Password save it',
    blurb:
      "Every login starts here. When you submit this form, 1Password's browser extension should offer to save the new login — and if you click into the password field first, it can suggest a strong one for you instead of making one up yourself.",
    href: '/signup',
    isComplete: (user) => !!user,
  },
  {
    number: 2,
    slug: 'change-password',
    title: 'Change your password',
    short: 'Update it, and make sure 1Password keeps up',
    blurb:
      "Sites ask you to change your password more often than you'd like. The part people get wrong isn't the change itself — it's making sure the password manager actually updates to match.",
    href: '/account/password',
    isComplete: (user) => hasChangedPassword(user.id),
  },
  {
    number: 3,
    slug: '2fa',
    title: 'Add two-factor authentication',
    short: 'Scan a QR code, verify a live code',
    blurb:
      '1Password can hold your one-time codes alongside the password itself, so both autofill together. Scanning the QR code here is exactly what you\'d do on a real site\'s security settings page.',
    href: '/account/2fa/setup',
    isComplete: (user) => !!user.totp_enabled,
  },
  {
    number: 4,
    slug: 'google-oidc',
    title: 'Connect a Google login',
    short: 'Practice "Sign in with Google"',
    blurb:
      "Plenty of real sites let you log in with a Google account instead of (or alongside) a password. This is a different kind of credential than anything 1Password stores directly — worth seeing how the handoff to Google and back actually feels.",
    href: '/account/google',
    isComplete: (user) => !!user.google_sub,
  },
];

function lessonsWithStatus(user) {
  return LESSONS.map((lesson) => ({
    ...lesson,
    complete: user ? lesson.isComplete(user) : false,
  }));
}

function nextLesson(user) {
  const withStatus = lessonsWithStatus(user);
  return withStatus.find((l) => !l.complete) || null;
}

module.exports = { LESSONS, lessonsWithStatus, nextLesson, hasChangedPassword };
