# Messenger

Cloudflare-native instant messaging app.

## Architecture

- React/Vite frontend served by Cloudflare Worker static assets.
- Worker API for Google OAuth, users, friends, message history, and attachment access.
- D1 database `messenger-db` for users, friends, messages, and active call metadata.
- R2 bucket `messenger-attachments` for image attachments.
- Durable Objects:
  - `ChatRoom`: one instance per chat id for message, typing, and WebRTC signaling events.
  - `UserHub`: one instance per user for presence and incoming call notifications.
- Google OAuth client id, client secret, and session signing secret are Cloudflare secrets.

## Local Development

1. Install dependencies: `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and fill in Google OAuth values.
3. Run local Worker + assets: `npm run build && npm run dev:worker`

For fast frontend-only UI work, `npm run dev` still starts the Vite server, but authenticated API flows require the Worker.

## Cloudflare Setup

If your Wrangler login has more than one account, set one of these before running non-interactive commands:

```sh
export CLOUDFLARE_ACCOUNT_ID=<account-id>
```

Or add `"account_id": "<account-id>"` to `wrangler.jsonc`.

This project is currently configured for:

- Account: `71184b988be37c368ead7c17a3055918`
- Worker: `messenger`
- URL: `https://messenger.stingtao.workers.dev`
- D1: `messenger-db` (`ae655ccb-a9ae-4153-b793-225c9610ddb3`)
- R2: `messenger-attachments`

Create the D1 database:

```sh
npx wrangler d1 create messenger-db
```

Replace the placeholder `database_id` in `wrangler.jsonc` with the returned id, then apply migrations:

```sh
npx wrangler d1 migrations apply messenger-db --remote
```

Create the R2 bucket:

```sh
npx wrangler r2 bucket create messenger-attachments
```

Set secrets:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` has already been generated and uploaded for the deployed Worker. Set the two Google secrets before using login.

Deploy:

```sh
npm run check:deploy
npm run deploy
```

The Google OAuth redirect URI must include:

```text
https://messenger.stingtao.workers.dev/api/auth/google/callback
```

## Verification

```sh
npm run lint
npm test
npm run build
```
