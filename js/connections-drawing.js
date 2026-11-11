// js/connections-drawing.js
// Camada Vetorial SVG: Conectores Inteligentes (Setas Bézier, inclusive ligadas a Marcadores de Áudio) e Desenho Livre

const SVG_OFFSET = 50000;

export class ConnectionsAndDrawing {
  constructor(app) {
    this.app = app;
    this.svgLayer = document.getElementById('svg-layer');
    this.drawingsGroup = document.getElementById('drawings-group');
    this.connectionsGroup = document.getElementById('connections-group');
    this.tempPath = document.getElementById('temp-connection-path');

    this.selectedConnectionId = null;
    this.draggingConn = null; // { fromNodeId, fromAnchor }
    this.activeDrawing = null;
  }

  // Calcula a coordenada exata no espaço do mundo de uma âncora (top, right, bottom, left ou marker:id)
  getAnchorWorldPoint(nodeId, anchor = 'right') {
    const node = this.app.state.nodes.get(nodeId);
    if (!node) return null;

    // Se a conexão partir de um Marcador de Tempo dentro de um Card de Áudio!
    if (anchor && anchor.startsWith('marker:')) {
      const markerId = anchor.split(':')[1];
      const marker = (node.markers || []).find((m) => m.id === markerId);
      const dur = node.duration || 5;
      const ratio = marker ? Math.max(0.02, Math.min(0.98, marker.time / dur)) : 0.5;
      const waveLeft = node.x + 12;
      const waveWidth = Math.max(100, node.width - 24);
      return {
        x: waveLeft + waveWidth * ratio,
        y: node.y + 42,
        dirX: 0,
        dirY: -1
      };
    }

    switch (anchor) {
      case 'top':
        return { x: node.x + node.width / 2, y: node.y, dirX: 0, dirY: -1 };
      case 'bottom':
        return { x: node.x + node.width / 2, y: node.y + node.height, dirX: 0, dirY: 1 };
      case 'left':
        return { x: node.x, y: node.y + node.height / 2, dirX: -1, dirY: 0 };
      case 'right':
      default:
        return { x: node.x + node.width, y: node.y + node.height / 2, dirX: 1, dirY: 0 };
    }
  }

  // Escolhe automaticamente as melhores portas de saída/entrada caso o usuário conecte pelo corpo do nó
  resolveBestAnchors(fromNode, toNode, fromAnchor, toAnchor) {
    let a1 = fromAnchor;
    let a2 = toAnchor;

    const c1x = fromNode.x + fromNode.width / 2;
    const c1y = fromNode.y + fromNode.height / 2;
    const c2x = toNode.x + toNode.width / 2;
    const c2y = toNode.y + toNode.height / 2;
    const dx = c2x - c1x;
    const dy = c2y - c1y;

    if (!a1 || a1 === 'auto') {
      if (Math.abs(dx) > Math.abs(dy)) a1 = dx > 0 ? 'right' : 'left';
      else a1 = dy > 0 ? 'bottom' : 'top';
    }
    if (!a2 || a2 === 'auto') {
      if (Math.abs(dx) > Math.abs(dy)) a2 = dx > 0 ? 'left' : 'right';
      else a2 = dy > 0 ? 'top' : 'bottom';
    }
    return { a1, a2 };
  }

  getConnectionEndpoints(conn) {
    const n1 = this.app.state.nodes.get(conn.from);
    const n2 = this.app.state.nodes.get(conn.to);
    if (!n1 || !n2) return null;

    const { a1, a2 } = this.resolveBestAnchors(n1, n2, conn.fromAnchor, conn.toAnchor);
    const p1 = this.getAnchorWorldPoint(conn.from, a1);
    const p2 = this.getAnchorWorldPoint(conn.to, a2);
    if (!p1 || !p2) return null;

    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const curveTension = Math.min(180, Math.max(45, dist * 0.4));

    return {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      cx1: p1.x + p1.dirX * curveTension,
      cy1: p1.y + p1.dirY * curveTension,
      cx2: p2.x + p2.dirX * curveTension,
      cy2: p2.y + p2.dirY * curveTension
    };
  }

  startConnectionDrag(fromNodeId, fromAnchor = 'auto', startEvent) {
    this.draggingConn = { fromNodeId, fromAnchor };
    this.tempPath.classList.remove('hidden');

    const onMove = (e) => {
      if (!this.draggingConn) return;
      const worldPt = this.app.canvasEngine.screenToWorld(e.clientX, e.clientY);
      const n1 = this.app.state.nodes.get(fromNodeId);
      if (!n1) return;

      const p1 =
        fromAnchor && fromAnchor !== 'auto'
          ? this.getAnchorWorldPoint(fromNodeId, fromAnchor)
          : { x: n1.x + n1.width / 2, y: n1.y + n1.height / 2, dirX: 1, dirY: 0 };

      const sx1 = p1.x + SVG_OFFSET;
      const sy1 = p1.y + SVG_OFFSET;
      const sx2 = worldPt.x + SVG_OFFSET;
      const sy2 = worldPt.y + SVG_OFFSET;
      const dx = (sx2 - sx1) * 0.45;

      this.tempPath.setAttribute('d', `M ${sx1} ${sy1} C ${sx1 + dx} ${sy1}, ${sx2 - dx} ${sy2}, ${sx2} ${sy2}`);
    };

    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.tempPath.classList.add('hidden');

      if (!this.draggingConn) return;
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = targetEl?.closest('.canvas-node');
      const portEl = targetEl?.closest('[data-port-anchor]');

      if (nodeEl) {
        const toNodeId = nodeEl.dataset.id;
        const toAnchor = portEl ? portEl.dataset.portAnchor : 'auto';
        if (toNodeId && toNodeId !== this.draggingConn.fromNodeId) {
          this.createConnection({
            from: this.draggingConn.fromNodeId,
            to: toNodeId,
            fromAnchor: this.draggingConn.fromAnchor,
            toAnchor,
            color: document.getElementById('ctx-fill-color')?.value || '#38bdf8',
            label: ''
          });
        }
      }
      this.draggingConn = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    if (startEvent) onMove(startEvent);
  }

  createConnection(connData) {
    this.app.pushUndoState();
    const id = connData.id || 'conn_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    const conn = {
      id,
      from: connData.from,
      to: connData.to,
      fromAnchor: connData.fromAnchor || 'auto',
      toAnchor: connData.toAnchor || 'auto',
      color: connData.color || '#38bdf8',
      width: connData.width || 2.5,
      label: connData.label || ''
    };
    this.app.state.connections.set(id, conn);
    this.renderAllConnections();
    this.app.storage.scheduleAutoSave();
    this.app.setStatus('Conexão criada! Dê duplo clique na linha para adicionar um rótulo ou clique para excluir.');
    return conn;
  }

  renderAllConnections() {
    this.connectionsGroup.innerHTML = '';
    this.connectionElements = new Map();
    this.connectionsByNode = new Map();

    for (const conn of this.app.state.connections.values()) {
      const pts = this.getConnectionEndpoints(conn);
      if (!pts) continue;

      const sx1 = pts.x1 + SVG_OFFSET;
      const sy1 = pts.y1 + SVG_OFFSET;
      const sx2 = pts.x2 + SVG_OFFSET;
      const sy2 = pts.y2 + SVG_OFFSET;
      const scx1 = pts.cx1 + SVG_OFFSET;
      const scy1 = pts.cy1 + SVG_OFFSET;
      const scx2 = pts.cx2 + SVG_OFFSET;
      const scy2 = pts.cy2 + SVG_OFFSET;

      const d = `M ${sx1} ${sy1} C ${scx1} ${scy1}, ${scx2} ${scy2}, ${sx2} ${sy2}`;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `connection-item ${this.selectedConnectionId === conn.id ? 'selected' : ''}`);
      g.dataset.connId = conn.id;

      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('class', 'conn-hit');
      hitPath.setAttribute('d', d);

      const visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      visPath.setAttribute('class', 'conn-visible');
      visPath.setAttribute('d', d);
      visPath.setAttribute('fill', 'none');
      visPath.setAttribute('stroke', conn.color || '#38bdf8');
      visPath.setAttribute('stroke-width', String(conn.width || 2.5));
      visPath.setAttribute('marker-start', 'url(#dot-start)');
      visPath.setAttribute('marker-end', 'url(#arrow-end)');

      g.appendChild(hitPath);
      g.appendChild(visPath);

      // Rótulo no ponto médio da curva Bézier
      if (conn.label) {
        const mx = 0.125 * sx1 + 0.375 * scx1 + 0.375 * scx2 + 0.125 * sx2;
        const my = 0.125 * sy1 + 0.375 * scy1 + 0.375 * scy2 + 0.125 * sy2;
        const textWidth = Math.max(48, conn.label.length * 7.5 + 16);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'conn-label-bg');
        rect.setAttribute('x', String(mx - textWidth / 2));
        rect.setAttribute('y', String(my - 11));
        rect.setAttribute('width', String(textWidth));
        rect.setAttribute('height', '22');

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('class', 'conn-label-text');
        txt.setAttribute('x', String(mx));
        txt.setAttribute('y', String(my));
        txt.textContent = conn.label;

        g.appendChild(rect);
        g.appendChild(txt);
      }

      g.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (this.app.currentTool === 'eraser') {
          this.app.pushUndoState();
          this.app.state.connections.delete(conn.id);
          this.renderAllConnections();
          this.app.storage.scheduleAutoSave();
          return;
        }
        this.app.nodesManager.clearSelection();
        this.selectedConnectionId = conn.id;
        this.renderAllConnections();
        this.app.updateContextBar();
      });

      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newLabel = prompt('Texto/Rótulo da Conexão:', conn.label || '');
        if (newLabel !== null) {
          this.app.pushUndoState();
          conn.label = newLabel.trim();
          this.renderAllConnections();
          this.app.storage.scheduleAutoSave();
        }
      });

      this.connectionsGroup.appendChild(g);
      this.connectionElements.set(conn.id, g);
      for (const id of [conn.from, conn.to]) {
        if (!this.connectionsByNode.has(id)) this.connectionsByNode.set(id, new Set());
        this.connectionsByNode.get(id).add(conn.id);
      }
    }
  }

  scheduleNodeConnections(nodes) {
    this.dirtyNodes ||= new Set();
    for (const n of nodes) this.dirtyNodes.add(n.id);
    if (this.connectionFrame) return;
    this.connectionFrame = requestAnimationFrame(() => {
      this.connectionFrame = null;
      const ids = new Set();
      for (const id of this.dirtyNodes) for (const cid of this.connectionsByNode?.get(id) || []) ids.add(cid);
      this.dirtyNodes.clear();
      for (const id of ids) {
        const conn = this.app.state.connections.get(id);
        const g = this.connectionElements?.get(id);
        const p = conn && this.getConnectionEndpoints(conn);
        if (!g || !p) continue;
        const d = `M ${p.x1 + SVG_OFFSET} ${p.y1 + SVG_OFFSET} C ${p.cx1 + SVG_OFFSET} ${p.cy1 + SVG_OFFSET}, ${p.cx2 + SVG_OFFSET} ${p.cy2 + SVG_OFFSET}, ${p.x2 + SVG_OFFSET} ${p.y2 + SVG_OFFSET}`;
        for (const path of g.querySelectorAll('path')) path.setAttribute('d', d);
        const x = (p.x1 + 3 * p.cx1 + 3 * p.cx2 + p.x2) / 8 + SVG_OFFSET;
        const y = (p.y1 + 3 * p.cy1 + 3 * p.cy2 + p.y2) / 8 + SVG_OFFSET;
        const text = g.querySelector('text'), rect = g.querySelector('rect');
        if (text) { text.setAttribute('x', x); text.setAttribute('y', y); }
        if (rect) { rect.setAttribute('x', x - Number(rect.getAttribute('width')) / 2); rect.setAttribute('y', y - 11); }
      }
    });
  }

  // DESENHO LIVRE (CANETA / MARCA-TEXTO) E BORRACHA
  startFreehandStroke(worldPt, isHighlighter = false) {
    this.app.pushUndoState();
    const id = 'draw_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    const baseColor = document.getElementById('ctx-fill-color')?.value || (isHighlighter ? '#facc15' : '#38bdf8');
    const baseWidth = parseInt(document.getElementById('ctx-stroke-width')?.value || '4', 10);

    const strokeObj = {
      id,
      points: [{ x: Math.round(worldPt.x), y: Math.round(worldPt.y) }],
      color: baseColor,
      width: isHighlighter ? Math.max(18, baseWidth * 4) : baseWidth,
      opacity: isHighlighter ? 0.42 : 1
    };

    this.activeDrawing = strokeObj;
    this.app.state.drawings.set(id, strokeObj);
    this.renderAllDrawings();
  }

  appendFreehandPoint(worldPt) {
    if (!this.activeDrawing) return;
    const pts = this.activeDrawing.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(worldPt.x - last.x, worldPt.y - last.y) < 2.5) return;
    pts.push({ x: Math.round(worldPt.x), y: Math.round(worldPt.y) });
    this.renderAllDrawings();
  }

  endFreehandStroke() {
    if (!this.activeDrawing) return;
    this.activeDrawing = null;
    this.app.storage.scheduleAutoSave();
  }

  eraseAtWorldPoint(worldPt, radius = 18) {
    let removed = false;
    for (const [id, d] of this.app.state.drawings.entries()) {
      const hit = d.points.some((p) => Math.hypot(p.x - worldPt.x, p.y - worldPt.y) <= radius);
      if (hit) {
        this.app.state.drawings.delete(id);
        removed = true;
      }
    }
    if (removed) {
      this.renderAllDrawings();
      this.app.storage.scheduleAutoSave();
    }
  }

  pointsToSvgPath(points) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) {
      const x = points[0].x + SVG_OFFSET;
      const y = points[0].y + SVG_OFFSET;
      return `M ${x} ${y} L ${x + 0.5} ${y + 0.5}`;
    }
    let d = `M ${points[0].x + SVG_OFFSET} ${points[0].y + SVG_OFFSET}`;
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2 + SVG_OFFSET;
      const yc = (points[i].y + points[i + 1].y) / 2 + SVG_OFFSET;
      d += ` Q ${points[i].x + SVG_OFFSET} ${points[i].y + SVG_OFFSET}, ${xc} ${yc}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x + SVG_OFFSET} ${last.y + SVG_OFFSET}`;
    return d;
  }

  renderAllDrawings() {
    this.drawingsGroup.innerHTML = '';
    for (const d of this.app.state.drawings.values()) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'interactive-stroke');
      path.setAttribute('d', this.pointsToSvgPath(d.points));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', d.color || '#38bdf8');
      path.setAttribute('stroke-width', String(d.width || 4));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', String(d.opacity ?? 1));

      path.addEventListener('mousedown', (e) => {
        if (this.app.currentTool === 'eraser') {
          e.stopPropagation();
          this.app.pushUndoState();
          this.app.state.drawings.delete(d.id);
          this.renderAllDrawings();
          this.app.storage.scheduleAutoSave();
        }
      });

      this.drawingsGroup.appendChild(path);
    }
  }
}
