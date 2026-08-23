# Social Media Content Analyzer

Upload a PDF or an image of a social media post. The app extracts the text —
parsing the PDF's layout, or running OCR on a scan — scores the post for
engagement against the target platform, and returns specific, ranked changes
that would improve it.

**Live app:** _add your deployed URL here_

Everything runs in the browser. No server, no API keys, and no file ever leaves
the user's device.

---

## Features

**Document upload**
- Drag-and-drop or click-to-browse, both on the same target
- Keyboard accessible (the dropzone is focusable and responds to Enter/Space)
- Type and size validated up front, with errors written for a person to read

**Text extraction**
- **PDF parsing** that reconstructs layout. pdf.js returns a flat list of
  positioned glyph runs; the extractor groups them into lines by baseline,
  inserts spaces at horizontal gaps, inserts blank lines at vertical ones, and
  preserves relative indentation, so bullets and paragraphs survive.
- **OCR** via Tesseract.js for PNG, JPG, WEBP, BMP and GIF.
- **Automatic fallback for scanned PDFs.** If a PDF yields almost no embedded
  text, each page is rendered to a canvas and passed through OCR instead of
  reporting an empty document.

**Engagement analysis**
- A 0–100 score with a breakdown across 13 weighted heuristics
- Suggestions ranked by how many points each one would actually recover, so the
  highest-leverage fix is always first
- Per-platform targets for X, LinkedIn, Instagram, Facebook and a generic
  profile; switching platform re-scores instantly without re-extracting

**UX**
- Determinate progress for every phase — PDF page count, OCR engine load, and
  recognition percentage
- One live region carries all loading, success and error states
- Light and dark themes, responsive to mobile, reduced-motion respected

---

## Running locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

To produce a production build:

```bash
npm run build
```

The output lands in `dist/` as a fully static site.

---

## Deploying

`dist/` is static, so any static host works. Asset paths are relative
(`base: './'` in `vite.config.js`), so the same build runs from a domain root
or from a project subpath such as GitHub Pages.

- **Vercel / Netlify** — build command `npm run build`, output directory `dist`
- **GitHub Pages** — push the contents of `dist/` to a `gh-pages` branch

---

## Project structure

```
index.html            markup and the three-step layout
src/
  main.js             wiring: intake → extraction → analysis → render
  styles.css          design tokens and all component styles
  extract/
    index.js          validation and routing by file type
    pdf.js            pdf.js parsing, layout reconstruction, OCR fallback
    ocr.js            Tesseract.js worker lifecycle and progress
  analyze/
    metrics.js        measurement only — counts, ratios, readability
    rules.js          the 13 weighted heuristics and their advice
    lexicon.js        platform targets and word lists
    analyzer.js       scoring and suggestion ranking
  ui/
    dropzone.js       drag-and-drop and file picker
    status.js         the live status region
    render.js         results rendering
```

The split between `metrics.js` and `rules.js` is deliberate: measurement has no
opinions, and every judgement lives in one file that is easy to tune or extend.

---

## Design decisions

**Client-side only.** OCR and PDF parsing both have good WASM/JS
implementations, so a backend would add deployment cost, cold starts and a
privacy question without buying anything. It also means the hosted demo works
for anyone, with no key to provision.

**Rule-based analysis rather than an LLM call.** The suggestions are
deterministic, explainable, instant, and free. Every score traces to a rule you
can read. An LLM would add a key, a rate limit, latency and non-reproducible
output for advice that is largely codified best practice. `analyze/rules.js` is
the seam where a model-backed rule could be added later.

**Explicit `ok` flags on rules.** Whether a rule counts as "already working"
is stated by the rule itself rather than inferred from a score threshold —
otherwise a card headed *working well* can end up carrying advice that reads
*add an emoji*.

**`intent: 'print'` when rasterising PDF pages.** pdf.js drives canvas
rendering with `requestAnimationFrame`, which browsers freeze in a background
tab. The default intent would leave OCR of a scanned PDF hanging forever if the
user switched tabs; the print intent renders synchronously instead.

---

## Known limitations

- OCR is English-only (`eng` traineddata). Other languages need an extra
  language pack.
- The sentiment and power-word lexicons are small and English-specific — they
  give a directional signal, not a calibrated measure.
- Handwriting and low-contrast photos OCR poorly; confidence is surfaced in the
  metadata so a bad read is visible rather than silent.
- Platform targets are published guidance, not per-account analytics. They are
  a starting point to tune, not ground truth.

---

## Approach

The app is a static, client-side Vite build with two runtime dependencies:
pdf.js and Tesseract.js.

Extraction routes on file type. For PDFs, the hard part is that pdf.js returns
positioned glyph runs rather than lines, and naively joining them collapses a
formatted post into one blob — which then corrupts every readability metric
downstream. So the extractor rebuilds structure from the coordinates: group
runs into lines by baseline, add spaces at horizontal gaps, add blank lines at
vertical ones, keep relative indents. If a PDF turns out to carry almost no
embedded text, it is a scan, and each page is rendered to canvas and sent
through OCR instead. Images go straight to OCR, with the Tesseract worker
created once and reused.

Analysis is deliberately rule-based, not an LLM call: deterministic,
explainable, instant, free, and no key to provision for a hosted demo.
`metrics.js` measures; `rules.js` judges. Thirteen weighted heuristics cover
length, hook, call to action, hashtags, emoji, readability, structure,
specificity, tone, concision, emphasis and links, each scored against the
selected platform's targets. Suggestions are ranked by the points each one
would recover, so the highest-leverage fix is always first.
