-- Step 1: Rename original table
ALTER TABLE contest_results RENAME TO contest_results_old;

-- Step 2: Create new table with only the required fields
CREATE TABLE contest_results (
    contest_id INTEGER,
    username TEXT NOT NULL,
    user_slug TEXT,
    rank INTEGER NOT NULL,
    score INTEGER NOT NULL,
    data_region TEXT,
    PRIMARY KEY(contest_id, user_slug, data_region)
);

-- Step 3: Copy data
INSERT INTO contest_results (contest_id, username, user_slug, rank, score, data_region)
SELECT contest_id, username, user_slug, rank, score, data_region FROM contest_results_old;

-- Step 4: Drop the old table
DROP TABLE contest_results_old;
