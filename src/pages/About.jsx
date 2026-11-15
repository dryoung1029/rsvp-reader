import React, { useEffect, useState } from "react";
import { Link } from "../router.jsx";

const DEMO = "Your eyes stay still and the words come to you.".split(" ");

function DemoReader() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % DEMO.length), i === DEMO.length - 1 ? 1200 : 300);
    return () => clearTimeout(t);
  }, [i]);
  return <div className="demo-word" aria-hidden="true">{DEMO[i]}</div>;
}

export default function About() {
  return (
    <article className="page">
      <h1>About RAFAS</h1>
      <p className="lede">RAFAS stands for <b>Read As Fast As Swizz</b>.</p>

      <p>
        Swizz is my daughter, and she is a very fast reader. RAFAS is named after her, and the name is the goal:
        read as fast as Swizz.
      </p>

      <h2>How it works</h2>
      <DemoReader />
      <p>
        RAFAS uses <b>rapid serial visual presentation</b> (RSVP). Instead of moving your eyes along lines of text,
        the words appear one at a time in the same spot. A lot of normal reading time goes into eye movements and
        finding the start of the next line, and RSVP removes most of that.
      </p>
      <p>
        One letter in each word is shown in red. That is the <b>pivot letter</b>, placed slightly left of center,
        near where your eye naturally lands when recognizing a word. Every word is lined up on its pivot, so your
        eye never has to move.
      </p>
      <p>
        Adults typically read silently at roughly 240 words per minute. Many people can follow RSVP comfortably at
        300 to 450 with a little practice. Start slow, raise the speed gradually, and slow down for dense material.
        Going faster than you can understand isn't really reading.
      </p>

      <h2>What RAFAS does</h2>
      <ul>
        <li>Reads web articles, PDFs (including scanned ones, using text recognition), EPUB books, text files and pasted text.</li>
        <li>Keeps a library of everything you open and remembers your place in each one.</li>
        <li>Works on phones and computers, and can be installed as an app.</li>
        <li>Lets you share documents straight from your phone, or email them in.</li>
        <li>Keeps your documents on your own device. See <Link to="/privacy">Privacy</Link>.</li>
      </ul>

      <p>New here? The <Link to="/help">Help page</Link> covers everything, or just <Link to="/">start reading</Link>.</p>
    </article>
  );
}
