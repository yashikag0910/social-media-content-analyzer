/**
 * Turns raw post text into the countable facts the rules reason about.
 * Nothing here makes a judgement — it only measures.
 */
import {
  CALL_TO_ACTION,
  EMOJI_PATTERN,
  FILLER_WORDS,
  HASHTAG_PATTERN,
  MENTION_PATTERN,
  NEGATIVE_WORDS,
  POSITIVE_WORDS,
  POWER_WORDS,
  URL_PATTERN,
} from './lexicon.js';

/**
 * Approximate syllable count for a single English word. Exact syllabification
 * needs a dictionary; this vowel-group heuristic is the standard approximation
 * used for readability scores and is accurate enough for a relative signal.
 */
function countSyllables(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length === 0) return 0;
  if (cleaned.length <= 3) return 1;

  const groups = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);

  return groups ? groups.length : 1;
}

/** Collect every match of a global regex, resetting its lastIndex first. */
function matchAll(text, pattern, group = 0) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => match[group]);
}

/** Count how many phrases from a list appear in the text. */
function findPhrases(lowerText, phrases) {
  return phrases.filter((phrase) =>
    phrase.includes(' ')
      ? lowerText.includes(phrase)
      : new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerText)
  );
}

/**
 * @param {string} raw text extracted from the document
 * @returns {object} a flat bag of measurements
 */
export function computeMetrics(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const lower = text.toLowerCase();

  // Strip URLs before word statistics so a long link doesn't read as a sentence.
  const prose = text.replace(URL_PATTERN, ' ');

  const words = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const sentences = prose
    .split(/(?<=[.!?…])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, 1);

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount > 0 ? syllables / wordCount : 0;
  // Flesch Reading Ease: 0 = dense academic prose, 100 = very easy.
  const readability =
    wordCount > 0
      ? Math.max(0, Math.min(100, 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord))
      : 0;

  const lines = text.split('\n');
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim().length > 0);
  const hookText = (lines.find((line) => line.trim().length > 0) ?? '').trim();

  const positiveHits = findPhrases(lower, POSITIVE_WORDS);
  const negativeHits = findPhrases(lower, NEGATIVE_WORDS);
  const sentimentTotal = positiveHits.length + negativeHits.length;

  const allCapsWords = words.filter(
    (word) => word.length >= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)
  );

  return {
    text,
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    words,
    wordCount,
    sentenceCount,
    wordsPerSentence,
    readability,
    lines,
    paragraphCount: paragraphs.length,
    hookText,

    hashtags: matchAll(text, HASHTAG_PATTERN, 1),
    mentions: matchAll(text, MENTION_PATTERN, 1),
    urls: matchAll(text, URL_PATTERN),
    emojis: matchAll(text, EMOJI_PATTERN),

    questionCount: (text.match(/\?/g) ?? []).length,
    exclamationCount: (text.match(/!/g) ?? []).length,
    allCapsWords,

    ctaHits: findPhrases(lower, CALL_TO_ACTION),
    powerHits: findPhrases(lower, POWER_WORDS),
    fillerHits: findPhrases(lower, FILLER_WORDS),
    positiveHits,
    negativeHits,
    // −1 (all negative) to +1 (all positive); 0 when the copy is neutral.
    sentiment:
      sentimentTotal === 0 ? 0 : (positiveHits.length - negativeHits.length) / sentimentTotal,

    // A question aimed at the reader is a call to action even without an
    // imperative verb ("What worked best for you?").
    asksReader: sentences.some(
      (sentence) => sentence.includes('?') && /\b(you|your|yours)\b/i.test(sentence)
    ),

    hasNumbers: /\b\d+([.,]\d+)?%?\b/.test(prose),
    hasList: lines.some((line) => /^\s*(?:[-*•·]|\d+[.)])\s+/.test(line)),
  };
}
