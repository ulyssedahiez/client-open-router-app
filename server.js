import { createServer } from "node:http";
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHATS_DIR = join(__dirname, "chats");
const PUBLIC_DIR = join(__dirname, "public");
const DATA_DIR = join(__dirname, "data");
const PREFS_PATH = join(DATA_DIR, "prefs.json");

// --- Chargement minimal du .env (pas de dépendance externe) ---
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const API_KEY = process.env.OPENROUTER_API_KEY;
const PORT = Number(process.env.PORT) || 5178;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

if (!API_KEY) {
  console.error(
    "\n⚠️  Aucune clé trouvée.\n" +
      "   Crée un fichier .env avec :  OPENROUTER_API_KEY=sk-or-...\n" +
      "   (tu peux copier .env.example)\n"
  );
}

// --- Helpers ---
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error("Corps de requête trop volumineux"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

// Un id de chat sûr : uniquement caractères simples, pas de traversée de dossier.
function safeChatId(id) {
  if (typeof id !== "string") return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  return id;
}

function chatPath(id) {
  return join(CHATS_DIR, `${id}.json`);
}

async function ensureChatsDir() {
  await mkdir(CHATS_DIR, { recursive: true });
}

// --- Handlers API ---

// GET /api/chats  -> liste des discussions (métadonnées seulement)
async function listChats(res) {
  await ensureChatsDir();
  const files = (await readdir(CHATS_DIR)).filter((f) => f.endsWith(".json"));
  const chats = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await readFile(join(CHATS_DIR, f), "utf8"));
      chats.push({
        id: data.id,
        title: data.title || "Sans titre",
        model: data.model || null,
        updatedAt: data.updatedAt || 0,
        messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
      });
    } catch {
      // fichier illisible : on l'ignore silencieusement
    }
  }
  chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sendJSON(res, 200, { chats });
}

// GET /api/chats/:id -> une discussion complète
async function getChat(res, id) {
  const safe = safeChatId(id);
  if (!safe) return sendJSON(res, 400, { error: "id invalide" });
  const p = chatPath(safe);
  if (!existsSync(p)) return sendJSON(res, 404, { error: "introuvable" });
  try {
    const data = JSON.parse(await readFile(p, "utf8"));
    sendJSON(res, 200, data);
  } catch {
    sendJSON(res, 500, { error: "lecture impossible" });
  }
}

// PUT /api/chats/:id -> sauvegarde (écrase) une discussion
async function saveChat(req, res, id) {
  const safe = safeChatId(id);
  if (!safe) return sendJSON(res, 400, { error: "id invalide" });
  const body = await readBody(req);
  if (!Array.isArray(body.messages)) {
    return sendJSON(res, 400, { error: "messages manquants" });
  }
  await ensureChatsDir();
  const data = {
    id: safe,
    title: typeof body.title === "string" ? body.title.slice(0, 200) : "Sans titre",
    model: typeof body.model === "string" ? body.model : null,
    messages: body.messages,
    systemPrompt:
      typeof body.systemPrompt === "string" ? body.systemPrompt.slice(0, 8000) : "",
    settings:
      body.settings && typeof body.settings === "object" ? body.settings : undefined,
    createdAt: body.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await writeFile(chatPath(safe), JSON.stringify(data, null, 2), "utf8");
  sendJSON(res, 200, { ok: true, updatedAt: data.updatedAt });
}

// DELETE /api/chats/:id
async function deleteChat(res, id) {
  const safe = safeChatId(id);
  if (!safe) return sendJSON(res, 400, { error: "id invalide" });
  const p = chatPath(safe);
  if (existsSync(p)) await unlink(p);
  sendJSON(res, 200, { ok: true });
}

// GET /api/config -> le front sait si la clé est configurée
function getConfig(res) {
  sendJSON(res, 200, { hasKey: Boolean(API_KEY) });
}

// --- Préférences (favoris + modèles récents), stockées dans data/prefs.json ---
const MAX_RECENTS = 8;

// Réglages par défaut d'une nouvelle discussion.
const DEFAULT_SETTINGS = {
  temperature: 1,
  maxTokens: 0,
  systemPrompt: "",
  webSearch: false,
};

function sanitizeDefaults(d) {
  const out = { ...DEFAULT_SETTINGS };
  if (d && typeof d === "object") {
    if (typeof d.temperature === "number" && d.temperature >= 0 && d.temperature <= 2)
      out.temperature = d.temperature;
    if (typeof d.maxTokens === "number" && d.maxTokens >= 0)
      out.maxTokens = Math.floor(d.maxTokens);
    if (typeof d.systemPrompt === "string")
      out.systemPrompt = d.systemPrompt.slice(0, 8000);
    out.webSearch = Boolean(d.webSearch);
    // Réglages avancés : on stocke tel quel (objet simple) s'il est fourni.
    if (d.adv && typeof d.adv === "object") out.adv = d.adv;
  }
  return out;
}

async function readPrefs() {
  const empty = { favorites: [], recents: [], defaults: { ...DEFAULT_SETTINGS } };
  if (!existsSync(PREFS_PATH)) return empty;
  try {
    const data = JSON.parse(await readFile(PREFS_PATH, "utf8"));
    return {
      favorites: Array.isArray(data.favorites) ? data.favorites : [],
      recents: Array.isArray(data.recents) ? data.recents : [],
      defaults: sanitizeDefaults(data.defaults),
    };
  } catch {
    return empty;
  }
}

async function writePrefs(prefs) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2), "utf8");
}

// GET /api/prefs
async function getPrefs(res) {
  sendJSON(res, 200, await readPrefs());
}

// PUT /api/prefs -> met à jour favoris et/ou réglages par défaut
async function savePrefs(req, res) {
  const body = await readBody(req);
  const prefs = await readPrefs();
  if (Array.isArray(body.favorites)) {
    prefs.favorites = body.favorites
      .filter((x) => typeof x === "string")
      .slice(0, 100);
  }
  if (body.defaults && typeof body.defaults === "object") {
    prefs.defaults = sanitizeDefaults(body.defaults);
  }
  await writePrefs(prefs);
  sendJSON(res, 200, prefs);
}

// POST /api/prefs/recent -> pousse un modèle en tête des récents
async function pushRecent(req, res) {
  const body = await readBody(req);
  const id = typeof body.model === "string" ? body.model : null;
  if (!id) return sendJSON(res, 400, { error: "model requis" });
  const prefs = await readPrefs();
  prefs.recents = [id, ...prefs.recents.filter((m) => m !== id)].slice(
    0,
    MAX_RECENTS
  );
  await writePrefs(prefs);
  sendJSON(res, 200, prefs);
}

// GET /api/usage -> bilan de consommation (somme sur toutes les discussions)
async function getUsage(res) {
  await ensureChatsDir();
  const files = (await readdir(CHATS_DIR)).filter((f) => f.endsWith(".json"));
  let totalTokens = 0;
  let totalCost = 0;
  let hasCost = false;
  let responses = 0;
  let chats = 0;
  const byModel = {}; // modelId -> { tokens, cost, responses }

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(await readFile(join(CHATS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    chats++;
    const chatModel = data.model || "inconnu";
    for (const m of data.messages || []) {
      if (m.role !== "assistant" || !m.usage) continue;
      const u = m.usage;
      const tk = u.total || (u.in || 0) + (u.out || 0);
      const cost = typeof u.cost === "number" ? u.cost : 0;
      // Le modèle est stocké par discussion ; on répartit au niveau du chat.
      const mk = chatModel;
      if (!byModel[mk]) byModel[mk] = { tokens: 0, cost: 0, responses: 0 };
      byModel[mk].tokens += tk;
      byModel[mk].cost += cost;
      byModel[mk].responses++;
      totalTokens += tk;
      totalCost += cost;
      if (typeof u.cost === "number") hasCost = true;
      responses++;
    }
  }

  const perModel = Object.entries(byModel)
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

  sendJSON(res, 200, {
    totalTokens,
    totalCost,
    hasCost,
    responses,
    chats,
    perModel,
  });
}

// GET /api/models -> liste des modèles OpenRouter (pour le menu déroulant)
async function getModels(res) {
  if (!API_KEY) return sendJSON(res, 500, { error: "Clé API manquante" });
  try {
    const r = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!r.ok) {
      return sendJSON(res, r.status, { error: "Impossible de charger les modèles" });
    }
    const json = await r.json();
    const models = (json.data || [])
      .map((m) => {
        const arch = m.architecture || {};
        const input = arch.input_modalities || [];
        const output = arch.output_modalities || [];
        return {
          id: m.id,
          name: m.name || m.id,
          // Capacités utilisées par le front (multimodal + génération d'image).
          canImageIn: input.includes("image"),
          canFileIn: input.includes("file"),
          canImageOut: output.includes("image"),
          // Paramètres réellement supportés par le modèle (avertissements front).
          supported: Array.isArray(m.supported_parameters)
            ? m.supported_parameters
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    sendJSON(res, 200, { models });
  } catch (e) {
    sendJSON(res, 500, { error: String(e.message || e) });
  }
}

// POST /api/chat -> proxy streaming vers OpenRouter
async function chat(req, res) {
  if (!API_KEY) {
    return sendJSON(res, 500, {
      error: "Clé API manquante. Crée un fichier .env avec OPENROUTER_API_KEY.",
    });
  }
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: String(e.message || e) });
  }

  const {
    model,
    messages,
    modalities,
    system,
    temperature,
    max_tokens,
    top_p,
    frequency_penalty,
    presence_penalty,
    seed,
    reasoning_effort,
    stop,
  } = body;
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return sendJSON(res, 400, { error: "model et messages requis" });
  }

  const controller = new AbortController();
  // Si le navigateur ferme l'onglet, on coupe la requête vers OpenRouter.
  req.on("close", () => controller.abort());

  const wantsImage = Array.isArray(modalities) && modalities.includes("image");

  // Message système = consigne de formatage markdown + prompt système utilisateur.
  const MARKDOWN_HINT =
    "Formate tes réponses en Markdown. Pour tout tableau, utilise " +
    "impérativement la syntaxe Markdown complète avec la ligne de séparation, " +
    "par exemple :\n\n| Colonne A | Colonne B |\n|---|---|\n| valeur | valeur |\n\n" +
    "N'utilise jamais de simples barres verticales sans cette ligne de séparation.";

  let outMessages = messages;
  if (!wantsImage && !messages.some((m) => m.role === "system")) {
    const sys =
      typeof system === "string" && system.trim()
        ? system.trim() + "\n\n" + MARKDOWN_HINT
        : MARKDOWN_HINT;
    outMessages = [{ role: "system", content: sys }, ...messages];
  }

  // Payload OpenRouter.
  const payload = { model, messages: outMessages, stream: true };
  if (Array.isArray(modalities) && modalities.length) {
    payload.modalities = modalities;
  }
  // Réglages d'inférence (si fournis et valides).
  if (typeof temperature === "number" && temperature >= 0 && temperature <= 2) {
    payload.temperature = temperature;
  }
  if (typeof max_tokens === "number" && max_tokens > 0) {
    payload.max_tokens = Math.floor(max_tokens);
  }
  // --- Réglages avancés ---
  if (typeof top_p === "number" && top_p > 0 && top_p <= 1) {
    payload.top_p = top_p;
  }
  if (
    typeof frequency_penalty === "number" &&
    frequency_penalty >= -2 &&
    frequency_penalty <= 2
  ) {
    payload.frequency_penalty = frequency_penalty;
  }
  if (
    typeof presence_penalty === "number" &&
    presence_penalty >= -2 &&
    presence_penalty <= 2
  ) {
    payload.presence_penalty = presence_penalty;
  }
  if (Number.isInteger(seed)) {
    payload.seed = seed;
  }
  if (["low", "medium", "high"].includes(reasoning_effort)) {
    // Format OpenRouter : { reasoning: { effort } }
    payload.reasoning = { effort: reasoning_effort };
  }
  if (Array.isArray(stop) && stop.length) {
    payload.stop = stop.filter((s) => typeof s === "string" && s).slice(0, 4);
  }
  // Demande le décompte de tokens + coût dans le flux (dernier chunk).
  payload.usage = { include: true };

  let upstream;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "client-openrouter local",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) return;
    return sendJSON(res, 502, { error: "Connexion à OpenRouter impossible: " + e.message });
  }

  if (!upstream.ok || !upstream.body) {
    let errText = "";
    try {
      errText = await upstream.text();
    } catch {}
    let msg = `OpenRouter a répondu ${upstream.status}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {
      if (errText) msg += `: ${errText.slice(0, 300)}`;
    }
    return sendJSON(res, upstream.status || 502, { error: msg });
  }

  // On relaie tel quel le flux SSE d'OpenRouter au navigateur.
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      // On signale l'erreur au flux si possible.
      try {
        res.write(
          `data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`
        );
      } catch {}
    }
  } finally {
    res.end();
  }
}

// --- Fichiers statiques ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = resolve(join(PUBLIC_DIR, "." + rel));
  // Empêche toute sortie du dossier public.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Interdit");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end("Introuvable");
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end("Erreur serveur");
  }
}

// --- Routeur ---
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // API
    if (path === "/api/config" && method === "GET") return getConfig(res);
    if (path === "/api/prefs" && method === "GET") return await getPrefs(res);
    if (path === "/api/prefs" && method === "PUT") return await savePrefs(req, res);
    if (path === "/api/prefs/recent" && method === "POST")
      return await pushRecent(req, res);
    if (path === "/api/usage" && method === "GET") return await getUsage(res);
    if (path === "/api/models" && method === "GET") return await getModels(res);
    if (path === "/api/chat" && method === "POST") return await chat(req, res);
    if (path === "/api/chats" && method === "GET") return await listChats(res);

    const chatMatch = path.match(/^\/api\/chats\/([^/]+)$/);
    if (chatMatch) {
      const id = decodeURIComponent(chatMatch[1]);
      if (method === "GET") return await getChat(res, id);
      if (method === "PUT") return await saveChat(req, res, id);
      if (method === "DELETE") return await deleteChat(res, id);
    }

    if (path.startsWith("/api/")) return sendJSON(res, 404, { error: "route inconnue" });

    // Statique
    if (method === "GET") return await serveStatic(res, path);

    res.writeHead(405);
    res.end("Méthode non autorisée");
  } catch (e) {
    console.error("Erreur serveur:", e);
    if (!res.headersSent) sendJSON(res, 500, { error: "Erreur interne" });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  Client OpenRouter prêt 👉  http://localhost:${PORT}`);
  console.log(`  Discussions sauvées dans : ${CHATS_DIR}`);
  if (!API_KEY) console.log(`  ⚠️  N'oublie pas de créer ton .env !`);
  console.log("");
});
