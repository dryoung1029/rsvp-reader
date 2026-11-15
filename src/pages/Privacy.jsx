import React from "react";
import { Link } from "../router.jsx";

export default function Privacy() {
  return (
    <article className="page">
      <h1>Privacy</h1>
      <p className="lede">RAFAS has no accounts, no ads and no analytics.</p>
      <h2>Your documents</h2>
      <p>
        Documents you open, and your reading progress, are stored in your browser on your own device. They are not
        uploaded anywhere. Deleting a document from the library, or clearing this site's data in your browser,
        removes it.
      </p>
      <h2>Web article imports</h2>
      <p>
        When you import a link, the RAFAS server fetches that page and sends back the article text. The page is not
        stored on the server.
      </p>
      <h2>Inbox (iPhone Shortcut and email)</h2>
      <p>
        Items sent to the inbox are held on the server until a device with the inbox token picks them up, and are
        then deleted from the server. Items nobody picks up are deleted automatically after 30 days. Emails from
        senders who aren't approved are rejected and not stored.
      </p>
      <h2>Scanned PDFs</h2>
      <p>
        Text recognition runs on your device. The first time it runs, your browser downloads the recognition engine
        and English language data from a public code delivery network (jsDelivr).
      </p>
      <h2>Settings</h2>
      <p>Your reading settings and inbox token are kept in your browser's local storage on each device.</p>
      <p><Link to="/">Back to reading</Link></p>
    </article>
  );
}
