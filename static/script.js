// ── Chart instances ───────────────────────────────────────────────────────────
// We keep references to the charts so we can destroy them before re-drawing.
// Without this, calling loadDashboard() a second time (e.g. after adding a
// transaction) would throw "Canvas is already in use" from Chart.js.
let pieChart      = null;
let spendingChart = null;            // holds either the bar or line chart
let spendingMode  = "monthly";       // "monthly" or "weekly"
let cachedTransactions = null;       // saved so the toggle can re-render without a new fetch

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters before inserting text into innerHTML.
 * Without this, a transaction description like <script>alert(1)</script>
 * would be treated as real HTML by the browser and executed.
 * After escaping, it becomes &lt;script&gt;... which is displayed as plain
 * text, not run as code.
 */
function escHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

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

        cachedTransactions = transactions;
        renderCards(summary);
        renderPieChart(summary.spending_by_category);
        renderSpendingChart(transactions);
        renderFilteredTable();
        renderBudget(transactions);
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

    // Top spending category — spending_by_category is already sorted by total DESC
    if (summary.spending_by_category && summary.spending_by_category.length > 0) {
        const top = summary.spending_by_category[0];
        const pct = summary.total_expenses > 0
            ? Math.round(top.total / summary.total_expenses * 100)
            : 0;
        document.getElementById("top-cat-name").textContent   = top.category;
        document.getElementById("top-cat-amount").textContent = fmt(top.total);
        document.getElementById("top-cat-pct").textContent    = `${pct}% of spending`;
    }
}

// ── Pie / doughnut chart ──────────────────────────────────────────────────────

function renderPieChart(categories) {
    const ctx = document.getElementById("pie-chart").getContext("2d");

    if (pieChart) pieChart.destroy();

    const grandTotal = categories.reduce((sum, c) => sum + c.total, 0);

    // ── Callout label plugin ──────────────────────────────────────────────────
    // This is a custom Chart.js plugin. Chart.js calls afterDraw() once the
    // arcs have been painted, giving us a chance to draw on top of the canvas.
    // We use it to draw the leader line + "Category XX%" text for each slice.
    const calloutPlugin = {
        id: "calloutLabels",
        afterDraw(chart) {
            const { ctx: c, data } = chart;
            const meta  = chart.getDatasetMeta(0);
            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);

            c.save();
            meta.data.forEach((arc, i) => {
                const value    = data.datasets[0].data[i];
                const label    = data.labels[i];
                const pct      = Math.round(value / total * 100);
                if (pct < 8) return;   // small slices: skip callout — legend + tooltip cover them

                // midAngle is the angle (in radians) pointing to the middle of this slice
                const midAngle = (arc.startAngle + arc.endAngle) / 2;
                const cx = arc.x;
                const cy = arc.y;
                const outerR = arc.outerRadius;

                // x1,y1 — point on the outer edge of the arc
                const x1 = cx + outerR * Math.cos(midAngle);
                const y1 = cy + outerR * Math.sin(midAngle);
                // x2,y2 — the "elbow" 18px further out along the same angle
                const x2 = cx + (outerR + 18) * Math.cos(midAngle);
                const y2 = cy + (outerR + 18) * Math.sin(midAngle);
                // Always pull the horizontal tail to the LEFT so labels never
                // drift into the right-side legend area.
                // Right-side slices (isRight): arm exits the arc rightward, tail
                // reverses left by 28px — label lands in the center-right of the chart.
                // Left-side slices: arm and tail both go left as before.
                const isRight = x2 > cx;
                const x3 = x2 - (isRight ? 28 : 18);
                const y3 = y2;

                c.beginPath();
                c.moveTo(x1, y1);
                c.lineTo(x2, y2);
                c.lineTo(x3, y3);
                c.strokeStyle = arc.options.backgroundColor;
                c.lineWidth   = 1.5;
                c.stroke();

                c.font         = "bold 11px Inter, system-ui, sans-serif";
                c.fillStyle    = "#374151";
                c.textAlign    = "right";   // label always to the left of x3
                c.textBaseline = "middle";
                c.fillText(`${label} ${pct}%`, x3 - 4, y3);
            });
            c.restore();
        },
    };

    pieChart = new Chart(ctx, {
        type:    "doughnut",
        plugins: [calloutPlugin],
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
            cutout:              "60%",
            // Extra padding gives the callout labels room outside the arc
            layout: { padding: { top: 20, bottom: 20, left: 65, right: 30 } },
            plugins: {
                legend: {
                    position: "right",
                    labels: {
                        font:            { family: "Inter", size: 11 },
                        padding:         8,
                        usePointStyle:   true,
                        pointStyleWidth: 8,
                        boxHeight:       10,
                    },
                },
                tooltip: {
                    callbacks: {
                        // Show both dollar amount AND percentage on hover
                        label: ctx => {
                            const pct = Math.round(ctx.raw / grandTotal * 100);
                            return `  ${ctx.label}:  ${fmt(ctx.raw)}  (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

// ── Spending chart — dispatcher + both views ──────────────────────────────────

// One distinct color per bar — cycles if there are more than 12 months
const BAR_COLORS = [
    "#6366f1", "#f59e0b", "#10b981", "#ef4444",
    "#3b82f6", "#8b5cf6", "#f97316", "#14b8a6",
    "#ec4899", "#84cc16", "#06b6d4", "#a855f7",
];

// Shared scale/tooltip config used by both bar and line charts
function spendingScales() {
    return {
        y: {
            beginAtZero: true,
            grid:   { color: "#f1f5f9" },
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
    };
}

/**
 * Dispatcher: decide which chart type to draw based on spendingMode.
 * This is the single function that loadDashboard() and the toggle buttons call.
 */
function renderSpendingChart(transactions) {
    if (spendingMode === "monthly") {
        renderBarChart(transactions);
    } else {
        renderWeeklyChart(transactions);
    }
}

/**
 * Monthly view — one bar per calendar month, each a different color.
 */
function renderBarChart(transactions) {
    const expenses = transactions.filter(t => t.amount < 0);

    // Group by "YYYY-MM" key, e.g. "2026-03"
    const monthTotals = {};
    expenses.forEach(t => {
        const key = t.date.slice(0, 7);
        monthTotals[key] = (monthTotals[key] || 0) + Math.abs(t.amount);
    });

    const months = Object.keys(monthTotals).sort();
    const labels = months.map(m => {
        const [y, mo] = m.split("-").map(Number);
        return new Date(y, mo - 1, 1).toLocaleDateString("en-US", {
            month: "short", year: "numeric",
        });
    });
    const values = months.map(m => Math.round(monthTotals[m] * 100) / 100);
    const colors = months.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]);

    const ctx = document.getElementById("spending-chart").getContext("2d");
    if (spendingChart) spendingChart.destroy();
    spendingChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label:           "Monthly Spending",
                data:            values,
                backgroundColor: colors,
                borderRadius:    6,
                borderSkipped:   false,
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `  Spent: ${fmt(ctx.raw)}` } },
            },
            scales: spendingScales(),
        },
    });
}

/**
 * Weekly view — a line chart grouping expenses by the Sunday of each week.
 * This gives a more granular view of how spending is distributed across weeks.
 */
function renderWeeklyChart(transactions) {
    const expenses = transactions.filter(t => t.amount < 0);

    // Group by the Sunday that starts each week
    const weekTotals = {};
    expenses.forEach(t => {
        const [y, m, d] = t.date.split("-").map(Number);
        const date   = new Date(y, m - 1, d);
        const sunday = new Date(date);
        sunday.setDate(date.getDate() - date.getDay());
        // toISOString() gives UTC, which is fine here — we only need a sortable key
        const key = sunday.toISOString().split("T")[0];
        weekTotals[key] = (weekTotals[key] || 0) + Math.abs(t.amount);
    });

    const weeks  = Object.keys(weekTotals).sort();
    const labels = weeks.map(w => {
        const [y, m, d] = w.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-US", {
            month: "short", day: "numeric",
        });
    });
    const values = weeks.map(w => Math.round(weekTotals[w] * 100) / 100);

    const ctx = document.getElementById("spending-chart").getContext("2d");
    if (spendingChart) spendingChart.destroy();
    spendingChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label:                "Weekly Spending",
                data:                 values,
                borderColor:          "#6366f1",
                backgroundColor:      "rgba(99, 102, 241, 0.08)",
                borderWidth:          2.5,
                pointBackgroundColor: "#6366f1",
                pointBorderColor:     "#ffffff",
                pointBorderWidth:     2,
                pointRadius:          5,
                pointHoverRadius:     7,
                fill:                 true,
                tension:              0.35,
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `  Spent: ${fmt(ctx.raw)}` } },
            },
            scales: spendingScales(),
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
                <td>${escHtml(t.description) || "—"}</td>
                <td>
                    <span class="badge">
                        <span class="badge-dot" style="background:${escHtml(t.category_color)}"></span>
                        ${escHtml(t.category_name)}
                    </span>
                </td>
                <td>${escHtml(t.account_name)}</td>
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

    // Populate both the form category select AND the filter category select
    const filterCatSelect = document.getElementById("filter-category");
    categories.forEach(c => {
        const opt = document.createElement("option");
        opt.value       = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);

        // Clone the same option into the filter dropdown
        const filterOpt = document.createElement("option");
        filterOpt.value       = c.id;
        filterOpt.textContent = c.name;
        filterCatSelect.appendChild(filterOpt);
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

    // Send the data to the backend as JSON.
    // The try/catch handles network failures (e.g. no internet, server down).
    // Without it, a dropped connection would throw an uncaught error and the
    // user would see nothing — no feedback at all.
    try {
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
    } catch (err) {
        // This runs if the network request itself failed (not a server error,
        // but a connection problem — e.g. the server is unreachable).
        console.error("Network error submitting transaction:", err);
        showMessage(msgEl, "Could not reach the server. Check your connection.", "error");
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

// ── Transaction filter ────────────────────────────────────────────────────────

/**
 * Read the current filter inputs and re-render the table.
 * When no filters are active, shows the top 20 rows (same as the default).
 * When any filter is active, shows all matching rows so nothing is hidden.
 * Date comparison uses simple string ordering — this works because both the
 * stored dates and the input values are in YYYY-MM-DD format, which sorts
 * correctly as a string (e.g. "2026-03-01" < "2026-04-15").
 */
function renderFilteredTable() {
    if (!cachedTransactions) return;
    const catId = parseInt(document.getElementById("filter-category").value) || null;
    const start = document.getElementById("filter-date-start").value;
    const end   = document.getElementById("filter-date-end").value;
    const isFiltered = catId || start || end;

    const rows = cachedTransactions.filter(t => {
        if (catId && t.category_id !== catId) return false;
        if (start && t.date < start)          return false;
        if (end   && t.date > end)            return false;
        return true;
    });
    renderTable(isFiltered ? rows : rows.slice(0, 20));
}

// ── Monthly budget ────────────────────────────────────────────────────────────

/**
 * Calculate how much was spent in the current calendar month, then compare
 * that to the saved budget and render the progress bar.
 * The budget is stored in localStorage so it persists across page refreshes
 * without needing a database column.
 */
function renderBudget(transactions) {
    const budget  = parseFloat(localStorage.getItem("monthlyBudget"));
    const display = document.getElementById("budget-display");
    const input   = document.getElementById("budget-input");

    if (!budget || budget <= 0) {
        display.hidden = true;
        return;
    }

    // Pre-fill the input with the saved value so the user can see it on load
    input.value = budget;

    // Filter to expenses in the current month (e.g. "2026-04")
    const thisMonth = todayString().slice(0, 7);
    const spent = transactions
        .filter(t => t.amount < 0 && t.date.slice(0, 7) === thisMonth)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const pct  = Math.round(spent / budget * 100);
    const fill = document.getElementById("budget-bar-fill");

    document.getElementById("budget-text").textContent =
        `${fmt(spent)} of ${fmt(budget)} spent this month — ${pct}%`;

    // Cap the bar width at 100% so it doesn't overflow, but keep the text showing real %
    fill.style.width = Math.min(pct, 100) + "%";
    fill.classList.toggle("budget-bar-fill--danger", pct >= 80);

    display.hidden = false;
}

// ── Spending chart toggle ─────────────────────────────────────────────────────

// Helper: set one button active and the other inactive
function setToggleActive(activeId, inactiveId) {
    document.getElementById(activeId).classList.add("toggle-btn--active");
    document.getElementById(inactiveId).classList.remove("toggle-btn--active");
}

document.getElementById("btn-monthly").addEventListener("click", () => {
    spendingMode = "monthly";
    setToggleActive("btn-monthly", "btn-weekly");
    // Re-render immediately using the already-fetched data — no API call needed
    if (cachedTransactions) renderSpendingChart(cachedTransactions);
});

document.getElementById("btn-weekly").addEventListener("click", () => {
    spendingMode = "weekly";
    setToggleActive("btn-weekly", "btn-monthly");
    if (cachedTransactions) renderSpendingChart(cachedTransactions);
});

// ── Filter event listeners ────────────────────────────────────────────────────

document.getElementById("filter-category").addEventListener("change", renderFilteredTable);
document.getElementById("filter-date-start").addEventListener("change", renderFilteredTable);
document.getElementById("filter-date-end").addEventListener("change", renderFilteredTable);

document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-category").value   = "";
    document.getElementById("filter-date-start").value = "";
    document.getElementById("filter-date-end").value   = "";
    renderFilteredTable();
});

// ── Budget save ───────────────────────────────────────────────────────────────

document.getElementById("budget-save").addEventListener("click", () => {
    const val = parseFloat(document.getElementById("budget-input").value);
    if (!isNaN(val) && val > 0) {
        localStorage.setItem("monthlyBudget", val);
        if (cachedTransactions) renderBudget(cachedTransactions);
    }
});

// ── AI Insights ───────────────────────────────────────────────────────────────

/**
 * Call GET /api/insights, show a loading spinner while waiting, then display
 * the returned insights as a list — or an error message if something goes wrong.
 *
 * fetch() is asynchronous: it returns a "promise" that resolves when the server
 * responds. The `await` keyword pauses this function until the promise resolves,
 * without blocking the rest of the page.
 */
async function fetchInsights() {
    const btn     = document.getElementById("btn-get-insights");
    const content = document.getElementById("insights-content");
    const spinner = document.getElementById("insights-spinner");
    const list    = document.getElementById("insights-list");
    const errEl   = document.getElementById("insights-error");

    // Show the section, display only the spinner; hide old results and errors
    content.hidden  = false;
    spinner.hidden  = false;
    list.hidden     = true;
    errEl.hidden    = true;
    btn.disabled    = true;
    btn.textContent = "Analyzing…";

    try {
        const res  = await fetch("/api/insights");
        const data = await res.json();

        // res.ok is true for HTTP 200-299. If the server returned an error (e.g.
        // missing API key), res.ok is false and data.error has the message.
        if (!res.ok) throw new Error(data.error || "Something went wrong.");

        // Each insight is {type, text}. Pick an emoji icon per type and apply
        // a matching CSS class so warning/tip/positive get different colours.
        const icons = { warning: "⚠️", tip: "💡", positive: "✅" };
        list.innerHTML = data.insights
            .map(({ type, text }) =>
                `<li class="insights-item insights-item--${escHtml(type)}">
                    <span class="insights-icon">${icons[type] || "💡"}</span>
                    <span>${escHtml(text)}</span>
                 </li>`)
            .join("");
        list.hidden = false;
    } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
    } finally {
        // `finally` runs whether the try succeeded or the catch ran — so the
        // button and spinner are always restored no matter what happened.
        spinner.hidden  = true;
        btn.disabled    = false;
        btn.textContent = "Refresh Insights";
    }
}

document.getElementById("btn-get-insights").addEventListener("click", fetchInsights);

// Populate the dropdowns and load the dashboard data in parallel
populateFormDropdowns();
loadDashboard();
