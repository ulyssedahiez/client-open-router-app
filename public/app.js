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
};

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
};

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
  dl.textContent = "⬇ Télécharger";
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
        pill.textContent = "📄 " + (a.name || "document");
        av.appendChild(pill);
      }
    }
    bubble.appendChild(av);
  }

  // Texte : markdown pour l'assistant, brut sinon.
  if (content) {
    const textEl = document.createElement("div");
    if (role === "assistant") textEl.innerHTML = renderMarkdown(content);
    else textEl.textContent = content;
    bubble.appendChild(textEl);
  }

  // Images générées par l'assistant (au-dessous du texte).
  if (Array.isArray(msg.images) && msg.images.length) {
    for (const src of msg.images) {
      bubble.appendChild(makeGenImage(src));
    }
  }

  wrap.appendChild(bubble);
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
      del.textContent = "🗑";
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
    state.pending = [];
    renderAttachments();
    if (data.model) {
      state.model = data.model;
      updateModelButton();
      updateFavToggle();
    }
    renderMessages();
    loadChatList();
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
  renderAttachments();
  renderMessages();
  loadChatList();
  el.input.focus();
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

// Badge de capacité affiché devant un modèle.
function capBadge(m) {
  if (m.canImageOut) return "🎨";
  if (m.canImageIn) return "👁";
  return "";
}

// Construit une ligne « modèle » cliquable dans l'arborescence.
function makeModelItem(m) {
  const item = document.createElement("div");
  item.className = "mt-item" + (m.id === state.model ? " selected" : "");
  item.dataset.id = m.id;

  const badge = capBadge(m);
  if (badge) {
    const b = document.createElement("span");
    b.textContent = badge;
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
  star.textContent = isFav ? "★" : "☆";
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
  { collapsible = true, key = label, collapsed = false } = {}
) {
  if (models.length === 0) return null;
  const group = document.createElement("div");
  group.className = "mt-group";
  if (collapsed) group.classList.add("collapsed");

  const head = document.createElement("button");
  head.className = "mt-group-head";
  if (collapsible) {
    // Chevron toujours "▾" : la rotation (fermé → droite) est gérée en CSS.
    const tw = document.createElement("span");
    tw.className = "tw";
    tw.textContent = "▾";
    head.appendChild(tw);
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
  const favG = makeTreeGroup("★ Favoris", favModels, {
    key: "__fav",
    collapsed: false,
  });
  if (favG) el.modelTree.appendChild(favG);
  const recG = makeTreeGroup("↻ Récents", recentModels, {
    key: "__rec",
    collapsed: false,
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
  el.modelBtnLabel.textContent = cm
    ? (capBadge(cm) ? capBadge(cm) + " " : "") + (cm.name || cm.id)
    : state.model || "Choisir un modèle…";
}

// Sélectionne un modèle, ferme le panneau.
function selectModel(id) {
  state.model = id;
  localStorage.setItem("last-model", id);
  updateModelButton();
  updateFavToggle();
  renderTree();
  closeModelPanel();
}

// ---------- Favoris / récents (préférences serveur) ----------
async function loadPrefs() {
  try {
    const r = await fetch("/api/prefs");
    const p = await r.json();
    state.favorites = Array.isArray(p.favorites) ? p.favorites : [];
    state.recents = Array.isArray(p.recents) ? p.recents : [];
  } catch {
    state.favorites = [];
    state.recents = [];
  }
}

function updateFavToggle() {
  const isFav = state.model && state.favorites.includes(state.model);
  el.favToggle.textContent = isFav ? "★" : "☆";
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
async function sendMessage() {
  const text = el.input.value.trim();
  const atts = state.pending.slice();
  if ((!text && atts.length === 0) || state.streaming) return;
  if (!state.model) {
    setStatus("⚠️ choisis un modèle d'abord");
    return;
  }

  // Message utilisateur (texte + pièces jointes).
  const userMsg = { role: "user", content: text, attachments: atts };
  state.messages.push(userMsg);
  el.input.value = "";
  state.pending = [];
  renderAttachments();
  autoGrow();
  if (el.messages.querySelector(".empty-state")) el.messages.innerHTML = "";
  el.messages.appendChild(makeMessageEl("user", text, userMsg));

  // Bulle assistant vide, avec curseur.
  const assistantMsg = { role: "assistant", content: "", images: [] };
  const assistantEl = makeMessageEl("assistant", "", assistantMsg);
  const bubble = assistantEl.querySelector(".bubble");
  bubble.classList.add("cursor");
  el.messages.appendChild(assistantEl);
  scrollToBottom();

  state.streaming = true;
  el.send.disabled = true;
  el.stop.hidden = false;
  setStatus("génération…");

  state.abortController = new AbortController();
  let acc = "";
  const genImages = [];
  let gotError = null;

  // Ré-affiche la bulle (texte markdown + images générées).
  const repaint = () => {
    bubble.innerHTML = "";
    if (acc) {
      const t = document.createElement("div");
      t.innerHTML = renderMarkdown(acc);
      bubble.appendChild(t);
    }
    for (const src of genImages) {
      bubble.appendChild(makeGenImage(src));
    }
  };

  const cm = currentModel();
  const wantsImage = cm && cm.canImageOut;

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: state.model,
        messages: buildApiMessages(),
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
        const delta = json.choices?.[0]?.delta;
        if (!delta) return;
        // Texte
        if (typeof delta.content === "string" && delta.content) {
          acc += delta.content;
          repaint();
          scrollToBottom();
        }
        // Images générées : delta.images = [{ image_url: { url } }]
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
    if (e.name === "AbortError") {
      // Arrêt volontaire : on garde ce qui a été reçu.
    } else {
      gotError = e.message;
    }
  }

  bubble.classList.remove("cursor");
  state.streaming = false;
  state.abortController = null;
  el.send.disabled = false;
  el.stop.hidden = true;
  setStatus("");

  const gotSomething = acc || genImages.length > 0;

  if (gotError) {
    if (gotSomething) {
      assistantMsg.content = acc;
      assistantMsg.images = genImages;
      state.messages.push(assistantMsg);
      repaint();
      el.messages.appendChild(makeMessageEl("error", gotError));
    } else {
      assistantEl.replaceWith(makeMessageEl("error", gotError));
    }
    state.messages.push({ role: "error", content: gotError });
    await persist();
    el.input.focus();
    return;
  }

  if (gotSomething) {
    assistantMsg.content = acc;
    assistantMsg.images = genImages;
    state.messages.push(assistantMsg);
    repaint();
    pushRecent(state.model);
    populateModels();
  } else {
    assistantEl.replaceWith(makeMessageEl("error", "(réponse vide)"));
    state.messages.push({ role: "error", content: "(réponse vide)" });
  }
  await persist();
  el.input.focus();
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
      const icon = document.createElement("span");
      icon.textContent = a.type === "file" ? "📄" : "📝";
      chip.appendChild(icon);
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
  if (e.key === "Escape" && !el.lightbox.hidden) closeLightbox();
});

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
  renderMessages();
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
  el.input.focus();
})();
