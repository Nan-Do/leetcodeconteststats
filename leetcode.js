// LeetCode's own site knows two things the results database does not: the rating
// a user carried out of each contest, and -- by leaving a contest out of that
// history -- which of the contests they competed in were never rated at all.
//
// Only leetcode.com accounts are here. A CN account lives on leetcode.cn with a
// separate rating of its own, so asking this endpoint about one returns nothing
// useful; callers pass the region and get null back rather than a wrong answer.

const GRAPHQL_URL = 'https://leetcode.com/graphql';

const RANKING_QUERY = `
  query userContestRankingInfo($username: String!) {
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
      totalParticipants
      topPercentage
      badge { name }
    }
    userContestRankingHistory(username: $username) {
      attended
      trendDirection
      problemsSolved
      totalProblems
      finishTimeInSeconds
      rating
      ranking
      contest { title startTime }
    }
  }
`;

// A rating stops moving once the contest that changed it has been rated, so an
// answer keeps for as long as the API responses built from it do.
const TTL_MS = 60 * 60 * 1000;
// An answer we failed to get is a different matter: remembering it for an hour
// would cost every visitor an empty rating card over a few seconds of trouble.
const FAILURE_TTL_MS = 60 * 1000;
// Long enough for a slow reply, short enough that a hanging one doesn't hold a
// page hostage for data it can be rendered without.
const TIMEOUT_MS = 6000;
const MAX_CACHED_USERS = 1000;

// Keyed by username, holding the in-flight promise rather than its result: the
// two endpoints a page load calls both want the same user, and starting them at
// the same moment must not become two requests to LeetCode.
const cache = new Map();

// The two sides name the same contest differently in two ways. The database
// stores `weekly-contest-341` where the API returns the title "Weekly Contest
// 341"; and everything up to contest 57 kept a `leetcode-` prefix that the
// titles have since dropped, so the database's `leetcode-weekly-contest-16a` is
// LeetCode's "Weekly Contest 16a". Both sides are reduced to the same key
// before anything is compared -- without the prefix rule the whole of a
// long-standing user's early career reads as unrated.
//
// The names from before the weeklies were numbered -- `warm-up-contest`, the
// Smarking rounds -- come through untouched, and are absent from LeetCode's
// rated history because they were never rated. That is the right answer.
const contestKey = (slug) => slug.replace(/^leetcode-/, '');

export const contestSlug = (title) => contestKey(title.trim().toLowerCase().replace(/\s+/g, '-'));

async function fetchContestRanking(userSlug) {
  let payload;
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'userContestRankingInfo',
        query: RANKING_QUERY,
        variables: { username: userSlug },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LeetCode replied ${res.status}`);
    payload = await res.json();
  } catch (err) {
    // This data supplements a page that is worth serving without it, so a
    // failure here is noted and handed on as "nothing known", not as an error.
    console.warn(`[leetcode] ${userSlug}: ${err.message}`);
    return null;
  }

  const history = payload?.data?.userContestRankingHistory;
  // An account LeetCode has never heard of returns null here. An empty history
  // is no more use: telling a rated contest from an unrated one is the whole
  // point, and an empty list would call every contest in the database unrated.
  if (!history?.length) return null;

  const contests = new Map();
  for (const entry of history) {
    if (entry?.contest?.title) contests.set(contestSlug(entry.contest.title), entry);
  }
  return {
    ranking: payload.data.userContestRanking ?? null,
    contests,
    // How the spelling of a contest name stays this file's business: callers
    // hand over the slug they hold and get back the entry, if there is one.
    entryFor: (databaseSlug) => contests.get(contestKey(databaseSlug)),
  };
}

// Returns { ranking, contests, entryFor } for a US account -- `ranking` being
// the summary LeetCode shows on the profile, `contests` that user's entry for
// each contest it rated them in -- or null when there is nothing to be had.
export function getContestRanking(userSlug, dataRegion) {
  if (dataRegion !== 'US') return Promise.resolve(null);

  const hit = cache.get(userSlug);
  if (hit && hit.expires > Date.now()) return hit.promise;

  // Held under the failure lifetime until the answer arrives, which is what
  // makes concurrent callers share one request without a success being cached
  // on the strength of a reply nobody has seen yet.
  const entry = { expires: Date.now() + FAILURE_TTL_MS, promise: null };
  entry.promise = fetchContestRanking(userSlug).then((result) => {
    entry.expires = Date.now() + (result ? TTL_MS : FAILURE_TTL_MS);
    return result;
  });

  cache.set(userSlug, entry);
  // Insertion order, so the entry dropped is the one asked for longest ago.
  if (cache.size > MAX_CACHED_USERS) cache.delete(cache.keys().next().value);
  return entry.promise;
}
