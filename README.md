# Social Media Content Analyzer

Upload a PDF or an image of a social media post. The app extracts the text —
parsing the PDF's layout, or running OCR on a scan — scores the post for
engagement against the target platform, and returns specific, ranked changes
that would improve it.

Two things make it more than a text-dump-plus-checklist:

1. **A source map.** Every extracted line is boxed over the rendered page and
   linked both ways to the text, and OCR words the engine was unsure about are
   outlined in red. Extraction is auditable instead of a black box.
2. **A rewrite engine.** It applies its own findings and hands back the improved
   draft with a before/after score, separating mechanical edits to your words
   from copy it wrote itself.

**Live app:** https://social-media-content-analyzer-ecpc54hh4.vercel.app

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

**Source map — extraction you can audit**

Most tools hand back a wall of text and ask you to trust it. This one keeps the
geometry that pdf.js and Tesseract already produce and normally throws away, so
every extracted line points back at the exact region it came from:

- The rendered page sits beside the text with a box over every extracted line
- Hover or click either side and the other highlights; clicking a line from
  another page switches the page view to follow it
- On OCR, words Tesseract was unsure about are outlined in red and counted in
  the margin — a misread digit becomes *visible* instead of silently wrong
- Boxes are positioned in percentages of the page's intrinsic size, so the
  overlay stays aligned at any width

**Engagement analysis**
- A 0–100 score with a breakdown across 13 weighted heuristics
- Suggestions ranked by how many points each one would actually recover, so the
  highest-leverage fix is always first
- Per-platform targets for X, LinkedIn, Instagram, Facebook and a generic
  profile; switching platform re-scores instantly without re-extracting

**Rewrite engine — the fixed post, not just the critique**

Anyone can print "add a call to action". This applies its own findings and
returns the improved draft, re-scored:

- **Mechanical edits** transform the author's own words and cannot invent
  meaning: delete filler, calm shouted caps and exclamation runs, group
  scattered hashtags into a closing line, break walls of text into scannable
  paragraphs, split an over-long hook at a sentence seam, trim to the platform
  limit at a word boundary.
- **Added copy** is anything the engine wrote itself — a closing ask, discovery
  hashtags derived from the post's own salient terms. It is labelled
  differently and described as a placeholder to replace, never passed off as
  the author's voice.
- Every edit is listed with what it did and why, and the panel shows the score
  before and after, so the diff is auditable rather than a black box.

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
    rewrite.js        the transforms that produce the improved draft
  ui/
    dropzone.js       drag-and-drop and file picker
    status.js         the live status region
    sourcemap.js      the page overlay and its two-way link to the text
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

**Extraction is treated as a claim, not a fact.** Both engines produce
coordinates and, in Tesseract's case, per-word confidence. Discarding that is
what makes an extractor a black box. Keeping it costs one render pass and turns
the output into something a reader can check — which matters most exactly when
OCR is least reliable.

**The draft is modelled as a body plus closing blocks,** not one string. That
separation is what lets the length trim cut prose without eating the call to
action it just added — trimming a flat string always destroys whatever sits at
the end, which is precisely the part that earns replies.

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
- The source map previews the first 12 pages of a long PDF; text is still
  extracted from every page.
- Line boxes are derived from baselines and font height, not true glyph bounding
  boxes, so they sit a pixel or two proud of tall ascenders.
- The rewrite engine will not restructure an argument or fix a weak idea. It
  applies the mechanical fixes and flags the rest as needing your judgement.

---

## Approach

A static client-side Vite build with two runtime dependencies: pdf.js and
Tesseract.js.

Both engines emit coordinates, and Tesseract emits per-word confidence. Most
implementations throw all of it away and return a wall of text you have to
trust. Keeping it is what this project is built around.

For PDFs, pdf.js returns positioned glyph runs rather than lines; joining them
naively collapses a formatted post into one blob and corrupts every readability
metric downstream. So the extractor rebuilds structure from the coordinates —
lines by baseline, spaces from horizontal gaps, paragraphs from vertical ones —
and keeps each line's box. A PDF carrying almost no embedded text is a scan, so
its pages are rendered and sent through OCR instead. The result is a source
map: the rendered page beside the text, every line boxed and linked both ways,
with low-confidence OCR words outlined so a misread is visible rather than
silent.

Analysis is rule-based, not an LLM call: deterministic, explainable, no key to
provision. `metrics.js` measures, `rules.js` judges, and `rewrite.js` applies
those findings back to the post — separating mechanical edits from copy it
wrote itself — and re-scores the draft.
