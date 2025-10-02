export class AssetStore {
  constructor(tileSize) {
    this.tileSize = tileSize;
    this.images = new Map(); // key -> HTMLImageElement
  }

  load(mapping) {
    const entries = Object.entries(mapping);
    return Promise.all(entries.map(([key, path]) => this._loadOne(key, path)));
  }

  _loadOne(key, path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images.set(key, img); resolve({ key, ok: true }); };
      img.onerror = () => { resolve({ key, ok: false }); };
      img.src = path;
    });
  }

  get(key) {
    return this.images.get(key) || null;
  }
}

