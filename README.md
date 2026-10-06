# EUREX

Plateforme web tunisienne (SCE 1996) : cabinet comptable + modules Achats, Etats Financiers, Baud et ScanFlash.

**Site : https://salimezine.github.io/eurex/**

## Architecture

```
eurex/
  api/            # Backend : Cloudflare Workers + D1
    src/
      index.ts    # Toutes les routes (auth, cabinet, organisation, heures...)
    migrations/   # Schema D1
  web/            # Frontend : React 19 + Vite + Tailwind
    src/
      App.tsx     # Router principal
      pages/      # Home, modules (achats, ef, baud, scanflash), cabinet/
      components/ # Composants partages (dont MesHeures)
      lib/        # Clients API + tests vitest
  tools/
    pdf-factures/ # Outil de decoupage de PDF
    legacy/       # Scripts historiques (non utilise par le site)
  .github/workflows/deploy.yml  # Build + deploiement GitHub Pages
```

## Stack

- **Backend** : Cloudflare Workers + D1 (`eurex-db`) + KV + AI binding
- **Frontend** : React 19 + Vite + Tailwind CSS
- **Tests** : Vitest (frontend, `cd web && npm test`)

## Developpement

```bash
# API (port 8787)
cd api && npm install && npx wrangler dev

# Frontend (port 3000, proxy /api vers localhost:3001)
cd web && npm install && npm run dev
```

## Deploiement

- **Frontend** : push sur `main` → GitHub Actions build (`cd web && npm run build`) → GitHub Pages
- **API** : `cd api && npx wrangler deploy`

L'accès se fait uniquement par le lien du site ci-dessus.
