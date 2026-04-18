from flask import Flask, jsonify, request, render_template
from database import get_connection, init_db, seed_data

# Create the Flask app. __name__ tells Flask where to look for templates and
# static files (it uses the directory this file lives in).
app = Flask(__name__)

# Ensure the database tables exist and demo data is loaded before the first
# request is handled. Both functions are safe to call on every startup:
# init_db() uses CREATE TABLE IF NOT EXISTS (skips if tables already exist),
# and seed_data() checks whether rows already exist before inserting.
# Running at module level (not inside __main__) means this also executes
# when Gunicorn imports the file — Gunicorn never triggers the __main__ block.
init_db()
seed_data()


@app.route("/")
def index():
    """Serve the dashboard HTML page.

    render_template() looks in the templates/ folder and returns the file
    as an HTTP response. The browser receives it and displays the page.
    """
    return render_template("index.html")


def rows_to_list(rows):
    """Convert a list of SQLite Row objects into a list of plain dicts.

    Flask's jsonify() can't handle SQLite Row objects directly — it needs
    plain Python dicts. dict(row) converts each row into one.
    """
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

@app.route("/api/accounts")
def get_accounts():
    """Return all accounts as JSON.

    SQL: SELECT * FROM accounts
    Plain English: Grab every row from the accounts table.
    """
    conn = get_connection()
    try:
        # fetchall() runs the query and returns every matching row as a list.
        rows = conn.execute("SELECT * FROM accounts").fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        # `finally` runs whether the code above succeeded or raised an error,
        # so the connection is always closed and never left open by accident.
        conn.close()


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@app.route("/api/categories")
def get_categories():
    """Return all categories as JSON.

    SQL: SELECT * FROM categories
    Plain English: Grab every row from the categories table.
    """
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM categories").fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    """Return all transactions as JSON, newest first.

    We JOIN to the categories and accounts tables so the response includes
    human-readable names (e.g. "Groceries") instead of raw IDs (e.g. 3).

    SQL explained:
      SELECT t.*, c.name as category_name, c.color as category_color, a.name as account_name
        - t.* means all columns from transactions
        - c.name AS category_name renames the category's name column to avoid
          clashing with other "name" columns
      FROM transactions t
        - 't' is a short alias for the transactions table
      JOIN categories c ON t.category_id = c.id
        - For each transaction, find the matching row in categories where the IDs match
      JOIN accounts a ON t.account_id = a.id
        - Same idea: attach the matching account row
      ORDER BY t.date DESC
        - Sort by date, newest first (DESC = descending)
    """
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT
                t.*,
                c.name  AS category_name,
                c.color AS category_color,
                a.name  AS account_name
            FROM transactions t
            JOIN categories c ON t.category_id = c.id
            JOIN accounts   a ON t.account_id  = a.id
            ORDER BY t.date DESC
        """).fetchall()
        return jsonify(rows_to_list(rows))
    finally:
        conn.close()


@app.route("/api/transactions", methods=["POST"])
def add_transaction():
    """Add a new transaction. Expects a JSON body with these fields:
        date, description, amount, category_id, account_id

    Example request body:
        {
            "date": "2026-04-09",
            "description": "Whole Foods",
            "amount": -54.20,
            "category_id": 3,
            "account_id": 1
        }
    """
    data = request.get_json()

    # get_json() returns None if the request body is missing, empty, or not
    # valid JSON (e.g. the Content-Type header wasn't set to application/json).
    # Without this check the loop below would crash with a TypeError.
    if not data:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    # Basic validation — make sure the required fields are present AND non-null.
    # We check both conditions because JSON can send a key with a null value
    # (e.g. {"account_id": null}), which passes a key-existence check but
    # would write NULL to the database and break the JOIN in the GET query.
    required = ["date", "amount", "category_id", "account_id"]
    for field in required:
        if field not in data or data[field] is None:
            return jsonify({"error": f"Missing field: {field}"}), 400

    conn = get_connection()
    try:
        # INSERT INTO adds a new row. The ? placeholders are filled in safely by
        # SQLite — this prevents a security issue called SQL injection where
        # malicious input could manipulate the query.
        cursor = conn.execute("""
            INSERT INTO transactions (date, description, amount, category_id, account_id)
            VALUES (?, ?, ?, ?, ?)
        """, (
            data["date"],
            data.get("description", ""),  # description is optional
            data["amount"],
            data["category_id"],
            data["account_id"],
        ))
        conn.commit()

        # Return the newly created transaction's ID with a 201 Created status code.
        return jsonify({"id": cursor.lastrowid, "message": "Transaction added."}), 201
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Summary (for dashboard cards and charts)
# ---------------------------------------------------------------------------

@app.route("/api/summary")
def get_summary():
    """Return totals used by the dashboard: total balance, income, expenses,
    and a breakdown of spending by category.

    This is the most complex query — broken down below.
    """
    conn = get_connection()
    try:
        # --- Total balance across all accounts ---
        # SUM(balance) adds up all the balance values in the accounts table.
        row = conn.execute("SELECT SUM(balance) AS total FROM accounts").fetchone()
        total_balance = row["total"] or 0

        # --- Total income: sum of all positive transaction amounts ---
        # WHERE amount > 0 filters to only rows where the amount is positive (income).
        row = conn.execute("""
            SELECT SUM(amount) AS total
            FROM transactions
            WHERE amount > 0
        """).fetchone()
        total_income = row["total"] or 0

        # --- Total expenses: sum of all negative transaction amounts ---
        # ABS() converts a negative number to positive (e.g. -1500 becomes 1500)
        # so the frontend can display it as a plain positive dollar figure.
        row = conn.execute("""
            SELECT ABS(SUM(amount)) AS total
            FROM transactions
            WHERE amount < 0
        """).fetchone()
        total_expenses = row["total"] or 0

        # --- Spending by category (for the chart) ---
        # GROUP BY category_id groups all transactions with the same category
        # together, then SUM(t.amount) totals the amounts within each group.
        # HAVING filters groups after aggregation — here we only want expense
        # categories (where the sum is negative).
        rows = conn.execute("""
            SELECT
                c.name          AS category,
                c.color         AS color,
                ABS(SUM(t.amount)) AS total
            FROM transactions t
            JOIN categories c ON t.category_id = c.id
            WHERE t.amount < 0
            GROUP BY t.category_id
            ORDER BY total DESC
        """).fetchall()
        spending_by_category = rows_to_list(rows)

        return jsonify({
            "total_balance":        round(total_balance, 2),
            "total_income":         round(total_income, 2),
            "total_expenses":       round(total_expenses, 2),
            "spending_by_category": spending_by_category,
        })
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # debug=True auto-reloads the server when you save changes to the code.
    # Never use debug=True in production (on Render we'll turn it off).
    app.run(debug=True)
