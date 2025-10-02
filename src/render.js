export class Renderer {
  constructor(ctx, tileSize, game) {
    this.ctx = ctx;
    this.T = tileSize;
    this.game = game;
    this.bgImage = null; // optional background image
    this.assets = null; // optional AssetStore
  }

  drawBackground() {
    const { ctx, T } = this;
    const W = this.game.w * T;
    const H = this.game.h * T;
    ctx.clearRect(0, 0, W, H);
    if (this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawGridLines() {
    const { ctx, T } = this;
    const W = this.game.w * T;
    const H = this.game.h * T;
    // Grid lines
    ctx.strokeStyle = 'rgba(18, 61, 18, 0.4)'; // translucent dark green
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.game.w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * T + 0.5, 0);
      ctx.lineTo(x * T + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= this.game.h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * T + 0.5);
      ctx.lineTo(W, y * T + 0.5);
      ctx.stroke();
    }
  }

  drawSpawnHints() {
    const { ctx, T } = this;
    // Base spawn tiles
    if (this.game.spawnQueue) {
      const tiles = this.game.getValidSpawnTiles();
      ctx.fillStyle = 'rgba(137, 87, 229, 0.28)';
      ctx.strokeStyle = 'rgba(137, 87, 229, 0.9)';
      ctx.lineWidth = 2;
      for (const { x, y } of tiles) {
        ctx.fillRect(x * T + 2, y * T + 2, T - 4, T - 4);
        ctx.strokeRect(x * T + 2, y * T + 2, T - 4, T - 4);
      }
    }
    // Engineer build tiles
    if (this.game.buildQueue) {
      const tilesB = this.game.getValidEngineerBuildTiles();
      ctx.fillStyle = 'rgba(46, 160, 67, 0.25)'; // greenish
      ctx.strokeStyle = 'rgba(46, 160, 67, 0.9)';
      ctx.lineWidth = 2;
      for (const { x, y } of tilesB) {
        ctx.fillRect(x * T + 4, y * T + 4, T - 8, T - 8);
        ctx.strokeRect(x * T + 4, y * T + 4, T - 8, T - 8);
      }
    }
  }

  drawBasesAndFlags() {
    const { ctx, T } = this;
    // Bases
    for (let i = 0; i < 2; i++) {
      const base = this.game.bases[i];
      const img = this.assets && this.assets.get('Base');
      if (img) {
        ctx.drawImage(img, base.x * T + 2, base.y * T + 2, T - 4, T - 4);
      } else {
        ctx.fillStyle = '#8957e5';
        ctx.fillRect(base.x * T + 4, base.y * T + 4, T - 8, T - 8);
      }
    }
    // Flags
    for (let i = 0; i < 2; i++) {
      const flag = this.game.flags[i];
      let { x, y } = flag;
      const carrier = flag.carriedBy ? this.game.getUnitById(flag.carriedBy) : null;
      if (carrier) { x = carrier.x; y = carrier.y; }
      // Show enemy flag only if visible to current player; always show your own flag
      const current = this.game.currentPlayer;
      if (i === current || this.game.isTileVisibleTo(current, x, y)) {
        this.drawFlag(x, y, i);
      }
    }
  }

  drawForts() {
    const { ctx, T } = this;
    for (const f of this.game.forts) {
      // Hide enemy forts in fog
      const current = this.game.currentPlayer;
      if (f.player !== current && !this.game.isTileVisibleTo(current, f.x, f.y)) continue;
      ctx.save();
      ctx.translate(f.x * T, f.y * T);
      const pad = 6;
      const img = this.assets && this.assets.get(f.type);
      if (img) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, pad, pad, T - pad * 2, T - pad * 2);
      } else {
        if (f.type === 'BarbedWire') {
          ctx.strokeStyle = '#9e6b41';
          ctx.lineWidth = 2;
          for (let i = 12; i <= T - 12; i += 8) {
            ctx.beginPath();
            ctx.moveTo(12, i);
            ctx.lineTo(T - 12, i - 8);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = f.type === 'Bunker' ? '#6e7681' : '#8b949e';
          ctx.fillRect(6, 6, T - 12, T - 12);
          ctx.fillStyle = '#0d1117';
          ctx.fillRect(10, 10, T - 20, T - 20);
        }
      }
      // HP bar
      const maxHp = f.maxHp ?? (f.type === 'Bunker' ? 30 : f.type === 'Pillbox' ? 20 : 8);
      const hpRatio = Math.max(0, Math.min(1, f.hp / (maxHp || 1)));
      ctx.fillStyle = '#161b22';
      ctx.fillRect(8, T - 10, T - 16, 6);
      ctx.fillStyle = hpRatio > 0.5 ? '#2ea043' : hpRatio > 0.25 ? '#d29922' : '#f85149';
      ctx.fillRect(8, T - 10, (T - 16) * hpRatio, 6);
      ctx.restore();
    }
  }

  drawFlag(x, y, ownerIndex) {
    const { ctx, T } = this;
    const key = ownerIndex === 0 ? 'BlueFlag' : 'OrangeFlag';
    const img = this.assets && this.assets.get(key);
    if (img) {
      ctx.drawImage(img, x * T + 10, y * T + 10, T - 20, T - 20);
    } else {
      ctx.save();
      ctx.translate(x * T, y * T);
      ctx.fillStyle = '#d29922';
      ctx.fillRect(12, 12, T - 24, T - 24);
      ctx.restore();
    }
  }

  drawRanges() {
    const { ctx, T } = this;
    const sel = this.game.getUnitById(this.game.selectedId);
    if (!sel) return;
    // Spotted overlay for Artillery extended range
    if (sel.type === 'Artillery') {
      const spotted = this.game.getArtillerySpottedTiles(sel);
      if (spotted && spotted.size) {
        ctx.fillStyle = 'rgba(210,153,34,0.14)';
        ctx.strokeStyle = 'rgba(210,153,34,0.5)';
        ctx.lineWidth = 1;
        for (const key of spotted) {
          const [x, y] = key.split(',').map(Number);
          ctx.fillRect(x * T + 4, y * T + 4, T - 8, T - 8);
          ctx.strokeRect(x * T + 4, y * T + 4, T - 8, T - 8);
        }
      }
    }
    if (!sel.moved) {
      const moves = this.game.getMoveRange(sel);
      ctx.fillStyle = 'rgba(88,166,255,0.25)';
      for (const key of moves) {
        const [x, y] = key.split(',').map(Number);
        ctx.fillRect(x * T + 2, y * T + 2, T - 4, T - 4);
      }
    }
    if (!sel.acted) {
      const atks = this.game.getAttackableTiles(sel);
      ctx.fillStyle = 'rgba(255,101,101,0.25)';
      for (const key of atks) {
        const [x, y] = key.split(',').map(Number);
        ctx.fillRect(x * T + 8, y * T + 8, T - 16, T - 16);
      }
    }
  }

  drawUnits() {
    const { ctx, T } = this;
    for (const u of this.game.units) {
      // Hide enemy units in fog
      const current = this.game.currentPlayer;
      if (u.player !== current && !this.game.isTileVisibleTo(current, u.x, u.y)) continue;
      ctx.save();
      // Shake effect if recently hit
      let shakeX = 0, shakeY = 0;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (u.hitUntil && now < u.hitUntil) {
        const remaining = u.hitUntil - now;
        const duration = 200;
        const intensity = Math.max(0, Math.min(1, remaining / duration));
        const mag = 3 * intensity; // up to 3px
        // Pseudo-random wiggle based on time and id
        const t = now / 30 + u.id * 7.3;
        shakeX = Math.sin(t) * mag;
        shakeY = Math.cos(t * 1.3) * mag;
      }
      ctx.translate(u.x * T + shakeX, u.y * T + shakeY);
      // Body (image if available). If on friendly bunker, render smaller to indicate stacking.
      let pad = 6;
      const onFriendlyBunker = this.game.isFriendlyBunkerAt(u.x, u.y, u.player);
      if (onFriendlyBunker) pad = 12;
      const img = this.assets && this.assets.get(u.type);
      if (img) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, pad, pad, T - pad * 2, T - pad * 2);
        // Per-player tint overlay for sprites
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = u.player === 0 ? 'rgba(88,166,255,0.35)' : 'rgba(255,166,87,0.35)';
        ctx.fillRect(pad, pad, T - pad * 2, T - pad * 2);
        ctx.restore();
        // Add a small player color strip at the bottom
        ctx.fillStyle = u.player === 0 ? '#58a6ff' : '#ffa657';
        ctx.fillRect(8, T - 14, T - 16, 4);
      } else {
        ctx.fillStyle = u.color;
        ctx.fillRect(pad, pad, T - pad * 2, T - pad * 2);
      }
      // HP bar
      const maxHp = u.maxHp ?? (u.type === 'Tank' ? 18 : (u.type === 'Artillery' ? 12 : 10));
      const hpRatio = Math.max(0, Math.min(1, u.hp / (maxHp || 1)));
      ctx.fillStyle = '#161b22';
      ctx.fillRect(8, T - 10, T - 16, 6);
      ctx.fillStyle = hpRatio > 0.5 ? '#2ea043' : hpRatio > 0.25 ? '#d29922' : '#f85149';
      ctx.fillRect(8, T - 10, (T - 16) * hpRatio, 6);
      // Type initial (fallback only when no sprite)
      if (!(this.assets && this.assets.get(u.type))) {
        ctx.fillStyle = '#0d1117';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const initial = u.type[0];
        ctx.fillText(initial, T/2, T/2);
      }
      // Selection outline
      if (u.id === this.game.selectedId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(6, 6, T - 12, T - 12);
      }
      ctx.restore();
    }
  }

  draw() {
    this.drawBackground();
    this.drawGridLines();
    this.drawSpawnHints();
    this.drawForts();
    this.drawRanges();
    this.drawBasesAndFlags();
    this.drawUnits();
    this.drawFog();
    this.drawEffects();
  }

  drawFog() {
    const { ctx, T } = this;
    const current = this.game.currentPlayer;
    // Ensure visibility is up to date
    if (typeof this.game.recomputeVisibility === 'function') this.game.recomputeVisibility();
    const vis = this.game.visibility[current] || new Set();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < this.game.h; y++) {
      for (let x = 0; x < this.game.w; x++) {
        if (!vis.has(`${x},${y}`)) {
          ctx.fillRect(x * T, y * T, T, T);
        }
      }
    }
  }

  drawEffects() {
    const { ctx, T } = this;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Keep only live effects
    this.game.effects = this.game.effects.filter(e => e.until > now);
    for (const e of this.game.effects) {
      if (e.type === 'explosion') {
        const prog = 1 - Math.max(0, e.until - now) / Math.max(1, e.until - e.start);
        const cx = e.x * T + T / 2;
        const cy = e.y * T + T / 2;
        const r1 = 6 + prog * 10;
        const r2 = 2 + prog * 20;
        ctx.save();
        // Make blasts pop over fog and sprites
        ctx.globalCompositeOperation = 'lighter';
        // Outer smoke ring
        ctx.beginPath();
        ctx.arc(cx, cy, r2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125,125,125,${0.35 * (1 - prog)})`;
        ctx.fill();
        // Core flash
        ctx.beginPath();
        ctx.arc(cx, cy, r1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,170,40,${0.7 * (1 - prog)})`;
        ctx.fill();
        // Shock ring
        ctx.beginPath();
        ctx.arc(cx, cy, 8 + prog * 22, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,220,120,${0.5 * (1 - prog)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}
