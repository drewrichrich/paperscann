const PUMP = 'https://frontend-api-v3.pump.fun';
const DEX = 'https://api.dexscreener.com';
const HEAD = { 'user-agent': 'Mozilla/5.0 (compatible; pump-scanner)', accept: 'application/json' };

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: HEAD, signal: AbortSignal.timeout(ms), cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const fromPump = (a) => (Array.isArray(a) ? a : []).filter((c) => c.mint).map((c) => ({
  mint: c.mint,
  progress: c.complete ? 1 : Math.min(1, (c.real_sol_reserves || 0) / 85e9),
}));
const fromBoosts = (a) => (Array.isArray(a) ? a : [])
  .filter((t) => t.chainId === 'solana' && t.tokenAddress?.endsWith('pump')).map((t) => ({ mint: t.tokenAddress }));
const fromSearch = (j) => (j?.pairs || [])
  .filter((p) => p.chainId === 'solana' && /^pump/.test(p.dexId)).map((p) => ({ mint: p.baseToken.address }));

const pumpQ = (q) => `${PUMP}/coins?offset=0&limit=50&includeNsfw=false&${q}`;
const JOBS = {
  'pump.fun new launches': () => getJSON(pumpQ('sort=created_timestamp&order=DESC')).then(fromPump),
  'pump.fun latest trades': () => getJSON(pumpQ('sort=last_trade_timestamp&order=DESC')).then(fromPump),
  'pump.fun near graduation': () => getJSON(pumpQ('sort=market_cap&order=DESC&complete=false')).then(fromPump),
  'DexScreener top boosts': () => getJSON(`${DEX}/token-boosts/top/v1`).then(fromBoosts),
  'DexScreener latest boosts': () => getJSON(`${DEX}/token-boosts/latest/v1`).then(fromBoosts),
  'DexScreener new profiles': () => getJSON(`${DEX}/token-profiles/latest/v1`).then(fromBoosts),
  'DexScreener pumpswap search': () => getJSON(`${DEX}/latest/dex/search?q=pumpswap`).then(fromSearch),
  'DexScreener pump search': () => getJSON(`${DEX}/latest/dex/search?q=pump%20solana`).then(fromSearch),
};

export async function gather() {
  const names = Object.keys(JOBS);
  const res = await Promise.allSettled(names.map((n) => JOBS[n]()));
  const progress = new Map();
  const status = res.map((r, i) => {
    if (r.status === 'fulfilled') r.value.forEach((c) => progress.set(c.mint, c.progress ?? progress.get(c.mint)));
    return { name: names[i], ok: r.status === 'fulfilled', count: r.status === 'fulfilled' ? r.value.length : 0 };
  });
  return { progress, status };
}

export async function fetchPairs(mints) {
  const list = [...mints], chunks = [];
  for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
  const res = await Promise.allSettled(chunks.map((c) => getJSON(`${DEX}/tokens/v1/solana/${c.join(',')}`)));
  const best = new Map();
  for (const r of res) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const p of r.value) {
      if (!/^pump/.test(p.dexId) || !mints.has(p.baseToken?.address)) continue;
      const cur = best.get(p.baseToken.address);
      if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) best.set(p.baseToken.address, p);
    }
  }
  return [...best.values()];
}

async function rpc(method, params) {
  const r = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(7000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// Share of supply held by holders #2-#11 (the largest account is the bonding curve / pool vault).
export async function top10Pct(mint) {
  const [big, sup] = await Promise.all([rpc('getTokenLargestAccounts', [mint]), rpc('getTokenSupply', [mint])]);
  const total = Number(sup.value.amount);
  const sum = big.value.map((a) => Number(a.amount)).sort((a, b) => b - a).slice(1, 11).reduce((s, n) => s + n, 0);
  return (sum / total) * 100;
}
