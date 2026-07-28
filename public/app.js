// ---------- État ----------
const state = {
  chatId: null,        // id de la discussion courante (null = pas encore sauvée)
  title: null,
  messages: [],        // [{ role, content }]
  model: localStorage.getItem("last-model") || "",
  models: [],
  favorites: [],       // model ids favoris (⭐)
  recents: [],         // model ids récemment utilisés (↻)
  createdAt: null,
  streaming: false,
  abortController: null,
  pending: [],         // pièces jointes en attente : {type,name,mime,dataUrl,text?}
  onlyImageModels: false, // filtre : n'afficher que les modèles qui génèrent des images
  expanded: {},        // groupes explicitement ouverts : { "prov:OpenAI": true }
  // Réglages par défaut (côté serveur, prefs.json) : appliqués aux NOUVELLES
  // discussions. Modifiables et surchargeables au cas par cas.
  defaults: { temperature: 1, maxTokens: 0, systemPrompt: "", webSearch: false, adv: newAdv() },
  // Réglages de la discussion COURANTE (seed depuis defaults, persistés avec le chat).
  systemPrompt: "",
  settings: { temperature: 1, maxTokens: 0, webSearch: false, adv: newAdv() },
  quote: null,         // passage cité en attente (quote-reply)
};

// Réglages avancés vides (valeurs "non définies" = on n'envoie pas le paramètre).
function newAdv() {
  return {
    topP: null,        // 0..1
    freqPenalty: null, // -2..2
    presPenalty: null, // -2..2
    seed: null,        // entier
    reasoning: "",     // "" | "low" | "medium" | "high"
    stop: "",          // séquences séparées par des virgules
  };
}

// ---------- Raccourcis DOM ----------
const $ = (sel) => document.querySelector(sel);
const el = {
  app: $("#app"),
  chatList: $("#chat-list"),
  messages: $("#messages"),
  input: $("#input"),
  send: $("#send"),
  stop: $("#stop"),
  newChat: $("#new-chat"),
  modelBtn: $("#model-btn"),
  modelBtnLabel: $("#model-btn-label"),
  modelPanel: $("#model-panel"),
  modelTree: $("#model-tree"),
  modelFilter: $("#model-filter"),
  favToggle: $("#fav-toggle"),
  imgFilter: $("#img-filter"),
  status: $("#status"),
  toggleSidebar: $("#toggle-sidebar"),
  composer: $("#composer"),
  attachments: $("#attachments"),
  attachBtn: $("#attach-btn"),
  fileInput: $("#file-input"),
  dropHint: $("#drop-hint"),
  lightbox: $("#lightbox"),
  lightboxImg: $("#lightbox-img"),
  lightboxClose: $("#lightbox-close"),
  lightboxDl: $("#lightbox-dl"),
  settingsBtn: $("#settings-btn"),
  settingsBtnBottom: $("#settings-btn-bottom"),
  settingsModal: $("#settings-modal"),
  settingsClose: $("#settings-close"),
  quickModal: $("#quick-modal"),
  quickClose: $("#quick-close"),
  systemPrompt: $("#system-prompt"),
  webSearch: $("#web-search"),
  tempRange: $("#temp-range"),
  tempVal: $("#temp-val"),
  maxTok: $("#maxtok"),
  setDefaultBtn: $("#set-default-btn"),
  setDefaultOk: $("#set-default-ok"),
  defWebSearch: $("#def-web-search"),
  defTempRange: $("#def-temp-range"),
  defTempVal: $("#def-temp-val"),
  defMaxTok: $("#def-maxtok"),
  advSection: $("#adv-section"),
  advToggle: $("#adv-toggle"),
  advTopp: $("#adv-topp"),
  advToppVal: $("#adv-topp-val"),
  advFreq: $("#adv-freq"),
  advFreqVal: $("#adv-freq-val"),
  advPres: $("#adv-pres"),
  advPresVal: $("#adv-pres-val"),
  advSeed: $("#adv-seed"),
  advReasoning: $("#adv-reasoning"),
  advStop: $("#adv-stop"),
  warnWeb: $("#warn-web"),
  warnTemp: $("#warn-temp"),
  warnTopp: $("#warn-topp"),
  warnFreq: $("#warn-freq"),
  warnPres: $("#warn-pres"),
  warnSeed: $("#warn-seed"),
  warnReasoning: $("#warn-reasoning"),
  warnStop: $("#warn-stop"),
  usageBtn: $("#usage-btn"),
  usageModal: $("#usage-modal"),
  usageClose: $("#usage-close"),
  usageBody: $("#usage-body"),
  quoteReply: $("#quote-reply"),
  quotePreview: $("#quote-preview"),
  messagesEl: $("#messages"),
};

// ---------- Icônes (SVG ligne, style épuré) ----------
// Chaque icône est un <svg> 24x24, stroke=currentColor : hérite de la couleur du bouton.
const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  star: '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.8 6.2 21.9l1.1-6.5L2.6 9.8l6.5-.9z"/>',
  starFill:
    '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.8 6.2 21.9l1.1-6.5L2.6 9.8l6.5-.9z" fill="currentColor" stroke="none"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  chart:
    '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12" y="7" width="3" height="10" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  paperclip:
    '<path d="M21.4 11.1l-9.2 9.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  copy:
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5"/>',
  edit:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  file:
    '<path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  eye:
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  trash:
    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
};

// Renvoie une chaîne <svg> pour l'icône donnée.
function svgIcon(name, size = 18) {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`
  );
}
// Petit élément span contenant l'icône (pour concaténer avec du texte).
function iconEl(name, size = 15) {
  const s = document.createElement("span");
  s.className = "ic";
  s.innerHTML = svgIcon(name, size);
  return s;
}

// Remplit les boutons statiques (topbar, composer, modales) avec leurs icônes.
function installIcons() {
  const map = {
    "#toggle-sidebar": "menu",
    "#usage-btn": "chart",
    "#settings-btn": "settings",
    "#settings-btn-bottom": "settings",
    "#attach-btn": "paperclip",
    "#img-filter": "image",
    "#settings-close": "close",
    "#usage-close": "close",
    "#lightbox-close": "close",
  };
  for (const [sel, name] of Object.entries(map)) {
    const node = document.querySelector(sel);
    if (node) node.innerHTML = svgIcon(name, sel.includes("close") ? 18 : 19);
  }
  const dl = document.querySelector("#lightbox-dl");
  if (dl) dl.innerHTML = svgIcon("download", 20);
  const chev = document.querySelector("#model-btn .chev");
  if (chev) chev.innerHTML = svgIcon("chevron", 15);
  const advChev = document.querySelector("#adv-toggle .adv-chev");
  if (advChev) advChev.innerHTML = svgIcon("chevron", 14);
}

// ---------- Lightbox ----------
function openLightbox(src) {
  el.lightboxImg.src = src;
  const m = /^data:image\/(\w+)/.exec(src);
  el.lightboxDl.href = src;
  el.lightboxDl.download = `image-${Date.now()}.${m ? m[1] : "png"}`;
  el.lightbox.hidden = false;
}
function closeLightbox() {
  el.lightbox.hidden = true;
  el.lightboxImg.src = "";
}

// Le modèle courant, avec ses capacités (objet du tableau state.models).
function currentModel() {
  return state.models.find((m) => m.id === state.model) || null;
}

// ---------- Utilitaires ----------
function genId() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Rendu markdown complet via markdown-it + coloration highlight.js,
// puis nettoyage anti-XSS via DOMPurify. Gère tableaux, listes, titres,
// citations, liens, code coloré.
const md = window.markdownit({
  html: false, // on n'accepte pas le HTML brut du modèle
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && window.hljs && window.hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs"><code>' +
          window.hljs.highlight(str, { language: lang, ignoreIllegals: true })
            .value +
          "</code></pre>"
        );
      } catch {}
    }
    return (
      '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
    );
  },
});

// Les liens s'ouvrent dans un nouvel onglet.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

function renderMarkdown(text) {
  const raw = md.render(text || "");
  return window.DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
}

// ---------- Coût / tokens ----------
// Normalise l'objet usage d'OpenRouter en { in, out, total, cost }.
function normalizeUsage(usage, model) {
  if (!usage) return null;
  return {
    in: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    out: usage.completion_tokens ?? usage.output_tokens ?? 0,
    total: usage.total_tokens ?? 0,
    cost: typeof usage.cost === "number" ? usage.cost : null,
  };
}

// Formate un usage pour l'affichage compact sous une réponse.
function formatUsage(u) {
  if (!u) return "";
  const toks = `${u.total || u.in + u.out} tok`;
  return u.cost != null ? `${toks} · $${u.cost.toFixed(u.cost < 0.01 ? 5 : 4)}` : toks;
}

// Total de la discussion (somme des usages assistant).
function chatTotals() {
  let tokens = 0,
    cost = 0,
    hasCost = false;
  for (const m of state.messages) {
    if (m.role === "assistant" && m.usage) {
      tokens += m.usage.total || m.usage.in + m.usage.out;
      if (m.usage.cost != null) {
        cost += m.usage.cost;
        hasCost = true;
      }
    }
  }
  return { tokens, cost, hasCost };
}

// Met à jour la barre de coût total (dans la topbar).
function renderCostBar() {
  const { tokens, cost, hasCost } = chatTotals();
  if (!tokens) {
    el.status.textContent = "";
    return;
  }
  el.status.textContent =
    `Σ ${tokens} tok` + (hasCost ? ` · $${cost.toFixed(cost < 0.01 ? 5 : 4)}` : "");
}

// Copie le contenu d'un bloc de code (bouton injecté au survol).
function enhanceCodeBlocks(container) {
  for (const pre of container.querySelectorAll("pre")) {
    if (pre.querySelector(".code-copy")) continue;
    const btn = document.createElement("button");
    btn.className = "code-copy";
    btn.textContent = "Copier";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(() => {
        btn.textContent = "Copié ✓";
        setTimeout(() => (btn.textContent = "Copier"), 1200);
      });
    });
    pre.appendChild(btn);
  }
}

function setStatus(msg) {
  el.status.textContent = msg || "";
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

// ---------- Rendu des messages ----------
function renderMessages() {
  el.messages.innerHTML = "";
  if (state.messages.length === 0) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<h2>Nouvelle discussion</h2>
      <p>Choisis un modèle en haut et écris ton premier message.</p>`;
    el.messages.appendChild(div);
    return;
  }
  for (const m of state.messages) {
    el.messages.appendChild(makeMessageEl(m.role, m.content, m));
  }
  scrollToBottom();
}

// Compteur global pour nommer les fichiers téléchargés de façon unique.
let genImageCounter = 0;

// Construit une image générée : vignette (petite) + bouton de téléchargement.
function makeGenImage(src) {
  const fig = document.createElement("div");
  fig.className = "gen-image-wrap";

  const img = document.createElement("img");
  img.className = "gen-image";
  img.src = src;
  img.alt = "image générée";
  // Clic sur l'image = agrandissement dans la lightbox.
  img.addEventListener("click", () => openLightbox(src));
  fig.appendChild(img);

  const dl = document.createElement("a");
  dl.className = "gen-image-dl";
  dl.appendChild(iconEl("download", 14));
  dl.appendChild(document.createTextNode(" Télécharger"));
  dl.href = src;
  // Déduit une extension à partir du data URL (png par défaut).
  const m = /^data:image\/(\w+)/.exec(src);
  const ext = m ? m[1] : "png";
  dl.download = `image-${Date.now()}-${++genImageCounter}.${ext}`;
  fig.appendChild(dl);

  return fig;
}

// role, content (texte), et msg complet (pour attachments/images éventuels).
function makeMessageEl(role, content, msg = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const label =
    role === "user" ? "Toi" : role === "assistant" ? "Assistant" : "Erreur";
  const roleEl = document.createElement("div");
  roleEl.className = "role";
  roleEl.textContent = label;
  wrap.appendChild(roleEl);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Pièces jointes envoyées par l'utilisateur (au-dessus du texte).
  if (Array.isArray(msg.attachments) && msg.attachments.length) {
    const av = document.createElement("div");
    av.className = "attachments-view";
    for (const a of msg.attachments) {
      if (a.type === "image") {
        const img = document.createElement("img");
        img.src = a.dataUrl;
        img.alt = a.name || "image";
        img.addEventListener("click", () => openLightbox(a.dataUrl));
        av.appendChild(img);
      } else {
        const pill = document.createElement("span");
        pill.className = "file-pill";
        pill.appendChild(iconEl("file", 14));
        pill.appendChild(document.createTextNode(" " + (a.name || "document")));
        av.appendChild(pill);
      }
    }
    bubble.appendChild(av);
  }

  // Texte : markdown pour l'assistant, brut sinon.
  if (content) {
    const textEl = document.createElement("div");
    if (role === "assistant") {
      textEl.innerHTML = renderMarkdown(content);
      enhanceCodeBlocks(textEl);
    } else textEl.textContent = content;
    bubble.appendChild(textEl);
  }

  // Images générées par l'assistant (au-dessous du texte).
  if (Array.isArray(msg.images) && msg.images.length) {
    for (const src of msg.images) {
      bubble.appendChild(makeGenImage(src));
    }
  }

  wrap.appendChild(bubble);

  // Petit bouton d'action (icône + label) sous une bulle.
  function actBtn(iconName, label, handler) {
    const b = document.createElement("button");
    b.className = "msg-act";
    b.appendChild(iconEl(iconName, 14));
    b.appendChild(document.createTextNode(" " + label));
    b.addEventListener("click", handler);
    return b;
  }

  // Barre d'actions (copier / régénérer / éditer) sous la bulle.
  if (role === "assistant" || role === "user") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    if (content) {
      const copyBtn = actBtn("copy", "Copier", () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.lastChild.textContent = " Copié";
          setTimeout(() => (copyBtn.lastChild.textContent = " Copier"), 1200);
        });
      });
      actions.appendChild(copyBtn);
    }

    if (role === "assistant") {
      const lastAssistant = [...state.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (msg === lastAssistant) {
        actions.appendChild(actBtn("refresh", "Régénérer", regenerateLast));
      }
      if (msg.usage) {
        const cost = document.createElement("span");
        cost.className = "msg-cost";
        cost.textContent = formatUsage(msg.usage);
        cost.title = "Tokens et coût de cette réponse";
        actions.appendChild(cost);
      }
    }

    if (role === "user") {
      const idx = state.messages.indexOf(msg);
      if (idx !== -1) {
        actions.appendChild(actBtn("edit", "Éditer", () => editUserMessage(idx)));
      }
    }

    if (actions.children.length) wrap.appendChild(actions);
  }

  return wrap;
}

// ---------- Liste des discussions ----------
async function loadChatList() {
  try {
    const r = await fetch("/api/chats");
    const { chats } = await r.json();
    el.chatList.innerHTML = "";
    for (const c of chats) {
      const li = document.createElement("li");
      if (c.id === state.chatId) li.classList.add("active");
      const title = document.createElement("span");
      title.className = "chat-title";
      title.textContent = c.title;
      title.title = c.title;
      const del = document.createElement("button");
      del.className = "del";
      del.innerHTML = svgIcon("trash", 16);
      del.title = "Supprimer";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(c.id);
      });
      li.appendChild(title);
      li.appendChild(del);
      li.addEventListener("click", () => openChat(c.id));
      el.chatList.appendChild(li);
    }
  } catch (e) {
    console.error("liste discussions:", e);
  }
}

async function openChat(id) {
  if (state.streaming) return;
  try {
    const r = await fetch("/api/chats/" + encodeURIComponent(id));
    if (!r.ok) throw new Error("introuvable");
    const data = await r.json();
    state.chatId = data.id;
    state.title = data.title;
    state.messages = data.messages || [];
    state.createdAt = data.createdAt || Date.now();
    state.systemPrompt = data.systemPrompt || "";
    // Réglages de la discussion (sinon on retombe sur les défauts).
    state.settings = {
      temperature: Number(data.settings?.temperature ?? state.defaults.temperature),
      maxTokens: Number(data.settings?.maxTokens ?? state.defaults.maxTokens),
      webSearch: Boolean(data.settings?.webSearch ?? state.defaults.webSearch),
      adv: sanitizeAdv(data.settings?.adv ?? state.defaults.adv),
    };
    state.pending = [];
    renderAttachments();
    updateSettingsIndicators();
    if (data.model) {
      state.model = data.model;
      updateModelButton();
      updateFavToggle();
    }
    renderMessages();
    renderCostBar();
    loadChatList();
    setUrlChat(data.id); // mémorise la discussion dans l'URL (#id)
  } catch (e) {
    setStatus("Impossible d'ouvrir la discussion");
  }
}

function newChat() {
  if (state.streaming) return;
  state.chatId = null;
  state.title = null;
  state.messages = [];
  state.createdAt = null;
  state.pending = [];
  applyDefaultsToCurrent(); // nouvelle discussion = réglages par défaut
  updateSettingsIndicators();
  renderAttachments();
  renderMessages();
  renderCostBar();
  loadChatList();
  setUrlChat(null); // enlève l'id de l'URL
  el.input.focus();
}

// Met à jour le hash de l'URL avec l'id de discussion (sans recharger la page).
// État de modale reflété dans l'URL (?m=settings|quick|usage).
let urlModal = null;
function setUrlChat(id) {
  urlChatId = id || null;
  writeUrl();
}
function setUrlModal(name) {
  urlModal = name || null;
  writeUrl();
}
let urlChatId = null;
function writeUrl() {
  const q = urlModal ? "?m=" + urlModal : "";
  const h = urlChatId ? "#" + urlChatId : "";
  const target = location.pathname + q + h;
  if (location.pathname + location.search + location.hash !== target) {
    history.replaceState(null, "", target || location.pathname);
  }
}

async function deleteChat(id) {
  if (!confirm("Supprimer cette discussion ?")) return;
  await fetch("/api/chats/" + encodeURIComponent(id), { method: "DELETE" });
  if (id === state.chatId) newChat();
  else loadChatList();
}

// Sauvegarde la discussion courante sur le serveur (fichier JSON).
async function persist() {
  if (state.messages.length === 0) return;
  if (!state.chatId) {
    state.chatId = genId();
    state.createdAt = Date.now();
    setUrlChat(state.chatId); // nouvelle discussion : on la met dans l'URL
  }
  // Titre = début du premier message utilisateur.
  if (!state.title) {
    const firstUser = state.messages.find((m) => m.role === "user");
    state.title = firstUser
      ? firstUser.content.slice(0, 60).replace(/\n/g, " ")
      : "Sans titre";
  }
  try {
    await fetch("/api/chats/" + encodeURIComponent(state.chatId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: state.title,
        model: state.model,
        messages: state.messages,
        systemPrompt: state.systemPrompt || "",
        settings: state.settings,
        createdAt: state.createdAt,
      }),
    });
    loadChatList();
  } catch (e) {
    console.error("sauvegarde:", e);
    setStatus("⚠️ sauvegarde impossible");
  }
}

// ---------- Modèles ----------
async function loadModels() {
  try {
    setStatus("chargement des modèles…");
    const r = await fetch("/api/models");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "erreur");
    state.models = data.models || [];
    populateModels();
    setStatus("");
  } catch (e) {
    setStatus("⚠️ modèles indisponibles (clé .env ?)");
    // On laisse quand même saisir un modèle à la main via un fallback.
    state.models = [];
    populateModels();
  }
}

// Nom de provider lisible à partir de l'id (ex. "openai/gpt-5" -> "Openai")
// ou du nom OpenRouter (ex. "OpenAI: GPT-5" -> "OpenAI").
function providerOf(m) {
  if (m.name && m.name.includes(":")) return m.name.split(":")[0].trim();
  const slug = (m.id || "").split("/")[0] || "Autres";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

// Nom d'icône de capacité d'un modèle (image générée / vision), ou null.
function capIcon(m) {
  if (m.canImageOut) return "image";
  if (m.canImageIn) return "eye";
  return null;
}

// Construit une ligne « modèle » cliquable dans l'arborescence.
function makeModelItem(m) {
  const item = document.createElement("div");
  item.className = "mt-item" + (m.id === state.model ? " selected" : "");
  item.dataset.id = m.id;

  const ci = capIcon(m);
  if (ci) {
    const b = iconEl(ci, 15);
    b.classList.add("mt-cap", ci === "image" ? "cap-gen" : "cap-vision");
    item.appendChild(b);
  }
  const name = document.createElement("span");
  name.className = "mt-name";
  name.textContent = m.name || m.id;
  name.title = m.id;
  item.appendChild(name);

  const star = document.createElement("button");
  const isFav = state.favorites.includes(m.id);
  star.className = "mt-star" + (isFav ? " on" : "");
  star.innerHTML = svgIcon(isFav ? "starFill" : "star", 15);
  star.title = isFav ? "Retirer des favoris" : "Ajouter aux favoris";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavoriteFor(m.id);
  });
  item.appendChild(star);

  item.addEventListener("click", () => selectModel(m.id));
  return item;
}

// Construit un groupe dépliable (Favoris, Récents, ou un provider).
// `collapsed` = état d'affichage (le caller décide du défaut).
function makeTreeGroup(
  label,
  models,
  { collapsible = true, key = label, collapsed = false, icon = null } = {}
) {
  if (models.length === 0) return null;
  const group = document.createElement("div");
  group.className = "mt-group";
  if (collapsed) group.classList.add("collapsed");

  const head = document.createElement("button");
  head.className = "mt-group-head";
  if (collapsible) {
    // Chevron SVG ; la rotation (fermé → droite) est gérée en CSS.
    const tw = document.createElement("span");
    tw.className = "tw";
    tw.innerHTML = svgIcon("chevron", 16);
    head.appendChild(tw);
  }
  if (icon) {
    const gi = iconEl(icon, 15);
    gi.classList.add("mt-group-ic");
    head.appendChild(gi);
  }
  const lbl = document.createElement("span");
  lbl.textContent = label;
  head.appendChild(lbl);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = models.length;
  head.appendChild(count);
  if (collapsible) {
    head.addEventListener("click", () => {
      // Bascule instantanée (sans tout reconstruire) + mémorise l'état.
      const nowCollapsed = group.classList.toggle("collapsed");
      state.expanded[key] = !nowCollapsed;
    });
  }
  group.appendChild(head);

  const children = document.createElement("div");
  children.className = "mt-children";
  for (const m of models) children.appendChild(makeModelItem(m));
  group.appendChild(children);
  return group;
}

// (Re)construit l'arborescence complète dans le panneau.
function renderTree() {
  const filter = el.modelFilter.value.trim().toLowerCase();
  const match = (m) => {
    if (state.onlyImageModels && !m.canImageOut) return false;
    if (!filter) return true;
    return (
      m.id.toLowerCase().includes(filter) ||
      m.name.toLowerCase().includes(filter)
    );
  };
  const byId = (id) => state.models.find((m) => m.id === id);

  el.modelTree.innerHTML = "";

  if (state.models.length === 0) {
    const e = document.createElement("div");
    e.className = "mt-empty";
    e.textContent = "Aucun modèle — vérifie ta clé.";
    el.modelTree.appendChild(e);
    return;
  }

  const list = state.models.filter(match);

  // Favoris & récents (dédupliqués, filtrés).
  const favModels = state.favorites.map(byId).filter(Boolean).filter(match);
  const recentModels = state.recents
    .map(byId)
    .filter(Boolean)
    .filter(match)
    .filter((m) => !state.favorites.includes(m.id));

  const searching = Boolean(filter);

  // Favoris & Récents : toujours ouverts en haut.
  const favG = makeTreeGroup("Favoris", favModels, {
    key: "__fav",
    collapsed: false,
    icon: "starFill",
  });
  if (favG) el.modelTree.appendChild(favG);
  const recG = makeTreeGroup("Récents", recentModels, {
    key: "__rec",
    collapsed: false,
    icon: "refresh",
  });
  if (recG) el.modelTree.appendChild(recG);

  // Le reste, groupé par provider (trié alphabétiquement).
  const pinned = new Set([...state.favorites, ...recentModels.map((m) => m.id)]);
  const byProvider = new Map();
  for (const m of list) {
    if (pinned.has(m.id)) continue;
    const p = providerOf(m);
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p).push(m);
  }
  const providers = [...byProvider.keys()].sort((a, b) => a.localeCompare(b));

  for (const p of providers) {
    const models = byProvider.get(p);
    const key = "prov:" + p;
    // Repliés par défaut. Ouverts si l'utilisateur les a ouverts, ou en recherche.
    const collapsed = searching ? false : !state.expanded[key];
    const g = makeTreeGroup(p, models, { key, collapsed });
    if (g) el.modelTree.appendChild(g);
  }

  if (!el.modelTree.children.length) {
    const e = document.createElement("div");
    e.className = "mt-empty";
    e.textContent = "Aucun résultat.";
    el.modelTree.appendChild(e);
  }
}

// Met à jour le libellé du bouton + l'étoile, et reconstruit l'arbre.
function populateModels() {
  updateModelButton();
  renderTree();
  updateFavToggle();
}

function updateModelButton() {
  const cm = currentModel();
  el.modelBtnLabel.innerHTML = "";
  if (cm) {
    const ci = capIcon(cm);
    if (ci) el.modelBtnLabel.appendChild(iconEl(ci, 15));
    el.modelBtnLabel.appendChild(
      document.createTextNode((ci ? " " : "") + (cm.name || cm.id))
    );
  } else {
    el.modelBtnLabel.textContent = state.model || "Choisir un modèle…";
  }
}

// Sélectionne un modèle, ferme le panneau.
function selectModel(id) {
  state.model = id;
  localStorage.setItem("last-model", id);
  pushRecent(id); // remonte le modèle dans les récents dès la sélection
  updateModelButton();
  updateFavToggle();
  renderTree();
  refreshWarnings(); // avertissements mis à jour selon le nouveau modèle
  closeModelPanel();
}

// ---------- Favoris / récents (préférences serveur) ----------
async function loadPrefs() {
  try {
    const r = await fetch("/api/prefs");
    const p = await r.json();
    state.favorites = Array.isArray(p.favorites) ? p.favorites : [];
    state.recents = Array.isArray(p.recents) ? p.recents : [];
    if (p.defaults) {
      state.defaults = {
        temperature: Number(p.defaults.temperature ?? 1),
        maxTokens: Number(p.defaults.maxTokens ?? 0),
        systemPrompt: p.defaults.systemPrompt || "",
        webSearch: Boolean(p.defaults.webSearch),
        adv: sanitizeAdv(p.defaults.adv),
      };
    }
  } catch {
    state.favorites = [];
    state.recents = [];
  }
  // La discussion démarre avec les réglages par défaut.
  applyDefaultsToCurrent();
}

// Normalise un objet de réglages avancés (depuis prefs ou un chat).
function sanitizeAdv(a) {
  const out = newAdv();
  if (a && typeof a === "object") {
    if (typeof a.topP === "number") out.topP = a.topP;
    if (typeof a.freqPenalty === "number") out.freqPenalty = a.freqPenalty;
    if (typeof a.presPenalty === "number") out.presPenalty = a.presPenalty;
    if (Number.isInteger(a.seed)) out.seed = a.seed;
    if (["low", "medium", "high"].includes(a.reasoning)) out.reasoning = a.reasoning;
    if (typeof a.stop === "string") out.stop = a.stop;
  }
  return out;
}

// Copie les réglages par défaut dans la discussion courante (nouvelle discussion).
function applyDefaultsToCurrent() {
  state.settings = {
    temperature: state.defaults.temperature,
    maxTokens: state.defaults.maxTokens,
    webSearch: state.defaults.webSearch,
    adv: sanitizeAdv(state.defaults.adv),
  };
  state.systemPrompt = state.defaults.systemPrompt || "";
}

// Sauvegarde les réglages par défaut côté serveur.
async function saveDefaults() {
  try {
    await fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaults: state.defaults }),
    });
  } catch {
    setStatus("⚠️ défauts non sauvés");
  }
}

// Indicateurs visuels sur les boutons ⚙ (prompt système / recherche web actifs).
function updateSettingsIndicators() {
  el.settingsBtn.classList.toggle("has-system", Boolean(state.systemPrompt.trim()));
  el.settingsBtnBottom.classList.toggle(
    "has-web",
    Boolean(state.settings.webSearch)
  );
}

function updateFavToggle() {
  const isFav = state.model && state.favorites.includes(state.model);
  el.favToggle.innerHTML = svgIcon(isFav ? "starFill" : "star", 18);
  el.favToggle.classList.toggle("is-fav", Boolean(isFav));
  el.favToggle.title = isFav ? "Retirer des favoris" : "Ajouter aux favoris";
  updateComposerCaps();
}

// Adapte le composer aux capacités du modèle courant (badge génération d'image,
// info sur la vision). On ne bloque rien : les docs texte marchent partout.
function updateComposerCaps() {
  const cm = currentModel();
  if (!cm) {
    el.attachBtn.title = "Joindre une image ou un document";
    return;
  }
  const bits = [];
  if (cm.canImageIn) bits.push("vision");
  if (cm.canImageOut) bits.push("génère des images");
  el.attachBtn.title = cm.canImageIn
    ? "Joindre une image ou un document"
    : "Ce modèle ne « voit » pas les images — les documents texte marchent quand même";
  // Indice discret dans le placeholder du champ de saisie.
  el.input.placeholder = cm.canImageOut
    ? "Décris l'image à générer, ou écris ton message…"
    : "Écris ton message…  (Entrée = envoyer, Maj+Entrée = nouvelle ligne)";
}

async function toggleFavoriteFor(id) {
  if (!id) return;
  const i = state.favorites.indexOf(id);
  if (i === -1) state.favorites.push(id);
  else state.favorites.splice(i, 1);
  populateModels();
  try {
    await fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: state.favorites }),
    });
  } catch {
    setStatus("⚠️ favoris non sauvés");
  }
}
// Étoile du topbar : agit sur le modèle courant.
function toggleFavorite() {
  toggleFavoriteFor(state.model);
}

// ---------- Panneau de sélection (ouvrir/fermer) ----------
function openModelPanel() {
  el.modelPanel.hidden = false;
  el.modelBtn.classList.add("open");
  renderTree();
  el.modelFilter.value = "";
  setTimeout(() => el.modelFilter.focus(), 0);
}
function closeModelPanel() {
  el.modelPanel.hidden = true;
  el.modelBtn.classList.remove("open");
}
function toggleModelPanel() {
  if (el.modelPanel.hidden) openModelPanel();
  else closeModelPanel();
}

// Pousse le modèle courant en tête des récents (appelé après un envoi réussi).
async function pushRecent(modelId) {
  state.recents = [modelId, ...state.recents.filter((m) => m !== modelId)].slice(
    0,
    8
  );
  try {
    await fetch("/api/prefs/recent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId }),
    });
  } catch {
    /* pas grave si l'écriture échoue */
  }
}

// Construit le champ `content` au format OpenRouter à partir d'un message
// interne (texte + attachments). Renvoie une string simple si pas de pièce
// jointe, sinon un tableau de parts (texte + image_url + file).
function toApiContent(m) {
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  if (atts.length === 0) return m.content || "";

  const parts = [];
  let text = m.content || "";
  // Les documents texte sont injectés dans le message (fonctionne partout).
  for (const a of atts) {
    if (a.type === "text") {
      text += `\n\n--- ${a.name} ---\n${a.text}`;
    }
  }
  if (text.trim()) parts.push({ type: "text", text });

  for (const a of atts) {
    if (a.type === "image") {
      parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
    } else if (a.type === "file") {
      // PDF (et autres) envoyés nativement.
      parts.push({
        type: "file",
        file: { filename: a.name, file_data: a.dataUrl },
      });
    }
  }
  return parts;
}

// Prépare les messages pour l'API (rôles user/assistant, contenu multimodal).
function buildApiMessages() {
  return state.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: toApiContent(m) }));
}

// ---------- Envoi + streaming ----------

// Cœur du streaming : envoie l'historique courant à OpenRouter et remplit
// `assistantMsg` (déjà rendu dans `assistantEl`). Retourne l'issue.
async function streamAssistant(assistantMsg, assistantEl) {
  const bubble = assistantEl.querySelector(".bubble");
  bubble.classList.add("cursor");

  state.streaming = true;
  el.send.hidden = true; // Stop remplace Envoyer pendant la génération
  el.stop.hidden = false;
  setStatus("génération…");
  state.abortController = new AbortController();

  let acc = "";
  const genImages = [];
  let usage = null;
  let gotError = null;

  const repaint = () => {
    bubble.innerHTML = "";
    if (acc) {
      const t = document.createElement("div");
      t.innerHTML = renderMarkdown(acc);
      bubble.appendChild(t);
    }
    for (const src of genImages) bubble.appendChild(makeGenImage(src));
  };

  const cm = currentModel();
  const wantsImage = cm && cm.canImageOut;
  // Recherche web : suffixe :online sur l'id du modèle (activation OpenRouter).
  const modelId =
    state.settings.webSearch && !wantsImage && !state.model.endsWith(":online")
      ? state.model + ":online"
      : state.model;

  // Réglages avancés : on ne joint que ceux qui sont définis.
  const adv = state.settings.adv || {};
  const stopSeq = (adv.stop || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const advPayload = {};
  if (adv.topP != null) advPayload.top_p = adv.topP;
  if (adv.freqPenalty != null) advPayload.frequency_penalty = adv.freqPenalty;
  if (adv.presPenalty != null) advPayload.presence_penalty = adv.presPenalty;
  if (adv.seed != null) advPayload.seed = adv.seed;
  if (adv.reasoning) advPayload.reasoning_effort = adv.reasoning;
  if (stopSeq.length) advPayload.stop = stopSeq;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: buildApiMessages(),
        system: state.systemPrompt || undefined,
        temperature: state.settings.temperature,
        max_tokens: state.settings.maxTokens || undefined,
        ...advPayload,
        ...(wantsImage ? { modalities: ["image", "text"] } : {}),
      }),
      signal: state.abortController.signal,
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${r.status}`);
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]" || payload === "") return;
      try {
        const json = JSON.parse(payload);
        if (json.error) {
          gotError =
            typeof json.error === "string" ? json.error : json.error.message;
          return;
        }
        // Usage / coût (OpenRouter l'envoie dans le dernier chunk).
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta;
        if (!delta) return;
        if (typeof delta.content === "string" && delta.content) {
          acc += delta.content;
          repaint();
          scrollToBottom();
        }
        if (Array.isArray(delta.images)) {
          for (const im of delta.images) {
            const url = im?.image_url?.url || im?.url;
            if (url) {
              genImages.push(url);
              repaint();
              scrollToBottom();
            }
          }
        }
      } catch {
        // ligne partielle : on ignore
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line.replace(/\r$/, ""));
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer.replace(/\r$/, ""));
  } catch (e) {
    if (e.name !== "AbortError") gotError = e.message;
  }

  bubble.classList.remove("cursor");
  state.streaming = false;
  state.abortController = null;
  el.send.hidden = false; // on ré-affiche Envoyer
  el.stop.hidden = true;
  setStatus("");

  const gotSomething = acc || genImages.length > 0;
  assistantMsg.content = acc;
  assistantMsg.images = genImages;
  if (usage) assistantMsg.usage = normalizeUsage(usage, cm);

  return { gotSomething, gotError, repaint };
}

async function sendMessage() {
  let text = el.input.value.trim();
  const atts = state.pending.slice();
  if ((!text && atts.length === 0 && !state.quote) || state.streaming) return;
  if (!state.model) {
    setStatus("⚠️ choisis un modèle d'abord");
    return;
  }

  // Citation (quote-reply) : préfixe le message d'un blockquote markdown.
  if (state.quote) {
    const quoted = state.quote
      .split("\n")
      .map((l) => "> " + l)
      .join("\n");
    text = quoted + "\n\n" + text;
  }

  const userMsg = { role: "user", content: text, attachments: atts };
  state.messages.push(userMsg);
  el.input.value = "";
  state.pending = [];
  clearQuote();
  renderAttachments();
  autoGrow();
  if (el.messages.querySelector(".empty-state")) el.messages.innerHTML = "";
  el.messages.appendChild(makeMessageEl("user", text, userMsg));

  const assistantMsg = { role: "assistant", content: "", images: [] };
  const assistantEl = makeMessageEl("assistant", "", assistantMsg);
  el.messages.appendChild(assistantEl);
  scrollToBottom();

  const { gotSomething, gotError } = await streamAssistant(
    assistantMsg,
    assistantEl
  );

  await finishAssistant(assistantMsg, assistantEl, gotSomething, gotError);
}

// Finalise un tour assistant : gère erreurs, persistance, récents.
async function finishAssistant(assistantMsg, assistantEl, gotSomething, gotError) {
  if (gotError) {
    if (gotSomething) {
      state.messages.push(assistantMsg);
      assistantEl.replaceWith(makeMessageEl("assistant", assistantMsg.content, assistantMsg));
      el.messages.appendChild(makeMessageEl("error", gotError));
    } else {
      assistantEl.replaceWith(makeMessageEl("error", gotError));
    }
    state.messages.push({ role: "error", content: gotError });
    await persist();
    renderCostBar();
    el.input.focus();
    return;
  }

  if (gotSomething) {
    state.messages.push(assistantMsg);
    // Re-rend proprement la bulle avec ses actions (copier/régénérer).
    assistantEl.replaceWith(makeMessageEl("assistant", assistantMsg.content, assistantMsg));
    pushRecent(state.model);
    populateModels();
  } else {
    assistantEl.replaceWith(makeMessageEl("error", "(réponse vide)"));
    state.messages.push({ role: "error", content: "(réponse vide)" });
  }
  await persist();
  renderCostBar();
  el.input.focus();
}

// Régénère la dernière réponse de l'assistant.
async function regenerateLast() {
  if (state.streaming) return;
  // Retire le dernier tour assistant (et une éventuelle erreur qui suit).
  while (
    state.messages.length &&
    (state.messages[state.messages.length - 1].role === "error" ||
      state.messages[state.messages.length - 1].role === "assistant")
  ) {
    if (state.messages[state.messages.length - 1].role === "assistant") {
      state.messages.pop();
      break;
    }
    state.messages.pop();
  }
  renderMessages();

  const assistantMsg = { role: "assistant", content: "", images: [] };
  const assistantEl = makeMessageEl("assistant", "", assistantMsg);
  el.messages.appendChild(assistantEl);
  scrollToBottom();

  const { gotSomething, gotError } = await streamAssistant(assistantMsg, assistantEl);
  await finishAssistant(assistantMsg, assistantEl, gotSomething, gotError);
}

// Édite un message utilisateur (par index) et relance depuis là.
async function editUserMessage(index) {
  if (state.streaming) return;
  const msg = state.messages[index];
  if (!msg || msg.role !== "user") return;
  const nv = prompt("Modifier ton message :", msg.content);
  if (nv === null) return;
  msg.content = nv;
  // On supprime tout ce qui suit ce message (réponses obsolètes).
  state.messages = state.messages.slice(0, index + 1);
  renderMessages();

  const assistantMsg = { role: "assistant", content: "", images: [] };
  const assistantEl = makeMessageEl("assistant", "", assistantMsg);
  el.messages.appendChild(assistantEl);
  scrollToBottom();

  const { gotSomething, gotError } = await streamAssistant(assistantMsg, assistantEl);
  await finishAssistant(assistantMsg, assistantEl, gotSomething, gotError);
}

function stopStreaming() {
  if (state.abortController) state.abortController.abort();
}

// ---------- Pièces jointes ----------
const MAX_ATTACH_BYTES = 15 * 1024 * 1024; // 15 Mo par fichier
const TEXT_EXT = /\.(txt|md|markdown|csv|json|js|ts|py|html|css|xml|ya?ml|log|tsx|jsx|sh)$/i;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(file);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (file.size > MAX_ATTACH_BYTES) {
      setStatus(`⚠️ ${file.name || "fichier"} trop volumineux (max 15 Mo)`);
      continue;
    }
    try {
      if (file.type.startsWith("image/")) {
        const dataUrl = await readAsDataURL(file);
        // Une image collée n'a souvent pas de nom : on en met un.
        const name =
          file.name || `image-collée.${(file.type.split("/")[1] || "png")}`;
        state.pending.push({ type: "image", name, mime: file.type, dataUrl });
      } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        const dataUrl = await readAsDataURL(file);
        state.pending.push({ type: "file", name: file.name, mime: "application/pdf", dataUrl });
      } else if (TEXT_EXT.test(file.name) || file.type.startsWith("text/")) {
        const text = await readAsText(file);
        state.pending.push({ type: "text", name: file.name, mime: file.type || "text/plain", text });
      } else {
        setStatus(`⚠️ type non géré : ${file.name}`);
        continue;
      }
    } catch {
      setStatus(`⚠️ lecture impossible : ${file.name}`);
    }
  }
  renderAttachments();
}

function removeAttachment(i) {
  state.pending.splice(i, 1);
  renderAttachments();
}

function renderAttachments() {
  el.attachments.innerHTML = "";
  if (state.pending.length === 0) {
    el.attachments.hidden = true;
    return;
  }
  el.attachments.hidden = false;
  state.pending.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (a.type === "image") {
      const img = document.createElement("img");
      img.src = a.dataUrl;
      chip.appendChild(img);
    } else {
      chip.appendChild(iconEl("file", 15));
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = a.name;
    chip.appendChild(name);
    const rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "×";
    rm.title = "Retirer";
    rm.addEventListener("click", () => removeAttachment(i));
    chip.appendChild(rm);
    el.attachments.appendChild(chip);
  });
}

// ---------- Événements ----------
el.send.addEventListener("click", sendMessage);
el.stop.addEventListener("click", stopStreaming);
el.newChat.addEventListener("click", newChat);
el.toggleSidebar.addEventListener("click", () =>
  el.app.classList.toggle("sidebar-hidden")
);

// Lightbox : fermer au clic sur le fond, sur ✕, ou avec Échap.
el.lightboxClose.addEventListener("click", closeLightbox);
el.lightbox.addEventListener("click", (e) => {
  // On ferme si on clique en dehors de l'image et des boutons.
  if (e.target === el.lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el.lightbox.hidden) closeLightbox();
  else if (!el.settingsModal.hidden) closeSettings();
  else if (!el.quickModal.hidden) closeQuick();
  else if (!el.usageModal.hidden) closeUsage();
});

// ---------- Avertissements : réglage non supporté par le modèle ----------
// Un modèle expose `supported` (liste des paramètres OpenRouter qu'il accepte).
// Si un réglage n'y est pas, il sera ignoré → on prévient l'utilisateur.
function paramSupported(param) {
  const cm = currentModel();
  // Pas d'info (ancienne API) → on n'affiche pas d'avertissement.
  if (!cm || !Array.isArray(cm.supported)) return true;
  return cm.supported.includes(param);
}

// Place (ou retire) un avertissement à côté d'un champ.
function setWarn(warnEl, param, label) {
  if (!warnEl) return;
  if (paramSupported(param)) {
    warnEl.hidden = true;
    warnEl.textContent = "";
  } else {
    warnEl.hidden = false;
    warnEl.textContent = `⚠ Ce modèle ignore ${label}.`;
  }
}

// Rafraîchit tous les avertissements selon le modèle courant.
function refreshWarnings() {
  setWarn(el.warnTemp, "temperature", "la température");
  setWarn(el.warnWeb, "web_search_options", "la recherche internet");
  setWarn(el.warnTopp, "top_p", "le Top P");
  setWarn(el.warnFreq, "frequency_penalty", "le frequency penalty");
  setWarn(el.warnPres, "presence_penalty", "le presence penalty");
  setWarn(el.warnSeed, "seed", "le seed");
  setWarn(el.warnReasoning, "reasoning", "l'effort de raisonnement");
  setWarn(el.warnStop, "stop", "les séquences d'arrêt");
  // (Les réglages « par défaut » ne dépendent pas du modèle courant :
  // ils s'appliqueront à de futures discussions → pas d'avertissement là.)
}

// ---------- Modales réglages (générale + rapide) ----------
// Synchronise les champs des deux modales avec l'état courant.
function syncSettingsUI() {
  // Réglages de la discussion courante (modale rapide).
  el.systemPrompt.value = state.systemPrompt || "";
  el.tempRange.value = state.settings.temperature;
  el.tempVal.textContent = Number(state.settings.temperature).toFixed(1);
  el.maxTok.value = state.settings.maxTokens || 0;
  el.webSearch.checked = Boolean(state.settings.webSearch);
  // Réglages avancés (discussion courante).
  const a = state.settings.adv || newAdv();
  el.advTopp.value = a.topP == null ? 1 : a.topP;
  el.advToppVal.textContent = a.topP == null ? "auto" : a.topP.toFixed(2);
  el.advFreq.value = a.freqPenalty == null ? 0 : a.freqPenalty;
  el.advFreqVal.textContent = (a.freqPenalty == null ? 0 : a.freqPenalty).toFixed(1);
  el.advPres.value = a.presPenalty == null ? 0 : a.presPenalty;
  el.advPresVal.textContent = (a.presPenalty == null ? 0 : a.presPenalty).toFixed(1);
  el.advSeed.value = a.seed == null ? "" : a.seed;
  el.advReasoning.value = a.reasoning || "";
  el.advStop.value = a.stop || "";
  // Réglages par défaut (modale générale).
  el.defWebSearch.checked = Boolean(state.defaults.webSearch);
  el.defTempRange.value = state.defaults.temperature;
  el.defTempVal.textContent = Number(state.defaults.temperature).toFixed(1);
  el.defMaxTok.value = state.defaults.maxTokens || 0;
  // Avertissements selon les capacités du modèle courant.
  refreshWarnings();
}

// ⚙ HAUT : instructions système + réglages par défaut.
function openSettings() {
  syncSettingsUI();
  el.setDefaultOk.hidden = true;
  el.settingsModal.hidden = false;
  setUrlModal("settings");
}
function closeSettings() {
  el.settingsModal.hidden = true;
  if (urlModal === "settings") setUrlModal(null);
}
el.settingsBtn.addEventListener("click", openSettings);
el.settingsClose.addEventListener("click", closeSettings);
el.settingsModal.addEventListener("click", (e) => {
  if (e.target === el.settingsModal) closeSettings();
});

// ⚙ BAS : réglages rapides de la discussion (température, longueur, web).
function openQuick() {
  syncSettingsUI();
  el.quickModal.hidden = false;
  setUrlModal("quick");
}
function closeQuick() {
  el.quickModal.hidden = true;
  if (urlModal === "quick") setUrlModal(null);
}
el.settingsBtnBottom.addEventListener("click", openQuick);
el.quickClose.addEventListener("click", closeQuick);
el.quickModal.addEventListener("click", (e) => {
  if (e.target === el.quickModal) closeQuick();
});

// --- Champs (persistés avec la discussion) ---
el.systemPrompt.addEventListener("input", () => {
  state.systemPrompt = el.systemPrompt.value;
  updateSettingsIndicators();
  if (state.chatId) persist();
});
el.tempRange.addEventListener("input", () => {
  state.settings.temperature = Number(el.tempRange.value);
  el.tempVal.textContent = state.settings.temperature.toFixed(1);
  if (state.chatId) persist();
});
el.maxTok.addEventListener("input", () => {
  state.settings.maxTokens = Math.max(0, Number(el.maxTok.value) || 0);
  if (state.chatId) persist();
});
el.webSearch.addEventListener("change", () => {
  state.settings.webSearch = el.webSearch.checked;
  el.settingsBtnBottom.classList.toggle("has-web", el.webSearch.checked);
  if (state.chatId) persist();
});

// --- Section « Avancé » (repliable) + ses champs ---
el.advToggle.addEventListener("click", () => {
  el.advSection.classList.toggle("collapsed");
});
function advChanged() {
  if (state.chatId) persist();
}
el.advTopp.addEventListener("input", () => {
  const v = Number(el.advTopp.value);
  // 1 (max) = "auto" (on n'envoie pas top_p) ; en dessous on l'active.
  state.settings.adv.topP = v >= 1 ? null : v;
  el.advToppVal.textContent = v >= 1 ? "auto" : v.toFixed(2);
  advChanged();
});
el.advFreq.addEventListener("input", () => {
  const v = Number(el.advFreq.value);
  state.settings.adv.freqPenalty = v === 0 ? null : v;
  el.advFreqVal.textContent = v.toFixed(1);
  advChanged();
});
el.advPres.addEventListener("input", () => {
  const v = Number(el.advPres.value);
  state.settings.adv.presPenalty = v === 0 ? null : v;
  el.advPresVal.textContent = v.toFixed(1);
  advChanged();
});
el.advSeed.addEventListener("input", () => {
  const v = el.advSeed.value.trim();
  state.settings.adv.seed = v === "" ? null : parseInt(v, 10);
  if (Number.isNaN(state.settings.adv.seed)) state.settings.adv.seed = null;
  advChanged();
});
el.advReasoning.addEventListener("change", () => {
  state.settings.adv.reasoning = el.advReasoning.value;
  advChanged();
});
el.advStop.addEventListener("input", () => {
  state.settings.adv.stop = el.advStop.value;
  advChanged();
});

// --- Champs des RÉGLAGES PAR DÉFAUT (édités directement, sauvés côté serveur) ---
function flashDefaultOk() {
  el.setDefaultOk.hidden = false;
  clearTimeout(flashDefaultOk._t);
  flashDefaultOk._t = setTimeout(() => (el.setDefaultOk.hidden = true), 1600);
}
el.defWebSearch.addEventListener("change", () => {
  state.defaults.webSearch = el.defWebSearch.checked;
  saveDefaults();
  flashDefaultOk();
});
el.defTempRange.addEventListener("input", () => {
  state.defaults.temperature = Number(el.defTempRange.value);
  el.defTempVal.textContent = state.defaults.temperature.toFixed(1);
  saveDefaults();
});
el.defMaxTok.addEventListener("input", () => {
  state.defaults.maxTokens = Math.max(0, Number(el.defMaxTok.value) || 0);
  saveDefaults();
});

// « Copier les réglages de cette discussion comme défaut » : reprend température,
// longueur, recherche web et prompt système de la discussion courante.
el.setDefaultBtn.addEventListener("click", async () => {
  state.defaults = {
    temperature: state.settings.temperature,
    maxTokens: state.settings.maxTokens,
    systemPrompt: state.systemPrompt || "",
    webSearch: Boolean(state.settings.webSearch),
    adv: sanitizeAdv(state.settings.adv),
  };
  syncSettingsUI(); // met à jour les champs des défauts affichés
  await saveDefaults();
  flashDefaultOk();
});

// ---------- Modale bilan de consommation ----------
function closeUsage() {
  el.usageModal.hidden = true;
  if (urlModal === "usage") setUrlModal(null);
}
el.usageBtn.addEventListener("click", () => openUsage());
el.usageClose.addEventListener("click", closeUsage);
el.usageModal.addEventListener("click", (e) => {
  if (e.target === el.usageModal) closeUsage();
});

async function openUsage() {
  el.usageModal.hidden = false;
  setUrlModal("usage");
  el.usageBody.innerHTML = '<div class="muted">Chargement…</div>';
  try {
    const r = await fetch("/api/usage");
    const u = await r.json();
    renderUsage(u);
  } catch {
    el.usageBody.innerHTML = '<div class="muted">Impossible de charger le bilan.</div>';
  }
}

function renderUsage(u) {
  const money = (c) => "$" + c.toFixed(c < 0.01 ? 5 : 4);
  const tokFmt = (n) => n.toLocaleString("fr-FR");
  let html = `
    <div class="usage-total">
      <div class="usage-card">
        <div class="big">${tokFmt(u.totalTokens)}</div>
        <div class="lbl">tokens au total</div>
      </div>
      <div class="usage-card">
        <div class="big">${u.hasCost ? money(u.totalCost) : "—"}</div>
        <div class="lbl">coût cumulé</div>
      </div>
    </div>
    <div class="sp-hint">${u.responses} réponses · ${u.chats} discussion(s). Seules les réponses générées depuis l'ajout du suivi ont un coût.</div>
  `;
  if (u.perModel && u.perModel.length) {
    html += `<table><thead><tr>
        <th>Modèle</th><th class="num">Réponses</th><th class="num">Tokens</th><th class="num">Coût</th>
      </tr></thead><tbody>`;
    for (const m of u.perModel) {
      html += `<tr>
        <td>${escapeHtml(m.model)}</td>
        <td class="num">${m.responses}</td>
        <td class="num">${tokFmt(m.tokens)}</td>
        <td class="num">${m.cost > 0 ? money(m.cost) : "—"}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<div class="muted" style="margin-top:10px">Aucune consommation enregistrée pour l'instant.</div>`;
  }
  el.usageBody.innerHTML = html;
}

// ---------- Répondre à une sélection (quote-reply) ----------
// Affiche le bouton flottant « Répondre » quand on sélectionne du texte
// à l'intérieur d'un message.
function onSelectionChange() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : "";
  if (!text || text.length < 2) {
    el.quoteReply.hidden = true;
    return;
  }
  // La sélection doit être dans la zone des messages.
  const anchor = sel.anchorNode;
  if (!anchor || !el.messagesEl.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) {
    el.quoteReply.hidden = true;
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    el.quoteReply.hidden = true;
    return;
  }
  el.quoteReply.style.left = rect.left + rect.width / 2 + "px";
  el.quoteReply.style.top = rect.top - 8 + "px";
  el.quoteReply.hidden = false;
}
document.addEventListener("selectionchange", onSelectionChange);
// On masque le bouton quand on scrolle la zone messages.
el.messagesEl.addEventListener("scroll", () => (el.quoteReply.hidden = true));

el.quoteReply.addEventListener("mousedown", (e) => {
  // mousedown (pas click) pour agir avant que la sélection ne disparaisse.
  e.preventDefault();
  const text = window.getSelection().toString().trim();
  if (text) setQuote(text);
  el.quoteReply.hidden = true;
  window.getSelection().removeAllRanges();
});

function setQuote(text) {
  state.quote = text;
  const preview = el.quotePreview.querySelector(".qp-text");
  preview.textContent = text;
  el.quotePreview.hidden = false;
  el.input.focus();
}
function clearQuote() {
  state.quote = null;
  el.quotePreview.hidden = true;
}
el.quotePreview.querySelector(".qp-close").addEventListener("click", clearQuote);

// Pièces jointes : bouton, drag & drop, coller.
el.attachBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
  el.fileInput.value = ""; // permet de re-sélectionner le même fichier
});

// Glisser-déposer sur toute la fenêtre (l'overlay n'apparaît que pendant le drag).
let dragDepth = 0;
const showDrop = () => el.composer.classList.add("dragover");
const hideDrop = () => {
  dragDepth = 0;
  el.composer.classList.remove("dragover");
};
window.addEventListener("dragenter", (e) => {
  // On ne réagit qu'aux glissers contenant des fichiers.
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  showDrop();
});
window.addEventListener("dragover", (e) => {
  if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault();
});
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) hideDrop();
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  hideDrop();
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// Coller une image (Cmd/Ctrl+V) où qu'on soit dans la page.
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  const files = [];
  for (const it of items) {
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files);
    el.input.focus();
  }
});

el.input.addEventListener("input", autoGrow);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Ouvre/ferme le panneau de sélection.
el.modelBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleModelPanel();
});
// Clic en dehors du panneau => fermeture.
document.addEventListener("click", (e) => {
  if (
    !el.modelPanel.hidden &&
    !el.modelPanel.contains(e.target) &&
    e.target !== el.modelBtn &&
    !el.modelBtn.contains(e.target)
  ) {
    closeModelPanel();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modelPanel.hidden) closeModelPanel();
});

el.favToggle.addEventListener("click", toggleFavorite);

el.imgFilter.addEventListener("click", (e) => {
  e.stopPropagation();
  state.onlyImageModels = !state.onlyImageModels;
  el.imgFilter.classList.toggle("active", state.onlyImageModels);
  el.imgFilter.title = state.onlyImageModels
    ? "Afficher tous les modèles"
    : "N'afficher que les modèles qui génèrent des images";
  renderTree();
});

let filterTimer = null;
el.modelFilter.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderTree, 120);
});
// Le clic dans le champ de recherche ne doit pas fermer le panneau.
el.modelFilter.addEventListener("click", (e) => e.stopPropagation());

// ---------- Bannière "clé manquante" ----------
function showNoKeyBanner() {
  const banner = document.createElement("div");
  banner.className = "no-key-banner";
  banner.innerHTML = `
    <strong>Clé OpenRouter manquante.</strong>
    Ouvre le fichier <code>.env</code> à la racine du projet, colle ta clé après
    <code>OPENROUTER_API_KEY=</code>, enregistre, puis relance <code>npm start</code>.`;
  document.getElementById("main").prepend(banner);
  el.send.disabled = true;
  setStatus("");
}

// ---------- Démarrage ----------
(async function init() {
  installIcons();
  renderMessages();
  syncSettingsUI();
  let hasKey = true;
  try {
    const r = await fetch("/api/config");
    const cfg = await r.json();
    hasKey = cfg.hasKey;
  } catch {
    /* si /api/config échoue on tente quand même de charger */
  }
  if (!hasKey) {
    showNoKeyBanner();
    await loadChatList();
    return;
  }
  await loadPrefs();
  await loadModels();
  await loadChatList();

  // Lit l'état d'URL AVANT toute écriture (sinon openChat écraserait ?m=).
  const idFromUrl = location.hash.slice(1);
  const m = new URLSearchParams(location.search).get("m");
  urlChatId = idFromUrl || null;
  urlModal = m || null;

  // Rouvre la discussion indiquée dans l'URL (#id) après un refresh.
  if (idFromUrl) await openChat(idFromUrl);

  // Rouvre la modale indiquée dans l'URL (?m=settings|quick|usage).
  if (m === "settings") openSettings();
  else if (m === "quick") openQuick();
  else if (m === "usage") openUsage();

  el.input.focus();
})();

// Navigation arrière/avant du navigateur : suit le hash.
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== state.chatId) openChat(id);
  else if (!id && state.chatId) newChat();
});
