export const dynamic = 'force-dynamic';
export async function GET(req) {
  const m = new URL(req.url).searchParams.get('mints') || '';
  if (!/^[A-Za-z0-9,]{32,1400}$/.test(m)) return Response.json({});
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${m}`, { cache: 'no-store' });
  const out = {};
  for (const p of r.ok ? await r.json() : []) {
    const k = p.baseToken?.address, liq = p.liquidity?.usd || 0;
    if (k && /^pump/.test(p.dexId) && (!out[k] || liq > out[k].liq)) out[k] = { price: Number(p.priceUsd), liq };
  }
  return Response.json(out);
}
