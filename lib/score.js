const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ramp = (x, a, b) => clamp((x - a) / (b - a));
// 0 outside (lo, hi), rises to 1 at pLo, stays 1 until pHi, falls back to 0 at hi
const sweet = (x, lo, pLo, pHi, hi) =>
  x <= lo || x >= hi ? 0 : x < pLo ? (x - lo) / (pLo - lo) : x <= pHi ? 1 : (hi - x) / (hi - pHi);

// Default exit plan shown with every pick. Adjust to your own risk tolerance.
export const PLAN = { takeProfit: 25, stopLoss: -12, timeStopMin: 15 };

export function scorePair(p, x = {}) {
  const t5 = p.txns?.m5 || { buys: 0, sells: 0 };
  const v5 = p.volume?.m5 || 0, v1 = p.volume?.h1 || 0;
  const c5 = p.priceChange?.m5 ?? 0, c1 = p.priceChange?.h1 ?? 0;
  const liq = p.liquidity?.usd || 0;
  const mc = p.marketCap || p.fdv || 0;
  const age = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 60000 : null;
  const n5 = t5.buys + t5.sells;
  const buyRatio = n5 ? t5.buys / n5 : 0;
  const curve = p.dexId === 'pumpfun';
  const progress = curve ? (x.progress ?? clamp(mc / 69000)) : 1;
  const good = [], bad = [];

  const momentum = 0.7 * sweet(c5, -2, 3, 25, 90) + 0.3 * sweet(c1, -5, 5, 80, 300);
  const accel = v5 / Math.max(v1 / 12, 1);
  const volume = 0.5 * sweet(accel, 0.8, 1.5, 4, 12) + 0.5 * ramp(v5, 300, 5000);
  const pressure = 0.6 * sweet(buyRatio, 0.45, 0.58, 0.8, 0.97) + 0.4 * ramp(n5, 5, 60);
  const health = 0.4 * ramp(liq, 3000, 25000) + 0.6 * sweet(mc, 8000, 25000, 250000, 3e6);
  const ageF = age == null ? 0.3 : sweet(age, 3, 15, 360, 2880);
  const grad = curve ? sweet(progress, 0.35, 0.65, 0.95, 1.01) : age != null && age < 180 ? 0.6 : 0.2;

  let s = 25 * momentum + 20 * volume + 20 * pressure + 15 * health + 10 * ageF + 10 * grad;

  if (c5 >= 3 && c5 <= 25) good.push(`+${c5.toFixed(1)}% in 5m, momentum still early`);
  if (accel >= 1.5 && v5 > 300) good.push(`5m volume at ${accel.toFixed(1)}x its hourly pace`);
  if (buyRatio >= 0.55 && n5 >= 10) good.push(`${Math.round(buyRatio * 100)}% buys over ${n5} trades (5m)`);
  if (curve && progress >= 0.6) good.push(`${Math.round(progress * 100)}% of the way to graduation`);
  if (x.top10 != null && x.top10 < 25) good.push(`Top-10 holders own ${x.top10.toFixed(0)}%`);

  if (c5 < -8) { s -= 15; bad.push(`Dropping fast (${c5.toFixed(1)}% in 5m)`); }
  if (c5 > 60) { s -= 10; bad.push(`Already ran ${c5.toFixed(0)}% in 5m, late entry`); }
  if (c1 > 300) { s -= 10; bad.push('Parabolic over the last hour'); }
  if (n5 >= 8 && buyRatio < 0.4) { s -= 15; bad.push(`Sellers dominate (${Math.round((1 - buyRatio) * 100)}% sells)`); }
  if (liq < 2500) { s -= 20; bad.push('Thin liquidity, exits will slip'); }
  if (n5 < 4) { s -= 15; bad.push('Almost no trading in the last 5m'); }
  if (age != null && age < 3) { s -= 10; bad.push('Under 3 minutes old'); }
  if (x.top10 != null && x.top10 > 35) { s -= x.top10 > 50 ? 25 : 12; bad.push(`Top-10 holders own ${x.top10.toFixed(0)}%`); }

  const score = Math.round(clamp(s, 0, 100));
  return {
    score,
    grade: score >= 75 ? 'A' : score >= 62 ? 'B' : score >= 50 ? 'C' : 'D',
    tag: curve ? (progress >= 0.6 ? 'NEAR GRADUATION' : 'BONDING CURVE') : 'GRADUATED',
    progress: curve ? progress : null,
    good, bad,
  };
}
