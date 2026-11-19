# Comparateur des banques de Polynésie française

Comparateur web (Vite + React, SPA statique) des offres bancaires aux particuliers en Polynésie
française : **Banque SOCREDO**, **Banque de Tahiti** (BPCE), **Banque de Polynésie** (Société
Générale) et **MARARA Paiement** (ex-services financiers / CCP de l'OPT).

Rubriques : crédit immobilier · comptes & cartes · épargne · crédit conso/auto · simulateur de
capacité d'emprunt (XPF par défaut, bascule €, parité 1 000 XPF = 8,38 €).

**Règle : aucun chiffre sans source.** Chaque valeur de `data/banks.json` porte l'identifiant de sa
source et une citation exacte ; `npm run verify` contrôle que la citation figure dans la copie texte
du document (`data/sources/<id>.txt`) sans couper un nombre, que la valeur de tri (`num`) figure dans
la citation (ou qu'elle est un calcul déclaré `derived`, recalculé par le script) et que chaque
paramètre du simulateur (droits, barème, presets, parité…) se retrouve dans sa citation. Ce qui n'est
pas publié est affiché « Non publié », avec la liste des documents consultés.

## Lancer

```bash
npm ci
npm run dev        # http://localhost:5173
npm run verify     # contrôle des sources (--strict dans npm run build)
npm test           # tests unitaires et adversariaux : simulateur, vérificateur, valeurs à date d'effet
npm run build      # verify --strict + build de production dans dist/
```

Tests navigateur (Playwright Python + Chromium, axe-core local), lancés aussi en CI avant le déploiement :

```bash
BASE_PATH=/comparateur-banques-pf/ npm run build
BASE_PATH=/comparateur-banques-pf/ npx vite preview --port 4173 --strictPort   # autre terminal, même BASE_PATH
BASE_PATH=/comparateur-banques-pf/ python3 tests/e2e.py    # parcours, captures dans screenshots/, date simulée au 02/01/2027
BASE_PATH=/comparateur-banques-pf/ python3 tests/a11y.py   # axe WCAG 2.1 AA + navigation clavier des onglets
python3 tests/fuzz/fuzz.py 3000                    # simulateur JS vs implémentation Python indépendante (≤ 2 XPF)
```

## Données

- `data/banks.json` : source de vérité (métadonnées, champs, sources, banques, repères de marché,
  paramètres du simulateur). Schéma : `data/SCHEMA.md`.
- `data/sources/*.txt` : instantanés texte des documents (PDF extraits avec pypdf, pages HTML en
  texte). Dernière vérification des sources : 18/11/2026.
- `scripts/snapshot.py <id> <url>` : (re)télécharge un document et met à jour son instantané.
- `scripts/verify-data.mjs [--strict]` : vérifie sources, citations, valeurs, paramètres, dates.

Mettre à jour une grille : `python3 scripts/snapshot.py socredo_tarifs_2026 <nouvelle URL>`, mettre à
jour l'URL/la date dans `banks.json`, corriger les valeurs et citations, puis `npm run verify`.

**Grilles annoncées à l'avance** (ex. Banque de Tahiti au 01/01/2027) : les valeurs futures sont
saisies dans `changes: [{ effective_from, … }]` (voir `data/SCHEMA.md`). Le site affiche la grille en
vigueur à la date du visiteur, avec un badge « Nouvelle grille au … », et bascule seul à la date d'effet
(y compris le minimum de frais de dossier du simulateur).

## Simulateur

Capacité = revenu × taux d'endettement − crédits en cours (assurance comprise) ; prêt = capacité /
(facteur d'annuité + assurance mensuelle). Prix maximal = prêt (+ PTZ) + apport − frais
d'acquisition, résolu par dichotomie (sans capacité d'emprunt, l'apport seul finance un achat
comptant). Frais calculés poste par poste : droits (7 % ; primo 1 % jusqu'à 40 MF/acquéreur pour
un bien bâti ; neuf : TVA incluse), taxe de publicité 0,10 %, émoluments (barème S1 de l'arrêté
1376 CM), émoluments de prêt (2/3, +25 % si hypothèque), formalités, TVA 13 %, débours, frais de
dossier de la banque choisie. Les postes tirés d'une source secondaire (formalités, débours, +25 %
hypothèque, minimum de publicité) sont signalés « à confirmer par un notaire ».

- Saisies bornées (pas de négatif, endettement ≤ 60 %, durée 1–30 ans, 1–2 acquéreurs), avec message.
- PTZ Pays : ≤ 12 MF, remboursé sur 25 ans au plus, réservé aux primo-accédants (droits 1 %).
- Alerte d'usure : TAEG actuariel (frais de dossier et assurance inclus) comparé au seuil de la
  catégorie de durée (< 10 ans, 10–20 ans, ≥ 20 ans).
- AIM : signalée pour le neuf/récent (< 5 ans) uniquement, non incluse dans le calcul.

Cas de contrôle (test) : 350 000 XPF net, 30 000 XPF de charges, 25 ans, 3 %, assurance 0,38 % →
prêt 18 285 042 XPF (153 229 €).

## Déploiement

Hébergé sur GitHub Pages : chaque push sur `main` lance `.github/workflows/pages.yml` (Node 22 :
`npm audit`, tests, vérification stricte des sources, build avec `BASE_PATH=/<repo>/`, puis tests
Playwright e2e, accessibilité et fuzz, et seulement ensuite publication). Les polices sont
auto-hébergées (paquets `@fontsource`) et une CSP stricte est déclarée dans `index.html`.
