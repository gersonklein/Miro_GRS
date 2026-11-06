// js/ui-dialogs.js
// Diálogos leves (sem alert/prompt nativos): pedir texto, escolher opção e menu de contexto.

function buildModal(titleText) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop dialog-backdrop';
  const card = document.createElement('div');
  card.className = 'modal-card ui-panel dialog-card';
  const h = document.createElement('div');
  h.className = 'dialog-title';
  h.textContent = titleText;
  card.appendChild(h);
  backdrop.appendChild(card);
  // Impede que atalhos globais (Delete, Tab, letras) disparem enquanto o diálogo está aberto
  card.addEventListener('keydown', (e) => e.stopPropagation());
  card.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(backdrop);
  return { backdrop, card };
}

export function askText({ title, message = '', value = '', placeholder = '', okText = 'OK' }) {
  return new Promise((resolve) => {
    const { backdrop, card } = buildModal(title);
    if (message) {
      const p = document.createElement('p');
      p.className = 'dialog-message';
      p.textContent = message;
      card.appendChild(p);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dialog-input';
    input.value = value;
    input.placeholder = placeholder;
    card.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.className = 'ctx-btn';
    cancel.textContent = 'Cancelar';
    const ok = document.createElement('button');
    ok.className = 'primary-btn';
    ok.textContent = okText;
    actions.append(cancel, ok);
    card.appendChild(actions);

    const close = (val) => {
      backdrop.remove();
      resolve(val);
    };
    ok.addEventListener('click', () => {
      const v = input.value.trim();
      close(v ? v : null);
    });
    cancel.addEventListener('click', () => close(null));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') close(null);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

export function askChoice({ title, message = '', choices = [] }) {
  return new Promise((resolve) => {
    const { backdrop, card } = buildModal(title);
    if (message) {
      const p = document.createElement('p');
      p.className = 'dialog-message';
      p.textContent = message;
      card.appendChild(p);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions dialog-actions-col';
    const close = (val) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = c.primary ? 'primary-btn' : c.danger ? 'ctx-btn danger' : 'ctx-btn';
      b.textContent = c.label;
      b.addEventListener('click', () => close(c.id));
      actions.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ctx-btn';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => close(null));
    actions.appendChild(cancel);
    card.appendChild(actions);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(null);
    });
  });
}

let openMenu = null;

export function closeContextMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

// items: [{ label, action, danger, disabled }] ou { sep: true }
export function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ui-panel context-menu';
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'dropdown-sep';
      menu.appendChild(s);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'context-menu-item' + (it.danger ? ' danger-text' : '');
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      it.action?.();
    });
    menu.appendChild(b);
  }
  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  openMenu = menu;
  setTimeout(() => {
    window.addEventListener('mousedown', closeContextMenu, { once: true });
  }, 0);
}
