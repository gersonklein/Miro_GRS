// js/project-fs.js
// Salva o Project em PASTAS REAIS no disco (File System Access API — Chrome/Edge):
//   <pasta do projeto>/project.mirogrs.json   (único arquivo de controle: pastas, posições, setas...)
//   <pasta do projeto>/<Grupo>/<Subgrupo>/.../arquivo.png   (só os elementos, sem arquivos extras)
// Projetos antigos com *.meta.json / _folder.meta.json ainda abrem; esses arquivos somem no próximo save.
// Save incremental: só regrava o que mudou. Itens excluídos vão para _Lixeira/.
// Fallback para outros navegadores: exportar .zip com a mesma estrutura.

import { askChoice } from './ui-dialogs.js';
import { montarTextoDoJson, textoParaBlocosJson } from './text-blocks-format.js';
import { VIDEO_EXT, VIDEO_MIME_EXT, VIDEO_EXT_MIME } from './media-store.js';

export const PROJECT_FILE = 'project.mirogrs.json';
export const FOLDER_META = '_folder.meta.json';
export const UNSORTED_DIR = '_Sem Categoria';
export const TRASH_DIR = '_Lixeira';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'flac', 'aac'];
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/flac': 'flac', 'audio/aac': 'aac'
};
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac'
};
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// ---------- Utilidades ----------
export function sanitizeName(name, fallback = 'item') {
  let s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).trim();
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = '_' + s;
  return s;
}

function splitExt(name) {
  const m = /^(.*?)(\.([a-z0-9]{1,5}))?$/i.exec(name || '');
  return { base: m[1] || '', ext: (m[3] || '').toLowerCase() };
}

function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function basename(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

// Assinatura barata (FNV-1a amostrado) para detectar conteúdo trocado sem guardar cópias
export function signature(str) {
  if (!str) return '0';
  let h = 0x811c9dc5;
  const len = str.length;
  const step = Math.max(1, Math.floor(len / 6000));
  for (let i = 0; i < len; i += step) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= str.charCodeAt(len - 1);
  return `${len.toString(36)}-${(h >>> 0).toString(36)}`;
}

function mimeOfDataUrl(src) {
  const m = /^data:([^;,]+)[;,]/.exec(src || '');
  return m ? m[1].toLowerCase() : '';
}

async function dataUrlToBlob(src) {
  const res = await fetch(src);
  return res.blob();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function textOfNode(n) {
  if (n.type === 'swatch') return `${n.fill || ''}\n`;
  return String(n.text || '');
}

// ---------- Plano de arquivos (usado pelo disco e pelo ZIP) ----------
// Retorna { files: [{path, kind, owner, sig, getContent}], dirs:Set, nodeFiles:Map, folderDirs:Map, projectJson }
// getMediaBlob(mediaId) → Promise<Blob>: lê os vídeos do MediaStore
export function buildDiskPlan(data, { getMediaBlob = null } = {}) {
  const folders = data.folders || [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const usedNames = new Map(); // dir -> Set(lowercase)
  const use = (dir, name) => {
    if (!usedNames.has(dir)) usedNames.set(dir, new Set());
    const set = usedNames.get(dir);
    const { base, ext } = splitExt(name);
    let candidate = name;
    let i = 2;
    while (set.has(candidate.toLowerCase())) {
      candidate = ext ? `${base} (${i}).${ext}` : `${name} (${i})`;
      i++;
    }
    set.add(candidate.toLowerCase());
    return candidate;
  };
  use('', PROJECT_FILE);
  use('', UNSORTED_DIR);
  use('', TRASH_DIR);

  // Caminho de cada pasta (recursivo, sem limite de profundidade)
  const folderDirs = new Map();
  const resolveDir = (id, guard = new Set()) => {
    if (folderDirs.has(id)) return folderDirs.get(id);
    const f = byId.get(id);
    if (!f || guard.has(id)) return '';
    guard.add(id);
    const parentDir = f.parentId && byId.has(f.parentId) ? resolveDir(f.parentId, guard) : '';
    const name = use(parentDir, sanitizeName(f.name, 'Grupo'));
    const dir = joinPath(parentDir, name);
    folderDirs.set(id, dir);
    return dir;
  };
  const sortedFolders = [...folders].sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id));
  for (const f of sortedFolders) resolveDir(f.id);

  const files = [];
  const dirs = new Set(folderDirs.values());
  const nodes = data.nodes || [];
  const frameByFolder = new Map();
  for (const n of nodes) {
    if (n.type === 'shape' && n.shapeType === 'frame' && n.frameFolderId && byId.has(n.frameFolderId)) {
      frameByFolder.set(n.frameFolderId, n);
    }
  }

  const nodeFiles = new Map();
  const outNodes = [];
  const sortedNodes = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const n of sortedNodes) {
    if (frameByFolder.get(n.frameFolderId) === n) {
      outNodes.push({ ...n, src: undefined, file: null });
      continue;
    }
    const dir = n.folderId && folderDirs.has(n.folderId) ? folderDirs.get(n.folderId) : UNSORTED_DIR;

    let ext = '';
    let base = '';
    let kind = 'asset';
    let getContent;
    let sig;
    const isMedia = (n.type === 'image' || n.type === 'audio') && String(n.src || '').startsWith('data:');
    if (isMedia) {
      const fromTitle = splitExt(n.title || '');
      ext = MIME_EXT[mimeOfDataUrl(n.src)] || (IMAGE_EXT.includes(fromTitle.ext) || AUDIO_EXT.includes(fromTitle.ext) ? fromTitle.ext : '') || (n.type === 'image' ? 'png' : 'wav');
      base = sanitizeName(fromTitle.ext ? fromTitle.base : n.title, n.type === 'image' ? 'imagem' : 'som');
      const src = n.src;
      sig = signature(src);
      getContent = () => dataUrlToBlob(src);
    } else if (n.type === 'image' || n.type === 'audio') {
      // Mídia por URL da web: não gera arquivo (a URL fica no project.mirogrs.json)
      kind = 'none';
    } else if (n.type === 'video') {
      if (!n.mediaId || !getMediaBlob) {
        kind = 'none';
      } else {
        const fromTitle = splitExt(n.title || '');
        ext = VIDEO_MIME_EXT[(n.mime || '').toLowerCase()] || (VIDEO_EXT.includes(fromTitle.ext) ? fromTitle.ext : 'mp4');
        base = sanitizeName(fromTitle.ext ? fromTitle.base : n.title, 'video');
        sig = 'media:' + n.mediaId; // Blob imutável: mesmo id = mesmo conteúdo
        const mid = n.mediaId;
        getContent = async () => {
          const b = await getMediaBlob(mid);
          if (!b) throw new Error(`vídeo "${n.title}" não está mais no navegador`);
          return b;
        };
      }
    } else if (n.type === 'textblocks') {
      // Blocos de Texto: o .txt é o texto montado (regra do blocky); os blocos ficam no project.mirogrs.json
      ext = 'txt';
      base = sanitizeName(n.title, 'Texto');
      const text = montarTextoDoJson(n.blocks);
      sig = signature(text) + ':' + text.length;
      getContent = () => text;
    } else {
      ext = 'md';
      const firstLine = textOfNode(n).split('\n').find((l) => l.trim()) || '';
      const prefix = n.type === 'sticky' ? 'postit' : n.type === 'text' ? 'texto' : n.type === 'swatch' ? 'cor' : 'forma';
      base = n.title && String(n.title).trim()
        ? sanitizeName(n.title, prefix)
        : sanitizeName(firstLine.slice(0, 40) ? `${prefix} - ${firstLine.slice(0, 40)}` : prefix, prefix);
      const text = textOfNode(n);
      sig = signature(text) + ':' + text.length;
      getContent = () => text;
    }

    let filePath = null;
    if (kind !== 'none') {
      // Mantém o nome atual do arquivo se o item não foi renomeado e continua na mesma pasta
      const keep = n.file && dirname(n.file) === dir && n.fileTitle === (n.title || '') && splitExt(basename(n.file)).ext === ext;
      const fileName = use(dir, keep ? basename(n.file) : `${base}.${ext}`);
      filePath = joinPath(dir, fileName);
      dirs.add(dir);
      nodeFiles.set(n.id, filePath);
      files.push({ path: filePath, kind: 'asset', owner: n.id, sig, getContent });
    }
    outNodes.push({ ...n, src: isMedia ? undefined : n.src, file: filePath, fileTitle: n.title || '' });
  }

  const projectJson = {
    app: 'Miro_GRS',
    version: '2.0.0',
    id: data.id,
    title: data.title,
    updatedAt: new Date().toISOString(),
    camera: data.camera,
    palette: data.palette,
    folders: folders.map((f) => ({ ...f, dir: folderDirs.get(f.id) })),
    nodes: outNodes,
    connections: data.connections || [],
    drawings: data.drawings || [],
    files: files.map((f) => ({ path: f.path, owner: f.owner, kind: f.kind }))
  };
  for (const n of projectJson.nodes) if (n.src === undefined) delete n.src;

  return { files, dirs, nodeFiles, folderDirs, projectJson };
}

// ---------- Gerenciador de disco ----------
export class ProjectFS {
  constructor(app) {
    this.app = app;
    this.dirHandle = null;
    this.dirty = false;
    this.saving = false;
    this.pendingSave = false;
    this.lastWritten = new Map(); // path -> sig
    this.manifest = new Map(); // path -> owner (id de item/pasta)
    this.autoSaveTimer = null;
    try {
      this.autoSaveDisk = localStorage.getItem('mirogrs.autoSaveDisk') === '1';
    } catch {
      this.autoSaveDisk = false;
    }
  }

  get supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  dirName() {
    return this.dirHandle?.name || '';
  }

  setAutoSaveDisk(on) {
    this.autoSaveDisk = !!on;
    try {
      localStorage.setItem('mirogrs.autoSaveDisk', on ? '1' : '0');
    } catch {}
    if (on && this.dirty) this.markDirty();
  }

  markDirty() {
    this.dirty = true;
    this.updateIndicator();
    if (this.autoSaveDisk && this.dirHandle) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = setTimeout(() => this.saveToDisk({ silent: true, auto: true }), 2500);
    }
  }

  updateIndicator() {
    const dot = document.getElementById('save-indicator');
    const btn = document.getElementById('btn-save-project');
    if (dot) {
      dot.classList.toggle('dirty', this.dirty);
      dot.title = this.dirty ? 'Mudanças não salvas na pasta (Ctrl+S)' : 'Tudo salvo';
    }
    if (btn) {
      btn.title = this.dirHandle
        ? `Salvar Project na pasta "${this.dirHandle.name}" (Ctrl+S)`
        : 'Salvar Project em uma pasta do computador (Ctrl+S)';
    }
    const label = document.getElementById('linked-folder-label');
    if (label) label.textContent = this.dirHandle ? '📁 ' + this.dirHandle.name : '';
    const auto = document.getElementById('menu-autosave-disk');
    if (auto) auto.checked = this.autoSaveDisk;
  }

  async ensurePermission(handle, ask = true) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission !== 'function') return true; // ex.: OPFS
    try {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if (ask && (await handle.requestPermission(opts)) === 'granted') return true;
    } catch (err) {
      console.warn('Permissão negada', err);
    }
    return false;
  }

  // Liga um handle ao projeto atual (ao abrir/restaurar)
  attach(handle, { manifest = null, sigs = null } = {}) {
    this.dirHandle = handle || null;
    this.manifest = new Map(manifest || []);
    this.lastWritten = new Map(sigs || []);
    this.dirty = false;
    this.updateIndicator();
    this.app.projectPanel?.render();
  }

  detach() {
    this.attach(null);
  }

  async persistHandleState() {
    if (!this.dirHandle) return;
    await this.app.storage.saveHandle(this.app.storage.currentProjectId, {
      handle: this.dirHandle,
      dirName: this.dirHandle.name,
      manifest: Array.from(this.manifest.entries()),
      sigs: Array.from(this.lastWritten.entries())
    });
  }

  async dirExists(dir, name) {
    try {
      await dir.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async isEmptyDir(dir) {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of dir.values()) return false;
    return true;
  }

  // Escolhe a pasta do projeto. Se a pasta escolhida não estiver vazia e não for um projeto,
  // cria uma subpasta com o nome do projeto dentro dela.
  async pickProjectDirectory(projectTitle) {
    let picked;
    try {
      picked = await window.showDirectoryPicker({ id: 'mirogrs-project', mode: 'readwrite' });
    } catch {
      return null; // cancelado
    }
    if (!(await this.ensurePermission(picked))) return null;
    let hasProject = false;
    try {
      await picked.getFileHandle(PROJECT_FILE);
      hasProject = true;
    } catch {}
    if (hasProject || (await this.isEmptyDir(picked))) return { handle: picked, hasProject };
    const sub = await picked.getDirectoryHandle(sanitizeName(projectTitle, 'Meu Moodboard'), { create: true });
    let subHasProject = false;
    try {
      await sub.getFileHandle(PROJECT_FILE);
      subHasProject = true;
    } catch {}
    return { handle: sub, hasProject: subHasProject, created: true };
  }

  async linkCurrentProjectToFolder() {
    if (!this.supported) {
      this.app.setStatus('Este navegador não salva em pastas. Use Chrome ou Edge — exportando ZIP com as pastas...');
      return this.exportZip();
    }
    const title = document.getElementById('board-title')?.value || 'Meu Moodboard';
    const res = await this.pickProjectDirectory(title);
    if (!res) return false;
    if (res.hasProject) {
      const choice = await askChoice({
        title: `A pasta "${res.handle.name}" já tem um projeto`,
        message: 'O que você quer fazer?',
        choices: [
          { id: 'open', label: 'Abrir o projeto dessa pasta', primary: true },
          { id: 'overwrite', label: 'Salvar o projeto atual por cima', danger: true }
        ]
      });
      if (choice === 'open') return this.openFromHandle(res.handle);
      if (choice !== 'overwrite') return false;
    }
    this.attach(res.handle);
    this.dirty = true;
    const ok = await this.saveToDisk();
    if (ok) this.app.setStatus(`Projeto vinculado à pasta "${res.handle.name}"${res.created ? ' (criada agora)' : ''}. Ctrl+S salva as mudanças.`);
    return ok;
  }

  async save() {
    if (!this.supported) return this.exportZip();
    if (!this.dirHandle) return this.linkCurrentProjectToFolder();
    return this.saveToDisk();
  }

  async getDir(pathDir, create) {
    let dir = this.dirHandle;
    if (!pathDir) return dir;
    for (const part of pathDir.split('/')) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  async writeFile(path, content) {
    const dir = await this.getDir(dirname(path), true);
    const fh = await dir.getFileHandle(basename(path), { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async readFile(path) {
    const dir = await this.getDir(dirname(path), false);
    const fh = await dir.getFileHandle(basename(path));
    return fh.getFile();
  }

  async removeFile(path) {
    try {
      const dir = await this.getDir(dirname(path), false);
      await dir.removeEntry(basename(path));
      return true;
    } catch {
      return false;
    }
  }

  // Remove pasta só se estiver vazia (nunca recursivo: arquivos do usuário ficam a salvo)
  async removeDirIfEmpty(pathDir) {
    if (!pathDir) return;
    try {
      const parent = await this.getDir(dirname(pathDir), false);
      const dir = await parent.getDirectoryHandle(basename(pathDir));
      if (await this.isEmptyDir(dir)) await parent.removeEntry(basename(pathDir));
    } catch {}
  }

  async moveToTrash(path, stamp) {
    try {
      const file = await this.readFile(path);
      await this.writeFile(`${TRASH_DIR}/${stamp}/${path}`, file);
      await this.removeFile(path);
    } catch {}
  }

  async saveToDisk({ silent = false, auto = false } = {}) {
    if (!this.dirHandle) return false;
    if (this.saving) {
      this.pendingSave = true;
      return false;
    }
    if (!(await this.ensurePermission(this.dirHandle, !auto))) {
      if (!silent) this.app.setStatus('Sem permissão para gravar na pasta. Clique em 💾 Salvar para autorizar.');
      return false;
    }
    this.saving = true;
    document.body.classList.add('saving-disk');
    try {
      const data = this.app.storage.serializeBoard();
      const plan = buildDiskPlan(data, { getMediaBlob: (id) => this.app.storage.media.getBlob(id) });
      let written = 0;
      let moved = 0;
      let trashed = 0;

      for (const f of plan.files) {
        if (this.lastWritten.get(f.path) === f.sig) continue;
        const content = await f.getContent();
        await this.writeFile(f.path, content);
        this.lastWritten.set(f.path, f.sig);
        written++;
      }

      // Pastas vazias também existem no disco
      for (const d of plan.dirs) if (d) await this.getDir(d, true);

      // Arquivos que o app escreveu antes e não existem mais no plano
      const newPaths = new Set(plan.files.map((f) => f.path));
      const liveOwners = new Set([...this.app.state.nodes.keys(), ...this.app.state.folders.keys()]);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const oldDirs = new Set();
      for (const [path, owner] of this.manifest) {
        if (newPaths.has(path) || path === PROJECT_FILE) continue;
        oldDirs.add(dirname(path));
        const isMeta = path.endsWith('.meta.json');
        if (liveOwners.has(owner) || isMeta) {
          if (await this.removeFile(path)) moved += isMeta ? 0 : 1;
        } else {
          await this.moveToTrash(path, stamp);
          trashed++;
        }
        this.lastWritten.delete(path);
      }
      // Remove pastas que ficaram vazias (das mais profundas para as rasas)
      const allOld = new Set();
      for (const d of oldDirs) {
        let cur = d;
        while (cur) {
          allOld.add(cur);
          cur = dirname(cur);
        }
      }
      for (const d of [...allOld].sort((a, b) => b.split('/').length - a.split('/').length)) {
        if (!plan.dirs.has(d)) await this.removeDirIfEmpty(d);
      }

      // project.mirogrs.json por último
      await this.writeFile(PROJECT_FILE, JSON.stringify(plan.projectJson, null, 2));

      this.manifest = new Map(plan.files.map((f) => [f.path, f.owner]));
      // Atualiza nome de arquivo nos nós vivos (sem marcar mudança)
      for (const [id, path] of plan.nodeFiles) {
        const n = this.app.state.nodes.get(id);
        if (n) {
          n.file = path;
          n.fileTitle = n.title || '';
        }
      }
      await this.persistHandleState();
      this.dirty = false;
      this.updateIndicator();
      this.app.projectPanel?.render();
      if (!silent || written) {
        const parts = [`${written} arquivo(s) atualizado(s)`];
        if (moved) parts.push(`${moved} movido(s)/renomeado(s)`);
        if (trashed) parts.push(`${trashed} enviado(s) para ${TRASH_DIR}`);
        this.app.setStatus(`💾 Salvo em "${this.dirHandle.name}" — ${parts.join(', ')}.`);
      }
      return true;
    } catch (err) {
      console.error(err);
      this.app.setStatus('Erro ao salvar na pasta: ' + (err?.message || err));
      return false;
    } finally {
      this.saving = false;
      document.body.classList.remove('saving-disk');
      if (this.pendingSave) {
        this.pendingSave = false;
        if (this.dirty) this.saveToDisk({ silent: true, auto: true });
      }
    }
  }

  // ---------- Abrir do disco ----------
  async openFromFolderPicker() {
    if (!this.supported) {
      this.app.setStatus('Abrir pastas do disco precisa do Chrome ou Edge.');
      return false;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'mirogrs-project', mode: 'readwrite' });
    } catch {
      return false;
    }
    return this.openFromHandle(handle);
  }

  async scan(dirHandle, prefix = '', out = { dirs: [], files: new Map() }) {
    for await (const [name, h] of dirHandle.entries()) {
      const path = joinPath(prefix, name);
      if (h.kind === 'directory') {
        if (!prefix && name === TRASH_DIR) continue;
        out.dirs.push(path);
        await this.scan(h, path, out);
      } else {
        out.files.set(path, h);
      }
    }
    return out;
  }

  async openFromHandle(handle) {
    if (!(await this.ensurePermission(handle))) {
      this.app.setStatus('Permissão negada para a pasta.');
      return false;
    }
    this.app.setStatus(`Lendo pasta "${handle.name}"...`);
    const scan = await this.scan(handle);
    const readText = async (path) => (await scan.files.get(path).getFile()).text();

    let data = null;
    if (scan.files.has(PROJECT_FILE)) {
      try {
        data = JSON.parse(await readText(PROJECT_FILE));
      } catch {
        data = null;
      }
    }
    const hadProjectFile = !!data;
    if (!data) data = { title: handle.name, folders: [], nodes: [], connections: [], drawings: [] };
    data.folders = data.folders || [];
    data.nodes = data.nodes || [];
    if (!data.id) data.id = 'proj_' + Date.now().toString(36);
    if (!data.title) data.title = handle.name;

    // 1. Projetos antigos: lê os .meta.json (dizem ONDE cada pasta/item está no disco)
    const folderMetaDir = new Map(); // folderId -> dir real
    const itemMetaPath = new Map(); // nodeId -> caminho real do asset
    const folderById = new Map(data.folders.map((f) => [f.id, f]));
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    for (const path of scan.files.keys()) {
      if (!path.endsWith('.meta.json')) continue;
      let meta;
      try {
        meta = JSON.parse(await readText(path));
      } catch {
        continue;
      }
      if (meta.kind === 'folder' && meta.id) {
        folderMetaDir.set(meta.id, dirname(path));
        if (!folderById.has(meta.id)) {
          const f = { id: meta.id, name: meta.name, parentId: meta.parentId || null, color: meta.color || null, collapsed: !!meta.collapsed };
          data.folders.push(f);
          folderById.set(f.id, f);
          if (meta.frame && !hadProjectFile) {
            data.nodes.push({
              id: meta.frame.id || 'frame_' + meta.id,
              type: 'shape', shapeType: 'frame', frameFolderId: meta.id, folderId: meta.parentId || null,
              title: meta.name, x: meta.frame.x, y: meta.frame.y, width: meta.frame.width, height: meta.frame.height,
              autoFit: meta.frame.autoFit !== false, zIndex: 1
            });
          }
        }
      } else if (meta.kind === 'item' && meta.id) {
        if (meta.file) itemMetaPath.set(meta.id, joinPath(dirname(path), basename(meta.file)));
        if (!nodeById.has(meta.id)) {
          const { kind, ...node } = meta;
          void kind;
          data.nodes.push(node);
          nodeById.set(node.id, node);
        }
      }
    }

    // 2. Onde cada arquivo está de verdade: meta antigo > caminho salvo no projeto > busca pelo nome
    //    (o usuário pode ter movido/renomeado coisas no Explorer)
    const scanDirs = new Set(scan.dirs);
    const byBase = new Map(); // nome do arquivo (minúsculo) -> caminhos
    for (const p of scan.files.keys()) {
      if (p === PROJECT_FILE || p.endsWith('.meta.json')) continue;
      const b = basename(p).toLowerCase();
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(p);
    }
    const claimed = new Set();
    for (const n of data.nodes) {
      const viaMeta = itemMetaPath.get(n.id);
      const real = viaMeta && scan.files.has(viaMeta) ? viaMeta : n.file && scan.files.has(n.file) ? n.file : null;
      if (real) {
        n.file = real;
        claimed.add(real);
      }
    }
    for (const n of data.nodes) {
      if (!n.file || claimed.has(n.file)) continue;
      const cands = (byBase.get(basename(n.file).toLowerCase()) || []).filter((p) => !claimed.has(p));
      if (cands.length === 1) {
        n.file = cands[0];
        claimed.add(cands[0]);
      }
    }

    // 3. Onde cada pasta está: meta antigo > dir salvo no projeto > deduzido pelos itens/subpastas
    const folderDir = new Map(folderMetaDir);
    for (const f of data.folders) {
      if (!folderDir.has(f.id) && f.dir && scanDirs.has(f.dir)) folderDir.set(f.id, f.dir);
    }
    const ownedDirs = new Set(folderDir.values());
    const depthOf = (f) => (f.dir ? f.dir.split('/').length : 0);
    const lost = data.folders.filter((f) => !folderDir.has(f.id) && f.dir).sort((a, b) => depthOf(b) - depthOf(a));
    for (const f of lost) {
      // Pasta renomeada/movida no Explorer: segue o lugar onde os itens (ou subpastas) dela foram parar
      const where = new Set();
      for (const n of data.nodes) {
        if (n.folderId === f.id && n.file && claimed.has(n.file)) where.add(dirname(n.file));
      }
      for (const c of data.folders) {
        if (c.parentId === f.id && folderDir.has(c.id)) where.add(dirname(folderDir.get(c.id)));
      }
      if (where.size !== 1) continue;
      const d = [...where][0];
      if (!d || d === UNSORTED_DIR || ownedDirs.has(d) || !scanDirs.has(d)) continue;
      folderDir.set(f.id, d);
      ownedDirs.add(d);
    }
    const dirToFolder = new Map();
    for (const [fid, dir] of folderDir) dirToFolder.set(dir, fid);
    // Nome e pai seguem o disco
    for (const [fid, dir] of folderDir) {
      const f = folderById.get(fid);
      if (!f) continue;
      if (sanitizeName(f.name, 'Grupo') !== basename(dir)) f.name = basename(dir);
      const pd = dirname(dir);
      if (!pd) f.parentId = null;
      else if (dirToFolder.has(pd)) f.parentId = dirToFolder.get(pd);
    }
    // Pastas que não estão no disco (ex.: vazias): usa o caminho calculado
    const computed = buildDiskPlan(data).folderDirs;
    for (const [fid, dir] of computed) {
      if (!folderDir.has(fid) && !dirToFolder.has(dir)) dirToFolder.set(dir, fid);
    }

    // 4. Itens movidos entre pastas no Explorer mudam de grupo
    for (const n of data.nodes) {
      if (n.file && claimed.has(n.file)) {
        const d = dirname(n.file);
        n.folderId = d === UNSORTED_DIR || !d ? null : dirToFolder.get(d) || n.folderId || null;
      }
      if (n.type === 'shape' && n.shapeType === 'frame' && n.frameFolderId && folderById.has(n.frameFolderId)) {
        n.folderId = folderById.get(n.frameFolderId).parentId || null;
      }
    }

    // 5. Lê o conteúdo dos assets
    let txtEditados = 0;
    const loadedSigs = [];
    const known = new Set([PROJECT_FILE]);
    for (const n of data.nodes) {
      if (!n.file) continue;
      known.add(n.file);
      const fh = scan.files.get(n.file);
      if (!fh) {
        if ((n.type === 'image' || n.type === 'audio' || n.type === 'video') && !/não encontrado/.test(n.title || '')) {
          n.title = (n.title || '') + ' (arquivo não encontrado)';
        }
        continue;
      }
      try {
        const file = await fh.getFile();
        if (n.type === 'image' || n.type === 'audio') {
          n.src = await fileToDataUrl(file);
          loadedSigs.push([n.file, signature(n.src)]);
        } else if (n.type === 'video') {
          // Vídeo lido do disco vai para o MediaStore (binário, sem base64)
          const typed = file.type ? file : new File([file], file.name, { type: VIDEO_EXT_MIME[splitExt(file.name).ext] || 'video/mp4' });
          n.mediaId = await this.app.storage.media.put(typed, n.mediaId || undefined);
          n.mime = typed.type;
          loadedSigs.push([n.file, 'media:' + n.mediaId]);
        } else if (n.type === 'textblocks') {
          // .txt editado fora do app: refaz os blocos a partir dos parágrafos
          const text = await file.text();
          const atual = montarTextoDoJson(n.blocks);
          if (text.replace(/\r\n?/g, '\n').trim() !== atual.trim()) {
            n.blocks = textoParaBlocosJson(text, n.blocks);
            txtEditados++;
          }
          loadedSigs.push([n.file, signature(text) + ':' + text.length]);
        } else if (n.file.endsWith('.md') && n.type !== 'swatch') {
          // .md editado no Explorer/Notepad volta para o post-it
          const text = await file.text();
          n.text = text;
          loadedSigs.push([n.file, signature(text) + ':' + text.length]);
        }
      } catch {}
    }

    // 6. Pastas criadas no Explorer viram grupos; arquivos novos viram itens
    const newFolderIds = [];
    for (const dir of [...scan.dirs].sort((a, b) => a.split('/').length - b.split('/').length)) {
      if (dir === UNSORTED_DIR || dir.startsWith(UNSORTED_DIR + '/') || dirToFolder.has(dir)) continue;
      const id = 'fld_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
      data.folders.push({ id, name: basename(dir), parentId: dirToFolder.get(dirname(dir)) || null, color: null, collapsed: false });
      dirToFolder.set(dir, id);
      newFolderIds.push(id);
    }

    const newFiles = [];
    for (const [path, fh] of scan.files) {
      if (known.has(path) || path.endsWith('.meta.json')) continue;
      const { ext } = splitExt(basename(path));
      const isImg = IMAGE_EXT.includes(ext);
      const isVid = VIDEO_EXT.includes(ext);
      const isAud = !isVid && AUDIO_EXT.includes(ext);
      const isMd = ext === 'md' || ext === 'txt';
      if (!isImg && !isAud && !isMd && !isVid) continue;
      const d = dirname(path);
      newFiles.push({ path, fh, ext, isImg, isAud, isMd, isVid, folderId: d === UNSORTED_DIR ? null : dirToFolder.get(d) || null });
    }

    // Manifest = arquivos que o app gerencia nessa pasta (para mover/limpar no próximo save)
    const manifest = (data.files || []).map((f) => [f.path, f.owner]);
    for (const n of data.nodes) {
      if (n.file && scan.files.has(n.file)) {
        manifest.push([n.file, n.id]);
      }
    }
    // .meta.json de versões antigas: entram no manifest para serem apagados no próximo save
    for (const p of scan.files.keys()) if (p.endsWith('.meta.json')) manifest.push([p, '__legacy_meta']);

    await this.app.openProjectData(data, { handle, manifest, sigs: loadedSigs });

    if (newFiles.length) await this.importNewFiles(newFiles, newFolderIds);
    else if (newFolderIds.length) {
      for (const id of newFolderIds) this.app.foldersManager.createFrameFor(id);
      this.app.foldersManager.afterChange();
    }

    this.app.setStatus(
      `Projeto "${data.title}" aberto da pasta "${handle.name}"` +
        (newFiles.length ? ` — ${newFiles.length} arquivo(s) novo(s) encontrado(s) e adicionado(s).` : '.') +
        (txtEditados ? ` ${txtEditados} .txt editado(s) fora do app: blocos refeitos pelos parágrafos (grifos desses cards se perderam).` : '')
    );
    return true;
  }

  async importNewFiles(newFiles, newFolderIds) {
    const fm = this.app.foldersManager;
    const nm = this.app.nodesManager;
    const byFolder = new Map();
    for (const f of newFiles) {
      if (!byFolder.has(f.folderId)) byFolder.set(f.folderId, []);
      byFolder.get(f.folderId).push(f);
    }
    // Garante frames para pastas que vão receber itens (de cima para baixo)
    const needFrame = new Set(newFolderIds);
    for (const fid of byFolder.keys()) if (fid) for (const a of fm.getAncestors(fid)) needFrame.add(a.id);
    const ordered = [...needFrame].filter((id) => fm.get(id)).sort((a, b) => fm.getDepth(a) - fm.getDepth(b));

    const createFor = async (f) => {
      const file = await f.fh.getFile();
      let node;
      if (f.isVid) {
        const typed = file.type ? file : new File([file], file.name, { type: VIDEO_EXT_MIME[f.ext] || 'video/mp4' });
        node = await nm.createVideoNodeFromBlob(typed, file.name, 0, 0, { select: false, undo: false });
      } else if (f.ext === 'txt') {
        const text = await file.text();
        node = this.app.textBlocks.createFromText(text, file.name.replace(/\.txt$/i, ''), 0, 0, { undo: false, select: false });
      } else if (f.isMd) {
        const text = await file.text();
        node = nm.createNode({ type: 'sticky', x: 0, y: 0, width: 220, height: 190, fill: '#fef08a', text }, false);
      } else {
        const dataUrl = await fileToDataUrl(file.type ? file : new File([file], file.name, { type: EXT_MIME[f.ext] || '' }));
        node = f.isImg
          ? await nm.createImageNodeFromDataUrl(dataUrl, file.name, 0, 0, { select: false, undo: false })
          : await nm.createAudioNodeFromDataUrl(dataUrl, file.name, 0, 0, [], { select: false, undo: false });
      }
      node.folderId = f.folderId;
      node.file = f.path;
      node.fileTitle = node.title || '';
      return node;
    };

    for (const fid of ordered) {
      fm.createFrameFor(fid);
      const items = [];
      for (const f of byFolder.get(fid) || []) items.push(await createFor(f));
      if (items.length) fm.placeNodesInFrame(items, fid);
      fm.refitAll();
    }
    // Arquivos soltos na raiz ou em _Sem Categoria
    const loose = [];
    for (const f of byFolder.get(null) || []) loose.push(await createFor(f));
    if (loose.length) {
      const all = fm.boundsOf(Array.from(this.app.state.nodes.values()).filter((n) => !loose.includes(n)));
      let x = all ? all.minX : 0;
      const y = all ? all.maxY + 80 : 0;
      for (const n of loose) {
        n.x = x;
        n.y = y;
        x += n.width + 18;
      }
    }
    fm.afterChange();
  }

  // ---------- ZIP (fallback / backup) ----------
  async loadJSZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Não foi possível carregar o JSZip (sem internet?)'));
      document.head.appendChild(s);
    });
    return window.JSZip;
  }

  async exportZip() {
    try {
      this.app.setStatus('Gerando ZIP com as pastas do projeto...');
      const JSZip = await this.loadJSZip();
      const zip = new JSZip();
      const data = this.app.storage.serializeBoard();
      const plan = buildDiskPlan(data, { getMediaBlob: (id) => this.app.storage.media.getBlob(id) });
      const root = sanitizeName(data.title, 'Meu Moodboard');
      for (const f of plan.files) zip.file(`${root}/${f.path}`, await f.getContent());
      zip.file(`${root}/${PROJECT_FILE}`, JSON.stringify(plan.projectJson, null, 2));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${root}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.app.setStatus(`ZIP "${root}.zip" exportado com ${plan.files.length} arquivo(s) organizados em pastas.`);
      return true;
    } catch (err) {
      this.app.setStatus('Erro ao exportar ZIP: ' + (err?.message || err));
      return false;
    }
  }
}
