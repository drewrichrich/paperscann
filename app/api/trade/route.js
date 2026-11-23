const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Asks PumpPortal to build an UNSIGNED transaction. Signing happens in the browser; no key reaches the server.
export async function POST(req) {
  const b = await req.json();
  if (!B58.test(b.publicKey) || !B58.test(b.mint) || !['buy', 'sell'].includes(b.action)) return Response.json({ error: 'bad request' }, { status: 400 });
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: b.publicKey, action: b.action, mint: b.mint, amount: b.amount,
      denominatedInSol: b.denominatedInSol, slippage: b.slippage, priorityFee: b.priorityFee, pool: 'auto' }),
  });
  if (!r.ok) return Response.json({ error: (await r.text()).slice(0, 200) }, { status: 502 });
  return new Response(await r.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream' } });
}
