/**
 * The rewrite engine: applies the analyzer's own findings to the post and
 * returns an improved draft, plus the score it now earns.
 *
 * Two classes of edit, kept visibly distinct because they carry very different
 * authority:
 *
 *   `mechanical` — a transform on the author's own words that cannot invent
 *   meaning: deleting filler, calming shouted caps, breaking paragraphs,
 *   grouping hashtags, trimming to the platform limit.
 *
 *   `added` — new copy this engine wrote, because the post was missing
 *   something structural (a closing ask, discovery hashtags). These are
 *   labelled as drafts to replace, never presented as the author's voice.
 *
 * Every edit is reported with what it did and why, so the diff is auditable
 * rather than a black box that hands back different text.
 */
import { FILLER_WORDS, PLATFORMS, STOPWORDS } from './lexicon.js';
import { computeMetrics } from './metrics.js';
import { analyze } from './analyzer.js';

/** Short all-caps tokens that are acronyms, not shouting. */
const ACRONYM_MAX = 4;

const CTA_BY_PLATFORM = {
  twitter: 'What would you try instead? Reply and tell me.',
  linkedin: 'What has worked for you? Tell me in the comments.',
  instagram: 'Save this for your next post, and tell me which one you would try.',
  facebook: 'What would you add? Let me know in the comments.',
  generic: 'What would you add? Tell me in the comments.',
};

/** Tidy the spacing a deletion leaves behind, without touching line structure. */
function tidySpacing(text) {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([(«"'])\s+/g, '$1')
        .replace(/[ \t]+$/, '')
    )
    .join('\n');
}

/**
 * Restore line-initial capitals that a deletion knocked off, but only on lines
 * that were capitalised to begin with — never impose a style the author did not
 * already use.
 */
function restoreCapitals(before, after) {
  const originals = before.split('\n');
  return after
    .split('\n')
    .map((line, index) => {
      const original = originals[index];
      if (!original || !line) return line;
      const wasUpper = /^\s*[A-Z]/.test(original);
      const isLower = /^\s*[a-z]/.test(line);
      if (!wasUpper || !isLower) return line;
      return line.replace(/^(\s*)([a-z])/, (_, space, char) => space + char.toUpperCase());
    })
    .join('\n');
}

/** Split text into sentences, keeping their terminating punctuation. */
function splitSentences(text) {
  return text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [text];
}

/* ------------------------------------------------------------------ */
/* Mechanical transforms                                              */
/* ------------------------------------------------------------------ */

function stripFiller(text) {
  const found = [];
  let next = text;

  for (const phrase of FILLER_WORDS) {
    const pattern = phrase.includes(' ')
      ? new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[,]?\\s*`, 'gi')
      : new RegExp(`\\b${phrase}\\b[,]?\\s*`, 'gi');
    if (pattern.test(next)) {
      found.push(phrase);
      next = next.replace(pattern, '');
    }
  }

  if (found.length === 0) return null;
  next = restoreCapitals(text, tidySpacing(next));
  return {
    text: next,
    edit: {
      kind: 'mechanical',
      label: 'Removed filler',
      detail: `Deleted ${found.length} hedge/filler word(s): ${found.slice(0, 6).join(', ')}${found.length > 6 ? ', …' : ''}.`,
    },
  };
}

function calmEmphasis(text) {
  let shouted = 0;

  // Match runs of consecutive capitalised words, not single words: "WE ARE
  // THRILLED" is one shout, and fixing it a word at a time leaves "WE ARE
  // Thrilled". A lone short token is left alone — it is an acronym (API, CI).
  let next = text.replace(/\b[\p{Lu}][\p{Lu}'’]*(?:[ \t]+[\p{Lu}][\p{Lu}'’]*)*\b/gu, (run) => {
    const words = run.split(/[ \t]+/);
    const isAcronym = words.length === 1 && words[0].length <= ACRONYM_MAX;
    const isShout = words.length > 1 || words[0].length > ACRONYM_MAX;
    if (isAcronym || !isShout) return run;
    shouted += words.length;
    return run.charAt(0) + run.slice(1).toLowerCase();
  });

  let collapsed = 0;
  next = next.replace(/!{2,}/g, () => {
    collapsed += 1;
    return '!';
  });

  // Past two exclamation marks the emphasis stops meaning anything; keep the first.
  let dropped = 0;
  if ((next.match(/!/g) ?? []).length > 2) {
    let seen = 0;
    next = next.replace(/!/g, () => {
      seen += 1;
      if (seen === 1) return '!';
      dropped += 1;
      return '.';
    });
  }

  if (shouted === 0 && collapsed === 0 && dropped === 0) return null;

  const parts = [];
  if (shouted) parts.push(`${shouted} shouted word(s) set back to sentence case`);
  if (collapsed) parts.push(`${collapsed} repeated exclamation run(s) collapsed`);
  if (dropped) parts.push(`${dropped} surplus exclamation mark(s) replaced with full stops`);

  return {
    text: next,
    edit: {
      kind: 'mechanical',
      label: 'Calmed emphasis',
      detail: `${parts.join('; ')}. Emphasis only reads as emphasis when it is rare.`,
    },
  };
}

/**
 * Pull hashtags out of the prose and into the closing block. Returns the body
 * and the tags separately so later stages can budget around them.
 */
function breakParagraphs(text, metrics) {
  if (metrics.chars <= 400 || metrics.hasList || metrics.paragraphCount >= 3) return null;

  const blocks = text.split(/\n\s*\n/);
  let changed = false;
  const rebuilt = blocks.map((block) => {
    if (block.includes('\n') || block.length < 220) return block;
    const sentences = splitSentences(block).map((sentence) => sentence.trim()).filter(Boolean);
    if (sentences.length < 4) return block;
    changed = true;
    const chunks = [];
    for (let i = 0; i < sentences.length; i += 2) {
      chunks.push(sentences.slice(i, i + 2).join(' '));
    }
    return chunks.join('\n\n');
  });

  if (!changed) return null;
  return {
    text: rebuilt.join('\n\n'),
    edit: {
      kind: 'mechanical',
      label: 'Broke up the wall of text',
      detail:
        'Split long blocks into one- and two-sentence paragraphs. White space is what makes a post scannable on a phone.',
    },
  };
}

function splitHook(text, platform) {
  const lines = text.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstIndex === -1) return null;

  const hook = lines[firstIndex].trim();
  if (hook.length <= platform.hookChars) return null;

  // Cut at the last sentence end, then the last clause break, that still fits.
  const window = hook.slice(0, platform.hookChars);
  const sentenceSeam = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  const clauseSeam = Math.max(
    window.lastIndexOf(' — '),
    window.lastIndexOf(', '),
    window.lastIndexOf('; ')
  );
  const cut = sentenceSeam > 20 ? sentenceSeam + 1 : clauseSeam > 20 ? clauseSeam + 1 : -1;
  // No clean seam: cutting anywhere else would mangle the sentence, so leave it.
  if (cut < 0) return null;

  const head = hook.slice(0, cut).trim();
  const tail = hook.slice(cut).trim();
  if (!head || !tail) return null;
  lines.splice(firstIndex, 1, head, '', tail);

  return {
    text: lines.join('\n'),
    edit: {
      kind: 'mechanical',
      label: 'Tightened the hook',
      detail: `The opening ran past the ${platform.hookChars}-character fold on ${platform.name}. Split it at a sentence break so the whole hook is visible before "see more".`,
    },
  };
}

/**
 * Trim the body to fit the platform limit, leaving `reserved` characters for
 * the closing blocks that will be appended after it.
 */
function trimBody(body, platform, reserved) {
  const budget = platform.hardLimit - reserved;
  if (body.length <= budget) return null;

  const window = body.slice(0, budget);
  const seam = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('!\n'),
    window.lastIndexOf('?\n'),
    window.lastIndexOf('\n\n')
  );

  let kept;
  if (seam > budget * 0.5) {
    kept = window.slice(0, seam + 1).trim();
  } else {
    // No usable sentence break. Fall back to the last word boundary and mark
    // the cut — never slice through the middle of a word.
    const wordBreak = window.lastIndexOf(' ');
    kept = `${window.slice(0, wordBreak > 0 ? wordBreak : window.length).trim()}…`;
  }

  return {
    text: kept,
    edit: {
      kind: 'mechanical',
      label: 'Trimmed to the platform limit',
      detail: `Cut ${(body.length - kept.length).toLocaleString()} characters at a sentence break to fit ${platform.name}'s ${platform.hardLimit.toLocaleString()}-character limit, keeping room for the closing lines. Consider a thread if the removed part matters.`,
    },
  };
}

function groupHashtags(text) {
  const TAG = /(^|\s)(#[A-Za-z][\w-]{0,138})/g;
  if (!TAG.test(text)) return null;
  TAG.lastIndex = 0;

  const lines = text.split('\n');
  const lastIndex = lines.findLastIndex((line) => line.trim() !== '');
  // Already grouped when the closing line is nothing but tags and no tag
  // appears anywhere above it.
  const alreadyGrouped =
    lastIndex >= 0 &&
    /^\s*(#[\w-]+\s*)+$/.test(lines[lastIndex]) &&
    !lines.slice(0, lastIndex).some((line) => line.includes('#'));

  const tags = [];
  const stripped = text.replace(TAG, (_, lead, tag) => {
    tags.push(tag);
    return lead === '\n' ? lead : '';
  });
  const body = tidySpacing(stripped).replace(/\n{3,}/g, '\n\n').trim();

  return {
    body,
    tags,
    edit: alreadyGrouped
      ? null
      : {
          kind: 'mechanical',
          label: 'Grouped hashtags',
          detail: `Moved ${tags.length} hashtag(s) to their own closing line so they stop interrupting the sentences.`,
        },
  };
}

/* ------------------------------------------------------------------ */
/* Added copy                                                         */
/* ------------------------------------------------------------------ */

/** Derive candidate hashtags from the post's own salient words. */
function deriveHashtags(metrics, existing, wanted) {
  const counts = new Map();
  for (const word of metrics.words) {
    const key = word.toLowerCase();
    if (key.length < 5 || STOPWORDS.has(key) || /\d/.test(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const taken = new Set(existing.map((tag) => tag.replace('#', '').toLowerCase()));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    .filter((word) => !taken.has(word))
    .slice(0, wanted)
    .map((word) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}

/* ------------------------------------------------------------------ */

/** Assemble body and closing blocks into the final draft. */
function assemble(body, blocks) {
  return [body.trim(), ...blocks.filter(Boolean).map((block) => block.trim())]
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Produce an improved draft of `text` for the given platform.
 *
 * The draft is modelled as a body plus closing blocks (an ask, then hashtags)
 * rather than as one string. That separation is what lets the length trim cut
 * prose without eating the call to action it just added — trimming a flat
 * string always destroys whatever sits at the end, which is exactly the part
 * that earns replies.
 *
 * @returns {{text: string, edits: Array<object>, before: number, after: number, changed: boolean}}
 */
export function rewrite(text, platformKey = 'generic') {
  const platform = PLATFORMS[platformKey] ?? PLATFORMS.generic;
  const before = analyze(text, platformKey);

  let body = text.trim();
  let tags = [];
  let ask = '';
  const edits = [];

  const apply = (result) => {
    if (!result || result.text.trim() === body.trim()) return;
    body = result.text;
    edits.push(result.edit);
  };

  /* 1. Clean the author's own words. */
  apply(stripFiller(body));
  apply(calmEmphasis(body));

  /* 2. Lift hashtags out of the prose so they can be budgeted separately. */
  const grouped = groupHashtags(body);
  if (grouped) {
    body = grouped.body;
    tags = grouped.tags;
    if (grouped.edit) edits.push(grouped.edit);
  }

  /* 3. Restructure what is left. */
  apply(breakParagraphs(body, computeMetrics(body)));
  apply(splitHook(body, platform));

  /* 4. Add what is missing, as separate closing blocks. */
  const metrics = computeMetrics(assemble(body, [tags.join(' ')]));
  const needTags = platform.idealHashtags[0] - tags.length;
  if (needTags > 0) {
    const derived = deriveHashtags(metrics, tags, needTags);
    if (derived.length > 0) {
      tags = [...tags, ...derived];
      edits.push({
        kind: 'added',
        label: 'Suggested hashtags',
        detail: `Added ${derived.join(' ')} — drawn from the post's own most-used terms to reach ${platform.name}'s ${platform.idealHashtags[0]}-tag minimum. Swap these for tags your audience actually follows.`,
      });
    }
  }

  if (metrics.ctaHits.length === 0) {
    ask = CTA_BY_PLATFORM[platformKey] ?? CTA_BY_PLATFORM.generic;
    edits.push({
      kind: 'added',
      label: 'Added a closing ask',
      detail:
        'The post ended without asking for anything. This is placeholder copy — replace it with the response you actually want.',
    });
  }

  /* 5. Trim the body only, once the closing blocks are known and reserved. */
  const closing = [ask, tags.join(' ')].filter(Boolean);
  const reserved = closing.reduce((sum, block) => sum + block.length + 2, 0);
  const trimmed = trimBody(body, platform, reserved);
  if (trimmed) {
    body = trimmed.text;
    edits.push(trimmed.edit);
  }

  const draft = assemble(body, closing);
  const after = analyze(draft, platformKey);

  return {
    text: draft,
    edits,
    before: before.score,
    after: after.score,
    changed: edits.length > 0 && draft.trim() !== text.trim(),
  };
}
