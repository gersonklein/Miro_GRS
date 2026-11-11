// js/media-store.js
// Arquivos grandes (vídeos) ficam como Blob binário num store próprio do IndexedDB.
// O item no canvas guarda só `mediaId`: assim o estado do board, os snapshots de
// Desfazer e o backup não carregam dezenas de MB de base64 a cada mudança.
// Um Blob é imutável: cada mediaId sempre aponta para o mesmo conteúdo.

export const MEDIA_STORE = 'media';

export class MediaStore {
  constructor(storage) {
    this.storage = storage;
    this.cache = new Map(); // mediaId -> { blob, url }
  }

  newId() {
    return 'med_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e8).toString(36);
  }

  async put(blob, id = this.newId(), { required = false } = {}) {
    try {
      await this.storage.tx(MEDIA_STORE, 'readwrite', (st) => st.put({ id, blob, type: blob.type, size: blob.size }));
    } catch (err) {
      console.warn('Não foi possível guardar o vídeo no navegador (cota cheia?)', err);
      if (required) {
        const entry = this.cache.get(id);
        if (entry) URL.revokeObjectURL(entry.url);
        this.cache.delete(id);
        throw err;
      }
      this.remember(id, blob);
    }
    return id;
  }

  remember(id, blob) {
    const old = this.cache.get(id);
    if (old && old.blob === blob) return old.url;
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(blob);
    this.cache.set(id, { blob, url });
    return url;
  }

  release(id) {
    const entry = this.cache.get(id);
    if (entry) URL.revokeObjectURL(entry.url);
    this.cache.delete(id);
  }

  async getBlob(id) {
    if (!id) return null;
    const hit = this.cache.get(id);
    if (hit) return hit.blob;
    try {
      const rec = await this.storage.tx(MEDIA_STORE, 'readonly', (st) => st.get(id));
      if (rec?.blob) {
        return rec.blob;
      }
    } catch {}
    return null;
  }

  async urlFor(id) {
    const blob = await this.getBlob(id);
    return blob ? this.remember(id, blob) : null;
  }

  // Apaga do navegador os vídeos que nenhum projeto usa mais
  async collectGarbage() {
    try {
      const boards = (await this.storage.tx('boards', 'readonly', (st) => st.getAll())) || [];
      const used = new Set();
      for (const b of boards) for (const n of b.nodes || []) if (n.mediaId) used.add(n.mediaId);
      for (const n of this.storage.app.state.nodes.values()) if (n.mediaId) used.add(n.mediaId);
      // Deleted media can still be restored by Undo/Redo.
      for (const snapshot of [...(this.storage.app.undoStack || []), ...(this.storage.app.redoStack || [])]) {
        for (const n of snapshot.nodes || []) if (n.mediaId) used.add(n.mediaId);
      }
      const keys = (await this.storage.tx(MEDIA_STORE, 'readonly', (st) => st.getAllKeys())) || [];
      for (const k of keys) {
        if (!used.has(k)) await this.storage.tx(MEDIA_STORE, 'readwrite', (st) => st.delete(k));
      }
    } catch (err) {
      console.warn('Limpeza de mídia falhou', err);
    }
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(src) {
  return (await fetch(src)).blob();
}

export const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv'];
export const VIDEO_MIME_EXT = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv'
};
export const VIDEO_EXT_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska' };

export function isVideoFile(file) {
  return (file.type || '').startsWith('video/') || /\.(mp4|m4v|mov|ogv|mkv)$/i.test(file.name || '');
}
