/**
 * Static reference data for the engagement analyzer: per-platform targets and
 * the small word lists the heuristics score against.
 *
 * These numbers come from widely published platform guidance and social-media
 * benchmark studies. They are deliberately ranges, not hard rules — the
 * analyzer treats them as targets to nudge toward, never as pass/fail gates.
 */

export const PLATFORMS = {
  generic: {
    name: 'Generic',
    hardLimit: 5000,
    idealChars: [80, 800],
    idealHashtags: [1, 5],
    idealEmoji: [1, 6],
    hookChars: 120,
    notes: 'Balanced targets that work reasonably across networks.',
  },
  twitter: {
    name: 'X (Twitter)',
    hardLimit: 280,
    idealChars: [70, 200],
    idealHashtags: [1, 2],
    idealEmoji: [0, 3],
    hookChars: 80,
    notes: 'Short posts with one or two hashtags perform best; links cost characters.',
  },
  linkedin: {
    name: 'LinkedIn',
    hardLimit: 3000,
    idealChars: [900, 1800],
    idealHashtags: [3, 5],
    idealEmoji: [0, 4],
    hookChars: 210,
    notes: 'Only the first ~210 characters show before “see more”.',
  },
  instagram: {
    name: 'Instagram',
    hardLimit: 2200,
    idealChars: [140, 1000],
    idealHashtags: [5, 12],
    idealEmoji: [2, 10],
    hookChars: 125,
    notes: 'Captions truncate around 125 characters; hashtags carry discovery.',
  },
  facebook: {
    name: 'Facebook',
    hardLimit: 63206,
    idealChars: [60, 500],
    idealHashtags: [0, 3],
    idealEmoji: [1, 5],
    hookChars: 250,
    notes: 'Shorter posts consistently out-perform long ones in the feed.',
  },
};

/** Phrases that ask the reader to do something. */
export const CALL_TO_ACTION = [
  'comment', 'share', 'like', 'follow', 'subscribe', 'sign up', 'signup',
  'register', 'join', 'download', 'read more', 'learn more', 'find out',
  'check out', 'click', 'tap', 'swipe', 'save this', 'bookmark', 'dm ',
  'message me', 'let me know', 'tell me', 'what do you think', 'thoughts',
  'try it', 'get started', 'book a', 'apply', 'rsvp', 'vote', 'tag a',
  'drop a', 'reply', 'retweet', 'repost',
];

/** Words that reliably lift click-through and stopping power. */
export const POWER_WORDS = [
  'free', 'new', 'proven', 'secret', 'instantly', 'surprising', 'essential',
  'ultimate', 'exclusive', 'guaranteed', 'because', 'you', 'your', 'now',
  'today', 'easy', 'simple', 'fast', 'best', 'worst', 'never', 'always',
  'mistake', 'mistakes', 'lesson', 'lessons', 'why', 'how', 'stop', 'start',
  'discover', 'unlock', 'boost', 'save', 'win', 'breakthrough', 'hidden',
];

/** Hedges and filler that dilute a sentence without adding meaning. */
export const FILLER_WORDS = [
  'very', 'really', 'just', 'quite', 'actually', 'basically', 'literally',
  'simply', 'somewhat', 'rather', 'perhaps', 'maybe', 'kind of', 'sort of',
  'in order to', 'due to the fact', 'at this point in time', 'needless to say',
  'it should be noted', 'utilize', 'leverage', 'synergy', 'paradigm',
];

/** Compact sentiment lexicon — enough to tell warm copy from flat copy. */
export const POSITIVE_WORDS = [
  'amazing', 'awesome', 'excellent', 'great', 'love', 'loved', 'happy',
  'excited', 'exciting', 'delighted', 'proud', 'thrilled', 'grateful',
  'thankful', 'wonderful', 'brilliant', 'success', 'successful', 'win',
  'winning', 'growth', 'improve', 'improved', 'better', 'best', 'strong',
  'helpful', 'inspiring', 'celebrate', 'congratulations', 'welcome', 'enjoy',
  'favourite', 'favorite', 'beautiful', 'perfect', 'incredible', 'fantastic',
];

export const NEGATIVE_WORDS = [
  'bad', 'worse', 'worst', 'hate', 'awful', 'terrible', 'horrible', 'sad',
  'angry', 'fail', 'failed', 'failure', 'problem', 'problems', 'issue',
  'issues', 'difficult', 'hard', 'struggle', 'struggling', 'disappointed',
  'frustrating', 'frustrated', 'wrong', 'broken', 'loss', 'lost', 'risk',
  'danger', 'warning', 'crisis', 'boring', 'confusing', 'painful',
];

/** Matches most emoji, including flags and skin-tone sequences. */
export const EMOJI_PATTERN =
  /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

export const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi;
export const HASHTAG_PATTERN = /(?:^|[^\w&/#])#([A-Za-z][\w-]{0,138})/g;
export const MENTION_PATTERN = /(?:^|[^\w&/@])@([A-Za-z0-9._-]{1,30})/g;
