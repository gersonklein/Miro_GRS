// js/text-blocks.js
// Item "Blocos de Texto": card no canvas com um workspace Google Blockly real.
// O modo de editar foi portado do blocky-pdf-editor (blocky-pdf-editor-main/app.js):
// campo de texto multilinha com quebra medida, grifo (Alt+1..4), cor do bloco,
// marcadores (pilha nº / separador / espaço / nota), selos de ordem, avisos,
// dividir com DOIS CLIQUES na borda do bloco e Ctrl+Enter no cursor.
//
// Detalhe técnico: o canvas do Miro usa transform: scale() no #world, e o Blockly
// calcula arraste em pixels de tela. Por isso cada workspace vive numa camada em
// espaço de tela (#textblocks-layer) posicionada sobre o card, com
// workspace.scale = zoom do canvas (1 unidade do workspace = 1 unidade do mundo).

/* global Blockly */
import {
  TEXT_BLOCK_TYPE,
  montarTextoDoJson,
  textoParaBlocosJson,
  resumoDoJson,
  workspaceDoProjetoBlocky
} from './text-blocks-format.js';
import { askText, showContextMenu } from './ui-dialogs.js';

const BLOCKLY_VERSION = '10.4.3';
const BLOCKLY_URLS = [
  `https://unpkg.com/blockly@${BLOCKLY_VERSION}/blockly_compressed.js`,
  `https://unpkg.com/blockly@${BLOCKLY_VERSION}/msg/pt-br.js`
];

export const HEADER_H = 34;
const PAD = 18;
const MIN_W = 300;
const MIN_BODY_H = 90;
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------
// Cores (do blocky-pdf-editor)
// ---------------------------------------------------------------
export const MARCA_CORES = [
  { id: 'conferido', nome: 'Conferido', hex: '#16a34a', tecla: '1' },
  { id: 'duvida', nome: 'Dúvida', hex: '#eab308', tecla: '2' },
  { id: 'corrigir', nome: 'Corrigir', hex: '#dc2626', tecla: '3' },
  { id: 'nota', nome: 'Nota', hex: '#2563eb', tecla: '4' },
  { id: 'roxo', nome: 'Roxo', hex: '#7c3aed', tecla: '5' },
  { id: 'rosa', nome: 'Rosa', hex: '#db2777', tecla: '6' }
];
const MARCA_ALPHA = 0.38;
const TINT_ALPHA = 0.45;
const COR_BLOCO_PADRAO = 160;
const COR_PILHA = 210;
const COR_LAYOUT = 260;
const COR_NOTA = 60;

function marcaCor(id) {
  return MARCA_CORES.find((c) => c.id === id) || null;
}

function rgbaFromHex(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function tintFromHex(hex, alpha = TINT_ALPHA) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(255 + (c - 255) * alpha);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function corEfetiva(block) {
  const escolhida = block.corBloco && marcaCor(block.corBloco);
  if (escolhida) return escolhida.hex;
  return block.pdfMeta && block.pdfMeta.color ? block.pdfMeta.color : null;
}

function applyTint(block) {
  if (!block || block.type !== TEXT_BLOCK_TYPE) return;
  const root = block.getSvgRoot && block.getSvgRoot();
  if (!root) return;
  const tint = tintFromHex(corEfetiva(block) || '');
  if (!tint) {
    root.style.removeProperty('--pdf-block-tint');
    root.classList.remove('pdf-tinted');
    return;
  }
  root.style.setProperty('--pdf-block-tint', tint);
  root.classList.add('pdf-tinted');
}

function aplicarCorBloco(block) {
  block.setColour(corEfetiva(block) || COR_BLOCO_PADRAO);
  applyTint(block);
}

// ---------------------------------------------------------------
// Quebra de linha medida (do blocky)
// ---------------------------------------------------------------
const BLOCK_TEXT_WIDTH = 340;
let measureCtx = null;
function measureText(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function wrapWithOffsets(text, font, maxPx) {
  const out = [];
  let pos = 0;
  for (const line of text.split('\n')) {
    let start = pos;
    let end = pos;
    let p = pos;
    for (const word of line.split(' ')) {
      const wordEnd = p + word.length;
      if (end > start && measureText(text.slice(start, wordEnd), font) > maxPx) {
        out.push({ text: text.slice(start, end), start });
        start = p;
      }
      end = wordEnd;
      p = wordEnd + 1;
    }
    out.push({ text: text.slice(start, end), start });
    pos += line.length + 1;
  }
  return out;
}

// ---------------------------------------------------------------
// Marcas (grifo) — do blocky
// ---------------------------------------------------------------
function estadoExtraJson(block) {
  const s = block.saveExtraState();
  return s ? JSON.stringify(s) : '';
}

function mudarEstadoBloco(block, fn) {
  const antes = estadoExtraJson(block);
  fn();
  const depois = estadoExtraJson(block);
  if (antes !== depois && Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, antes, depois));
  }
}

function normalizarMarcas(marcas, len) {
  const out = [];
  const ordenadas = marcas
    .map((m) => ({ start: Math.max(0, m.start), end: Math.min(len, m.end), cor: m.cor }))
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start);
  for (const m of ordenadas) {
    const ult = out[out.length - 1];
    if (ult && ult.cor === m.cor && m.start <= ult.end) ult.end = Math.max(ult.end, m.end);
    else out.push(m);
  }
  return out;
}

function recortarMarcas(marcas, ini, fim) {
  const out = [];
  for (const m of marcas) {
    if (m.end <= ini || m.start >= fim) {
      out.push({ ...m });
      continue;
    }
    if (m.start < ini) out.push({ ...m, end: ini });
    if (m.end > fim) out.push({ ...m, start: fim });
  }
  return out;
}

function extrairMarcas(marcas, ini, fim) {
  return marcas
    .map((m) => ({ start: Math.max(m.start, ini) - ini, end: Math.min(m.end, fim) - ini, cor: m.cor }))
    .filter((m) => m.end > m.start);
}

function ajustarMarcasPorEdicao(marcas, antigo, novo) {
  let p = 0;
  const min = Math.min(antigo.length, novo.length);
  while (p < min && antigo[p] === novo[p]) p++;
  let q = 0;
  while (q < min - p && antigo[antigo.length - 1 - q] === novo[novo.length - 1 - q]) q++;
  const fimAntigo = antigo.length - q;
  const delta = novo.length - antigo.length;
  const fimNovo = fimAntigo + delta;
  const inicio = (x) => (x < p ? x : x >= fimAntigo ? x + delta : fimNovo);
  const fim = (x) => (x <= p ? x : x >= fimAntigo ? x + delta : p);
  return normalizarMarcas(marcas.map((m) => ({ start: inicio(m.start), end: fim(m.end), cor: m.cor })), novo.length);
}

function aplicarMarca(block, ini, fim, corId, len) {
  if (ini === fim) {
    ini = 0;
    fim = len;
  }
  const marcas = recortarMarcas(block.marcas || [], ini, fim);
  if (corId) marcas.push({ start: ini, end: fim, cor: corId });
  block.marcas = normalizarMarcas(marcas, len);
}

function grifarSelecao(field, corId) {
  const block = field.getSourceBlock();
  const input = field.htmlInput_;
  if (!block || !input) return;
  const { selectionStart: s, selectionEnd: f } = input;
  aplicarMarca(block, s, f, corId, input.value.length);
  field.forceRerender();
  input.focus({ preventScroll: true });
  input.setSelectionRange(s, f);
}

function mudarCorBloco(block, corId) {
  const campo = block.getField && block.getField('TEXT');
  if (campo && campo.isBeingEdited_) {
    block.corBloco = corId;
    aplicarCorBloco(block);
    return;
  }
  mudarEstadoBloco(block, () => {
    block.corBloco = corId;
    aplicarCorBloco(block);
  });
}

// ---------------------------------------------------------------
// Paleta (grifo + cor do bloco)
// ---------------------------------------------------------------
let paletaMarcas = null;

function esconderPaletaMarcas() {
  if (paletaMarcas) paletaMarcas.remove();
  paletaMarcas = null;
}

function posicionarPaleta(rect) {
  if (!paletaMarcas) return;
  const r = rect || Blockly.WidgetDiv.getDiv().getBoundingClientRect();
  const h = paletaMarcas.offsetHeight;
  const acima = r.top - h - 6;
  paletaMarcas.style.left = Math.max(4, Math.min(r.left, window.innerWidth - paletaMarcas.offsetWidth - 4)) + 'px';
  paletaMarcas.style.top = (acima >= 50 ? acima : r.bottom + 6) + 'px';
}

// field != null: editor aberto (grifo + cor). field == null: só cor do bloco (menu de contexto).
function mostrarPaletaMarcas(block, field, rect = null) {
  esconderPaletaMarcas();
  if (!block) return;
  const el = document.createElement('div');
  el.className = 'paleta-marcas';
  const linha = (rotulo) => {
    const l = document.createElement('div');
    l.className = 'paleta-linha';
    const s = document.createElement('span');
    s.className = 'paleta-rotulo';
    s.textContent = rotulo;
    l.appendChild(s);
    el.appendChild(l);
    return l;
  };
  const botao = (pai, titulo, cor, acao) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paleta-cor' + (cor ? '' : ' paleta-limpar');
    b.title = titulo;
    if (cor) b.style.background = cor;
    else b.textContent = '✕';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      acao();
      if (!field) esconderPaletaMarcas();
    });
    pai.appendChild(b);
  };
  if (field) {
    const grifo = linha('Grifar');
    for (const c of MARCA_CORES.slice(0, 4)) {
      botao(grifo, `${c.nome} (Alt+${c.tecla})`, rgbaFromHex(c.hex, 0.55), () => grifarSelecao(field, c.id));
    }
    botao(grifo, 'Tirar grifo (Alt+0)', null, () => grifarSelecao(field, null));
  }
  const cores = linha('Bloco');
  for (const c of MARCA_CORES) botao(cores, `Cor do bloco: ${c.nome}`, c.hex, () => mudarCorBloco(block, c.id));
  botao(cores, 'Cor original do bloco', null, () => mudarCorBloco(block, null));

  el.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(el);
  paletaMarcas = el;
  posicionarPaleta(rect);
  if (!rect) setTimeout(() => posicionarPaleta(null), 0);
  else setTimeout(() => window.addEventListener('mousedown', esconderPaletaMarcas, { once: true }), 0);
}

// ---------------------------------------------------------------
// Dividir bloco (do blocky)
// ---------------------------------------------------------------
let avisar = (msg) => console.log(msg);

function splitTextBlock(block, pos, value) {
  const ws = block.workspace;
  const esquerda = value.slice(0, pos);
  const direita = value.slice(pos);
  const antes = esquerda.trim();
  const depois = direita.trim();
  if (!antes || !depois) {
    avisar('Posicione o cursor no meio do texto para dividir o bloco.');
    return null;
  }
  const iniA = esquerda.length - esquerda.trimStart().length;
  const iniB = pos + (direita.length - direita.trimStart().length);
  const marcas = block.marcas || [];
  const marcasA = extrairMarcas(marcas, iniA, iniA + antes.length);
  const marcasB = extrairMarcas(marcas, iniB, iniB + depois.length);

  Blockly.WidgetDiv.hide();
  Blockly.Events.setGroup(true);
  let novo;
  try {
    block.setFieldValue(antes, 'TEXT');
    mudarEstadoBloco(block, () => {
      block.marcas = marcasA;
    });
    novo = ws.newBlock(TEXT_BLOCK_TYPE);
    novo.setFieldValue(depois, 'TEXT');
    novo.initSvg();
    novo.render();
    mudarEstadoBloco(novo, () => {
      novo.loadExtraState({ ...(block.pdfMeta || {}), marcas: marcasB, corBloco: block.corBloco });
    });
    const seguinte = block.getNextBlock();
    if (seguinte) seguinte.previousConnection.disconnect();
    block.nextConnection.connect(novo.previousConnection);
    if (seguinte) novo.nextConnection.connect(seguinte.previousConnection);
    const campo = block.getField('TEXT');
    if (campo) campo.forceRerender();
    novo.select();
  } finally {
    Blockly.Events.setGroup(false);
  }
  avisar('✂ Bloco dividido.');
  return novo;
}

// ---------------------------------------------------------------
// Definição dos blocos (do blocky)
// ---------------------------------------------------------------
let blocksDefined = false;

function defineBlocks() {
  if (blocksDefined) return;
  blocksDefined = true;

  class BlockTextField extends Blockly.FieldMultilineInput {
    constructor(value) {
      super(value);
      this.maxDisplayLength = Infinity;
    }

    fieldFont() {
      const c = this.getConstants();
      return `${c.FIELD_TEXT_FONTWEIGHT} ${c.FIELD_TEXT_FONTSIZE}pt ${c.FIELD_TEXT_FONTFAMILY}`;
    }

    getDisplayText_() {
      const raw = this.getText();
      if (!raw) return Blockly.Field.NBSP;
      const font = this.fieldFont();
      let width = BLOCK_TEXT_WIDTH;
      let lines = wrapWithOffsets(raw, font, width);
      for (let pass = 0; pass < 2; pass++) {
        const widest = Math.max(...lines.map((l) => measureText(l.text, font)));
        if (widest >= width - 0.5) break;
        width = widest;
        lines = wrapWithOffsets(raw, font, width);
      }
      this.linhas_ = lines;
      let out = lines.map((l) => l.text.replace(/\s/g, Blockly.Field.NBSP)).join('\n');
      const block = this.getSourceBlock();
      if (block && block.RTL) out += '‏';
      return out;
    }

    render_() {
      this.linhas_ = null;
      super.render_();
      this.desenharMarcas_();
    }

    desenharMarcas_() {
      const block = this.getSourceBlock();
      if (!this.fieldGroup_ || !this.textGroup) return;
      if (!this.grupoMarcas_ || this.grupoMarcas_.parentNode !== this.fieldGroup_) {
        this.grupoMarcas_ = document.createElementNS(SVG_NS, 'g');
        this.grupoMarcas_.setAttribute('class', 'bloco-marcas');
      }
      this.fieldGroup_.insertBefore(this.grupoMarcas_, this.textGroup);
      const g = this.grupoMarcas_;
      while (g.firstChild) g.removeChild(g.firstChild);
      const marcas = (block && block.marcas) || [];
      if (!marcas.length || !this.linhas_ || !this.getText()) return;
      const textos = this.textGroup.querySelectorAll('text');
      this.linhas_.forEach((linha, i) => {
        const el = textos[i];
        const fim = linha.start + linha.text.length;
        if (!el || !linha.text.length) return;
        for (const m of marcas) {
          const a = Math.max(m.start, linha.start) - linha.start;
          const b = Math.min(m.end, fim) - linha.start;
          if (b <= a) continue;
          const cor = marcaCor(m.cor);
          if (!cor) continue;
          try {
            const x0 = el.getStartPositionOfChar(a).x;
            const x1 = el.getEndPositionOfChar(b - 1).x;
            const box = el.getBBox();
            const r = document.createElementNS(SVG_NS, 'rect');
            r.setAttribute('x', String(x0));
            r.setAttribute('y', String(box.y));
            r.setAttribute('width', String(Math.max(1, x1 - x0)));
            r.setAttribute('height', String(box.height));
            r.setAttribute('rx', '2');
            r.setAttribute('fill', rgbaFromHex(cor.hex, MARCA_ALPHA));
            g.appendChild(r);
          } catch (_) {
            // bloco oculto: sem geometria
          }
        }
      });
    }

    doValueUpdate_(novo) {
      const antigo = this.value_;
      const block = this.getSourceBlock();
      if (this.isBeingEdited_ && block && block.marcas && block.marcas.length && typeof antigo === 'string' && typeof novo === 'string') {
        block.marcas = ajustarMarcasPorEdicao(block.marcas, antigo, novo);
      }
      super.doValueUpdate_(novo);
    }

    widgetCreate_() {
      const input = super.widgetCreate_();
      const block = this.getSourceBlock();
      this.estadoAoAbrir_ = block ? estadoExtraJson(block) : '';
      input.classList.add('bloco-texto-editor');
      if (this.fieldGroup_) this.fieldGroup_.classList.add('editando-marcas');
      mostrarPaletaMarcas(block, this);
      return input;
    }

    widgetDispose_() {
      const block = this.getSourceBlock();
      esconderPaletaMarcas();
      if (this.htmlInput_) this.lastCaret = this.htmlInput_.selectionStart;
      if (this.fieldGroup_) this.fieldGroup_.classList.remove('editando-marcas');
      if (block && Blockly.Events.isEnabled()) {
        const agora = estadoExtraJson(block);
        if (this.estadoAoAbrir_ != null && agora !== this.estadoAoAbrir_) {
          Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, this.estadoAoAbrir_, agora));
        }
      }
      this.estadoAoAbrir_ = null;
      super.widgetDispose_();
    }

    onHtmlInputKeyDown_(e) {
      const block = this.getSourceBlock();
      const input = this.htmlInput_;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (block && input) splitTextBlock(block, input.selectionStart, input.value);
        return;
      }
      const tecla = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
      if (tecla && e.altKey && !e.ctrlKey && !e.metaKey && block && input) {
        const corId = tecla[1] === '0' ? null : (MARCA_CORES.slice(0, 4).find((c) => c.tecla === tecla[1]) || {}).id;
        if (corId !== undefined) {
          e.preventDefault();
          grifarSelecao(this, corId);
          return;
        }
      }
      super.onHtmlInputKeyDown_(e);
    }

    updateSize_() {
      const editando = this.isBeingEdited_;
      this.isBeingEdited_ = false;
      try {
        super.updateSize_();
      } finally {
        this.isBeingEdited_ = editando;
      }
    }
  }

  Blockly.Blocks[TEXT_BLOCK_TYPE] = {
    init: function () {
      this.appendDummyInput().appendField(new BlockTextField('Digite o texto aqui...'), 'TEXT');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(COR_BLOCO_PADRAO);
      this.setTooltip('Bloco de texto. Clique para editar · dois cliques na borda divide · Ctrl+Enter divide no cursor.');
    },
    saveExtraState: function () {
      const state = this.pdfMeta ? { ...this.pdfMeta } : {};
      if (this.marcas && this.marcas.length) state.marcas = this.marcas.map((m) => ({ ...m }));
      if (this.corBloco) state.corBloco = this.corBloco;
      return Object.keys(state).length ? state : null;
    },
    loadExtraState: function (state) {
      const { marcas, corBloco, ...meta } = state || {};
      this.pdfMeta = meta.color || meta.pdfId ? meta : null;
      this.marcas = Array.isArray(marcas) ? marcas.map((m) => ({ ...m })) : [];
      this.corBloco = corBloco || null;
      aplicarCorBloco(this);
      if (this.rendered) {
        const field = this.getField('TEXT');
        if (field) field.forceRerender();
      }
    }
  };

  Blockly.Blocks.txt_pilha = {
    init: function () {
      this.appendDummyInput()
        .appendField('▣ pilha nº')
        .appendField(new Blockly.FieldNumber(1, 1, 99, 1), 'ORDEM')
        .appendField(new Blockly.FieldTextInput('sem título'), 'ROTULO');
      this.setNextStatement(true, null);
      this.setColour(COR_PILHA);
      this.setTooltip('Fixa a posição desta pilha no texto. Só encaixa no topo. Número e título não vão para o .txt.');
    }
  };
  Blockly.Blocks.txt_separador = {
    init: function () {
      this.appendDummyInput().appendField('── separador').appendField(new Blockly.FieldTextInput('---'), 'LINHA');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(COR_LAYOUT);
      this.setTooltip('Escreve esta linha literalmente no .txt.');
    }
  };
  Blockly.Blocks.txt_espaco = {
    init: function () {
      this.appendDummyInput()
        .appendField('⏎')
        .appendField(new Blockly.FieldNumber(2, 1, 10, 1), 'QTD')
        .appendField('linha(s) em branco');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(COR_LAYOUT);
      this.setTooltip('Aumenta o espaço antes do próximo trecho.');
    }
  };
  Blockly.Blocks.txt_nota = {
    init: function () {
      this.appendDummyInput().appendField('※').appendField(new Blockly.FieldTextInput('anotação'), 'NOTA');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(COR_NOTA);
      this.setTooltip('Lembrete para você. Nunca aparece no texto exportado.');
    }
  };

  // Menu de contexto do bloco: cor
  const reg = Blockly.ContextMenuRegistry.registry;
  if (!reg.getItem('miro_tb_cor')) {
    reg.register({
      id: 'miro_tb_cor',
      scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      weight: -10,
      displayText: () => '🎨 Cor do bloco…',
      preconditionFn: (scope) => (scope.block && scope.block.type === TEXT_BLOCK_TYPE && !scope.block.isInFlyout ? 'enabled' : 'hidden'),
      callback: (scope, e) => {
        const x = e && e.clientX ? e.clientX : window.innerWidth / 2;
        const y = e && e.clientY ? e.clientY : window.innerHeight / 2;
        setTimeout(() => mostrarPaletaMarcas(scope.block, null, { left: x, top: y + 70, bottom: y + 10 }), 0);
      }
    });
  }
}

// ---------------------------------------------------------------
// Ordem de leitura, selos e avisos (por workspace) — do blocky
// ---------------------------------------------------------------
const TOLERANCIA_COLUNA = 260;

function pilhasNaOrdem(ws) {
  const itens = ws
    .getTopBlocks(false)
    .filter((b) => !b.isShadow() && !b.isInsertionMarker())
    .map((b) => {
      const xy = b.getRelativeToSurfaceXY();
      return { block: b, x: xy.x, y: xy.y, ordem: b.type === 'txt_pilha' ? Number(b.getFieldValue('ORDEM')) : null };
    });
  const numeradas = itens.filter((i) => Number.isFinite(i.ordem)).sort((a, b) => a.ordem - b.ordem || a.y - b.y);
  const colunas = [];
  for (const i of itens.filter((i) => !Number.isFinite(i.ordem)).sort((a, b) => a.x - b.x)) {
    const col = colunas.find((c) => Math.abs(i.x - c.x) <= TOLERANCIA_COLUNA);
    if (col) col.itens.push(i);
    else colunas.push({ x: i.x, itens: [i] });
  }
  return [...numeradas, ...colunas.flatMap((c) => c.itens.sort((a, b) => a.y - b.y))];
}

function removerSelo(ws, block) {
  const g = block.__seloOrdem;
  if (g && g.parentNode) g.parentNode.removeChild(g);
  block.__seloOrdem = null;
  ws.__comSelo.delete(block);
}

function aplicarSelo(ws, block, n) {
  const raiz = block.getSvgRoot();
  if (!raiz) return;
  let g = block.__seloOrdem;
  if (!g || !g.parentNode) {
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'stack-badge');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '-14');
    c.setAttribute('cy', '14');
    c.setAttribute('r', '11');
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '-14');
    t.setAttribute('y', '18');
    t.setAttribute('text-anchor', 'middle');
    g.append(c, t);
    raiz.appendChild(g);
    block.__seloOrdem = g;
    ws.__comSelo.add(block);
  }
  g.querySelector('text').textContent = String(n);
}

function escreveAlgo(b) {
  if (b.type === TEXT_BLOCK_TYPE) return !!(b.getFieldValue('TEXT') || '').trim();
  if (b.type === 'txt_separador') return !!(b.getFieldValue('LINHA') || '').trim();
  return false;
}

function revalidarWorkspace(ws) {
  const pilhas = pilhasNaOrdem(ws);
  const mostrarSelo = pilhas.length > 1;
  for (const b of Array.from(ws.__comSelo)) {
    if (!mostrarSelo || !pilhas.some((p) => p.block === b)) removerSelo(ws, b);
  }
  if (mostrarSelo) pilhas.forEach((p, i) => aplicarSelo(ws, p.block, i + 1));
  const usados = new Map();
  for (const p of pilhas) if (Number.isFinite(p.ordem)) usados.set(p.ordem, (usados.get(p.ordem) || 0) + 1);
  for (const p of pilhas) {
    const blocos = [];
    for (let b = p.block; b; b = b.getNextBlock()) blocos.push(b);
    const algumTexto = blocos.some(escreveAlgo);
    blocos.forEach((b, idx) => {
      let aviso = null;
      const antes = blocos.slice(0, idx).some(escreveAlgo);
      const depois = blocos.slice(idx + 1).some(escreveAlgo);
      switch (b.type) {
        case TEXT_BLOCK_TYPE:
          if (!(b.getFieldValue('TEXT') || '').trim()) aviso = 'Bloco sem texto: não entra no .txt.';
          break;
        case 'txt_espaco':
          if (!antes || !depois) aviso = 'Espaço na ponta da pilha: sem efeito.';
          break;
        case 'txt_separador':
          if (!(b.getFieldValue('LINHA') || '').trim()) aviso = 'Separador vazio: não escreve nada.';
          break;
        case 'txt_pilha':
          if (usados.get(p.ordem) > 1) aviso = 'Outra pilha usa o mesmo número: a ordem entre as duas fica indefinida.';
          else if (!algumTexto) aviso = 'Esta pilha não tem nenhum trecho de texto.';
          break;
      }
      b.setWarningText(aviso);
    });
  }
}

// ---------------------------------------------------------------
// Gerenciador dos cards
// ---------------------------------------------------------------
export function defaultBlocksJson(texto = 'Digite o texto aqui...') {
  return textoParaBlocosJson(texto);
}

export class TextBlocksManager {
  constructor(app) {
    this.app = app;
    this.layer = document.getElementById('textblocks-layer');
    this.cards = new Map(); // nodeId -> { ws, host, node, ... }
    this.loading = null;
    this.failed = false;
    this.activeHost = null;
    this.lastPointer = { x: 0, y: 0 };
    avisar = (msg) => this.app.setStatus(msg);

    document.addEventListener(
      'pointerdown',
      (e) => {
        const host = e.target instanceof Element ? e.target.closest('.tb-host') : null;
        const inBlocklyUi = e.target instanceof Element && e.target.closest('.blocklyWidgetDiv, .blocklyDropDownDiv, .blocklyTooltipDiv, .paleta-marcas, .blocklyContextMenu');
        if (inBlocklyUi) return;
        this.activeHost = host;
        if (!host && typeof Blockly !== 'undefined') {
          // Clicou fora dos cards: tira a seleção do Blockly (senão Delete apagaria o bloco)
          const sel = Blockly.getSelected && Blockly.getSelected();
          if (sel && sel.unselect) sel.unselect();
          if (Blockly.common && Blockly.common.setSelected) Blockly.common.setSelected(null);
        }
      },
      true
    );
    document.addEventListener('pointermove', (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }, true);
  }

  // Foco do teclado está num card (atalhos do app devem ficar quietos)
  isActive() {
    if (typeof Blockly === 'undefined') return false;
    if (this.activeHost && this.activeHost.isConnected) return true;
    return false;
  }

  // ---------- Carregar Blockly sob demanda ----------
  load() {
    if (typeof Blockly !== 'undefined' && Blockly.inject) {
      defineBlocks();
      return Promise.resolve(true);
    }
    if (this.loading) return this.loading;
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar ' + src));
        document.head.appendChild(s);
      });
    this.app.setStatus('Carregando Blockly...');
    this.loading = (async () => {
      try {
        for (const u of BLOCKLY_URLS) await loadScript(u);
        defineBlocks();
        this.app.setStatus('Blocos de Texto prontos — clique para editar, dois cliques na borda divide o bloco.');
        return true;
      } catch (err) {
        console.error(err);
        this.failed = true;
        this.app.setStatus('Não foi possível carregar o Blockly (sem internet?). Os blocos ficam só para leitura.');
        return false;
      }
    })();
    return this.loading;
  }

  // ---------- DOM do card (no #world) ----------
  buildCardDOM(node, el) {
    if (!node.blocks) node.blocks = defaultBlocksJson();
    el.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'tb-header';
    const title = document.createElement('span');
    title.className = 'tb-title';
    title.textContent = '📝 ' + (node.title || 'Texto');
    title.title = 'Duplo clique para renomear (vira o nome do .txt)';
    title.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      const nome = await askText({ title: 'Nome do bloco de texto (.txt)', value: node.title || 'Texto', okText: 'Renomear' });
      if (!nome) return;
      this.app.pushUndoState();
      node.title = nome;
      title.textContent = '📝 ' + nome;
      this.app.storage.scheduleAutoSave();
    });
    header.appendChild(title);

    const mkBtn = (txt, tip, fn) => {
      const b = document.createElement('button');
      b.className = 'tb-btn';
      b.textContent = txt;
      b.title = tip;
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(e);
      });
      header.appendChild(b);
      return b;
    };
    mkBtn('＋ Texto', 'Novo bloco de texto no fim da última pilha', () => this.addBlock(node.id, TEXT_BLOCK_TYPE));
    mkBtn('＋ Marcador', 'Pilha nº, separador, espaço, nota', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showContextMenu(r.left, r.bottom + 4, [
        { label: '▣ pilha nº (ordem de leitura)', action: () => this.addBlock(node.id, 'txt_pilha') },
        { label: '── separador', action: () => this.addBlock(node.id, 'txt_separador') },
        { label: '⏎ linhas em branco', action: () => this.addBlock(node.id, 'txt_espaco') },
        { label: '※ nota (não sai no .txt)', action: () => this.addBlock(node.id, 'txt_nota') }
      ]);
    });
    mkBtn('⧉', 'Copiar o texto montado', () => {
      const t = montarTextoDoJson(node.blocks);
      navigator.clipboard?.writeText(t).then(
        () => this.app.setStatus('Texto copiado para a área de transferência.'),
        () => this.app.setStatus('Não foi possível copiar.')
      );
    });
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'tb-body';
    const fallback = document.createElement('pre');
    fallback.className = 'tb-fallback';
    body.appendChild(fallback);
    el.appendChild(body);
    this.updateFallback(node, el);

    this.load().then((ok) => {
      if (ok && this.app.state.nodes.get(node.id) === node) this.createWorkspace(node);
    });
  }

  updateFallback(node, el = this.cardEl(node.id)) {
    const fb = el?.querySelector('.tb-fallback');
    if (fb) fb.textContent = montarTextoDoJson(node.blocks) || '(vazio)';
  }

  cardEl(id) {
    return this.app.nodesManager.nodesLayer.querySelector(`.canvas-node[data-id="${id}"]`);
  }

  // ---------- Workspace (camada de tela) ----------
  createWorkspace(node) {
    if (this.cards.has(node.id)) return this.cards.get(node.id);
    const host = document.createElement('div');
    host.className = 'tb-host';
    host.dataset.nodeId = node.id;
    this.layer.appendChild(host);
    const card = { node, host, ws: null, lastW: 0, lastH: 0, syncTimer: null, suppress: 0, burst: false };
    this.cards.set(node.id, card);
    this.positionHost(card);

    const ws = Blockly.inject(host, {
      renderer: 'geras',
      trashcan: false,
      sounds: false,
      comments: false,
      disable: true,
      collapse: true,
      scrollbars: false,
      move: { scrollbars: false, drag: false, wheel: false },
      zoom: { controls: false, wheel: false, pinch: false, startScale: this.app.canvasEngine.scale, maxScale: 12, minScale: 0.03 }
    });
    ws.__comSelo = new Set();
    card.ws = ws;
    this.cardEl(node.id)?.classList.add('tb-live');

    card.suppress++;
    try {
      Blockly.serialization.workspaces.load(node.blocks || defaultBlocksJson(), ws);
      for (const b of ws.getAllBlocks(false)) if (b.type === TEXT_BLOCK_TYPE) aplicarCorBloco(b);
    } catch (err) {
      console.error('Falha ao carregar blocos', err);
    } finally {
      card.suppress--;
    }
    ws.clearUndo();
    this.resetOrigin(card);

    // Roda do mouse = zoom do canvas do Miro
    host.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.app.canvasEngine.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
      },
      { passive: false, capture: true }
    );

    // Dois cliques na borda do bloco: divide entre as linhas (do blocky)
    host.addEventListener('dblclick', (e) => this.onDoubleClick(card, e));

    ws.addChangeListener((e) => this.onWorkspaceEvent(card, e));
    setTimeout(() => {
      revalidarWorkspace(ws);
      this.autoSize(card, false);
    }, 0);
    return card;
  }

  onDoubleClick(card, e) {
    const alvo = e.target instanceof Element ? e.target : null;
    const raiz = alvo && alvo.closest('.blocklyDraggable[data-id]');
    if (!raiz) return;
    const block = card.ws.getBlockById(raiz.getAttribute('data-id'));
    if (!block || block.type !== TEXT_BLOCK_TYPE) return;
    const campo = block.getField('TEXT');
    if (!campo || !campo.fieldGroup_) return;
    if (campo.fieldGroup_.contains(alvo)) return; // clique no texto = edição
    e.preventDefault();
    e.stopPropagation();
    const textos = Array.from(campo.textGroup.querySelectorAll('text'));
    const linhas = campo.linhas_ || [];
    if (textos.length < 2 || linhas.length < 2) {
      this.app.setStatus('Este bloco tem uma linha só: não há onde dividir. (Editando, Ctrl+Enter divide no cursor.)');
      return;
    }
    let melhor = -1;
    let dist = Infinity;
    for (let i = 1; i < textos.length && i < linhas.length; i++) {
      const y = (textos[i - 1].getBoundingClientRect().bottom + textos[i].getBoundingClientRect().top) / 2;
      const d = Math.abs(e.clientY - y);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    }
    if (melhor > 0) splitTextBlock(block, linhas[melhor].start, campo.getValue() || '');
  }

  onWorkspaceEvent(card, e) {
    if (card.suppress) return;
    if (e.type === Blockly.Events.BLOCK_DRAG) {
      if (e.isStart) {
        card.dragging = true;
      } else {
        card.dragging = false;
        const pt = { ...this.lastPointer };
        const blockId = e.blockId;
        setTimeout(() => this.maybeTransfer(card, blockId, pt), 0);
      }
      return;
    }
    if (e.isUiEvent) return;
    if (e.type === Blockly.Events.BLOCK_CHANGE && e.element === 'warning') return;

    // Início de uma rajada de edições: guarda o estado anterior no undo do app
    if (!card.burst) {
      card.burst = true;
      this.app.pushUndoState();
    }
    clearTimeout(card.syncTimer);
    card.syncTimer = setTimeout(() => this.flush(card), 250);
    clearTimeout(card.validTimer);
    card.validTimer = setTimeout(() => {
      if (card.ws) revalidarWorkspace(card.ws);
    }, 0);
  }

  flush(card) {
    if (!card.ws || card.dragging) {
      if (card.ws) card.syncTimer = setTimeout(() => this.flush(card), 200);
      return;
    }
    card.burst = false;
    this.autoSize(card, true);
    card.node.blocks = Blockly.serialization.workspaces.save(card.ws);
    this.updateFallback(card.node);
    this.app.foldersManager.refitAll();
    this.app.foldersManager.decorateAll();
    this.app.canvasEngine.renderMinimap();
    this.app.storage.scheduleAutoSave();
  }

  // Garante que o conteúdo comece em (PAD, PAD) movendo o CARD (os blocos ficam
  // no mesmo lugar visualmente) e ajusta o tamanho do card ao conteúdo.
  autoSize(card, save) {
    const { ws, node } = card;
    if (!ws) return;
    const box = ws.getBlocksBoundingBox();
    const empty = !ws.getTopBlocks(false).length || !isFinite(box.left);
    if (!empty) {
      const dx = Math.round(box.left - PAD);
      const dy = Math.round(box.top - PAD);
      if (dx !== 0 || dy !== 0) {
        card.suppress++;
        Blockly.Events.disable();
        try {
          for (const b of ws.getTopBlocks(false)) b.moveBy(-dx, -dy);
        } finally {
          Blockly.Events.enable();
          card.suppress--;
        }
        node.x += dx;
        node.y += dy;
      }
    }
    const contentW = empty ? 0 : box.right - box.left + PAD * 2;
    const contentH = empty ? 0 : box.bottom - box.top + PAD * 2;
    const w = Math.max(MIN_W, Math.ceil(contentW));
    const h = HEADER_H + Math.max(MIN_BODY_H, Math.ceil(contentH));
    if (node.autoFit !== false) {
      node.width = w;
      node.height = h;
    } else {
      node.width = Math.max(node.width, w);
      node.height = Math.max(node.height, h);
    }
    this.app.nodesManager.updateNodeElementTransform(node);
    if (save) node.blocks = Blockly.serialization.workspaces.save(ws);
  }

  resetOrigin(card) {
    if (!card.ws) return;
    card.ws.translate(0, 0);
    card.ws.scrollX = 0;
    card.ws.scrollY = 0;
  }

  positionHost(card) {
    const { node, host } = card;
    const ce = this.app.canvasEngine;
    const s = ce.scale;
    const p = ce.worldToScreen(node.x, node.y + HEADER_H);
    const w = Math.max(1, node.width * s);
    const h = Math.max(1, (node.height - HEADER_H) * s);
    const visible = p.x < window.innerWidth && p.y < window.innerHeight && p.x + w > 0 && p.y + h > 0;
    host.style.display = visible ? '' : 'none';
    host.style.left = `${p.x}px`;
    host.style.top = `${p.y}px`;
    host.style.width = `${w}px`;
    host.style.height = `${h}px`;
    const el = this.cardEl(node.id);
    host.classList.toggle('dimmed', !!el?.classList.contains('dimmed'));
    host.style.opacity = String((node.opacity ?? 100) / 100);
    if (!card.ws || !visible) return;
    if (Math.abs(card.ws.scale - s) > 1e-6) {
      card.ws.setScale(s);
      this.resetOrigin(card);
    }
    if (Math.round(w) !== card.lastW || Math.round(h) !== card.lastH) {
      card.lastW = Math.round(w);
      card.lastH = Math.round(h);
      Blockly.svgResize(card.ws);
      this.resetOrigin(card);
    }
  }

  syncCard(node) {
    const card = this.cards.get(node.id);
    if (card) {
      card.node = node;
      this.positionHost(card);
    }
  }

  syncAll() {
    for (const card of this.cards.values()) this.positionHost(card);
  }

  destroy(id) {
    const card = this.cards.get(id);
    if (!card) return;
    clearTimeout(card.syncTimer);
    try {
      card.ws?.dispose();
    } catch {}
    card.host.remove();
    this.cards.delete(id);
  }

  destroyAll() {
    esconderPaletaMarcas();
    for (const id of Array.from(this.cards.keys())) this.destroy(id);
  }

  // Salva já o que está pendente (antes de serializar o board)
  flushAll() {
    for (const card of this.cards.values()) {
      if (card.ws && card.syncTimer) {
        clearTimeout(card.syncTimer);
        card.syncTimer = null;
        card.burst = false;
        card.node.blocks = Blockly.serialization.workspaces.save(card.ws);
      }
    }
  }

  // ---------- Ações ----------
  addBlock(nodeId, type) {
    const card = this.cards.get(nodeId);
    if (!card?.ws) {
      this.app.setStatus('Aguarde o Blockly carregar...');
      return;
    }
    const ws = card.ws;
    const pilhas = pilhasNaOrdem(ws);
    Blockly.Events.setGroup(true);
    try {
      const b = ws.newBlock(type);
      b.initSvg();
      b.render();
      if (type === 'txt_pilha') {
        const primeira = pilhas[0]?.block;
        if (primeira && primeira.type !== 'txt_pilha' && primeira.previousConnection) {
          const xy = primeira.getRelativeToSurfaceXY();
          b.moveTo(new Blockly.utils.Coordinate(xy.x, xy.y));
          b.nextConnection.connect(primeira.previousConnection);
        } else {
          b.moveTo(new Blockly.utils.Coordinate(PAD, PAD));
        }
      } else if (pilhas.length) {
        let ultimo = pilhas[pilhas.length - 1].block;
        while (ultimo.getNextBlock()) ultimo = ultimo.getNextBlock();
        ultimo.nextConnection.connect(b.previousConnection);
      } else {
        b.moveTo(new Blockly.utils.Coordinate(PAD, PAD));
      }
      b.select();
      if (type === TEXT_BLOCK_TYPE) {
        setTimeout(() => {
          this.autoSize(card, false);
          const f = b.getField('TEXT');
          f?.showEditor?.();
        }, 50);
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
  }

  // Área do card na tela, com uma margem de tolerância (soltar logo abaixo da última
  // linha de blocos conta como "dentro" — é onde a gente encaixa no fim da pilha)
  hitCard(card, x, y, margin = 40) {
    const r = card.host.getBoundingClientRect();
    const top = r.top - HEADER_H * this.app.canvasEngine.scale;
    return x >= r.left - margin && x <= r.right + margin && y >= top - margin && y <= r.bottom + margin;
  }

  cardAtScreenPoint(x, y, excludeId = null) {
    let best = null;
    for (const card of this.cards.values()) {
      if (card.node.id === excludeId || card.host.style.display === 'none') continue;
      if (this.hitCard(card, x, y, 0)) return card; // dentro de verdade vence
      if (!best && this.hitCard(card, x, y)) best = card;
    }
    return best;
  }

  // Bloco arrastado e solto FORA do card: vai para outro card ou vira um card novo
  maybeTransfer(card, blockId, pt) {
    if (!card.ws) return;
    // Dentro do próprio card: a não ser que esteja de verdade sobre outro card, fica
    const other = this.cardAtScreenPoint(pt.x, pt.y, card.node.id);
    const insideOther = other && this.hitCard(other, pt.x, pt.y, 0);
    if (this.hitCard(card, pt.x, pt.y) && !insideOther) return;
    const block = card.ws.getBlockById(blockId);
    if (!block || block.getParent()) return;
    // Não deixa sair se o ponto está sobre a UI (painéis)
    const under = document.elementFromPoint(pt.x, pt.y);
    if (under && under.closest('.ui-panel')) return;

    const json = Blockly.serialization.blocks.save(block, { addNextBlocks: true });
    this.app.pushUndoState();
    card.suppress++;
    try {
      block.dispose(false);
    } finally {
      card.suppress--;
    }
    // Card que ficou sem nenhum bloco some (a pilha foi embora inteira)
    if (!card.ws.getTopBlocks(false).length) {
      this.app.nodesManager.removeNode(card.node.id);
      this.app.foldersManager.afterChange();
    } else {
      this.flushNow(card);
    }

    const target = other;
    if (target && target.ws) {
      const c = Blockly.utils.svgMath.screenToWsCoordinates(target.ws, new Blockly.utils.Coordinate(pt.x - 20, pt.y - 10));
      json.x = Math.round(c.x);
      json.y = Math.round(c.y);
      const novo = Blockly.serialization.blocks.append(json, target.ws);
      for (const b of novo.getDescendants(false)) if (b.type === TEXT_BLOCK_TYPE) aplicarCorBloco(b);
      this.snapToNearest(target.ws, novo);
      this.app.setStatus('Pilha movida para o outro card.');
    } else {
      const w = this.app.canvasEngine.screenToWorld(pt.x, pt.y);
      json.x = PAD;
      json.y = PAD;
      const newNode = this.createCardNode({ blocks: { blocks: { languageVersion: 0, blocks: [json] } } }, w.x - 30, w.y - HEADER_H - 10, { undo: false, select: true });
      this.app.foldersManager.autoAssign([newNode]);
      this.app.setStatus('Pilha solta virou um card novo.');
    }
  }

  // Encaixa a pilha recém-chegada no fim/meio da pilha mais próxima (raio pequeno)
  snapToNearest(ws, novo) {
    if (!novo.previousConnection) return;
    const p = novo.getRelativeToSurfaceXY();
    let best = null;
    let bestD = 60;
    for (const b of ws.getAllBlocks(false)) {
      if (b === novo || novo.getDescendants(false).includes(b) || !b.nextConnection) continue;
      const xy = b.getRelativeToSurfaceXY();
      // b.height = só este bloco (getHeightWidth() somaria a pilha inteira abaixo dele)
      const h = typeof b.height === 'number' ? b.height : b.getHeightWidth().height;
      const d = Math.hypot(p.x - xy.x, p.y - (xy.y + h));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best) {
      try {
        best.nextConnection.connect(novo.previousConnection);
      } catch {}
    }
  }

  flushNow(card) {
    clearTimeout(card.syncTimer);
    card.syncTimer = null;
    card.burst = false;
    this.autoSize(card, true);
    this.updateFallback(card.node);
    this.app.storage.scheduleAutoSave();
  }

  // ---------- Criação de cards ----------
  createCardNode({ blocks = null, title = 'Texto' } = {}, x, y, { undo = true, select = true } = {}) {
    const node = this.app.nodesManager.createNode(
      {
        type: 'textblocks',
        title,
        blocks: blocks || defaultBlocksJson(),
        x,
        y,
        width: 420,
        height: HEADER_H + 140,
        fill: '#1e2436'
      },
      undo
    );
    if (select) this.app.nodesManager.selectNode(node.id, false);
    return node;
  }

  createFromText(texto, title, x, y, opts = {}) {
    return this.createCardNode({ blocks: textoParaBlocosJson(texto), title }, x, y, opts);
  }

  // .json do blocky-pdf-editor → card
  createFromBlockyProject(obj, title, x, y) {
    const ws = workspaceDoProjetoBlocky(obj);
    if (!ws) return null;
    return this.createCardNode({ blocks: ws, title }, x, y);
  }

  resumo(node) {
    return resumoDoJson(node.blocks);
  }
}
