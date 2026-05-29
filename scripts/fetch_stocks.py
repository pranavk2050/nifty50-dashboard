#!/usr/bin/env python3
"""Fetch Nifty50 stock data, calculate technicals, generate AI recommendations."""

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
import yfinance as yf
import feedparser

# Nifty50 stocks with NSE symbols and sectors
NIFTY50 = {
    "ADANIENT.NS": {"name": "Adani Enterprises", "sector": "Infrastructure"},
    "ADANIPORTS.NS": {"name": "Adani Ports", "sector": "Infrastructure"},
    "APOLLOHOSP.NS": {"name": "Apollo Hospitals", "sector": "Pharma"},
    "ASIANPAINT.NS": {"name": "Asian Paints", "sector": "Others"},
    "AXISBANK.NS": {"name": "Axis Bank", "sector": "Banking"},
    "BAJAJ-AUTO.NS": {"name": "Bajaj Auto", "sector": "Auto"},
    "BAJFINANCE.NS": {"name": "Bajaj Finance", "sector": "Financial Services"},
    "BAJAJFINSV.NS": {"name": "Bajaj Finserv", "sector": "Financial Services"},
    "BHARTIARTL.NS": {"name": "Bharti Airtel", "sector": "Others"},
    "BPCL.NS": {"name": "BPCL", "sector": "Energy"},
    "CIPLA.NS": {"name": "Cipla", "sector": "Pharma"},
    "COALINDIA.NS": {"name": "Coal India", "sector": "Energy"},
    "DIVISLAB.NS": {"name": "Divi's Labs", "sector": "Pharma"},
    "DRREDDY.NS": {"name": "Dr Reddy's", "sector": "Pharma"},
    "EICHERMOT.NS": {"name": "Eicher Motors", "sector": "Auto"},
    "GRASIM.NS": {"name": "Grasim", "sector": "Infrastructure"},
    "HCLTECH.NS": {"name": "HCL Tech", "sector": "IT"},
    "HDFCBANK.NS": {"name": "HDFC Bank", "sector": "Banking"},
    "HDFCLIFE.NS": {"name": "HDFC Life", "sector": "Financial Services"},
    "HEROMOTOCO.NS": {"name": "Hero MotoCorp", "sector": "Auto"},
    "HINDALCO.NS": {"name": "Hindalco", "sector": "Metals"},
    "HINDUNILVR.NS": {"name": "HUL", "sector": "FMCG"},
    "ICICIBANK.NS": {"name": "ICICI Bank", "sector": "Banking"},
    "INDUSINDBK.NS": {"name": "IndusInd Bank", "sector": "Banking"},
    "INFY.NS": {"name": "Infosys", "sector": "IT"},
    "ITC.NS": {"name": "ITC", "sector": "FMCG"},
    "JSWSTEEL.NS": {"name": "JSW Steel", "sector": "Metals"},
    "KOTAKBANK.NS": {"name": "Kotak Bank", "sector": "Banking"},
    "LT.NS": {"name": "L&T", "sector": "Infrastructure"},
    "M&M.NS": {"name": "M&M", "sector": "Auto"},
    "MARUTI.NS": {"name": "Maruti Suzuki", "sector": "Auto"},
    "NESTLEIND.NS": {"name": "Nestle India", "sector": "FMCG"},
    "NTPC.NS": {"name": "NTPC", "sector": "Energy"},
    "ONGC.NS": {"name": "ONGC", "sector": "Energy"},
    "POWERGRID.NS": {"name": "Power Grid", "sector": "Energy"},
    "RELIANCE.NS": {"name": "Reliance", "sector": "Energy"},
    "SBIN.NS": {"name": "SBI", "sector": "Banking"},
    "SBILIFE.NS": {"name": "SBI Life", "sector": "Financial Services"},
    "SHRIRAMFIN.NS": {"name": "Shriram Finance", "sector": "Financial Services"},
    "SUNPHARMA.NS": {"name": "Sun Pharma", "sector": "Pharma"},
    "TATACONSUM.NS": {"name": "Tata Consumer", "sector": "FMCG"},
    "TATAMTRDVR.NS": {"name": "Tata Motors", "sector": "Auto"},
    "TATASTEEL.NS": {"name": "Tata Steel", "sector": "Metals"},
    "TCS.NS": {"name": "TCS", "sector": "IT"},
    "TECHM.NS": {"name": "Tech Mahindra", "sector": "IT"},
    "TITAN.NS": {"name": "Titan", "sector": "Others"},
    "TRENT.NS": {"name": "Trent", "sector": "Others"},
    "ULTRACEMCO.NS": {"name": "UltraTech Cement", "sector": "Infrastructure"},
    "WIPRO.NS": {"name": "Wipro", "sector": "IT"},
    "BRITANNIA.NS": {"name": "Britannia", "sector": "FMCG"},
}

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"


# --- Technical Indicators ---

def calc_rsi(prices, period=14):
    """Calculate RSI (Relative Strength Index)."""
    if len(prices) < period + 1:
        return None
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def calc_macd(prices):
    """Calculate MACD line and signal line."""
    if len(prices) < 26:
        return None, None
    prices = np.array(prices, dtype=float)
    ema12 = _ema(prices, 12)
    ema26 = _ema(prices, 26)
    macd_line = ema12 - ema26
    signal_line = _ema_from_values(np.array([macd_line]), 9) if macd_line else 0
    return round(macd_line, 2), round(signal_line, 2)


def _ema(data, period):
    """Calculate Exponential Moving Average."""
    if len(data) < period:
        return float(data[-1])
    multiplier = 2 / (period + 1)
    ema = np.mean(data[:period])
    for price in data[period:]:
        ema = (price - ema) * multiplier + ema
    return ema


def _ema_from_values(data, period):
    """EMA for a single value (simplified)."""
    return float(data[-1]) if len(data) > 0 else 0


def calc_sma(prices, period):
    """Calculate Simple Moving Average."""
    if len(prices) < period:
        return None
    return round(float(np.mean(prices[-period:])), 2)


def calc_bollinger(prices, period=20):
    """Calculate Bollinger Bands."""
    if len(prices) < period:
        return None, None, None
    sma = np.mean(prices[-period:])
    std = np.std(prices[-period:])
    return round(float(sma + 2 * std), 2), round(float(sma), 2), round(float(sma - 2 * std), 2)


def calc_atr(highs, lows, closes, period=14):
    """Calculate Average True Range."""
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if len(trs) < period:
        return None
    return round(float(np.mean(trs[-period:])), 2)


def calc_beta(stock_closes, nifty_closes):
    """Calculate Beta vs Nifty50 index."""
    min_len = min(len(stock_closes), len(nifty_closes))
    if min_len < 20:
        return None
    sr = np.diff(stock_closes[-min_len:]) / stock_closes[-min_len:-1] if min_len > 1 else []
    nr = np.diff(nifty_closes[-min_len:]) / nifty_closes[-min_len:-1] if min_len > 1 else []
    if len(sr) < 2 or len(nr) < 2:
        return None
    cov = np.cov(sr, nr)[0][1]
    var = np.var(nr)
    if var == 0:
        return None
    return round(float(cov / var), 2)


def calc_volatility(closes, period=30):
    """Calculate annualized volatility from daily returns."""
    if len(closes) < period + 1:
        return None
    returns = np.diff(closes[-period - 1:]) / closes[-period - 1:-1]
    return round(float(np.std(returns) * np.sqrt(252) * 100), 2)


def calc_max_drawdown(closes):
    """Calculate max drawdown from peak."""
    if len(closes) < 2:
        return None
    peak = closes[0]
    max_dd = 0
    for p in closes:
        if p > peak:
            peak = p
        dd = (peak - p) / peak * 100
        if dd > max_dd:
            max_dd = dd
    return round(float(-max_dd), 2)


def calc_sharpe(closes, risk_free_rate=0.065):
    """Calculate Sharpe-like ratio (annualized)."""
    if len(closes) < 30:
        return None
    returns = np.diff(closes[-30:]) / closes[-30:-1]
    ann_return = float(np.mean(returns) * 252)
    ann_vol = float(np.std(returns) * np.sqrt(252))
    if ann_vol == 0:
        return None
    return round((ann_return - risk_free_rate) / ann_vol, 2)


def calc_support_resistance(closes):
    """Calculate support and resistance from recent swing points."""
    if len(closes) < 10:
        return None, None
    recent = closes[-20:] if len(closes) >= 20 else closes
    support = round(float(min(recent)), 2)
    resistance = round(float(max(recent)), 2)
    return support, resistance


def calc_risk_score(volatility, debt_to_equity, rsi, price, week52_high, week52_low, beta):
    """Calculate composite risk score 1-10."""
    score = 5.0  # Base

    # Volatility component (0-3 points)
    if volatility is not None:
        if volatility > 40:
            score += 2
        elif volatility > 25:
            score += 1
        elif volatility < 15:
            score -= 1

    # Debt component (0-2 points)
    if debt_to_equity > 150:
        score += 2
    elif debt_to_equity > 80:
        score += 1
    elif debt_to_equity < 30:
        score -= 1

    # RSI extremes (0-1 point)
    if rsi is not None and (rsi > 75 or rsi < 25):
        score += 1

    # 52W position (0-1 point)
    if week52_high > 0 and week52_low > 0:
        range_pct = (price - week52_low) / (week52_high - week52_low) if (week52_high - week52_low) > 0 else 0.5
        if range_pct > 0.95 or range_pct < 0.05:
            score += 1

    # Beta component (0-1 point)
    if beta is not None and abs(beta) > 1.5:
        score += 1

    return max(1, min(10, round(score)))


# --- Data Fetching ---

def fetch_stock_data(symbol, meta, nifty_closes=None):
    """Fetch comprehensive data for a single stock."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        hist = ticker.history(period="3mo")

        if hist.empty:
            return None

        closes = hist["Close"].values.tolist()
        highs = hist["High"].values.tolist()
        lows = hist["Low"].values.tolist()
        current_price = closes[-1] if closes else 0
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose") or (closes[-2] if len(closes) > 1 else current_price)
        change = current_price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0

        # Technical indicators
        rsi = calc_rsi(closes)
        macd_line, macd_signal = calc_macd(closes)
        sma20 = calc_sma(closes, 20)
        sma50 = calc_sma(closes, 50)
        sma200 = calc_sma(closes, 200) if len(closes) >= 200 else None
        bb_upper, bb_middle, bb_lower = calc_bollinger(closes)

        # Risk & volatility metrics
        atr = calc_atr(highs, lows, closes)
        beta = calc_beta(closes, nifty_closes) if nifty_closes else None
        volatility = calc_volatility(closes)
        max_drawdown = calc_max_drawdown(closes)
        sharpe = calc_sharpe(closes)
        support, resistance = calc_support_resistance(closes)

        week52_high = round(float(info.get("fiftyTwoWeekHigh") or 0), 2)
        week52_low = round(float(info.get("fiftyTwoWeekLow") or 0), 2)
        debt_to_equity = round(float(info.get("debtToEquity") or 0), 2)

        risk_score = calc_risk_score(volatility, debt_to_equity, rsi, current_price, week52_high, week52_low, beta)

        # Relative strength vs Nifty (30-day)
        relative_strength = None
        if nifty_closes and len(closes) >= 30 and len(nifty_closes) >= 30:
            stock_30d_ret = (closes[-1] - closes[-30]) / closes[-30] * 100
            nifty_30d_ret = (nifty_closes[-1] - nifty_closes[-30]) / nifty_closes[-30] * 100
            relative_strength = round(stock_30d_ret - nifty_30d_ret, 2)

        # 52W alerts
        near_52w_high = week52_high > 0 and current_price >= week52_high * 0.95
        near_52w_low = week52_low > 0 and current_price <= week52_low * 1.05

        # Earnings & dividend dates
        next_earnings = None
        earnings_soon = False
        ex_div_date = None
        payout_ratio = round(float(info.get("payoutRatio") or 0) * 100, 2)
        try:
            cal = ticker.calendar
            if cal is not None and not (hasattr(cal, 'empty') and cal.empty):
                if isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if ed:
                        edate = ed[0] if isinstance(ed, list) else ed
                        next_earnings = str(edate)[:10]
                exd = info.get("exDividendDate")
                if exd:
                    ex_div_date = datetime.fromtimestamp(exd).strftime("%Y-%m-%d") if isinstance(exd, (int, float)) else str(exd)[:10]
        except Exception:
            pass

        if next_earnings:
            try:
                days_to_earnings = (datetime.strptime(next_earnings, "%Y-%m-%d") - datetime.now()).days
                earnings_soon = 0 <= days_to_earnings <= 7
            except Exception:
                pass

        # Price history (last 30 days)
        recent_hist = hist.tail(30)
        price_history = [
            {"date": d.strftime("%Y-%m-%d"), "close": round(float(r["Close"]), 2), "volume": int(r["Volume"])}
            for d, r in recent_hist.iterrows()
        ]

        return {
            "symbol": symbol.replace(".NS", ""),
            "name": meta["name"],
            "sector": meta["sector"],
            "price": round(float(current_price), 2),
            "change": round(float(change), 2),
            "change_pct": round(float(change_pct), 2),
            "open": round(float(info.get("open") or info.get("regularMarketOpen") or 0), 2),
            "high": round(float(info.get("dayHigh") or info.get("regularMarketDayHigh") or 0), 2),
            "low": round(float(info.get("dayLow") or info.get("regularMarketDayLow") or 0), 2),
            "volume": int(info.get("volume") or info.get("regularMarketVolume") or 0),
            "market_cap": info.get("marketCap") or 0,
            "pe_ratio": round(float(info.get("trailingPE") or 0), 2),
            "pb_ratio": round(float(info.get("priceToBook") or 0), 2),
            "eps": round(float(info.get("trailingEps") or 0), 2),
            "dividend_yield": round(float(info.get("dividendYield") or 0) * 100, 2),
            "roe": round(float(info.get("returnOnEquity") or 0) * 100, 2),
            "debt_to_equity": debt_to_equity,
            "week52_high": week52_high,
            "week52_low": week52_low,
            "technicals": {
                "rsi": rsi,
                "macd": macd_line,
                "macd_signal": macd_signal,
                "sma20": sma20,
                "sma50": sma50,
                "sma200": sma200,
                "bb_upper": bb_upper,
                "bb_middle": bb_middle,
                "bb_lower": bb_lower,
            },
            "risk_metrics": {
                "risk_score": risk_score,
                "beta": beta,
                "atr": atr,
                "volatility_30d": volatility,
                "max_drawdown": max_drawdown,
                "sharpe_ratio": sharpe,
                "support": support,
                "resistance": resistance,
                "relative_strength": relative_strength,
                "near_52w_high": near_52w_high,
                "near_52w_low": near_52w_low,
                "payout_ratio": payout_ratio,
                "ex_dividend_date": ex_div_date,
                "next_earnings_date": next_earnings,
                "earnings_soon": earnings_soon,
            },
            "price_history": price_history,
        }
    except Exception as e:
        print(f"    Error fetching {symbol}: {e}")
        return None


def fetch_nifty_index():
    """Fetch Nifty50 index data with 3mo history for beta calculation."""
    try:
        nifty = yf.Ticker("^NSEI")
        info = nifty.info or {}
        hist = nifty.history(period="3mo")
        current = float(hist["Close"].iloc[-1]) if not hist.empty else 0
        prev = float(info.get("previousClose") or info.get("regularMarketPreviousClose") or 0)
        change = current - prev if prev else 0
        change_pct = (change / prev * 100) if prev else 0

        closes_list = hist["Close"].values.tolist() if not hist.empty else []
        trend = [
            {"date": d.strftime("%Y-%m-%d"), "close": round(float(r["Close"]), 2)}
            for d, r in hist.tail(30).iterrows()
        ]

        return {
            "value": round(current, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "prev_close": round(prev, 2),
            "trend": trend,
            "_closes": closes_list,  # Internal: for beta calculation
        }
    except Exception as e:
        print(f"  Error fetching Nifty index: {e}")
        return {"value": 0, "change": 0, "change_pct": 0, "prev_close": 0, "trend": [], "_closes": []}


def fetch_news(query, max_items=5):
    """Fetch news from Google News RSS."""
    try:
        url = GOOGLE_NEWS_RSS.format(query=query.replace(" ", "+"))
        feed = feedparser.parse(url)
        items = []
        for entry in feed.entries[:max_items]:
            title = re.sub(r"\s*-\s*[^-]+$", "", entry.get("title", ""))
            pub_date = ""
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                pub_date = datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
            items.append({"title": title.strip(), "date": pub_date, "link": entry.get("link", "")})
        return items
    except Exception:
        return []


# --- AI Analysis ---

def generate_signal(stock, api_key):
    """Call Groq to generate buy/sell/hold signal with reasoning."""
    tech = stock["technicals"]
    prompt = f"""You are an expert Indian stock market analyst. Analyze this Nifty50 stock and provide an investment recommendation.

Stock: {stock['name']} ({stock['symbol']})
Sector: {stock['sector']}
Current Price: Rs.{stock['price']} | Change: {stock['change_pct']}%
P/E: {stock['pe_ratio']} | P/B: {stock['pb_ratio']} | EPS: Rs.{stock['eps']}
Dividend Yield: {stock['dividend_yield']}% | ROE: {stock['roe']}% | Debt/Equity: {stock['debt_to_equity']}
52W High: Rs.{stock['week52_high']} | 52W Low: Rs.{stock['week52_low']}
RSI: {tech['rsi']} | MACD: {tech['macd']} | SMA20: {tech['sma20']} | SMA50: {tech['sma50']}

Respond ONLY with valid JSON (no markdown, no code blocks):
{{"signal": "Buy or Hold or Sell", "confidence": "High or Medium or Low", "reasoning": "2-3 sentence analysis combining technical and fundamental factors", "target_price": number (1 month target), "stop_loss": number, "risk": "Low or Medium or High"}}"""

    try:
        resp = requests.post(
            GROQ_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": GROQ_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.5, "max_tokens": 300},
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        result = json.loads(content)
        if "signal" in result and "reasoning" in result:
            result["signal"] = result["signal"].capitalize()
            if result["signal"] not in ("Buy", "Hold", "Sell"):
                result["signal"] = "Hold"
            if result.get("confidence") not in ("High", "Medium", "Low"):
                result["confidence"] = "Medium"
            if result.get("risk") not in ("Low", "Medium", "High"):
                result["risk"] = "Medium"
            result["target_price"] = round(float(result.get("target_price") or stock["price"] * 1.05), 2)
            result["stop_loss"] = round(float(result.get("stop_loss") or stock["price"] * 0.95), 2)
            return result
    except Exception as e:
        print(f"    Groq error for {stock['symbol']}: {e}")
    return generate_template_signal(stock)


def generate_template_signal(stock):
    """Fallback signal based on simple technical rules."""
    rsi = stock["technicals"].get("rsi") or 50
    price = stock["price"]
    sma50 = stock["technicals"].get("sma50") or price

    if rsi < 30 and price > sma50:
        signal, confidence = "Buy", "Medium"
    elif rsi > 70:
        signal, confidence = "Sell", "Medium"
    elif price > sma50:
        signal, confidence = "Buy", "Low"
    else:
        signal, confidence = "Hold", "Low"

    return {
        "signal": signal,
        "confidence": confidence,
        "reasoning": f"Based on RSI ({rsi}) and price position relative to SMA50 ({sma50}). Technical analysis only — verify with fundamentals.",
        "target_price": round(price * 1.05, 2),
        "stop_loss": round(price * 0.95, 2),
        "risk": "Medium",
    }


# --- Main ---

def main():
    print("=== Nifty50 Smart Investment Dashboard ===")
    print(f"  Time: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")

    # Fetch Nifty50 index
    print("\nFetching Nifty50 index...")
    nifty_index = fetch_nifty_index()
    print(f"  Nifty50: {nifty_index['value']} ({nifty_index['change_pct']:+.2f}%)")

    nifty_closes = nifty_index.get("_closes", [])

    # Fetch all stocks
    print("\nFetching stock data...")
    stocks = []
    for symbol, meta in NIFTY50.items():
        print(f"  {meta['name']}...", end=" ", flush=True)
        data = fetch_stock_data(symbol, meta, nifty_closes)
        if data:
            stocks.append(data)
            rs = data.get("risk_metrics", {}).get("risk_score", "?")
            print(f"Rs.{data['price']} ({data['change_pct']:+.2f}%) Risk:{rs}")
        else:
            print("FAILED")
        time.sleep(0.3)  # Be gentle with Yahoo Finance

    print(f"\n  Fetched {len(stocks)}/50 stocks")

    # Fetch market news
    print("\nFetching market news...")
    market_news = fetch_news("NSE Nifty50 India stock market today", max_items=10)
    print(f"  Got {len(market_news)} news items")

    # Generate AI signals
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    print(f"\nGenerating AI signals... ({'Groq API' if api_key else 'Template fallback'})")
    for i, stock in enumerate(stocks):
        if api_key:
            stock["ai"] = generate_signal(stock, api_key)
            print(f"  [{i+1}/{len(stocks)}] {stock['symbol']}: {stock['ai']['signal']} ({stock['ai']['confidence']})")
            time.sleep(3)
        else:
            stock["ai"] = generate_template_signal(stock)
            print(f"  [{i+1}/{len(stocks)}] {stock['symbol']}: {stock['ai']['signal']} (template)")

    # Compute sector performance
    sectors = {}
    for s in stocks:
        sec = s["sector"]
        if sec not in sectors:
            sectors[sec] = {"stocks": 0, "total_change": 0}
        sectors[sec]["stocks"] += 1
        sectors[sec]["total_change"] += s["change_pct"]
    sector_perf = {k: round(v["total_change"] / v["stocks"], 2) for k, v in sectors.items()}

    # Build output (strip internal fields)
    nifty_output = {k: v for k, v in nifty_index.items() if not k.startswith("_")}
    output = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "nifty_index": nifty_output,
        "stocks": stocks,
        "market_news": market_news,
        "sector_performance": sector_perf,
        "summary": {
            "total": len(stocks),
            "buy": len([s for s in stocks if s["ai"]["signal"] == "Buy"]),
            "hold": len([s for s in stocks if s["ai"]["signal"] == "Hold"]),
            "sell": len([s for s in stocks if s["ai"]["signal"] == "Sell"]),
            "gainers": len([s for s in stocks if s["change_pct"] > 0]),
            "losers": len([s for s in stocks if s["change_pct"] < 0]),
        },
    }

    out_path = Path(__file__).parent.parent / "data" / "stocks.json"
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(stocks)} stocks to {out_path}")


if __name__ == "__main__":
    main()
