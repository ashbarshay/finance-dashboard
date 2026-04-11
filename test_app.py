"""
test_app.py — automated tests for the Finance Dashboard API.

Run with:
    python3 -m unittest test_app.py -v

The -v flag (verbose) prints each test name as it runs so you can see
what passed and what failed.

Key idea — test isolation:
    Tests must never read from or write to the real finance.db.
    Each test gets its own fresh, temporary SQLite file that is created
    in setUp() and deleted in tearDown(). We redirect the database module
    to use that temp file by setting database.DB_PATH before each test.
"""

import json
import os
import tempfile
import unittest

# Import the Flask app object and the database module.
# Importing 'database' (not just individual functions) lets us change
# database.DB_PATH at test time to point at our temporary file.
import database
from app import app


class TestAPI(unittest.TestCase):
    """All API tests live in this class.

    unittest runs setUp() before every test and tearDown() after every test,
    so each test starts with a clean, isolated database.
    """

    # ------------------------------------------------------------------
    # Test lifecycle helpers
    # ------------------------------------------------------------------

    def setUp(self):
        """Runs before each individual test.

        Creates a temporary SQLite file, points the database module at it,
        builds the tables, and inserts small known test data.
        """
        # tempfile.mkstemp() creates an empty file and returns:
        #   db_fd  — a file descriptor (a number that represents the open file)
        #   db_path — the full path to the file, e.g. /tmp/tmpXYZ.db
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")

        # Redirect ALL database calls to the temp file.
        # get_connection() looks up DB_PATH at call time, so changing it here
        # affects every request made through the test client below.
        database.DB_PATH = self.db_path

        # Create the accounts, categories, and transactions tables.
        database.init_db()

        # Insert a small, predictable set of data so we know exactly what
        # totals and rows to expect in our assertions.
        self._seed_test_data()

        # Flask's test client sends HTTP requests to the app without needing
        # a real running server. TESTING=True turns off Flask's error catching
        # so test failures surface as real Python exceptions.
        app.config["TESTING"] = True
        self.client = app.test_client()

    def tearDown(self):
        """Runs after each individual test.

        Closes and deletes the temporary database file so tests don't
        leave junk files behind on the machine.
        """
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def _seed_test_data(self):
        """Insert minimal known data into the temp database.

        We use small, round numbers so expected totals are easy to reason about:
            total_balance  = $1,000.00  (one account)
            total_income   = $500.00    (one income transaction)
            total_expenses = $80.00     (one expense transaction)
        """
        conn = database.get_connection()

        conn.execute(
            "INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)",
            ("Test Checking", "checking", 1000.00),
        )
        conn.execute(
            "INSERT INTO categories (name, color) VALUES (?, ?)",
            ("Income", "#4CAF50"),
        )
        conn.execute(
            "INSERT INTO categories (name, color) VALUES (?, ?)",
            ("Groceries", "#FF9800"),
        )

        # Fetch the IDs that were just assigned so we can reference them.
        # fetchone() returns a single row; ["id"] grabs the id column.
        income_id    = conn.execute("SELECT id FROM categories WHERE name='Income'").fetchone()["id"]
        groceries_id = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()["id"]
        account_id   = conn.execute("SELECT id FROM accounts WHERE name='Test Checking'").fetchone()["id"]

        conn.execute(
            "INSERT INTO transactions (date, description, amount, category_id, account_id) VALUES (?, ?, ?, ?, ?)",
            ("2026-04-01", "Paycheck", 500.00, income_id, account_id),
        )
        conn.execute(
            "INSERT INTO transactions (date, description, amount, category_id, account_id) VALUES (?, ?, ?, ?, ?)",
            ("2026-04-02", "Whole Foods", -80.00, groceries_id, account_id),
        )
        conn.commit()
        conn.close()

    # ------------------------------------------------------------------
    # GET endpoint status code tests
    # ------------------------------------------------------------------

    def test_get_accounts_status(self):
        """GET /api/accounts should return HTTP 200 and a non-empty list.

        This confirms the accounts endpoint is reachable and returns
        the format the frontend expects (a JSON array).
        """
        res = self.client.get("/api/accounts")

        self.assertEqual(res.status_code, 200)

        # res.get_json() parses the response body as JSON.
        # We expect a list (Python: []) because the frontend loops over it.
        data = res.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)  # at least one account from seed data

    def test_get_categories_status(self):
        """GET /api/categories should return HTTP 200 and a non-empty list."""
        res = self.client.get("/api/categories")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)

    def test_get_transactions_status(self):
        """GET /api/transactions should return HTTP 200 and a non-empty list."""
        res = self.client.get("/api/transactions")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)

    # ------------------------------------------------------------------
    # POST /api/transactions — happy path
    # ------------------------------------------------------------------

    def test_post_transaction_success(self):
        """A valid POST to /api/transactions should return HTTP 201.

        HTTP 201 means 'Created' — the server successfully made a new resource.
        The response body should include the new row's id.
        """
        # Look up the real IDs from the temp DB so we pass valid foreign keys.
        conn = database.get_connection()
        cat_id = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()["id"]
        acc_id = conn.execute("SELECT id FROM accounts").fetchone()["id"]
        conn.close()

        payload = {
            "date":        "2026-04-10",
            "description": "Test Market",
            "amount":      -25.00,
            "category_id": cat_id,
            "account_id":  acc_id,
        }

        # content_type tells Flask to parse the body as JSON, matching how
        # our frontend sends the request (headers: {"Content-Type": "application/json"}).
        res = self.client.post(
            "/api/transactions",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 201)

        body = res.get_json()
        self.assertIn("id", body)  # response should include the new row's id

    def test_post_transaction_saves_to_db(self):
        """After a valid POST, the new transaction should actually exist in the database.

        This is a deeper test than checking the status code — it queries the
        database directly after the POST to confirm the data was truly written.
        This is exactly the kind of bug we fixed earlier (form appeared to work
        but data wasn't saved due to a NULL account_id).
        """
        conn = database.get_connection()
        cat_id = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()["id"]
        acc_id = conn.execute("SELECT id FROM accounts").fetchone()["id"]
        conn.close()

        payload = {
            "date":        "2026-04-11",
            "description": "Saved to DB check",
            "amount":      -15.00,
            "category_id": cat_id,
            "account_id":  acc_id,
        }

        self.client.post(
            "/api/transactions",
            data=json.dumps(payload),
            content_type="application/json",
        )

        # Query the database directly — bypass the API entirely — to confirm
        # the row was written. We use the JOIN version (same as the GET route)
        # to also confirm the row is visible with valid foreign keys.
        conn = database.get_connection()
        row = conn.execute("""
            SELECT t.description, t.amount, c.name AS category, a.name AS account
            FROM transactions t
            JOIN categories c ON t.category_id = c.id
            JOIN accounts   a ON t.account_id  = a.id
            WHERE t.description = 'Saved to DB check'
        """).fetchone()
        conn.close()

        # If row is None, the transaction wasn't saved (or had NULL foreign keys).
        self.assertIsNotNone(row, "Transaction was not found in the database after POST")
        self.assertEqual(row["amount"], -15.00)
        self.assertEqual(row["category"], "Groceries")

    # ------------------------------------------------------------------
    # POST /api/transactions — validation tests
    # ------------------------------------------------------------------

    def test_post_transaction_missing_field(self):
        """A POST with a required field omitted should return HTTP 400.

        HTTP 400 means 'Bad Request' — the client sent incomplete data.
        Here we deliberately leave out account_id to trigger the validation.
        """
        conn = database.get_connection()
        cat_id = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()["id"]
        conn.close()

        # No account_id key at all
        payload = {
            "date":        "2026-04-10",
            "amount":      -20.00,
            "category_id": cat_id,
            # account_id intentionally omitted
        }

        res = self.client.post(
            "/api/transactions",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 400)

        # The response body should describe what went wrong
        body = res.get_json()
        self.assertIn("error", body)

    def test_post_transaction_null_field(self):
        """A POST with a required field set to null should return HTTP 400.

        This tests the bug we fixed: sending {"account_id": null} used to pass
        the key-existence check and write NULL to the database, making the row
        invisible in the JOIN query. The fixed validation rejects null values.
        """
        conn = database.get_connection()
        cat_id = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()["id"]
        conn.close()

        # account_id key is present but its value is null (None in Python → null in JSON)
        payload = {
            "date":        "2026-04-10",
            "amount":      -20.00,
            "category_id": cat_id,
            "account_id":  None,
        }

        res = self.client.post(
            "/api/transactions",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(res.status_code, 400)

    # ------------------------------------------------------------------
    # GET /api/summary tests
    # ------------------------------------------------------------------

    def test_get_summary_status(self):
        """GET /api/summary should return HTTP 200."""
        res = self.client.get("/api/summary")
        self.assertEqual(res.status_code, 200)

    def test_get_summary_totals(self):
        """GET /api/summary should return totals that match our known seed data.

        Because we control exactly what's in the temp database, we can assert
        precise dollar amounts rather than just checking types or ranges:
            total_balance  = $1,000.00  (the one account's balance)
            total_income   = $500.00    (one +$500 transaction)
            total_expenses = $80.00     (one -$80 transaction, returned as positive)

        If any of these are wrong, the summary query or seeding is broken.
        """
        res = self.client.get("/api/summary")
        body = res.get_json()

        self.assertEqual(body["total_balance"],  1000.00)
        self.assertEqual(body["total_income"],    500.00)
        self.assertEqual(body["total_expenses"],   80.00)

        # The spending_by_category list should have one entry (Groceries only —
        # income transactions are excluded because their amount is positive).
        self.assertEqual(len(body["spending_by_category"]), 1)
        self.assertEqual(body["spending_by_category"][0]["category"], "Groceries")


# This block runs the tests when you execute the file directly:
#   python3 test_app.py
# (Running with `python3 -m unittest test_app.py -v` also works and shows more detail.)
if __name__ == "__main__":
    unittest.main()
