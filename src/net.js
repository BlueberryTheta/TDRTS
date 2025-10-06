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
          } else if (msg.type === 'players') {
            this.emit('players', msg.players);
          } else if (msg.type === 'request_state') {
            this.emit('request_state', msg);
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
  snapshot(state) { if (this.debug) console.log('[MP] snapshot'); this.send({ type: 'snapshot', state }); }
}

// HTTP long-poll fallback client
export class HttpMPClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl; // same-origin
    this.roomId = null; this.player = null; this.handlers = new Map(); this.seq = 0; this.polling = false; this.debug = (typeof window !== 'undefined' && (window.DEBUG === true)) || (new URLSearchParams(location.search).get('debug') === '1');
  }
  on(t,f){this.handlers.set(t,f);} emit(t,d){const h=this.handlers.get(t); if(h) h(d);} dlog(...a){ if(this.debug) console.log('[HTTP-MP]',...a); }
  async connect(){ this.dlog('ready'); }
  async createRoom(){
    const res = await fetch('/api/mp/room', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'create' }) });
    const data = await res.json(); if(data.error) throw new Error(data.message || data.error);
    this.roomId = data.roomId; this.player = data.player; this.emit('room', { roomId: this.roomId, player: this.player, players: data.players, using: data.using });
    if (data.snapshot) this.emit('snapshot', { type:'snapshot', state: data.snapshot });
    this.startPolling();
  }
  async joinRoom(roomId){
    const res = await fetch('/api/mp/room', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'join', roomId }) });
    const data = await res.json(); if(data.error) throw new Error(data.message || data.error);
    this.roomId = data.roomId; this.player = data.player; this.emit('room', { roomId: this.roomId, player: this.player, players: data.players, using: data.using });
    if (data.snapshot) this.emit('snapshot', { type:'snapshot', state: data.snapshot });
    this.startPolling();
  }
  async action(msg){
    this.dlog('action', msg);
    let res, data;
    try {
      res = await fetch('/api/mp/action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId: this.roomId, player: this.player, action: msg }) });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      this.dlog('action network error', e);
      this.emit('error', { type:'action', error: 'network', message: String(e) });
      return;
    }
    if (!res.ok || data?.error) {
      const msgText = data?.message || data?.error || `HTTP ${res.status}`;
      this.dlog('action error', msgText);
      this.emit('error', { type:'action', status: res.status, message: msgText, action: msg });
      return;
    }
    // event will be picked up by poller; nothing else to do
  }
  async snapshot(state){
    await fetch('/api/mp/snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId: this.roomId, state }) });
  }
  async sync(state){
    // Persist snapshot and append a sync event so the other side advances
    try {
      const res = await fetch('/api/mp/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId: this.roomId, player: this.player, state }) });
      // ignore body; poll loop will pick up event and/or snapshot
      if (!res.ok) {
        this.dlog('sync error', res.status);
        this.emit('error', { type:'sync', status: res.status, message: 'sync failed' });
      }
    } catch (e) {
      this.dlog('sync network error', e);
      this.emit('error', { type:'sync', message: String(e) });
    }
  }
  async startPolling(){ if(this.polling) return; this.polling = true; this.dlog('polling start');
    const loop = async () => {
      try {
        // Poll for new events since last seq and include latest snapshot
        const url = `/api/mp/poll?room=${encodeURIComponent(this.roomId)}&since=${encodeURIComponent(this.seq)}`;
        const res = await fetch(url, { headers:{ 'Cache-Control':'no-cache' } });
        const data = await res.json();
        if (data.snapshot) this.emit('snapshot', { type:'snapshot', state: data.snapshot });
        if (Array.isArray(data.events)) {
          for (const ev of data.events) {
            if (typeof ev.seq === 'number' && ev.seq > this.seq) {
              this.seq = ev.seq;
              // Normalize to WS-like shape
              if (ev.type === 'event') this.emit('event', ev);
            }
          }
        }
        if (typeof data.lastSeq === 'number' && data.lastSeq > this.seq) this.seq = data.lastSeq;
        if (typeof data.players === 'number') this.emit('players', data.players);
      } catch(e) { this.dlog('poll error', e); }
      if (this.polling) setTimeout(loop, 300);
    };
    loop();
  }
}
