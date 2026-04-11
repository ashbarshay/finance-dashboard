// ── Chart instances ───────────────────────────────────────────────────────────
// We keep references to the charts so we can destroy them before re-drawing.
// Without this, calling loadDashboard() a second time (e.g. after adding a
// transaction) would throw "Canvas is already in use" from Chart.js.
let pieChart  = null;
let lineChart = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a number as US dollars, e.g. 1234.5 → "$1,234.50"
 * Intl.NumberFormat is a built-in browser API for locale-aware formatting.
 */
function fmt(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
    }).format(amount);
}

/**
 * Format a YYYY-MM-DD date string as "Mar 28, 2026".
 * We split and reconstruct manually to avoid timezone shift bugs —
 * new Date("2026-03-28") is interpreted as UTC midnight, which can
 * show the previous day in some timezones.
 */
function fmtDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });
}

// ── Header date ───────────────────────────────────────────────────────────────

document.getElementById("header-date").textContent =
    new Date().toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

// ── Main loader ───────────────────────────────────────────────────────────────

/**
 * Fetch both API endpoints at the same time (Promise.all runs them in parallel
 * so we don't have to wait for one to finish before starting the other),
 * then hand the data off to each render function.
 */
async function loadDashboard() {
    try {
        const [summaryRes, txRes] = await Promise.all([
            fetch("/api/summary"),
            fetch("/api/transactions"),
        ]);

        const summary      = await summaryRes.json();
        const transactions = await txRes.json();

        renderCards(summary);
        renderPieChart(summary.spending_by_category);
        renderLineChart(transactions);
        renderTable(transactions.slice(0, 20));
    } catch (err) {
        console.error("Failed to load dashboard data:", err);
        document.getElementById("tx-body").innerHTML =
            '<tr><td colspan="5" class="loading">Could not load data. Is the server running?</td></tr>';
    }
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function renderCards(summary) {
    document.getElementById("total-balance").textContent  = fmt(summary.total_balance);
    document.getElementById("total-income").textContent   = fmt(summary.total_income);
    document.getElementById("total-expenses").textContent = fmt(summary.total_expenses);
}

// ── Pie / doughnut chart ──────────────────────────────────────────────────────

function renderPieChart(categories) {
    const ctx = document.getElementById("pie-chart").getContext("2d");

    // Destroy the old chart if it exists before drawing a new one
    if (pieChart) pieChart.destroy();
    pieChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels:   categories.map(c => c.category),
            datasets: [{
                data:            categories.map(c => c.total),
                backgroundColor: categories.map(c => c.color),
                borderWidth:     3,
                borderColor:     "#ffffff",
                hoverOffset:     6,
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            cutout:              "60%",          // makes it a doughnut vs solid pie
            plugins: {
                legend: {
                    position: "right",
                    labels: {
                        font:            { family: "Inter", size: 12 },
                        padding:         14,
                        usePointStyle:   true,
                        pointStyleWidth: 8,
                    },
                },
                tooltip: {
                    callbacks: {
                        // Show the dollar amount in the tooltip pop-up
                        label: ctx => `  ${ctx.label}:  ${fmt(ctx.raw)}`,
                    },
                },
            },
        },
    });
}

// ── Line chart ────────────────────────────────────────────────────────────────

/**
 * Group expense transactions by the Sunday that starts their week.
 * This gives us ~8 weekly data points for our 2-month date range —
 * clean enough to show a meaningful trend without being noisy.
 */
function renderLineChart(transactions) {
    // 1. Filter to expenses only (negative amounts)
    const expenses = transactions.filter(t => t.amount < 0);

    // 2. Build a map: { "2026-02-01": 245.67, ... }
    const weekTotals = {};
    expenses.forEach(t => {
        const [y, m, d] = t.date.split("-").map(Number);
        const date = new Date(y, m - 1, d);

        // Find the Sunday of this date's week
        const sunday = new Date(date);
        sunday.setDate(date.getDate() - date.getDay());

        // Format as YYYY-MM-DD for a sortable string key
        const key = sunday.toISOString().split("T")[0];
        weekTotals[key] = (weekTotals[key] || 0) + Math.abs(t.amount);
    });

    // 3. Sort weeks chronologically and build chart arrays
    const weeks  = Object.keys(weekTotals).sort();
    const labels = weeks.map(w => {
        const [y, m, d] = w.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-US", {
            month: "short", day: "numeric",
        });
    });
    const values = weeks.map(w => Math.round(weekTotals[w] * 100) / 100);

    const ctx = document.getElementById("line-chart").getContext("2d");

    // Destroy the old chart if it exists before drawing a new one
    if (lineChart) lineChart.destroy();
    lineChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label:           "Weekly Spending",
                data:            values,
                borderColor:     "#6366f1",
                backgroundColor: "rgba(99, 102, 241, 0.08)",
                borderWidth:     2.5,
                pointBackgroundColor: "#6366f1",
                pointBorderColor:     "#ffffff",
                pointBorderWidth:     2,
                pointRadius:     5,
                pointHoverRadius: 7,
                fill:            true,
                tension:         0.35,   // slight curve on the line
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },  // label is obvious — hide the legend
                tooltip: {
                    callbacks: {
                        label: ctx => `  Spent: ${fmt(ctx.raw)}`,
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid:  { color: "#f1f5f9" },
                    border: { dash: [4, 4] },
                    ticks: {
                        font:     { family: "Inter", size: 11 },
                        color:    "#94a3b8",
                        callback: v => "$" + v.toLocaleString(),
                    },
                },
                x: {
                    grid:  { display: false },
                    ticks: { font: { family: "Inter", size: 11 }, color: "#94a3b8" },
                },
            },
        },
    });
}

// ── Transactions table ────────────────────────────────────────────────────────

function renderTable(transactions) {
    const tbody = document.getElementById("tx-body");

    if (!transactions.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">No transactions found.</td></tr>';
        return;
    }

    // Build one <tr> string per transaction, then join and set as innerHTML.
    // template literals (backtick strings) let us embed variables with ${...}.
    tbody.innerHTML = transactions.map(t => {
        const income     = t.amount > 0;
        const amtClass   = income ? "amount-income" : "amount-expense";
        const amtText    = (income ? "+" : "") + fmt(t.amount);

        return `
            <tr>
                <td>${fmtDate(t.date)}</td>
                <td>${t.description || "—"}</td>
                <td>
                    <span class="badge">
                        <span class="badge-dot" style="background:${t.category_color}"></span>
                        ${t.category_name}
                    </span>
                </td>
                <td>${t.account_name}</td>
                <td class="col-amount ${amtClass}">${amtText}</td>
            </tr>`;
    }).join("");
}

// ── Add Transaction form ──────────────────────────────────────────────────────

/**
 * Populate the Category and Account <select> dropdowns by fetching from the API.
 * We run both fetches at the same time with Promise.all so we don't have to
 * wait for one to finish before starting the other.
 */
async function populateFormDropdowns() {
    const [catRes, accRes] = await Promise.all([
        fetch("/api/categories"),
        fetch("/api/accounts"),
    ]);
    const categories = await catRes.json();
    const accounts   = await accRes.json();

    const catSelect = document.getElementById("form-category");
    const accSelect = document.getElementById("form-account");

    // For each category, create an <option> element and append it to the <select>
    categories.forEach(c => {
        const opt = document.createElement("option");
        opt.value       = c.id;        // the value sent to the API
        opt.textContent = c.name;      // what the user sees
        catSelect.appendChild(opt);
    });

    accounts.forEach(a => {
        const opt = document.createElement("option");
        opt.value       = a.id;
        opt.textContent = a.name;
        accSelect.appendChild(opt);
    });
}

/**
 * Handle the form submission.
 * event.preventDefault() stops the browser from doing its default behaviour
 * (reloading the page), so we can handle the submission ourselves with fetch.
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    const msgEl = document.getElementById("form-message");

    // Read the values out of each form field
    const date        = document.getElementById("form-date").value;
    const description = document.getElementById("form-description").value.trim();
    const amount      = parseFloat(document.getElementById("form-amount").value);
    const categoryId  = parseInt(document.getElementById("form-category").value);
    const accountId   = parseInt(document.getElementById("form-account").value);

    // Basic client-side validation before hitting the API.
    // isNaN() returns true when parseInt/parseFloat couldn't parse the value
    // (e.g. the user left a dropdown on its placeholder "Select a category").
    if (!date) {
        showMessage(msgEl, "Please enter a date.", "error");
        return;
    }
    if (isNaN(amount) || amount === 0) {
        showMessage(msgEl, "Please enter a non-zero amount.", "error");
        return;
    }
    if (isNaN(categoryId)) {
        showMessage(msgEl, "Please select a category.", "error");
        return;
    }
    if (isNaN(accountId)) {
        showMessage(msgEl, "Please select an account.", "error");
        return;
    }

    // Send the data to the backend as JSON
    // JSON.stringify() converts the JS object into a JSON string the API expects
    const res = await fetch("/api/transactions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
            date,
            description,
            amount,
            category_id: categoryId,
            account_id:  accountId,
        }),
    });

    if (res.ok) {
        showMessage(msgEl, "Transaction added!", "success");
        document.getElementById("add-transaction-form").reset();
        // Reset the date field back to today after the form resets
        document.getElementById("form-date").value = todayString();
        // Reload all dashboard data so the new transaction appears everywhere
        loadDashboard();
        // Clear the success message after 3 seconds so it doesn't just sit there
        setTimeout(() => { msgEl.textContent = ""; msgEl.className = "form-message"; }, 3000);
    } else {
        const body = await res.json();
        showMessage(msgEl, body.error || "Something went wrong.", "error");
    }
}

/** Helper: set the message element's text and apply the right colour class. */
function showMessage(el, text, type) {
    el.textContent = text;
    el.className   = `form-message form-message--${type}`;
}

/** Return today's date as a YYYY-MM-DD string (the format <input type="date"> needs). */
function todayString() {
    const now = new Date();
    const y   = now.getFullYear();
    const m   = String(now.getMonth() + 1).padStart(2, "0");  // months are 0-indexed
    const d   = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// ── Kick everything off ───────────────────────────────────────────────────────

// Set the date field to today when the page loads
document.getElementById("form-date").value = todayString();

// Wire up the form's submit event to our handler function
document.getElementById("add-transaction-form").addEventListener("submit", handleFormSubmit);

// Populate the dropdowns and load the dashboard data in parallel
populateFormDropdowns();
loadDashboard();
