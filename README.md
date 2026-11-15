# RSVP Reader

A mobile-friendly rapid serial visual presentation reader. Import web articles, PDFs (with OCR fallback for scans), EPUBs, text files or pasted text, and read them one word at a time with adjustable speed, chunk size, pivot letter and focus line.

## Library and resume

Every document you open is saved in the browser (IndexedDB) with your reading position. The Library section lists them by most recently opened, with progress and time left, and opening one resumes where you stopped. Positions are stored as a word offset, so changing "words per flash" keeps your place. Sharing or importing the same document again reopens the saved copy instead of making a duplicate.

The library lives on each device/browser. It is not synced between your phone and your computer.

## Sending documents to the reader

### Android share sheet

The app is an installable PWA with a Web Share Target. In Chrome, use **Add to Home screen / Install app**. After that, **RSVP** shows up in the Android share sheet for web pages, selected text and PDF/EPUB/TXT files. No server setup is needed.

### iPhone (Shortcut) and email: the server inbox

iOS does not let web apps appear in the share sheet, and email needs a server to receive it, so both go through a small inbox on the server. Items wait there until the app is opened (or brought back to the foreground), then get imported into the library and removed from the server.

1. Set a long random `INBOX_TOKEN` environment variable on the server. The inbox is disabled without it.
2. In the app, open **Send to reader** and enter the same token. The section has step-by-step instructions for the iOS Shortcut and the email webhook.

Inbox endpoints (auth with `Authorization: Bearer <token>`, Basic auth with the token as password, or `?token=`):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/inbox` | JSON or form with `title`, `text`, `url`, and/or `file` uploads |
| POST | `/api/inbox/email` | Inbound email webhook (Postmark JSON, SendGrid Inbound Parse, Mailgun Routes) |
| GET | `/api/inbox` | List waiting items |
| GET | `/api/inbox/:id/file` | Download an uploaded file |
| DELETE | `/api/inbox/:id` | Remove an item |

For email: PDF/EPUB/TXT/MD/HTML attachments become documents, an email that is just a link imports the article, and anything else is imported as the body text.

Example:

```bash
curl -X POST https://your-app.example/api/inbox -H "Authorization: Bearer $INBOX_TOKEN" -F file=@book.epub
```

## Deploy (Railway)

Build command:

```bash
npm run build
```

Start command:

```bash
npm run start
```

Environment variables:

- `PORT`: set by Railway.
- `INBOX_TOKEN`: enables the iOS/email inbox.
- `DATA_DIR`: where inbox items are stored (default `./data`). Railway's filesystem is wiped on redeploy, so attach a volume and point `DATA_DIR` at it if you want items that haven't been picked up yet to survive a deploy.
