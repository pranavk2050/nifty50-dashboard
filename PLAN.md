# Nifty50 Smart Investment Dashboard — Complete Project Plan

## Investor's Mindset: What Do I Need?

As an investor looking at Nifty50 stocks, I need answers to:
1. **What to buy?** — Stock recommendations with reasoning
2. **When to buy/sell?** — Technical signals (RSI, MACD, moving averages)
3. **Is it fundamentally strong?** — P/E, EPS, debt, dividend yield
4. **What's the market mood?** — News sentiment, sector trends
5. **How's my watchlist doing?** — Track stocks I'm interested in
6. **Compare stocks** — Side-by-side comparison before deciding

---

## Dashboard Sections

### 1. Market Overview (Top Bar)
- Nifty50 index value + daily change (%)
- Market status: Open/Closed
- Top 3 gainers & top 3 losers (quick glance)
- Market breadth (advances vs declines)
- FII/DII buy/sell data (if available)

### 2. Stock Screener (Main Grid)
- All 50 Nifty stocks displayed as cards
- Each card shows: Symbol, Price, Change%, Sector, P/E, Market Cap, 52W High/Low
- **Filters:**
  - Sector (IT, Banking, Pharma, Auto, FMCG, Energy, Metals, etc.)
  - Market Cap (Large/Mid)
  - P/E ratio range (slider)
  - Dividend yield (min %)
  - Price change (gainers/losers/all)
  - Signal (Buy/Sell/Hold)
- **Sort by:** Price, Change%, P/E, Market Cap, Dividend Yield, Signal strength
- Search by stock name/symbol

### 3. AI-Powered Recommendations
- For each stock, Groq LLM generates:
  - **Signal**: Buy / Hold / Sell
  - **Confidence**: High / Medium / Low
  - **Reasoning**: 2-3 sentences based on technicals + fundamentals + news
  - **Target Price**: Short-term (1 month) and medium-term (3 months)
  - **Stop Loss**: Suggested exit price
  - **Risk Level**: Low / Medium / High

### 4. Interactive Charts (Chart.js)
- Nifty50 index trend (line chart)
- Sector-wise performance (bar chart)
- Signal distribution: Buy vs Hold vs Sell (doughnut)
- Top recommendations by confidence (horizontal bar)

### 5. Stock Detail View (Click to Expand)
- Price chart (30-day history)
- Technical indicators: RSI, MACD, SMA20/50/200
- Fundamental snapshot: P/E, P/B, EPS, Debt/Equity, ROE, Dividend Yield
- Recent news (3-5 headlines with links)
- AI analysis with reasoning

### 6. News Feed
- Market-wide news from Google News RSS
- Stock-specific news when a stock is selected
- Sentiment indicator per headline (Bullish/Bearish/Neutral)

### 7. Watchlist
- Add/remove stocks to personal watchlist (localStorage)
- Quick view of watchlist with alerts (price crosses 52W high/low)

### 8. Sector Heatmap
- Visual grid showing all sectors
- Color-coded by performance (green = up, red = down)
- Click sector to filter stocks

---

## Technical Architecture

### Data Pipeline (Python — `scripts/fetch_stocks.py`)

**Data Source:** Yahoo Finance via `yfinance` library (free, reliable, no API key needed)

```
Step 1: Fetch all 50 Nifty stocks real-time data
        - Current price, open, high, low, close, volume
        - 52-week high/low
        - Market cap, P/E, P/B, EPS, dividend yield
        - Sector classification

Step 2: Fetch 30-day price history for each stock
        - Daily OHLCV data
        - Calculate technical indicators:
          - RSI (14-day)
          - MACD (12, 26, 9)
          - SMA 20, 50, 200
          - Bollinger Bands

Step 3: Fetch Nifty50 index data
        - Current value + change
        - 30-day trend

Step 4: Fetch news via Google News RSS
        - Market-wide: "NSE Nifty50 India stock market"
        - Per-sector: "India IT stocks", "India banking stocks", etc.

Step 5: AI Analysis via Groq (Llama 3.3 70B)
        - For each stock, send: price data, technicals, fundamentals, recent news
        - Get: signal, confidence, reasoning, target price, stop loss, risk

Step 6: Write to data/stocks.json
        - Merge with existing data (historical accumulation)
```

### Frontend (Static HTML/CSS/JS)

```
index.html          — Dashboard layout
styles.css          — Responsive styling, dark mode, heatmap
script.js           — Data loading, filtering, sorting, charts, watchlist
chart.min.js        — Chart.js (bundled locally)
data/stocks.json    — Generated stock data
```

### Automation (GitHub Actions)

```yaml
Schedule: Every 30 min during market hours (9:15 AM - 3:30 PM IST, Mon-Fri)
          + Once at 4 PM IST for end-of-day summary
Steps: Python → yfinance → Groq → stocks.json → git push → GitHub Pages
```

---

## Nifty50 Stocks List (as of 2026)

Adani Enterprises, Adani Ports, Apollo Hospitals, Asian Paints, Axis Bank,
Bajaj Auto, Bajaj Finance, Bajaj Finserv, Bharti Airtel, BPCL,
Cipla, Coal India, Divi's Labs, Dr Reddy's, Eicher Motors,
Grasim, HCL Tech, HDFC Bank, HDFC Life, Hero MotoCorp,
Hindalco, HUL, ICICI Bank, IndusInd Bank, Infosys,
ITC, JSW Steel, Kotak Bank, L&T, M&M,
Maruti Suzuki, Nestle India, NTPC, ONGC, Power Grid,
Reliance, SBI, SBI Life, Shriram Finance, Sun Pharma,
Tata Consumer, Tata Motors, Tata Steel, TCS, Tech Mahindra,
Titan, Trent, UltraTech Cement, Wipro, Britannia

### Sectors:
- IT: TCS, Infosys, HCL Tech, Wipro, Tech Mahindra
- Banking: HDFC Bank, ICICI Bank, Axis Bank, Kotak Bank, SBI, IndusInd Bank
- Pharma: Sun Pharma, Cipla, Dr Reddy's, Divi's Labs, Apollo Hospitals
- Auto: Maruti, Tata Motors, M&M, Bajaj Auto, Hero MotoCorp, Eicher Motors
- FMCG: HUL, ITC, Nestle, Tata Consumer, Britannia
- Energy: Reliance, ONGC, BPCL, NTPC, Power Grid, Coal India
- Metals: Tata Steel, JSW Steel, Hindalco
- Financial Services: Bajaj Finance, Bajaj Finserv, HDFC Life, SBI Life, Shriram Finance
- Infrastructure: L&T, Grasim, UltraTech Cement, Adani Enterprises, Adani Ports
- Others: Titan, Trent, Asian Paints, Bharti Airtel

---

## Files Structure

```
nifty50_dashboard/
├── .github/workflows/
│   └── update-stocks.yml       ← GitHub Actions (every 30 min on market days)
├── scripts/
│   └── fetch_stocks.py         ← Data pipeline (yfinance + Groq)
├── data/
│   └── stocks.json             ← Generated stock data
├── index.html                  ← Dashboard
├── styles.css                  ← Styling
├── script.js                   ← Frontend logic
├── chart.min.js                ← Chart.js bundled
├── requirements.txt            ← Python deps
└── README.md                   ← Project docs
```

---

## Implementation Order

### Phase 1: Data Pipeline
1. Create `scripts/fetch_stocks.py` with yfinance integration
2. Fetch all 50 stocks: price, fundamentals, technicals
3. Calculate RSI, MACD, SMA indicators
4. Integrate Groq for AI recommendations
5. Output `data/stocks.json`

### Phase 2: Frontend — Market Overview + Stock Grid
1. Build `index.html` with market overview bar + stock cards grid
2. Style with `styles.css` (dark mode from start)
3. Implement filters, sorting, search in `script.js`
4. Click-to-expand for detailed stock view

### Phase 3: Charts + News + Watchlist
1. Add Chart.js visualizations
2. Integrate news feed (Google News RSS via Python)
3. Implement watchlist with localStorage
4. Sector heatmap

### Phase 4: Automation + Auth + Deploy
1. GitHub Actions workflow for scheduled updates
2. Client-side authentication (reuse pattern from business dashboard)
3. Deploy to GitHub Pages

---

## Dependencies

```
yfinance>=0.2.0        # Yahoo Finance data
requests>=2.28.0       # Groq API calls
feedparser>=6.0        # News RSS
numpy>=1.24.0          # Technical indicator calculations
```

---

## Key Design Decisions

| Decision | Reasoning |
|---|---|
| yfinance (not paid API) | Free, reliable, covers all Nifty50 data |
| 30-min updates during market hours | Balance between freshness and GitHub Actions limits |
| Groq for AI signals | Free tier sufficient for 50 stocks per run |
| Static site (no backend) | Free hosting, same pattern as business dashboard |
| Technical indicators calculated in Python | More accurate than JS, calculated once per run |
| localStorage for watchlist | No server needed, works offline |
