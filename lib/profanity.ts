/**
 * Username profanity filter.
 *
 * Keeps a short hand-curated list of obvious slurs and bad words and
 * rejects any username whose normalized form contains one as a
 * substring. Normalized form = lowercase, underscores removed, leet
 * substitutions collapsed (0→o, 1→i, 3→e, 4→a, 5→s, 7→t).
 *
 * This is NOT a complete solution — it's a "no obvious sh*t" guard.
 * The long-term plan is a user report + admin review system, but
 * shipping a minimal filter today closes the worst-case surface for
 * new Premium users picking their username.
 *
 * Add new terms as needed. Keep the list terse and high-signal —
 * false positives on legitimate names (Scunthorpe problem) are more
 * annoying than false negatives since the user can just pick a
 * different variant.
 *
 * The list is deliberately NOT exported so it's harder to grep from
 * a client bundle. The exported `containsProfanity` function is the
 * only public surface.
 */

// Normalize a username into a form where common evasion tricks are
// flattened. Keeps it local to this file so callers never touch the
// raw list.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g');
}

// Hand-curated. Prioritize slurs + obvious offensive terms over
// every possible crude word — the filter is a floor, not a ceiling.
const BANNED_SUBSTRINGS: readonly string[] = [
  // Slurs (anti-Black, anti-LGBTQ, anti-Asian, etc.)
  'nigger', 'nigga', 'faggot', 'fagit', 'fagot', 'dyke', 'tranny', 'kike',
  'chink', 'gook', 'spic', 'wetback', 'beaner', 'raghead', 'towelhead',
  'retard', 'retarded',
  // Common bad words — keep short, high-signal
  'fuck', 'fucker', 'motherfucker', 'shit', 'bullshit', 'asshole',
  'bitch', 'bastard', 'cunt', 'pussy', 'dick', 'cock', 'penis', 'vagina',
  'boob', 'tits', 'whore', 'slut', 'hoe',
  // Nazi / hate
  'hitler', 'nazi', 'kkk',
  // Self-harm / suicide (for safety)
  'killyourself', 'kys',
  // Anatomy slang commonly used as insults
  'jackoff', 'jerkoff', 'handjob', 'blowjob', 'rimjob', 'analsex',
];

/**
 * Returns true if the given username contains a banned substring
 * after normalization. Case-insensitive; underscores are stripped;
 * common leet substitutions are collapsed.
 *
 * Safe to call from both server and client code — no dynamic imports,
 * no dependencies.
 */
export function containsProfanity(username: string): boolean {
  const n = normalize(username);
  for (const term of BANNED_SUBSTRINGS) {
    if (n.includes(term)) return true;
  }
  return false;
}
