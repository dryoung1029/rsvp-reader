const express = require('express');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
app.use(express.json());

app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    const response = await fetch(url);
    const html = await response.text();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    res.json({ text: article?.textContent || '' });
  } catch {
    res.status(500).json({ error: 'Extraction failed' });
  }
});

app.use(express.static('dist'));

app.get('*', (_, res) => {
  res.sendFile(__dirname + '/dist/index.html');
});

app.listen(3000, () => console.log("Running"));