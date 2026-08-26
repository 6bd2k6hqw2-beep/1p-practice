# 1Password Practice App

A four-lesson, throwaway account playground for practicing 1Password's
browser extension: creating a login, changing a password without losing
sync with your password manager, setting up TOTP 2FA, and connecting a
Google-style OIDC login. All accounts are local dummy data in a SQLite file
— nothing is a real identity.

## How it works

- Plain Express app, SQLite storage (`better-sqlite3`), EJS views, no build step.
- Passwords hashed with bcrypt.
- 2FA uses `otplib` (TOTP, same algorithm every real site uses) + a generated
  QR code, so 1Password's authenticator works exactly as it would on a real
  site.
- Passkeys use `@simplewebauthn/server` + `@simplewebauthn/browser` — real
  WebAuthn ceremonies, so 1Password's "save a passkey" / "use a passkey"
  prompts show up genuinely. This is why it needs to run on a real public
  HTTPS domain rather than plain HTTP or an IP address.
- Google login (Lesson 4) is a hand-rolled OAuth 2.0 / OIDC authorization
  code flow (`src/googleAuth.js`) against Google's real endpoints — no extra
  dependency, just `fetch` and a JWT payload decode. It's a genuinely
  separate credential type from anything 1Password stores directly.
- The container starts as root just long enough to create a `node` user at
  your requested `PUID`/`PGID` and `chown` the data folder, then drops
  privileges via `su-exec` before running the app — same pattern
  linuxserver.io images use, so no manual `chown` on the host is needed.

## Before you deploy

1. **Copy `.env.example` to `.env`** and fill in the variables — see the
   comments in that file for what each one does. Variable names deliberately
   avoid a leading digit (e.g. `PPRACTICE_PORT`, not `1PPRACTICE_PORT`) —
   shells and Compose can't interpolate a name starting with a number.
2. **`PUID`/`PGID`/`DOMAINNAME_1`** — if you already set these globally for
   your other containers, you don't need to repeat them in this app's `.env`.
   If this compose file is standalone, set them there.
3. **Drop the Traefik rules file in place**, matching the pattern you
   already use, e.g.:
   ```
   $DOCKERDIR/appdata/traefik3/rules/$HOSTNAME/app-1ppractice.yml
   ```
   It's deliberately on `websecure-external` with no auth middleware — the
   whole point is a normal public-looking signup flow. Check the
   `certResolver` name against your other working rule files.

## Deploy

There are two ways to get the image onto your server:

**Option A — pull a prebuilt image (recommended).** A GitHub Actions
workflow (`.github/workflows/build.yml`) builds this repo into a
`linux/amd64` + `linux/arm64` Docker image and publishes it to GitHub
Container Registry every time you push to `main`. Once that's run at least
once:

1. In `docker-compose.yml`, set `image:` to your actual repo path, e.g.
   `ghcr.io/yourusername/1p-practice:latest`.
2. The package is private by default. Either make it public (repo → Packages
   → the package → Package settings → Change visibility), or run
   `docker login ghcr.io -u yourusername` with a
   [personal access token](https://github.com/settings/tokens) that has
   `read:packages` scope before pulling.
3. Then:
   ```bash
   cd 1p-practice
   cp .env.example .env   # then fill in the values
   docker compose up -d
   ```
   This just pulls and runs the image — no build tools needed on the server.

**Option B — build it locally on the server instead.** In
`docker-compose.yml`, comment out the `image:` line and uncomment
`build: .`, then:
```bash
cd 1p-practice
cp .env.example .env   # then fill in the values
docker compose up -d --build
```

Either way, the container writes its SQLite database to whatever host path
you set as `PPRACTICE_APP_DATA_DIR`, so restarts don't wipe accounts. Anyone
who wants a clean slate can just use the in-app "Delete this practice
account" button — there's no shared data between different dummy accounts.

## The four lessons

The app now walks through this as an actual tutorial rather than a loose
checklist. Each lesson's page has a splash box (number, title, why it
matters) with a collapsed "Show me the steps" panel — closed by default, so
the natural first move is to just try it yourself and only open it if you
get stuck. Progress is tracked automatically off real account data (no
separate "progress" table to get out of sync) and shown on both the landing
page and `/account`.

1. **Create a login** (`/signup`) — sign up, let 1Password suggest and save
   a strong password.
2. **Change your password** (`/account/password`) — update it, then
   confirm 1Password's "update login" prompt actually caught it. Also worth
   doing deliberately wrong once: dismiss the prompt on purpose, log out,
   and see the autofilled old password fail — the page has recovery steps
   for exactly that.
3. **Add two-factor authentication** (`/account/2fa/setup`) — scan the QR
   code, confirm a live 6-digit code, then log out and back in using the
   code 1Password generates.
4. **Connect a Google login** (`/account/google`) — a different kind of
   credential than anything 1Password stores directly. See "Google login
   setup" below — this one needs a one-time setup step from you before it
   works.

Two more things worth trying that aren't numbered lessons but live on the
same account page: saving a passkey and logging in with it instead of a
password, and using "Delete this practice account" to start over.

## Google login setup (for Lesson 4)

This lesson needs its own OAuth credentials — nothing this app can generate
for itself. Without them, the lesson page just shows these same
instructions instead of a working button.

1. In the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials),
   create an OAuth 2.0 Client ID (application type: "Web application").
2. Add this as an authorized redirect URI, substituting your actual domain:
   `https://1ppractice.yourdomain.com/account/google/callback`
3. Set `PPRACTICE_GOOGLE_CLIENT_ID` and `PPRACTICE_GOOGLE_CLIENT_SECRET` in
   `.env` to the values Google gives you, then restart the container.

## Wiping accounts you're locked out of

The in-app "Delete this practice account" button (on `/account`) requires
being logged in, which doesn't help if you've deliberately broken your own
login (e.g. dismissed 1Password's password-update prompt and can no longer
log in with the autofilled value, or fumbled a 2FA/passkey setup). For that,
run this on the server itself:

```bash
docker exec 1ppractice node src/admin-reset-all.js --yes
```

This wipes **every** practice account on the instance, not just one — it's
a blunt instrument for getting back to a clean slate, not a per-account
tool. Leave off `--yes` first to see a count of what would be deleted
without actually touching anything.

This is deliberately a server-side script rather than a web route, even
behind a secret — this app is meant to be reachable from the open internet,
so it doesn't get an HTTP endpoint that can delete everyone's data.

## Notes / things you may want to change

- Sessions are stored in SQLite via `connect-sqlite3` (4 hour expiry).
- There's no email verification or password reset flow — it's a dummy
  environment, so "forgot password" isn't meaningful. If you want to
  practice account-recovery flows too, that's a reasonable next addition.
- `NODE_ENV=production` makes session cookies `secure`, so it only works over
  HTTPS (as served by Traefik) — running it locally over plain `http://`
  needs `NODE_ENV` unset.
