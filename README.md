# 🎨 Miro_GRS — Canvas Infinito Multimídia (Miro + PureRef + Estúdio de Áudio)

Aplicação web completa de quadro infinito em **HTML5 + CSS3 + JavaScript ES Modules** que une:
1. **Miro**: Post-its, Formas Geométricas, Quadros/Frames, Textos, Desenho Livre (Caneta e Marca-texto) e Conectores Inteligentes (curvas Bézier com rótulos editáveis).
2. **PureRef**: Importação de múltiplas imagens via Drag & Drop ou `Ctrl+V`, **Auto-Pack (`Ctrl+P`)**, organização em **Grid**, **Igualar Altura** mantendo proporção, **Crop não-destrutivo (`C`)**, Flip Horizontal/Vertical (`Alt+H` / `Alt+V`), **Escala de Cinza (`G`)**, **Conta-Gotas pixel a pixel (`I`)** com Lupa e Paleta de Cores, e **Modo Foco Minimalista (`Tab`)**.
3. **Estúdio de Áudio no Canvas**: Cards de som com visualização de **Onda Sonora (Waveform)**, controles de **Loop**, **Velocidade/Pitch (`0.5x` a `2.0x`)**, **Gravador de Microfone ao vivo** e **Marcadores de Tempo Conectáveis (`+ Pin`)** que permitem puxar uma seta de um segundo específico do som para uma imagem ou anotação.

4. **Grupos / Pastas estilo Unity (Project)**: Tag = Grupo = Frame = Pasta. Selecione itens + **`Ctrl+G`** para criar um grupo (frame no canvas + tag nos itens + pasta no disco), com **subgrupos ilimitados**. Painel **Project** à esquerda com árvore, busca, breadcrumb, renomear (`F2`), cores, "mostrar só esta pasta" e arrastar itens/pastas. **`Ctrl+S`** salva o projeto numa **pasta real do computador** (Chrome/Edge): cada grupo vira uma pasta com as imagens, sons e post-its (`.md`) dentro, cada arquivo com seu `.meta.json`. O salvamento é incremental (mover um item só atualiza o `.meta.json`), renomear/mover grupos move as pastas, e itens excluídos vão para `_Lixeira/`. Abrir a pasta de novo também traz pastas e imagens adicionadas pelo Explorer. Vários projetos pelo botão 🗂. Em outros navegadores: exportar `.zip` com a mesma estrutura.
5. **Blocos de Texto (Google Blockly → .txt)**: ferramenta **`B`** (ou solte um `.txt` no canvas). Cada card tem um workspace Blockly real com o modo de edição do *blocky-pdf-editor*: clique para editar, **dois cliques na borda** do bloco divide entre as linhas, **`Ctrl+Enter`** divide no cursor, grifo (`Alt+1..4`), **cor do bloco** (paleta ou botão direito), marcadores (pilha nº, separador, espaço, nota) e selos de ordem. Arrastar um bloco para fora do card cria um card novo ou encaixa em outro card. Cada card é salvo como `.txt` na pasta do grupo (blocos = parágrafos), com cores/grifos no `.txt.meta.json`; editar o `.txt` no Notepad refaz os blocos ao reabrir. Projetos `.json` do blocky-pdf-editor também abrem como card. Precisa de internet na primeira carga (Blockly 10.4.3 via unpkg).
6. **Vídeos (.mp4, .mov, .webm, .m4v)**: arraste do computador para o canvas (ou para cima de um frame/pasta do painel). Player com controles nativos, duplo clique = play/pause, botão 🔁 de loop, redimensiona mantendo a proporção. O vídeo fica como arquivo binário no navegador (não pesa no Desfazer) e, ao salvar o Project, vai para a pasta do grupo dele (`Grupo/Subgrupo/video.mp4` + `.meta.json`). O `.mirogrs` leva os vídeos embutidos.

---

## ▶️ Como Executar Localmente

Para abrir com suporte completo a módulos ES6 e Web Audio API, rode qualquer servidor estático na pasta `Miro_GRS`:

```bash
# Opção 1: Com Python
python -m http.server 8080

# Opção 2: Com Node.js (npx)
npx serve -l 8080
```
Depois acesse **`http://localhost:8080`** no seu navegador.

---

## 🌐 Como Publicar Online (Grátis)

O projeto já está configurado com `netlify.toml`, `vercel.json` e GitHub Actions (`.github/workflows/deploy.yml`).

### Opção 1: Netlify Drop (Em 10 segundos, sem conta ou linha de comando)
1. Acesse [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. Arraste a pasta `Miro_GRS` inteira para a área pontilhada no navegador.
3. Seu site estará publicado online com link HTTPS instantaneamente!

### Opção 2: GitHub Pages
1. Crie um repositório no GitHub e suba os arquivos desta pasta.
2. Em **Settings ➔ Pages**, selecione **Source: GitHub Actions**.
3. O workflow `.github/workflows/deploy.yml` publicará automaticamente seu aplicativo.

### Opção 3: Vercel
1. Execute `npx vercel` dentro da pasta `Miro_GRS` e siga as instruções no terminal.
