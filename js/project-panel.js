// js/project-panel.js
// Painel "Project" estilo Unity: árvore de pastas recursiva (níveis ilimitados),
// breadcrumb, busca, renomear inline, menu de contexto e drag & drop.

import { askText, askChoice, showContextMenu } from './ui-dialogs.js';

const UNSORTED = '__unsorted';
const FOLDER_MIME = 'application/x-mirogrs-folder';

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
  render() {
    if (this.selectedId && this.selectedId !== UNSORTED && !this.fm.get(this.selectedId)) this.selectedId = null;
    if (this.focusRootId && !this.fm.get(this.focusRootId)) this.focusRootId = null;

    const q = this.searchEl.value.trim().toLowerCase();
    let visible = null;
    if (q) {
      visible = new Set();
      for (const f of this.fm.folders.values()) {
        if (f.name.toLowerCase().includes(q)) {
          for (const a of this.fm.getAncestors(f.id)) visible.add(a.id);
        }
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

    const renderLevel = (parentId, depth) => {
      for (const f of this.fm.getChildren(parentId)) {
        if (visible && !visible.has(f.id)) continue;
        const kids = this.fm.getChildren(f.id);
        const row = this.buildRow({
          id: f.id,
          name: f.name,
          depth,
          hasChildren: kids.length > 0,
          collapsed: f.collapsed && !visible,
          color: this.fm.getColor(f.id),
          count: this.fm.countItems(f.id, true),
          match: q && f.name.toLowerCase().includes(q)
        });
        tree.appendChild(row);
        if (kids.length && (!f.collapsed || visible)) renderLevel(f.id, depth + 1);
      }
    };
    renderLevel(this.focusRootId, 1);

    if (!this.focusRootId) {
      const unsorted = this.fm.itemsInFolder(null, false).length;
      tree.appendChild(
        this.buildRow({ id: UNSORTED, name: 'Sem categoria', depth: 1, count: unsorted, color: '#64748b', isUnsorted: true })
      );
    }

    this.renderBreadcrumb();
    const linked = this.app.projectFs?.dirName();
    this.statsEl.textContent = `${this.fm.folders.size} pasta(s) · ${this.app.state.nodes.size} item(ns) · ${
      linked ? '💾 ' + linked : 'não salvo em pasta'
    }`;
    document.getElementById('pp-isolate').classList.toggle('active', !!this.fm.isolateId);
  }

  buildRow({ id, name, depth, hasChildren = false, collapsed = false, color = null, count = 0, isRoot = false, isUnsorted = false, match = false }) {
    const row = document.createElement('div');
    row.className = 'pp-row';
    if (isRoot) row.classList.add('pp-root');
    if (isUnsorted) row.classList.add('pp-unsorted');
    if (match) row.classList.add('pp-match');
    const rowKey = isRoot ? (id || '') : id;
    if (!isRoot && this.selectedId === id) row.classList.add('selected');
    if (isRoot && !this.selectedId) row.classList.add('selected');
    row.dataset.folderRow = isRoot ? (id || '__root') : id;
    row.dataset.dropFolder = isUnsorted ? '' : isRoot ? (id || '') : id;
    row.style.paddingLeft = `${6 + depth * 12}px`;
    row.title = isRoot || isUnsorted ? name : this.fm.getPathString(id);

    const caret = document.createElement('span');
    caret.className = 'pp-caret';
    caret.textContent = hasChildren ? (collapsed ? '▸' : '▾') : '';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasChildren) return;
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
      this.mountRenameInput(row, label, id);
    }

    // Clique: seleciona pasta + itens no canvas e dá zoom
    row.addEventListener('click', () => {
      this.selectedId = isRoot ? null : id;
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
      if (types.includes(FOLDER_MIME) || types.includes('Files')) {
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

  mountRenameInput(row, label, id) {
    const input = document.createElement('input');
    input.className = 'pp-rename';
    input.value = this.fm.get(id).name;
    label.replaceWith(input);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      this.renamingId = null;
      if (commit) this.fm.renameFolder(id, input.value);
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
  visibleRowIds() {
    return Array.from(this.treeEl.querySelectorAll('.pp-row'))
      .map((r) => r.dataset.folderRow)
      .filter((v) => v !== '__root');
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
      const ids = this.visibleRowIds();
      let idx = ids.indexOf(this.selectedId);
      idx = key === 'ArrowDown' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
      this.selectedId = ids[idx] || null;
      this.render();
      this.treeEl.querySelector('.pp-row.selected')?.scrollIntoView({ block: 'nearest' });
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
