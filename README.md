FlagFalls – WW2 Capture-The-Flag (Prototype)

Overview
- Static, client-side prototype of a turn-based, top-down WW2-themed CTF strategy game.
- Two players on a grid map; buy/spawn units, move/attack, capture the enemy flag and return to base.
- Current build includes a simple AI opponent (Player 2) for testing.

Run Locally
- Open `index.html` in a browser. No build step required.

AI
- Player 1 (human) plays first. Player 2 is AI.
- AI buys (favoring Tank > Artillery > Infantry), spawns near its base, attacks if in range, otherwise moves toward Player 1’s base, then attacks if possible.

Tuning
- Grid size/tile size: `src/main.js` (constants `GRID_W`, `GRID_H`, `TILE_SIZE`).
- Income/starting money/bases: `src/state.js`.
- Units: `src/units.js`.

Deploy to Vercel
Option A: Zero-config static deploy
- Create a new Vercel project and point it at this repository.
- Vercel detects a static site and serves files from the repo root.

Option B: vercel.json (optional)
- This repo includes an optional `vercel.json` for static hosting.
- Using the Vercel CLI:
  1) Install: `npm i -g vercel`
  2) Login: `vercel login`
  3) Deploy preview: `vercel`
  4) Promote to production: `vercel --prod`

Roadmap (Multiplayer)
- Add online multiplayer via one of:
  - WebSocket backend (Node/Edge) for authoritative turn sync + matchmaking.
  - WebRTC P2P with a lightweight signaling server for friend matches.
- Core features needed:
  - Game room creation/join, ready-state, and per-turn state sync.
  - Deterministic turn resolution or server authority to prevent divergence.
  - Simple persistence for active rooms and rejoin.
