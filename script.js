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
    let portfolio = JSON.parse(localStorage.getItem("nifty_portfolio") || "[]");

    function saveWatchlist() { localStorage.setItem("nifty_watchlist", JSON.stringify([...watchlist])); }
    function savePortfolio() { localStorage.setItem("nifty_portfolio", JSON.stringify(portfolio)); }

    // --- Helpers ---
    function riskLabel(score) {
        if (score <= 3) return "low";
        if (score <= 6) return "medium";
        return "high";
    }
    function fmtMcap(v) { return v >= 1e12 ? (v/1e12).toFixed(2)+"T" : v >= 1e9 ? (v/1e9).toFixed(0)+"B" : "--"; }

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
                    initPortfolio();
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
            const rm = s.risk_metrics || {};
            if (signalFilter === "52w_high" && !rm.near_52w_high) return false;
            if (signalFilter === "52w_low" && !rm.near_52w_low) return false;
            if (signalFilter === "earnings" && !rm.earnings_soon) return false;
            if (["Buy","Hold","Sell"].includes(signalFilter) && s.ai && s.ai.signal !== signalFilter) return false;
            if (query && !`${s.symbol} ${s.name} ${s.sector}`.toLowerCase().includes(query)) return false;
            return true;
        });

        const parts = sortBy.split("_");
        const dir = parts.pop();
        const field = parts.join("_");
        const asc = dir === "asc";
        filtered.sort((a, b) => {
            let va, vb;
            if (field === "change_pct") { va = a.change_pct; vb = b.change_pct; }
            else if (field === "name") { va = a.name; vb = b.name; return asc ? va.localeCompare(vb) : vb.localeCompare(va); }
            else if (field === "pe") { va = a.pe_ratio || 999; vb = b.pe_ratio || 999; }
            else if (field === "dividend") { va = a.dividend_yield; vb = b.dividend_yield; }
            else if (field === "market_cap") { va = a.market_cap; vb = b.market_cap; }
            else if (field === "risk") { va = (a.risk_metrics||{}).risk_score||5; vb = (b.risk_metrics||{}).risk_score||5; }
            else if (field === "sharpe") { va = (a.risk_metrics||{}).sharpe_ratio||0; vb = (b.risk_metrics||{}).sharpe_ratio||0; }
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
        if (!filtered.length) { grid.innerHTML = '<p class="loading">No stocks match your filters.</p>'; return; }

        grid.innerHTML = filtered.map(s => {
            const ai = s.ai || {};
            const rm = s.risk_metrics || {};
            const chgClass = s.change_pct >= 0 ? "green" : "red";
            const sigClass = (ai.signal || "hold").toLowerCase();
            const isWatched = watchlist.has(s.symbol);
            const riskClass = riskLabel(rm.risk_score || 5);

            // Alert badges
            let alerts = "";
            if (rm.near_52w_high) alerts += '<span class="alert-badge">52W High</span>';
            if (rm.near_52w_low) alerts += '<span class="alert-badge">52W Low</span>';
            if (rm.earnings_soon) alerts += '<span class="alert-badge earnings">Earnings Soon</span>';
            if (rm.relative_strength != null) {
                const rsClass = rm.relative_strength >= 0 ? "outperform" : "underperform";
                alerts += `<span class="rs-badge ${rsClass}">${rm.relative_strength >= 0 ? "+" : ""}${rm.relative_strength}% vs Nifty</span>`;
            }

            return `
            <div class="stock-card" data-symbol="${s.symbol}" onclick="window.__expandStock(this)">
                <div class="stock-card-header">
                    <div>
                        <div class="stock-name-row">
                            <span class="stock-symbol">${s.symbol}</span>
                            <span class="signal-badge ${sigClass}">${ai.signal || "Hold"}</span>
                            <span class="risk-badge ${riskClass}" title="Risk Score: ${rm.risk_score || "?"}/10">R:${rm.risk_score || "?"}</span>
                            <button class="watchlist-btn ${isWatched ? "active" : ""}" onclick="event.stopPropagation();window.__toggleWatch('${s.symbol}')">${isWatched ? "&#9733;" : "&#9734;"}</button>
                        </div>
                        <span class="stock-name">${s.name} <span class="sector-badge">${s.sector}</span> ${alerts}</span>
                    </div>
                    <div class="stock-price-row">
                        <span class="stock-price">&#8377;${s.price.toLocaleString("en-IN")}</span>
                        <span class="stock-change ${chgClass}">${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%</span>
                    </div>
                </div>
                <div class="stock-card-meta">
                    <span><span class="label">P/E</span> <span class="value">${s.pe_ratio || "--"}</span></span>
                    <span><span class="label">MCap</span> <span class="value">${fmtMcap(s.market_cap)}</span></span>
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
                            <div class="detail-item"><span class="label">Volume</span> <span class="value">${(s.volume/1e6).toFixed(2)}M</span></div>
                            <div class="detail-item"><span class="label">EPS</span> <span class="value">&#8377;${s.eps}</span></div>
                            <div class="detail-item"><span class="label">P/B</span> <span class="value">${s.pb_ratio}</span></div>
                            <div class="detail-item"><span class="label">ROE</span> <span class="value">${s.roe}%</span></div>
                            <div class="detail-item"><span class="label">D/E</span> <span class="value">${s.debt_to_equity}</span></div>
                            <div class="detail-item"><span class="label">RSI</span> <span class="value">${s.technicals?.rsi || "--"}</span></div>
                            <div class="detail-item"><span class="label">MACD</span> <span class="value">${s.technicals?.macd || "--"}</span></div>
                            <div class="detail-item"><span class="label">SMA20</span> <span class="value">${s.technicals?.sma20 || "--"}</span></div>
                            <div class="detail-item"><span class="label">SMA50</span> <span class="value">${s.technicals?.sma50 || "--"}</span></div>
                        </div>
                        <div class="detail-grid" style="margin-top:0.5rem;border-top:1px solid var(--border);padding-top:0.5rem">
                            <div class="detail-item"><span class="label">Beta</span> <span class="value">${rm.beta ?? "--"}</span></div>
                            <div class="detail-item"><span class="label">ATR</span> <span class="value">${rm.atr ?? "--"}</span></div>
                            <div class="detail-item"><span class="label">Volatility</span> <span class="value">${rm.volatility_30d ? rm.volatility_30d+"%" : "--"}</span></div>
                            <div class="detail-item"><span class="label">Max Drawdown</span> <span class="value ${(rm.max_drawdown||0) < -10 ? 'red' : ''}">${rm.max_drawdown ? rm.max_drawdown+"%" : "--"}</span></div>
                            <div class="detail-item"><span class="label">Sharpe Ratio</span> <span class="value">${rm.sharpe_ratio ?? "--"}</span></div>
                            <div class="detail-item"><span class="label">Support</span> <span class="value green">&#8377;${rm.support || "--"}</span></div>
                            <div class="detail-item"><span class="label">Resistance</span> <span class="value red">&#8377;${rm.resistance || "--"}</span></div>
                            <div class="detail-item"><span class="label">Risk Score</span> <span class="value">${rm.risk_score || "--"}/10</span></div>
                            ${rm.payout_ratio ? `<div class="detail-item"><span class="label">Payout Ratio</span> <span class="value">${rm.payout_ratio}%</span></div>` : ""}
                            ${rm.ex_dividend_date ? `<div class="detail-item"><span class="label">Ex-Div Date</span> <span class="value">${rm.ex_dividend_date}</span></div>` : ""}
                            ${rm.next_earnings_date ? `<div class="detail-item"><span class="label">Next Earnings</span> <span class="value">${rm.next_earnings_date}</span></div>` : ""}
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
                        <button class="export-btn" style="margin-top:0.6rem;width:100%" onclick="event.stopPropagation();window.__comparePeers('${s.sector}','${s.symbol}')">Compare with ${s.sector} Peers</button>
                    </div>
                </div>
            </div>`;
        }).join("");
    }

    // --- Mini Chart ---
    window.__expandStock = function(el) {
        const wasExpanded = el.classList.contains("expanded");
        el.classList.toggle("expanded");
        if (!wasExpanded && typeof Chart !== "undefined") {
            const sym = el.dataset.symbol;
            const stock = allStocks.find(s => s.symbol === sym);
            if (!stock || !stock.price_history) return;
            const canvas = document.getElementById("mini-" + sym);
            if (!canvas) return;
            if (miniCharts[sym]) miniCharts[sym].destroy();
            const labels = stock.price_history.map(p => p.date.slice(5));
            const data = stock.price_history.map(p => p.close);
            const color = stock.change_pct >= 0 ? "#22c55e" : "#ef4444";
            miniCharts[sym] = new Chart(canvas, {
                type: "line",
                data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + "15", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6, font: { size: 10 }, color: "#8a8f98" } }, y: { ticks: { font: { size: 10 }, color: "#8a8f98" } } } }
            });
        }
    };

    // --- Watchlist ---
    window.__toggleWatch = function(sym) {
        if (watchlist.has(sym)) watchlist.delete(sym); else watchlist.add(sym);
        saveWatchlist();
        renderStocks();
    };

    // --- Peer Comparison (Feature 4) ---
    window.__comparePeers = function(sector, currentSym) {
        const peers = allStocks.filter(s => s.sector === sector);
        const modal = document.getElementById("comparison-modal");
        document.getElementById("comparison-title").textContent = `${sector} - Peer Comparison`;
        document.getElementById("comparison-body").innerHTML = `
            <table class="comparison-table">
                <thead><tr>
                    <th>Stock</th><th>Price</th><th>Change%</th><th>P/E</th><th>ROE</th><th>D/E</th>
                    <th>Div%</th><th>Risk</th><th>Sharpe</th><th>Signal</th>
                </tr></thead>
                <tbody>${peers.map(s => {
                    const rm = s.risk_metrics || {};
                    const ai = s.ai || {};
                    const highlight = s.symbol === currentSym ? 'style="background:rgba(59,130,246,0.1)"' : '';
                    return `<tr ${highlight}>
                        <td><strong>${s.symbol}</strong><br><small>${s.name}</small></td>
                        <td>&#8377;${s.price}</td>
                        <td class="${s.change_pct >= 0 ? 'green' : 'red'}">${s.change_pct.toFixed(2)}%</td>
                        <td>${s.pe_ratio || "--"}</td>
                        <td>${s.roe}%</td>
                        <td>${s.debt_to_equity}</td>
                        <td>${s.dividend_yield}%</td>
                        <td><span class="risk-badge ${riskLabel(rm.risk_score||5)}">${rm.risk_score||"?"}</span></td>
                        <td>${rm.sharpe_ratio ?? "--"}</td>
                        <td><span class="signal-badge ${(ai.signal||'hold').toLowerCase()}">${ai.signal||"Hold"}</span></td>
                    </tr>`;
                }).join("")}</tbody>
            </table>`;
        modal.classList.remove("hidden");
    };
    window.__closeModal = function() { document.getElementById("comparison-modal").classList.add("hidden"); };

    // --- Portfolio Simulator (Feature 2 & 6) ---
    let portfolioChart = null;

    function initPortfolio() {
        const select = document.getElementById("portfolio-stock");
        select.innerHTML = '<option value="">Choose a stock...</option>' +
            allStocks.map(s => `<option value="${s.symbol}" data-price="${s.price}">${s.symbol} - ${s.name} (&#8377;${s.price})</option>`).join("");
        // Auto-fill current price when stock is selected
        select.addEventListener("change", () => {
            const opt = select.selectedOptions[0];
            if (opt && opt.dataset.price) {
                document.getElementById("portfolio-price").value = opt.dataset.price;
            }
        });
        renderPortfolio();
    }

    function addToPortfolio() {
        const errEl = document.getElementById("portfolio-form-error");
        const sym = document.getElementById("portfolio-stock").value;
        const qty = parseInt(document.getElementById("portfolio-qty").value);
        const buyPrice = parseFloat(document.getElementById("portfolio-price").value);
        errEl.textContent = "";
        if (!sym) { errEl.textContent = "Please select a stock"; return; }
        if (!qty || qty < 1) { errEl.textContent = "Enter a valid quantity (min 1)"; return; }
        if (!buyPrice || buyPrice <= 0) { errEl.textContent = "Enter a valid buy price"; return; }
        portfolio.push({ symbol: sym, qty, buy_price: buyPrice });
        savePortfolio();
        renderPortfolio();
        document.getElementById("portfolio-stock").value = "";
        document.getElementById("portfolio-qty").value = "";
        document.getElementById("portfolio-price").value = "";
    }

    function clearPortfolio() {
        if (!portfolio.length) return;
        portfolio = [];
        savePortfolio();
        renderPortfolio();
    }

    function removeFromPortfolio(index) {
        portfolio.splice(index, 1);
        savePortfolio();
        renderPortfolio();
    }

    function renderPortfolio() {
        const wrapper = document.getElementById("portfolio-table-wrapper");
        const summary = document.getElementById("portfolio-summary");
        const divEl = document.getElementById("portfolio-diversification");
        const layout = document.getElementById("portfolio-layout");

        if (!portfolio.length) {
            summary.innerHTML = "";
            layout.style.display = "none";
            wrapper.innerHTML = `<div class="portfolio-empty">
                <span class="empty-icon">&#128188;</span>
                <p>Your portfolio is empty. Add stocks using the form above to track your investments.</p>
            </div>`;
            divEl.innerHTML = "";
            return;
        }
        layout.style.display = "";

        let totalInvested = 0, totalCurrent = 0, totalDayPnl = 0;
        const sectorAlloc = {};
        const holdings = portfolio.map((p, i) => {
            const stock = allStocks.find(s => s.symbol === p.symbol);
            const curPrice = stock ? stock.price : p.buy_price;
            const sector = stock ? stock.sector : "Unknown";
            const changePct = stock ? stock.change_pct : 0;
            const invested = p.qty * p.buy_price;
            const current = p.qty * curPrice;
            const pnl = current - invested;
            const pnlPct = invested > 0 ? (pnl / invested * 100) : 0;
            const dayPnl = current * (changePct / 100);
            totalInvested += invested;
            totalCurrent += current;
            totalDayPnl += dayPnl;
            sectorAlloc[sector] = (sectorAlloc[sector] || 0) + current;
            return { ...p, stock, curPrice, sector, invested, current, pnl, pnlPct, dayPnl, changePct, index: i };
        });

        const totalPnl = totalCurrent - totalInvested;
        const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested * 100) : 0;
        const totalDayPnlPct = totalCurrent > 0 ? (totalDayPnl / (totalCurrent - totalDayPnl) * 100) : 0;

        summary.innerHTML = `
            <div class="ps-card">
                <span class="ps-label">Total Invested</span>
                <span class="ps-value">&#8377;${Math.round(totalInvested).toLocaleString("en-IN")}</span>
            </div>
            <div class="ps-card">
                <span class="ps-label">Current Value</span>
                <span class="ps-value">&#8377;${Math.round(totalCurrent).toLocaleString("en-IN")}</span>
            </div>
            <div class="ps-card">
                <span class="ps-label">Total P&L</span>
                <span class="ps-value ${totalPnl >= 0 ? 'green' : 'red'}">&#8377;${Math.round(totalPnl).toLocaleString("en-IN")}</span>
                <span class="ps-sub ${totalPnl >= 0 ? 'green' : 'red'}">${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%</span>
            </div>
            <div class="ps-card">
                <span class="ps-label">Today's P&L</span>
                <span class="ps-value ${totalDayPnl >= 0 ? 'green' : 'red'}">&#8377;${Math.round(totalDayPnl).toLocaleString("en-IN")}</span>
                <span class="ps-sub ${totalDayPnl >= 0 ? 'green' : 'red'}">${totalDayPnlPct >= 0 ? "+" : ""}${totalDayPnlPct.toFixed(2)}%</span>
            </div>
        `;

        wrapper.innerHTML = `<table class="portfolio-table">
            <thead><tr><th>Stock</th><th>Qty</th><th>Avg Buy</th><th>CMP</th><th>P&L</th><th>Today</th><th>Allocation</th><th></th></tr></thead>
            <tbody>${holdings.map(h => {
                const allocPct = totalCurrent > 0 ? (h.current / totalCurrent * 100) : 0;
                const stockName = h.stock ? h.stock.name : h.symbol;
                return `<tr>
                    <td><div class="stock-info"><span class="sym">${h.symbol}</span><span class="name">${stockName}</span></div></td>
                    <td>${h.qty}</td>
                    <td>&#8377;${h.buy_price.toFixed(2)}</td>
                    <td>&#8377;${h.curPrice.toFixed(2)}</td>
                    <td class="${h.pnl >= 0 ? 'green' : 'red'}">&#8377;${Math.round(h.pnl).toLocaleString("en-IN")} <small>(${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(1)}%)</small></td>
                    <td class="${h.changePct >= 0 ? 'green' : 'red'}">${h.changePct >= 0 ? "+" : ""}${h.changePct.toFixed(2)}%</td>
                    <td>${allocPct.toFixed(1)}%<div class="alloc-bar" style="width:${Math.min(allocPct, 100)}%"></div></td>
                    <td><button class="remove-btn" onclick="window.__removePortfolio(${h.index})">Remove</button></td>
                </tr>`;
            }).join("")}</tbody>
        </table>`;

        // Diversification score
        const sectorCount = Object.keys(sectorAlloc).length;
        const maxAllocPct = totalCurrent > 0 ? Math.max(...Object.values(sectorAlloc)) / totalCurrent * 100 : 0;
        const divScore = Math.min(10, Math.round(sectorCount * 1.5 + (maxAllocPct < 30 ? 3 : maxAllocPct < 50 ? 1 : 0)));
        let warns = [];
        for (const [sec, val] of Object.entries(sectorAlloc)) {
            const pct = totalCurrent > 0 ? (val / totalCurrent * 100) : 0;
            if (pct > 30) warns.push(`${sec}: ${pct.toFixed(0)}%`);
        }
        const scoreColor = divScore >= 7 ? "green" : divScore >= 4 ? "" : "red";
        divEl.innerHTML = `<div class="diversification-score">
            <span class="div-score-num ${scoreColor}">${divScore}/10</span>
            <span class="div-score-label">Diversification Score (${sectorCount} sector${sectorCount !== 1 ? "s" : ""})</span>
            ${warns.length ? `<div class="sector-warn">Over-concentrated: ${warns.join(", ")}</div>` : ""}
        </div>`;

        // Pie chart
        if (typeof Chart !== "undefined") {
            const canvas = document.getElementById("portfolio-pie");
            if (portfolioChart) portfolioChart.destroy();
            const labels = Object.keys(sectorAlloc);
            const data = Object.values(sectorAlloc).map(v => Math.round(v));
            const colors = ["#3b82f6","#22c55e","#ef4444","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316","#6366f1","#84cc16"];
            portfolioChart = new Chart(canvas, {
                type: "doughnut",
                data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#8a8f98", boxWidth: 10, font: { size: 10 } } } } }
            });
        }
    }

    window.__removePortfolio = function(i) { removeFromPortfolio(i); };

    // --- Charts ---
    function renderCharts() {
        if (typeof Chart === "undefined") return;
        Object.values(chartInstances).forEach(c => c.destroy());
        chartInstances = {};

        const trend = (stockData.nifty_index || {}).trend || [];
        if (trend.length) {
            chartInstances.nifty = new Chart(document.getElementById("nifty-trend-chart"), {
                type: "line",
                data: { labels: trend.map(t => t.date.slice(5)), datasets: [{ data: trend.map(t => t.close), borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.1)", fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: "#8a8f98" } }, x: { ticks: { maxTicksLimit: 7, color: "#8a8f98" } } } }
            });
        }

        const sp = stockData.sector_performance || {};
        const secLabels = Object.keys(sp);
        const secData = Object.values(sp);
        if (secLabels.length) {
            chartInstances.sector = new Chart(document.getElementById("sector-chart"), {
                type: "bar",
                data: { labels: secLabels, datasets: [{ data: secData, backgroundColor: secData.map(v => v >= 0 ? "#22c55e" : "#ef4444"), borderRadius: 4 }] },
                options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#8a8f98", callback: v => v + "%" } }, y: { ticks: { color: "#8a8f98", font: { size: 11 } } } } }
            });
        }

        const sum = stockData.summary || {};
        chartInstances.signal = new Chart(document.getElementById("signal-chart"), {
            type: "doughnut",
            data: { labels: ["Buy", "Hold", "Sell"], datasets: [{ data: [sum.buy || 0, sum.hold || 0, sum.sell || 0], backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#8a8f98", boxWidth: 12, padding: 8 } } } }
        });

        const buys = allStocks.filter(s => s.ai && s.ai.signal === "Buy").sort((a,b) => (b.risk_metrics?.sharpe_ratio||0) - (a.risk_metrics?.sharpe_ratio||0)).slice(0, 8);
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
        document.getElementById("sector-heatmap").innerHTML = Object.entries(sp).map(([name, change]) => {
            const intensity = Math.min(Math.abs(change) * 30, 200);
            const bg = change >= 0 ? `rgba(34,197,94,${intensity/255})` : `rgba(239,68,68,${intensity/255})`;
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
            `<div class="news-card"><h4><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a></h4><span class="news-date">${n.date}</span></div>`
        ).join("") || '<p class="loading">No news available.</p>';
    }

    // --- CSV Export (updated with risk metrics) ---
    function exportCSV() {
        const filtered = getFilteredStocks();
        if (!filtered.length) return;
        const h = ["Symbol","Name","Sector","Price","Change%","P/E","Div Yield","Risk Score","Beta","Volatility","Sharpe","Support","Resistance","Signal","Confidence","Target","Stop Loss","Reasoning"];
        const csv = [h.join(","), ...filtered.map(s => {
            const ai = s.ai || {};
            const rm = s.risk_metrics || {};
            return [s.symbol,`"${s.name}"`,s.sector,s.price,s.change_pct,s.pe_ratio,s.dividend_yield,rm.risk_score||"",rm.beta||"",rm.volatility_30d||"",rm.sharpe_ratio||"",rm.support||"",rm.resistance||"",ai.signal,ai.confidence,ai.target_price,ai.stop_loss,`"${(ai.reasoning||"").replace(/"/g,'""')}"`].join(",");
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
    document.getElementById("portfolio-add").addEventListener("click", addToPortfolio);
    document.getElementById("portfolio-clear").addEventListener("click", clearPortfolio);
    document.getElementById("comparison-modal").addEventListener("click", e => { if (e.target.id === "comparison-modal") window.__closeModal(); });

    loadData();
})();
