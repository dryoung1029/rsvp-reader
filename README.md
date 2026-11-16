# RAFAS: Read As Fast As Swizz

A speed reader that shows one word at a time (RSVP), built for phones and computers. Read web articles, PDFs (with OCR for scans), EPUBs, text files and pasted text. Everything goes into a library that remembers your place.

Live at **https://rafas.app** (Cloudflare Workers).

## Features

- Accounts with email sign-in (6-digit code or link, no passwords) and invite-only sign-up.
- Each person's library syncs across their devices, with their place in every document. A local copy keeps working offline.
- Admins create invite links (limit by number of people and days), see members, and turn links off.
- Imports web articles, PDF (with OCR for scans), EPUB, Word (.docx), text and HTML; share links from Google Docs/Drive, Dropbox and OneDrive; Google Drive and Dropbox pickers; iCloud Drive through the device file picker.
- Phone layout with tap zones and full-screen focus mode; computer layout with a library sidebar, drag-and-drop and keyboard shortcuts.
- Installable PWA that appears in the Android Share menu.
- Personal inbox per member: email from your sign-in address, or an iPhone Shortcut with a personal token.
- Reading stats (words, time, streaks, average speed, 14-day chart) and an opt-in family board.
- Comprehension quick checks: after a few minutes of reading, a 3-question quiz on that passage (written by Claude, or fill-in-the-blank without a key). Only passed reading counts toward achievements, levels, competitions and leaderboards.
- Gamification: 39 achievements with points and tiers, XP levels, a daily goal, monthly competitions (words, speed, finished, days read), all-time leaderboards and a family activity feed.
- Context view when paused; chapters for EPUB, PDF bookmarks, Word headings, and Markdown/HTML headings.
- Smart pacing (time spent on long words, not short common ones) and a 30-second warm-up.
- Send a document to another member, with an email notice.
- "Send to RAFAS" bookmarklet for saving pages on a computer, including pages behind a login.

## Layout

| Path | What |
| --- | --- |
| `src/` | React frontend (Vite). `App.jsx` holds the reader; `pages/` has About, Help, Privacy. |
| `src/lib/` | Text helpers, file parsers (PDF, EPUB, OCR), IndexedDB library. |
| `public/` | Manifest, icons, service worker (`sw.js`). |
| `worker/` | Cloudflare Worker. `auth.js` (sign-in, sessions, invites, admin), `docs.js` (library sync, sending), `stats.js`, `game.js` (achievements, competitions, leaderboards), `quiz.js` (comprehension quizzes), `inbox.js`, `importer.js` (links and share links), `index.js` (router and email handler). |
| `migrations/` | D1 database schema. Apply new ones with `npx wrangler d1 migrations apply rafas --remote` before deploying. |
| `shared/achievements.js` | Achievement definitions and level maths, used by both the Worker and the app. |
| `wrangler.jsonc` | Worker config: static assets, D1, KV, custom domain, public settings. |

## Local development

```bash
npm install
```

Create `.dev.vars` (not committed):

```
ADMIN_EMAILS=you@example.com
DEV_RETURN_LOGIN_CODE=1
APP_URL=http://localhost:8787
```

`DEV_RETURN_LOGIN_CODE=1` shows the sign-in code on screen instead of emailing it. It only works on localhost; never set it in production.

Create the local database:

```bash
npx wrangler d1 migrations apply rafas --local
```

Run the built app and the Worker together on http://localhost:8787:

```bash
npm run preview
```

For frontend hot reload, run `npx wrangler dev` in one terminal and `npm run dev` in another. Vite forwards `/api` to the Worker.

## Deploying to Cloudflare

One-time setup:

1. Add `rafas.app` to your Cloudflare account (it's already there if you bought it through Cloudflare Registrar).
2. Sign in:

   ```bash
   npx wrangler login
   ```

3. Create the database and paste the printed `database_id` into `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create rafas
   ```

4. Create the schema:

   ```bash
   npx wrangler d1 migrations apply rafas --remote
   ```

5. Create the inbox storage and paste the printed `id` into `wrangler.jsonc`:

   ```bash
   npx wrangler kv namespace create INBOX
   ```

6. Set up sending email with [Resend](https://resend.com): add the domain `rafas.app`, add the DNS records Resend shows you in Cloudflare DNS, wait for it to verify, then create an API key and save it:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

7. Set the admin email(s). Admins can sign in without an invite and manage invites:

   ```bash
   npx wrangler secret put ADMIN_EMAILS
   ```

8. Deploy (this also attaches `rafas.app`):

   ```bash
   npm run deploy
   ```

9. Optional: let Claude write the reading quizzes. Without this, quizzes use fill-in-the-blank questions taken from the text.

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

10. Open https://rafas.app, sign in with your admin email, and create an invite link on the Account page.

To deploy automatically on every push instead, connect this GitHub repo under Workers & Pages → rafas → Settings → Builds, with build command `npm run build` and deploy command `npx wrangler deploy`. Run new files in `migrations/` with `npx wrangler d1 migrations apply rafas --remote` before deploying code that needs them.

### Email in

1. Cloudflare dashboard → rafas.app → Email → Email Routing → enable it (Cloudflare adds the MX and TXT records). This is separate from Resend, which only sends.
2. Routing rules → create a custom address `read@rafas.app` with the action **Send to a Worker** → `rafas`.

Mail is accepted only from the email address of a RAFAS account, and goes into that person's inbox. If you pick a different address, change `INBOX_EMAIL` in `wrangler.jsonc`.

### One-tap iPhone setup (optional)

Family members can always use email: the Account page has an **Add RAFAS to Contacts** button (a contact card for `INBOX_EMAIL`), after which Share → Mail → RAFAS sends anything to their library.

For a RAFAS button in the iPhone Share menu, build the Shortcut once and share it:

1. Build "Send to RAFAS" as described on the Help page (Get Contents of URL → `https://rafas.app/api/inbox`, POST, header `Authorization: Bearer <token>`, form field `text` = Shortcut Input; for files, Request Body **File** = Shortcut Input). End it with **Show Notification** set to *Contents of URL*: token requests get a plain-text reply ("Added to RAFAS: …" or the reason it failed).
2. In the shortcut's settings, open the **Setup** tab and add an **import question** on the `Authorization` header value, e.g. "Paste your RAFAS token". Without it, everyone who installs the link gets *your* token and their items land in your library. Check by opening the iCloud link: it should ask for a token.
3. Share → **Copy iCloud Link**, and put the link in `SHORTCUT_URL` in `wrangler.jsonc`, then deploy. If you make a second Shortcut for files (Request Body field `file` = Shortcut Input), put its link in `SHORTCUT_FILES_URL`; the Account page then offers both.

The Account page then shows **Set up the Share button**: it creates the person's token, copies it, and links to the Shortcut. If you edit the Shortcut later, copy a new iCloud link; old links keep the old version.

### Google Drive picker (optional)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Drive API** and **Google Picker API**.
2. OAuth consent screen: External, app name RAFAS, add the scope `.../auth/drive.file`. While the app is in "Testing", add each family member's Google address as a test user (or publish the app; `drive.file` doesn't need Google's verification review).
3. Credentials → create an **OAuth client ID** (Web application) with authorized JavaScript origin `https://rafas.app`, and an **API key** restricted to `https://rafas.app/*` and the Picker API.
4. Put the client ID, API key and project number (as `GOOGLE_APP_ID`) in the `vars` of `wrangler.jsonc` and redeploy. These are public values by design.

### Dropbox picker (optional)

1. At [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), create an app (Scoped access, App folder is fine).
2. Under Chooser/Saver domains, add `rafas.app`.
3. Put the app key in `DROPBOX_APP_KEY` in `wrangler.jsonc` and redeploy.

### Inbox API

`POST /api/inbox` accepts a personal token (created on the Account page) as `Authorization: Bearer <token>` (a bare token, `x-inbox-token` or `?token=` also work). Token requests get a plain-text reply. A raw request body that isn't text (a PDF, EPUB or DOCX) is saved as a file; `?name=` or `Content-Disposition` sets its name. The Account page reuses the same token each time unless you choose **Make a new token**. The other endpoints use the signed-in session.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/inbox` | JSON or form with `title`, `text`, `url`, and/or `file` uploads (24 MB max per item) |
| GET | `/api/inbox` | List waiting items |
| GET | `/api/inbox/:id` | Item body: file bytes, or JSON `{ text, url }` |
| DELETE | `/api/inbox/:id` | Remove an item |

Items not picked up expire after 30 days.

```bash
curl -X POST https://rafas.app/api/inbox -H "Authorization: Bearer $RAFAS_TOKEN" -F file=@book.epub
```

## Limits worth knowing

- The Workers Free plan allows 10 ms of CPU per request. Importing very long web articles can exceed that and fail; the Workers Paid plan raises the limit.
- KV on the Free plan allows 1,000 writes a day, which is far more than the inbox needs. D1's free allowance covers a family easily.
- Resend's free plan has a daily sending limit; sign-in emails are rate-limited to 5 per address per hour.
