-- Step 1: Rename original table
ALTER TABLE contest_results RENAME TO contest_results_old;
ALTER TABLE question RENAME TO question_old;

-- Step 2: Create the new tables with only the required fields
CREATE TABLE contest_results (
    contest_id INTEGER,
    user_slug TEXT,
    rank INTEGER NOT NULL,
    solved INTEGER DEFAULT 0,
    num_contest_questions INTEGER DEFAULT 0,
    score INTEGER NOT NULL,
    contest_score INTEGER DEFAULT 0,
    finish_time REAL,
    data_region TEXT,
    PRIMARY KEY(contest_id, user_slug, data_region)
);

CREATE TABLE question (
  question_id INTEGER PRIMARY KEY,
  contest_id INTEGER,
  question_number INTEGER
);

-- WITHOUT ROWID because every column of this table is in its primary key.
--
-- The key order is the one getUserHistory reads it in -- contest_id first, then
-- the two columns that name the account -- so its per-contest lookup is a
-- prefix of this key. Reordering these four columns costs that query its index.
CREATE TABLE user_solved_questions (
  contest_id INTEGER,
  user_slug TEXT,
  data_region TEXT,
  question_id INTEGER,
  finish_time INTEGER,
  PRIMARY KEY(contest_id, user_slug, data_region, question_id)
) WITHOUT ROWID;

-- Step 3: Copy data
INSERT INTO contest_results (contest_id, user_slug, rank, score, finish_time, data_region)
SELECT contest_id, user_slug, rank, score, finish_time, data_region FROM contest_results_old;

INSERT INTO question (question_id, contest_id, question_number)
SELECT question_id, contest_id, question_number FROM question_old;

-- Step 4: Drop the old table
DROP TABLE contest_results_old;
DROP TABLE question_old;

-- Step 5: Generate the indices for the queries
--
-- These two are the whole of it: the app runs three statements, and between the
-- indices below and the primary keys declared above every table in all three is
-- reached by an index search rather than a scan. Two indices that look like
-- they ought to exist deliberately do not:
--
--   * Nothing on `question`. It is joined on question_id, which is an INTEGER
--     PRIMARY KEY and therefore the rowid -- already the cheapest lookup there
--     is. A covering (question_id, question_number) index was tried and the
--     planner ignores it, as it should.
--   * Nothing on `user_solved_questions`. Its primary key already covers the
--     only way it is queried; see the note on the table above.

-- Index 1: Optimizes Queries 1, 2, and 3 (User History & Aggregates)
CREATE INDEX idx_contest_results_user_region
ON contest_results (user_slug, data_region);

-- Index 2: Optimizes Query 4 (Autocomplete / Search by prefix)
-- The NOCASE collation is what lets `user_slug LIKE 'prefix%'` use an index at
-- all, so this cannot be folded into Index 1 despite the matching columns.
CREATE INDEX idx_contest_results_user_search
ON contest_results (user_slug COLLATE NOCASE, data_region);

-- Step 6: Make sure the database is ready to be uploaded to Turso
PRAGMA journal_mode = DELETE;
PRAGMA page_size = 4096;
PRAGMA auto_vacuum = 0;
PRAGMA encoding = 'UTF-8';

-- Step 7: Optimize the space
PRAGMA journal_mode = WAL;
