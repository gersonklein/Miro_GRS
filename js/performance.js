export const nameCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
// Per-render index: no stale membership when folders are moved or renamed.
export function indexFolders(nodes, folders) {
  const items = new Map(), children = new Map(), counts = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const f of folders.values()) add(children, f.parentId || null, f);
  for (const list of children.values()) list.sort((a, b) => nameCollator.compare(a.name, b.name));
  for (const n of nodes.values()) {
    if (n.type === 'shape' && n.shapeType === 'frame' && folders.has(n.frameFolderId)) continue;
    const fid = folders.has(n.folderId) ? n.folderId : null;
    add(items, fid, n);
    counts.set(fid, (counts.get(fid) || 0) + 1);
  }
  const totals = new Map();
  const total = (id, seen = new Set()) => {
    if (totals.has(id)) return totals.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const value = (counts.get(id) || 0) + (children.get(id) || []).reduce((sum, f) => sum + total(f.id, seen), 0);
    seen.delete(id);
    totals.set(id, value);
    return value;
  };
  for (const id of folders.keys()) total(id);
  return { items, children, totals };
}

// Immutable snapshots share unchanged records. Large source strings are never
// included in the JSON comparison or copied into a whole-board JSON string.
export class SharedHistory {
  constructor() { this.previous = new Map(); }
  capture(board) {
    const next = new Map();
    const snapshot = { ...board };
    for (const field of ['nodes', 'folders', 'connections', 'drawings']) {
      snapshot[field] = (board[field] || []).map(record => {
        const key = field + ':' + record.id;
        const { src, ...metadata } = record;
        const signature = JSON.stringify(metadata);
        const previous = this.previous.get(key);
        const value = previous?.signature === signature && previous.value.src === src
          ? previous.value : { ...JSON.parse(signature), ...(src === undefined ? {} : { src }) };
        next.set(key, { signature, value });
        return value;
      });
    }
    snapshot.camera = { ...board.camera };
    snapshot.palette = JSON.parse(JSON.stringify(board.palette || []));
    this.previous = next;
    return snapshot;
  }
  restore(snapshot) {
    const data = { ...snapshot, camera: { ...snapshot.camera }, palette: JSON.parse(JSON.stringify(snapshot.palette)) };
    for (const field of ['nodes', 'folders', 'connections', 'drawings']) {
      data[field] = snapshot[field].map(({ src, ...metadata }) => ({
        ...JSON.parse(JSON.stringify(metadata)), ...(src === undefined ? {} : { src })
      }));
    }
    return data;
  }
}

export function readPcmWavInfo(buffer) {
  const view = new DataView(buffer);
  const text = (at, n) => Array.from({ length: n }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join('');
  if (view.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') return null;
  let format;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const name = text(at, 4), size = view.getUint32(at + 4, true);
    if (name === 'fmt ' && size >= 16 && at + 24 <= view.byteLength) {
      const codec = view.getUint16(at + 8, true), channels = view.getUint16(at + 10, true);
      const rate = view.getUint32(at + 12, true), byteRate = view.getUint32(at + 16, true);
      const bits = view.getUint16(at + 22, true);
      if (![1, 3].includes(codec) || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || ![8, 16, 24, 32].includes(bits) || byteRate !== rate * channels * bits / 8) return null;
      format = { channels, rate, byteRate };
    }
    if (name === 'data' && format) return { ...format, duration: size / format.byteRate };
    at += 8 + size + (size % 2);
  }
  return null;
}
