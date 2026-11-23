'use client';
import { useEffect, useRef, useState } from 'react';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const DEF = { on: false, minScore: 70, size: 0.02, maxOpen: 2, tp: 25, sl: -12, mins: 15, slip: 25, fee: 0.0005 };
const RESERVE = 0.01; // SOL always kept back for fees and token account rent
const F = [['minScore', 'Min score', 1], ['size', 'SOL per trade', 0.005], ['maxOpen', 'Max open', 1],
  ['tp', 'Take profit %', 1], ['sl', 'Stop loss %', 1], ['mins', 'Time stop (min)', 1], ['slip', 'Slippage %', 1]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const getPrices = (m) => fetch(`/api/price?mints=${m.join(',')}`).then((r) => (r.ok ? r.json() : {}));

export default function Bot({ coins, updatedAt }) {
  const [kp, setKp] = useState(null);
  const [bal, setBal] = useState(null);
  const [cfg, setCfg] = useState(DEF);
  const [pos, setPos] = useState([]);
  const [px, setPx] = useState({});
  const [log, setLog] = useState([]);
  const [show, setShow] = useState(false);
  const [dest, setDest] = useState('');
  const conn = useRef(null), kpR = useRef(null), cfgR = useRef(DEF), posR = useRef([]);
  const busy = useRef(new Set()), seen = useRef(new Map()), fails = useRef(new Map()), losses = useRef(0);

  const say = (t) => setLog((l) => [`${new Date().toLocaleTimeString()} ${t}`, ...l].slice(0, 12));
  const upd = (o) => { const c = { ...cfgR.current, ...o }; cfgR.current = c; setCfg(c); localStorage.setItem('pw_cfg', JSON.stringify(c)); };
  const save = (p) => { posR.current = p; setPos(p); localStorage.setItem('pw_pos', JSON.stringify(p)); };
  const refreshBal = () => kpR.current && conn.current.getBalance(kpR.current.publicKey).then((l) => setBal(l / 1e9)).catch(() => {});

  async function trade(action, mint, amount, slip) {
    const r = await fetch('/api/trade', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: kpR.current.publicKey.toBase58(), action, mint, amount,
        denominatedInSol: action === 'buy' ? 'true' : 'false', slippage: slip, priorityFee: cfgR.current.fee }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'trade API error');
    const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    tx.sign([kpR.current]);
    const sig = await conn.current.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    for (let i = 0; i < 25; i++) {
      await sleep(1500);
      const s = (await conn.current.getSignatureStatuses([sig])).value[0];
      if (s?.err) throw new Error('transaction failed on-chain');
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return sig;
    }
    throw new Error('not confirmed in time, check the wallet');
  }

  async function enter(c) {
    busy.current.add('buy'); seen.current.set(c.mint, Date.now());
    try {
      say(`Buying ${c.symbol} (score ${c.score})`);
      await trade('buy', c.mint, cfgR.current.size, cfgR.current.slip);
      const entry = (await getPrices([c.mint]))[c.mint]?.price || c.price;
      save([...posR.current, { mint: c.mint, symbol: c.symbol, entry, t: Date.now() }]);
      say(`Bought ${c.symbol} near $${entry}`);
    } catch (e) { say(`Buy ${c.symbol} failed: ${e.message}`); }
    busy.current.delete('buy'); refreshBal();
  }

  async function exit(p, why, pnl) {
    busy.current.add(p.mint);
    try {
      await trade('sell', p.mint, '100%', cfgR.current.slip);
      save(posR.current.filter((x) => x.mint !== p.mint));
      say(`Sold ${p.symbol} (${why}) at about ${pnl == null ? '?' : pnl.toFixed(1)}%`);
      losses.current = pnl != null && pnl < 0 ? losses.current + 1 : 0;
      if (losses.current >= 3) { upd({ on: false }); say('3 losing trades in a row, auto-trading paused'); }
    } catch (e) {
      const n = (fails.current.get(p.mint) || 0) + 1; fails.current.set(p.mint, n);
      say(`Sell ${p.symbol} failed (${n}/5): ${e.message}`);
      if (n >= 5) { save(posR.current.filter((x) => x.mint !== p.mint)); say(`Dropped ${p.symbol} from tracking, check the wallet manually`); }
    }
    busy.current.delete(p.mint); refreshBal();
  }

  useEffect(() => {
    conn.current = new Connection(`${location.origin}/api/rpc`, 'confirmed');
    const k = localStorage.getItem('pw_key');
    if (k) { kpR.current = Keypair.fromSecretKey(bs58.decode(k)); setKp(kpR.current); refreshBal(); }
    const c = { ...DEF, ...ls('pw_cfg', {}), on: false }; cfgR.current = c; setCfg(c); // always starts OFF after a reload
    const p = ls('pw_pos', []); posR.current = p; setPos(p);
    const b = setInterval(refreshBal, 15000);
    const x = setInterval(async () => {
      const ps = posR.current;
      if (!ps.length || !kpR.current) return;
      const prices = await getPrices(ps.map((p) => p.mint)).catch(() => ({}));
      setPx(prices);
      for (const p of ps) {
        if (busy.current.has(p.mint)) continue;
        const now = prices[p.mint]?.price, c = cfgR.current;
        const pnl = now && p.entry ? (now / p.entry - 1) * 100 : null;
        const why = pnl != null && pnl >= c.tp ? 'take profit' : pnl != null && pnl <= c.sl ? 'stop loss'
          : (Date.now() - p.t) / 60000 >= c.mins ? 'time stop' : null;
        if (why) exit(p, why, pnl); // exits run even when auto-trading is OFF
      }
    }, 6000);
    return () => { clearInterval(b); clearInterval(x); };
  }, []);

  useEffect(() => {
    const c = cfgR.current;
    if (!c.on || !kpR.current || !coins?.length || Date.now() - updatedAt > 45000 || busy.current.has('buy')) return;
    if (posR.current.length >= c.maxOpen || bal == null || bal < c.size + RESERVE) return;
    const pick = coins.find((x) => x.score >= c.minScore && !posR.current.some((p) => p.mint === x.mint)
      && Date.now() - (seen.current.get(x.mint) || 0) > 3600000);
    if (pick) enter(pick);
  }, [updatedAt]);

  function create() {
    const k = Keypair.generate();
    localStorage.setItem('pw_key', bs58.encode(k.secretKey)); kpR.current = k; setKp(k); refreshBal();
  }

  async function withdraw() {
    try {
      const to = new PublicKey(dest.trim());
      const l = await conn.current.getBalance(kpR.current.publicKey);
      const { blockhash } = await conn.current.getLatestBlockhash();
      const tx = new Transaction({ feePayer: kpR.current.publicKey, recentBlockhash: blockhash })
        .add(SystemProgram.transfer({ fromPubkey: kpR.current.publicKey, toPubkey: to, lamports: l - 5000 }));
      tx.sign(kpR.current);
      await conn.current.sendRawTransaction(tx.serialize());
      say('Withdrawal sent'); setTimeout(refreshBal, 4000);
    } catch (e) { say(`Withdraw failed: ${e.message}`); }
  }

  const addr = kp?.publicKey.toBase58();
  return (
    <section className="bot">
      <h2>Auto trader</h2>
      {!kp ? (<>
        <p className="meta">Wallets like Phantom ask for approval on every trade, so auto-trading uses its own trading wallet. It is created in this browser and its key never leaves it. Fund it with only money you can lose.</p>
        <button onClick={create}>Create trading wallet</button>
      </>) : (<>
        <p className="meta">Deposit SOL to: <code>{addr}</code> <button onClick={() => navigator.clipboard?.writeText(addr)}>Copy</button></p>
        <p>Balance: <b>{bal == null ? '…' : bal.toFixed(4)} SOL</b>. Keep this tab open, trading only runs while it is.</p>
        <div className="row">
          <button className={cfg.on ? 'on' : ''} onClick={() => upd({ on: !cfg.on })}>{cfg.on ? 'Auto-trading ON' : 'Auto-trading OFF'}</button>
          <button onClick={() => setShow(!show)}>{show ? 'Hide key' : 'Back up key'}</button>
        </div>
        {show && <p className="warn">Private key, import it into Phantom to recover funds. Never share it: <code>{bs58.encode(kp.secretKey)}</code></p>}
        <div className="cfg">{F.map(([k, l, s]) => (
          <label key={k}>{l}<input type="number" step={s} value={cfg[k]} onChange={(e) => upd({ [k]: +e.target.value })} /></label>))}</div>
        {pos.map((p) => { const n = px[p.mint]?.price, pnl = n && p.entry ? (n / p.entry - 1) * 100 : null; return (
          <p key={p.mint} className="pos"><b>{p.symbol}</b> {pnl == null ? 'waiting for price' : <span className={pnl >= 0 ? 'up' : 'dn'}>{pnl.toFixed(1)}%</span>}
            {' '}<button onClick={() => exit(p, 'manual sell', pnl)}>Sell now</button></p>); })}
        <div className="row">
          <input placeholder="Your own wallet address" value={dest} onChange={(e) => setDest(e.target.value)} />
          <button onClick={withdraw} disabled={!dest}>Withdraw all SOL</button>
        </div>
        <ul className="log">{log.map((l) => <li key={l}>{l}</li>)}</ul>
      </>)}
    </section>
  );
}
