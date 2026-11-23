# Pump Scanner

Next.js app that scans pump.fun and DexScreener every 20 seconds and ranks Solana memecoins for short-term (about 15 minute) trades.

## Deploy
1. Push this folder to a GitHub repo.
2. On vercel.com choose Add New Project, import the repo, and deploy. No configuration is required.
3. Optional environment variables (see `.env.example`): `SOLANA_RPC_URL` for reliable holder checks.

Run locally: `npm install && npm run dev`.

## How it works
- Feeds: pump.fun (new launches, latest trades, near graduation) plus DexScreener (boosts, new profiles, pumpswap search). If a feed is blocked, the rest still work and the page lists which feeds are down.
- Each coin is scored 0-100: momentum (25), volume acceleration (20), buy pressure (20), liquidity and market cap health (15), age (10), graduation proximity (10), minus penalties for dumping, sell-heavy flow, thin liquidity, dead trading, late parabolic entries, and concentrated holders.
- Top-10 holder share is checked for the 12 best candidates (the largest account, usually the curve or pool, is excluded).
- Tune weights in `lib/score.js` and the take-profit / stop / time-stop defaults in `PLAN`.

Scores are heuristics, not predictions. Not financial advice.

## Auto trader
Creates a dedicated trading wallet in the browser (key stored in localStorage, never sent to a server). Buys the top coin scoring at least the minimum score, then sells at take profit, stop loss, or time stop. Trades are built by PumpPortal and signed locally. Exits run only while the tab is open. Auto-trading always starts OFF after a reload and pauses after 3 losing trades in a row.

## Paper trading
`app/Paper.js` simulates trades with no money: every coin scoring at least the minimum is logged, then exited by take profit, stop, or time stop with assumed slippage and fees (a coin with no price for 5 minutes is booked as -90%). Results are grouped by score bucket, coin type and exit reason, with a win-rate confidence range and a first-half versus second-half check. Data lives in browser localStorage; use Download CSV to keep it.
