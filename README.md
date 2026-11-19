# Comparateur des banques de Polynésie française

Comparateur web (Vite + React, SPA statique) des offres bancaires aux particuliers en Polynésie
française : **Banque SOCREDO**, **Banque de Tahiti** (BPCE), **Banque de Polynésie** (Société
Générale) et **MARARA Paiement** (ex-services financiers / CCP de l'OPT).

Rubriques : crédit immobilier · comptes & cartes · épargne · crédit conso/auto · simulateur de
capacité d'emprunt (XPF par défaut, bascule €, parité 1 000 XPF = 8,38 €).

**Règle : aucun chiffre sans source.** Chaque valeur de `data/banks.json` porte l'identifiant de sa
source et une citation exacte ; `npm run verify` contrôle que la citation figure dans la copie texte
du document (`data/sources/<id>.txt`). Ce qui n'est pas publié est affiché « Non publié », avec la
liste des documents consultés.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify     # contrôle des sources (aussi exécuté par npm run build)
npm test           # tests unitaires : simulateur (cas calculé à la main) + vérificateur
npm run build      # verify + build de production dans dist/
```

Test navigateur (Playwright headless, captures dans `screenshots/`) :

```bash
npm run build
npm run preview -- --port 4173 --strictPort &
python3 tests/e2e.py
```

## Données

- `data/banks.json` : source de vérité (métadonnées, champs, sources, banques, repères de marché,
  paramètres du simulateur). Schéma : `data/SCHEMA.md`.
- `data/sources/*.txt` : instantanés texte des documents (PDF extraits avec pypdf, pages HTML en
  texte), relevés le 17/11/2026.
- `scripts/snapshot.py <id> <url>` : (re)télécharge un document et met à jour son instantané.
- `scripts/verify-data.mjs [--strict]` : vérifie sources, citations, couverture.

Mettre à jour une grille : `python3 scripts/snapshot.py socredo_tarifs_2026 <nouvelle URL>`, mettre à
jour l'URL/la date dans `banks.json`, corriger les valeurs et citations, puis `npm run verify`.

## Simulateur

Capacité = revenu × taux d'endettement − crédits en cours (assurance comprise) ; prêt = capacité /
(facteur d'annuité + assurance mensuelle). Prix maximal = prêt (+ PTZ) + apport − frais
d'acquisition, résolu par dichotomie. Frais calculés poste par poste : droits (7 % ; primo 1 %
jusqu'à 40 MF/acquéreur ; neuf : TVA incluse), taxe de publicité 0,10 %, émoluments (barème S1 de
l'arrêté 1376 CM), émoluments de prêt (2/3, +25 % si hypothèque), formalités, TVA 13 %, débours,
frais de dossier de la banque choisie. Cas de contrôle (test) : 350 000 XPF net, 30 000 XPF de
charges, 25 ans, 3 %, assurance 0,38 % → prêt 18 285 042 XPF (153 229 €).

## Déploiement

Hébergé gratuitement sur GitHub Pages : chaque push sur `main` lance `.github/workflows/pages.yml`
(tests, vérification des sources, build avec `BASE_PATH=/<repo>/`, publication).

Alternative : `vercel.json` est prêt (framework Vite, sortie `dist/`).

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

Ou import du dépôt Git dans le tableau de bord Vercel (aucune variable d'environnement requise).
