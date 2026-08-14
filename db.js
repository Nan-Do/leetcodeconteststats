import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USE_LOCAL_DATABASE = process.env.LOCAL || false;
const DB_PATH = process.env.DB_PATH || join(__dirname, 'leetcodeconteststats.db')

let db;
if (USE_LOCAL_DATABASE) {
  console.log("Using local database")
  db = createClient({
    url: `file:${DB_PATH}`,
    readonly: true,
  });
}
else {
  console.log("Using remote database")
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// Case is part of a user's identity: `009-KumarJi` and `009-kumarji` are two
// different accounts with two different histories. The lookups below therefore
// match exactly, and this is the only place that matches case-insensitively —
// to turn whatever the caller typed into the one account it names, or to report
// that it names several. Callers pass the resolved slug on to those lookups.
export async function findUserCandidates(userSlug, dataRegion = null) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT user_slug, data_region
      FROM contest_results
      WHERE user_slug = ? COLLATE NOCASE
      ORDER BY user_slug, data_region
    `,
    args: [userSlug],
  });

  const candidates = dataRegion
    ? result.rows.filter((row) => row.data_region === dataRegion)
    : result.rows;

  // An exactly-cased match is the account the caller named, so it wins outright
  // instead of competing with its differently-cased namesakes.
  const exact = candidates.filter((row) => row.user_slug === userSlug);
  return exact.length ? exact : candidates;
}

// SQLite has no array type, so the solved questions below arrive as one
// comma-separated string per contest -- `number:seconds` a pair -- and as NULL
// for a contest the user solved nothing in, which is what group_concat makes of
// an empty group. Sorted because group_concat concatenates in whatever order
// the index walk produced, and a list that reads 1,3,2 in the response invites
// doubt about the data rather than about the ordering.
//
// `seconds` is null when the submission has no usable timestamp. That is the
// one case the pair has to be able to express: dropping the question instead
// would make one the user solved look like one they never got to.
const parseSolvedQuestions = (concatenated) => {
  if (!concatenated) return [];
  return String(concatenated)
    .split(',')
    .map((pair) => {
      const [question, seconds] = pair.split(':');
      return { question: Number(question), seconds: seconds === '' ? null : Number(seconds) };
    })
    .sort((a, b) => a.question - b.question);
};

// LeetCode does not record how many wrong submissions a user made, but it
// prices them: five minutes on the finish time for each one. So the gap between
// the last question the user actually solved and the finish time LeetCode
// recorded is the penalty they were charged, and the number of five-minute
// blocks in it is the number of wrong submissions that earned it. Both figures
// are already measured from the contest start, so the gap costs nothing the
// query has not fetched.
//
// Null rather than zero when the sum does not come out. A contest with no
// accepted submission has no last solve to measure from; and 1,177 rows in the
// 7.9M that do have one carry a finish time earlier than their own last solve,
// which no number of penalties explains. Both are "cannot say", and saying
// "none" of either would be inventing a fact.
const PENALTY_SECONDS = 5 * 60;

function countWrongSubmissions(totalSeconds, solvedQuestions) {
  const solveTimes = solvedQuestions.map((q) => q.seconds).filter((seconds) => seconds !== null);
  if (totalSeconds == null || !solveTimes.length) return null;

  const penalty = totalSeconds - Math.max(...solveTimes);
  if (penalty < 0) return null;
  // The gap is an exact multiple of the penalty for 99.98% of the database, so
  // rounding only has the 702 rows whose timestamps drifted to decide.
  return Math.round(penalty / PENALTY_SECONDS);
}

export async function getUserHistory(userSlug, dataRegion) {
  const result = await db.execute({
    sql: `
      SELECT
        c.contest_slug,
        c.time,
        c.num_participants,
        cr.rank,
        cr.score,
        cr.contest_score,
        cr.num_contest_questions,
        cr.solved,
        time(cr.finish_time - c.time, 'unixepoch') as total_time,
        -- The same figure in seconds, for countWrongSubmissions below to
        -- subtract the last solve from. Read off the row the query already has
        -- rather than parsed back out of the formatted string above.
        CAST(cr.finish_time - c.time AS INTEGER) as total_seconds,
        -- Which of the contest's questions were solved and how long each one
        -- took, not just how many. A subquery rather than a join, so a contest
        -- with three of them solved stays the one row the rest of this query is
        -- written to return; it reads the solved questions off the primary key,
        -- whose leading column is the contest_id it is being handed.
        --
        -- Both times in this row are measured from the same place, the contest
        -- start: total_time above off contest_results, each question's off its
        -- own submission. They will not agree, and should not -- LeetCode's
        -- finish time carries the penalty minutes for wrong submissions, so it
        -- runs later than the last question the user actually solved.
        --
        -- coalesce because a submission with no timestamp would otherwise make
        -- the whole pair NULL, and group_concat drops NULLs: a question the
        -- user solved would silently vanish from the list rather than arriving
        -- with an unknown time.
        (SELECT group_concat(q.question_number || ':'
                  || coalesce(CAST(usq.finish_time - c.time AS INTEGER), ''))
           FROM user_solved_questions usq
           JOIN question q ON q.question_id = usq.question_id
          WHERE usq.contest_id = cr.contest_id
            AND usq.user_slug = cr.user_slug
            AND usq.data_region = cr.data_region) AS solved_questions
      FROM contest_results cr
      JOIN contest c ON cr.contest_id = c.contest_id
      WHERE cr.user_slug = ? AND cr.data_region = ?
      ORDER BY c.time ASC
    `,
    args: [userSlug, dataRegion],
  });
  // total_seconds is scaffolding for the count below and stops here: total_time
  // is the same figure, and two spellings of it in the response are two things
  // that can disagree.
  return result.rows.map(({ total_seconds, ...contest }) => {
    const solved_questions = parseSolvedQuestions(contest.solved_questions);
    return {
      ...contest,
      solved_questions,
      wrong_submissions: countWrongSubmissions(total_seconds, solved_questions),
    };
  });
}

// Registering for a contest and not turning up, or turning up and submitting
// nothing, still lands in the table as a full row: a real rank, near the bottom
// of the field, with a score of 0. Those rows are the ones a user means by "I
// didn't compete that week", and left in they drag the averages down and stretch
// the chart's rank axis over ranks nobody competed for. So a contest counts as
// attended when the user scored in it. The same rule is written once more, as
// `hasAttended` in public/js/app.js, which filters the history rows the chart
// draws. Both have to agree.
export const hasAttended = (contest) => contest.score > 0;

// LeetCode occasionally leaves a contest unrated -- a broken problem, a leak,
// an outage during the window -- and the results still stand: everyone who
// competed has a rank, nobody's rating moved. The database has no idea which
// ones those were, so the flag is put on by annotateHistory below and is false
// for everyone LeetCode could not be asked about.
export const isRated = (contest) => !contest.unrated;

// The four ways the two switches under the chart can be set. Named so that the
// client can ask for a block of stats and a head-to-head tally by the same key,
// and defined once so that the sets the two are computed over cannot drift.
export const CONTEST_SETS = {
  all: () => true,
  attended: hasAttended,
  rated: isRated,
  attended_rated: (contest) => hasAttended(contest) && isRated(contest),
};

// Puts LeetCode's rating history next to the database's own record of who
// competed where, and returns plain rows -- the driver's are not meant to be
// added to, and these travel on to the client as JSON.
export function annotateHistory(history, contestRanking) {
  return history.map((contest) => {
    const entry = contestRanking?.entryFor(contest.contest_slug);
    // Present but flagged as a non-appearance still means LeetCode counted no
    // rated result for it.
    const rated = Boolean(entry) && entry.attended !== false;
    return {
      ...contest,
      rating: entry?.rating ?? null,
      // Keep track of the trend direction.
      trend_direction: entry?.trendDirection ?? null,
      // A contest the user scored in that LeetCode's rated history does not
      // list was never rated. Without an answer from LeetCode -- a CN account,
      // or a lookup that failed -- nothing is known to be unrated.
      unrated: Boolean(contestRanking) && hasAttended(contest) && !rated,
    };
  });
}

const round1 = (value) => Math.round(value * 10) / 10;

const NO_CONTESTS = {
  total_contests: 0,
  best_rank: null,
  avg_rank: null,
  best_score: null,
  avg_score: null,
  top500_count: 0,
  wins_count: 0,
  ak_count: 0,
};

// Collapses a set of contests into one block of stats.
function foldStats(contests) {
  if (!contests.length) return { ...NO_CONTESTS };

  const sum = (field) => contests.reduce((n, contest) => n + contest[field], 0);
  const count = (keep) => contests.reduce((n, contest) => n + (keep(contest) ? 1 : 0), 0);
  return {
    total_contests: contests.length,
    best_rating: Math.max(...contests.map((contest) => contest.rating)),
    best_rank: Math.min(...contests.map((contest) => contest.rank)),
    avg_rank: round1(sum('rank') / contests.length),
    best_score: Math.max(...contests.map((contest) => contest.score)),
    avg_score: round1(sum('score') / contests.length),
    top500_count: count((contest) => contest.rank <= 500),
    wins_count: count((contest) => contest.rank === 1),
    ak_count: count((contest) => contest.score === contest.contest_score),
  };
}

// Every figure the cards show, one block per way the switches can be set. The
// aggregates used to be a second query of their own, which could not have done
// this: which contests were rated is LeetCode's answer, not the database's, and
// a few hundred rows the history already fetched are cheaper to fold than to
// ask about again.
export function computeStats(history) {
  if (!history.length) return null;

  const stats = {};
  for (const [name, keep] of Object.entries(CONTEST_SETS)) {
    stats[name] = foldStats(history.filter(keep));
  }
  // What the notes under the switches report, and why each switch is there.
  stats.skipped_count = history.filter((contest) => !hasAttended(contest)).length;
  stats.unrated_count = history.filter((contest) => contest.unrated).length;
  return stats;
}

export async function searchUsers(query) {
  const result = await db.execute({
    sql: `
      SELECT DISTINCT user_slug, data_region
      FROM contest_results
      WHERE user_slug LIKE ?
      -- A NOCASE sort leaves case-only variants tied, and an unspecified tie
      -- order lets identical queries disagree about which one comes first.
      ORDER BY user_slug COLLATE NOCASE, user_slug, data_region
      LIMIT 20`,
    args: [`${query}%`],
  });
  return result.rows;
}
