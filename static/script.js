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

    new Chart(ctx, {
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

    new Chart(ctx, {
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

// ── Kick everything off ───────────────────────────────────────────────────────
loadDashboard();
