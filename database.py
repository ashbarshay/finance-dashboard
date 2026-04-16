import os
import sqlite3

# Build an absolute path to finance.db in the same directory as this file.
# Using an absolute path means the database is always found in the right place
# regardless of which directory Gunicorn (or any other process) is launched from.
# os.path.dirname(__file__) → the folder this file lives in
# os.path.join(...)         → glue that folder path together with "finance.db"
DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")


def get_connection():
    """Open and return a connection to the database.

    row_factory = sqlite3.Row means each row comes back as a dictionary-like
    object, so we can write row["amount"] instead of row[3]. Much easier to read.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create all three tables if they don't already exist.

    We create accounts and categories first because the transactions table
    references them (foreign keys). You can't point to something that doesn't
    exist yet.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # --- accounts table ---
    # Stores your bank accounts and credit cards.
    # 'type' is one of: checking, savings, credit
    # 'balance' is the current amount of money in the account.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT NOT NULL,
            type    TEXT NOT NULL,
            balance REAL DEFAULT 0
        )
    """)

    # --- categories table ---
    # Labels for grouping transactions (e.g. Groceries, Rent).
    # 'color' is a hex color string like #4CAF50 — used for chart colors.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL,
            color TEXT NOT NULL
        )
    """)

    # --- transactions table ---
    # Every individual income or expense.
    # account_id links to the accounts table (which account was used).
    # category_id links to the categories table (what kind of spending it was).
    # amount is positive for income, negative for expenses.
    # date is stored as a text string in YYYY-MM-DD format (e.g. 2026-03-15).
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT NOT NULL,
            description TEXT,
            amount      REAL NOT NULL,
            category_id INTEGER REFERENCES categories(id),
            account_id  INTEGER REFERENCES accounts(id)
        )
    """)

    conn.commit()
    conn.close()


def seed_data():
    """Insert sample accounts, categories, and transactions.

    We check first whether data already exists so that re-running this
    script doesn't insert duplicate rows.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # --- Check if we've already seeded ---
    # COUNT(*) counts every row in the accounts table.
    # If the result is greater than 0, data is already there — skip inserting.
    row = cursor.execute("SELECT COUNT(*) FROM accounts").fetchone()
    if row[0] > 0:
        print("Sample data already exists, skipping seed.")
        conn.close()
        return

    # --- Insert accounts ---
    # executemany() inserts multiple rows at once from a list of tuples.
    # Each tuple maps to (name, type, balance).
    accounts = [
        ("Chase Checking",      "checking", 3240.50),
        ("Chase Savings",       "savings",  12800.00),
        ("Visa Credit Card",    "credit",   -640.75),
    ]
    cursor.executemany(
        "INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)",
        accounts
    )

    # --- Insert categories ---
    # Each category has a name and a hex color for use in charts.
    categories = [
        ("Income",          "#4CAF50"),  # green
        ("Housing",         "#2196F3"),  # blue
        ("Groceries",       "#FF9800"),  # orange
        ("Dining",          "#E91E63"),  # pink
        ("Transport",       "#9C27B0"),  # purple
        ("Entertainment",   "#00BCD4"),  # teal
        ("Health",          "#F44336"),  # red
        ("Utilities",       "#607D8B"),  # grey-blue
    ]
    cursor.executemany(
        "INSERT INTO categories (name, color) VALUES (?, ?)",
        categories
    )

    # Fetch the IDs that were just assigned so we can use them in transactions.
    # fetchall() returns every row; we build a dict like {"Income": 1, "Housing": 2, ...}
    cat_rows = cursor.execute("SELECT id, name FROM categories").fetchall()
    cat = {row["name"]: row["id"] for row in cat_rows}

    acc_rows = cursor.execute("SELECT id, name FROM accounts").fetchall()
    acc = {row["name"]: row["id"] for row in acc_rows}

    # Shorthand references for cleaner transaction list below
    checking = acc["Chase Checking"]
    savings   = acc["Chase Savings"]
    credit    = acc["Visa Credit Card"]

    # --- Insert 20 sample transactions ---
    # Dates spread across February and March 2026.
    # Positive amounts = money coming in (income).
    # Negative amounts = money going out (expenses).
    transactions = [
        # (date,         description,               amount,    category_id,              account_id)
        ("2026-02-01",  "Paycheck - Feb 1",          3200.00,  cat["Income"],            checking),
        ("2026-02-02",  "Rent - February",          -1500.00,  cat["Housing"],           checking),
        ("2026-02-04",  "Whole Foods",                -87.43,  cat["Groceries"],         credit),
        ("2026-02-06",  "Netflix",                   -15.99,   cat["Entertainment"],     credit),
        ("2026-02-08",  "Chipotle",                  -13.50,   cat["Dining"],            credit),
        ("2026-02-10",  "Metro card refill",         -33.00,   cat["Transport"],         checking),
        ("2026-02-12",  "CVS Pharmacy",              -24.60,   cat["Health"],            credit),
        ("2026-02-14",  "Trader Joe's",              -62.15,   cat["Groceries"],         credit),
        ("2026-02-18",  "Electric bill",             -95.00,   cat["Utilities"],         checking),
        ("2026-02-20",  "Freelance payment",         750.00,   cat["Income"],            checking),
        ("2026-02-22",  "Spotify",                   -10.99,   cat["Entertainment"],     credit),
        ("2026-02-25",  "Dinner at Nobu",            -78.00,   cat["Dining"],            credit),
        ("2026-03-01",  "Paycheck - Mar 1",          3200.00,  cat["Income"],            checking),
        ("2026-03-02",  "Rent - March",             -1500.00,  cat["Housing"],           checking),
        ("2026-03-05",  "Whole Foods",               -94.20,   cat["Groceries"],         credit),
        ("2026-03-07",  "Gas station",               -48.00,   cat["Transport"],         credit),
        ("2026-03-10",  "Internet bill",             -59.99,   cat["Utilities"],         checking),
        ("2026-03-14",  "Doctor copay",              -30.00,   cat["Health"],            credit),
        ("2026-03-20",  "Move savings",              500.00,   cat["Income"],            savings),
        ("2026-03-28",  "Starbucks",                  -6.75,   cat["Dining"],            credit),
    ]
    cursor.executemany(
        """INSERT INTO transactions (date, description, amount, category_id, account_id)
           VALUES (?, ?, ?, ?, ?)""",
        transactions
    )

    conn.commit()
    conn.close()
    print("Sample data inserted: 3 accounts, 8 categories, 20 transactions.")


if __name__ == "__main__":
    init_db()
    seed_data()
    print("Database ready.")
