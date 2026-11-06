// js/nodes-manager.js
// Gerenciador de Nós do Canvas: Imagens PureRef, Cards de Áudio, Post-its, Formas, Textos e Swatches

import { askText } from './ui-dialogs.js';
import { isVideoFile } from './media-store.js';

export class NodesManager {
  constructor(app) {
    this.app = app;
    this.nodesLayer = document.getElementById('nodes-layer');
    this.selectedIds = new Set();
    this.nextZIndex = 10;
  }

  getSelectedNodes() {
    const res = [];
    for (const id of this.selectedIds) {
      const n = this.app.state.nodes.get(id);
      if (n) res.push(n);
    }
    return res;
  }

  selectNode(id, additive = false) {
    if (!additive) {
      this.selectedIds.clear();
    }
    if (id) {
      this.selectedIds.add(id);
      this.app.connectionsDrawing.selectedConnectionId = null;
      this.app.connectionsDrawing.renderAllConnections();
    }
    this.syncSelectionClasses();
    this.app.updateContextBar();
  }

  clearSelection() {
    this.selectedIds.clear();
    this.app.connectionsDrawing.selectedConnectionId = null;
    this.syncSelectionClasses();
    this.app.connectionsDrawing.renderAllConnections();
    this.app.updateContextBar();
  }

  syncSelectionClasses() {
    const allEls = this.nodesLayer.querySelectorAll('.canvas-node');
    allEls.forEach((el) => {
      const id = el.dataset.id;
      el.classList.toggle('selected', this.selectedIds.has(id));
    });
  }

  createNode(config, recordUndo = true) {
    if (recordUndo) this.app.pushUndoState();

    const id = config.id || 'node_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const zIndex = config.zIndex || ++this.nextZIndex;
    if (zIndex >= this.nextZIndex) this.nextZIndex = zIndex + 1;

    const nodeData = {
      id,
      type: config.type || 'sticky', // 'sticky' | 'text' | 'shape' | 'image' | 'audio' | 'swatch'
      shapeType: config.shapeType || 'rect', // 'rect' | 'circle' | 'diamond' | 'frame'
      x: Math.round(config.x ?? 200),
      y: Math.round(config.y ?? 200),
      width: Math.round(config.width ?? 210),
      height: Math.round(config.height ?? 180),
      rotation: config.rotation || 0,
      fill: config.fill || (config.type === 'sticky' ? '#fef08a' : config.type === 'shape' ? '#312e81' : '#38bdf8'),
      stroke: config.stroke || '#6366f1',
      textColor: config.textColor || (config.type === 'sticky' ? '#1e293b' : '#f8fafc'),
      fontSize: config.fontSize || 18,
      opacity: config.opacity ?? 100,
      locked: !!config.locked,
      zIndex,
      text: config.text ?? '',
      title: config.title ?? '',
      // Image PureRef properties
      src: config.src || '',
      naturalWidth: config.naturalWidth || 400,
      naturalHeight: config.naturalHeight || 300,
      flipH: !!config.flipH,
      flipV: !!config.flipV,
      grayscale: !!config.grayscale,
      crop: config.crop || null, // { x:0..1, y:0..1, w:0..1, h:0..1 }
      // Audio properties
      peaks: config.peaks || [],
      duration: config.duration || 5,
      loop: !!config.loop,
      playbackRate: config.playbackRate || 1,
      volume: config.volume ?? 0.9,
      markers: config.markers || [],
      // Organização em Pastas / Grupos (Tag = Grupo = Frame = Pasta)
      folderId: config.folderId || null, // pasta onde o item mora (null = Sem categoria)
      frameFolderId: config.frameFolderId || null, // se for frame de uma pasta: id da pasta
      autoFit: config.autoFit !== false, // frame de pasta cresce/encolhe para englobar o conteúdo
      file: config.file || null, // caminho relativo do arquivo na pasta do projeto
      fileTitle: config.fileTitle ?? null,
      // Blocos de Texto (Blockly): workspace serializado
      blocks: config.blocks || null,
      // Vídeo: o arquivo fica no MediaStore (Blob); o nó guarda só a referência
      mediaId: config.mediaId || null,
      mime: config.mime || '',
      muted: !!config.muted
    };

    this.app.state.nodes.set(id, nodeData);
    const el = this.buildNodeDOM(nodeData);
    this.nodesLayer.appendChild(el);
    this.updateNodeElementTransform(nodeData, el);

    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
    return nodeData;
  }

  buildNodeDOM(nodeData) {
    const el = document.createElement('div');
    el.className = `canvas-node node-${nodeData.type}`;
    el.dataset.id = nodeData.id;

    // 1. Conteúdo específico por tipo
    if (nodeData.type === 'sticky') {
      const edit = document.createElement('div');
      edit.className = 'node-editable';
      edit.contentEditable = 'false';
      edit.innerText = nodeData.text || 'Duplo clique para escrever...';
      const footer = document.createElement('div');
      footer.className = 'sticky-footer';
      footer.innerHTML = `<span>Post-it</span><span>Miro_GRS</span>`;
      el.appendChild(edit);
      el.appendChild(footer);
      this.bindEditableText(nodeData, el, edit);
    } else if (nodeData.type === 'text') {
      const edit = document.createElement('div');
      edit.className = 'node-editable';
      edit.contentEditable = 'false';
      edit.innerText = nodeData.text || 'Texto livre';
      el.appendChild(edit);
      this.bindEditableText(nodeData, el, edit);
    } else if (nodeData.type === 'shape') {
      el.classList.add(`shape-${nodeData.shapeType || 'rect'}`);
      if (nodeData.shapeType === 'diamond') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'diamond-svg-bg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '50,2 98,50 50,98 2,50');
        poly.setAttribute('stroke-width', '2.5');
        svg.appendChild(poly);
        el.appendChild(svg);
      } else if (nodeData.shapeType === 'frame') {
        const badge = document.createElement('div');
        badge.className = 'frame-title-badge';
        badge.textContent = nodeData.title || 'Frame / Grupo Visual';
        badge.addEventListener('dblclick', async (e) => {
          e.stopPropagation();
          const fm = this.app.foldersManager;
          const isFolder = fm.isFolderFrame(nodeData);
          const name = await askText({
            title: isFolder ? 'Renomear grupo / pasta' : 'Nome do Frame',
            value: isFolder ? fm.get(nodeData.frameFolderId).name : nodeData.title || 'Frame',
            okText: 'Renomear'
          });
          if (!name) return;
          if (isFolder) {
            fm.renameFolder(nodeData.frameFolderId, name);
          } else {
            nodeData.title = name;
            badge.textContent = name;
            this.app.storage.scheduleAutoSave();
          }
        });
        badge.addEventListener('contextmenu', (e) => {
          if (!this.app.foldersManager.isFolderFrame(nodeData)) return;
          e.preventDefault();
          e.stopPropagation();
          this.app.projectPanel.revealFolder(nodeData.frameFolderId);
          this.app.projectPanel.openFolderMenu(nodeData.frameFolderId, e.clientX, e.clientY);
        });
        el.appendChild(badge);
      }
      const edit = document.createElement('div');
      edit.className = 'node-editable';
      edit.contentEditable = 'false';
      edit.innerText = nodeData.text || '';
      el.appendChild(edit);
      this.bindEditableText(nodeData, el, edit);
    } else if (nodeData.type === 'image') {
      const viewport = document.createElement('div');
      viewport.className = 'image-viewport';
      const img = document.createElement('img');
      img.src = nodeData.src;
      img.alt = nodeData.title || 'Referência PureRef';
      img.draggable = false;
      viewport.appendChild(img);
      el.appendChild(viewport);

      const caption = document.createElement('div');
      caption.className = 'image-caption-bar';
      caption.textContent = nodeData.title || 'Imagem PureRef (Duplo clique = Foco Zoom)';
      el.appendChild(caption);

      // Duplo clique em imagem foca/desfoca o zoom nela (estilo PureRef)
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.selectNode(nodeData.id, false);
        this.app.canvasEngine.fitAllOrSelection();
      });
    } else if (nodeData.type === 'audio') {
      el.innerHTML = `
        <div class="audio-header">
          <span class="audio-title" title="Duplo clique para renomear áudio">🎵 ${nodeData.title || 'Clip de Áudio'}</span>
          <span class="audio-time-badge">00:00.0 / 00:00.0</span>
        </div>
        <div class="waveform-container" title="Clique na onda sonora para pular para o tempo">
          <canvas class="waveform-canvas" width="320" height="64"></canvas>
          <div class="audio-markers-track"></div>
        </div>
        <div class="audio-controls-row">
          <button class="audio-play-btn" title="Play / Pause">▶</button>
          <button class="audio-mini-btn audio-loop-btn" title="Repetir em Loop">🔁 Loop</button>
          <button class="audio-mini-btn audio-add-pin-btn" title="Criar Marcador de Tempo conectável na onda sonora">📍 + Pin</button>
          <select class="audio-speed-select" title="Velocidade / Pitch do Som">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1" selected>1.0x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>
          <input type="range" class="audio-vol-slider" min="0" max="1" step="0.05" value="0.9" title="Volume" />
        </div>
      `;

      const titleEl = el.querySelector('.audio-title');
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const nv = prompt('Nome do Card de Áudio:', nodeData.title || 'Clip de Áudio');
        if (nv !== null) {
          nodeData.title = nv.trim();
          titleEl.textContent = '🎵 ' + nodeData.title;
          this.app.storage.scheduleAutoSave();
        }
      });

      this.app.audioEngine.setupAudioNodeDOM(nodeData, el);
    } else if (nodeData.type === 'video') {
      this.buildVideoDOM(nodeData, el);
    } else if (nodeData.type === 'textblocks') {
      this.app.textBlocks.buildCardDOM(nodeData, el);
    } else if (nodeData.type === 'swatch') {
      el.innerHTML = `
        <div class="swatch-preview-area"></div>
        <div class="swatch-code-label">${nodeData.fill}</div>
      `;
    }

    // 2. Alças de Redimensionamento e Rotação
    const handles = document.createElement('div');
    handles.className = 'node-handles';
    handles.innerHTML = `
      <div class="resize-handle nw" data-dir="nw"></div>
      <div class="resize-handle ne" data-dir="ne"></div>
      <div class="resize-handle sw" data-dir="sw"></div>
      <div class="resize-handle se" data-dir="se"></div>
      <div class="rotate-handle" title="Arraste para rotacionar (Shift = múltiplos de 15°)">↻</div>
    `;
    el.appendChild(handles);

    // 3. Portas de Conexão nas 4 bordas
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      const port = document.createElement('div');
      port.className = `conn-port port-${side}`;
      port.dataset.portNodeId = nodeData.id;
      port.dataset.portAnchor = side;
      port.title = 'Arraste para conectar uma seta a outro elemento';
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.app.connectionsDrawing.startConnectionDrag(nodeData.id, side, e);
      });
      el.appendChild(port);
    });

    // 4. Interações de Mouse (Selecionar, Mover, Redimensionar, Rotacionar)
    this.bindNodeInteractions(nodeData, el);
    return el;
  }

  bindEditableText(nodeData, el, editEl) {
    el.addEventListener('dblclick', (e) => {
      if (nodeData.locked) return;
      e.stopPropagation();
      editEl.contentEditable = 'true';
      editEl.focus();
      const range = document.createRange();
      range.selectNodeContents(editEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    editEl.addEventListener('mousedown', (e) => {
      if (editEl.contentEditable === 'true') {
        e.stopPropagation();
      }
    });

    editEl.addEventListener('blur', () => {
      editEl.contentEditable = 'false';
      nodeData.text = editEl.innerText;
      this.app.storage.scheduleAutoSave();
    });
  }

  bindNodeInteractions(nodeData, el) {
    // Arraste do nó (ou múltiplos nós selecionados)
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.app. isSpacePressed || this.app.currentTool === 'pan') return;
      if (this.app.currentTool === 'eyedropper') {
        e.stopPropagation();
        this.app.pureRefTools.sampleColorAtScreenPoint(e.clientX, e.clientY, true);
        return;
      }
      if (this.app.currentTool === 'pen' || this.app.currentTool === 'highlighter' || this.app.currentTool === 'eraser') {
        return;
      }

      e.stopPropagation();

      if (this.app.currentTool === 'connect') {
        this.app.connectionsDrawing.startConnectionDrag(nodeData.id, 'auto', e);
        return;
      }

      const isShift = e.shiftKey;
      if (!this.selectedIds.has(nodeData.id)) {
        this.selectNode(nodeData.id, isShift);
      } else if (isShift) {
        this.selectedIds.delete(nodeData.id);
        this.syncSelectionClasses();
        this.app.updateContextBar();
        return;
      }

      if (nodeData.locked) return;

      const selectedNodes = this.getSelectedNodes().filter((n) => !n.locked);
      if (selectedNodes.length === 0) return;

      // Arrastar o frame de uma pasta leva junto todo o conteúdo (itens + subpastas)
      const fm = this.app.foldersManager;
      const movingNodes = fm.expandWithFolderContents(selectedNodes).filter((n) => !n.locked);

      const startWorld = this.app.canvasEngine.screenToWorld(e.clientX, e.clientY);
      const initialPositions = movingNodes.map((n) => ({ node: n, startX: n.x, startY: n.y }));
      let moved = false;

      const onMove = (ev) => {
        const curWorld = this.app.canvasEngine.screenToWorld(ev.clientX, ev.clientY);
        const dx = curWorld.x - startWorld.x;
        const dy = curWorld.y - startWorld.y;
        if (!moved && Math.hypot(dx, dy) > 2) {
          this.app.pushUndoState();
          moved = true;
        }
        if (!moved) return;

        for (const item of initialPositions) {
          item.node.x = Math.round(item.startX + dx);
          item.node.y = Math.round(item.startY + dy);
          this.updateNodeElementTransform(item.node);
        }
        this.app.connectionsDrawing.renderAllConnections();
        this.app.canvasEngine.renderMinimap();

        // Destaque do destino: pasta no painel Project ou frame no canvas
        const overPanel = this.app.projectPanel.dropTargetAt(ev.clientX, ev.clientY);
        if (overPanel === undefined) fm.highlightDropTarget(nodeData);
        else fm.clearDropHighlight();
      };

      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        fm.clearDropHighlight();
        if (!moved) return;
        const panelTarget = this.app.projectPanel.dropTargetAt(ev.clientX, ev.clientY, true);
        if (panelTarget !== undefined) {
          // Soltou sobre uma pasta do painel: volta à posição e entra na pasta
          for (const item of initialPositions) {
            item.node.x = item.startX;
            item.node.y = item.startY;
          }
          fm.assignNodes(selectedNodes, panelTarget.folderId, { undo: false });
        } else {
          fm.handleNodesDropped(selectedNodes);
        }
        this.app.storage.scheduleAutoSave();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Redimensionar pelas 4 quinas
    el.querySelectorAll('.resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (nodeData.locked) return;
        this.app.pushUndoState();

        const dir = handle.dataset.dir;
        const startWorld = this.app.canvasEngine.screenToWorld(e.clientX, e.clientY);
        const startX = nodeData.x;
        const startY = nodeData.y;
        const startW = nodeData.width;
        const startH = nodeData.height;
        const aspect = startW / Math.max(1, startH);

        const onMove = (ev) => {
          const cur = this.app.canvasEngine.screenToWorld(ev.clientX, ev.clientY);
          const dx = cur.x - startWorld.x;
          const dy = cur.y - startWorld.y;
          // Redimensionar manualmente o frame de uma pasta (ou um card de texto) desliga o auto-ajuste
          if (nodeData.frameFolderId || nodeData.type === 'textblocks') nodeData.autoFit = false;

          let newX = startX;
          let newY = startY;
          let newW = startW;
          let newH = startH;

          if (dir.includes('e')) newW = Math.max(50, startW + dx);
          if (dir.includes('s')) newH = Math.max(40, startH + dy);
          if (dir.includes('w')) {
            const possibleW = startW - dx;
            if (possibleW >= 50) {
              newW = possibleW;
              newX = startX + dx;
            }
          }
          if (dir.includes('n')) {
            const possibleH = startH - dy;
            if (possibleH >= 40) {
              newH = possibleH;
              newY = startY + dy;
            }
          }

          // Imagens e vídeos mantêm proporção por padrão (a menos que segure Alt)
          if (((nodeData.type === 'image' || nodeData.type === 'video') && !ev.altKey) || ev.shiftKey) {
            newH = Math.round(newW / aspect);
            if (dir.includes('n')) newY = startY + (startH - newH);
          }

          nodeData.x = Math.round(newX);
          nodeData.y = Math.round(newY);
          nodeData.width = Math.round(newW);
          nodeData.height = Math.round(newH);

          this.updateNodeElementTransform(nodeData, el);
          this.app.connectionsDrawing.renderAllConnections();
          this.app.canvasEngine.renderMinimap();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this.app.foldersManager.afterChange();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });

    // Rotacionar
    const rotHandle = el.querySelector('.rotate-handle');
    if (rotHandle) {
      rotHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (nodeData.locked) return;
        this.app.pushUndoState();

        const cx = nodeData.x + nodeData.width / 2;
        const cy = nodeData.y + nodeData.height / 2;

        const onMove = (ev) => {
          const cur = this.app.canvasEngine.screenToWorld(ev.clientX, ev.clientY);
          let angle = Math.atan2(cur.y - cy, cur.x - cx) * (180 / Math.PI) + 90;
          if (ev.shiftKey) {
            angle = Math.round(angle / 15) * 15;
          }
          nodeData.rotation = Math.round(angle);
          this.updateNodeElementTransform(nodeData, el);
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this.app.storage.scheduleAutoSave();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
  }

  updateNodeElementTransform(nodeData, domEl = null) {
    const el = domEl || this.nodesLayer.querySelector(`.canvas-node[data-id="${nodeData.id}"]`);
    if (!el) return;

    el.style.left = `${nodeData.x}px`;
    el.style.top = `${nodeData.y}px`;
    el.style.width = `${nodeData.width}px`;
    el.style.height = `${nodeData.height}px`;
    el.style.zIndex = String(nodeData.type === 'shape' && nodeData.shapeType === 'frame' ? 1 : nodeData.zIndex || 10);
    el.style.opacity = String((nodeData.opacity ?? 100) / 100);
    el.style.transform = `rotate(${nodeData.rotation || 0}deg)`;
    el.classList.toggle('locked', !!nodeData.locked);

    if (nodeData.type === 'sticky') {
      el.style.background = nodeData.fill || '#fef08a';
      el.style.color = '#1e293b';
      const edit = el.querySelector('.node-editable');
      if (edit) edit.style.fontSize = `${nodeData.fontSize || 18}px`;
    } else if (nodeData.type === 'text') {
      el.style.color = nodeData.fill || nodeData.textColor || '#f8fafc';
      const edit = el.querySelector('.node-editable');
      if (edit) edit.style.fontSize = `${nodeData.fontSize || 24}px`;
    } else if (nodeData.type === 'shape') {
      const edit = el.querySelector('.node-editable');
      if (edit) edit.style.fontSize = `${nodeData.fontSize || 18}px`;
      if (nodeData.shapeType === 'diamond') {
        const poly = el.querySelector('polygon');
        if (poly) {
          poly.setAttribute('fill', nodeData.fill || '#312e81');
          poly.setAttribute('stroke', nodeData.stroke || '#818cf8');
        }
      } else if (nodeData.shapeType !== 'frame') {
        el.style.background = nodeData.fill || '#312e81';
        el.style.borderColor = nodeData.stroke || '#818cf8';
      }
    } else if (nodeData.type === 'image') {
      el.classList.toggle('grayscale', !!nodeData.grayscale);
      const img = el.querySelector('img');
      if (img) {
        const crop = nodeData.crop || { x: 0, y: 0, w: 1, h: 1 };
        const fullW = nodeData.width / crop.w;
        const fullH = nodeData.height / crop.h;
        const offX = -crop.x * fullW;
        const offY = -crop.y * fullH;

        img.style.width = `${fullW}px`;
        img.style.height = `${fullH}px`;
        img.style.left = `${offX}px`;
        img.style.top = `${offY}px`;
        img.style.transformOrigin = 'center center';
        img.style.transform = `scale(${nodeData.flipH ? -1 : 1}, ${nodeData.flipV ? -1 : 1})`;
      }
    } else if (nodeData.type === 'swatch') {
      const preview = el.querySelector('.swatch-preview-area');
      const label = el.querySelector('.swatch-code-label');
      if (preview) preview.style.background = nodeData.fill;
      if (label) label.textContent = nodeData.fill;
    }

    // Tag/badge da pasta, cor do frame e modo "mostrar só esta pasta"
    this.app.foldersManager?.decorateNode(nodeData, el);

    // Card de blocos: reposiciona o workspace Blockly (camada de tela) sobre o card
    if (nodeData.type === 'textblocks') this.app.textBlocks?.syncCard(nodeData);
  }

  // Importação de arquivos de Imagem e Áudio para o Canvas
  async importFilesAtPoint(fileList, worldX, worldY, { autoAssign = true } = {}) {
    const files = Array.from(fileList);
    let offset = 0;
    const created = [];

    for (const file of files) {
      // Vídeo (.mp4, .mov, .webm de vídeo...) → card de vídeo
      if (isVideoFile(file)) {
        created.push(await this.createVideoNodeFromBlob(file, file.name, worldX + offset, worldY + offset));
        offset += 40;
        continue;
      }
      // .txt → card de Blocos de Texto (um bloco por parágrafo)
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        const text = await file.text();
        created.push(this.app.textBlocks.createFromText(text, file.name.replace(/\.txt$/i, ''), worldX + offset, worldY + offset));
        offset += 40;
        continue;
      }
      if (file.name.endsWith('.mirogrs') || file.name.endsWith('.json')) {
        // Projeto do blocky-pdf-editor → card de blocos; senão, projeto do Miro
        if (file.name.endsWith('.json')) {
          try {
            const obj = JSON.parse(await file.text());
            if (obj && obj.format === 'blocky-pdf-editor') {
              const n = this.app.textBlocks.createFromBlockyProject(obj, file.name.replace(/\.json$/i, ''), worldX + offset, worldY + offset);
              if (n) created.push(n);
              offset += 40;
              continue;
            }
          } catch {}
        }
        await this.app.storage.importProjectFile(file);
        return created;
      }

      const dataUrl = await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.readAsDataURL(file);
      });

      if (file.type.startsWith('image/')) {
        created.push(await this.createImageNodeFromDataUrl(dataUrl, file.name, worldX + offset, worldY + offset));
        offset += 34;
      } else if (
        file.type.startsWith('audio/') ||
        /\.(mp3|wav|ogg|m4a|webm|flac)$/i.test(file.name)
      ) {
        created.push(await this.createAudioNodeFromDataUrl(dataUrl, file.name, worldX + offset, worldY + offset));
        offset += 40;
      }
    }
    // Arquivos soltos em cima de um frame já entram naquela pasta
    if (autoAssign && created.length) this.app.foldersManager.autoAssign(created);
    return created;
  }

  // Importa arquivos direto para uma pasta (ex.: soltar arquivos sobre a pasta no painel)
  async importFilesIntoFolder(fileList, folderId) {
    const fm = this.app.foldersManager;
    const fr = fm.getFrameNode(folderId);
    const pt = fr
      ? { x: fr.x + 30, y: fr.y + 30 }
      : this.app.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const created = await this.importFilesAtPoint(fileList, pt.x, pt.y, { autoAssign: false });
    if (created.length) fm.assignNodes(created, folderId, { undo: false });
    return created;
  }

  async createImageNodeFromDataUrl(dataUrl, title = 'Imagem', x = 200, y = 200, { select = true, undo = true } = {}) {
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      img.onerror = () => resolve({ w: 360, h: 260 });
      img.src = dataUrl;
    });

    const maxSide = 360;
    const scale = Math.min(1, maxSide / Math.max(dims.w, dims.h));
    const width = Math.max(80, Math.round(dims.w * scale));
    const height = Math.max(80, Math.round(dims.h * scale));

    const node = this.createNode({
      type: 'image',
      title,
      src: dataUrl,
      naturalWidth: dims.w,
      naturalHeight: dims.h,
      x,
      y,
      width,
      height
    }, undo);
    if (select) this.selectNode(node.id, false);
    this.app.setStatus(`Imagem "${title}" adicionada! Use C p/ Crop, G p/ Escala de Cinza, Alt+H p/ Espelhar.`);
    return node;
  }

  // ---------- Vídeo ----------
  buildVideoDOM(nodeData, el) {
    const video = document.createElement('video');
    video.className = 'video-el';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.loop = !!nodeData.loop;
    video.muted = !!nodeData.muted;
    el.appendChild(video);

    // Capa transparente sobre a parte de cima do vídeo: arrasta/seleciona o item
    // (a faixa de baixo fica livre para os controles nativos: play, tempo, volume, tela cheia)
    const grip = document.createElement('div');
    grip.className = 'video-grip';
    grip.title = 'Arraste para mover • duplo clique = play/pause';
    grip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    el.appendChild(grip);

    const bar = document.createElement('div');
    bar.className = 'video-caption-bar';
    const name = document.createElement('span');
    name.className = 'video-name';
    name.textContent = '🎬 ' + (nodeData.title || 'Vídeo');
    const loopBtn = document.createElement('button');
    loopBtn.className = 'video-mini-btn' + (nodeData.loop ? ' active' : '');
    loopBtn.textContent = '🔁';
    loopBtn.title = 'Repetir em loop';
    loopBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nodeData.loop = !nodeData.loop;
      video.loop = nodeData.loop;
      loopBtn.classList.toggle('active', nodeData.loop);
      this.app.storage.scheduleAutoSave();
    });
    bar.append(name, loopBtn);
    el.appendChild(bar);

    video.addEventListener('volumechange', () => {
      if (nodeData.muted !== video.muted) {
        nodeData.muted = video.muted;
        this.app.storage.scheduleAutoSave({ silent: true });
      }
    });
    // Os controles nativos não podem iniciar o arraste do card
    video.addEventListener('mousedown', (e) => e.stopPropagation());

    this.app.storage.media.urlFor(nodeData.mediaId).then((url) => {
      if (url) {
        video.src = url;
      } else {
        name.textContent = '🎬 ' + (nodeData.title || 'Vídeo') + ' (arquivo não encontrado)';
        el.classList.add('video-missing');
      }
    });
  }

  async createVideoNodeFromBlob(blob, title = 'Vídeo', x = 200, y = 200, { select = true, undo = true, mediaId = null } = {}) {
    this.app.setStatus(`Carregando vídeo "${title}"...`);
    const id = await this.app.storage.media.put(blob, mediaId || undefined);
    const url = await this.app.storage.media.urlFor(id);
    const dims = await new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => resolve({ w: v.videoWidth || 640, h: v.videoHeight || 360, ok: true });
      v.onerror = () => resolve({ w: 640, h: 360, ok: false });
      v.src = url;
    });
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(dims.w, dims.h));
    const node = this.createNode(
      {
        type: 'video',
        title,
        mediaId: id,
        mime: blob.type || '',
        loop: true,
        naturalWidth: dims.w,
        naturalHeight: dims.h,
        x,
        y,
        width: Math.max(160, Math.round(dims.w * scale)),
        height: Math.max(90, Math.round(dims.h * scale)) + 26
      },
      undo
    );
    if (select) this.selectNode(node.id, false);
    this.app.setStatus(
      dims.ok
        ? `Vídeo "${title}" adicionado (${(blob.size / 1048576).toFixed(1)} MB). Duplo clique no vídeo = play/pause.`
        : `O navegador não conseguiu ler "${title}" (formato/codec não suportado?). Prefira MP4 com H.264.`
    );
    return node;
  }

  async createAudioNodeFromDataUrl(dataUrl, title = 'Som', x = 250, y = 250, initialMarkers = [], { select = true, undo = true } = {}) {
    this.app.setStatus(`Processando onda sonora (Waveform) de "${title}"...`);
    const { peaks, duration } = await this.app.audioEngine.extractPeaksFromDataUrl(dataUrl);

    const node = this.createNode({
      type: 'audio',
      title,
      src: dataUrl,
      peaks,
      duration,
      markers: initialMarkers,
      x,
      y,
      width: 350,
      height: 165
    }, undo);
    if (select) this.selectNode(node.id, false);
    this.app.setStatus(`Áudio "${title}" pronto! Clique em "+ Pin" para marcar pontos no som e conectar setas.`);
    return node;
  }

  duplicateSelected() {
    const selected = this.getSelectedNodes();
    if (selected.length === 0) return;
    this.app.pushUndoState();
    this.clearSelection();

    for (const orig of selected) {
      const cloneCfg = JSON.parse(JSON.stringify(orig));
      delete cloneCfg.id;
      // A cópia mora na mesma pasta, mas um frame copiado vira frame comum
      cloneCfg.frameFolderId = null;
      cloneCfg.file = null;
      cloneCfg.fileTitle = null;
      cloneCfg.x += 28;
      cloneCfg.y += 28;
      cloneCfg.zIndex = ++this.nextZIndex;
      const created = this.createNode(cloneCfg, false);
      this.selectedIds.add(created.id);
    }
    this.syncSelectionClasses();
    this.app.updateContextBar();
    this.app.storage.scheduleAutoSave();
  }

  deleteSelected() {
    if (this.app.connectionsDrawing.selectedConnectionId) {
      this.app.pushUndoState();
      this.app.state.connections.delete(this.app.connectionsDrawing.selectedConnectionId);
      this.app.connectionsDrawing.selectedConnectionId = null;
      this.app.connectionsDrawing.renderAllConnections();
      this.app.updateContextBar();
      this.app.storage.scheduleAutoSave();
      return;
    }

    const selected = this.getSelectedNodes().filter((n) => !n.locked);
    if (selected.length === 0) return;
    this.app.pushUndoState();

    const fm = this.app.foldersManager;
    // Apagar o frame de uma pasta = desagrupar (os itens nunca são apagados junto)
    for (const n of selected.filter((x) => fm.isFolderFrame(x))) {
      fm.ungroup(n.frameFolderId, { undo: false, refresh: false });
    }
    for (const n of selected) {
      if (this.app.state.nodes.has(n.id)) this.removeNode(n.id);
    }

    this.selectedIds.clear();
    fm.afterChange();
  }

  removeNode(id) {
    const n = this.app.state.nodes.get(id);
    if (!n) return;
    if (n.type === 'textblocks') this.app.textBlocks.destroy(id);
    if (n.type === 'audio') this.app.audioEngine.stopAndCleanupNode(id);
    this.app.state.nodes.delete(id);
    this.selectedIds.delete(id);
    const el = this.nodesLayer.querySelector(`.canvas-node[data-id="${id}"]`);
    if (el) el.remove();
    // Remove conexões ligadas a este nó
    for (const [cid, conn] of this.app.state.connections.entries()) {
      if (conn.from === id || conn.to === id) this.app.state.connections.delete(cid);
    }
  }

  bringToFront() {
    const selected = this.getSelectedNodes();
    for (const n of selected) {
      n.zIndex = ++this.nextZIndex;
      this.updateNodeElementTransform(n);
    }
    this.app.storage.scheduleAutoSave();
  }

  sendToBack() {
    const selected = this.getSelectedNodes();
    for (const n of selected) {
      n.zIndex = 2;
      this.updateNodeElementTransform(n);
    }
    this.app.storage.scheduleAutoSave();
  }

  toggleLockSelected() {
    const selected = this.getSelectedNodes();
    for (const n of selected) {
      n.locked = !n.locked;
      this.updateNodeElementTransform(n);
    }
    this.app.updateContextBar();
    this.app.storage.scheduleAutoSave();
  }
}
