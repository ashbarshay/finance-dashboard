# Finance Dashboard — Project Guide for Claude

## What This Project Is

A full-stack personal finance dashboard web app. The goal is to have a live, publicly accessible URL to demo in technical interviews.

**Stack:**
- **Database:** SQLite (stores transactions, accounts, and categories)
- **Backend:** Python + Flask (REST API that reads/writes the database)
- **Frontend:** Plain HTML, CSS, and JavaScript (dashboard with charts — no frameworks)

---

## Who I Am

I am a beginner developer with basic SQL knowledge. Please:
- **Always explain what you are doing and why** before making changes
- Keep explanations simple and avoid jargon — if you use a technical term, define it
- Walk me through concepts as if I'm learning, not just doing
- When writing SQL, explain what each part of the query does

---

## Project Structure (target layout)

```
finance-dashboard/
├── CLAUDE.md              ← this file
├── app.py                 ← Flask backend (API routes)
├── database.py            ← database setup and helper functions
├── finance.db             ← SQLite database file (auto-created, not committed to git)
├── requirements.txt       ← Python dependencies
├── Procfile               ← tells Render how to start the server (gunicorn)
├── render.yaml            ← Render deployment config
├── test_app.py            ← automated API tests (unittest)
├── static/
│   ├── style.css          ← dashboard styles
│   └── script.js          ← frontend logic and chart rendering
└── templates/
    └── index.html         ← main dashboard page
```

---

## Database Schema

Three tables:

**accounts** — bank accounts or credit cards
```sql
id          INTEGER PRIMARY KEY
name        TEXT NOT NULL        -- e.g. "Chase Checking"
type        TEXT NOT NULL        -- "checking", "savings", or "credit"
balance     REAL DEFAULT 0
```

**categories** — spending categories
```sql
id          INTEGER PRIMARY KEY
name        TEXT NOT NULL        -- e.g. "Groceries", "Rent", "Entertainment"
color       TEXT NOT NULL        -- hex color for charts, e.g. "#4CAF50"
```

**transactions** — individual income or expense records
```sql
id              INTEGER PRIMARY KEY
account_id      INTEGER REFERENCES accounts(id)
category_id     INTEGER REFERENCES categories(id)
amount          REAL NOT NULL       -- positive = income, negative = expense
description     TEXT
date            TEXT NOT NULL       -- stored as YYYY-MM-DD string
```

---

## Backend API Routes (Flask)

| Method | Route | What it does |
|--------|-------|--------------|
| GET | `/api/transactions` | Return all transactions |
| POST | `/api/transactions` | Add a new transaction |
| GET | `/api/accounts` | Return all accounts |
| GET | `/api/categories` | Return all categories |
| GET | `/api/summary` | Return totals for dashboard charts |
| GET | `/api/insights` | Return 4–5 rule-based financial insights |

All responses are JSON.

---

## Frontend Features

- Summary cards: total balance, total income, total expenses, top spending category
- Doughnut chart of spending by category (using Chart.js)
- Monthly bar chart and weekly line chart of spending trends, with a toggle to switch views
- Transaction table with date, description, category badge, account, and amount
- Filter bar: filter transactions by category and date range
- Form to add new transactions (with real-time dashboard refresh on submit)
- Monthly budget tracker: set a budget, see a progress bar that turns red near the limit
- AI Insights panel: one-click rule-based analysis with ⚠️ warnings, 💡 tips, and ✅ positive observations

---

## Deployment Target

The app should be deployable to **Render** (free tier) so it has a live URL.
- Render runs the Flask app with `gunicorn`
- The SQLite database file lives on the server (Render's ephemeral disk is fine for interview demos)
- A `render.yaml` or manual Render config will be needed

---

## Key Rules for Claude

1. **Explain before you act.** Before writing or editing code, briefly say what you're about to do and why it matters.
2. **Keep it simple.** Prefer clear, readable code over clever or compact code.
3. **No unnecessary complexity.** Don't add features that weren't asked for.
4. **SQL explanations required.** Any SQL query should have a plain-English comment explaining what it does.
5. **Frontend is plain JS only.** Do not introduce React, Vue, or any JS framework.
6. **One step at a time.** When building something new, break it into small steps and check in.
