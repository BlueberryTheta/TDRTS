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

  const getHooks = () => {
    try { if (typeof window !== 'undefined' && window.__MP_HOOKS) return window.__MP_HOOKS; } catch {}
    return hooks;
  };

  const onPoint = (clientX, clientY) => {
    if (game.isGameOver) return; // block interactions when game ended
    // Recompute visibility for accurate fog interactions
    if (typeof game.recomputeVisibility === 'function') game.recomputeVisibility();
    const { x, y } = computeTile(clientX, clientY);

    // If an engineer build is queued, try to build here first
    if (game.buildQueue) {
      const hk = getHooks();
      if (hk && typeof hk.buildFort === 'function') {
        const { fortType } = game.buildQueue;
        const eng = game.getUnitById(game.buildQueue.engineerId);
        hk.buildFort(fortType.name, eng ? eng.id : null, x, y);
        game.buildQueue = null; // await server
        return;
      } else {
        const built = game.tryBuildAt(x, y);
        if (built) return;
      }
    }

    // If a spawn is queued, try to spawn here
    if (game.spawnQueue) {
      const hk = getHooks();
      if (hk && typeof hk.spawn === 'function') {
        const kind = game.spawnQueue.kind;
        if (kind === 'unit') hk.spawn({ kind, unitType: game.spawnQueue.unitType.name, x, y });
        else if (kind === 'fort') hk.spawn({ kind, fortType: game.spawnQueue.fortType.name, x, y });
        game.spawnQueue = null; // await server
        return;
      } else {
        const q = game.spawnQueue; // capture before trySpawnAt clears it
        const spawned = game.trySpawnAt(x, y);
        // If in MP and we locally spawned due to missing hooks, send the action now
        if (spawned && typeof window !== 'undefined' && window.__MP_CLIENT) {
          try {
            const spawnType = q?.kind;
            if (spawnType === 'unit') {
              console.log('HOOK spawn (fallback)', { kind: 'unit', unitType: q.unitType.name, x, y });
              window.__MP_CLIENT.action({ kind: 'spawn', spawnType: 'unit', unitType: q.unitType.name, x, y });
            } else if (spawnType === 'fort') {
              console.log('HOOK spawn (fallback)', { kind: 'fort', fortType: q.fortType.name, x, y });
              window.__MP_CLIENT.action({ kind: 'spawn', spawnType: 'fort', fortType: q.fortType.name, x, y });
            }
          } catch {}
        }
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
      const viewer = (typeof window !== 'undefined' && typeof window.MY_PLAYER === 'number') ? window.MY_PLAYER : game.currentPlayer;
      const visible = game.isTileVisibleTo(viewer, x, y);
      const spottedForArtillery = sel.type === 'Artillery' && game.hasFriendlyScoutNearTile(x, y, sel.player, 5);
      if (!visible && !spottedForArtillery) return;
      const atkTiles = game.getAttackableTiles(sel);
      if (atkTiles.has(`${x},${y}`)) {
        const hk = getHooks();
        if (hk && typeof hk.attack === 'function') {
          hk.attack(sel.id, x, y);
        } else {
          game.attack(sel, enemy || fort);
          if (typeof window !== 'undefined' && window.__MP_CLIENT) {
            try { console.log('HOOK attack (fallback)', { attackerId: sel.id, x, y }); window.__MP_CLIENT.action({ kind: 'attack', attackerId: sel.id, x, y }); } catch {}
          }
        }
        return;
      }
    }

    // Try move if not moved
    if (!sel.moved) {
      const moveTiles = game.getMoveRange(sel);
      if (moveTiles.has(`${x},${y}`)) {
        const hk = getHooks();
        if (hk && typeof hk.move === 'function') {
          hk.move(sel.id, x, y);
        } else {
          const ok = game.moveUnitTo(sel, x, y);
          // If carrying flag and on base, check capture now
          game.checkFlagCapture(sel);
          if (ok && typeof window !== 'undefined' && window.__MP_CLIENT) {
            try { console.log('HOOK move (fallback)', { unitId: sel.id, x, y }); window.__MP_CLIENT.action({ kind: 'move', unitId: sel.id, x, y }); } catch {}
          }
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
