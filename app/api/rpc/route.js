const OK = new Set(['getBalance', 'sendTransaction', 'getSignatureStatuses', 'getLatestBlockhash', 'getBlockHeight', 'isBlockhashValid']);
export async function POST(req) {
  const body = await req.json();
  if (!(Array.isArray(body) ? body : [body]).every((c) => OK.has(c.method))) return Response.json({ error: 'method not allowed' }, { status: 403 });
  const r = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
