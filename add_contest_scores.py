import argparse
import json
import sqlite3
from tqdm import tqdm


def main(database_path: str, jsonl_path: str):
    conn = sqlite3.connect(database_path)
    cursor = conn.cursor()

    with open(jsonl_path) as fp:
        data = json.load(fp)
        for contest in tqdm(data):
            contest_id = contest["contest_id"]
            score = contest["score"]

            cursor.execute(
                "UPDATE contest_results SET contest_score = ? WHERE contest_id = ?",
                (
                    score,
                    contest_id,
                ),
            )

    conn.commit()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Tool to fix the dates from leetcode database"
    )

    parser.add_argument(
        "--database",
        "-d",
        type=str,
        required=True,
        help="database to be modified (it needs to have a contest table with wrong dates)",
    )

    parser.add_argument(
        "--json",
        "-j",
        type=str,
        required=True,
        help="json file with the contest score data",
    )

    args = parser.parse_args()
    database_path: str = args.database
    jsonl_path: str = args.json

    main(database_path, jsonl_path)
