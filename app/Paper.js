'use client';
import { useEffect, useRef, useState } from 'react';

const DEF = { on: true, min: 50, slip: 3, fee: 0.5, stopSlip: 5, tp: 25, sl: -12, mins: 15, maxOpen: 15 };
const F = [['min', 'Log score at least', 1], ['slip', 'Slippage per side %', 0.5], ['fee', 'Fee per side %', 0.1], ['stopSlip', 'Extra stop slippage %', 1],
  ['tp', 'Take profit %', 1], ['sl', 'Stop loss %', 1], ['mins', 'Time stop (min)', 1], ['maxOpen', 'Max open (25 cap)', 1]];
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const prices = (m) => fetch(`/api/price?mints=${m.join(',')}`).then((r) => (r.ok ? r.json() : {}));
const avg = (a) => (a.length ? a.reduce((s, t) => s + t.pnl, 0) / a.length : 0);
const stat = (ts) => { const w = ts.filter((t) => t.pnl > 0), l = ts.filter((t) => t.pnl <= 0);
  return { n: ts.length, w: w.length, win: ts.length ? (w.length / ts.length) * 100 : 0, aw: avg(w), al: avg(l), ev: avg(ts) }; };
const wilson = (w, n) => { if (!n) return [0, 0]; const z = 1.96, p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const a = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [((c - a) / d) * 100, ((c + a) / d) * 100]; };

function Tbl({ title, rows }) {
  return (<div className="scroll"><table className="stats"><thead><tr><th>{title}</th><th>Trades</th><th>Win %</th><th>Avg win</th><th>Avg loss</th><th>Per trade</th></tr></thead>
    <tbody>{rows.filter(([, s]) => s.n).map(([l, s]) => (<tr key={l}><td>{l}</td><td>{s.n}</td><td>{s.win.toFixed(0)}</td>
      <td>{s.aw.toFixed(1)}%</td><td>{s.al.toFixed(1)}%</td><td className={s.ev >= 0 ? 'up' : 'dn'}>{s.ev.toFixed(1)}%</td></tr>))}</tbody></table></div>);
}

export default function Paper({ coins, updatedAt }) {
  const [cfg, setCfg] = useState(DEF);
  const [open, setOpen] = useState([]);
  const [done, setDone] = useState([]);
  const [px, setPx] = useState({});
  const cfgR = useRef(DEF), openR = useRef([]), doneR = useRef([]), seen = useRef(new Map()), miss = useRef(new Map());

  const saveCfg = (o) => { const c = { ...cfgR.current, ...o }; cfgR.current = c; setCfg(c); localStorage.setItem('pp_cfg', JSON.stringify(c)); };
  const saveOpen = (p) => { openR.current = p; setOpen(p); localStorage.setItem('pp_open', JSON.stringify(p)); };
  const saveDone = (d) => { const x = d.slice(-2000); doneR.current = x; setDone(x); localStorage.setItem('pp_done', JSON.stringify(x)); };

  function close(p, why, raw) {
    let pnl = -90; // no price for 5 minutes: assume the coin rugged
    if (raw != null) pnl = (raw * (1 - p.slip / 100 - (why === 'stop' ? p.stopSlip / 100 : 0)) / p.entry - 1) * 100 - 2 * p.fee;
    saveDone([...doneR.current, { sym: p.sym, mint: p.mint, t0: p.t, score: p.score, tag: p.tag, c5: p.c5, c1: p.c1, liq: p.liq, mc: p.mc, age: p.age, why, pnl: +pnl.toFixed(2) }]);
    saveOpen(openR.current.filter((x) => x.mint !== p.mint));
  }

  useEffect(() => {
    cfgR.current = { ...DEF, ...ls('pp_cfg', {}) }; setCfg(cfgR.current);
    openR.current = ls('pp_open', []); setOpen(openR.current);
    doneR.current = ls('pp_done', []); setDone(doneR.current);
    [...openR.current, ...doneR.current].forEach((t) => seen.current.set(t.mint, t.t0 ?? t.t));
    const id = setInterval(async () => {
      const ps = openR.current; if (!ps.length) return;
      const q = await prices(ps.map((p) => p.mint)).catch(() => ({}));
      if (!Object.keys(q).length) return; // price feed down, do not judge anything
      setPx(q); const now = Date.now();
      for (const p of [...ps]) {
        const v = q[p.mint]?.price;
        if (!v) { const f = miss.current.get(p.mint) ?? now; miss.current.set(p.mint, f); if (now - f > 300000) close(p, 'no price', null); continue; }
        miss.current.delete(p.mint);
        const g = (v / p.entry - 1) * 100;
        const why = g >= p.tp ? 'target' : g <= p.sl ? 'stop' : now - p.t >= p.mins * 60000 ? 'time' : null;
        if (why) close(p, why, v);
      }
    }, 6000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const c = cfgR.current;
    if (!c.on || !coins?.length || Date.now() - updatedAt > 45000) return;
    let room = Math.min(c.maxOpen, 25) - openR.current.length; const add = [];
    for (const x of coins) {
      if (room <= 0 || add.length >= 3) break;
      if (x.score < c.min || !(x.price > 0) || openR.current.some((p) => p.mint === x.mint) || Date.now() - (seen.current.get(x.mint) || 0) < 3600000) continue;
      seen.current.set(x.mint, Date.now()); room--;
      add.push({ mint: x.mint, sym: x.symbol, t: Date.now(), entry: x.price * (1 + c.slip / 100), score: x.score, tag: x.tag, c5: x.c5, c1: x.c1,
        liq: x.liq, mc: x.mc, age: x.age, tp: c.tp, sl: c.sl, mins: c.mins, slip: c.slip, fee: c.fee, stopSlip: c.stopSlip });
    }
    if (add.length) saveOpen([...openR.current, ...add]);
  }, [updatedAt]);

  const csv = () => {
    const rows = doneR.current.map((t) => [new Date(t.t0).toISOString(), `"${String(t.sym).replace(/"/g, '')}"`, t.score, t.tag, t.c5, t.c1, t.liq, t.mc, t.age, t.why, t.pnl].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([['time,symbol,score,tag,change5m,change1h,liquidity,mcap,age,exit,pnl_pct', ...rows].join('\n')], { type: 'text/csv' }));
    a.download = 'paper-trades.csv'; a.click();
  };

  const all = stat(done), [lo, hi] = wilson(all.w, all.n);
  const be = all.aw > 0 && all.al < 0 ? (-all.al / (all.aw - all.al)) * 100 : null;
  const bucket = [[50, 60, '50-59'], [60, 70, '60-69'], [70, 80, '70-79'], [80, 101, '80+']].map(([a, b, l]) => [l, stat(done.filter((t) => t.score >= a && t.score < b))]);
  const tags = [...new Set(done.map((t) => t.tag))].map((g) => [g, stat(done.filter((t) => t.tag === g))]);
  const why = [...new Set(done.map((t) => t.why))].map((g) => [`Exit: ${g}`, stat(done.filter((t) => t.why === g))]);
  const half = Math.floor(done.length / 2);
  const verdict = all.n < 100 ? `Only ${all.n} closed trades so far. Wait for 100 or more before judging.`
    : all.ev > 0 && be != null && lo > be ? 'Positive after costs, and the low end of the win-rate range is above breakeven.'
    : all.ev > 0 ? 'Positive so far but not conclusive. Keep collecting trades.' : 'Negative after costs. Do not trade live with these settings.';

  return (
    <section className="bot">
      <h2>Paper trading</h2>
      <p className="meta">Simulated trades with no money. It logs every coin at or above the minimum score, applies the take profit, stop and time rules with slippage and fees, and records the result. It only runs while this tab is open.</p>
      <div className="row">
        <button className={cfg.on ? 'on' : ''} onClick={() => saveCfg({ on: !cfg.on })}>{cfg.on ? 'Logging ON' : 'Logging OFF'}</button>
        <button onClick={csv} disabled={!done.length}>Download CSV</button>
        <button onClick={() => confirm('Delete all paper trades?') && (saveDone([]), saveOpen([]))}>Reset</button>
      </div>
      <div className="cfg">{F.map(([k, l, s]) => (<label key={k}>{l}<input type="number" step={s} value={cfg[k]} onChange={(e) => saveCfg({ [k]: +e.target.value })} /></label>))}</div>
      <p><b>{open.length}</b> open, <b>{all.n}</b> closed. {open.map((p) => { const v = px[p.mint]?.price; return v ? `${p.sym} ${((v / p.entry - 1) * 100).toFixed(0)}%` : p.sym; }).join(', ')}</p>
      {all.n > 0 && (<>
        <p>Win rate <b>{all.win.toFixed(0)}%</b> (95% range {lo.toFixed(0)} to {hi.toFixed(0)}%), breakeven {be == null ? 'n/a' : `${be.toFixed(0)}%`}. Average per trade after costs: <b className={all.ev >= 0 ? 'up' : 'dn'}>{all.ev.toFixed(2)}%</b>.</p>
        <p className="meta">{verdict}</p>
        <Tbl title="By score" rows={bucket} />
        <Tbl title="By type" rows={tags} />
        <Tbl title="By exit" rows={why} />
        {all.n >= 40 && <Tbl title="Consistency" rows={[['First half', stat(done.slice(0, half))], ['Second half', stat(done.slice(half))]]} />}
      </>)}
    </section>
  );
}
