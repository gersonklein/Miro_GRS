// js/storage.js
// Persistência IndexedDB, Exportar/Importar Projeto (.mirogrs) e Snapshot PNG

import { montarTextoDoJson } from './text-blocks-format.js';
import { MediaStore, MEDIA_STORE, blobToDataUrl, dataUrlToBlob } from './media-store.js';

const DB_NAME = 'MiroGRS_Studio_DB';
const DB_VERSION = 3;
const STORE_NAME = 'boards';
const HANDLES_STORE = 'handles'; // pasta do disco vinculada a cada projeto
const CURRENT_KEY = 'mirogrs.currentProject';

export class StorageManager {
  constructor(app) {
    this.app = app;
    this.db = null;
    this.saveTimer = null;
    this.media = new MediaStore(this);
    this.currentProjectId = 'default_board';
    try {
      this.currentProjectId = localStorage.getItem(CURRENT_KEY) || 'default_board';
    } catch {}
  }

  setCurrentProjectId(id) {
    this.currentProjectId = id;
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {}
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(HANDLES_STORE)) {
          db.createObjectStore(HANDLES_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          db.createObjectStore(MEDIA_STORE, { keyPath: 'id' }); // vídeos (Blob)
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        // Outra aba com uma versão mais nova do app precisa atualizar o banco:
        // esta aba solta a conexão em vez de travar a outra para sempre.
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.app.setStatus('O Miro_GRS foi atualizado em outra aba — recarregue esta página (F5).');
        };
        resolve(this.db);
      };
      // Uma aba antiga ainda está com o banco aberto (ex.: versão anterior do app)
      req.onblocked = () => {
        this.app.setStatus('⚠ Feche as outras abas do Miro_GRS (versão antiga aberta) para terminar de carregar.');
      };
      req.onerror = (err) => reject(err);
    });
  }

  // silent: mudança que não precisa ir para o disco (ex.: mover a câmera)
  scheduleAutoSave({ silent = false } = {}) {
    if (!silent && !this.app.isLoading) this.app.projectFs?.markDirty();
    if (!silent && !this.app.isLoading) this.app.projectPanel?.scheduleRender();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveCurrentBoard();
    }, 600);
  }

  serializeBoard() {
    this.app.textBlocks?.flushAll();
    return {
      id: this.currentProjectId,
      version: '2.0.0',
      updatedAt: new Date().toISOString(),
      title: document.getElementById('board-title')?.value || 'Meu Quadro Criativo',
      camera: {
        panX: this.app.canvasEngine.panX,
        panY: this.app.canvasEngine.panY,
        scale: this.app.canvasEngine.scale,
        gridStyle: this.app.canvasEngine.gridStyle
      },
      palette: this.app.pureRefTools.savedColors,
      folders: this.app.foldersManager.serialize(),
      nodes: Array.from(this.app.state.nodes.values()),
      connections: Array.from(this.app.state.connections.values()),
      drawings: Array.from(this.app.state.drawings.values())
    };
  }

  tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      const st = t.objectStore(store);
      const req = fn(st);
      t.oncomplete = () => resolve(req?.result);
      t.onerror = (err) => reject(err);
    });
  }

  async saveCurrentBoard() {
    if (!this.db) return;
    const data = this.serializeBoard();
    return this.tx(STORE_NAME, 'readwrite', (st) => st.put(data));
  }

  async loadSavedBoard(id = this.currentProjectId) {
    if (!this.db) await this.initDB();
    try {
      return (await this.tx(STORE_NAME, 'readonly', (st) => st.get(id))) || null;
    } catch {
      return null;
    }
  }

  async listProjects() {
    if (!this.db) await this.initDB();
    const boards = (await this.tx(STORE_NAME, 'readonly', (st) => st.getAll())) || [];
    const handles = (await this.tx(HANDLES_STORE, 'readonly', (st) => st.getAll())) || [];
    const hmap = new Map(handles.map((h) => [h.id, h]));
    return boards
      .map((b) => ({
        id: b.id,
        title: b.title || 'Sem nome',
        updatedAt: b.updatedAt || '',
        count: (b.nodes || []).length,
        folders: (b.folders || []).length,
        dirName: hmap.get(b.id)?.dirName || '',
        handle: hmap.get(b.id)?.handle || null
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async deleteProject(id) {
    await this.tx(STORE_NAME, 'readwrite', (st) => st.delete(id));
    await this.tx(HANDLES_STORE, 'readwrite', (st) => st.delete(id));
  }

  async saveHandle(projectId, rec) {
    if (!this.db) return;
    try {
      await this.tx(HANDLES_STORE, 'readwrite', (st) => st.put({ id: projectId, ...rec }));
    } catch (err) {
      console.warn('Não foi possível guardar o vínculo da pasta', err);
    }
  }

  async getHandle(projectId) {
    if (!this.db) return null;
    try {
      return (await this.tx(HANDLES_STORE, 'readonly', (st) => st.get(projectId))) || null;
    } catch {
      return null;
    }
  }

  async removeHandle(projectId) {
    await this.tx(HANDLES_STORE, 'readwrite', (st) => st.delete(projectId));
  }

  async exportProjectFile() {
    const data = this.serializeBoard();
    // Vídeos vão embutidos no arquivo único (base64) para o .mirogrs abrir em outro PC
    const vids = data.nodes.filter((n) => ['video', 'audio', 'image'].includes(n.type) && n.mediaId);
    if (vids.length) this.app.setStatus('Embutindo vídeos no arquivo .mirogrs...');
    data.nodes = await Promise.all(
      data.nodes.map(async (n) => {
        if (!['video', 'audio', 'image'].includes(n.type) || !n.mediaId) return n;
        const blob = await this.media.getBlob(n.mediaId);
        if (!blob) throw new Error(`Arquivo original não encontrado: ${n.title || n.id}`);
        return { ...n, mediaData: await blobToDataUrl(blob) };
      })
    );
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeTitle = (data.title || 'quadro').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.mirogrs`;
    a.click();
    URL.revokeObjectURL(url);
    this.app.setStatus('Projeto exportado (.mirogrs) com todas as imagens, sons e conexões!');
  }

  async importProjectFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('Formato de arquivo inválido');
      }
      // Vídeos embutidos voltam para o MediaStore
      for (const n of data.nodes) {
        if (n.mediaData) {
          n.mediaId = await this.media.put(await dataUrlToBlob(n.mediaData), undefined, { required: true });
          delete n.mediaData;
        }
      }
      // Abre como um projeto novo (não sobrescreve o projeto atual)
      data.id = 'proj_' + Date.now().toString(36);
      if (!data.title) data.title = file.name.replace(/\.(mirogrs|json)$/i, '');
      await this.app.openProjectData(data, { fit: true });
      this.app.setStatus(`Projeto "${data.title}" importado como novo projeto. Use 💾 para salvar em uma pasta.`);
    } catch (err) {
      this.app.setStatus('Não foi possível abrir o arquivo de projeto: ' + err.message);
    }
  }

  async exportCanvasToPNG() {
    const nodes = Array.from(this.app.state.nodes.values());
    const drawings = Array.from(this.app.state.drawings.values());
    if (nodes.length === 0 && drawings.length === 0) {
      alert('O quadro está vazio!');
      return;
    }

    this.app.setStatus('Gerando imagem PNG de alta definição...');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    for (const d of drawings) {
      for (const pt of d.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }

    const pad = 60;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const width = Math.min(4096, Math.max(400, Math.round(maxX - minX)));
    const height = Math.min(4096, Math.max(300, Math.round(maxY - minY)));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? '#f3f4f6' : '#14171f';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(-minX, -minY);

    // 1. Desenha traços livres
    for (const d of drawings) {
      if (!d.points || d.points.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = d.color || '#38bdf8';
      ctx.lineWidth = d.width || 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = d.opacity ?? 1;
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i++) {
        ctx.lineTo(d.points[i].x, d.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 2. Desenha conexões
    for (const conn of this.app.state.connections.values()) {
      const pts = this.app.connectionsDrawing.getConnectionEndpoints(conn);
      if (!pts) continue;
      ctx.save();
      ctx.strokeStyle = conn.color || '#38bdf8';
      ctx.lineWidth = conn.width || 2.5;
      ctx.beginPath();
      ctx.moveTo(pts.x1, pts.y1);
      ctx.bezierCurveTo(pts.cx1, pts.cy1, pts.cx2, pts.cy2, pts.x2, pts.y2);
      ctx.stroke();
      if (conn.label) {
        const mx = (pts.x1 + pts.x2) / 2;
        const my = (pts.y1 + pts.y2) / 2;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(mx - 45, my - 11, 90, 22);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(conn.label, mx, my + 4);
      }
      ctx.restore();
    }

    // 3. Desenha nós ordenados por zIndex
    const sorted = [...nodes].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));
    for (const n of sorted) {
      ctx.save();
      ctx.globalAlpha = (n.opacity ?? 100) / 100;
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      ctx.translate(cx, cy);
      if (n.rotation) ctx.rotate((n.rotation * Math.PI) / 180);
      ctx.translate(-n.width / 2, -n.height / 2);

      if (n.type === 'image' && (n.src || n.mediaId)) {
        const original = n.mediaId ? await this.media.getBlob(n.mediaId) : null;
        const imageUrl = original ? URL.createObjectURL(original) : n.src;
        await new Promise((res) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.save();
            if (n.flipH || n.flipV) {
              ctx.translate(n.flipH ? n.width : 0, n.flipV ? n.height : 0);
              ctx.scale(n.flipH ? -1 : 1, n.flipV ? -1 : 1);
            }
            ctx.drawImage(img, 0, 0, n.width, n.height);
            ctx.restore();
            res();
          };
          img.onerror = () => res();
          img.src = imageUrl;
        });
        if (original) URL.revokeObjectURL(imageUrl);
      } else if (n.type === 'video') {
        // Vídeo: quadro atual do player (se já carregou)
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, n.width, n.height);
        const v = document.querySelector(`.canvas-node[data-id="${n.id}"] video`);
        try {
          if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, n.width, n.height - 26);
        } catch {}
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '12px sans-serif';
        ctx.fillText('🎬 ' + (n.title || 'Vídeo').slice(0, 50), 8, n.height - 9);
      } else if (n.type === 'textblocks') {
        // Card de blocos: cabeçalho + parágrafos como faixas coloridas
        ctx.fillStyle = '#1e2436';
        ctx.fillRect(0, 0, n.width, n.height);
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 0, n.width, 30);
        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('📝 ' + (n.title || 'Texto'), 10, 20);
        const paras = montarTextoDoJson(n.blocks).split(/\n\n+/);
        let yy = 44;
        ctx.font = '12px sans-serif';
        for (const p of paras) {
          if (yy > n.height - 14) break;
          const lines = p.split('\n').slice(0, 4);
          const hh = lines.length * 15 + 10;
          ctx.fillStyle = '#5ba58c';
          ctx.fillRect(12, yy - 12, n.width - 24, hh);
          ctx.fillStyle = '#ffffff';
          lines.forEach((l, i) => ctx.fillText(l.slice(0, 60), 20, yy + 4 + i * 15));
          yy += hh + 6;
        }
      } else {
        ctx.fillStyle = n.fill || (n.type === 'audio' ? '#1e2436' : '#fef08a');
        ctx.strokeStyle = n.stroke || '#38bdf8';
        ctx.lineWidth = 2;
        ctx.fillRect(0, 0, n.width, n.height);
        if (n.type !== 'sticky') ctx.strokeRect(0, 0, n.width, n.height);

        ctx.fillStyle = n.type === 'sticky' ? '#1e293b' : '#f1f5f9';
        ctx.font = `${n.fontSize || 16}px sans-serif`;
        const text = (n.text || n.title || '').replace(/<[^>]+>/g, '');
        ctx.fillText(text.slice(0, 45), 14, 32);
      }
      ctx.restore();
    }

    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'miro_grs_board.png';
      a.click();
      URL.revokeObjectURL(url);
      this.app.setStatus('Imagem PNG exportada com sucesso!');
    });
  }
}
