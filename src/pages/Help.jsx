import React from "react";
import { Link } from "../router.jsx";

const SECTIONS = [
  ["start", "Getting started"],
  ["account", "Your account"],
  ["adding", "Adding documents"],
  ["cloud", "Google Drive, Dropbox, iCloud"],
  ["reading", "Reading controls"],
  ["pacing", "Pacing and chapters"],
  ["progress", "Progress and family"],
  ["achievements", "Achievements, levels and competitions"],
  ["rules", "Achievement rules"],
  ["sending", "Sending to family"],
  ["bookmarklet", "Saving pages on a computer"],
  ["keys", "Keyboard shortcuts"],
  ["library", "Library"],
  ["install", "Install the app"],
  ["phone", "Share from your phone"],
  ["email", "Email documents in"],
  ["trouble", "Troubleshooting"]
];

export default function Help({ inboxEmail, signedIn }) {
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
          <li>Sign in with your email{signedIn ? "" : " (you'll need an invite link the first time)"}.</li>
          <li>Add something to read: a file, a web link, or pasted text (see below).</li>
          <li>Press <b>Play</b>, or tap the middle of the word area.</li>
          <li>Adjust <b>Speed</b> until you can follow comfortably. 250 to 350 words per minute is a good start.</li>
          <li>Stop whenever you like. RAFAS saves your place automatically.</li>
        </ol>
      </section>

      <section id="account">
        <h2>Your account</h2>
        <p>
          Everyone has their own account and their own library. There are no passwords: when you sign in, RAFAS emails
          you a 6-digit code. Type the code in, or tap the button in the email.
        </p>
        <p className="callout">
          On iPhone, if you added RAFAS to your Home Screen, type the code into the app. The button in the email opens
          Safari, which signs in Safari rather than the Home Screen app.
        </p>
        <h3>Joining</h3>
        <p>
          New people join with an invite link from someone who manages RAFAS. Open the link, enter your name and email,
          then the code. Invite links can be limited to a number of people or a number of days.
        </p>
        <h3>Inviting family (admins)</h3>
        <p>
          Go to <Link to="/account">Account</Link> → <b>Invite people</b>, create a link, and send it by text or email.
          You can see who has joined and turn a link off at any time.
        </p>
        <h3>Phone and computer</h3>
        <p>
          Sign in on each device with the same email. Your library and your place in every document follow you. Stop
          reading on your phone and the computer picks up from the same word next time you open it.
        </p>
      </section>

      <section id="adding">
        <h2>Adding documents</h2>
        <h3>Files</h3>
        <p>
          Use <b>Choose file</b> in the Add panel, or on a computer drag a file onto the reader. Supported: PDF, EPUB,
          Word (.docx), TXT, Markdown, CSV and HTML. If a PDF is a scan with no text in it, RAFAS recognizes the text from the page
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

      <section id="cloud">
        <h2>Google Drive, Dropbox, iCloud</h2>
        <h3>Google Drive and Google Docs</h3>
        <p>
          Press <b>Google Drive</b> in the Add panel and pick a file. The first time, Google asks you to allow RAFAS to
          open the files you choose. RAFAS can only see files you pick. Google Docs come in as text; PDFs, Word files and
          EPUBs are read on your device.
        </p>
        <h3>Dropbox</h3>
        <p>Press <b>Dropbox</b> in the Add panel, sign in to Dropbox if asked, and pick a file.</p>
        <h3>iCloud Drive</h3>
        <p>
          Apple doesn't offer a way for websites to browse iCloud Drive directly, but your device does. On iPhone or
          iPad, tap <b>Choose file</b> → <b>Browse</b> → <b>iCloud Drive</b>. On a Mac, iCloud Drive is in the sidebar of
          the file window. On Windows, use the iCloud Drive folder if the iCloud app is installed.
        </p>
        <h3>Share links</h3>
        <p>
          You can also paste a share link into the article box and press <b>Import</b>. This works for Google Docs,
          Google Drive files, Dropbox and OneDrive, as long as the file is shared as "Anyone with the link".
        </p>
        <p className="muted small">The Google Drive and Dropbox buttons only appear once they've been set up for this site.</p>
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
            <tr><th>Context when paused</th><td>When you pause, the surrounding text appears under the word with your place highlighted. Tap any word to carry on from there. Turn it off in Settings.</td></tr>
            <tr><th>Position</th><td>Drag to jump anywhere in the document.</td></tr>
          </tbody>
        </table>
      </section>

      <section id="pacing">
        <h2>Pacing and chapters</h2>
        <h3>Smart pacing</h3>
        <p>
          Short, common words like "the" and "of" are recognised almost instantly, so RAFAS shows them a little faster
          and gives the extra time to long words and numbers. Your average speed stays close to the speed you chose.
          Turn it off in Settings for a perfectly even rhythm.
        </p>
        <h3>Warm-up</h3>
        <p>
          When you press Play after a break, RAFAS starts at 70% of your speed and builds up to full speed over about
          30 seconds. Quick pauses (under 10 seconds) don't restart the warm-up.
        </p>
        <h3>Chapters</h3>
        <p>
          For books and documents with chapters (EPUBs, PDFs with bookmarks, Word documents with headings, and
          Markdown or HTML files with headings), the current chapter and the time left in it appear under the
          controls. Tap it to see all chapters and jump to one.
        </p>
      </section>

      <section id="progress">
        <h2>Progress and family</h2>
        <p>
          <Link to="/progress">Progress</Link> shows how much you've read today and this week, your reading streak
          (days in a row with some reading), your average speed over the last 30 days, and a chart of the last two
          weeks. Words count while they're flashing, not when you skip ahead.
        </p>
        <p>
          The <b>Family</b> tab shows everyone's progress: level, streak, how much they've read, speed and
          achievements. Tap someone to see their full profile. Nobody sees what anyone is reading. Progress is shared
          with your family unless you choose <b>Hide my progress</b> on the Progress page; while it's hidden, you
          can't see the others' progress or compete either.
        </p>
      </section>

      <section id="achievements">
        <h2>Achievements, levels and competitions</h2>
        <h3>Achievements</h3>
        <p>
          There are 36 achievements to earn for reading a lot, reading fast, keeping a streak, finishing documents,
          sharing with family and doing well in competitions. Each is worth points: bronze ones are easy, gold and
          purple ones take real effort. A couple are secret until you earn them. A pop-up tells you when you unlock one.
          See them all, with your progress toward each, under <Link to="/progress/achievements">Progress → Achievements</Link>.
        </p>
        <p>
          Speed achievements count a whole sitting, from Play to Pause, at the slowest speed you used during it, so you
          have to hold the pace.
        </p>
        <h3>Quick checks (quizzes)</h3>
        <p>
          To stop anyone winning by turning the speed all the way up, reading only counts toward achievements, levels,
          competitions and leaderboards after you pass a quick check on it. After a few minutes of reading, a
          <b> Make it count</b> button appears under the reader: answer 3 multiple-choice questions about what you just read.
          Get all 3 right and those words count. Miss one and you get one more try with new questions. Reading always
          counts in your own stats either way.
        </p>
        <h3>Levels</h3>
        <p>
          You earn XP from reading (1 XP per 100 words) and from achievements (5 XP per point). Levels come with
          titles, from Skimmer up to Swizz Class.
        </p>
        <h3>Daily goal</h3>
        <p>Set a number of words to read each day on the Progress page. You'll get a pop-up when you reach it.</p>
        <h3>Monthly competitions</h3>
        <p>
          Everyone sharing their progress is automatically entered. Each calendar month there are four categories: most
          words, top speed (fastest sitting of 1,000+ words), most documents finished and most days read. Whoever
          reads the most words is the month's champion, and the top 3 earn a podium achievement once the month ends.
          Past champions are listed on the <Link to="/progress/compete">Compete</Link> tab.
        </p>
        <h3>Leaderboards</h3>
        <p>All-time rankings for level, words, achievements, best streak, top speed and titles won, plus a feed of who unlocked what.</p>
      </section>

      <section id="rules">
        <h2>Achievement rules</h2>
        <p>Everyone plays by the same rules, so the leaderboard means something:</p>
        <ul>
          <li>Reading counts toward achievements, levels, competitions and leaderboards after you pass the quick check on it. Everything you read always counts in your own stats.</li>
          <li>Each part of a document counts once. Rereading is fine, it just doesn't add again, and that includes adding the same text a second time.</li>
          <li>Speed records need a full sitting at that speed, in a full-length document.</li>
          <li>A document counts as finished when you've actually read most of it.</li>
          <li>Reading counts on the day you do it, and on one device at a time.</li>
          <li>Text has to be real reading. Very repetitive text doesn't count.</li>
          <li>Quick checks are timed, and the document's text is hidden while you answer.</li>
          <li>A streak day needs a real reading session, not just a few words.</li>
          <li>Sending a document counts once the other person reads it.</li>
          <li>There's a generous daily limit on how much can count.</li>
        </ul>
        <p className="muted small">The site admin can see notes about anything unusual. If something you read didn't count and you think it should have, ask them.</p>
      </section>

      <section id="sending">
        <h2>Sending to family</h2>
        <p>
          Press <b>Send to…</b> under the reader and pick someone. They get their own copy at the top of their library,
          starting from the beginning, plus an email letting them know. You can add a short note. Your copy and your
          place in it don't change. It counts toward your sending achievements once they've read it.
        </p>
      </section>

      <section id="bookmarklet">
        <h2>Saving pages on a computer</h2>
        <p>
          On your <Link to="/account">Account</Link> page, drag the <b>Send to RAFAS</b> button to your browser's
          bookmarks bar. On any article, click the bookmark: a small RAFAS window opens and saves the page to your
          library. Because it reads the page you're looking at, it works for articles behind a login or a paywall you
          have access to. Select some text first to save just that part.
        </p>
        <p className="muted small">If nothing happens, allow pop-ups for the site you're on.</p>
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
          Open any document to continue exactly where you stopped, on any device you're signed in on. Adding the same
          document again reopens your saved copy instead of making a duplicate. Use ✕ to delete a document everywhere.
        </p>
        <p>
          Each device also keeps a copy, so documents you've opened before still work without a connection. Changes
          sync when you're back online. Press <b>Sync</b> in the library to check right away.
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

        <h3>iPhone and iPad: the easy way (email)</h3>
        <p>
          On your <Link to="/account">Account</Link> page, tap <b>Add RAFAS to Contacts</b> and save the contact. After
          that, on any web page, PDF or file: tap Share → Mail → To: <b>RAFAS</b> → Send. Send it from the email address you
          sign in with. It's added to your library the next time you open RAFAS. Nothing else to set up.
        </p>

        <h3>iPhone and iPad: a RAFAS button in the Share menu</h3>
        <p>
          iOS doesn't let web apps appear in the Share menu, so this uses a Shortcut. If the Account page shows
          <b> Set up the Share button</b>, it's quick:
        </p>
        <ol>
          <li>Tap <b>Set up the Share button</b>. Your personal token is copied.</li>
          <li>Tap the Shortcut button, then <b>Add Shortcut</b>. There may be two: one for links and one for files. Add both.</li>
          <li>When each one asks for your token, paste it. It's the same token for both.</li>
        </ol>
        <p>From then on, RAFAS (or "Send to RAFAS") appears when you tap Share.</p>

        <h3>Building the Shortcut yourself</h3>
        <p>
          If there's no Set up button, build it once by hand. On your <Link to="/account">Account</Link> page, press
          <b> Create Shortcut token</b> and copy the token; you'll paste it in step 4.
        </p>
        <p>Make two shortcuts, one for links and text and one for files:</p>
        <ol>
          <li>Open <b>Shortcuts</b> and tap <b>+</b>. Tap the shortcut's name at the top and call it <b>Send to RAFAS</b>.</li>
          <li>Tap the <b>ⓘ</b> (or settings) button and turn on <b>Show in Share Sheet</b>. Set it to receive <b>URLs</b>, <b>Text</b> and <b>Safari web pages</b>.</li>
          <li>Add the action <b>Get Contents of URL</b>. Set the URL to <code>{origin}/api/inbox</code>.</li>
          <li>Tap the arrow to show more options. Method: <b>POST</b>. Add a header named <code>Authorization</code> with the value <code>Bearer</code> followed by a space and your token.</li>
          <li>Request Body: <b>Form</b>. Add a <b>Text</b> field named <code>text</code> and set its value to <b>Shortcut Input</b>.</li>
          <li>Add a <b>Show Notification</b> action and set its text to <b>Contents of URL</b>. It then says "Added to RAFAS" or explains what went wrong.</li>
        </ol>
        <p>
          For files, duplicate the shortcut and call it <b>Send file to RAFAS</b>. Set it to receive <b>Files</b> and
          <b> PDFs</b>, and in step 5 set Request Body to <b>File</b> with <b>Shortcut Input</b> (or a Form <b>File</b> field named <code>file</code>).
        </p>
      </section>

      <section id="email">
        <h2>Email documents in</h2>
        <p>
          Send or forward an email to <code>{inboxEmail}</code> from the address you sign in with. It goes into your
          own library. Mail from addresses that don't belong to a RAFAS account is turned away.
        </p>
        <ul>
          <li>PDF, EPUB, Word, TXT, Markdown or HTML attachments each become a document.</li>
          <li>An email that is just a link imports that article.</li>
          <li>Anything else is imported as the text of the email, with the subject as its title.</li>
        </ul>
        <p>Emailed items show up the next time you open RAFAS on any of your devices.</p>
      </section>

      <section id="trouble">
        <h2>Troubleshooting</h2>
        <h3>The sign-in email doesn't arrive</h3>
        <p>Check your spam or promotions folder for a message from RAFAS. Wait a minute, then use <b>Send a new code</b>. Only the newest few codes work.</p>
        <h3>An article won't import</h3>
        <p>Some sites block automated access or need a login. Copy the text from the page and paste it instead.</p>
        <h3>A PDF is slow, or the text looks wrong</h3>
        <p>Scanned PDFs go through text recognition, which takes a few seconds per page and isn't perfect on low-quality scans.</p>
        <h3>An EPUB says no readable text</h3>
        <p>Books bought from most stores are copy-protected (DRM) and can't be opened outside the store's own app.</p>
        <h3>A document is missing on another device</h3>
        <p>Press <b>Sync</b> in the library. Documents added while offline upload the next time that device is online; they show "not synced" until then.</p>
        <h3>A shared link says it isn't public</h3>
        <p>In Google Drive, Dropbox or OneDrive, change sharing to "Anyone with the link", or use the Google Drive or Dropbox button instead.</p>
        <h3>Emailed items don't appear</h3>
        <p>Make sure you sent it from the email address you sign in with, then press <b>Sync</b>. A link that can't be imported stays in your inbox and shows an error.</p>
        <h3>The Share button doesn't add anything</h3>
        <p>Your Shortcut probably holds an old token. On the <Link to="/account">Account</Link> page tap <b>Set up the Share button</b> to copy your current token, then in the Shortcuts app open each RAFAS shortcut and paste it after <code>Bearer </code> in the Authorization header.</p>
      </section>

      <p className="muted small">More about the name and how RSVP works: <Link to="/about">About RAFAS</Link>.</p>
    </article>
  );
}
