// Run: node --experimental-vm-modules tests/performance.test.mjs
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';

const context = vm.createContext({ console, Blob, URL, setTimeout, clearTimeout,
  document: { getElementById: () => null } });
const modules = new Map();
async function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const module = new vm.SourceTextModule(await fs.readFile(file, 'utf8'), { context, identifier: file });
  modules.set(file, module);
  await module.link((name, owner) => load(path.resolve(path.dirname(owner.identifier), name)));
  return module;
}
const perf = await load('js/performance.js'); await perf.evaluate();
const { indexFolders, SharedHistory } = perf.namespace;
const folders = new Map(Array.from({ length: 100 }, (_, i) => ['f' + i, { id: 'f' + i, name: 'Pasta ' + i }]));
const nodes = new Map(Array.from({ length: 10000 }, (_, i) => ['n' + i, { id: 'n' + i, type: 'image', folderId: 'f' + i % 100, x: i, src: 'data:image/png;base64,AAAA' }]));
const start = performance.now();
const index = indexFolders(nodes, folders);
assert.equal(index.items.get('f0').length, 100);
assert.equal(index.totals.get('f0'), 100);
console.log('10,000 items + 100 folders indexed in', Math.round(performance.now() - start), 'ms');
folders.get('f1').parentId = 'f0';
assert.equal(indexFolders(nodes, folders).totals.get('f0'), 200);
nodes.get('n0').folderId = 'missing';
assert.equal(indexFolders(nodes, folders).items.get(null).length, 1);

const history = new SharedHistory();
const board = { nodes: [...nodes.values()], folders: [...folders.values()], connections: [], drawings: [], palette: [] };
const first = history.capture(board);
board.nodes[0].x = -1;
const second = history.capture(board);
assert.notEqual(first.nodes[0], second.nodes[0]);
assert.equal(first.nodes[1], second.nodes[1]);
assert.equal(first.nodes[0].x, 0);
const restored = history.restore(first);
restored.nodes[0].x = 999;
assert.equal(first.nodes[0].x, 0);
assert.equal(restored.nodes[0].src, board.nodes[0].src);

const disk = await load('js/project-fs.js'); await disk.evaluate();
const original = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
const plan = disk.namespace.buildDiskPlan({ nodes: [{ id: 'image', type: 'image', title: 'original.png', mediaId: 'original', mime: 'image/png' }], folders: [] }, { getMediaBlob: async () => original });
assert.equal(await plan.files[0].getContent(), original);
assert.match(plan.files[0].path, /original\.png$/);
const missing = disk.namespace.buildDiskPlan({ nodes: [{ id: 'audio', type: 'audio', title: 'som.wav', mediaId: 'missing', mime: 'audio/wav' }], folders: [] }, { getMediaBlob: async () => null });
await assert.rejects(() => missing.files[0].getContent());

let output;
const worker = vm.createContext({ self: { postMessage: value => { output = value; } } });
vm.runInContext(await fs.readFile('js/audio-proxy-worker.js', 'utf8'), worker);
worker.self.onmessage({ data: { tracks: [new Float32Array(48000).fill(0.5)], sampleRate: 48000, duration: 1 } });
assert.equal(output.bytes.byteLength, 24044);
assert.equal(output.peaks.length, 96);
assert.equal(new DataView(output.bytes).getUint32(24, true), 12000);

const audio = await load('js/audio-engine.js'); await audio.evaluate();
const engine = new audio.namespace.AudioEngine({ storage: { media: { getBlob: async () => new Blob(['compressed'], { type: 'audio/mpeg' }), release() {} } } });
engine.getAudioContext = () => { throw new Error('Compressed audio must not be decoded'); };
const url = await engine.audioPlaybackUrl({ id: 'a', mediaId: 'original', title: 'a.mp3' });
assert.ok(url.startsWith('blob:'));
assert.equal(engine.proxyBytes, 0);
URL.revokeObjectURL(url);
let active = 0, maximum = 0;
engine.preparePlayback = async () => { active++; maximum = Math.max(maximum, active); await new Promise(r => setTimeout(r, 5)); active--; return 'test'; };
await Promise.all([1, 2, 3].map(id => engine.audioPlaybackUrl({ id })));
assert.equal(maximum, 1);
console.log('PASS: folder index, shared history, immutable restore, originals, missing media, WAV worker, compressed fallback, serial queue');
