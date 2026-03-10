-- Step 1: Rename original table
ALTER TABLE contest_results RENAME TO contest_results_old;

-- Step 2: Create new table with only the required fields
CREATE TABLE contest_results (
    contest_id INTEGER,
    user_slug TEXT,
    rank INTEGER NOT NULL,
    score INTEGER NOT NULL,
    data_region TEXT,
    PRIMARY KEY(contest_id, user_slug, data_region)
);

-- Step 3: Copy data
INSERT INTO contest_results (contest_id, user_slug, rank, score, data_region)
SELECT contest_id, user_slug, rank, score, data_region FROM contest_results_old;

-- Step 4: Drop the old table
DROP TABLE contest_results_old;

-- Step 5: Generate the indices for the searches
CREATE INDEX idx_user_stats_history ON contest_results(
    user_slug,
    data_region,
    contest_id,
    rank,
    score
);

CREATE INDEX idx_user_search ON contest_results(
    user_slug COLLATE NOCASE, 
    data_region
);

-- Step 6: Make sure the database is ready to be uploaded to Turso
PRAGMA journal_mode = WAL;

-- Step 7: Optimize the space
VACUUM;
