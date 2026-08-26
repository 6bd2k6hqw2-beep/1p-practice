// Wipes every practice account. Run this on the server itself, not exposed
// over HTTP — this app is deliberately public-facing, so a web-reachable
// "delete everything" endpoint (even behind a secret) is attack surface it
// doesn't need. This script is the escape hatch for accounts you've locked
// yourself out of (e.g. a passkey/2FA/password mismatch you can no longer
// log in past) that the in-app "Delete this practice account" button can't
// reach because it requires being logged in.
//
// Usage (from the host):
//   docker exec 1ppractice node src/admin-reset-all.js --yes
//
// The --yes flag is required on purpose, so this can't be triggered by
// accidentally re-running a copied command without thinking about it.

const db = require('./db');

const confirmed = process.argv.includes('--yes');

const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();

if (!confirmed) {
  console.log(`This will permanently delete all ${count} practice account(s) and their passkeys/2FA data.`);
  console.log('Re-run with --yes to confirm, e.g.:');
  console.log('  docker exec 1ppractice node src/admin-reset-all.js --yes');
  process.exit(1);
}

// credentials/password_history rows cascade automatically since db.js turns
// on foreign key enforcement.
db.prepare('DELETE FROM users').run();
db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users','credentials','password_history')").run();

console.log(`Deleted ${count} practice account(s). Fresh start.`);
