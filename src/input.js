export function attachInput(canvas, tileSize, game) {
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.floor(cx / tileSize);
    const y = Math.floor(cy / tileSize);

    // If a spawn is queued, try to spawn here
    if (game.spawnQueue) {
      const spawned = game.trySpawnAt(x, y);
      if (spawned) return; // done
      // If invalid, fall through to normal handling (to allow selection)
    }

    const sel = game.getUnitById(game.selectedId);
    const enemy = game.getEnemyAt(x, y);
    // If clicking your own unit, select it
    if (!sel) {
      game.selectUnitAt(x, y);
      return;
    }

    // If clicked another of your units, switch selection
    const ownHere = game.units.find(u => u.x === x && u.y === y && u.player === game.currentPlayer);
    if (ownHere) {
      game.selectUnitAt(x, y);
      return;
    }

    // Try attack if enemy in range and not acted
    if (enemy && !sel.acted) {
      const atkTiles = game.getAttackableTiles(sel);
      if (atkTiles.has(`${x},${y}`)) {
        game.attack(sel, enemy);
        return;
      }
    }

    // Try move if not moved
    if (!sel.moved) {
      const moveTiles = game.getMoveRange(sel);
      if (moveTiles.has(`${x},${y}`) && !enemy) {
        game.moveUnitTo(sel, x, y);
        // If carrying flag and on base, check capture now
        game.checkFlagCapture(sel);
        return;
      }
    }
  });
}

