export class MultiplayerClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.roomId = null;
    this.player = null; // 0 or 1
    this.handlers = new Map();
    try {
      const qs = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : null;
      this.debug = (typeof window !== 'undefined' && (window.DEBUG === true)) || (qs && qs.get('debug') === '1');
    } catch { this.debug = false; }
  }

  on(type, fn) { this.handlers.set(type, fn); }
  emit(type, data) { const h = this.handlers.get(type); if (h) h(data); }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        if (this.debug) console.log('[MP] connecting', this.url);
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => { if (this.debug) console.log('[MP] connected'); resolve(); };
        this.ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (this.debug) console.log('[MP] <-', msg);
          if (msg.type === 'room') {
            this.roomId = msg.roomId; this.player = msg.player;
            this.emit('room', msg);
          } else if (msg.type === 'snapshot') {
            this.emit('snapshot', msg);
          } else if (msg.type === 'event') {
            this.emit('event', msg);
          } else if (msg.type === 'error') {
            this.emit('error', msg);
          }
        };
        this.ws.onerror = (e) => { if (this.debug) console.error('[MP] ws error', e); this.emit('ws_error', e); reject(e); };
        this.ws.onclose = (e) => { if (this.debug) console.warn('[MP] ws closed', e?.code, e?.reason); this.emit('close'); };
        // Guard: timeout connection after 5s
        setTimeout(() => { if (!this.ws || this.ws.readyState !== 1) reject(new Error('WS connect timeout')); }, 5000);
      } catch (e) { reject(e); }
    });
  }

  send(obj) {
    if (this.debug) console.log('[MP] ->', obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    else if (this.debug) console.warn('[MP] send dropped, ws not open');
  }

  createRoom() { if (this.debug) console.log('[MP] createRoom'); this.send({ type: 'create' }); }
  joinRoom(roomId) { if (this.debug) console.log('[MP] joinRoom', roomId); this.send({ type: 'join', roomId }); }
  requestState() { if (this.debug) console.log('[MP] request_state'); this.send({ type: 'request_state' }); }
  action(msg) { if (this.debug) console.log('[MP] action', msg); this.send({ type: 'action', ...msg }); }
}
