function matches(el, selector) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  let rest = selector;
  if (rest.startsWith(".")) {
    const className = rest.slice(1).split(/[#\[]/)[0];
    const classes = String(el.className || "").split(/\s+/);
    if (!classes.includes(className)) {
      return false;
    }
    rest = rest.slice(1 + className.length);
  }
  const attr = rest.match(/^([a-z0-9-]*)\[([a-z-]+)="([^"]*)"\]$/i);
  if (attr) {
    const [, tag, name, value] = attr;
    if (tag && el.tagName !== tag.toUpperCase()) {
      return false;
    }
    return el.getAttribute(name) === value || el[name] === value;
  }
  if (rest.startsWith("#")) {
    return el.id === rest.slice(1);
  }
  if (rest && el.tagName !== rest.toUpperCase()) {
    return false;
  }
  return true;
}

function walk(el, selector, out) {
  for (const child of el.children || []) {
    if (child.nodeType !== 1) {
      continue;
    }
    if (matches(child, selector)) {
      out.push(child);
    }
    walk(child, selector, out);
  }
}

function selectorParts(selector) {
  const parts = [];
  let current = "";
  let quote = "";
  for (const char of selector.trim()) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

export function queryAll(root, selector) {
  const parts = selectorParts(selector);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const node of current) {
      walk(node, part, next);
    }
    current = next;
  }
  return current;
}

function createNode(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: "",
    id: "",
    children: [],
    parentElement: null,
    style: {},
    dataset: {},
    attributes: {},
    listeners: {},
    textContent: "",
    title: "",
    type: "",
    name: "",
    value: "",
    placeholder: "",
    checked: false,
    disabled: false,
    hidden: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    tabIndex: 0,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "id") {
        this.id = String(value);
      }
      if (name === "class") {
        this.className = String(value);
      }
      if (name === "title") {
        this.title = String(value);
      }
      if (name === "src") {
        this.src = String(value);
      }
      if (name === "hidden") {
        this.hidden = true;
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "hidden") {
        this.hidden = false;
      }
      if (name === "src" && Object.prototype.hasOwnProperty.call(this, "src")) {
        delete this.src;
      }
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node == null) {
          continue;
        }
        if (typeof node === "string") {
          this.children.push({ nodeType: 3, textContent: node });
          continue;
        }
        node.parentElement = this;
        this.children.push(node);
      }
      if (String(this.className || "").includes("process-log-drawer-body")) {
        this.clientHeight = this.clientHeight || 180;
        this.scrollHeight = Math.max(this.clientHeight, this.children.length * 20);
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      if (nodes.length) {
        this.append(...nodes);
      } else if (String(this.className || "").includes("process-log-drawer-body")) {
        this.clientHeight = this.clientHeight || 180;
        this.scrollHeight = this.clientHeight;
      }
    },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    click() {
      for (const fn of this.listeners.click || []) {
        fn({
          preventDefault() {},
          stopPropagation() {},
          target: this,
        });
      }
    },
    remove() {
      if (!this.parentElement) {
        return;
      }
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
    querySelectorAll(selector) {
      return queryAll(this, selector);
    },
    querySelector(selector) {
      return queryAll(this, selector)[0] || null;
    },
    focus() {
      this.focused = true;
    },
  };
  return el;
}

export function installDocument() {
  const previous = globalThis.document;
  const document = {
    createElement: createNode,
    createElementNS(_namespace, tag) {
      return createNode(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };
  globalThis.document = document;
  return {
    document,
    restore() {
      globalThis.document = previous;
    },
  };
}

export function leafText(root) {
  const texts = [];
  function visit(node) {
    if (!node || node.nodeType !== 1) {
      if (node?.nodeType === 3) {
        texts.push(node.textContent);
      }
      return;
    }
    if (!node.children.length && node.textContent) {
      texts.push(node.textContent);
    }
    for (const child of node.children) {
      visit(child);
    }
  }
  visit(root);
  return texts;
}
