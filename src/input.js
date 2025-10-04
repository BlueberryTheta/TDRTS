const HANDLERS_KEY = '__tdrtsHandlers';

export function attachInput(canvas, tileSize, game, hooks) {
  // Remove prior handlers to avoid duplicate interactions when reattaching (e.g., switching to MP)
  const prev = canvas[HANDLERS_KEY];
  if (prev && prev.click && prev.pointerdown) {
    try { canvas.removeEventListener('click', prev.click); } catch {}
    try { canvas.removeEventListener('pointerdown', prev.pointerdown, { passive: false }); } catch {}
  }

  const computeTile = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const tx = Math.floor(cx / (rect.width / game.w));
    const ty = Math.floor(cy / (rect.height / game.h));
    return { x: tx, y: ty };
  };

  const onPoint = (clientX, clientY) => {
    if (game.isGameOver) return; // block interactions when game ended
    // Recompute visibility for accurate fog interactions
    if (typeof game.recomputeVisibility === 'function') game.recomputeVisibility();
    const { x, y } = computeTile(clientX, clientY);

    // If an engineer build is queued, try to build here first
    if (game.buildQueue) {
      if (hooks && typeof hooks.buildFort === 'function') {
        const { fortType } = game.buildQueue;
        const eng = game.getUnitById(game.buildQueue.engineerId);
        hooks.buildFort(fortType.name, eng ? eng.id : null, x, y);
        game.buildQueue = null; // await server
        return;
      } else {
        const built = game.tryBuildAt(x, y);
        if (built) return;
      }
    }

    // If a spawn is queued, try to spawn here
    if (game.spawnQueue) {
      if (hooks && typeof hooks.spawn === 'function') {
        const kind = game.spawnQueue.kind;
        if (kind === 'unit') hooks.spawn({ kind, unitType: game.spawnQueue.unitType.name, x, y });
        else if (kind === 'fort') hooks.spawn({ kind, fortType: game.spawnQueue.fortType.name, x, y });
        game.spawnQueue = null; // await server
        return;
      } else {
        const spawned = game.trySpawnAt(x, y);
        if (spawned) return; // done
        // If invalid, fall through to normal handling (to allow selection)
      }
    }

    const sel = game.getUnitById(game.selectedId);
    const enemy = game.getEnemyAt(x, y);
    const fort = game.getFortAt(x, y);
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
    if ((enemy || (fort && fort.player !== game.currentPlayer)) && !sel.acted) {
      // Require visibility of target tile for player interactions,
      // except allow Artillery to target tiles spotted by a friendly Scout.
      const visible = game.isTileVisibleTo(game.currentPlayer, x, y);
      const spottedForArtillery = sel.type === 'Artillery' && game.hasFriendlyScoutNearTile(x, y, sel.player, 5);
      if (!visible && !spottedForArtillery) return;
      const atkTiles = game.getAttackableTiles(sel);
      if (atkTiles.has(`${x},${y}`)) {
        if (hooks && typeof hooks.attack === 'function') {
          hooks.attack(sel.id, x, y);
        } else {
          game.attack(sel, enemy || fort);
        }
        return;
      }
    }

    // Try move if not moved
    if (!sel.moved) {
      const moveTiles = game.getMoveRange(sel);
      if (moveTiles.has(`${x},${y}`)) {
        if (hooks && typeof hooks.move === 'function') {
          hooks.move(sel.id, x, y);
        } else {
          game.moveUnitTo(sel, x, y);
          // If carrying flag and on base, check capture now
          game.checkFlagCapture(sel);
        }
        return;
      }
    }
  };

  const onClick = (e) => { onPoint(e.clientX, e.clientY); };
  const onPointerDown = (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      onPoint(e.clientX, e.clientY);
    }
  };

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });

  canvas[HANDLERS_KEY] = { click: onClick, pointerdown: onPointerDown };
}
