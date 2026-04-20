# Finance Dashboard - Built with Claude Code
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
    try:
        return render_template("index.html")
    except Exception as e:
        return jsonify({"error": "Could not load the dashboard page.", "details": str(e)}), 500


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
# AI Insights
# ---------------------------------------------------------------------------

@app.route("/api/insights")
def get_insights():
    """Analyse the user's real transaction data and return 4-5 personalised
    insights as a JSON list of {type, text} objects.

    Each insight has a 'type' of 'warning', 'tip', or 'positive' so the
    frontend can colour-code them. No external API is needed — all analysis
    runs in Python against the local database.
    """
    from datetime import date

    conn = get_connection()
    try:
        # --- All-time income (sum of positive transaction amounts) ---
        row = conn.execute(
            "SELECT SUM(amount) AS total FROM transactions WHERE amount > 0"
        ).fetchone()
        total_income = row["total"] or 0

        # --- All-time expenses (sum of negative amounts, made positive with ABS) ---
        row = conn.execute(
            "SELECT ABS(SUM(amount)) AS total FROM transactions WHERE amount < 0"
        ).fetchone()
        total_expenses = row["total"] or 0

        # --- Per-category spending, largest first ---
        # GROUP BY bundles all rows with the same category together, then
        # ABS(SUM(amount)) totals how much was spent in that category.
        rows = conn.execute("""
            SELECT
                c.name             AS category,
                ABS(SUM(t.amount)) AS total
            FROM transactions t
            JOIN categories c ON t.category_id = c.id
            WHERE t.amount < 0
            GROUP BY t.category_id
            ORDER BY total DESC
        """).fetchall()
        spending_by_category = [dict(r) for r in rows]

        # --- This month's income and expenses ---
        # date.today().strftime("%Y-%m") gives e.g. "2026-04".
        # LIKE '2026-04%' matches every date string starting with that prefix —
        # a simple way to filter to the current month without date functions.
        this_month = date.today().strftime("%Y-%m")
        row = conn.execute("""
            SELECT
                SUM(CASE WHEN amount > 0 THEN amount      ELSE 0 END)  AS income,
                ABS(SUM(CASE WHEN amount < 0 THEN amount  ELSE 0 END)) AS expenses
            FROM transactions
            WHERE date LIKE ?
        """, (f"{this_month}%",)).fetchone()
        month_income   = row["income"]   or 0
        month_expenses = row["expenses"] or 0
    finally:
        conn.close()

    # --- Helper: format a dollar amount with commas, e.g. 1234.5 → "$1,234.50" ---
    def usd(n):
        return f"${n:,.2f}"

    # --- Helper: compute a percentage, guarded against divide-by-zero ---
    def pct(part, whole):
        return round(part / whole * 100) if whole else 0

    insights = []

    # ── Rule 1: Housing % check (50/30/20 rule says housing ≤ 30%) ──────────
    # We look for any category whose name contains a housing-related keyword.
    # next(..., None) returns the first match, or None if there isn't one.
    housing_keywords = {"housing", "rent", "mortgage"}
    housing_cat = next(
        (c for c in spending_by_category
         if any(kw in c["category"].lower() for kw in housing_keywords)),
        None,
    )
    if housing_cat and total_expenses > 0:
        h_pct = pct(housing_cat["total"], total_expenses)
        if h_pct > 30:
            insights.append({
                "type": "warning",
                "text": (
                    f"Your {housing_cat['category']} spending is {h_pct}% of total expenses — "
                    f"above the 30% recommended by the 50/30/20 rule. "
                    f"If possible, look for ways to reduce this over time."
                ),
            })
        else:
            insights.append({
                "type": "positive",
                "text": (
                    f"Your {housing_cat['category']} spending is {h_pct}% of total expenses — "
                    f"within the recommended 30% guideline. Well done."
                ),
            })

    # ── Rule 2: Top spending category ───────────────────────────────────────
    if spending_by_category and total_expenses > 0:
        top = spending_by_category[0]
        top_pct = pct(top["total"], total_expenses)
        if top_pct > 40:
            insights.append({
                "type": "warning",
                "text": (
                    f"Your top category, {top['category']}, makes up {top_pct}% of all spending "
                    f"({usd(top['total'])}). This concentration limits flexibility — "
                    f"consider setting a monthly cap."
                ),
            })
        else:
            insights.append({
                "type": "tip",
                "text": (
                    f"Your biggest expense is {top['category']} at {usd(top['total'])} ({top_pct}%). "
                    f"This is your highest-leverage category for saving — "
                    f"small reductions here add up fast."
                ),
            })

    # ── Rule 3: This month — income vs expenses ──────────────────────────────
    if month_income > 0 or month_expenses > 0:
        if month_expenses > month_income:
            shortfall = month_expenses - month_income
            insights.append({
                "type": "warning",
                "text": (
                    f"You've spent {usd(shortfall)} more than you've earned so far this month "
                    f"({usd(month_expenses)} expenses vs {usd(month_income)} income). "
                    f"Review discretionary spending to avoid a shortfall."
                ),
            })
        else:
            insights.append({
                "type": "positive",
                "text": (
                    f"You're on track this month — income ({usd(month_income)}) "
                    f"is ahead of expenses ({usd(month_expenses)}). Keep it up."
                ),
            })

    # ── Rule 4: Category-specific savings tip ───────────────────────────────
    # Keyed off the name of the single biggest expense category.
    if spending_by_category:
        top_name = spending_by_category[0]["category"].lower()

        if any(kw in top_name for kw in ("housing", "rent", "mortgage")):
            tip_text = (
                "Consider negotiating your lease at renewal or exploring refinancing options. "
                "Even a 5% rent reduction saves hundreds of dollars per year."
            )
        elif any(kw in top_name for kw in ("food", "groceries", "dining", "restaurant")):
            tip_text = (
                "Meal planning for the week can cut food spending by 20–30%. "
                "Try cooking in batches on Sundays to reduce mid-week takeout."
            )
        elif any(kw in top_name for kw in ("entertainment", "subscriptions", "streaming")):
            tip_text = (
                "Audit your subscriptions — most people have 2–3 they forgot about. "
                "Canceling unused ones is instant, effortless savings."
            )
        elif any(kw in top_name for kw in ("transport", "car", "gas", "fuel")):
            tip_text = (
                "Combining errands into fewer trips and checking gas prices with an app "
                "can noticeably reduce transport costs each month."
            )
        elif any(kw in top_name for kw in ("shopping", "clothing", "clothes")):
            tip_text = (
                "Try a 30-day list: write down non-essential purchases and only buy them "
                "after 30 days. Most impulse buys feel unnecessary by then."
            )
        else:
            top_display = spending_by_category[0]["category"]
            tip_text = (
                f"Setting a monthly cap on {top_display} and checking it weekly "
                f"is the most reliable way to reduce spending in your top category."
            )

        insights.append({"type": "tip", "text": tip_text})

    # ── Rule 5: Overall savings rate ────────────────────────────────────────
    if total_income > 0:
        savings_rate = pct(total_income - total_expenses, total_income)
        monthly_gap  = round((total_income * 0.20 - (total_income - total_expenses)) / 12, 2)

        if savings_rate >= 20:
            insights.append({
                "type": "positive",
                "text": (
                    f"Your overall savings rate is {savings_rate}% — meeting or exceeding "
                    f"the 20% target in the 50/30/20 rule. Great financial discipline."
                ),
            })
        elif savings_rate > 0:
            insights.append({
                "type": "tip",
                "text": (
                    f"Your overall savings rate is {savings_rate}%. "
                    f"The 50/30/20 rule recommends saving 20% of income. "
                    f"Putting an extra {usd(monthly_gap)}/month aside would get you there."
                ),
            })
        else:
            insights.append({
                "type": "warning",
                "text": (
                    "Your total expenses have exceeded your total income. "
                    "Building even a small emergency fund should be the first priority."
                ),
            })

    # If there are no transactions at all, give a helpful nudge instead
    if not insights:
        insights.append({
            "type": "tip",
            "text": "No transaction data found. Add some transactions to see personalised insights.",
        })

    return jsonify({"insights": insights})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # debug=True auto-reloads the server when you save changes to the code.
    # Never use debug=True in production (on Render we'll turn it off).
    app.run(debug=True)
