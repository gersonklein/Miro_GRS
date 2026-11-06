// js/text-blocks-format.js
// Funções PURAS (sem DOM, sem Blockly carregado) sobre o JSON serializado do
// workspace Blockly — o mesmo formato de Blockly.serialization.workspaces.save().
// Regras de montagem portadas do blocky-pdf-editor (montarPilha/exportText/pilhasNaOrdem):
//  - cada bloco de texto vira um parágrafo; uma linha em branco entre trechos;
//  - uma pilha é lida inteira, de cima para baixo; pilhas nunca se intercalam;
//  - ordem entre pilhas: as que têm "pilha nº" primeiro (pelo número), depois
//    coluna a coluna (esquerda → direita), cada coluna de cima para baixo;
//  - separador escreve a linha; ⏎ aumenta as linhas em branco; nota nunca sai;
//  - bloco desabilitado fica fora do .txt.

export const PARAGRAFO = '\n\n';
export const TOLERANCIA_COLUNA = 260;
export const TEXT_BLOCK_TYPE = 'pdf_text'; // mesmo nome do blocky → projetos dele abrem aqui

function topBlocks(wsJson) {
  return (wsJson && wsJson.blocks && Array.isArray(wsJson.blocks.blocks) && wsJson.blocks.blocks) || [];
}

function pilhaComoLista(topo) {
  const out = [];
  for (let b = topo; b; b = b.next && b.next.block) out.push(b);
  return out;
}

const field = (b, nome) => (b.fields && b.fields[nome] != null ? String(b.fields[nome]) : '');

export function pilhasNaOrdemJson(wsJson) {
  const itens = topBlocks(wsJson).map((b) => ({
    block: b,
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    ordem: b.type === 'txt_pilha' ? Number(field(b, 'ORDEM')) : null
  }));
  const numeradas = itens.filter((i) => Number.isFinite(i.ordem)).sort((a, b) => a.ordem - b.ordem || a.y - b.y);
  const colunas = [];
  const soltas = itens.filter((i) => !Number.isFinite(i.ordem)).sort((a, b) => a.x - b.x);
  for (const i of soltas) {
    const col = colunas.find((c) => Math.abs(i.x - c.x) <= TOLERANCIA_COLUNA);
    if (col) col.itens.push(i);
    else colunas.push({ x: i.x, itens: [i] });
  }
  const geometricas = colunas.flatMap((c) => c.itens.sort((a, b) => a.y - b.y));
  return [...numeradas, ...geometricas].map((i) => i.block);
}

export function montarPilhaJson(topo) {
  const partes = [];
  let extra = null;
  for (const b of pilhaComoLista(topo)) {
    if (b.enabled === false) continue;
    let trecho;
    switch (b.type) {
      case TEXT_BLOCK_TYPE:
        trecho = field(b, 'TEXT').trim();
        break;
      case 'txt_separador':
        trecho = field(b, 'LINHA').trim();
        break;
      case 'txt_espaco':
        extra = Number(field(b, 'QTD')) || 1;
        continue;
      default:
        continue;
    }
    if (!trecho) continue;
    if (partes.length) partes.push(extra ? '\n'.repeat(extra + 1) : PARAGRAFO);
    partes.push(trecho);
    extra = null;
  }
  return partes.join('');
}

// Texto final do card (todas as pilhas na ordem de leitura)
export function montarTextoDoJson(wsJson) {
  const textos = [];
  for (const topo of pilhasNaOrdemJson(wsJson)) {
    const t = montarPilhaJson(topo);
    if (t) textos.push(t);
  }
  return textos.join(PARAGRAFO);
}

// Lista plana dos blocos de texto (na ordem de leitura) — usada para reaproveitar cores
export function blocosDeTextoEmOrdem(wsJson) {
  const out = [];
  for (const topo of pilhasNaOrdemJson(wsJson)) {
    for (const b of pilhaComoLista(topo)) if (b.type === TEXT_BLOCK_TYPE) out.push(b);
  }
  return out;
}

let seq = 0;
const novoId = () => 'tb_' + Date.now().toString(36) + '_' + (seq++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);

// Texto (ex.: .txt editado no Notepad) → workspace com uma pilha, um bloco por parágrafo.
// `anterior` (JSON antigo) empresta a cor de cada bloco pela posição.
export function textoParaBlocosJson(texto, anterior = null) {
  const paragrafos = String(texto || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim());
  const coresAntigas = anterior ? blocosDeTextoEmOrdem(anterior).map((b) => b.extraState && b.extraState.corBloco) : [];
  let topo = null;
  let ultimo = null;
  paragrafos.forEach((p, i) => {
    const b = { type: TEXT_BLOCK_TYPE, id: novoId(), fields: { TEXT: p } };
    if (coresAntigas[i]) b.extraState = { corBloco: coresAntigas[i] };
    if (!topo) {
      topo = b;
      topo.x = 20;
      topo.y = 20;
    } else {
      ultimo.next = { block: b };
    }
    ultimo = b;
  });
  return { blocks: { languageVersion: 0, blocks: topo ? [topo] : [] } };
}

// Resumo curto (título automático, PNG, fallback sem Blockly)
export function resumoDoJson(wsJson, max = 60) {
  const t = montarTextoDoJson(wsJson).split('\n').find((l) => l.trim()) || '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Aceita o .json de projeto do blocky-pdf-editor (formato "blocky-pdf-editor")
export function workspaceDoProjetoBlocky(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const ehWorkspace = (o) => !!(o && o.blocks && Array.isArray(o.blocks.blocks));
  if (ehWorkspace(obj)) return obj; // já é um workspace serializado
  if (ehWorkspace(obj.blocks)) return obj.blocks; // projeto do blocky: { format, pdfs, blocks: <workspace> }
  return null;
}
