export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const now = Math.floor(Date.now() / 1000);
    const ago = now - 200 * 86400;

    // 1. STRC daily prices from Yahoo Finance (no API key needed)
    const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/STRC?period1=${ago}&period2=${now}&interval=1d`;
    const yRes = await fetch(yUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrancheFi/1.0)' }
    });
    const yData = await yRes.json();
    const chart = yData.chart.result[0];
    const timestamps = chart.timestamp;
    const closes = chart.indicators.quote[0].close;

    const daily = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] !== null) {
        daily.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: Math.round(closes[i] * 100) / 100
        });
      }
    }

    const currentStrc = daily.length > 0 ? daily[daily.length - 1].close : 99.96;

    // Compute 30-day trailing vol
    const last30 = daily.slice(-31);
    let vol30d = 14.7;
    if (last30.length >= 10) {
      const rets = [];
      for (let i = 1; i < last30.length; i++) {
        rets.push(Math.log(last30[i].close / last30[i - 1].close));
      }
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const vari = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
      vol30d = Math.round(Math.sqrt(vari) * Math.sqrt(252) * 10000) / 100;
    }

    // 2. BTC price from CoinGecko (free, no key)
    let btcPrice = 84500;
    try {
      const btcRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
      );
      const btcData = await btcRes.json();
      btcPrice = btcData.bitcoin.usd;
    } catch (e) { /* fallback */ }

    // 3. USDC borrow rate from DeFi Llama (free, no key)
    let borrowRate = 5.5;
    try {
      const llamaRes = await fetch('https://yields.llama.fi/pools');
      const llamaData = await llamaRes.json();
      const pool = llamaData.data.find(
        p => p.symbol === 'USDC' &&
             p.project === 'aave-v3' &&
             p.chain === 'Ethereum'
      );
      if (pool && pool.apyBaseBorrow) {
        borrowRate = Math.round(pool.apyBaseBorrow * 100) / 100;
      }
    } catch (e) { /* fallback */ }

    // 4. Build weekly snapshots from inception
    const inception = '2026-03-03';
    const weeks = [];
    const firstEntry = daily.find(d => d.date >= inception);

    if (firstEntry) {
      weeks.push({ date: firstEntry.date, strc: firstEntry.close });
      let cursor = new Date(firstEntry.date);
      cursor.setDate(cursor.getDate() + 7);

      while (cursor <= new Date()) {
        const target = cursor.toISOString().split('T')[0];
        let closest = null;
        for (let i = daily.length - 1; i >= 0; i--) {
          if (daily[i].date <= target) { closest = daily[i]; break; }
        }
        if (closest && weeks[weeks.length - 1].date !== closest.date) {
          weeks.push({ date: closest.date, strc: closest.close });
        }
        cursor.setDate(cursor.getDate() + 7);
      }
    }

    res.status(200).json({
      current: {
        strc: currentStrc,
        btc: btcPrice,
        borrowRate: borrowRate,
        vol30d: vol30d,
        timestamp: new Date().toISOString()
      },
      daily: daily,
      weeks: weeks,
      meta: {
        inception: inception,
        dailyCount: daily.length,
        weekCount: weeks.length
      }
    });

  } catch (error) {
    // Always return valid JSON so dashboard can render with fallbacks
    res.status(200).json({
      error: error.message,
      current: {
        strc: 99.96, btc: 84500, borrowRate: 5.5,
        vol30d: 14.7, timestamp: new Date().toISOString()
      },
      daily: [],
      weeks: [{ date: '2026-03-03', strc: 99.96 }],
      meta: { inception: '2026-03-03', dailyCount: 0, weekCount: 1 }
    });
  }
}
