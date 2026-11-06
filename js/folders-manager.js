// js/folders-manager.js
// Hierarquia de Grupos / Pastas (profundidade ilimitada).
// Regra central: Tag = Grupo = Frame = Pasta.
//  - Cada item (imagem, som, post-it...) tem node.folderId (1 pasta; null = "Sem categoria").
//  - Cada pasta pode ter 1 Frame no canvas: nó shape/frame com node.frameFolderId = id da pasta
//    e node.folderId = pasta-pai (onde o frame "mora").

export const FOLDER_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4',
  '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#3b82f6'
];

const PAD = 28;
const GAP = 18;

export class FoldersManager {
  constructor(app) {
    this.app = app;
    this.isolateId = null; // "Mostrar só esta pasta"
    this.dropHighlightEl = null;
  }

  get folders() {
    return this.app.state.folders;
  }

  newId() {
    return 'fld_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------- Carregar / Serializar ----------
  load(list) {
    this.folders.clear();
    for (const f of list || []) {
      if (!f || !f.id) continue;
      this.folders.set(f.id, {
        id: f.id,
        name: f.name || 'Grupo',
        parentId: f.parentId || null,
        color: f.color || null,
        collapsed: !!f.collapsed
      });
    }
    // Quebra ciclos/pais inexistentes vindos de arquivos corrompidos
    for (const f of this.folders.values()) {
      if (f.parentId && (!this.folders.has(f.parentId) || this.isDescendant(f.parentId, f.id))) {
        f.parentId = null;
      }
    }
  }

  serialize() {
    return Array.from(this.folders.values()).map((f) => ({ ...f }));
  }

  // ---------- Consultas ----------
  get(id) {
    return id ? this.folders.get(id) || null : null;
  }

  getChildren(parentId = null) {
    const pid = parentId || null;
    return Array.from(this.folders.values())
      .filter((f) => (f.parentId || null) === pid)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  }

  // Lista da raiz até a pasta (inclusive)
  getAncestors(id) {
    const chain = [];
    const seen = new Set();
    let cur = this.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = this.get(cur.parentId);
    }
    return chain;
  }

  getDepth(id) {
    return Math.max(0, this.getAncestors(id).length - 1);
  }

  getPathNames(id) {
    return this.getAncestors(id).map((f) => f.name);
  }

  getPathString(id, sep = ' / ') {
    return id ? this.getPathNames(id).join(sep) : 'Sem categoria';
  }

  abbreviatedPath(id) {
    const names = this.getPathNames(id);
    if (names.length <= 3) return names.join(' / ');
    return `${names[0]} / … / ${names[names.length - 2]} / ${names[names.length - 1]}`;
  }

  // true se candidateId está dentro (em qualquer nível) de ofId
  isDescendant(candidateId, ofId) {
    if (!candidateId || !ofId) return false;
    const seen = new Set();
    let cur = this.get(candidateId);
    while (cur && cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.parentId === ofId) return true;
      cur = this.get(cur.parentId);
    }
    return false;
  }

  getDescendantIds(id) {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of this.getChildren(cur)) {
        out.push(c.id);
        stack.push(c.id);
      }
    }
    return out;
  }

  // Lista achatada na ordem da árvore: [{ folder, depth }]
  flatTree(parentId = null, depth = 0, out = []) {
    for (const f of this.getChildren(parentId)) {
      out.push({ folder: f, depth });
      this.flatTree(f.id, depth + 1, out);
    }
    return out;
  }

  getColor(id) {
    for (const f of this.getAncestors(id).reverse()) {
      if (f.color) return f.color;
    }
    return FOLDER_COLORS[0];
  }

  isFolderFrame(node) {
    return !!(node && node.type === 'shape' && node.shapeType === 'frame' && node.frameFolderId && this.folders.has(node.frameFolderId));
  }

  getFrameNode(folderId) {
    if (!folderId) return null;
    for (const n of this.app.state.nodes.values()) {
      if (n.frameFolderId === folderId && this.isFolderFrame(n)) return n;
    }
    return null;
  }

  // Pasta onde o nó "mora" (para frames: a pasta-pai)
  containerOf(node) {
    if (this.isFolderFrame(node)) return this.get(node.frameFolderId)?.parentId || null;
    return node.folderId && this.folders.has(node.folderId) ? node.folderId : null;
  }

  itemsInFolder(folderId, recursive = false) {
    const ids = new Set([folderId || null]);
    if (recursive && folderId) for (const d of this.getDescendantIds(folderId)) ids.add(d);
    const res = [];
    for (const n of this.app.state.nodes.values()) {
      if (this.isFolderFrame(n)) continue;
      const fid = n.folderId && this.folders.has(n.folderId) ? n.folderId : null;
      if (ids.has(fid)) res.push(n);
    }
    return res;
  }

  countItems(folderId, recursive = true) {
    return this.itemsInFolder(folderId, recursive).length;
  }

  // Itens diretos + frames das subpastas diretas
  frameContents(folderId) {
    const items = this.itemsInFolder(folderId, false);
    for (const c of this.getChildren(folderId)) {
      const fr = this.getFrameNode(c.id);
      if (fr) items.push(fr);
    }
    return items;
  }

  boundsOf(nodes) {
    if (!nodes.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    return { minX, minY, maxX, maxY };
  }

  // Todos os nós que devem se mover junto quando o frame de uma pasta é arrastado
  expandWithFolderContents(nodes) {
    const set = new Set(nodes);
    for (const n of nodes) {
      if (!this.isFolderFrame(n)) continue;
      const fid = n.frameFolderId;
      for (const item of this.itemsInFolder(fid, true)) set.add(item);
      for (const d of this.getDescendantIds(fid)) {
        const fr = this.getFrameNode(d);
        if (fr) set.add(fr);
      }
    }
    return Array.from(set);
  }

  // Frame mais interno (menor área) que contém o ponto
  findFolderAtPoint(x, y, excludeFolderIds = new Set()) {
    let best = null;
    let bestArea = Infinity;
    for (const n of this.app.state.nodes.values()) {
      if (!this.isFolderFrame(n) || excludeFolderIds.has(n.frameFolderId)) continue;
      if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) {
        const area = n.width * n.height;
        if (area < bestArea) {
          bestArea = area;
          best = n.frameFolderId;
        }
      }
    }
    return best;
  }

  commonAncestor(folderIds) {
    if (!folderIds.length) return null;
    if (folderIds.some((id) => !id)) return null;
    const chains = folderIds.map((id) => this.getAncestors(id).map((f) => f.id));
    let common = null;
    for (let i = 0; ; i++) {
      const v = chains[0][i];
      if (!v || !chains.every((c) => c[i] === v)) break;
      common = v;
    }
    return common;
  }

  nextRootColor() {
    const roots = this.getChildren(null).length;
    return FOLDER_COLORS[roots % FOLDER_COLORS.length];
  }

  // ---------- Criação / Edição ----------
  createFolder(name, parentId = null, { undo = true, withFrame = true, color = null, frameRect = null, refresh = true } = {}) {
    if (undo) this.app.pushUndoState();
    const folder = {
      id: this.newId(),
      name: (name || 'Novo Grupo').trim(),
      parentId: parentId && this.folders.has(parentId) ? parentId : null,
      color: color || (parentId ? null : this.nextRootColor()),
      collapsed: false
    };
    this.folders.set(folder.id, folder);
    if (parentId) {
      const p = this.get(parentId);
      if (p) p.collapsed = false;
    }
    if (withFrame) this.createFrameFor(folder.id, frameRect);
    if (refresh) this.afterChange();
    return folder;
  }

  contentBottom(folderId, exclude = new Set()) {
    const frame = this.getFrameNode(folderId);
    const contents = this.frameContents(folderId).filter((n) => !exclude.has(n));
    if (!contents.length) return frame ? frame.y + PAD : 0;
    return Math.max(...contents.map((n) => n.y + n.height));
  }

  contentBoundsAll() {
    return this.boundsOf(Array.from(this.app.state.nodes.values()));
  }

  createFrameFor(folderId, rect = null) {
    const folder = this.get(folderId);
    if (!folder) return null;
    const existing = this.getFrameNode(folderId);
    if (existing) return existing;

    let r = rect;
    if (!r) {
      const contents = this.frameContents(folderId);
      const b = this.boundsOf(contents);
      const parentFrame = this.getFrameNode(folder.parentId);
      if (b) {
        r = { x: b.minX - PAD, y: b.minY - PAD, width: b.maxX - b.minX + PAD * 2, height: b.maxY - b.minY + PAD * 2 };
      } else if (parentFrame) {
        const hasContent = this.frameContents(folder.parentId).length > 0;
        const y = hasContent ? this.contentBottom(folder.parentId) + GAP + 30 : parentFrame.y + PAD + 10;
        r = { x: parentFrame.x + PAD, y, width: 340, height: 200 };
      } else {
        const all = this.contentBoundsAll();
        if (all) {
          r = { x: all.maxX + 90, y: all.minY, width: 420, height: 280 };
        } else {
          const c = this.app.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
          r = { x: c.x - 210, y: c.y - 140, width: 420, height: 280 };
        }
      }
    }

    return this.app.nodesManager.createNode(
      {
        type: 'shape',
        shapeType: 'frame',
        frameFolderId: folderId,
        folderId: folder.parentId,
        title: folder.name,
        autoFit: true,
        x: r.x,
        y: r.y,
        width: Math.max(160, r.width),
        height: Math.max(110, r.height),
        zIndex: 1
      },
      false
    );
  }

  renameFolder(id, name) {
    const f = this.get(id);
    const clean = (name || '').trim();
    if (!f || !clean || clean === f.name) return;
    this.app.pushUndoState();
    f.name = clean;
    const fr = this.getFrameNode(id);
    if (fr) fr.title = clean;
    this.afterChange({ refit: false });
  }

  setColor(id, color) {
    const f = this.get(id);
    if (!f) return;
    this.app.pushUndoState();
    f.color = color;
    this.afterChange({ refit: false });
  }

  moveFolderContents(folderId, dx, dy) {
    const fr = this.getFrameNode(folderId);
    const nodes = fr ? this.expandWithFolderContents([fr]) : this.itemsInFolder(folderId, true);
    for (const n of nodes) {
      n.x = Math.round(n.x + dx);
      n.y = Math.round(n.y + dy);
    }
  }

  // Reparenta pasta (sem limite de nível). Bloqueia ciclos.
  moveFolder(id, newParentId, { undo = true, relocate = true, refresh = true } = {}) {
    const f = this.get(id);
    const target = newParentId || null;
    if (!f) return false;
    if (target === id || (target && this.isDescendant(target, id))) {
      this.app.setStatus('Não dá para colocar uma pasta dentro dela mesma ou de uma subpasta dela.');
      return false;
    }
    if ((f.parentId || null) === target) return false;
    if (undo) this.app.pushUndoState();
    f.parentId = target;
    const fr = this.getFrameNode(id);
    if (fr) {
      fr.folderId = target;
      const pFrame = this.getFrameNode(target);
      if (relocate && pFrame) {
        const cx = fr.x + fr.width / 2;
        const cy = fr.y + fr.height / 2;
        const inside = cx >= pFrame.x && cx <= pFrame.x + pFrame.width && cy >= pFrame.y && cy <= pFrame.y + pFrame.height;
        if (!inside) {
          const exclude = new Set(this.expandWithFolderContents([fr]));
          const hasOther = this.frameContents(target).some((n) => !exclude.has(n));
          const ny = hasOther ? this.contentBottom(target, exclude) + GAP + 30 : pFrame.y + PAD + 10;
          this.moveFolderContents(id, pFrame.x + PAD - fr.x, ny - fr.y);
        }
      }
    }
    if (target) {
      const p = this.get(target);
      if (p) p.collapsed = false;
    }
    if (refresh) this.afterChange();
    return true;
  }

  // Coloca itens dentro da área do frame da pasta (grade, abaixo do conteúdo atual)
  placeNodesInFrame(items, folderId) {
    const frame = this.getFrameNode(folderId);
    if (!frame || !items.length) return;
    const moving = new Set(items);
    const others = this.frameContents(folderId).filter((n) => !moving.has(n));
    const startX = frame.x + PAD;
    let y = others.length ? this.contentBottom(folderId, moving) + GAP : frame.y + PAD + 10;
    const rowWidth = Math.max(frame.width - PAD * 2, 640);
    let x = startX;
    let rowH = 0;
    for (const n of items) {
      if (x > startX && x + n.width > startX + rowWidth) {
        x = startX;
        y += rowH + GAP;
        rowH = 0;
      }
      n.x = Math.round(x);
      n.y = Math.round(y);
      x += n.width + GAP;
      rowH = Math.max(rowH, n.height);
    }
  }

  isInsideFrame(node, folderId) {
    const fr = this.getFrameNode(folderId);
    if (!fr) return true;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    return cx >= fr.x && cx <= fr.x + fr.width && cy >= fr.y && cy <= fr.y + fr.height;
  }

  // Coloca N itens (e/ou frames de pastas) numa pasta de uma vez
  assignNodes(nodes, folderId, { undo = true, place = true, refresh = true } = {}) {
    const target = folderId && this.folders.has(folderId) ? folderId : null;
    if (!nodes.length) return;
    if (undo) this.app.pushUndoState();

    const frames = nodes.filter((n) => this.isFolderFrame(n));
    const frameFolderIds = new Set(frames.map((f) => f.frameFolderId));
    // Itens que já se movem junto com um frame selecionado não precisam ser reatribuídos
    const items = nodes.filter((n) => {
      if (this.isFolderFrame(n)) return false;
      const c = this.containerOf(n);
      return !(c && (frameFolderIds.has(c) || [...frameFolderIds].some((fid) => this.isDescendant(c, fid))));
    });

    for (const fr of frames) this.moveFolder(fr.frameFolderId, target, { undo: false, refresh: false });

    const toPlace = [];
    for (const n of items) {
      const changed = (n.folderId || null) !== target;
      n.folderId = target;
      if (place && target && (changed || !this.isInsideFrame(n, target))) toPlace.push(n);
    }
    if (toPlace.length) this.placeNodesInFrame(toPlace.filter((n) => !this.isInsideFrame(n, target)), target);
    if (refresh) this.afterChange();
    const name = target ? this.getPathString(target) : 'Sem categoria';
    this.app.setStatus(`${items.length + frames.length} item(ns) movido(s) para "${name}".`);
  }

  // Ctrl+G: cria pasta nova englobando a seleção (itens + frames de pastas)
  groupNodes(nodes, name) {
    if (!nodes.length) return null;
    const frames = nodes.filter((n) => this.isFolderFrame(n));
    const frameFolderIds = new Set(frames.map((f) => f.frameFolderId));
    const items = nodes.filter((n) => {
      if (this.isFolderFrame(n)) return false;
      const c = this.containerOf(n);
      return !(c && (frameFolderIds.has(c) || [...frameFolderIds].some((fid) => this.isDescendant(c, fid))));
    });
    const topFrames = frames.filter((f) => {
      const pid = this.get(f.frameFolderId)?.parentId;
      return !(pid && (frameFolderIds.has(pid) || [...frameFolderIds].some((fid) => this.isDescendant(pid, fid))));
    });
    const containers = [...items.map((n) => this.containerOf(n)), ...topFrames.map((f) => this.containerOf(f))];
    const parentId = this.commonAncestor(containers);

    this.app.pushUndoState();
    const folder = this.createFolder(name, parentId, { undo: false, withFrame: false, refresh: false });
    for (const n of items) n.folderId = folder.id;
    for (const f of topFrames) this.moveFolder(f.frameFolderId, folder.id, { undo: false, relocate: false, refresh: false });
    this.createFrameFor(folder.id);
    this.afterChange();
    this.app.setStatus(`Grupo "${this.getPathString(folder.id)}" criado com ${items.length} item(ns) e ${topFrames.length} subgrupo(s).`);
    return folder;
  }

  // Remove a pasta; itens e subpastas sobem para a pasta-pai (nada é apagado)
  ungroup(folderId, { undo = true, refresh = true } = {}) {
    const f = this.get(folderId);
    if (!f) return;
    if (undo) this.app.pushUndoState();
    const parent = f.parentId || null;
    for (const n of this.itemsInFolder(folderId, false)) n.folderId = parent;
    for (const c of this.getChildren(folderId)) {
      c.parentId = parent;
      const fr = this.getFrameNode(c.id);
      if (fr) fr.folderId = parent;
    }
    const frame = this.getFrameNode(folderId);
    if (frame) this.app.nodesManager.removeNode(frame.id);
    this.folders.delete(folderId);
    if (this.isolateId === folderId) this.isolateId = null;
    if (refresh) this.afterChange();
  }

  deleteFolderAndContents(folderId) {
    if (!this.get(folderId)) return;
    this.app.pushUndoState();
    const ids = new Set([folderId, ...this.getDescendantIds(folderId)]);
    for (const n of Array.from(this.app.state.nodes.values())) {
      if (ids.has(n.folderId) || ids.has(n.frameFolderId)) this.app.nodesManager.removeNode(n.id);
    }
    for (const id of ids) this.folders.delete(id);
    if (ids.has(this.isolateId)) this.isolateId = null;
    this.afterChange();
  }

  // Nome livre entre as pastas irmãs: "Cenas" → "Cenas (2)", "Cenas (3)"...
  uniqueSiblingName(name, parentId) {
    const base = String(name || 'Grupo').replace(/\s*\(\d+\)$/, '').trim() || 'Grupo';
    const taken = new Set(this.getChildren(parentId).map((f) => f.name.toLowerCase()));
    let i = 2;
    while (taken.has(`${base} (${i})`.toLowerCase())) i++;
    return `${base} (${i})`;
  }

  // Duplica a pasta com subpastas (níveis ilimitados), frames, itens e setas internas.
  // A cópia fica ao lado do original, na mesma pasta-pai, com nome único.
  // Retorna { folder, nodes } (nodes = todos os nós criados).
  duplicateFolder(folderId, { undo = true, refresh = true } = {}) {
    const src = this.get(folderId);
    if (!src) return null;
    if (undo) this.app.pushUndoState();
    const nm = this.app.nodesManager;
    const srcFrame = this.getFrameNode(folderId);
    const dx = srcFrame ? Math.round(srcFrame.width + 60) : 60;
    const dy = 0;
    const idMap = new Map(); // id de nó antigo -> novo
    const created = [];

    const cloneNode = (orig, patch) => {
      const cfg = JSON.parse(JSON.stringify(orig));
      delete cfg.id;
      Object.assign(cfg, patch, {
        file: null,
        fileTitle: null,
        x: orig.x + dx,
        y: orig.y + dy,
        zIndex: orig.zIndex
      });
      const n = nm.createNode(cfg, false);
      idMap.set(orig.id, n.id);
      created.push(n);
      return n;
    };

    const cloneTree = (srcId, newParentId, newName) => {
      const s = this.get(srcId);
      const folder = { id: this.newId(), name: newName, parentId: newParentId, color: s.color || null, collapsed: !!s.collapsed };
      this.folders.set(folder.id, folder);
      const fr = this.getFrameNode(srcId);
      if (fr) cloneNode(fr, { frameFolderId: folder.id, folderId: newParentId, title: newName });
      for (const item of this.itemsInFolder(srcId, false)) cloneNode(item, { folderId: folder.id, frameFolderId: null });
      for (const child of this.getChildren(srcId)) cloneTree(child.id, folder.id, child.name);
      return folder;
    };

    const parentId = src.parentId || null;
    const folder = cloneTree(folderId, parentId, this.uniqueSiblingName(src.name, parentId));

    // Setas entre itens que foram copiados juntos
    const conns = this.app.state.connections;
    for (const c of Array.from(conns.values())) {
      if (!idMap.has(c.from) || !idMap.has(c.to)) continue;
      const id = 'conn_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      conns.set(id, { ...JSON.parse(JSON.stringify(c)), id, from: idMap.get(c.from), to: idMap.get(c.to) });
    }

    if (refresh) this.afterChange();
    this.app.setStatus(`Pasta "${src.name}" duplicada como "${folder.name}" (${created.length} elemento(s), subpastas mantidas).`);
    return { folder, nodes: created };
  }

  removeFrameOnly(folderId) {
    const fr = this.getFrameNode(folderId);
    if (!fr) return;
    this.app.pushUndoState();
    this.app.nodesManager.removeNode(fr.id);
    this.afterChange({ refit: false });
  }

  // Reorganiza os itens diretos da pasta em grade dentro do frame
  arrangeFolder(folderId) {
    const fr = this.getFrameNode(folderId);
    const items = this.itemsInFolder(folderId, false);
    if (!fr || !items.length) return;
    this.app.pushUndoState();
    const childFrames = this.getChildren(folderId).map((c) => this.getFrameNode(c.id)).filter(Boolean);
    const startX = fr.x + PAD;
    const startY = fr.y + PAD + 10;
    const totalArea = items.reduce((a, n) => a + (n.width + GAP) * (n.height + GAP), 0);
    const rowWidth = Math.max(Math.max(...items.map((n) => n.width)), Math.sqrt(totalArea) * 1.3);
    const sorted = [...items].sort((a, b) => b.height - a.height);
    let x = startX, y = startY, rowH = 0;
    for (const n of sorted) {
      if (x > startX && x + n.width > startX + rowWidth) {
        x = startX;
        y += rowH + GAP;
        rowH = 0;
      }
      n.x = Math.round(x);
      n.y = Math.round(y);
      x += n.width + GAP;
      rowH = Math.max(rowH, n.height);
    }
    // Subgrupos ficam empilhados abaixo dos itens
    let cy = y + rowH + GAP + 30;
    for (const cf of childFrames) {
      this.moveFolderContents(cf.frameFolderId, startX - cf.x, cy - cf.y);
      cy += cf.height + GAP + 30;
    }
    this.afterChange();
  }

  // ---------- Drop no canvas ----------
  // directNodes = nós que o usuário arrastou (sem os que vieram junto com frames)
  handleNodesDropped(directNodes) {
    const movedFrames = directNodes.filter((n) => this.isFolderFrame(n));
    const movedFolderIds = new Set();
    for (const fr of movedFrames) {
      movedFolderIds.add(fr.frameFolderId);
      for (const d of this.getDescendantIds(fr.frameFolderId)) movedFolderIds.add(d);
    }

    for (const fr of movedFrames) {
      const folder = this.get(fr.frameFolderId);
      if (!folder) continue;
      if (folder.parentId && movedFolderIds.has(folder.parentId)) continue;
      const exclude = new Set([folder.id, ...this.getDescendantIds(folder.id)]);
      const target = this.dropTargetFor(fr, folder.parentId || null, exclude);
      if (target !== undefined && target !== (folder.parentId || null)) {
        this.moveFolder(folder.id, target, { undo: false, relocate: false, refresh: false });
      }
    }

    for (const n of directNodes) {
      if (this.isFolderFrame(n)) continue;
      const c = this.containerOf(n);
      if (c && movedFolderIds.has(c)) continue;
      const target = this.dropTargetFor(n, c, movedFolderIds);
      if (target !== undefined && target !== c) n.folderId = target;
    }
    this.afterChange();
  }

  // Pasta de destino de um nó solto no canvas.
  // - centro sobre um frame → essa pasta
  // - centro fora de qualquer frame, mas a pasta atual tem frame → saiu dela: sobe para a raiz
  // - pasta atual sem frame no canvas → undefined (não dá para "sair" de algo invisível; mantém)
  dropTargetFor(node, currentId, exclude = new Set()) {
    const target = this.findFolderAtPoint(node.x + node.width / 2, node.y + node.height / 2, exclude);
    if (target) return target;
    if (!currentId) return null;
    return this.getFrameNode(currentId) ? null : undefined;
  }

  // Nós recém-criados num ponto (post-it, arquivos soltos...) entram no frame embaixo deles
  autoAssign(nodes) {
    let changed = false;
    for (const n of nodes) {
      if (this.isFolderFrame(n)) continue;
      const target = this.findFolderAtPoint(n.x + n.width / 2, n.y + n.height / 2);
      if (target) {
        n.folderId = target;
        changed = true;
      }
    }
    if (changed) this.afterChange();
  }

  highlightDropTarget(node) {
    let target = null;
    if (node) {
      const exclude = new Set();
      if (this.isFolderFrame(node)) {
        exclude.add(node.frameFolderId);
        for (const d of this.getDescendantIds(node.frameFolderId)) exclude.add(d);
      }
      target = this.findFolderAtPoint(node.x + node.width / 2, node.y + node.height / 2, exclude);
    }
    const fr = target ? this.getFrameNode(target) : null;
    const el = fr ? this.app.nodesManager.nodesLayer.querySelector(`.canvas-node[data-id="${fr.id}"]`) : null;
    if (this.dropHighlightEl && this.dropHighlightEl !== el) this.dropHighlightEl.classList.remove('drop-target');
    if (el) el.classList.add('drop-target');
    this.dropHighlightEl = el;
  }

  clearDropHighlight() {
    if (this.dropHighlightEl) this.dropHighlightEl.classList.remove('drop-target');
    this.dropHighlightEl = null;
  }

  // ---------- Frames que crescem ----------
  fitFrame(folderId) {
    const fr = this.getFrameNode(folderId);
    if (!fr || fr.autoFit === false) return;
    const contents = this.frameContents(folderId);
    const b = this.boundsOf(contents);
    if (!b) return;
    fr.x = Math.round(b.minX - PAD);
    fr.y = Math.round(b.minY - PAD);
    fr.width = Math.round(Math.max(160, b.maxX - b.minX + PAD * 2));
    fr.height = Math.round(Math.max(110, b.maxY - b.minY + PAD * 2));
  }

  refitAll() {
    const ordered = Array.from(this.folders.values()).sort((a, b) => this.getDepth(b.id) - this.getDepth(a.id));
    for (const f of ordered) this.fitFrame(f.id);
  }

  // ---------- Visual ----------
  inIsolation(node) {
    if (!this.isolateId) return true;
    const fid = this.isFolderFrame(node) ? node.frameFolderId : node.folderId;
    if (!fid) return false;
    return fid === this.isolateId || this.isDescendant(fid, this.isolateId);
  }

  decorateNode(node, el) {
    if (!el) return;
    el.classList.toggle('dimmed', !this.inIsolation(node));

    if (node.type === 'shape' && node.shapeType === 'frame') {
      const isFolder = this.isFolderFrame(node);
      el.classList.toggle('folder-frame', isFolder);
      const badge = el.querySelector('.frame-title-badge');
      if (!isFolder) {
        if (badge) badge.textContent = node.title || 'Frame / Grupo Visual';
        el.style.removeProperty('--folder-color');
        return;
      }
      const fid = node.frameFolderId;
      const color = this.getColor(fid);
      el.style.setProperty('--folder-color', color);
      el.style.zIndex = String(Math.min(9, 2 + this.getDepth(fid)));
      if (badge) {
        const names = this.getPathNames(fid);
        const parentPath = names.length > 1 ? this.abbreviatedPath(this.get(fid).parentId) + ' / ' : '';
        badge.innerHTML = '';
        if (parentPath) {
          const p = document.createElement('span');
          p.className = 'ftb-path';
          p.textContent = parentPath;
          badge.appendChild(p);
        }
        const strong = document.createElement('strong');
        strong.textContent = '📁 ' + names[names.length - 1];
        badge.appendChild(strong);
        const count = document.createElement('span');
        count.className = 'ftb-count';
        count.textContent = String(this.countItems(fid, true));
        badge.appendChild(count);
        badge.title = this.getPathString(fid) + ' — duplo clique para renomear';
      }
      return;
    }

    let tag = el.querySelector(':scope > .folder-tag');
    const fid = node.folderId && this.folders.has(node.folderId) ? node.folderId : null;
    if (!fid) {
      if (tag) tag.classList.add('hidden');
      return;
    }
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'folder-tag';
      el.appendChild(tag);
    }
    tag.classList.remove('hidden');
    tag.textContent = this.get(fid).name;
    tag.style.background = this.getColor(fid);
    tag.title = '📁 ' + this.getPathString(fid);
  }

  decorateAll() {
    for (const n of this.app.state.nodes.values()) {
      this.app.nodesManager.updateNodeElementTransform(n);
    }
  }

  afterChange({ refit = true } = {}) {
    if (refit) this.refitAll();
    this.decorateAll();
    this.app.connectionsDrawing.renderAllConnections();
    this.app.canvasEngine.renderMinimap();
    this.app.projectPanel?.render();
    this.app.updateContextBar();
    this.app.storage.scheduleAutoSave();
  }
}
