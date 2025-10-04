export class MultiplayerClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.roomId = null;
    this.player = null; // 0 or 1
    this.handlers = new Map();
  }

  on(type, fn) { this.handlers.set(type, fn); }
  emit(type, data) { const h = this.handlers.get(type); if (h) h(data); }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => resolve();
        this.ws.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
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
        this.ws.onerror = (e) => { this.emit('ws_error', e); reject(e); };
        this.ws.onclose = () => this.emit('close');
        // Guard: timeout connection after 5s
        setTimeout(() => { if (!this.ws || this.ws.readyState !== 1) reject(new Error('WS connect timeout')); }, 5000);
      } catch (e) { reject(e); }
    });
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  createRoom() { this.send({ type: 'create' }); }
  joinRoom(roomId) { this.send({ type: 'join', roomId }); }
  requestState() { this.send({ type: 'request_state' }); }
  action(msg) { this.send({ type: 'action', ...msg }); }
}
