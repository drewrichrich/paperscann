'use client';
import { useEffect, useState } from 'react';
import Bot from './Bot';
import Paper from './Paper';

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const pct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const TABS = [['all', 'All'], ['new', 'New (30m)'], ['near', 'Near graduation'], ['grad', 'Graduated']];
const MATCH = {
  all: () => true,
  new: (c) => c.age != null && c.age <= 30,
  near: (c) => c.tag === 'NEAR GRADUATION',
  grad: (c) => c.tag === 'GRADUATED',
};

export default function Home() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [min, setMin] = useState(50);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/scan', { cache: 'no-store' });
      if (!r.ok) throw new Error(`Scan failed (${r.status}). Retrying shortly.`);
      setD(await r.json()); setErr('');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => {
    load();
    if (!live) return;
    const i = setInterval(load, 20000);
    return () => clearInterval(i);
  }, [live]);

  const coins = (d?.coins || []).filter((c) => c.score >= min && MATCH[tab](c));
  const down = d?.sources.filter((s) => !s.ok) || [];

  return (
    <main>
      <header>
        <h1>Pump Scanner</h1>
        <p>pump.fun coins ranked for a quick in-and-out. Rescans every 20 seconds.</p>
      </header>

      <Paper coins={d?.coins} updatedAt={d?.updatedAt} />
      <Bot coins={d?.coins} updatedAt={d?.updatedAt} />

      <div className="bar">
        <div className="tabs">{TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>))}</div>
        <label>Min score {min}
          <input type="range" min="0" max="90" value={min} onChange={(e) => setMin(+e.target.value)} /></label>
        <button onClick={() => setLive(!live)}>{live ? 'Pause' : 'Resume'}</button>
        <button onClick={load} disabled={busy}>{busy ? 'Scanning' : 'Scan now'}</button>
      </div>

      {err && <p className="warn">{err}</p>}
      {d && <p className="meta">Scanned {d.scanned} coins in {(d.tookMs / 1000).toFixed(1)}s. Holder check: {d.holders}.
        {down.length > 0 && ` Unavailable feeds: ${down.map((s) => s.name).join(', ')}.`}</p>}
      {!d && !err && <p className="meta">Scanning pump.fun and DexScreener…</p>}
      {d && !coins.length && <p className="meta">Nothing clears your filters right now. Lower the minimum score or switch tabs.</p>}

      {coins.map((c, i) => (
        <article key={c.mint}>
          <div className={`score g${c.grade}`}><b>{c.score}</b><span>{c.grade}</span></div>
          <div className="body">
            <h2>{i + 1}. {c.symbol} <small>{c.name}</small></h2>
            <p className="tag">{c.tag}{c.progress != null && c.progress < 1 ? ` ${Math.round(c.progress * 100)}%` : ''}{c.age != null ? `, ${c.age}m old` : ''}</p>
            <dl>
              <div><dt>Market cap</dt><dd>{money(c.mc)}</dd></div>
              <div><dt>Liquidity</dt><dd>{money(c.liq)}</dd></div>
              <div><dt>Volume 5m</dt><dd>{money(c.v5)}</dd></div>
              <div><dt>Change 5m</dt><dd className={c.c5 >= 0 ? 'up' : 'dn'}>{pct(c.c5)}</dd></div>
              <div><dt>Change 1h</dt><dd className={c.c1 >= 0 ? 'up' : 'dn'}>{pct(c.c1)}</dd></div>
              <div><dt>Buys / sells 5m</dt><dd>{c.buys} / {c.sells}</dd></div>
              {c.top10 != null && <div><dt>Top-10 holders</dt><dd>{c.top10.toFixed(0)}%</dd></div>}
            </dl>
            <ul>{c.good.map((t) => <li key={t} className="up">{t}</li>)}{c.bad.map((t) => <li key={t} className="dn">{t}</li>)}</ul>
            <p className="plan">Plan: take profit {pct(d.plan.takeProfit)}, stop {pct(d.plan.stopLoss)}, out by {d.plan.timeStopMin} minutes.</p>
            <p className="links">
              <a href={`https://pump.fun/coin/${c.mint}`} target="_blank" rel="noreferrer">pump.fun</a>
              <a href={c.pair} target="_blank" rel="noreferrer">DexScreener</a>
              <button onClick={() => navigator.clipboard?.writeText(c.mint)}>Copy address</button>
            </p>
          </div>
        </article>
      ))}

      <footer>Scores are heuristics built from public data, not predictions. Most new coins lose money and some are rugs. Never risk more than you can afford to lose. This is not financial advice.</footer>
    </main>
  );
}
