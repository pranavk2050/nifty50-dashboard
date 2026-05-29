(() => {
    // --- Auth ---
    const AUTH_HASH = "99d698031b563511ab90ddc15cdd768b55acefa314626f4a172049c156439d3f";
    async function sha256(text) {
        const d = new TextEncoder().encode(text);
        const h = await crypto.subtle.digest("SHA-256", d);
        return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    function checkAuth() {
        const overlay = document.getElementById("auth-overlay");
        if (localStorage.getItem("auth_token") === AUTH_HASH) {
            overlay.classList.add("hidden");
            document.body.classList.remove("locked");
            return;
        }
        document.body.classList.add("locked");
        const input = document.getElementById("auth-password");
        const btn = document.getElementById("auth-submit");
        const err = document.getElementById("auth-error");
        const rem = document.getElementById("auth-remember");
        async function tryLogin() {
            if ((await sha256(input.value)) === AUTH_HASH) {
                if (rem.checked) localStorage.setItem("auth_token", AUTH_HASH);
                overlay.classList.add("hidden");
                document.body.classList.remove("locked");
            } else { err.textContent = "Incorrect password"; input.value = ""; input.focus(); }
        }
        btn.addEventListener("click", tryLogin);
        input.addEventListener("keydown", e => { if (e.key === "Enter") tryLogin(); });
    }
    checkAuth();

    // --- Theme ---
    function initTheme() {
        const saved = localStorage.getItem("theme");
        if (saved) document.documentElement.setAttribute("data-theme", saved);
        updateThemeIcon();
    }
    function toggleTheme() {
        const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        updateThemeIcon();
    }
    function updateThemeIcon() {
        const btn = document.getElementById("theme-toggle");
        btn.innerHTML = document.documentElement.getAttribute("data-theme") === "light" ? "&#9790;" : "&#9788;";
    }
    initTheme();

    // --- State ---
    let allStocks = [];
    let stockData = {};
    let activeSector = "all";
    let chartInstances = {};
    let miniCharts = {};
    let watchlist = new Set(JSON.parse(localStorage.getItem("nifty_watchlist") || "[]"));

    function saveWatchlist() { localStorage.setItem("nifty_watchlist", JSON.stringify([...watchlist])); }

    // --- Data Loading ---
    function loadData() {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "data/stocks.json", true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
                try {
                    stockData = JSON.parse(xhr.responseText);
                    allStocks = stockData.stocks || [];
                    renderMarketBar();
                    renderCharts();
                    renderHeatmap();
                    renderStocks();
                    renderNews();
                } catch (e) {
                    document.getElementById("stocks-grid").innerHTML = '<p class="loading">Error loading data.</p>';
                }
            }
        };
        xhr.send();
    }

    // --- Market Bar ---
    function renderMarketBar() {
        const idx = stockData.nifty_index || {};
        document.getElementById("nifty-value").textContent = idx.value || "--";
        const changeEl = document.getElementById("nifty-change");
        const pct = idx.change_pct || 0;
        changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% (${pct >= 0 ? "+" : ""}${(idx.change || 0).toFixed(2)})`;
        changeEl.className = "market-change " + (pct >= 0 ? "green" : "red");

        const ts = stockData.last_updated || "";
        document.getElementById("last-updated").textContent = ts ? new Date(ts).toLocaleString("en-IN") : "--";

        const s = stockData.summary || {};
        document.getElementById("gainers-count").textContent = s.gainers || 0;
        document.getElementById("losers-count").textContent = s.losers || 0;
        document.getElementById("buy-count").textContent = s.buy || 0;
        document.getElementById("sell-count").textContent = s.sell || 0;
    }

    // --- Filtering & Sorting ---
    function getFilteredStocks() {
        const query = document.getElementById("search").value.toLowerCase().trim();
        const signalFilter = document.getElementById("signal-filter").value;
        const sortBy = document.getElementById("sort-by").value;

        let filtered = allStocks.filter(s => {
            if (activeSector === "watchlist" && !watchlist.has(s.symbol)) return false;
            if (activeSector !== "all" && activeSector !== "watchlist" && s.sector !== activeSector) return false;
            if (signalFilter !== "all" && s.ai && s.ai.signal !== signalFilter) return false;
            if (query && !`${s.symbol} ${s.name} ${s.sector}`.toLowerCase().includes(query)) return false;
            return true;
        });

        // Sort
        const [field, dir] = sortBy.split("_");
        const asc = dir === "asc";
        filtered.sort((a, b) => {
            let va, vb;
            if (field === "change") { va = a.change_pct; vb = b.change_pct; }
            else if (field === "name") { va = a.name; vb = b.name; return asc ? va.localeCompare(vb) : vb.localeCompare(va); }
            else if (field === "pe") { va = a.pe_ratio || 999; vb = b.pe_ratio || 999; }
            else if (field === "dividend") { va = a.dividend_yield; vb = b.dividend_yield; }
            else if (field === "market") { va = a.market_cap; vb = b.market_cap; }
            else { va = a.change_pct; vb = b.change_pct; }
            return asc ? va - vb : vb - va;
        });

        return filtered;
    }

    // --- Render Stocks ---
    function renderStocks() {
        const grid = document.getElementById("stocks-grid");
        const filtered = getFilteredStocks();
        document.getElementById("stocks-heading").textContent = `Stocks (${filtered.length})`;

        if (!filtered.length) {
            grid.innerHTML = '<p class="loading">No stocks match your filters.</p>';
            return;
        }

        grid.innerHTML = filtered.map(s => {
            const ai = s.ai || {};
            const chgClass = s.change_pct >= 0 ? "green" : "red";
            const sigClass = (ai.signal || "hold").toLowerCase();
            const isWatched = watchlist.has(s.symbol);
            const mcap = s.market_cap ? (s.market_cap >= 1e12 ? (s.market_cap / 1e12).toFixed(2) + "T" : (s.market_cap / 1e9).toFixed(0) + "B") : "--";

            return `
            <div class="stock-card" data-symbol="${s.symbol}" onclick="window.__expandStock(this)">
                <div class="stock-card-header">
                    <div>
                        <div class="stock-name-row">
                            <span class="stock-symbol">${s.symbol}</span>
                            <span class="signal-badge ${sigClass}">${ai.signal || "Hold"}</span>
                            <button class="watchlist-btn ${isWatched ? "active" : ""}" onclick="event.stopPropagation();window.__toggleWatch('${s.symbol}')" title="${isWatched ? "Remove from watchlist" : "Add to watchlist"}">${isWatched ? "&#9733;" : "&#9734;"}</button>
                        </div>
                        <span class="stock-name">${s.name} <span class="sector-badge">${s.sector}</span></span>
                    </div>
                    <div class="stock-price-row">
                        <span class="stock-price">&#8377;${s.price.toLocaleString("en-IN")}</span>
                        <span class="stock-change ${chgClass}">${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%</span>
                    </div>
                </div>
                <div class="stock-card-meta">
                    <span><span class="label">P/E</span> <span class="value">${s.pe_ratio || "--"}</span></span>
                    <span><span class="label">MCap</span> <span class="value">${mcap}</span></span>
                    <span><span class="label">Div</span> <span class="value">${s.dividend_yield}%</span></span>
                    <span><span class="label">52W</span> <span class="value">${s.week52_low}-${s.week52_high}</span></span>
                </div>
                <div class="expand-hint">Click to expand</div>
                <div class="stock-detail">
                    <div class="stock-detail-inner">
                        <div class="detail-chart-wrapper"><canvas id="mini-${s.symbol}"></canvas></div>
                        <div class="detail-grid">
                            <div class="detail-item"><span class="label">Open</span> <span class="value">&#8377;${s.open}</span></div>
                            <div class="detail-item"><span class="label">High</span> <span class="value">&#8377;${s.high}</span></div>
                            <div class="detail-item"><span class="label">Low</span> <span class="value">&#8377;${s.low}</span></div>
                            <div class="detail-item"><span class="label">Volume</span> <span class="value">${(s.volume / 1e6).toFixed(2)}M</span></div>
                            <div class="detail-item"><span class="label">EPS</span> <span class="value">&#8377;${s.eps}</span></div>
                            <div class="detail-item"><span class="label">P/B</span> <span class="value">${s.pb_ratio}</span></div>
                            <div class="detail-item"><span class="label">ROE</span> <span class="value">${s.roe}%</span></div>
                            <div class="detail-item"><span class="label">D/E</span> <span class="value">${s.debt_to_equity}</span></div>
                            <div class="detail-item"><span class="label">RSI</span> <span class="value">${s.technicals?.rsi || "--"}</span></div>
                            <div class="detail-item"><span class="label">MACD</span> <span class="value">${s.technicals?.macd || "--"}</span></div>
                            <div class="detail-item"><span class="label">SMA20</span> <span class="value">${s.technicals?.sma20 || "--"}</span></div>
                            <div class="detail-item"><span class="label">SMA50</span> <span class="value">${s.technicals?.sma50 || "--"}</span></div>
                        </div>
                        ${ai.reasoning ? `<div class="ai-box">
                            <h4>AI Analysis</h4>
                            <p>${ai.reasoning}</p>
                            <div class="ai-meta">
                                <span>Target: <span class="value green">&#8377;${ai.target_price}</span></span>
                                <span>Stop Loss: <span class="value red">&#8377;${ai.stop_loss}</span></span>
                                <span>Confidence: <span class="value">${ai.confidence}</span></span>
                                <span>Risk: <span class="value">${ai.risk}</span></span>
                            </div>
                        </div>` : ""}
                    </div>
                </div>
            </div>`;
        }).join("");
    }

    // --- Mini Chart for Expanded Stock ---
    window.__expandStock = function(el) {
        const wasExpanded = el.classList.contains("expanded");
        el.classList.toggle("expanded");
        if (!wasExpanded && typeof Chart !== "undefined") {
            const sym = el.dataset.symbol;
            const stock = allStocks.find(s => s.symbol === sym);
            if (!stock || !stock.price_history) return;
            const canvasId = "mini-" + sym;
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            if (miniCharts[sym]) miniCharts[sym].destroy();
            const labels = stock.price_history.map(p => p.date.slice(5));
            const data = stock.price_history.map(p => p.close);
            const color = stock.change_pct >= 0 ? "#22c55e" : "#ef4444";
            miniCharts[sym] = new Chart(canvas, {
                type: "line",
                data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + "15", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: true, ticks: { maxTicksLimit: 6, font: { size: 10 }, color: "#8a8f98" } }, y: { display: true, ticks: { font: { size: 10 }, color: "#8a8f98" } } } }
            });
        }
    };

    // --- Watchlist ---
    window.__toggleWatch = function(sym) {
        if (watchlist.has(sym)) watchlist.delete(sym);
        else watchlist.add(sym);
        saveWatchlist();
        renderStocks();
    };

    // --- Charts ---
    function renderCharts() {
        if (typeof Chart === "undefined") return;
        Object.values(chartInstances).forEach(c => c.destroy());
        chartInstances = {};

        // Nifty trend
        const trend = (stockData.nifty_index || {}).trend || [];
        if (trend.length) {
            chartInstances.nifty = new Chart(document.getElementById("nifty-trend-chart"), {
                type: "line",
                data: { labels: trend.map(t => t.date.slice(5)), datasets: [{ data: trend.map(t => t.close), borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.1)", fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: "#8a8f98" } }, x: { ticks: { maxTicksLimit: 7, color: "#8a8f98" } } } }
            });
        }

        // Sector performance
        const sp = stockData.sector_performance || {};
        const secLabels = Object.keys(sp);
        const secData = Object.values(sp);
        const secColors = secData.map(v => v >= 0 ? "#22c55e" : "#ef4444");
        if (secLabels.length) {
            chartInstances.sector = new Chart(document.getElementById("sector-chart"), {
                type: "bar",
                data: { labels: secLabels, datasets: [{ data: secData, backgroundColor: secColors, borderRadius: 4 }] },
                options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#8a8f98", callback: v => v + "%" } }, y: { ticks: { color: "#8a8f98", font: { size: 11 } } } } }
            });
        }

        // Signal distribution
        const sum = stockData.summary || {};
        chartInstances.signal = new Chart(document.getElementById("signal-chart"), {
            type: "doughnut",
            data: { labels: ["Buy", "Hold", "Sell"], datasets: [{ data: [sum.buy || 0, sum.hold || 0, sum.sell || 0], backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#8a8f98", boxWidth: 12, padding: 8 } } } }
        });

        // Top picks
        const buys = allStocks.filter(s => s.ai && s.ai.signal === "Buy" && s.ai.confidence === "High").slice(0, 8);
        if (buys.length) {
            chartInstances.picks = new Chart(document.getElementById("picks-chart"), {
                type: "bar",
                data: { labels: buys.map(s => s.symbol), datasets: [{ label: "Change %", data: buys.map(s => s.change_pct), backgroundColor: buys.map(s => s.change_pct >= 0 ? "#22c55e" : "#ef4444"), borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: "#8a8f98", callback: v => v + "%" } }, x: { ticks: { color: "#8a8f98" } } } }
            });
        }
    }

    // --- Heatmap ---
    function renderHeatmap() {
        const sp = stockData.sector_performance || {};
        const el = document.getElementById("sector-heatmap");
        el.innerHTML = Object.entries(sp).map(([name, change]) => {
            const intensity = Math.min(Math.abs(change) * 30, 200);
            const bg = change >= 0 ? `rgba(34,197,94,${intensity / 255})` : `rgba(239,68,68,${intensity / 255})`;
            const textColor = intensity > 100 ? "#fff" : (change >= 0 ? "#22c55e" : "#ef4444");
            return `<div class="heatmap-cell" style="background:${bg};color:${textColor}" onclick="window.__filterSector('${name}')">
                <span class="sector-name">${name}</span>
                <span class="sector-change">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</span>
            </div>`;
        }).join("");
    }

    window.__filterSector = function(sec) {
        activeSector = sec;
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        const match = document.querySelector(`.tab[data-sector="${sec}"]`);
        if (match) match.classList.add("active");
        renderStocks();
    };

    // --- News ---
    function renderNews() {
        const news = stockData.market_news || [];
        document.getElementById("news-grid").innerHTML = news.map(n =>
            `<div class="news-card">
                <h4><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a></h4>
                <span class="news-date">${n.date}</span>
            </div>`
        ).join("") || '<p class="loading">No news available.</p>';
    }

    // --- CSV Export ---
    function exportCSV() {
        const filtered = getFilteredStocks();
        if (!filtered.length) return;
        const h = ["Symbol", "Name", "Sector", "Price", "Change%", "P/E", "Div Yield", "Signal", "Confidence", "Target", "Stop Loss", "Reasoning"];
        const csv = [h.join(","), ...filtered.map(s => {
            const ai = s.ai || {};
            return [s.symbol, `"${s.name}"`, s.sector, s.price, s.change_pct, s.pe_ratio, s.dividend_yield, ai.signal, ai.confidence, ai.target_price, ai.stop_loss, `"${(ai.reasoning || "").replace(/"/g, '""')}"`].join(",");
        })].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `nifty50-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
    }

    // --- Event Listeners ---
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            activeSector = tab.dataset.sector;
            renderStocks();
        });
    });

    document.getElementById("search").addEventListener("input", renderStocks);
    document.getElementById("signal-filter").addEventListener("change", renderStocks);
    document.getElementById("sort-by").addEventListener("change", renderStocks);
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    document.getElementById("logout-btn").addEventListener("click", () => { localStorage.removeItem("auth_token"); location.reload(); });
    document.getElementById("export-csv").addEventListener("click", exportCSV);

    loadData();
})();
