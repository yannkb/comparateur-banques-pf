# Comparateur des banques de Polynésie française

Comparateur web (Vite + React, SPA statique) des offres bancaires aux particuliers en Polynésie
française : **Banque SOCREDO**, **Banque de Tahiti** (BPCE), **Banque de Polynésie** (Société
Générale) et **MARARA Paiement** (ex-services financiers / CCP de l'OPT).

Rubriques : crédit immobilier · comptes & cartes · épargne · crédit conso/auto, chacune avec une
vue « Comparer les banques » et une vue « Trouver… » (filtres et questions rapides : **Trouver mon
crédit immobilier**, **Trouver ma carte**, **Trouver mon compte ou mon offre groupée**, **Trouver mon
épargne**, **Trouver mon crédit conso ou auto**) · **Repères officiels** · simulateur de capacité d'emprunt (XPF par défaut, bascule €,
parité 1 000 XPF = 8,38 €). Thème clair ou sombre selon le réglage du système (CSS seul, sans bascule).

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
npm test           # tests unitaires et adversariaux : simulateur, vérificateur, facettes, valeurs à date d'effet
npm run build      # verify --strict + build de production dans dist/
```

Tests navigateur (Playwright Python + Chromium, axe-core local), lancés aussi en CI avant le déploiement :

```bash
BASE_PATH=/comparateur-banques-pf/ npm run build
BASE_PATH=/comparateur-banques-pf/ npx vite preview --port 4173 --strictPort   # autre terminal, même BASE_PATH
BASE_PATH=/comparateur-banques-pf/ python3 tests/e2e.py    # parcours (toutes les vues « Trouver… », Repères officiels, thème sombre), captures dans screenshots/ (ou $SCREENSHOTS_DIR)
BASE_PATH=/comparateur-banques-pf/ python3 tests/a11y.py   # axe WCAG 2.1 AA + clavier, thèmes clair ET sombre (A11Y_SCHEMES=light,dark)
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

## Trouver ma carte (catalogue + facettes génériques)

Sous-vue de « Comptes & cartes » : une ligne par carte bancaire et par type de débit (20 produits,
26 lignes : cartes locales SOCREDO, Tiare, HOA, FENUA, FENUA-KAVEKA ; Visa Classic/Red/SoCool/à
autorisation systématique ; Premier, Gold, Infinite ; cartes vendues seulement en offre groupée
comme URU JEUNES). Chaque attribut (réseau, gamme, débit, cotisation, offres groupées, étranger,
sans contact, Apple/Google/Samsung Pay, paiement mobile local, paiement en ligne, plafonds, frais en
devises et de retrait, assurance, conditions) est sourcé et cité, ou « non publié » avec les sources
consultées. Le sans contact et les portefeuilles mobiles ne sont **jamais** déduits du réseau.

- **Questions rapides** (« Visa la moins chère », « Visa la moins chère utilisable à l'étranger »,
  « Sans contact la moins chère », « Avec Apple Pay / Google Pay », « Pour voyager », « Carte jeune »,
  « Haut de gamme ») : de simples états de filtres + tri. Une question peut en citer une autre
  (`related`) : sous « Visa la moins chère », la meilleure Visa utilisable à l'étranger est calculée et
  affichée ; une carte non utilisable à l'étranger porte le badge « Pas utilisable à l'étranger ».
- **Filtres** : banque, réseau, gamme, débit, sans contact, paiement mobile, étranger, offre jeunes,
  budget maximum, inclusion des cartes vendues en offre groupée. Booléens : Indifférent / Oui / Non ;
  une valeur non publiée n'est jamais comptée comme « oui » : la carte est listée à part « à vérifier »
  (masquable).
- **Coûts** : cotisation de la carte seule ; les prix d'offres groupées sont affichés « via offre
  groupée » (ils incluent d'autres services) et n'obtiennent jamais l'étiquette « La moins chère ».
- **Lien partageable** : l'état est dans l'URL, ex. `?vue=carte&reseau=visa`,
  `?vue=carte&sans_contact=1`, `?vue=carte&etranger=1&tri=frais_etranger`.
- **Générique** : `src/lib/catalog.js` (moteur pur) et `src/Finder.jsx` (interface) ne connaissent pas
  les cartes (le même moteur sert les engagements des Repères officiels) ; attributs, facettes, tris, coût et questions rapides sont déclarés dans
  `data.catalogs[]`, les produits dans `data.products[]` (voir `data/SCHEMA.md`). Ajouter un
  catalogue (comptes, épargne, crédits) = ajouter des données, sans toucher au moteur.

## Les autres vues « Trouver… »

Même moteur, mêmes règles (sourcé ou « non publié », jamais compté comme un « oui ») :

- **Crédit immobilier** (`?vue=credit_immo`) : prêt habitat, offre primo-accédant, PTZ Pays, prêt
  relais, gros travaux. Frais de dossier calculés pour le montant saisi (défaut 20 MF, partagé avec la
  comparaison), coût total indicatif seulement là où un taux est publié pour la durée (paliers du
  simulateur BT, non contractuels). Filtres : type d'offre, garantie, délégation d'assurance, frais
  maximum. Règles communes : barème légal d'IRA (arrêté n° 1813 CM), choix de l'assureur, délai de
  réflexion, FIT (LP 2025-21).
- **Comptes et offres groupées** (`?vue=compte`) : compte seul, HIVA PLUS, URU, Taure'a, IA ORA,
  FETIA, Pack MARARA, offres clientèle fragile (120 XPF/mois). La carte incluse renvoie à sa fiche
  « Trouver ma carte » ; les prix d'offres groupées des cartes sont dérivés de ce catalogue.
- **Épargne** (`?vue=epargne`) : livrets, épargne jeunes, PEL/CEL, comptes à terme ; taux daté.
- **Crédit conso/auto** (`?vue=credit_conso`) : prêt personnel, auto, travaux, éco, étudiant ; frais
  pour le montant saisi, coût total au palier de taux BT du montant, IRA et rétractation (règles).
- `node scripts/preset-answers.mjs [AAAA-MM-JJ]` : réponses de toutes les questions rapides à une date.

## Repères officiels

Données d'organismes indépendants des banques, chacune citée et vérifiée comme le reste :

- **Taux moyens IEOM** des crédits nouveaux aux particuliers (habitat, conso, découverts ; Polynésie
  et France entière), par trimestre de T2 2024 à T2 2026 (notes IEOM T3 2025 et T2 2026).
- **Seuils de l'usure** par catégorie, du 1er octobre 2025 au 1er octobre 2026 (Banque de France,
  Journal officiel), applicables en Polynésie.
- **Règles du crédit** : loi du pays n° 2025-21 du 15/07/2025 et arrêté n° 1813 CM du 24/09/2025
  (barème des indemnités de remboursement anticipé, fiche d'information type, offre de prêt,
  rétractation, défaillance, dates d'entrée en vigueur), CESEC, Assemblée ; code de la consommation
  annoncé pour le 01/01/2027 (presse, signalée comme source secondaire).
- **Accord de modération des tarifs bancaires 2026-2028** (signé le 13/02/2026, texte reproduit en
  annexe du rapport annuel de l'Observatoire IEOM 2025-2026) : engagements, extrait standard des
  tarifs (moyennes Polynésie / Hexagone 2014-2026), et engagements par banque × service filtrables
  avec le moteur générique (tarif relevé par l'IEOM au 01/04/2026 confronté à la grille de la banque,
  écart signalé).

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
