// Shared risk calculation. Works with any stock object that has:
// ticker, price, changePercent, volume, previousVolume, marketCap (optional).
export function calcRisk(stock) {
  const ticker  = (stock.ticker  || '').toUpperCase();
  const price   = Number(stock.price)          || 0;
  const pct     = Number(stock.changePercent)  || 0;
  const vol     = Number(stock.volume)         || 0;
  const prevVol = Number(stock.previousVolume) || 0;
  const rvol    = prevVol > 0 ? vol / prevVol  : 0;
  const mktCap  = Number(stock.marketCap)      || 0;

  const highReasons = [];
  if (price > 0 && price < 1)                    highReasons.push('Penny Stock');
  if (pct > 30 || pct < -20)                     highReasons.push('Extreme Move');
  if (vol > 0 && vol < 100_000)                  highReasons.push('Low Volume');
  if (prevVol > 0 && rvol > 10)                  highReasons.push('Unusual Volume');
  if (mktCap > 0 && mktCap < 50_000_000)         highReasons.push('Micro Cap');
  if (ticker.endsWith('F') || ticker.length > 5) highReasons.push('OTC/Warrant');

  if (highReasons.length > 0) return { level: 'high', reasons: highReasons };

  const medReasons = [];
  if (price >= 1 && price < 5)                                     medReasons.push('Low-Priced Stock');
  if ((pct >= 15 && pct <= 30) || (pct >= -20 && pct <= -10))     medReasons.push('Large Move');
  if (prevVol > 0 && rvol >= 3 && rvol <= 10)                     medReasons.push('High Volume');
  if (mktCap >= 50_000_000 && mktCap < 300_000_000)               medReasons.push('Small Cap');

  if (medReasons.length > 0) return { level: 'medium', reasons: medReasons };

  return { level: 'low', reasons: [] };
}
