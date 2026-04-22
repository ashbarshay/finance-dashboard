# Finance Dashboard

**[🚀 Live Demo → finance-dashboard-f7df.onrender.com](https://finance-dashboard-f7df.onrender.com/)**

---

A full-stack personal finance web app built with Python, Flask, and plain JavaScript. It lets you track transactions across multiple accounts, visualize spending by category, monitor your monthly budget, and get smart financial insights — all from a clean, single-page dashboard.

Built as a learning project while exploring full-stack development with the help of Claude Code.

---

## Features

- **Summary cards** — total balance across all accounts, total income, total expenses, and top spending category at a glance
- **Spending by category** — doughnut chart showing where your money goes (Groceries, Dining, Utilities, etc.)
- **Spending trends** — bar chart (monthly) and line chart (weekly) with a toggle to switch between views
- **Transaction table** — recent transactions with date, description, category badge, and account
- **Filter bar** — filter transactions by category and custom date range
- **Add transaction form** — log a new income or expense with real-time dashboard refresh on submit
- **Monthly budget tracker** — set a monthly spending target and track progress with a color-coded bar that turns red near the limit
- **AI Insights** — one-click analysis of your real spending data: flags housing costs against the 50/30/20 rule, identifies top-category concentration, compares this month's income vs. expenses, and calculates your overall savings rate
- **Sample data** — seed script included to populate the database with realistic demo transactions

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | [Python 3](https://www.python.org/) + [Flask](https://flask.palletsprojects.com/) |
| Database | [SQLite](https://www.sqlite.org/) (via Python's built-in `sqlite3` module) |
| Frontend | Vanilla HTML, CSS, and JavaScript — no frameworks |
| Charts | [Chart.js 4](https://www.chartjs.org/) |
| Fonts | [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts |
| Deployment | [Render](https://render.com/) (free tier) via Gunicorn |

---

## Running Locally

**Prerequisites:** Python 3.8 or newer installed on your machine.

**1. Clone the repository**
```bash
git clone <your-repo-url>
cd finance-dashboard
```

**2. Create and activate a virtual environment**

A virtual environment keeps this project's dependencies isolated from the rest of your system — it's like a sandbox for Python packages.

```bash
python3 -m venv venv
source venv/bin/activate      # Mac / Linux
# venv\Scripts\activate       # Windows
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Seed the database with sample data**

This creates `finance.db` and populates it with 3 accounts, 8 categories, and 20 sample transactions so you have something to look at right away.

```bash
python3 database.py
```

**5. Start the development server**
```bash
python3 app.py
```

**6. Open the dashboard**

Visit [http://localhost:5000](http://localhost:5000) in your browser.

---

## Deploying to Render

1. Push this repository to GitHub
2. Create a new **Web Service** on [Render](https://render.com/) and connect your repo
3. Set the **Start Command** to `gunicorn app:app` (or Render will pick this up automatically from the `Procfile`)
4. Deploy — Render installs dependencies from `requirements.txt` and starts the server

> **Note on the database:** Render's free tier uses ephemeral storage, meaning `finance.db` resets on each redeploy. This is fine for an interview demo; a production app would use a hosted database like PostgreSQL.

---

## What I Learned Building This

This was my first full-stack project. Some of the things that clicked while building it:

- **How the web actually works** — the browser sends an HTTP request, Flask handles it, queries SQLite, and returns JSON. Following that flow end-to-end made the whole system make sense.
- **SQL joins** — understanding why you need `JOIN` to get a category name instead of just a category ID was a big moment. It made database relationships real.
- **Why APIs exist** — separating the backend (Flask returning JSON) from the frontend (JavaScript reading that JSON) meant I could change the chart without touching the database, and vice versa.
- **Debugging with tests** — writing a test that directly queried the database after a POST revealed a `NULL account_id` bug that the UI was silently hiding. Tests catch things eyeballing can't.
- **Security basics** — learned about SQL injection (why `?` placeholders matter), XSS (why you can't dump raw data into `innerHTML`), and what a 400 vs. 500 error actually means.

---

## Future Improvements

- [x] **Date filtering** — filter the transaction table by category and custom date range
- [x] **Budget tracker** — set a monthly budget and track progress with a color-coded progress bar
- [x] **AI Insights** — rule-based financial analysis with warnings, tips, and positive observations
- [ ] **Delete / edit transactions** — currently you can only add, not modify existing records
- [ ] **Account management** — a UI to add and update accounts instead of only via the seed script
- [ ] **Persistent storage on Render** — swap SQLite for PostgreSQL so data survives redeployments
- [ ] **CSV import** — paste in a bank export and have it parsed into transactions automatically
- [ ] **Authentication** — a login screen so the app can be shared without exposing your data

---

## Project Structure

```
finance-dashboard/
├── app.py            ← Flask backend: all API routes
├── database.py       ← SQLite setup, schema, and seed data
├── requirements.txt  ← Python dependencies (pinned versions)
├── Procfile          ← Tells Render how to start the app
├── static/
│   ├── style.css     ← Dashboard styles
│   └── script.js     ← Chart rendering, API calls, form handling
├── templates/
│   └── index.html    ← Main dashboard page
└── test_app.py       ← Automated API tests (unittest)
```

---

## Running the Tests

```bash
python3 -m unittest test_app.py -v
```

Tests use a temporary in-memory database so they never touch your real `finance.db`.

---

_Built by Ashley Barshay — learning full-stack development one project at a time._
