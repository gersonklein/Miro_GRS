// js/pureref-tools.js
// Ferramentas Avançadas Estilo PureRef: Auto-Pack, Grid, Normalizar Escala, Crop Não-Destrutivo, Flip, Grayscale e Conta-Gotas

export class PureRefTools {
  constructor(app) {
    this.app = app;
    this.savedColors = [
      '#38BDF8', '#6366F1', '#F43F5E', '#F59E0B',
      '#10B981', '#A855F7', '#EC4899', '#FEF08A',
      '#E2E8F0', '#94A3B8', '#334155', '#0F172A'
    ];
    this.currentPickedHex = '#38BDF8';
    this.croppingNodeId = null;

    this.initPaletteUI();
  }

  getTargetNodes(onlyImages = false) {
    let list = this.app.nodesManager.getSelectedNodes();
    if (list.length < 2) {
      list = Array.from(this.app.state.nodes.values()).filter((n) => !n.locked);
    }
    if (onlyImages) {
      const imgs = list.filter((n) => n.type === 'image');
      if (imgs.length > 0) return imgs;
    }
    return list.filter((n) => !n.locked);
  }

  // 1. AUTO-PACK (Algoritmo de Empacotamento Retangular Compacto estilo PureRef Ctrl+P)
  packSelectedNodes(gap = 16) {
    const nodes = this.getTargetNodes();
    if (nodes.length < 2) {
      this.app.setStatus('Selecione 2 ou mais elementos (ou tenha múltiplos itens desbloqueados) para empacotar.');
      return;
    }

    this.app.pushUndoState();

    // Ponto de ancoragem inicial (canto superior esquerdo do grupo atual)
    const startX = Math.min(...nodes.map((n) => n.x));
    const startY = Math.min(...nodes.map((n) => n.y));

    // Calcula área total para estimar a largura ideal da caixa de empacotamento
    const totalArea = nodes.reduce((acc, n) => acc + (n.width + gap) * (n.height + gap), 0);
    const maxSingleW = Math.max(...nodes.map((n) => n.width));
    const targetBoxWidth = Math.max(maxSingleW, Math.sqrt(totalArea) * 1.18);

    // Ordena por altura decrescente para otimizar o empacotamento em prateleiras/blocos
    const sorted = [...nodes].sort((a, b) => b.height - a.height);

    // Algoritmo Skyline / Free-Rectangles Packing
    let curX = 0;
    let curY = 0;
    let shelfHeight = 0;

    for (const node of sorted) {
      if (curX > 0 && curX + node.width > targetBoxWidth) {
        curX = 0;
        curY += shelfHeight + gap;
        shelfHeight = 0;
      }
      node.x = Math.round(startX + curX);
      node.y = Math.round(startY + curY);
      curX += node.width + gap;
      shelfHeight = Math.max(shelfHeight, node.height);
      this.app.nodesManager.updateNodeElementTransform(node);
    }

    this.app.connectionsDrawing.renderAllConnections();
    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
    this.app.setStatus(`Auto-Pack PureRef concluído em ${nodes.length} itens!`);
  }

  // 2. ORGANIZAR EM GRADE (GRID)
  arrangeGrid(gap = 20) {
    const nodes = this.getTargetNodes();
    if (nodes.length < 2) return;
    this.app.pushUndoState();

    const cols = Math.ceil(Math.sqrt(nodes.length));
    const startX = Math.min(...nodes.map((n) => n.x));
    const startY = Math.min(...nodes.map((n) => n.y));

    let curX = startX;
    let curY = startY;
    let rowMaxH = 0;

    nodes.forEach((node, idx) => {
      const col = idx % cols;
      if (col === 0 && idx > 0) {
        curX = startX;
        curY += rowMaxH + gap;
        rowMaxH = 0;
      }
      node.x = Math.round(curX);
      node.y = Math.round(curY);
      curX += node.width + gap;
      rowMaxH = Math.max(rowMaxH, node.height);
      this.app.nodesManager.updateNodeElementTransform(node);
    });

    this.app.connectionsDrawing.renderAllConnections();
    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
    this.app.setStatus(`${nodes.length} elementos organizados em Grade (${cols} colunas).`);
  }

  // 3. IGUALAR ALTURA MANTENDO PROPORÇÃO (NORMALIZE HEIGHT - PUREREF)
  normalizeHeight() {
    const nodes = this.getTargetNodes();
    if (nodes.length < 2) {
      this.app.setStatus('Selecione pelo menos 2 itens para igualar a altura.');
      return;
    }
    this.app.pushUndoState();

    const avgHeight = Math.round(nodes.reduce((s, n) => s + n.height, 0) / nodes.length);
    let curX = Math.min(...nodes.map((n) => n.x));
    const baseY = Math.min(...nodes.map((n) => n.y));

    for (const node of nodes) {
      const ratio = node.width / Math.max(1, node.height);
      node.height = avgHeight;
      node.width = Math.round(avgHeight * ratio);
      node.x = curX;
      node.y = baseY;
      curX += node.width + 16;
      this.app.nodesManager.updateNodeElementTransform(node);
    }

    this.app.connectionsDrawing.renderAllConnections();
    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
    this.app.setStatus(`Altura normalizada para ${avgHeight}px mantendo proporção original!`);
  }

  // 4. ALINHAR EM LINHA HORIZONTAL
  alignHorizontal(gap = 18) {
    const nodes = this.getTargetNodes();
    if (nodes.length < 2) return;
    this.app.pushUndoState();

    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    let curX = sorted[0].x;
    const centerY = sorted.reduce((s, n) => s + (n.y + n.height / 2), 0) / sorted.length;

    for (const node of sorted) {
      node.x = Math.round(curX);
      node.y = Math.round(centerY - node.height / 2);
      curX += node.width + gap;
      this.app.nodesManager.updateNodeElementTransform(node);
    }

    this.app.connectionsDrawing.renderAllConnections();
    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
    this.app.setStatus('Elementos alinhados horizontalmente.');
  }

  // 5. MANIPULAÇÃO DE IMAGENS (FLIP H/V, GRAYSCALE, CROP NÃO-DESTRUTIVO)
  toggleFlip(axis = 'h') {
    const selected = this.app.nodesManager.getSelectedNodes();
    if (selected.length === 0) return;
    this.app.pushUndoState();

    for (const n of selected) {
      if (axis === 'h') n.flipH = !n.flipH;
      else n.flipV = !n.flipV;
      this.app.nodesManager.updateNodeElementTransform(n);
    }
    this.app.storage.scheduleAutoSave();
  }

  toggleGrayscale() {
    const selected = this.app.nodesManager.getSelectedNodes();
    if (selected.length === 0) return;
    this.app.pushUndoState();

    for (const n of selected) {
      n.grayscale = !n.grayscale;
      this.app.nodesManager.updateNodeElementTransform(n);
    }
    this.app.storage.scheduleAutoSave();
    this.app.setStatus('Modo Escala de Cinza (Valores PureRef) alternado.');
  }

  toggleCropMode() {
    const selected = this.app.nodesManager.getSelectedNodes();
    if (selected.length !== 1 || selected[0].type !== 'image') {
      this.app.setStatus('Selecione uma única imagem para recortar (Crop).');
      return;
    }
    const node = selected[0];
    const el = document.querySelector(`.canvas-node[data-id="${node.id}"]`);
    if (!el) return;

    const existingOverlay = el.querySelector('.crop-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
      this.croppingNodeId = null;
      return;
    }

    this.croppingNodeId = node.id;
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';
    overlay.innerHTML = `
      <div class="crop-Hint-bar">
        <span>✂️ Arraste na imagem para recortar área</span>
        <button class="ctx-btn" id="btn-cancel-crop">Fechar</button>
      </div>
    `;
    el.appendChild(overlay);

    overlay.querySelector('#btn-cancel-crop').addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
      this.croppingNodeId = null;
    });

    // Arrastar dentro da imagem para definir o retângulo de Crop proporcional (0..1)
    let startPt = null;
    const tempRect = document.createElement('div');
    tempRect.style.cssText = 'position:absolute;border:2px solid #fff;background:rgba(56,189,248,0.28);pointer-events:none;display:none;';
    overlay.appendChild(tempRect);

    overlay.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.stopPropagation();
      const rect = overlay.getBoundingClientRect();
      startPt = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        rect
      };
      tempRect.style.display = 'block';
    });

    const onMove = (e) => {
      if (!startPt) return;
      const curX = Math.max(0, Math.min(1, (e.clientX - startPt.rect.left) / startPt.rect.width));
      const curY = Math.max(0, Math.min(1, (e.clientY - startPt.rect.top) / startPt.rect.height));
      const x1 = Math.min(startPt.x, curX);
      const y1 = Math.min(startPt.y, curY);
      const w = Math.abs(curX - startPt.x);
      const h = Math.abs(curY - startPt.y);

      tempRect.style.left = `${x1 * 100}%`;
      tempRect.style.top = `${y1 * 100}%`;
      tempRect.style.width = `${w * 100}%`;
      tempRect.style.height = `${h * 100}%`;
    };

    const onUp = (e) => {
      if (!startPt) return;
      const curX = Math.max(0, Math.min(1, (e.clientX - startPt.rect.left) / startPt.rect.width));
      const curY = Math.max(0, Math.min(1, (e.clientY - startPt.rect.top) / startPt.rect.height));
      const x1 = Math.min(startPt.x, curX);
      const y1 = Math.min(startPt.y, curY);
      const w = Math.abs(curX - startPt.x);
      const h = Math.abs(curY - startPt.y);
      startPt = null;

      if (w > 0.08 && h > 0.08) {
        this.app.pushUndoState();
        const curCrop = node.crop || { x: 0, y: 0, w: 1, h: 1 };
        node.crop = {
          x: curCrop.x + x1 * curCrop.w,
          y: curCrop.y + y1 * curCrop.h,
          w: curCrop.w * w,
          h: curCrop.h * h
        };
        node.x += Math.round(node.width * x1);
        node.y += Math.round(node.height * y1);
        node.width = Math.max(40, Math.round(node.width * w));
        node.height = Math.max(40, Math.round(node.height * h));
        this.app.nodesManager.updateNodeElementTransform(node);
        this.app.storage.scheduleAutoSave();
        this.app.setStatus('Imagem recortada (não-destrutivo)! Use "Reset Crop" para voltar ao original.');
      }

      overlay.remove();
      this.croppingNodeId = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  resetCrop() {
    const selected = this.app.nodesManager.getSelectedNodes();
    for (const node of selected) {
      if (node.type === 'image' && node.crop) {
        this.app.pushUndoState();
        node.width = Math.round(node.width / node.crop.w);
        node.height = Math.round(node.height / node.crop.h);
        node.crop = null;
        this.app.nodesManager.updateNodeElementTransform(node);
      }
    }
    this.app.storage.scheduleAutoSave();
    this.app.setStatus('Recorte original restaurado!');
  }

  // 6. CONTA-GOTAS / EYEDROPPER & PALETA DE CORES
  initPaletteUI() {
    this.renderPaletteGrid();

    const hexInput = document.getElementById('current-picked-hex');
    if (hexInput) {
      hexInput.addEventListener('click', () => {
        navigator.clipboard?.writeText(hexInput.value);
        this.app.setStatus(`Cor ${hexInput.value} copiada para a área de transferência!`);
      });
    }

    const btnCreateCard = document.getElementById('btn-create-swatch-node');
    if (btnCreateCard) {
      btnCreateCard.addEventListener('click', () => {
        const center = this.app.canvasEngine.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        this.app.nodesManager.createNode({
          type: 'swatch',
          x: center.x - 65,
          y: center.y - 65,
          width: 130,
          height: 135,
          fill: this.currentPickedHex,
          text: this.currentPickedHex
        });
      });
    }
  }

  renderPaletteGrid() {
    const grid = document.getElementById('saved-palette-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const color of this.savedColors) {
      const cell = document.createElement('div');
      cell.className = 'palette-cell';
      cell.style.background = color;
      cell.title = `${color} — Clique p/ selecionar ou aplicar ao item selecionado | Botão direito p/ remover`;

      cell.addEventListener('click', () => {
        this.setPickedColor(color, false);
        const selected = this.app.nodesManager.getSelectedNodes();
        if (selected.length > 0) {
          this.app.pushUndoState();
          for (const n of selected) {
            n.fill = color;
            if (n.type === 'text') n.textColor = color;
            this.app.nodesManager.updateNodeElementTransform(n);
          }
          this.app.storage.scheduleAutoSave();
        }
      });

      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.savedColors = this.savedColors.filter((c) => c !== color);
        this.renderPaletteGrid();
        this.app.storage.scheduleAutoSave();
      });

      grid.appendChild(cell);
    }
  }

  setPickedColor(hex, addToPalette = true) {
    const cleanHex = hex.toUpperCase();
    this.currentPickedHex = cleanHex;
    const box = document.getElementById('current-picked-box');
    const hexIn = document.getElementById('current-picked-hex');
    const rgbEl = document.getElementById('current-picked-rgb');
    const ctxFill = document.getElementById('ctx-fill-color');

    if (box) box.style.background = cleanHex;
    if (hexIn) hexIn.value = cleanHex;
    if (ctxFill) ctxFill.value = cleanHex;

    if (rgbEl) {
      const r = parseInt(cleanHex.slice(1, 3), 16) || 0;
      const g = parseInt(cleanHex.slice(3, 5), 16) || 0;
      const b = parseInt(cleanHex.slice(5, 7), 16) || 0;
      rgbEl.textContent = `rgb(${r}, ${g}, ${b})`;
    }

    if (addToPalette && !this.savedColors.includes(cleanHex)) {
      this.savedColors.unshift(cleanHex);
      if (this.savedColors.length > 28) this.savedColors.pop();
      this.renderPaletteGrid();
      this.app.storage.scheduleAutoSave();
    }
  }

  // Lê a cor exata do pixel sob o cursor (inclusive dentro de imagens do canvas!)
  sampleColorAtScreenPoint(clientX, clientY, commit = false) {
    const loupe = document.getElementById('eyedropper-loupe');
    const loupeCanvas = document.getElementById('loupe-canvas');
    const loupeHex = document.getElementById('loupe-hex');

    loupe.style.left = `${clientX}px`;
    loupe.style.top = `${clientY}px`;

    const worldPt = this.app.canvasEngine.screenToWorld(clientX, clientY);
    const nodes = Array.from(this.app.state.nodes.values()).sort((a, b) => (b.zIndex || 1) - (a.zIndex || 1));

    let sampledHex = '#14171F';
    const lctx = loupeCanvas.getContext('2d');
    lctx.clearRect(0, 0, loupeCanvas.width, loupeCanvas.height);

    for (const node of nodes) {
      if (
        worldPt.x >= node.x &&
        worldPt.x <= node.x + node.width &&
        worldPt.y >= node.y &&
        worldPt.y <= node.y + node.height
      ) {
        if (node.type === 'image') {
          const el = document.querySelector(`.canvas-node[data-id="${node.id}"] img`);
          if (el && el.complete && el.naturalWidth > 0) {
            const relX = (worldPt.x - node.x) / node.width;
            const relY = (worldPt.y - node.y) / node.height;
            const crop = node.crop || { x: 0, y: 0, w: 1, h: 1 };
            const u = crop.x + (node.flipH ? 1 - relX : relX) * crop.w;
            const v = crop.y + (node.flipV ? 1 - relY : relY) * crop.h;
            const px = Math.floor(u * el.naturalWidth);
            const py = Math.floor(v * el.naturalHeight);

            const off = document.createElement('canvas');
            off.width = 11;
            off.height = 11;
            const octx = off.getContext('2d');
            octx.drawImage(el, px - 5, py - 5, 11, 11, 0, 0, 11, 11);
            const data = octx.getImageData(5, 5, 1, 1).data;
            sampledHex =
              '#' +
              [data[0], data[1], data[2]]
                .map((x) => x.toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase();

            // Desenha zoom pixelado na lupa
            lctx.imageSmoothingEnabled = false;
            lctx.drawImage(off, 0, 0, 11, 11, 0, 0, 99, 99);
            lctx.strokeStyle = '#ffffff';
            lctx.lineWidth = 1.5;
            lctx.strokeRect(45, 45, 9, 9);
            break;
          }
        } else {
          sampledHex = (node.fill || '#38BDF8').toUpperCase();
          lctx.fillStyle = sampledHex;
          lctx.fillRect(0, 0, 99, 99);
          break;
        }
      }
    }

    loupeHex.textContent = sampledHex;
    loupeCanvas.style.borderColor = sampledHex;

    if (commit) {
      this.setPickedColor(sampledHex, true);
      document.getElementById('palette-panel').classList.remove('hidden');
      navigator.clipboard?.writeText(sampledHex);
      this.app.setStatus(`Cor ${sampledHex} capturada, salva na paleta e copiada!`);
    }
  }
}
