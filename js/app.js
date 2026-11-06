// js/app.js
// Orquestrador Principal Miro_GRS: Ferramentas, Eventos Globais, Undo/Redo, Drag & Drop, Paste e Quadro Demo

import { CanvasEngine } from './canvas-engine.js';
import { StorageManager } from './storage.js';
import { AudioEngine } from './audio-engine.js';
import { PureRefTools } from './pureref-tools.js';
import { ConnectionsAndDrawing } from './connections-drawing.js';
import { NodesManager } from './nodes-manager.js';
import { FoldersManager } from './folders-manager.js';
import { ProjectFS } from './project-fs.js';
import { ProjectPanel } from './project-panel.js';
import { TextBlocksManager } from './text-blocks.js';
import { askText, askChoice } from './ui-dialogs.js';

class MiroGRSApp {
  constructor() {
    this.state = {
      nodes: new Map(),
      connections: new Map(),
      drawings: new Map(),
      folders: new Map() // Grupos / Pastas (profundidade ilimitada)
    };
    this.isLoading = false;

    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 35;

    this.currentTool = 'select'; // 'select' | 'pan' | 'sticky' | 'text' | 'shape' | 'connect' | 'pen' | 'highlighter' | 'eraser' | 'eyedropper'
    this.currentShapeType = 'rect';
    this.isSpacePressed = false;
    this.focusMode = false;

    // Instancia módulos
    this.canvasEngine = new CanvasEngine(this);
    this.storage = new StorageManager(this);
    this.audioEngine = new AudioEngine(this);
    this.pureRefTools = new PureRefTools(this);
    this.connectionsDrawing = new ConnectionsAndDrawing(this);
    this.foldersManager = new FoldersManager(this);
    this.projectFs = new ProjectFS(this);
    this.textBlocks = new TextBlocksManager(this);
    this.nodesManager = new NodesManager(this);
    this.projectPanel = new ProjectPanel(this);

    this.init();
  }

  async init() {
    this.bindToolbarEvents();
    this.bindViewportEvents();
    this.bindKeyboardShortcuts();
    this.bindDragAndDropAndPaste();

    await this.storage.initDB();
    const saved = await this.storage.loadSavedBoard();
    if (saved && ((saved.nodes && saved.nodes.length > 0) || (saved.folders && saved.folders.length > 0))) {
      await this.loadBoardData(saved, false);
      const rec = await this.storage.getHandle(this.storage.currentProjectId);
      if (rec?.handle) {
        this.projectFs.attach(rec.handle, { manifest: rec.manifest, sigs: rec.sigs });
        this.setStatus(`Projeto "${saved.title}" restaurado. Vinculado à pasta "${rec.dirName}" — Ctrl+S salva nela.`);
      } else {
        this.setStatus('Quadro restaurado do armazenamento local. Clique em 💾 para salvar em uma pasta do computador.');
      }
    } else if (this.storage.currentProjectId === 'default_board') {
      await this.loadDemoBoard();
    } else {
      await this.loadBoardData({ id: this.storage.currentProjectId, title: 'Novo Projeto', nodes: [], folders: [] }, false);
    }
    this.projectFs.updateIndicator();
    this.projectPanel.render();
    // Vídeos que nenhum projeto usa mais saem do navegador (o undo está vazio agora)
    setTimeout(() => this.storage.media.collectGarbage(), 4000);

    window.addEventListener('beforeunload', (e) => {
      this.storage.saveCurrentBoard();
      if (this.projectFs.dirHandle && this.projectFs.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ---------- PROJETOS ----------
  // Abre um projeto a partir de dados (disco, arquivo .mirogrs ou backup local)
  async openProjectData(data, { handle = null, manifest = null, sigs = null, fit = false } = {}) {
    if (this.storage.db) await this.storage.saveCurrentBoard();
    this.storage.setCurrentProjectId(data.id || 'proj_' + Date.now().toString(36));
    this.undoStack = [];
    this.redoStack = [];
    this.foldersManager.isolateId = null;
    this.projectPanel.selectedId = null;
    this.projectPanel.focusRootId = null;
    await this.loadBoardData(data, fit || !data.camera);
    this.projectFs.attach(handle, { manifest, sigs });
    if (handle) await this.projectFs.persistHandleState();
    await this.storage.saveCurrentBoard();
    this.projectPanel.render();
  }

  async switchProject(id) {
    if (id === this.storage.currentProjectId) return;
    const rec = await this.storage.getHandle(id);
    if (rec?.handle && this.projectFs.supported) {
      // Prefere abrir do disco (pega o que mudou no Explorer)
      if (await this.projectFs.ensurePermission(rec.handle)) {
        if (this.storage.db) await this.storage.saveCurrentBoard();
        const ok = await this.projectFs.openFromHandle(rec.handle).catch((err) => {
          console.warn(err);
          return false;
        });
        if (ok) return;
      }
    }
    const data = await this.storage.loadSavedBoard(id);
    if (!data) return;
    await this.openProjectData(data, { handle: rec?.handle || null, manifest: rec?.manifest, sigs: rec?.sigs });
    this.setStatus(`Projeto "${data.title}" aberto (cópia local do navegador).`);
  }

  async newProject() {
    const name = await askText({ title: '✨ Novo projeto', message: 'Nome do moodboard / projeto:', placeholder: 'Ex: Jogo Fantasia — Arte', okText: 'Criar' });
    if (!name) return;
    const id = 'proj_' + Date.now().toString(36);
    await this.openProjectData({ id, title: name, nodes: [], folders: [], connections: [], drawings: [], camera: { panX: 120, panY: 90, scale: 1 } });
    this.setStatus(`Projeto "${name}" criado.`);
    if (this.projectFs.supported) {
      const choice = await askChoice({
        title: 'Salvar em uma pasta do computador?',
        message: 'Cada grupo vira uma pasta de verdade, com as imagens e sons dentro (como o Project da Unity).',
        choices: [{ id: 'pick', label: '📁 Escolher pasta agora', primary: true }, { id: 'later', label: 'Depois' }]
      });
      if (choice === 'pick') await this.projectFs.linkCurrentProjectToFolder();
    }
  }

  async openProjectsModal() {
    const modal = document.getElementById('projects-modal');
    const list = document.getElementById('projects-list');
    modal.classList.remove('hidden');
    list.innerHTML = '<div class="projects-empty">Carregando…</div>';
    const projects = await this.storage.listProjects();
    list.innerHTML = '';
    if (!projects.length) list.innerHTML = '<div class="projects-empty">Nenhum projeto ainda.</div>';
    for (const p of projects) {
      const row = document.createElement('div');
      row.className = 'project-row' + (p.id === this.storage.currentProjectId ? ' current' : '');
      const info = document.createElement('div');
      info.className = 'project-info';
      const title = document.createElement('strong');
      title.textContent = p.title;
      const meta = document.createElement('small');
      const when = p.updatedAt ? new Date(p.updatedAt).toLocaleString('pt-BR') : '';
      meta.textContent = `${p.folders} pasta(s) · ${p.count} item(ns) · ${when}`;
      const where = document.createElement('small');
      where.className = 'project-where';
      where.textContent = p.dirName ? `📁 pasta: ${p.dirName}` : '🌐 só no navegador';
      info.append(title, meta, where);
      const actions = document.createElement('div');
      actions.className = 'project-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'primary-btn';
      openBtn.textContent = p.id === this.storage.currentProjectId ? 'Aberto' : 'Abrir';
      openBtn.disabled = p.id === this.storage.currentProjectId;
      openBtn.addEventListener('click', async () => {
        modal.classList.add('hidden');
        await this.switchProject(p.id);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'ctx-btn danger';
      delBtn.textContent = '🗑';
      delBtn.title = 'Remover da lista (os arquivos no disco NÃO são apagados)';
      delBtn.disabled = p.id === this.storage.currentProjectId;
      delBtn.addEventListener('click', async () => {
        const c = await askChoice({
          title: `Remover "${p.title}" da lista?`,
          message: 'Apaga só a cópia guardada no navegador. A pasta no disco (se houver) continua intacta.',
          choices: [{ id: 'yes', label: 'Remover da lista', danger: true }]
        });
        if (c === 'yes') {
          await this.storage.deleteProject(p.id);
          this.openProjectsModal();
        }
      });
      actions.append(openBtn, delBtn);
      row.append(info, actions);
      list.appendChild(row);
    }
  }

  setStatus(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
  }

  setTool(toolName) {
    this.currentTool = toolName;
    document.querySelectorAll('#left-toolbar .tool-btn[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    const shapePicker = document.getElementById('shape-picker');
    if (shapePicker) {
      shapePicker.classList.toggle('hidden', toolName !== 'shape');
    }

    const loupe = document.getElementById('eyedropper-loupe');
    if (loupe) {
      loupe.classList.toggle('hidden', toolName !== 'eyedropper');
    }

    document.body.classList.toggle('tool-connect', toolName === 'connect');

    const vp = this.canvasEngine.viewport;
    vp.classList.remove('cursor-pan', 'cursor-crosshair');
    if (toolName === 'pan') vp.classList.add('cursor-pan');
    else if (['sticky', 'text', 'shape', 'connect', 'pen', 'highlighter', 'eyedropper', 'textblocks'].includes(toolName)) {
      vp.classList.add('cursor-crosshair');
    }

    this.updateContextBar();
  }

  toggleFocusMode(forceVal = null) {
    this.focusMode = forceVal !== null ? forceVal : !this.focusMode;
    document.body.classList.toggle('focus-mode', this.focusMode);
    document.getElementById('focus-mode-banner').classList.toggle('hidden', !this.focusMode);
  }

  // HISTÓRICO UNDO / REDO
  pushUndoState() {
    const snapshot = JSON.stringify(this.storage.serializeBoard());
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo() {
    if (this.undoStack.length === 0) {
      this.setStatus('Nada para desfazer.');
      return;
    }
    const currentSnap = JSON.stringify(this.storage.serializeBoard());
    this.redoStack.push(currentSnap);
    const prevSnap = this.undoStack.pop();
    await this.loadBoardData(JSON.parse(prevSnap), false);
    this.storage.scheduleAutoSave();
    this.setStatus('Ação desfeita (Undo).');
  }

  async redo() {
    if (this.redoStack.length === 0) {
      this.setStatus('Nada para refazer.');
      return;
    }
    const currentSnap = JSON.stringify(this.storage.serializeBoard());
    this.undoStack.push(currentSnap);
    const nextSnap = this.redoStack.pop();
    await this.loadBoardData(JSON.parse(nextSnap), false);
    this.storage.scheduleAutoSave();
    this.setStatus('Ação refeita (Redo).');
  }

  async loadBoardData(data, fitView = false) {
    // Limpa players de áudio ativos
    for (const id of this.state.nodes.keys()) {
      this.audioEngine.stopAndCleanupNode(id);
    }

    this.isLoading = true;
    this.textBlocks.destroyAll();
    this.state.nodes.clear();
    this.state.connections.clear();
    this.state.drawings.clear();
    this.nodesManager.nodesLayer.innerHTML = '';
    this.nodesManager.selectedIds.clear();
    // Pastas antes dos nós (as tags/badges dependem delas). Projetos antigos: sem pastas.
    this.foldersManager.load(data.folders || []);

    if (data.title) {
      const titleIn = document.getElementById('board-title');
      if (titleIn) titleIn.value = data.title;
    }

    if (data.palette && Array.isArray(data.palette)) {
      this.pureRefTools.savedColors = data.palette;
      this.pureRefTools.renderPaletteGrid();
    }

    if (data.camera && !fitView) {
      this.canvasEngine.panX = data.camera.panX ?? 120;
      this.canvasEngine.panY = data.camera.panY ?? 90;
      this.canvasEngine.scale = data.camera.scale ?? 1;
      this.canvasEngine.gridStyle = data.camera.gridStyle || 'dots';
      this.canvasEngine.updateTransform();
    }

    for (const n of data.nodes || []) {
      this.nodesManager.createNode(n, false);
    }
    for (const c of data.connections || []) {
      this.state.connections.set(c.id, c);
    }
    for (const d of data.drawings || []) {
      this.state.drawings.set(d.id, d);
    }

    this.connectionsDrawing.renderAllConnections();
    this.connectionsDrawing.renderAllDrawings();
    this.canvasEngine.renderMinimap();
    this.foldersManager.decorateAll();
    this.isLoading = false;
    this.updateContextBar();
    this.projectPanel?.render();

    if (fitView) {
      this.canvasEngine.fitAllOrSelection();
    }
  }

  updateContextBar() {
    const bar = document.getElementById('context-bar');
    const selected = this.nodesManager.getSelectedNodes();
    const connId = this.connectionsDrawing.selectedConnectionId;
    const isDrawingTool = ['pen', 'highlighter', 'sticky', 'shape', 'text'].includes(this.currentTool);
    this.projectPanel?.onCanvasSelectionChanged();

    if (selected.length === 0 && !connId && !isDrawingTool) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');

    const hasImage = selected.some((n) => n.type === 'image');
    const hasAudio = selected.some((n) => n.type === 'audio');

    document.getElementById('ctx-pureref-group').classList.toggle('hidden', !hasImage);
    document.getElementById('ctx-audio-group').classList.toggle('hidden', !hasAudio);

    this.updateFolderSelect(selected);

    if (selected.length === 1) {
      const n = selected[0];
      if (n.fill && n.fill.startsWith('#')) {
        document.getElementById('ctx-fill-color').value = n.fill;
      }
      document.getElementById('ctx-opacity').value = String(n.opacity ?? 100);
      document.getElementById('ctx-btn-lock').textContent = n.locked ? '🔒' : '🔓';
    }
  }

  // Dropdown "📁 Pasta" da barra contextual (mostra/troca a pasta dos itens selecionados)
  updateFolderSelect(selected) {
    const group = document.getElementById('ctx-folder-group');
    const sel = document.getElementById('ctx-folder-select');
    if (!group || !sel) return;
    group.classList.toggle('hidden', selected.length === 0);
    if (!selected.length) return;
    const fm = this.foldersManager;
    const containers = new Set(selected.map((n) => fm.containerOf(n) || ''));
    sel.innerHTML = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    };
    if (containers.size > 1) add('__mixed', '— várias pastas —');
    add('', 'Sem categoria');
    for (const { folder, depth } of fm.flatTree()) {
      add(folder.id, '\u00A0\u00A0'.repeat(depth) + (depth ? '└ ' : '') + folder.name);
    }
    sel.value = containers.size > 1 ? '__mixed' : [...containers][0];
    sel.title = containers.size > 1 ? 'Itens em pastas diferentes' : '📁 ' + fm.getPathString([...containers][0] || null);
  }

  async groupSelectionFlow() {
    const selected = this.nodesManager.getSelectedNodes();
    if (!selected.length) {
      this.setStatus('Selecione os itens (Shift+clique ou caixa de seleção) e aperte Ctrl+G para agrupar.');
      return;
    }
    const name = await askText({
      title: `▣ Agrupar ${selected.length} item(ns)`,
      message: 'Nome do grupo / pasta (vira tag, frame e pasta no disco):',
      placeholder: 'Ex: Referências de Luz',
      okText: 'Agrupar'
    });
    if (!name) return;
    const folder = this.foldersManager.groupNodes(selected, name);
    if (folder) {
      this.projectPanel.revealFolder(folder.id);
      const fr = this.foldersManager.getFrameNode(folder.id);
      if (fr) this.nodesManager.selectNode(fr.id, false);
    }
  }

  ungroupSelection() {
    const fm = this.foldersManager;
    const selected = this.nodesManager.getSelectedNodes();
    const frames = selected.filter((n) => fm.isFolderFrame(n));
    if (frames.length) {
      this.pushUndoState();
      for (const fr of frames) fm.ungroup(fr.frameFolderId, { undo: false, refresh: false });
      fm.afterChange();
      this.setStatus(`${frames.length} grupo(s) desfeito(s). Os itens subiram para o grupo pai.`);
      return;
    }
    const items = selected.filter((n) => n.folderId);
    if (!items.length) return;
    this.pushUndoState();
    for (const n of items) n.folderId = fm.get(n.folderId)?.parentId || null;
    fm.afterChange();
    this.setStatus(`${items.length} item(ns) tirado(s) do grupo (subiram um nível).`);
  }

  bindProjectEvents() {
    const save = () => this.projectFs.save();
    document.getElementById('btn-save-project').addEventListener('click', save);
    document.getElementById('menu-save-disk').addEventListener('click', save);
    document.getElementById('menu-link-folder').addEventListener('click', () => this.projectFs.linkCurrentProjectToFolder());
    document.getElementById('menu-open-folder').addEventListener('click', () => this.projectFs.openFromFolderPicker());
    document.getElementById('menu-projects').addEventListener('click', () => this.openProjectsModal());
    document.getElementById('menu-export-zip').addEventListener('click', () => this.projectFs.exportZip());
    const auto = document.getElementById('menu-autosave-disk');
    auto.addEventListener('click', (e) => e.stopPropagation());
    auto.addEventListener('change', () => {
      this.projectFs.setAutoSaveDisk(auto.checked);
      this.setStatus(auto.checked ? 'Auto-salvar na pasta ligado (salva ~2s depois de cada mudança).' : 'Auto-salvar na pasta desligado. Use Ctrl+S.');
    });
    document.getElementById('menu-autosave-row').addEventListener('click', (e) => e.stopPropagation());

    const modal = document.getElementById('projects-modal');
    document.getElementById('btn-close-projects').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
    document.getElementById('btn-projects-new').addEventListener('click', () => {
      modal.classList.add('hidden');
      this.newProject();
    });
    document.getElementById('btn-projects-open-folder').addEventListener('click', () => {
      modal.classList.add('hidden');
      this.projectFs.openFromFolderPicker();
    });
    document.getElementById('btn-projects-import').addEventListener('click', () => {
      modal.classList.add('hidden');
      document.getElementById('file-input-project').click();
    });
    document.getElementById('btn-projects').addEventListener('click', () => this.openProjectsModal());

    // Barra contextual: pasta + agrupar
    document.getElementById('ctx-folder-select').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__mixed') return;
      this.foldersManager.assignNodes(this.nodesManager.getSelectedNodes(), v || null);
    });
    document.getElementById('ctx-btn-group').addEventListener('click', () => this.groupSelectionFlow());
    document.getElementById('ctx-btn-ungroup').addEventListener('click', () => this.ungroupSelection());
  }

  bindToolbarEvents() {
    this.bindProjectEvents();

    // Botões da barra esquerda
    document.querySelectorAll('#left-toolbar .tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });

    // Sub-seletor de formas
    document.querySelectorAll('#shape-picker .sub-tool-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#shape-picker .sub-tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentShapeType = btn.dataset.shape;
        this.setTool('shape');
      });
    });

    // Upload de mídia
    const fileInputMedia = document.getElementById('file-input-media');
    document.getElementById('btn-upload-media').addEventListener('click', () => fileInputMedia.click());
    fileInputMedia.addEventListener('change', async (e) => {
      if (e.target.files?.length) {
        const center = this.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        await this.nodesManager.importFilesAtPoint(e.target.files, center.x - 160, center.y - 120);
        fileInputMedia.value = '';
      }
    });

    // Importar por URL
    document.getElementById('btn-add-url').addEventListener('click', async () => {
      const url = prompt('Cole a URL de uma Imagem (.png, .jpg, .webp, .gif) ou Áudio (.mp3, .wav, .ogg):');
      if (!url || !url.trim()) return;
      const clean = url.trim();
      const center = this.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      if (/\.(mp3|wav|ogg|m4a|webm)(\?.*)?$/i.test(clean)) {
        await this.nodesManager.createAudioNodeFromDataUrl(clean, 'Áudio da Web', center.x - 170, center.y - 80);
      } else {
        await this.nodesManager.createImageNodeFromDataUrl(clean, 'Imagem da Web', center.x - 170, center.y - 130);
      }
    });

    // Top bar: Undo/Redo & Título
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
    document.getElementById('board-title').addEventListener('change', () => {
      this.storage.scheduleAutoSave();
      this.projectPanel.render();
    });

    // Botões PureRef Layout
    document.getElementById('btn-pack').addEventListener('click', () => this.pureRefTools.packSelectedNodes());
    document.getElementById('btn-grid-layout').addEventListener('click', () => this.pureRefTools.arrangeGrid());
    document.getElementById('btn-norm-height').addEventListener('click', () => this.pureRefTools.normalizeHeight());
    document.getElementById('btn-align-row').addEventListener('click', () => this.pureRefTools.alignHorizontal());

    // Gerar Som Sintetizado Demo
    document.getElementById('btn-synth-sound').addEventListener('click', async () => {
      const wavDataUrl = this.audioEngine.generateDemoWavDataUrl('arp');
      const center = this.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      const node = await this.nodesManager.createAudioNodeFromDataUrl(
        wavDataUrl,
        'Synth Melody Demo.wav',
        center.x - 175,
        center.y - 85
      );
      this.audioEngine.addMarkerToAudioNode(node.id, 1.4, 'Drop / Nota Alta');
    });

    // Paleta, Modo Foco, Tema, Ajuda
    document.getElementById('btn-toggle-palette').addEventListener('click', () => {
      document.getElementById('palette-panel').classList.toggle('hidden');
    });
    document.getElementById('btn-close-palette').addEventListener('click', () => {
      document.getElementById('palette-panel').classList.add('hidden');
    });
    document.getElementById('btn-focus-mode').addEventListener('click', () => this.toggleFocusMode());
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      this.canvasEngine.renderGrid();
    });

    // Menu Salvar / Exportar
    const fileMenuBtn = document.getElementById('btn-file-menu');
    const fileMenuDrop = document.getElementById('file-menu-dropdown');
    fileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileMenuDrop.classList.toggle('hidden');
    });
    window.addEventListener('click', () => fileMenuDrop.classList.add('hidden'));

    document.getElementById('menu-save-project').addEventListener('click', () => this.storage.exportProjectFile());
    const projInput = document.getElementById('file-input-project');
    document.getElementById('menu-load-project').addEventListener('click', () => projInput.click());
    projInput.addEventListener('change', (e) => {
      if (e.target.files?.[0]) {
        this.storage.importProjectFile(e.target.files[0]);
        projInput.value = '';
      }
    });
    document.getElementById('menu-export-png').addEventListener('click', () => this.storage.exportCanvasToPNG());
    document.getElementById('menu-load-demo').addEventListener('click', () => this.loadDemoBoard());
    document.getElementById('menu-clear-board').addEventListener('click', () => {
      if (confirm('Deseja limpar todos os itens deste quadro?')) {
        this.pushUndoState();
        this.loadBoardData({ title: document.getElementById('board-title')?.value || 'Quadro Limpo', nodes: [], folders: [], connections: [], drawings: [] }, false);
        this.storage.scheduleAutoSave();
      }
    });

    // Modal de Ajuda / Deploy
    const helpModal = document.getElementById('help-modal');
    document.getElementById('btn-help').addEventListener('click', () => helpModal.classList.remove('hidden'));
    document.getElementById('btn-close-help').addEventListener('click', () => helpModal.classList.add('hidden'));
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) helpModal.classList.add('hidden');
    });

    // Controles da Barra Contextual
    document.getElementById('ctx-fill-color').addEventListener('input', (e) => {
      this.applyColorToSelection(e.target.value);
    });
    document.querySelectorAll('#ctx-quick-colors .swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        const c = sw.dataset.color;
        document.getElementById('ctx-fill-color').value = c;
        this.applyColorToSelection(c);
      });
    });
    document.getElementById('ctx-font-size').addEventListener('change', (e) => {
      const sz = parseInt(e.target.value, 10);
      for (const n of this.nodesManager.getSelectedNodes()) {
        n.fontSize = sz;
        this.nodesManager.updateNodeElementTransform(n);
      }
      this.storage.scheduleAutoSave();
    });
    document.getElementById('ctx-opacity').addEventListener('input', (e) => {
      const op = parseInt(e.target.value, 10);
      for (const n of this.nodesManager.getSelectedNodes()) {
        n.opacity = op;
        this.nodesManager.updateNodeElementTransform(n);
      }
      this.storage.scheduleAutoSave();
    });

    // Botões PureRef na Barra Contextual
    document.getElementById('ctx-btn-crop').addEventListener('click', () => this.pureRefTools.toggleCropMode());
    document.getElementById('ctx-btn-uncrop').addEventListener('click', () => this.pureRefTools.resetCrop());
    document.getElementById('ctx-btn-fliph').addEventListener('click', () => this.pureRefTools.toggleFlip('h'));
    document.getElementById('ctx-btn-flipv').addEventListener('click', () => this.pureRefTools.toggleFlip('v'));
    document.getElementById('ctx-btn-grayscale').addEventListener('click', () => this.pureRefTools.toggleGrayscale());

    // Botões de Áudio na Barra Contextual
    document.getElementById('ctx-btn-add-marker').addEventListener('click', () => {
      const sel = this.nodesManager.getSelectedNodes().find((n) => n.type === 'audio');
      if (sel) this.audioEngine.addMarkerToAudioNode(sel.id);
    });
    document.getElementById('ctx-btn-audio-loop').addEventListener('click', () => {
      const sel = this.nodesManager.getSelectedNodes().find((n) => n.type === 'audio');
      if (sel) {
        const el = document.querySelector(`.canvas-node[data-id="${sel.id}"] .audio-loop-btn`);
        if (el) el.click();
      }
    });

    // Ações Comuns na Barra Contextual
    document.getElementById('ctx-btn-rename').addEventListener('click', () => {
      const sel = this.nodesManager.getSelectedNodes();
      if (sel.length === 1) this.nodesManager.promptRename(sel[0].id);
      else this.setStatus('Selecione 1 elemento para renomear.');
    });
    document.getElementById('ctx-btn-focus-item').addEventListener('click', () => this.canvasEngine.fitAllOrSelection());
    document.getElementById('ctx-btn-lock').addEventListener('click', () => this.nodesManager.toggleLockSelected());
    document.getElementById('ctx-btn-front').addEventListener('click', () => this.nodesManager.bringToFront());
    document.getElementById('ctx-btn-back').addEventListener('click', () => this.nodesManager.sendToBack());
    document.getElementById('ctx-btn-duplicate').addEventListener('click', () => this.nodesManager.duplicateSelected());
    document.getElementById('ctx-btn-delete').addEventListener('click', () => this.nodesManager.deleteSelected());

    // HUD Inferior (Zoom e Grid)
    document.getElementById('btn-grid-style').addEventListener('click', () => this.canvasEngine.cycleGridStyle());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.canvasEngine.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.canvasEngine.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8));
    document.getElementById('btn-zoom-reset').addEventListener('click', () => this.canvasEngine.setZoom(1));
    document.getElementById('btn-fit-all').addEventListener('click', () => this.canvasEngine.fitAllOrSelection());
  }

  applyColorToSelection(color) {
    const selected = this.nodesManager.getSelectedNodes();
    if (selected.length > 0) {
      for (const n of selected) {
        n.fill = color;
        if (n.type === 'text') n.textColor = color;
        this.nodesManager.updateNodeElementTransform(n);
      }
      this.storage.scheduleAutoSave();
    }
    if (this.connectionsDrawing.selectedConnectionId) {
      const conn = this.state.connections.get(this.connectionsDrawing.selectedConnectionId);
      if (conn) {
        conn.color = color;
        this.connectionsDrawing.renderAllConnections();
        this.storage.scheduleAutoSave();
      }
    }
  }

  bindViewportEvents() {
    const vp = this.canvasEngine.viewport;
    const selBox = document.getElementById('selection-box');

    // Zoom pelo Scroll do Mouse na posição exata do cursor
    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.canvasEngine.zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false }
    );

    vp.addEventListener('mousedown', (e) => {
      // Botão do meio (Scroll Click) ou Barra de Espaço ou ferramenta Mão -> Pan
      if (e.button === 1 || (e.button === 0 && (this.isSpacePressed || this.currentTool === 'pan'))) {
        e.preventDefault();
        this.canvasEngine.isPanning = true;
        this.canvasEngine.panStartX = e.clientX - this.canvasEngine.panX;
        this.canvasEngine.panStartY = e.clientY - this.canvasEngine.panY;
        vp.classList.add('cursor-panning');
        return;
      }

      if (e.button !== 0) return;

      const worldPt = this.canvasEngine.screenToWorld(e.clientX, e.clientY);

      // Conta-gotas
      if (this.currentTool === 'eyedropper') {
        this.pureRefTools.sampleColorAtScreenPoint(e.clientX, e.clientY, true);
        return;
      }

      // Desenho Livre ou Marca-texto
      if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
        this.connectionsDrawing.startFreehandStroke(worldPt, this.currentTool === 'highlighter');
        const onMove = (ev) => {
          this.connectionsDrawing.appendFreehandPoint(this.canvasEngine.screenToWorld(ev.clientX, ev.clientY));
        };
        const onUp = () => {
          this.connectionsDrawing.endFreehandStroke();
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }

      // Borracha
      if (this.currentTool === 'eraser') {
        this.pushUndoState();
        this.connectionsDrawing.eraseAtWorldPoint(worldPt);
        const onMove = (ev) => {
          this.connectionsDrawing.eraseAtWorldPoint(this.canvasEngine.screenToWorld(ev.clientX, ev.clientY));
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }

      // Criação rápida de Post-it, Texto ou Forma clicando no canvas
      if (this.currentTool === 'sticky') {
        const color = document.getElementById('ctx-fill-color')?.value || '#fef08a';
        const node = this.nodesManager.createNode({
          type: 'sticky',
          x: worldPt.x - 105,
          y: worldPt.y - 95,
          width: 210,
          height: 190,
          fill: color,
          text: 'Nova nota...'
        });
        this.foldersManager.autoAssign([node]);
        this.nodesManager.selectNode(node.id, false);
        this.setTool('select');
        return;
      }

      if (this.currentTool === 'textblocks') {
        const node = this.textBlocks.createCardNode({}, worldPt.x - 40, worldPt.y - 20);
        this.foldersManager.autoAssign([node]);
        this.setTool('select');
        return;
      }

      if (this.currentTool === 'text') {
        const node = this.nodesManager.createNode({
          type: 'text',
          x: worldPt.x - 60,
          y: worldPt.y - 20,
          width: 220,
          height: 55,
          fill: '#f8fafc',
          fontSize: 24,
          text: 'Digite seu título...'
        });
        this.foldersManager.autoAssign([node]);
        this.nodesManager.selectNode(node.id, false);
        this.setTool('select');
        return;
      }

      if (this.currentTool === 'shape' && this.currentShapeType === 'frame') {
        // Frame = Grupo/Pasta: criar um frame cria uma pasta (dentro do frame onde clicou)
        const parentId = this.foldersManager.findFolderAtPoint(worldPt.x, worldPt.y);
        this.setTool('select');
        askText({ title: '▣ Novo grupo (frame + pasta)', placeholder: 'Ex: Cenários', okText: 'Criar' }).then((name) => {
          if (!name) return;
          const folder = this.foldersManager.createFolder(name, parentId, {
            frameRect: { x: worldPt.x - 200, y: worldPt.y - 130, width: 400, height: 260 }
          });
          this.projectPanel.revealFolder(folder.id);
        });
        return;
      }

      if (this.currentTool === 'shape') {
        const isFrame = this.currentShapeType === 'frame';
        const node = this.nodesManager.createNode({
          type: 'shape',
          shapeType: this.currentShapeType,
          x: worldPt.x - (isFrame ? 220 : 90),
          y: worldPt.y - (isFrame ? 150 : 65),
          width: isFrame ? 440 : 180,
          height: isFrame ? 300 : 130,
          fill: '#312e81',
          stroke: '#818cf8',
          title: isFrame ? 'Frame de Referências' : '',
          text: isFrame ? '' : 'Bloco'
        });
        this.foldersManager.autoAssign([node]);
        this.nodesManager.selectNode(node.id, false);
        this.setTool('select');
        return;
      }

      // Clique no vazio com ferramenta Select -> Caixa de Seleção Marquee (Lasso)
      if (!e.shiftKey) {
        this.nodesManager.clearSelection();
      }

      const startScreenX = e.clientX;
      const startScreenY = e.clientY;
      selBox.classList.remove('hidden');
      selBox.style.left = `${startScreenX}px`;
      selBox.style.top = `${startScreenY}px`;
      selBox.style.width = '0px';
      selBox.style.height = '0px';

      const onSelectMove = (ev) => {
        const x1 = Math.min(startScreenX, ev.clientX);
        const y1 = Math.min(startScreenY, ev.clientY);
        const w = Math.abs(ev.clientX - startScreenX);
        const h = Math.abs(ev.clientY - startScreenY);

        selBox.style.left = `${x1}px`;
        selBox.style.top = `${y1}px`;
        selBox.style.width = `${w}px`;
        selBox.style.height = `${h}px`;

        const wTL = this.canvasEngine.screenToWorld(x1, y1);
        const wBR = this.canvasEngine.screenToWorld(x1 + w, y1 + h);

        if (!ev.shiftKey) this.nodesManager.selectedIds.clear();
        for (const n of this.state.nodes.values()) {
          const intersects =
            n.x < wBR.x &&
            n.x + n.width > wTL.x &&
            n.y < wBR.y &&
            n.y + n.height > wTL.y;
          if (intersects) {
            this.nodesManager.selectedIds.add(n.id);
          }
        }
        this.nodesManager.syncSelectionClasses();
      };

      const onSelectUp = () => {
        selBox.classList.add('hidden');
        this.updateContextBar();
        window.removeEventListener('mousemove', onSelectMove);
        window.removeEventListener('mouseup', onSelectUp);
      };

      window.addEventListener('mousemove', onSelectMove);
      window.addEventListener('mouseup', onSelectUp);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.canvasEngine.isPanning) {
        this.canvasEngine.panX = e.clientX - this.canvasEngine.panStartX;
        this.canvasEngine.panY = e.clientY - this.canvasEngine.panStartY;
        this.canvasEngine.updateTransform();
        return;
      }
      if (this.currentTool === 'eyedropper') {
        this.pureRefTools.sampleColorAtScreenPoint(e.clientX, e.clientY, false);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.canvasEngine.isPanning) {
        this.canvasEngine.isPanning = false;
        vp.classList.remove('cursor-panning');
        this.storage.scheduleAutoSave({ silent: true });
      }
    });
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName;
      const isEditingText =
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT' ||
        document.activeElement?.isContentEditable;

      if (e.key === 'Tab') {
        e.preventDefault();
        this.toggleFocusMode();
        return;
      }

      if (e.key === 'Escape') {
        if (this.focusMode) this.toggleFocusMode(false);
        this.nodesManager.clearSelection();
        this.setTool('select');
        return;
      }

      if (isEditingText) return;

      if (e.code === 'Space' && !this.isSpacePressed) {
        e.preventDefault();
        this.isSpacePressed = true;
        this.canvasEngine.viewport.classList.add('cursor-pan');
        return;
      }

      // Ctrl+S: salvar Project na pasta do disco
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.projectFs.save();
        return;
      }

      // Foco num card de Blocos de Texto: o Blockly cuida do teclado (Delete, Ctrl+Z, Ctrl+C/V...)
      if (this.textBlocks.isActive()) return;

      // Ctrl+G: agrupar seleção em nova pasta  •  Ctrl+Shift+G: desagrupar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) this.ungroupSelection();
        else this.groupSelectionFlow();
        return;
      }

      // Ctrl+Alt+N: nova pasta (dentro da pasta selecionada no painel)
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.projectPanel.newFolderFlow(this.projectPanel.currentFolderId());
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.nodesManager.duplicateSelected();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.pureRefTools.packSelectedNodes();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        for (const id of this.state.nodes.keys()) {
          this.nodesManager.selectedIds.add(id);
        }
        this.nodesManager.syncSelectionClasses();
        this.updateContextBar();
        return;
      }

      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        this.pureRefTools.toggleFlip('h');
        return;
      }
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pureRefTools.toggleFlip('v');
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        const sel = this.nodesManager.getSelectedNodes();
        if (sel.length === 1) this.nodesManager.promptRename(sel[0].id);
        else this.setStatus('Selecione 1 elemento para renomear (F2).');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.nodesManager.deleteSelected();
        return;
      }

      const k = e.key.toLowerCase();
      if (k === 'v') this.setTool('select');
      else if (k === 'h') this.setTool('pan');
      else if (k === 'n') this.setTool('sticky');
      else if (k === 't') this.setTool('text');
      else if (k === 's') this.setTool('shape');
      else if (k === 'l') this.setTool('connect');
      else if (k === 'p') this.setTool('pen');
      else if (k === 'm') this.setTool('highlighter');
      else if (k === 'e') this.setTool('eraser');
      else if (k === 'i') this.setTool('eyedropper');
      else if (k === 'u') document.getElementById('file-input-media').click();
      else if (k === 'b') this.setTool('textblocks');
      else if (k === 'f' || k === 'z') this.canvasEngine.fitAllOrSelection();
      else if (k === 'g') this.pureRefTools.toggleGrayscale();
      else if (k === 'c' && !e.ctrlKey) this.pureRefTools.toggleCropMode();
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (this.currentTool !== 'pan') {
          this.canvasEngine.viewport.classList.remove('cursor-pan');
        }
      }
    });
  }

  bindDragAndDropAndPaste() {
    const dropOverlay = document.getElementById('drop-overlay');

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      // Só mostra o overlay para arquivos do computador (não para pastas arrastadas no painel)
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) dropOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dropOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropOverlay.classList.add('hidden');
      if (e.dataTransfer?.files?.length) {
        const pt = this.canvasEngine.screenToWorld(e.clientX, e.clientY);
        await this.nodesManager.importFilesAtPoint(e.dataTransfer.files, pt.x - 120, pt.y - 90);
      }
    });

    // Colar Imagens ou Textos com Ctrl+V (PureRef & Miro)
    window.addEventListener('paste', async (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (this.textBlocks.isActive()) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const center = this.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            await this.nodesManager.importFilesAtPoint([file], center.x - 150, center.y - 120);
            return;
          }
        }
      }

      const pastedText = e.clipboardData.getData('text/plain');
      if (pastedText && pastedText.trim()) {
        if (/^https?:\/\/.+\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i.test(pastedText.trim())) {
          await this.nodesManager.createImageNodeFromDataUrl(pastedText.trim(), 'Imagem Colada', center.x - 160, center.y - 120);
        } else {
          this.nodesManager.createNode({
            type: 'sticky',
            x: center.x - 105,
            y: center.y - 95,
            width: 220,
            height: 190,
            fill: '#bae6fd',
            text: pastedText.trim()
          });
        }
      }
    });
  }

  // GERA IMAGENS DE REFERÊNCIA EM ALTA RESOLUÇÃO PARA O QUADRO DEMO INICIAL
  createSampleReferenceSvgDataUrl(variant = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');

    if (variant === 1) {
      // Paisagem Sci-Fi Synthwave (Excelente para testar Conta-Gotas, Grayscale e Crop)
      const grad = ctx.createLinearGradient(0, 0, 0, 320);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.55, '#4c1d95');
      grad.addColorStop(1, '#f43f5e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 320);

      // Sol Neon
      const sunGrad = ctx.createLinearGradient(240, 60, 240, 210);
      sunGrad.addColorStop(0, '#fef08a');
      sunGrad.addColorStop(1, '#f43f5e');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(240, 145, 72, 0, Math.PI * 2);
      ctx.fill();

      // Montanhas Silhueta
      ctx.fillStyle = '#1e1b4b';
      ctx.beginPath();
      ctx.moveTo(0, 230);
      ctx.lineTo(95, 155);
      ctx.lineTo(185, 215);
      ctx.lineTo(290, 140);
      ctx.lineTo(390, 210);
      ctx.lineTo(480, 165);
      ctx.lineTo(480, 320);
      ctx.lineTo(0, 320);
      ctx.closePath();
      ctx.fill();

      // Etiqueta
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('Concept Art #01 — Neon Horizon (PureRef Ref)', 18, 298);
    } else {
      // Estudo de Personagem / Paleta de Cores & Formas
      const grad = ctx.createLinearGradient(0, 0, 480, 320);
      grad.addColorStop(0, '#042f2e');
      grad.addColorStop(1, '#0284c7');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 320);

      const circles = [
        { x: 120, y: 150, r: 65, c: '#38bdf8' },
        { x: 245, y: 135, r: 52, c: '#fbbf24' },
        { x: 355, y: 165, r: 58, c: '#a855f7' }
      ];
      for (const c of circles) {
        ctx.fillStyle = c.c;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('Color & Lighting Study #02 (Experimente tecla G ou C)', 18, 298);
    }

    return canvas.toDataURL('image/png');
  }

  async loadDemoBoard() {
    this.setStatus('Carregando quadro demonstrativo Miro + PureRef + Estúdio de Áudio...');

    const img1Url = this.createSampleReferenceSvgDataUrl(1);
    const img2Url = this.createSampleReferenceSvgDataUrl(2);
    const wavUrl = this.audioEngine.generateDemoWavDataUrl('chord');
    const { peaks, duration } = await this.audioEngine.extractPeaksFromDataUrl(wavUrl);

    const demoData = {
      title: 'Miro_GRS — Moodboard & Audio Studio',
      camera: { panX: 110, panY: 75, scale: 0.92, gridStyle: 'dots' },
      folders: [{ id: 'fld_demo_refs', name: 'Referências', parentId: null, color: '#6366f1' }],
      nodes: [
        {
          id: 'frame_pureref',
          type: 'shape',
          shapeType: 'frame',
          frameFolderId: 'fld_demo_refs',
          title: 'Referências',
          x: 40,
          y: 50,
          width: 670,
          height: 330,
          zIndex: 1
        },
        {
          id: 'img_ref_1',
          type: 'image',
          title: 'Concept_Neon_Horizon.png',
          folderId: 'fld_demo_refs',
          src: img1Url,
          x: 65,
          y: 80,
          width: 300,
          height: 200,
          zIndex: 11
        },
        {
          id: 'img_ref_2',
          type: 'image',
          title: 'Lighting_Color_Study.png',
          folderId: 'fld_demo_refs',
          src: img2Url,
          x: 385,
          y: 80,
          width: 300,
          height: 200,
          zIndex: 12
        },
        {
          id: 'sticky_welcome',
          type: 'sticky',
          x: 760,
          y: 55,
          width: 245,
          height: 215,
          fill: '#fef08a',
          fontSize: 16,
          text: '👋 Bem-vindo ao Miro_GRS!\n\n• Selecione itens + Ctrl+G = novo grupo/pasta\n• Arraste itens para dentro de um frame\n• Ctrl+S salva tudo em pastas no PC\n• TAB = Modo Foco • I = Conta-Gotas',
          zIndex: 13
        },
        {
          id: 'audio_main',
          type: 'audio',
          title: 'Trilha_Ambient_Synth.wav',
          src: wavUrl,
          peaks,
          duration,
          loop: true,
          x: 160,
          y: 440,
          width: 390,
          height: 170,
          zIndex: 14,
          markers: [
            { id: 'mk_intro', time: 0.7, label: '00:00.7 Intro', color: '#10b981' },
            { id: 'mk_climax', time: 2.6, label: '00:02.6 Clímax', color: '#f43f5e' }
          ]
        },
        {
          id: 'shape_note',
          type: 'shape',
          shapeType: 'rect',
          x: 650,
          y: 445,
          width: 260,
          height: 135,
          fill: '#1e1b4b',
          stroke: '#38bdf8',
          fontSize: 16,
          text: '🎯 Sincronia Som + Imagem:\nEsta nota está conectada diretamente ao segundo 00:02.6 da onda sonora!',
          zIndex: 15
        }
      ],
      connections: [
        {
          id: 'conn_demo_1',
          from: 'audio_main',
          to: 'img_ref_1',
          fromAnchor: 'marker:mk_intro',
          toAnchor: 'bottom',
          color: '#10b981',
          width: 2.5,
          label: 'Atmosfera Inicial'
        },
        {
          id: 'conn_demo_2',
          from: 'audio_main',
          to: 'shape_note',
          fromAnchor: 'marker:mk_climax',
          toAnchor: 'left',
          color: '#f43f5e',
          width: 2.5,
          label: 'Entrada do Clímax'
        }
      ],
      drawings: []
    };

    await this.loadBoardData(demoData, false);
    this.storage.scheduleAutoSave();
    this.setStatus('Quadro Demo carregado! Experimente dar Play no áudio ou clicar nos marcadores da onda sonora.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.miroGRS = new MiroGRSApp();
});
