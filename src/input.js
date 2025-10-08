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
    // Ensure selection never points at an enemy unit in MP viewer context
    const viewer = (typeof window !== 'undefined' && typeof window.MY_PLAYER === 'number') ? window.MY_PLAYER : game.currentPlayer;
    const curSel = game.getUnitById(game.selectedId);
    if (curSel && curSel.player !== viewer) {
      game.selectedId = null;
    }

    // If an engineer build is queued, try to build here first
    if (game.buildQueue) {
      const hk = getHooks();
      if (hk && typeof hk.buildFort === 'function') {
        const { fortType } = game.buildQueue;
        const eng = game.getUnitById(game.buildQueue.engineerId);
        hk.buildFort(fortType.name, eng ? eng.id : null, x, y);
        try { if (typeof window !== 'undefined' && window.HIDE_SHOP_PREVIEW) window.HIDE_SHOP_PREVIEW(); } catch {}
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
        const q = game.spawnQueue; // capture before hook runs
        const kind = q.kind;
        if (kind === 'unit') hk.spawn({ kind, unitType: q.unitType.name, x, y });
        else if (kind === 'fort') hk.spawn({ kind, fortType: q.fortType.name, x, y });
        try { if (typeof window !== 'undefined' && window.HIDE_SHOP_PREVIEW) window.HIDE_SHOP_PREVIEW(); } catch {}
        if (typeof window !== 'undefined' && window.__LAST_HOOK_SENT !== true && window.__MP_CLIENT) {
          try {
            if (kind === 'unit') { console.log('HOOK spawn (post-fallback)', { kind, unitType: q.unitType.name, x, y }); window.__MP_CLIENT.action({ kind: 'spawn', spawnType: 'unit', unitType: q.unitType.name, x, y }); }
            else { console.log('HOOK spawn (post-fallback)', { kind, fortType: q.fortType.name, x, y }); window.__MP_CLIENT.action({ kind: 'spawn', spawnType: 'fort', fortType: q.fortType.name, x, y }); }
          } catch {}
        }
        game.spawnQueue = null; // await server
        return;
      } else {
        const q = game.spawnQueue; // capture before trySpawnAt clears it
        const spawned = game.trySpawnAt(x, y);
        // If in MP and we locally spawned due to missing hooks, send snapshot now
        if (spawned && typeof window !== 'undefined') {
          try {
            if (typeof window.SYNC_SNAPSHOT === 'function') window.SYNC_SNAPSHOT();
          } catch {}
        }
        if (spawned) { try { if (typeof window !== 'undefined' && window.HIDE_SHOP_PREVIEW) window.HIDE_SHOP_PREVIEW(); } catch {} return; } // done
        // If invalid, fall through to normal handling (to allow selection)
      }
    }

    const sel = game.getUnitById(game.selectedId);
    const enemy = game.getEnemyAt(x, y);
    const fort = game.getFortAt(x, y);
    // Determine viewer (local player) for selection, independent of turn
    // viewer computed above
    // If clicking your own unit (from viewer's perspective), select it
    if (!sel) {
      const unit = game.units.find(u => u.x === x && u.y === y && u.player === viewer) || null;
      game.selectedId = unit ? unit.id : null;
      return;
    }

    // If clicked another of your units, switch selection
    const ownHere = game.units.find(u => u.x === x && u.y === y && u.player === viewer);
    if (ownHere) {
      game.selectedId = ownHere.id;
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
          const id = sel.id;
          hk.attack(id, x, y);
          if (typeof window !== 'undefined' && window.__LAST_HOOK_SENT !== true && window.__MP_CLIENT) {
            try { console.log('HOOK attack (post-fallback)', { attackerId: id, x, y }); window.__MP_CLIENT.action({ kind: 'attack', attackerId: id, x, y }); } catch {}
          }
        } else {
          game.attack(sel, enemy || fort);
          if (typeof window !== 'undefined') {
            try { if (typeof window.SYNC_SNAPSHOT === 'function') window.SYNC_SNAPSHOT(); } catch {}
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
          const id = sel.id;
          hk.move(id, x, y);
          if (typeof window !== 'undefined' && window.__LAST_HOOK_SENT !== true && window.__MP_CLIENT) {
            try { console.log('HOOK move (post-fallback)', { unitId: id, x, y }); window.__MP_CLIENT.action({ kind: 'move', unitId: id, x, y }); } catch {}
          }
        } else {
          const ok = game.moveUnitTo(sel, x, y);
          // If carrying flag and on base, check capture now
          game.checkFlagCapture(sel);
          if (ok && typeof window !== 'undefined') {
            try { if (typeof window.SYNC_SNAPSHOT === 'function') window.SYNC_SNAPSHOT(); } catch {}
          }
        }
        return;
      }
    }
  };

  // Double-click (mouse) and double-tap (touch) to show deployed entity preview
  let lastTapTime = 0;

  const onClick = (e) => { onPoint(e.clientX, e.clientY); };
  const onPointerDown = (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const now = Date.now();
      // Double-tap within 300ms
      if (now - lastTapTime < 300) {
        e.preventDefault();
        const { x, y } = computeTile(e.clientX, e.clientY);
        try { if (typeof window !== 'undefined' && window.SHOW_DEPLOYED_PREVIEW) window.SHOW_DEPLOYED_PREVIEW(x, y, e.clientX, e.clientY); } catch {}
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      e.preventDefault();
      onPoint(e.clientX, e.clientY);
    }
  };
  const onDblClick = (e) => {
    const { x, y } = computeTile(e.clientX, e.clientY);
    try { if (typeof window !== 'undefined' && window.SHOW_DEPLOYED_PREVIEW) window.SHOW_DEPLOYED_PREVIEW(x, y, e.clientX, e.clientY); } catch {}
  };

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);

  canvas[HANDLERS_KEY] = { click: onClick, pointerdown: onPointerDown, dblclick: onDblClick };
}
