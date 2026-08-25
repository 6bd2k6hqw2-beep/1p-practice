# 1Password Practice App

A throwaway account playground for practicing 1Password's browser extension:
signing up, saving/changing a password, setting up TOTP 2FA (scan a QR code,
enter a code on login), and saving/using a WebAuthn passkey. All accounts are
local dummy data in a SQLite file — nothing is a real identity.

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

## Before you deploy

1. **Pick and DNS the subdomain.** Everything below assumes
   `1p-practice.southrock.ie`. If you use a different name, update it in
   `docker-compose.yml` (`RP_ID` / `ORIGIN`) and `traefik-rules/1p-practice.yml`
   (the `Host()` rule and service URL) — they must all match exactly, or
   passkeys will fail to verify.
2. **Set a session secret.** Copy `.env.example` to `.env` and fill in
   `SESSION_SECRET` with `openssl rand -hex 32`.
3. **Check the Traefik network name.** `docker-compose.yml` has a
   `traefik-network` placeholder under `networks: external:` — set it to
   whatever external network your Traefik container actually publishes.
4. **Check the cert resolver name.** `traefik-rules/1p-practice.yml` assumes
   a certResolver called `cloudflare`. Rename it to match your actual
   Traefik config if it's called something else.
5. **Drop the rules file in place**, matching the pattern you already use:
   ```
   $DOCKERDIR/appdata/traefik3/rules/$HOSTNAME/1p-practice.yml
   ```
   It's deliberately on `websecure-external` and **not** behind
   `chain-tinyauth@file` — the whole point is a normal public-looking signup
   flow.

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
   cp .env.example .env   # then edit SESSION_SECRET
   docker compose up -d
   ```
   This just pulls and runs the image — no build tools needed on the server.

**Option B — build it locally on the server instead.** In
`docker-compose.yml`, comment out the `image:` line and uncomment
`build: .`, then:
```bash
cd 1p-practice
cp .env.example .env   # then edit SESSION_SECRET
docker compose up -d --build
```

Either way, the container writes its SQLite database to `./data` (bind-mounted), so
restarts don't wipe accounts. Anyone who wants a clean slate can just use the
in-app "Delete this practice account" button — there's no shared data between
different dummy accounts.

## What to actually practice

1. Sign up — let 1Password suggest and save a strong password.
2. Set up 2FA — scan the QR code with 1Password, save the OTP field, confirm
   the code.
3. Log out and back in using the code 1Password generates.
4. Add a passkey from the account page, then log out and use
   "log in with a passkey" — no password needed.
5. Change the password and confirm 1Password offers to update the saved
   login.

## Notes / things you may want to change

- Sessions are stored in SQLite via `connect-sqlite3` (4 hour expiry).
- There's no email verification or password reset flow — it's a dummy
  environment, so "forgot password" isn't meaningful. If you want to
  practice account-recovery flows too, that's a reasonable next addition.
- `NODE_ENV=production` makes session cookies `secure`, so it only works over
  HTTPS (as served by Traefik) — running it locally over plain `http://`
  needs `NODE_ENV` unset.
