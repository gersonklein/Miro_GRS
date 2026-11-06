// js/project-panel.js
// Painel "Project" estilo Unity: árvore de pastas recursiva (níveis ilimitados) com os
// arquivos (imagens, sons, vídeos, textos...) dentro de cada pasta, breadcrumb, busca,
// renomear inline (pastas e arquivos), menu de contexto e drag & drop.

import { askText, askChoice, showContextMenu } from './ui-dialogs.js';

const UNSORTED = '__unsorted';
const FOLDER_MIME = 'application/x-mirogrs-folder';
const ITEM_MIME = 'application/x-mirogrs-item';
const ITEM_KEY = 'item:';
const TYPE_ICON = {
  image: '🖼', audio: '🎵', video: '🎬', textblocks: '📝', sticky: '🗒', text: '🔤', shape: '⬛', swatch: '🎨'
};
const TYPE_ORDER = ['image', 'video', 'audio', 'textblocks', 'sticky', 'text', 'shape', 'swatch'];

export class ProjectPanel {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('project-panel');
    this.treeEl = document.getElementById('pp-tree');
    this.breadcrumbEl = document.getElementById('pp-breadcrumb');
    this.searchEl = document.getElementById('pp-search');
    this.statsEl = document.getElementById('pp-stats');
    this.showBtn = document.getElementById('pp-show');
    this.selectedId = null; // id de pasta, UNSORTED ou null
    this.focusRootId = null; // "focar nesta pasta": a árvore começa nela
    this.renamingId = null;
    this.selectedItemId = null; // arquivo (nó) selecionado no painel
    this.renamingItemId = null;
    this.unsortedCollapsed = false;
    this.hoverRow = null;
    this.bind();
    this.restoreLayout();
  }

  get fm() {
    return this.app.foldersManager;
  }

  // ---------- Layout ----------
  restoreLayout() {
    let width = 270;
    let hidden = false;
    try {
      width = parseInt(localStorage.getItem('mirogrs.panelWidth') || '270', 10) || 270;
      hidden = localStorage.getItem('mirogrs.panelHidden') === '1';
    } catch {}
    document.documentElement.style.setProperty('--pp-width', `${Math.min(560, Math.max(190, width))}px`);
    this.setHidden(hidden);
  }

  setHidden(hidden) {
    this.panel.classList.toggle('hidden', hidden);
    this.showBtn.classList.toggle('hidden', !hidden);
    document.body.classList.toggle('pp-open', !hidden);
    try {
      localStorage.setItem('mirogrs.panelHidden', hidden ? '1' : '0');
    } catch {}
  }

  bind() {
    document.getElementById('pp-hide').addEventListener('click', () => this.setHidden(true));
    this.showBtn.addEventListener('click', () => this.setHidden(false));
    document.getElementById('pp-new-folder').addEventListener('click', () => this.newFolderFlow(this.currentFolderId()));
    document.getElementById('pp-collapse-all').addEventListener('click', () => {
      for (const f of this.fm.folders.values()) f.collapsed = true;
      this.unsortedCollapsed = true;
      this.render();
    });
    document.getElementById('pp-isolate').addEventListener('click', () => this.toggleIsolate());
    this.searchEl.addEventListener('input', () => this.render());
    this.searchEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.searchEl.value = '';
        this.render();
      }
    });

    // Redimensionar painel
    const resizer = document.getElementById('pp-resizer');
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = this.panel.getBoundingClientRect().width;
      const onMove = (ev) => {
        const w = Math.min(560, Math.max(190, startW + ev.clientX - startX));
        document.documentElement.style.setProperty('--pp-width', `${w}px`);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        try {
          localStorage.setItem('mirogrs.panelWidth', String(Math.round(this.panel.getBoundingClientRect().width)));
        } catch {}
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Teclado na árvore
    this.treeEl.addEventListener('keydown', (e) => this.onTreeKey(e));
    // Evita que o mousedown no painel limpe a seleção do canvas
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());
    this.panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  currentFolderId() {
    return this.selectedId && this.selectedId !== UNSORTED && this.fm.get(this.selectedId) ? this.selectedId : null;
  }

  // ---------- Render ----------
  get nm() {
    return this.app.nodesManager;
  }

  sortedItems(folderId) {
    const nm = this.nm;
    return this.fm.itemsInFolder(folderId, false).sort((a, b) => {
      const ta = TYPE_ORDER.indexOf(a.type);
      const tb = TYPE_ORDER.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      return nm.getDisplayName(a).localeCompare(nm.getDisplayName(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
    });
  }

  render() {
    if (this.selectedId && this.selectedId !== UNSORTED && !this.fm.get(this.selectedId)) this.selectedId = null;
    if (this.focusRootId && !this.fm.get(this.focusRootId)) this.focusRootId = null;
    if (this.selectedItemId && !this.app.state.nodes.has(this.selectedItemId)) this.selectedItemId = null;

    const q = this.searchEl.value.trim().toLowerCase();
    let visible = null; // pastas visíveis na busca
    let visibleItems = null; // arquivos que batem com a busca
    let unsortedHasMatch = false;
    if (q) {
      visible = new Set();
      visibleItems = new Set();
      for (const f of this.fm.folders.values()) {
        if (f.name.toLowerCase().includes(q)) {
          for (const a of this.fm.getAncestors(f.id)) visible.add(a.id);
        }
      }
      for (const n of this.app.state.nodes.values()) {
        if (this.fm.isFolderFrame(n)) continue;
        if (!this.nm.getDisplayName(n).toLowerCase().includes(q)) continue;
        visibleItems.add(n.id);
        const fid = this.fm.containerOf(n);
        if (fid) for (const a of this.fm.getAncestors(fid)) visible.add(a.id);
        else unsortedHasMatch = true;
      }
    }

    const tree = this.treeEl;
    tree.innerHTML = '';

    // Linha raiz (projeto ou pasta focada)
    const rootLabel = this.focusRootId
      ? '⤴ ' + this.fm.get(this.focusRootId).name
      : '🗂 ' + (document.getElementById('board-title')?.value || 'Project');
    const rootRow = this.buildRow({
      id: this.focusRootId,
      name: rootLabel,
      depth: 0,
      isRoot: true,
      count: this.focusRootId ? this.fm.countItems(this.focusRootId, true) : this.app.state.nodes.size
    });
    tree.appendChild(rootRow);

    const renderItems = (folderId, depth) => {
      for (const n of this.sortedItems(folderId)) {
        if (visibleItems && !visibleItems.has(n.id)) continue;
        tree.appendChild(this.buildItemRow(n, depth, !!q));
      }
    };

    const renderLevel = (parentId, depth) => {
      for (const f of this.fm.getChildren(parentId)) {
        if (visible && !visible.has(f.id)) continue;
        const kids = this.fm.getChildren(f.id);
        const nItems = this.fm.itemsInFolder(f.id, false).length;
        const open = !f.collapsed || !!visible;
        const row = this.buildRow({
          id: f.id,
          name: f.name,
          depth,
          hasChildren: kids.length > 0 || nItems > 0,
          collapsed: f.collapsed && !visible,
          color: this.fm.getColor(f.id),
          count: this.fm.countItems(f.id, true),
          match: q && f.name.toLowerCase().includes(q)
        });
        tree.appendChild(row);
        if (open) {
          renderLevel(f.id, depth + 1);
          renderItems(f.id, depth + 1);
        }
      }
    };
    renderLevel(this.focusRootId, 1);
    if (this.focusRootId) renderItems(this.focusRootId, 1);

    if (!this.focusRootId && (!q || unsortedHasMatch)) {
      const unsorted = this.fm.itemsInFolder(null, false).length;
      const open = !this.unsortedCollapsed || !!q;
      tree.appendChild(
        this.buildRow({
          id: UNSORTED,
          name: 'Sem categoria',
          depth: 1,
          count: unsorted,
          color: '#64748b',
          isUnsorted: true,
          hasChildren: unsorted > 0,
          collapsed: this.unsortedCollapsed && !q
        })
      );
      if (open) renderItems(null, 2);
    }

    this.renderBreadcrumb();
    const linked = this.app.projectFs?.dirName();
    this.statsEl.textContent = `${this.fm.folders.size} pasta(s) · ${this.app.state.nodes.size} item(ns) · ${
      linked ? '💾 ' + linked : 'não salvo em pasta'
    }`;
    document.getElementById('pp-isolate').classList.toggle('active', !!this.fm.isolateId);
    this.syncItemSelection();
  }

  // Redesenho adiado (itens criados/apagados/renomeados no canvas). Não interrompe um renomear em curso.
  scheduleRender() {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      if (this.renamingId || this.renamingItemId) return;
      this.render();
    }, 200);
  }

  onCanvasSelectionChanged() {
    if (this.selectedItemId && !this.nm.selectedIds.has(this.selectedItemId)) this.selectedItemId = null;
    this.syncItemSelection();
  }

  // Destaca no painel os arquivos selecionados no canvas (sem refazer a árvore)
  syncItemSelection() {
    const sel = this.nm.selectedIds;
    for (const row of this.treeEl.querySelectorAll('.pp-item')) {
      const id = row.dataset.itemRow;
      row.classList.toggle('selected', id === this.selectedItemId || sel.has(id));
    }
  }

  buildItemRow(n, depth, match = false) {
    const nm = this.nm;
    const row = document.createElement('div');
    row.className = 'pp-row pp-item';
    if (match) row.classList.add('pp-match');
    row.dataset.itemRow = n.id;
    row.dataset.rowKey = ITEM_KEY + n.id;
    row.style.paddingLeft = `${6 + depth * 12}px`;
    const name = nm.getDisplayName(n);
    row.title = n.file ? `${name}\n${n.file}` : name;

    const caret = document.createElement('span');
    caret.className = 'pp-caret';
    row.appendChild(caret);

    const icon = document.createElement('span');
    icon.className = 'pp-icon pp-type-icon';
    icon.textContent = TYPE_ICON[n.type] || '•';
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'pp-name';
    label.textContent = name;
    row.appendChild(label);

    if (this.renamingItemId === n.id) this.mountRenameInput(row, label, n.id, true);

    row.addEventListener('click', () => {
      this.selectedItemId = n.id;
      this.selectedId = null;
      this.treeEl.focus({ preventScroll: true });
      this.selectNodesOnCanvas([n]);
    });
    row.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.startRenameItem(n.id);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectedItemId = n.id;
      this.selectedId = null;
      this.syncItemSelection();
      this.openItemMenu(n.id, e.clientX, e.clientY);
    });

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(ITEM_MIME, n.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    return row;
  }

  startRenameItem(id) {
    this.renamingItemId = id;
    this.render();
  }

  openItemMenu(id, x, y) {
    const nm = this.nm;
    const n = this.app.state.nodes.get(id);
    if (!n) return;
    const selectOnly = () => {
      nm.selectedIds.clear();
      nm.selectedIds.add(id);
      nm.syncSelectionClasses();
    };
    showContextMenu(x, y, [
      { label: '✎ Renomear (F2)', action: () => this.startRenameItem(id) },
      { label: '🔍 Mostrar no canvas', action: () => this.selectNodesOnCanvas([n]) },
      { label: '⧉ Duplicar', action: () => { selectOnly(); nm.duplicateSelected(); } },
      {
        label: '◌ Tirar da pasta (Sem categoria)',
        disabled: !this.fm.containerOf(n),
        action: () => this.fm.assignNodes([n], null)
      },
      { sep: true },
      { label: '🗑 Excluir', danger: true, disabled: !!n.locked, action: () => { selectOnly(); nm.deleteSelected(); } }
    ]);
  }

  buildRow({ id, name, depth, hasChildren = false, collapsed = false, color = null, count = 0, isRoot = false, isUnsorted = false, match = false }) {
    const row = document.createElement('div');
    row.className = 'pp-row';
    if (isRoot) row.classList.add('pp-root');
    if (isUnsorted) row.classList.add('pp-unsorted');
    if (match) row.classList.add('pp-match');
    const rowKey = isRoot ? (id || '') : id;
    if (!isRoot && this.selectedId === id) row.classList.add('selected');
    if (isRoot && !this.selectedId && !this.selectedItemId) row.classList.add('selected');
    row.dataset.folderRow = isRoot ? (id || '__root') : id;
    row.dataset.rowKey = isRoot ? '__root' : id;
    row.dataset.dropFolder = isUnsorted ? '' : isRoot ? (id || '') : id;
    row.style.paddingLeft = `${6 + depth * 12}px`;
    row.title = isRoot || isUnsorted ? name : this.fm.getPathString(id);

    const caret = document.createElement('span');
    caret.className = 'pp-caret';
    caret.textContent = hasChildren ? (collapsed ? '▸' : '▾') : '';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasChildren) return;
      if (isUnsorted) {
        this.unsortedCollapsed = !this.unsortedCollapsed;
        this.render();
        return;
      }
      const f = this.fm.get(id);
      if (e.altKey) {
        const next = !f.collapsed;
        for (const d of [id, ...this.fm.getDescendantIds(id)]) this.fm.get(d).collapsed = next;
      } else {
        f.collapsed = !f.collapsed;
      }
      this.render();
      this.app.storage.scheduleAutoSave({ silent: true });
    });
    row.appendChild(caret);

    if (!isRoot) {
      const icon = document.createElement('span');
      icon.className = 'pp-icon';
      icon.style.color = color || '#94a3b8';
      icon.textContent = isUnsorted ? '◌' : '■';
      row.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'pp-name';
    label.textContent = name;
    row.appendChild(label);

    const cnt = document.createElement('span');
    cnt.className = 'pp-count';
    cnt.textContent = String(count);
    row.appendChild(cnt);

    if (!isRoot && !isUnsorted && this.renamingId === id) {
      this.mountRenameInput(row, label, id, false);
    }

    // Clique: seleciona pasta + itens no canvas e dá zoom
    row.addEventListener('click', () => {
      this.selectedId = isRoot ? null : id;
      this.selectedItemId = null;
      this.treeEl.focus({ preventScroll: true });
      if (isRoot) {
        if (id) this.selectFolderOnCanvas(id);
        else this.render();
      } else if (isUnsorted) {
        this.selectNodesOnCanvas(this.fm.itemsInFolder(null, false));
      } else {
        this.selectFolderOnCanvas(id);
      }
    });

    if (!isRoot && !isUnsorted) {
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startRename(id);
      });
    }

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isUnsorted) return;
      if (isRoot && !id) {
        showContextMenu(e.clientX, e.clientY, [{ label: '＋ Nova pasta', action: () => this.newFolderFlow(null) }]);
        return;
      }
      this.selectedId = id;
      this.render();
      this.openFolderMenu(id, e.clientX, e.clientY);
    });

    // Drag & drop de pastas (reparentar) e arquivos do Windows (importar para a pasta)
    if (!isRoot && !isUnsorted) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(FOLDER_MIME, id);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    row.addEventListener('dragover', (e) => {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(FOLDER_MIME) || types.includes(ITEM_MIME) || types.includes('Files')) {
        if (isUnsorted && types.includes(FOLDER_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        row.classList.add('drop-into');
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
    row.addEventListener('drop', async (e) => {
      row.classList.remove('drop-into');
      const types = Array.from(e.dataTransfer.types || []);
      const target = isUnsorted ? null : isRoot ? id || null : id;
      if (types.includes(FOLDER_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        const dragged = e.dataTransfer.getData(FOLDER_MIME);
        if (dragged) this.fm.moveFolder(dragged, target);
      } else if (types.includes(ITEM_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        const n = this.app.state.nodes.get(e.dataTransfer.getData(ITEM_MIME));
        if (n && this.fm.containerOf(n) !== target) this.fm.assignNodes([n], target);
      } else if (e.dataTransfer.files?.length) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('drop-overlay')?.classList.add('hidden');
        await this.app.nodesManager.importFilesIntoFolder(e.dataTransfer.files, target);
      }
    });

    void rowKey;
    return row;
  }

  renderBreadcrumb() {
    const bc = this.breadcrumbEl;
    bc.innerHTML = '';
    const sel = this.currentFolderId();
    const addCrumb = (text, onClick, cls = '') => {
      const s = document.createElement('button');
      s.className = 'pp-crumb ' + cls;
      s.textContent = text;
      s.addEventListener('click', onClick);
      bc.appendChild(s);
    };
    addCrumb('Project', () => {
      this.focusRootId = null;
      this.selectedId = null;
      this.render();
    });
    if (sel) {
      for (const f of this.fm.getAncestors(sel)) {
        const sep = document.createElement('span');
        sep.className = 'pp-crumb-sep';
        sep.textContent = '›';
        bc.appendChild(sep);
        addCrumb(f.name, () => {
          this.selectedId = f.id;
          this.selectFolderOnCanvas(f.id);
        });
      }
      const focusBtn = document.createElement('button');
      focusBtn.className = 'pp-crumb pp-focus-btn';
      focusBtn.title = this.focusRootId === sel ? 'Sair do foco' : 'Focar nesta pasta (a árvore começa nela)';
      focusBtn.textContent = this.focusRootId === sel ? '⤴' : '🎯';
      focusBtn.addEventListener('click', () => {
        this.focusRootId = this.focusRootId === sel ? null : sel;
        this.render();
      });
      bc.appendChild(focusBtn);
    }
    bc.scrollLeft = bc.scrollWidth;
  }

  // ---------- Ações ----------
  selectNodesOnCanvas(nodes, fit = true) {
    const nm = this.app.nodesManager;
    nm.selectedIds.clear();
    for (const n of nodes) nm.selectedIds.add(n.id);
    nm.syncSelectionClasses();
    this.app.updateContextBar();
    if (fit && nodes.length) {
      this.app.canvasEngine.previousView = null;
      const b = this.fm.boundsOf(nodes);
      this.app.canvasEngine.fitBounds(b, 110);
    }
    this.render();
  }

  selectFolderOnCanvas(id) {
    const fr = this.fm.getFrameNode(id);
    if (fr) this.selectNodesOnCanvas([fr]);
    else this.selectNodesOnCanvas(this.fm.itemsInFolder(id, true));
  }

  revealFolder(id) {
    for (const a of this.fm.getAncestors(id)) {
      if (a.id !== id) a.collapsed = false;
    }
    this.selectedId = id;
    this.render();
    const row = this.treeEl.querySelector(`.pp-row[data-folder-row="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  async newFolderFlow(parentId) {
    const parentName = parentId ? this.fm.getPathString(parentId) : 'raiz do projeto';
    const name = await askText({
      title: '＋ Nova pasta / grupo',
      message: `Dentro de: ${parentName}`,
      placeholder: 'Ex: Personagens, Cenários, Luz…',
      okText: 'Criar'
    });
    if (!name) return null;
    const f = this.fm.createFolder(name, parentId);
    this.revealFolder(f.id);
    return f;
  }

  startRename(id) {
    this.renamingId = id;
    this.render();
  }

  mountRenameInput(row, label, id, isItem = false) {
    const input = document.createElement('input');
    input.className = 'pp-rename';
    input.value = isItem ? this.nm.getDisplayName(this.app.state.nodes.get(id)) : this.fm.get(id).name;
    label.replaceWith(input);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this.renamingId = null;
      this.renamingItemId = null;
      if (commit) {
        if (isItem) this.nm.renameNode(id, input.value);
        else this.fm.renameFolder(id, input.value);
      }
      this.render();
      this.treeEl.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  toggleIsolate(id = this.currentFolderId()) {
    this.fm.isolateId = this.fm.isolateId ? null : id;
    if (!id && !this.fm.isolateId) this.app.setStatus('Selecione uma pasta no painel para mostrar só ela.');
    this.fm.decorateAll();
    this.render();
  }

  async confirmDelete(id) {
    const f = this.fm.get(id);
    if (!f) return;
    const n = this.fm.countItems(id, true);
    const choice = await askChoice({
      title: `Excluir "${f.name}"?`,
      message: `Esta pasta tem ${n} item(ns) e ${this.fm.getDescendantIds(id).length} subpasta(s).`,
      choices: [
        { id: 'ungroup', label: 'Só remover a pasta (itens sobem pro grupo pai)', primary: true },
        { id: 'all', label: 'Excluir pasta E todos os itens dentro', danger: true }
      ]
    });
    if (choice === 'ungroup') this.fm.ungroup(id);
    else if (choice === 'all') this.fm.deleteFolderAndContents(id);
  }

  pickColor(id) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.fm.getColor(id);
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      this.fm.setColor(id, input.value);
      input.remove();
    });
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 300));
    input.click();
  }

  openFolderMenu(id, x, y) {
    const fr = this.fm.getFrameNode(id);
    const selected = this.app.nodesManager.getSelectedNodes();
    showContextMenu(x, y, [
      { label: '＋ Nova subpasta', action: () => this.newFolderFlow(id) },
      { label: '✎ Renomear (F2)', action: () => this.startRename(id) },
      { label: '🎨 Cor…', action: () => this.pickColor(id) },
      {
        label: '⧉ Duplicar pasta (com subpastas)',
        action: () => {
          const res = this.fm.duplicateFolder(id);
          if (res) this.revealFolder(res.folder.id);
        }
      },
      { sep: true },
      {
        label: `⇲ Mover ${selected.length} selecionado(s) para cá`,
        disabled: selected.length === 0,
        action: () => this.fm.assignNodes(selected, id)
      },
      { label: '☑ Selecionar itens (inclui subpastas)', action: () => this.selectNodesOnCanvas(this.fm.itemsInFolder(id, true)) },
      { label: '▦ Organizar grupo em grade', disabled: !fr, action: () => this.fm.arrangeFolder(id) },
      { sep: true },
      fr
        ? { label: '▣ Remover só o frame do canvas', action: () => this.fm.removeFrameOnly(id) }
        : {
            label: '▣ Criar frame no canvas',
            action: () => {
              this.app.pushUndoState();
              this.fm.createFrameFor(id);
              this.fm.afterChange();
            }
          },
      fr
        ? {
            label: fr.autoFit === false ? '⤢ Ligar auto-ajuste do frame' : '⤢ Desligar auto-ajuste do frame',
            action: () => {
              fr.autoFit = fr.autoFit === false;
              this.fm.afterChange();
            }
          }
        : { label: '⤢ Auto-ajuste (sem frame)', disabled: true },
      { label: this.fm.isolateId === id ? '◐ Mostrar tudo' : '◐ Mostrar só esta pasta', action: () => this.toggleIsolate(id) },
      { label: '🎯 Focar árvore nesta pasta', action: () => { this.focusRootId = id; this.render(); } },
      { sep: true },
      { label: '🗑 Excluir pasta…', danger: true, action: () => this.confirmDelete(id) }
    ]);
  }

  // ---------- Teclado ----------
  visibleRowKeys() {
    return Array.from(this.treeEl.querySelectorAll('.pp-row'))
      .map((r) => r.dataset.rowKey)
      .filter((v) => v && v !== '__root');
  }

  onTreeKey(e) {
    const id = this.currentFolderId();
    const key = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      handled();
      const keys = this.visibleRowKeys();
      const cur = this.selectedItemId ? ITEM_KEY + this.selectedItemId : this.selectedId;
      let idx = keys.indexOf(cur);
      idx = key === 'ArrowDown' ? Math.min(keys.length - 1, idx + 1) : Math.max(0, idx - 1);
      const next = keys[idx] || null;
      if (next && next.startsWith(ITEM_KEY)) {
        this.selectedItemId = next.slice(ITEM_KEY.length);
        this.selectedId = null;
      } else {
        this.selectedItemId = null;
        this.selectedId = next;
      }
      this.render();
      this.treeEl.querySelector('.pp-row.selected')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    // Arquivo selecionado no painel
    if (this.selectedItemId) {
      const n = this.app.state.nodes.get(this.selectedItemId);
      if (!n) return;
      if (key === 'Enter') {
        handled();
        this.selectNodesOnCanvas([n]);
      } else if (key === 'F2') {
        handled();
        this.startRenameItem(n.id);
      } else if (key === 'Delete') {
        handled();
        this.nm.selectedIds.clear();
        this.nm.selectedIds.add(n.id);
        this.nm.deleteSelected();
      } else if (key === 'ArrowLeft') {
        handled();
        const fid = this.fm.containerOf(n);
        this.selectedItemId = null;
        this.selectedId = fid || UNSORTED;
        this.render();
      }
      return;
    }
    if (!id) {
      if (key === 'Enter' && this.selectedId === UNSORTED) {
        handled();
        this.selectNodesOnCanvas(this.fm.itemsInFolder(null, false));
      }
      return;
    }
    const f = this.fm.get(id);
    if (key === 'ArrowRight') {
      handled();
      if (f.collapsed) f.collapsed = false;
      else {
        const first = this.fm.getChildren(id)[0];
        if (first) this.selectedId = first.id;
      }
      this.render();
    } else if (key === 'ArrowLeft') {
      handled();
      if (!f.collapsed && this.fm.getChildren(id).length) f.collapsed = true;
      else if (f.parentId) this.selectedId = f.parentId;
      this.render();
    } else if (key === 'Enter') {
      handled();
      this.selectFolderOnCanvas(id);
    } else if (key === 'F2') {
      handled();
      this.startRename(id);
    } else if (key === 'Delete') {
      handled();
      this.confirmDelete(id);
    } else if (key === 'Backspace') {
      handled();
    }
  }

  // ---------- Drop de itens do canvas sobre o painel ----------
  // Retorna undefined (não está sobre o painel) ou { folderId }
  dropTargetAt(clientX, clientY, clear = false) {
    const el = document.elementFromPoint(clientX, clientY);
    const row = el?.closest?.('#project-panel .pp-row');
    if (this.hoverRow && this.hoverRow !== row) this.hoverRow.classList.remove('drop-into');
    this.hoverRow = null;
    if (!row) return undefined;
    if (clear) {
      row.classList.remove('drop-into');
    } else {
      row.classList.add('drop-into');
      this.hoverRow = row;
    }
    const v = row.dataset.dropFolder;
    return { folderId: v ? v : null };
  }

  isOverPanel(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return !!el?.closest?.('#project-panel');
  }
}
