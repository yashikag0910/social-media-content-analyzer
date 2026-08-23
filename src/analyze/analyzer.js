/**
 * Orchestrates the analysis: measure the text, run the rules, and turn the
 * results into a score plus a list of suggestions ordered by how much each one
 * would actually move that score.
 */
import { computeMetrics } from './metrics.js';
import { evaluate } from './rules.js';
import { PLATFORMS } from './lexicon.js';

function band(score) {
  if (score >= 85) return { label: 'Strong', tone: 'good' };
  if (score >= 70) return { label: 'Solid', tone: 'good' };
  if (score >= 50) return { label: 'Needs work', tone: 'warn' };
  return { label: 'Weak', tone: 'bad' };
}

/**
 * @param {string} text extracted post text
 * @param {string} platformKey one of the keys in PLATFORMS
 */
export function analyze(text, platformKey = 'generic') {
  const platform = PLATFORMS[platformKey] ?? PLATFORMS.generic;
  const metrics = computeMetrics(text);

  if (metrics.wordCount === 0) {
    return {
      platform,
      metrics,
      score: 0,
      band: band(0),
      suggestions: [],
      strengths: [],
      empty: true,
    };
  }

  const results = evaluate(metrics, platform).map((rule) => ({
    ...rule,
    score: Math.max(0, Math.min(1, rule.score)),
    // How many points of the final score this rule is currently giving up.
    // Suggestions are ranked by this, so the biggest win is always first.
    impact: rule.weight * (1 - Math.max(0, Math.min(1, rule.score))),
  }));

  const totalWeight = results.reduce((sum, rule) => sum + rule.weight, 0);
  const earned = results.reduce((sum, rule) => sum + rule.weight * rule.score, 0);
  const score = Math.round((earned / totalWeight) * 100);

  const suggestions = results
    .filter((rule) => !rule.ok)
    .sort((a, b) => b.impact - a.impact)
    .map((rule) => ({
      ...rule,
      severity: rule.score < 0.35 ? 'high' : rule.score < 0.6 ? 'medium' : 'low',
    }));

  const strengths = results.filter((rule) => rule.ok);

  return { platform, metrics, score, band: band(score), suggestions, strengths, empty: false };
}

export { PLATFORMS };
