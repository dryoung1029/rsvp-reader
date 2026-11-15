import React from "react";
import { Link } from "../router.jsx";

export default function Privacy() {
  return (
    <article className="page">
      <h1>Privacy</h1>
      <p className="lede">RAFAS is a small family project. It has no ads, no analytics and no tracking.</p>

      <h2>Your account</h2>
      <p>
        Your account holds your name, your email address and when you joined. Your email is used to send sign-in codes
        and to recognise documents you email in. Sign-in emails are sent through Resend, an email delivery service.
      </p>

      <h2>Your library</h2>
      <p>
        Documents you add, and your place in each one, are stored with your account on Cloudflare, so they can follow
        you between devices. A copy is also kept in the browser on each device you use. Other members can't see your
        library. The admin page shows the person who runs this RAFAS site each member's name, email and number of
        documents, not the documents themselves. As with any website, whoever runs the server could technically access
        what's stored on it.
      </p>
      <p>
        Deleting a document removes it from your account and your devices. Deleting your account (on the Account page)
        removes your account and everything in your library.
      </p>

      <h2>Reading stats</h2>
      <p>
        RAFAS records how many words you read each day and for how long, and each sitting's length, speed setting and
        hour of the day, to show your progress, streaks and achievements. If you join the family board, other people
        on the board see your totals, streaks, speeds, level, achievements and competition results. They never see
        what you're reading.
      </p>

      <h2>Other members</h2>
      <p>
        Members can see each other's names, so they can send each other documents. Sending a document gives the other
        person their own copy and emails them a notice.
      </p>

      <h2>Importing</h2>
      <ul>
        <li><b>Web links and share links:</b> the RAFAS server fetches the page or file for you and passes it back. Nothing is kept on the server except the resulting document in your library.</li>
        <li><b>Files you choose:</b> PDFs, EPUBs and Word files are read on your own device.</li>
        <li><b>The Send to RAFAS bookmark:</b> passes the page you're looking at straight to RAFAS in your browser, which keeps only the article text.</li>
        <li><b>Google Drive:</b> you sign in with Google in a Google window. RAFAS only gets access to the files you pick, and only on that device, for about an hour.</li>
        <li><b>Dropbox:</b> the Dropbox window gives RAFAS a link to the one file you pick.</li>
        <li><b>Scanned PDFs:</b> text recognition runs on your device. The first time, your browser downloads the recognition engine and English language data from jsDelivr, a public code delivery network.</li>
      </ul>

      <h2>Inbox</h2>
      <p>
        Items you email in or send with the iPhone Shortcut are held for you until one of your devices picks them up,
        then deleted from the inbox. Items nobody picks up are deleted after 30 days. Email from addresses that don't
        belong to a member is rejected and not stored.
      </p>

      <h2>On your device</h2>
      <p>RAFAS keeps a sign-in cookie, your reading settings and a copy of your library in your browser.</p>

      <p><Link to="/">Back to reading</Link></p>
    </article>
  );
}
