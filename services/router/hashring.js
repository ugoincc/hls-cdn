// Anel de hashing consistente com nós virtuais.
// Cada nó físico ocupa `vnodes` posições no anel (hash de "id#i"). Uma chave é
// atribuída ao primeiro ponto do anel com hash >= hash(chave) (sentido horário).
// lookup() devolve a "lista de preferência": os nós distintos na ordem em que
// aparecem a partir da chave — o 1º é o dono; os seguintes são os substitutos
// em caso de falha. Remover (pular) um nó só remapeia as chaves que eram dele.
import { createHash } from 'node:crypto';

export const hash32 = (s) => createHash('md5').update(s).digest().readUInt32BE(0);

export class HashRing {
  constructor(nodeIds, vnodes = 100) {
    this.vnodes = vnodes;
    this.nodes = [...nodeIds];
    this.ring = [];
    for (const id of this.nodes) {
      for (let i = 0; i < vnodes; i++) this.ring.push({ hash: hash32(`${id}#${i}`), id });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  // índice do primeiro ponto com hash >= h (busca binária), com volta ao início
  #firstIndex(h) {
    let lo = 0, hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    return lo === this.ring.length ? 0 : lo;
  }

  lookup(key) {
    const out = [];
    if (!this.ring.length) return out;
    const start = this.#firstIndex(hash32(key));
    for (let i = 0; i < this.ring.length && out.length < this.nodes.length; i++) {
      const { id } = this.ring[(start + i) % this.ring.length];
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  // fração do espaço de hash que cada nó possui (mostra o efeito dos nós virtuais)
  ownership() {
    const share = Object.fromEntries(this.nodes.map((n) => [n, 0]));
    const SPACE = 2 ** 32;
    for (let i = 0; i < this.ring.length; i++) {
      const prev = i === 0 ? this.ring[this.ring.length - 1].hash - SPACE : this.ring[i - 1].hash;
      share[this.ring[i].id] += (this.ring[i].hash - prev) / SPACE;
    }
    return share;
  }
}
