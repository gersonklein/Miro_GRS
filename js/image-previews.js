export class ImagePreviews {
  constructor(media) {
    this.media = media;
    this.cache = new Map();
    this.bytes = 0;
    this.budget = 24 * 1024 * 1024;
    this.queue = Promise.resolve();
  }
  async original(node) {
    if (node.mediaId) {
      const blob = await this.media.getBlob(node.mediaId);
      if (!blob) throw new Error('Imagem original não encontrada');
      return blob;
    }
    const response = await fetch(node.src);
    if (!response.ok) throw new Error('Imagem indisponível');
    return response.blob();
  }
  async preview(node) {
    const key = node.mediaId || node.src;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached;
    }
    const original = await this.original(node);
    if (/gif|svg/.test(original.type) || typeof createImageBitmap === 'undefined') return original;
    const ratio = Math.min(1, 1024 / Math.max(node.naturalWidth, node.naturalHeight));
    if (ratio === 1) return original;
    const bitmap = await createImageBitmap(original, {
      resizeWidth: Math.max(1, Math.round(node.naturalWidth * ratio)),
      resizeHeight: Math.max(1, Math.round(node.naturalHeight * ratio))
    });
    let blob;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    } finally { bitmap.close(); }
    if (!blob || blob.size >= original.size) return original;
    this.cache.set(key, blob); this.bytes += blob.size;
    while (this.bytes > this.budget) {
      const [id, item] = this.cache.entries().next().value;
      this.cache.delete(id); this.bytes -= item.size;
    }
    return blob;
  }
  display(node, img, full = false) {
    const mode = full ? 'original' : 'preview';
    if (img.dataset.sourceMode === mode) return;
    img.dataset.sourceMode = mode;
    const token = img.loadToken = (img.loadToken || 0) + 1;
    const task = async () => {
      if (!img.isConnected || img.loadToken !== token) return;
      try {
        const blob = full ? await this.original(node) : await this.preview(node);
        if (!img.isConnected || img.loadToken !== token) return;
        const url = URL.createObjectURL(blob);
        if (img.ownedUrl) URL.revokeObjectURL(img.ownedUrl);
        img.ownedUrl = url; img.src = url;
      } catch {
        if (img.isConnected && img.loadToken === token && node.src) img.src = node.src;
      }
    };
    this.queue = this.queue.then(task).catch(console.warn);
  }
  release(img) {
    if (!img) return;
    img.loadToken = (img.loadToken || 0) + 1;
    if (img.ownedUrl) URL.revokeObjectURL(img.ownedUrl);
    img.removeAttribute('src');
  }
}
