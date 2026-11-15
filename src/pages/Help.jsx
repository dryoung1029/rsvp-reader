import React from "react";
import { Link } from "../router.jsx";

const SECTIONS = [
  ["start", "Getting started"],
  ["adding", "Adding documents"],
  ["reading", "Reading controls"],
  ["keys", "Keyboard shortcuts"],
  ["library", "Library"],
  ["install", "Install the app"],
  ["phone", "Share from your phone"],
  ["email", "Email documents in"],
  ["trouble", "Troubleshooting"]
];

export default function Help({ inboxEmail, inboxEnabled, hasToken }) {
  const origin = window.location.origin;
  return (
    <article className="page">
      <h1>Help</h1>
      <p className="lede">Everything RAFAS can do, and how to set up sharing from your phone.</p>
      <nav className="toc" aria-label="Help sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="start">
        <h2>Getting started</h2>
        <ol>
          <li>Add something to read: a file, a web link, or pasted text (see below).</li>
          <li>Press <b>Play</b>, or tap the middle of the word area.</li>
          <li>Adjust <b>Speed</b> until you can follow comfortably. 250 to 350 words per minute is a good start.</li>
          <li>Stop whenever you like. RAFAS saves your place automatically.</li>
        </ol>
      </section>

      <section id="adding">
        <h2>Adding documents</h2>
        <h3>Files</h3>
        <p>
          Use <b>Choose file</b> in the Add panel, or on a computer drag a file onto the reader. Supported: PDF, EPUB,
          TXT, Markdown, CSV and HTML. If a PDF is a scan with no text in it, RAFAS recognizes the text from the page
          images. That runs on your device and takes a while for long documents.
        </p>
        <h3>Web articles</h3>
        <p>
          Paste a link into the article box and press <b>Import</b>. RAFAS pulls out the article text and leaves out
          menus and ads. Some sites block this. If so, copy the article text and paste it instead.
        </p>
        <h3>Pasted text</h3>
        <p>
          Paste into the text box and press <b>Save &amp; read</b>. If you paste only a link, it is imported as an
          article. On a phone, <b>Paste from clipboard</b> does it in one tap.
        </p>
      </section>

      <section id="reading">
        <h2>Reading controls</h2>
        <table>
          <tbody>
            <tr><th>Tap the middle</th><td>Play or pause.</td></tr>
            <tr><th>Tap the left or right edge</th><td>Jump back or forward one sentence.</td></tr>
            <tr><th>Back / Next buttons</th><td>Previous or next sentence. On a small phone these show as « and ».</td></tr>
            <tr><th>Start</th><td>Go back to the beginning of the document.</td></tr>
            <tr><th>Focus</th><td>Full-screen reading with nothing else on screen. Tap zones work the same way. Close it with the ✕ or <kbd>Esc</kbd>.</td></tr>
            <tr><th>Speed</th><td>Words per minute. RAFAS also pauses briefly at commas and full stops, so long sentences don't blur together.</td></tr>
            <tr><th>Words per flash</th><td>Show 1 to 5 words at a time. More words per flash suits some readers at high speeds.</td></tr>
            <tr><th>Pivot letter</th><td>Highlights the letter your eye should rest on. Only shown with one word per flash.</td></tr>
            <tr><th>Focus line</th><td>A thin vertical guide through the pivot letter.</td></tr>
            <tr><th>Position</th><td>Drag to jump anywhere in the document.</td></tr>
          </tbody>
        </table>
      </section>

      <section id="keys">
        <h2>Keyboard shortcuts</h2>
        <table>
          <tbody>
            <tr><th><kbd>Space</kbd></th><td>Play / pause</td></tr>
            <tr><th><kbd>←</kbd> <kbd>→</kbd></th><td>Back / forward one word</td></tr>
            <tr><th><kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd></th><td>Back / forward one sentence</td></tr>
            <tr><th><kbd>↑</kbd> <kbd>↓</kbd></th><td>Speed up / slow down by 25 words per minute</td></tr>
            <tr><th><kbd>F</kbd></th><td>Enter or leave focus mode</td></tr>
            <tr><th><kbd>Esc</kbd></th><td>Leave focus mode</td></tr>
            <tr><th><kbd>R</kbd></th><td>Back to the beginning</td></tr>
          </tbody>
        </table>
      </section>

      <section id="library">
        <h2>Library</h2>
        <p>
          Everything you open is saved in your library with your progress and the time left at your current speed.
          Open any document to continue exactly where you stopped. Adding the same document again reopens your
          saved copy instead of making a duplicate. Use ✕ to delete a document.
        </p>
        <p className="callout">
          The library is stored in the browser on each device. Your phone and your computer each keep their own
          library. Private or incognito windows don't keep anything after they close.
        </p>
      </section>

      <section id="install">
        <h2>Install the app</h2>
        <ul>
          <li><b>Android (Chrome):</b> menu ⋮ → <b>Add to Home screen</b> or <b>Install app</b>.</li>
          <li><b>iPhone / iPad (Safari):</b> Share button → <b>Add to Home Screen</b>.</li>
          <li><b>Computer (Chrome or Edge):</b> the install icon at the right of the address bar.</li>
        </ul>
        <p>Once installed, RAFAS opens in its own window and still works without a connection for documents already in your library.</p>
      </section>

      <section id="phone">
        <h2>Share from your phone</h2>
        <h3>Android</h3>
        <p>
          Install the app first (above). After that, <b>RAFAS</b> appears in the Share menu of other apps. Share a web
          page, selected text, or a PDF/EPUB file and it opens in RAFAS, saved to your library. Nothing else to set up.
        </p>

        <h3>iPhone and iPad</h3>
        <p>
          iOS doesn't let web apps appear in the Share menu, so RAFAS uses a Shortcut that drops items in your private
          inbox. RAFAS picks them up the next time you open it. This needs the <b>inbox token</b>, which is set by
          whoever runs this site{hasToken ? " (you've already saved it on this device)" : ""}.
          {!inboxEnabled && <> <b>The inbox isn't switched on for this site yet.</b></>}
        </p>
        <p>Make two shortcuts, one for links and text and one for files:</p>
        <ol>
          <li>Open <b>Shortcuts</b> and tap <b>+</b>. Tap the shortcut's name at the top and call it <b>Send to RAFAS</b>.</li>
          <li>Tap the <b>ⓘ</b> (or settings) button and turn on <b>Show in Share Sheet</b>. Set it to receive <b>URLs</b>, <b>Text</b> and <b>Safari web pages</b>.</li>
          <li>Add the action <b>Get Contents of URL</b>. Set the URL to <code>{origin}/api/inbox</code>.</li>
          <li>Tap the arrow to show more options. Method: <b>POST</b>. Add a header named <code>Authorization</code> with the value <code>Bearer YOUR-INBOX-TOKEN</code>.</li>
          <li>Request Body: <b>Form</b>. Add a <b>Text</b> field named <code>text</code> and set its value to <b>Shortcut Input</b>.</li>
          <li>Optionally add a <b>Show Notification</b> action saying "Sent to RAFAS".</li>
        </ol>
        <p>
          For files, duplicate the shortcut and call it <b>Send file to RAFAS</b>. Set it to receive <b>Files</b> and
          <b> PDFs</b>, and in step 5 use a <b>File</b> field named <code>file</code> instead.
        </p>
        <p>
          To use the inbox on any device, enter the token in the <b>Inbox</b> panel on the <Link to="/">reader page</Link>.
        </p>
      </section>

      <section id="email">
        <h2>Email documents in</h2>
        <p>
          Send or forward an email to <code>{inboxEmail}</code> from an approved address. For safety, mail from any
          other sender is turned away. The site owner manages the approved list.
        </p>
        <ul>
          <li>PDF, EPUB, TXT, Markdown or HTML attachments each become a document.</li>
          <li>An email that is just a link imports that article.</li>
          <li>Anything else is imported as the text of the email, with the subject as its title.</li>
        </ul>
        <p>Emailed items show up the next time you open RAFAS on a device that has the inbox token saved.</p>
      </section>

      <section id="trouble">
        <h2>Troubleshooting</h2>
        <h3>An article won't import</h3>
        <p>Some sites block automated access or need a login. Copy the text from the page and paste it instead.</p>
        <h3>A PDF is slow, or the text looks wrong</h3>
        <p>Scanned PDFs go through text recognition, which takes a few seconds per page and isn't perfect on low-quality scans.</p>
        <h3>An EPUB says no readable text</h3>
        <p>Books bought from most stores are copy-protected (DRM) and can't be opened outside the store's own app.</p>
        <h3>My library is empty</h3>
        <p>Each browser keeps its own library. Check you're on the same device and browser, and not in a private window. Clearing site data also clears the library.</p>
        <h3>Shared or emailed items don't appear</h3>
        <p>Make sure the inbox token is saved on this device, then press <b>Check inbox</b> in the library. A link that can't be imported stays in the inbox and shows an error.</p>
      </section>

      <p className="muted small">More about the name and how RSVP works: <Link to="/about">About RAFAS</Link>.</p>
    </article>
  );
}
