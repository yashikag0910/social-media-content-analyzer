/**
 * The engagement heuristics.
 *
 * Every rule reports three things: a `score` in [0, 1] that feeds the overall
 * number, an `ok` flag saying whether this aspect is already fine, and a `fix`
 * written as something the author can act on. `ok` is stated explicitly rather
 * than derived from a score threshold — the two would drift apart, and a card
 * headed "working well" whose advice reads "add an emoji" is worse than no
 * card at all.
 *
 * Deliberately rule-based rather than an LLM call: deterministic, explainable,
 * no API key, and the whole app stays client-side.
 */

/**
 * Score a value against an ideal [min, max] window, decaying smoothly outside
 * it rather than snapping to zero. The floor on `span` keeps narrow windows
 * (say 1–2 hashtags) from collapsing the moment a value steps outside them.
 */
function rangeScore(value, [min, max]) {
  if (value >= min && value <= max) return 1;
  const distance = value < min ? min - value : value - max;
  return Math.max(0, 1 - distance / Math.max(max - min, 2));
}

const inRange = (value, [min, max]) => value >= min && value <= max;

const list = (items, limit = 4) => {
  const shown = items.slice(0, limit).join(', ');
  return items.length > limit ? `${shown}, …` : shown;
};

/**
 * @param {object} m metrics from computeMetrics
 * @param {object} p platform profile from PLATFORMS
 * @returns {Array<{id: string, label: string, weight: number, score: number, ok: boolean, headline: string, fix: string}>}
 */
export function evaluate(m, p) {
  const rules = [];
  const add = (rule) => rules.push(rule);

  /* ---------- Length ---------- */
  const [minChars, maxChars] = p.idealChars;
  if (m.chars > p.hardLimit) {
    add({
      id: 'length',
      label: 'Length',
      // Weighted above every other rule: a post over the platform's hard limit
      // cannot be published as written.
      weight: 9,
      score: 0,
      ok: false,
      headline: `${m.chars.toLocaleString()} characters exceeds the ${p.name} limit of ${p.hardLimit.toLocaleString()}`,
      fix: `Cut about ${(m.chars - p.hardLimit).toLocaleString()} characters, or split the post into a thread.`,
    });
  } else {
    add({
      id: 'length',
      label: 'Length',
      weight: 4,
      score: rangeScore(m.chars, p.idealChars),
      ok: inRange(m.chars, p.idealChars),
      headline: `${m.chars.toLocaleString()} characters (${m.wordCount} words)`,
      fix: inRange(m.chars, p.idealChars)
        ? `Comfortably inside the ${minChars}–${maxChars} character sweet spot for ${p.name}.`
        : m.chars < minChars
          ? `Short for ${p.name}. Add context or a concrete example to reach ${minChars}–${maxChars} characters.`
          : `Long for ${p.name}. Trim toward ${minChars}–${maxChars} characters — cut the setup, keep the payoff.`,
    });
  }

  /* ---------- Opening hook ---------- */
  const hookLength = m.hookText.length;
  const hookFits = hookLength > 0 && hookLength <= p.hookChars;
  const hookIsStrong =
    /\?/.test(m.hookText) ||
    /^\s*\d/.test(m.hookText) ||
    /\b(how|why|what|stop|never|most|here'?s|the one)\b/i.test(m.hookText);
  add({
    id: 'hook',
    label: 'Opening hook',
    weight: 5,
    score: hookLength === 0 ? 0 : (hookIsStrong ? 0.6 : 0.2) + (hookFits ? 0.4 : 0.1),
    ok: hookIsStrong && hookFits,
    headline:
      hookLength === 0
        ? 'No opening line found'
        : `First line is ${hookLength} characters${hookFits ? '' : ` — ${p.name} truncates around ${p.hookChars}`}`,
    fix: !hookIsStrong
      ? `Open with a question, a number, or a claim worth arguing with — the first ${p.hookChars} characters decide whether anyone expands the post.`
      : hookFits
        ? 'The opening earns attention and fits before the fold.'
        : `Strong opening, but it runs past the ${p.hookChars}-character fold. Tighten it so the whole hook is visible.`,
  });

  /* ---------- Call to action ---------- */
  add({
    id: 'cta',
    label: 'Call to action',
    weight: 5,
    score: m.ctaHits.length > 0 ? 1 : m.asksReader ? 0.7 : 0,
    ok: m.ctaHits.length > 0,
    headline:
      m.ctaHits.length > 0
        ? `Asks the reader to act (${list(m.ctaHits)})`
        : m.asksReader
          ? 'Asks the reader a direct question, but names no next step'
          : 'No call to action',
    fix:
      m.ctaHits.length > 0
        ? 'One clear ask — keep it that way, competing asks split the response.'
        : m.asksReader
          ? 'The question invites a reply. Name the action too — "drop it in the comments", "save this" — so the next step is unambiguous.'
          : 'Close with one specific ask: "What would you add?", "Save this for later", or a link with a reason to click.',
  });

  /* ---------- Conversation prompt ---------- */
  add({
    id: 'question',
    label: 'Conversation',
    weight: 3,
    score: m.questionCount > 0 ? 1 : 0,
    ok: m.questionCount > 0,
    headline: m.questionCount > 0 ? `${m.questionCount} question(s) asked` : 'No question asked',
    fix:
      m.questionCount > 0
        ? 'Questions invite replies, and replies weigh more than likes in almost every feed.'
        : 'Ask one open question. Comments are the strongest ranking signal on most networks.',
  });

  /* ---------- Hashtags ---------- */
  const [minTags, maxTags] = p.idealHashtags;
  const overlongTags = m.hashtags.filter((tag) => tag.length > 20);
  const tagsInRange = inRange(m.hashtags.length, p.idealHashtags);
  add({
    id: 'hashtags',
    label: 'Hashtags',
    weight: 3,
    score: rangeScore(m.hashtags.length, p.idealHashtags) * (overlongTags.length > 0 ? 0.8 : 1),
    ok: tagsInRange && overlongTags.length === 0,
    headline:
      m.hashtags.length === 0
        ? 'No hashtags'
        : `${m.hashtags.length} hashtag(s): ${list(m.hashtags.map((tag) => `#${tag}`))}`,
    fix: !tagsInRange
      ? m.hashtags.length < minTags
        ? `Add ${minTags - m.hashtags.length} or more relevant hashtag(s) — ${p.name} posts do best with ${minTags}–${maxTags}.`
        : `Drop ${m.hashtags.length - maxTags} hashtag(s). Past ${maxTags}, ${p.name} reads them as spam more than as topics.`
      : overlongTags.length > 0
        ? `Shorten ${list(overlongTags.map((tag) => `#${tag}`))} — long hashtags are hard to read and rarely searched.`
        : `${minTags}–${maxTags} is the right band for ${p.name}, and you are in it.`,
  });

  /* ---------- Emoji ---------- */
  const emojiInRange = inRange(m.emojis.length, p.idealEmoji);
  add({
    id: 'emoji',
    label: 'Emoji',
    weight: 2,
    score: rangeScore(m.emojis.length, p.idealEmoji),
    ok: emojiInRange,
    headline:
      m.emojis.length === 0 ? 'No emoji' : `${m.emojis.length} emoji: ${m.emojis.slice(0, 8).join(' ')}`,
    fix: emojiInRange
      ? 'Emoji use is proportionate — decorative, not distracting.'
      : m.emojis.length < p.idealEmoji[0]
        ? 'Add an emoji or two as visual punctuation — they break up the text block and lift scroll-stopping rate.'
        : `Trim to ${p.idealEmoji[1]} or fewer; dense emoji reads as noise and is hostile to screen readers.`,
  });

  /* ---------- Readability ---------- */
  add({
    id: 'readability',
    label: 'Readability',
    weight: 4,
    score: Math.max(0, Math.min(1, (m.readability - 30) / 40)),
    ok: m.readability >= 70,
    headline: `Flesch reading ease ${Math.round(m.readability)}/100 · ${m.wordsPerSentence.toFixed(1)} words per sentence`,
    fix:
      m.readability >= 70
        ? 'Easy to scan — this reads at the level feeds reward.'
        : m.readability >= 50
          ? 'Readable, but a few sentences are doing too much work. Break the longest ones in two.'
          : 'Dense for a feed. Split sentences over ~20 words and swap long words for short ones.',
  });

  /* ---------- Structure ---------- */
  const needsBreaks = m.chars > 400;
  const wellBroken = !needsBreaks || m.hasList || m.paragraphCount >= 3;
  add({
    id: 'structure',
    label: 'Structure',
    weight: 3,
    score: wellBroken ? 1 : Math.min(1, m.paragraphCount / 3),
    ok: wellBroken,
    headline: `${m.paragraphCount} paragraph(s)${m.hasList ? ', includes a list' : ''}`,
    fix: !wellBroken
      ? 'Break this into short paragraphs of one or two lines. Walls of text get scrolled past.'
      : needsBreaks
        ? 'Well broken up — the white space makes it scannable on a phone.'
        : 'Short enough that it reads fine as a single block.',
  });

  /* ---------- Specificity ---------- */
  const powerScore = Math.min(1, m.powerHits.length / 3);
  add({
    id: 'specificity',
    label: 'Specificity',
    weight: 3,
    score: (m.hasNumbers ? 0.6 : 0) + 0.4 * powerScore,
    ok: m.hasNumbers,
    headline: `${m.hasNumbers ? 'Contains concrete numbers' : 'No concrete numbers'} · ${m.powerHits.length} high-impact word(s)`,
    fix: m.hasNumbers
      ? 'Specifics are what make a claim quotable — keep them near the top.'
      : 'Add a number: a result, a timeframe, a count. "Grew 3× in 6 weeks" outperforms "grew a lot".',
  });

  /* ---------- Tone ---------- */
  add({
    id: 'tone',
    label: 'Tone',
    weight: 2,
    score: m.sentiment >= 0.2 ? 1 : m.sentiment <= -0.4 ? 0.3 : 0.65,
    ok: m.sentiment >= 0.2,
    headline:
      m.sentiment > 0.2 ? 'Positive tone' : m.sentiment < -0.2 ? 'Negative tone' : 'Neutral tone',
    fix:
      m.sentiment >= 0.2
        ? 'Warm, energetic phrasing. That consistently outperforms neutral copy.'
        : m.sentiment <= -0.4
          ? 'Heavily negative. If the problem is the point, still end on what you learned or what to do next.'
          : 'Flat in tone. A little conviction — what surprised you, or why it matters — travels further than neutral reporting.',
  });

  /* ---------- Filler ---------- */
  add({
    id: 'filler',
    label: 'Concision',
    weight: 2,
    score: Math.max(0, 1 - m.fillerHits.length / 5),
    ok: m.fillerHits.length === 0,
    headline:
      m.fillerHits.length === 0
        ? 'No filler words'
        : `${m.fillerHits.length} filler word(s): ${list(m.fillerHits)}`,
    fix:
      m.fillerHits.length === 0
        ? 'Tight writing — nothing padding the sentences.'
        : `Delete ${list(m.fillerHits)}. Each one weakens the sentence around it without adding meaning.`,
  });

  /* ---------- Shouting ---------- */
  const capsOk = m.allCapsWords.length <= 2;
  const bangsOk = m.exclamationCount <= 2;
  add({
    id: 'shouting',
    label: 'Emphasis',
    weight: 2,
    score: (capsOk ? 0.5 : 0) + (bangsOk ? 0.5 : 0),
    ok: capsOk && bangsOk,
    headline: `${m.allCapsWords.length} all-caps word(s) · ${m.exclamationCount} exclamation mark(s)`,
    fix:
      capsOk && bangsOk
        ? 'Emphasis is used sparingly, which is what makes it land.'
        : 'Ease off the caps and exclamation marks — reserve them for one moment, or they stop signalling anything.',
  });

  /* ---------- Links & mentions ---------- */
  const linkOk = m.urls.length >= 1 && m.urls.length <= 2;
  add({
    id: 'links',
    label: 'Links & mentions',
    weight: 2,
    score: (linkOk ? 1 : m.urls.length === 0 ? 0.5 : 0.4) * 0.6 + (m.mentions.length > 0 ? 1 : 0.4) * 0.4,
    ok: linkOk && m.mentions.length > 0,
    headline: `${m.urls.length} link(s) · ${m.mentions.length} mention(s)`,
    fix:
      m.urls.length > 2
        ? 'More than two links splits attention, and most feeds suppress them. Keep one.'
        : m.urls.length === 0
          ? 'No link. If there is somewhere to send people, one link with a reason to click belongs here.'
          : m.mentions.length === 0
            ? 'Tag the people or brands involved — mentions pull their audience into the thread.'
            : 'Link and mentions are in good balance.',
  });

  return rules;
}
