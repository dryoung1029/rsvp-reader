const express = require('express');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Please provide a valid http or https URL.' });
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 RSVP Reader',
        'accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'The site did not allow the article to be fetched.' });
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    res.json({
      title: article?.title || url,
      byline: article?.byline || '',
      text: article?.textContent || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

app.use(express.static('dist'));

app.get(/.*/, (_, res) => {
  res.sendFile(__dirname + '/dist/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on', PORT));
