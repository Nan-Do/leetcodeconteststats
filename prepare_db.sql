-- Step 1: Rename original table
ALTER TABLE contest_results RENAME TO contest_results_old;

-- Step 2: Create new table with only the required fields
CREATE TABLE contest_results (
    contest_id INTEGER,
    user_slug TEXT,
    rank INTEGER NOT NULL,
    solved INTEGER DEFAULT 0,
    score INTEGER NOT NULL,
    contest_score INTEGER DEFAULT 0,
    finish_time REAL,
    data_region TEXT,
    PRIMARY KEY(contest_id, user_slug, data_region)
);

-- Step 3: Copy data
INSERT INTO contest_results (contest_id, user_slug, rank, score, finish_time, data_region)
SELECT contest_id, user_slug, rank, score, finish_time, data_region FROM contest_results_old;

-- Step 4: Drop the old table
DROP TABLE contest_results_old;

-- Step 5: Generate the indices for the queries
-- Index 1: Optimizes Queries 1, 2, and 3 (User History & Aggregates)
CREATE INDEX idx_contest_results_user_region 
ON contest_results (user_slug, data_region);

-- Index 2: Optimizes Query 4 (Autocomplete / Search by prefix)
CREATE INDEX idx_contest_results_user_search 
ON contest_results (user_slug COLLATE NOCASE, data_region);

-- Step 6: Make sure the database is ready to be uploaded to Turso
PRAGMA journal_mode = DELETE;
PRAGMA page_size = 4096;
PRAGMA auto_vacuum = 0;
PRAGMA encoding = 'UTF-8';
VACUUM;

-- Step 7: Optimize the space
PRAGMA journal_mode = WAL;
PRAGMA optimize
