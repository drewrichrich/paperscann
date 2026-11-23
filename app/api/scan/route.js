import { NextResponse } from 'next/server';
import { gather, fetchPairs, top10Pct } from '../../../lib/sources';
import { scorePair, PLAN } from '../../../lib/score';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const t0 = Date.now();
  const { progress, status } = await gather();
  const pairs = await fetchPairs(new Set(progress.keys()));
  const items = pairs.map((p) => ({ p, x: { progress: progress.get(p.baseToken.address) } }));
  const run = (i) => (i.s = scorePair(i.p, i.x));
  items.forEach(run);
  items.sort((a, b) => b.s.score - a.s.score);

  let holders = 'skipped';
  if (!process.env.SKIP_HOLDER_CHECK) {
    const top = items.slice(0, 12);
    const r = await Promise.allSettled(top.map((i) => top10Pct(i.p.baseToken.address)));
    let ok = 0;
    r.forEach((v, k) => { if (v.status === 'fulfilled') { top[k].x.top10 = v.value; run(top[k]); ok++; } });
    holders = `${ok}/${top.length} checked`;
    items.sort((a, b) => b.s.score - a.s.score);
  }

  const coins = items.slice(0, 40).map(({ p, x, s }) => ({
    mint: p.baseToken.address, symbol: p.baseToken.symbol, name: p.baseToken.name, dex: p.dexId,
    mc: p.marketCap || p.fdv || 0, liq: p.liquidity?.usd || 0, v5: p.volume?.m5 || 0,
    c5: p.priceChange?.m5 ?? 0, c1: p.priceChange?.h1 ?? 0,
    buys: p.txns?.m5?.buys || 0, sells: p.txns?.m5?.sells || 0,
    age: p.pairCreatedAt ? Math.round((Date.now() - p.pairCreatedAt) / 60000) : null,
    price: Number(p.priceUsd) || 0, top10: x.top10 ?? null, pair: p.url, ...s,
  }));

  return NextResponse.json({ updatedAt: Date.now(), tookMs: Date.now() - t0, scanned: pairs.length, holders, sources: status, plan: PLAN, coins });
}
