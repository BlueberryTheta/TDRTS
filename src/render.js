export class Renderer {
  constructor(ctx, tileSize, game) {
    this.ctx = ctx;
    this.T = tileSize;
    this.game = game;
    this.bgImage = null; // optional background image
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
    ctx.strokeStyle = '#30363d';
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

  drawBasesAndFlags() {
    const { ctx, T } = this;
    // Bases
    for (let i = 0; i < 2; i++) {
      const base = this.game.bases[i];
      ctx.fillStyle = '#8957e5';
      ctx.fillRect(base.x * T + 4, base.y * T + 4, T - 8, T - 8);
    }
    // Flags
    for (let i = 0; i < 2; i++) {
      const flag = this.game.flags[i];
      let { x, y } = flag;
      const carrier = flag.carriedBy ? this.game.getUnitById(flag.carriedBy) : null;
      if (carrier) { x = carrier.x; y = carrier.y; }
      this.drawFlag(x, y);
    }
  }

  drawFlag(x, y) {
    const { ctx, T } = this;
    ctx.save();
    ctx.translate(x * T, y * T);
    ctx.fillStyle = '#d29922';
    ctx.fillRect(12, 12, T - 24, T - 24);
    ctx.restore();
  }

  drawRanges() {
    const { ctx, T } = this;
    const sel = this.game.getUnitById(this.game.selectedId);
    if (!sel) return;
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
      ctx.save();
      ctx.translate(u.x * T, u.y * T);
      // Body
      ctx.fillStyle = u.color;
      ctx.fillRect(8, 8, T - 16, T - 16);
      // HP bar
      const maxHp = u.type === 'Tank' ? 18 : (u.type === 'Artillery' ? 12 : 10);
      const hpRatio = Math.max(0, Math.min(1, u.hp / maxHp));
      ctx.fillStyle = '#161b22';
      ctx.fillRect(8, T - 10, T - 16, 6);
      ctx.fillStyle = hpRatio > 0.5 ? '#2ea043' : hpRatio > 0.25 ? '#d29922' : '#f85149';
      ctx.fillRect(8, T - 10, (T - 16) * hpRatio, 6);
      // Type initial
      ctx.fillStyle = '#0d1117';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const initial = u.type[0];
      ctx.fillText(initial, T/2, T/2);
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
    this.drawRanges();
    this.drawBasesAndFlags();
    this.drawUnits();
  }
}
