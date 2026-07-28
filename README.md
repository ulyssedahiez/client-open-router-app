# Client OpenRouter (local)

Interface web pour discuter avec les modèles d'OpenRouter. Node ≥ 18, aucune
dépendance npm à installer (les libs front sont vendorisées dans `public/vendor/`).

## Démarrer

1. Mets ta clé dans `.env` (déjà pré-rempli, il ne reste qu'à coller la clé) :

   ```
   OPENROUTER_API_KEY=sk-or-...
   ```

2. Lance le serveur — et **laisse-le tourner** :

   ```
   npm start
   ```

3. Ouvre http://localhost:5178

> Si la page affiche « ce site est inaccessible / connexion refusée », c'est que
> le serveur n'est pas lancé : relance `npm start` et garde le terminal ouvert.

## Fonctionnalités

- **Chat en streaming** avec n'importe quel modèle OpenRouter (367 dispos).
- **Sélecteur de modèle** avec recherche, **favoris ⭐** et **récents ↻** groupés
  en haut. Clique l'étoile pour épingler le modèle courant.
- **Rendu riche** (markdown-it + DOMPurify) : tableaux, listes, titres, citations,
  liens, **code coloré** (highlight.js). Contenu nettoyé contre le XSS.
- **Envoi de fichiers** au modèle (bouton 📎, glisser-déposer, ou coller) :
  - **Images** → envoyées au modèle vision (il « voit » l'image).
  - **PDF** → envoyé nativement (si le modèle le supporte).
  - **Docs texte** (.txt, .md, .csv, code…) → contenu injecté dans le message.
- **Génération d'images** : sélectionne un modèle image (ex. *Nano Banana /
  Gemini 2.5 Flash Image*), demande « dessine… » et l'image s'affiche dans le chat.
- **Discussions sauvées** automatiquement en JSON dans `chats/` (avec les images).

## Où est quoi

- `server.js` — serveur : proxy OpenRouter (streaming), API discussions + préférences.
- `public/` — front : `index.html`, `style.css`, `app.js`, libs dans `vendor/`.
- `chats/*.json` — une discussion par fichier.
- `data/prefs.json` — favoris + modèles récents.
- Le port se change via `PORT=` dans `.env`.

La clé reste côté serveur (`.env`), jamais envoyée au navigateur.
