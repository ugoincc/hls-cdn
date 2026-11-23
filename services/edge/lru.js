// Cache LRU limitado por bytes. O Map do JS preserva ordem de inserção:
// o primeiro item é sempre o menos recentemente usado → get/set/evict em O(1).
export class LRUCache {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.map = new Map(); // key -> { body: Buffer, contentType, ... }
    this.bytes = 0;
    this.evictions = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // move para o fim (mais recente)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key, entry) {
    const size = entry.body.length;
    if (size > this.maxBytes) return false; // não cabe nem sozinho
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.body.length;
      this.map.delete(key);
    }
    this.map.set(key, entry);
    this.bytes += size;
    while (this.bytes > this.maxBytes) {
      const [oldestKey, oldest] = this.map.entries().next().value;
      this.map.delete(oldestKey);
      this.bytes -= oldest.body.length;
      this.evictions++;
    }
    return true;
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }

  get size() {
    return this.map.size;
  }
}
