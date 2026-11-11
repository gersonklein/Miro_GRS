// js/canvas-engine.js
// Motor de Canvas Infinito: Pan, Zoom na posição do cursor, Grid Dinâmico e Mini-mapa

export class CanvasEngine {
  constructor(app) {
    this.app = app;
    this.viewport = document.getElementById('viewport');
    this.world = document.getElementById('world');
    this.gridCanvas = document.getElementById('grid-canvas');
    this.gridCtx = this.gridCanvas.getContext('2d');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.panX = window.innerWidth * 0.15;
    this.panY = window.innerHeight * 0.15;
    this.scale = 1;
    this.minScale = 0.08;
    this.maxScale = 8;

    // 'dots' | 'lines' | 'none'
    this.gridStyle = 'dots';
    this.previousView = null; // Usado pelo foco rápido estilo PureRef

    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    this.initResize();
    this.initMinimapNavigation();
    this.updateTransform();
  }

  initResize() {
    const onResize = () => {
      const dpr = window.devicePixelRatio || 1;
      this.gridCanvas.width = window.innerWidth * dpr;
      this.gridCanvas.height = window.innerHeight * dpr;
      this.gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.renderGrid();
      this.renderMinimap();
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  initMinimapNavigation() {
    let draggingMinimap = false;
    const jumpToMinimapPos = (e) => {
      if (!this.minimapBounds) return;
      const rect = this.minimapCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { minX, minY, scaleM, offsetX, offsetY } = this.minimapBounds;
      const worldX = (mx - offsetX) / scaleM + minX;
      const worldY = (my - offsetY) / scaleM + minY;
      this.centerOn(worldX, worldY);
    };

    this.minimapCanvas.addEventListener('mousedown', (e) => {
      draggingMinimap = true;
      jumpToMinimapPos(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (draggingMinimap) jumpToMinimapPos(e);
    });
    window.addEventListener('mouseup', () => {
      draggingMinimap = false;
    });
  }

  screenToWorld(clientX, clientY) {
    return {
      x: (clientX - this.panX) / this.scale,
      y: (clientY - this.panY) / this.scale
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.scale + this.panX,
      y: worldY * this.scale + this.panY
    };
  }

  updateTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    const readout = document.getElementById('btn-zoom-reset');
    if (readout) {
      readout.textContent = `${Math.round(this.scale * 100)}%`;
    }
    if (!this.transformFrame) this.transformFrame = requestAnimationFrame(() => {
      this.transformFrame = null;
      this.renderGrid();
      this.renderMinimap();
      this.app.nodesManager?.refreshVisible();
      this.app.textBlocks?.syncAll();
    });
  }

  zoomAt(clientX, clientY, zoomFactor) {
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * zoomFactor));
    const worldPos = this.screenToWorld(clientX, clientY);
    this.scale = newScale;
    this.panX = clientX - worldPos.x * this.scale;
    this.panY = clientY - worldPos.y * this.scale;
    this.updateTransform();
  }

  setZoom(newScale, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2) {
    const factor = newScale / this.scale;
    this.zoomAt(centerX, centerY, factor);
  }

  centerOn(worldX, worldY, targetScale = this.scale) {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, targetScale));
    this.panX = window.innerWidth / 2 - worldX * this.scale;
    this.panY = window.innerHeight / 2 - worldY * this.scale;
    this.updateTransform();
  }

  cycleGridStyle() {
    const styles = ['dots', 'lines', 'none'];
    const idx = (styles.indexOf(this.gridStyle) + 1) % styles.length;
    this.gridStyle = styles[idx];
    this.renderGrid();
    const names = { dots: 'Pontos', lines: 'Grade em Linhas', none: 'Fundo Liso (PureRef)' };
    this.app.setStatus(`Fundo alterado para: ${names[this.gridStyle]}`);
  }

  renderGrid() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.gridCtx;
    ctx.clearRect(0, 0, w, h);

    if (this.gridStyle === 'none') return;

    let step = 28 * this.scale;
    while (step < 14) step *= 2;
    while (step > 90) step /= 2;

    const offsetX = ((this.panX % step) + step) % step;
    const offsetY = ((this.panY % step) + step) % step;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    if (this.gridStyle === 'dots') {
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.22)' : 'rgba(255, 255, 255, 0.14)';
      const dotSize = Math.max(1.2, Math.min(2.2, this.scale * 1.4));
      for (let x = offsetX; x < w; x += step) {
        for (let y = offsetY; y < h; y += step) {
          ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
        }
      }
    } else if (this.gridStyle === 'lines') {
      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = offsetX; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = offsetY; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
  }

  fitBounds(bounds, padding = 90) {
    if (!bounds) return;
    const bw = Math.max(100, bounds.maxX - bounds.minX);
    const bh = Math.max(100, bounds.maxY - bounds.minY);
    // Desconta a área coberta pelo painel Project (quando aberto)
    const panel = document.getElementById('project-panel');
    const inset = panel && !panel.classList.contains('hidden') && !document.body.classList.contains('focus-mode')
      ? panel.getBoundingClientRect().right
      : 0;
    const availW = window.innerWidth - inset - padding * 2;
    const availH = window.innerHeight - padding * 2;
    const targetScale = Math.min(2.5, Math.max(this.minScale, Math.min(availW / bw, availH / bh)));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.centerOn(cx, cy, targetScale);
    if (inset) {
      this.panX += inset / 2;
      this.updateTransform();
    }
  }

  fitAllOrSelection() {
    const nodes = this.app.nodesManager.getSelectedNodes();
    const targetList = nodes.length > 0 ? nodes : Array.from(this.app.state.nodes.values());
    if (targetList.length === 0) {
      this.centerOn(400, 300, 1);
      return;
    }

    // Se for um único item e já estivermos focados nele, alterna para visão anterior (estilo PureRef)
    if (nodes.length === 1 && this.previousView && this.previousView.focusedId === nodes[0].id) {
      this.panX = this.previousView.panX;
      this.panY = this.previousView.panY;
      this.scale = this.previousView.scale;
      this.previousView = null;
      this.updateTransform();
      return;
    }

    if (nodes.length === 1) {
      this.previousView = {
        focusedId: nodes[0].id,
        panX: this.panX,
        panY: this.panY,
        scale: this.scale
      };
    } else {
      this.previousView = null;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of targetList) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    this.fitBounds({ minX, minY, maxX, maxY });
  }

  renderMinimap() {
    if (this.minimapFrame) return;
    this.minimapFrame = requestAnimationFrame(() => {
      this.minimapFrame = null;
      this.drawMinimap();
    });
  }

  drawMinimap() {
    if (!this.app || !this.app.state) return;
    const ctx = this.minimapCtx;
    const mw = this.minimapCanvas.width;
    const mh = this.minimapCanvas.height;
    ctx.clearRect(0, 0, mw, mh);

    const nodes = Array.from(this.app.state.nodes.values());
    const viewTL = this.screenToWorld(0, 0);
    const viewBR = this.screenToWorld(window.innerWidth, window.innerHeight);

    let minX = viewTL.x, minY = viewTL.y, maxX = viewBR.x, maxY = viewBR.y;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    const pad = 200;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = Math.max(100, maxX - minX);
    const worldH = Math.max(100, maxY - minY);
    const scaleM = Math.min(mw / worldW, mh / worldH);
    const offsetX = (mw - worldW * scaleM) / 2;
    const offsetY = (mh - worldH * scaleM) / 2;

    this.minimapBounds = { minX, minY, scaleM, offsetX, offsetY };

    for (const n of nodes) {
      const rx = offsetX + (n.x - minX) * scaleM;
      const ry = offsetY + (n.y - minY) * scaleM;
      const rw = Math.max(2, n.width * scaleM);
      const rh = Math.max(2, n.height * scaleM);

      if (n.type === 'image') ctx.fillStyle = '#38bdf8';
      else if (n.type === 'audio') ctx.fillStyle = '#f43f5e';
      else if (n.type === 'sticky') ctx.fillStyle = n.fill || '#fef08a';
      else ctx.fillStyle = '#818cf8';

      ctx.fillRect(rx, ry, rw, rh);
    }

    // Retângulo da Viewport Atual
    const vx = offsetX + (viewTL.x - minX) * scaleM;
    const vy = offsetY + (viewTL.y - minY) * scaleM;
    const vw = (viewBR.x - viewTL.x) * scaleM;
    const vh = (viewBR.y - viewTL.y) * scaleM;

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
  }
}
