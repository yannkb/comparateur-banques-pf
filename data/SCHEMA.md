# Schéma des données (data/banks.json)

Règle d'or : AUCUN chiffre inventé. Toute valeur `found` doit avoir une source
(id dans `sources`) ET une citation `quote` copiée telle quelle depuis l'instantané
texte de la source (`data/sources/<sourceId>.txt`). Le script `npm run verify`
vérifie que la citation (casse/apostrophes normalisées, blancs tolérés) figure dans
l'instantané sans couper un nombre, que `num` figure dans la citation (ou dans une
citation `extra`) et que les paramètres du simulateur sont présents dans leur citation. Si l'info n'est pas trouvée : `status: "not_published"` + `checked`
= liste des sourceIds consultés.

## Source
```json
"socredo_tarifs_2026": {
  "title": "Conditions tarifaires particuliers au 1er mai 2026",
  "publisher": "Banque SOCREDO",
  "url": "https://...pdf",
  "documentDate": "2026-05-01",      // date de la grille / publication (YYYY-MM-DD ou YYYY-MM)
  "accessed": "2026-11-17",
  "snapshot": "data/sources/socredo_tarifs_2026.txt"
}
```
L'instantané = texte brut extrait (pypdf pour les PDF, texte de la page pour le HTML).

## Entrée (valeur d'un champ)
```json
{
  "status": "found",                 // "found" | "not_published"
  "value": "2 000 XPF / mois",       // texte affiché, court, en français
  "num": 2000,                       // optionnel : nombre pour tri/comparaison (XPF, %, mois) dans l'unité du champ
  "source": "socredo_tarifs_2026",
  "quote": "Frais de tenue de compte ... 2 000", // extrait VERBATIM de l'instantané (20-200 car.)
  "note": "optionnel : précision, condition, date d'un exemple ancien, etc.",
  "derived": "951 / 3"               // OBLIGATOIRE si `num` est un calcul : opérandes présents dans les
                                     // citations (sauf diviseurs d'unité 3 et 12), résultat recalculé
}
{ "status": "not_published", "checked": ["socredo_tarifs_2026"], "note": "absent de la grille" }
```
Un champ peut aussi avoir `"extra": [ {entrée}, ... ]` pour des sous-valeurs sourcées (ex. tarif agence vs en ligne).

Attributs optionnels d'une entrée :
- `stale: true` : exemple ancien (badge « Exemple ancien »).
- `indicative: "Paramètres du simulateur BT, non contractuels"` : valeur indicative (badge affiché tel quel).
- `fee: { "pct": 1, "min": 17878 }` : barème de frais de dossier (pourcentage suivi de « % » et minimum
  après « minimum » dans la citation). Pour les champs qui ont `costFor` dans `fields`, le classement
  se fait sur le coût réel `max(pct × montant, min)` pour le montant saisi par le visiteur.
- `secondary: "…"` (entrées de `market` et paramètres du simulateur) : poste issu d'une source
  secondaire, affiché « source secondaire, à confirmer par un notaire ».

## Champs par banque (ids fixes)
Unités de `num` entre crochets.

Crédit immobilier (immo)
- immo_taux            Taux indicatif publié (nominal ou TAEG, préciser date de l'exemple) [%]
- immo_duree_max       Durée maximale [mois]
- immo_quotite         Financement max (% de l'opération) [%]
- immo_frais_dossier   Frais de dossier prêt immobilier (barème 2026 : %, mini, maxi) [XPF mini]
- immo_assurance       Assurance emprunteur (taux / délégation acceptée / frais de délégation) [%]
- immo_garanties       Garanties (hypothèque, caution type Crédit Logement/CASDEN, frais) 
- immo_relais          Prêt relais (existence, quotité, durée)
- immo_primo           Offre primo-accédant
- immo_ptz             PTZ Pays (LP 2025-29) distribué ?
- immo_aim             AIM (aide à l'investissement des ménages) partenaire ?
- immo_ira             Indemnités de remboursement anticipé
- immo_avenant         Frais d'avenant / modulation / report [XPF]

Comptes & cartes (compte)
- cpt_tenue            Frais de tenue de compte [XPF/mois]
- cpt_en_ligne         Abonnement banque à distance / internet [XPF/mois]
- carte_classic        Carte internationale classique (Visa Classic / Mastercard) [XPF/an]
- carte_premium        Carte haut de gamme (Visa Premier / Gold / Infinite) [XPF/an]
- cpt_retrait_autre    Retrait DAB d'une autre banque en PF [XPF/retrait]
- vir_local            Virement ponctuel vers une autre banque en PF [XPF]
- vir_sepa             Virement SEPA / vers la France-zone euro [XPF]
- vir_international    Virement international hors SEPA [XPF]
- cpt_commission_intervention  Commission d'intervention (par opération + plafond) [XPF/op]
- cpt_rejet_cheque     Rejet de chèque pour défaut de provision [XPF]
- cpt_rejet_prelevement Rejet de prélèvement [XPF]
- cpt_decouvert        Découvert autorisé : taux / TAEG [%]
- cpt_package          Offre groupée de services principale (nom + prix) [XPF/mois]

Épargne (epargne)
- ep_livret            Livret / compte d'épargne principal + taux [%]
- ep_jeune             Livret jeune / épargne enfant + taux [%]
- ep_terme             Compte / dépôt à terme + taux [%]
- ep_autres            Autres (PEL-like, assurance-vie, etc.)

Crédit conso / auto (conso)
- conso_taux           Prêt personnel : taux indicatif [%]
- conso_auto           Prêt auto : taux indicatif [%]
- conso_frais_dossier  Frais de dossier prêt conso [XPF mini]
- conso_ira            Remboursement anticipé (indemnités / règle LP 2025-21)

## Fragment par banque (data/fragments/<bankId>.json)
```json
{
  "sources": { "<id>": {Source}, ... },
  "bank": {
    "id": "socredo", "name": "Banque SOCREDO", "short": "Socredo",
    "group": "...", "website": "https://...", "color": "#hex (couleur de marque)",
    "description": "1 phrase factuelle",
    "fields": { "<fieldId>": {Entrée}, ... }   // TOUS les champs ci-dessus présents
  }
}
```

## Paramètres du simulateur (`simulator.params`)
Chaque paramètre a `ref` (entrée de `market`, statut `found`) et `cite` : l'une des citations
(`quote` ou `extra[].quote`) de cette entrée. Chaque nombre du paramètre (`value`, `min`…) doit
figurer dans `cite`. `unit: "%"` signifie que `value` est une fraction (0.07 ↔ « 7 % »).
Cas particuliers vérifiés à part : `baremeS1` (taux et plafonds dans l'ordre), `pretRatio`
(« deux tiers » + majoration), `debours` (= `num` de l'entrée), `xpfToEur` (parité citée).
Les presets de frais de dossier (`bankDossierPresets`) doivent retrouver `pct` et `min` dans la
citation du champ de banque référencé.

## Valeurs à date d'effet (`changes`)
Une entrée peut annoncer une nouvelle grille déjà publiée :
```json
"immo_frais_dossier": {
  "status": "found", "value": "1 % (min. 17 878 XPF)", "num": 17878, "source": "bt_tarifs_2026_v06", "quote": "…",
  "changes": [ { "effective_from": "2027-01-01", "status": "found", "value": "1 % (min. 18 236 XPF)",
                 "num": 18236, "source": "bt_tarifs_2027", "quote": "…" } ]
}
```
Chaque changement est une entrée complète (vérifiée comme les autres). L'application (`src/lib/effective.js`)
affiche l'entrée de base jusqu'à la veille de `effective_from` (date locale du visiteur), avec un badge
« Nouvelle grille au … », puis la valeur du changement à partir de cette date. Les presets de frais de
dossier du simulateur acceptent aussi `changes: [{ "effective_from", "pct"?, "min"? }]`. Une fois la date
passée, `npm run verify` le signale pour qu'on consolide le changement dans l'entrée de base.

## Catalogues de produits et facettes (`catalogs`, `products`)
Vue « trouver un produit » générique (aujourd'hui : cartes, rubrique `compte`). Le moteur
(`src/lib/catalog.js`) et l'interface (`src/Finder.jsx`) ne lisent que ces déclarations.

```json
"products": [{
  "id": "socredo-visa-classic", "kind": "carte", "bank": "socredo", "name": "Visa Classic",
  "note": "optionnel",
  "attrs": { "<attributId>": {Entrée}, "packages": [ {Offre}, … ] },        // attributs communs
  "variants": [ { "id": "differe", "label": "débit différé", "attrs": { … } } ] // optionnel : 1 ligne par variante
}]
```
- Une **ligne** = produit × variante (attributs de la variante prioritaires). Chaque attribut déclaré
  dans le catalogue doit être présent sur chaque ligne : sourcé (`found`) ou `not_published` + `checked`.
- Attributs `enum` et `bool` : l'entrée porte `code` (valeur machine, ex. `"visa"`, `true`) en plus de
  `value` (texte affiché). La citation (ou un `extra`) doit contenir le motif `match` de l'option
  (enum) ou de l'attribut (bool) : un « sans contact : oui » doit citer un texte qui parle de sans
  contact. Un « non publié » ne porte ni `value`, ni `code`, ni `num`.
- Attributs `number` : `num` obligatoire (unité de l'attribut) ; une cotisation mensuelle convertie en
  annuel déclare `"derived": "220 × 12"`.
- Attribut `list` (offres groupées) : `{ "name", "audience": "tous|jeunes|etudiants|fragile", …Entrée
  found avec num (prix mensuel) }`.
- Valeurs à date d'effet : `changes` comme partout (ex. cotisations Banque de Tahiti 2027), y compris
  dans les éléments de liste.

```json
"catalogs": [{
  "id": "carte", "category": "compte", "label": "Trouver ma carte", "itemLabel": ["carte", "cartes"],
  "attributes": [ { "id": "reseau", "label": "Réseau", "type": "enum|bool|number|text|list", "unit": "XPF/an",
                    "options": [ { "value": "visa", "label": "Visa", "match": "visa" } ], "match": "(bool)" } ],
  "summary": ["reseau", …],                       // attributs affichés sur la fiche (les autres : « Tous les attributs »)
  "cost": { "attr": "cotisation", "unit": "XPF/an",
            "alt": { "attr": "packages", "factor": 12, "label": "via offre groupée", "caveat": "…" } },
  "best": { "label": "La moins chère", "basis": "standalone" },   // jamais attribué à un prix d'offre groupée
  "facets": [
    { "id": "banque", "param": "banque", "type": "enum", "field": "bank" },       // champ structurel
    { "id": "reseau", "param": "reseau", "type": "enum", "attr": "reseau" },
    { "id": "sans_contact", "param": "sans_contact", "type": "bool", "attr": "sans_contact" },
    { "id": "mobile", "param": "mobile", "type": "anyOf", "choices": [ { "value": "apple_google", "attrs": ["apple_pay", "google_pay"] } ] },
    { "id": "jeune", "param": "jeune", "type": "listHas", "attr": "packages", "listField": "audience", "values": ["jeunes"], "impliesAlt": true },
    { "id": "budget", "param": "budget", "type": "max", "cost": true },
    { "id": "packages", "param": "packages", "type": "flag", "role": "includeAlt" }
  ],
  "sorts": [ { "id": "cout", "label": "Coût annuel", "by": [ { "cost": true } ] },
             { "id": "gamme", "by": [ { "attr": "gamme" }, { "cost": true } ] } ],   // enum : ordre des options
  "defaultSort": "cout",
  "presets": [ { "id": "visa-moins-chere", "label": "Visa la moins chère", "state": { "reseau": ["visa"] }, "sort": "cout" } ]
}]
```
Règles du moteur : un filtre actif renvoie `match`, `nomatch` ou `unknown` (valeur non publiée) ;
une ligne `unknown` n'est jamais comptée comme correspondante (affichée à part, masquable). Les
lignes sans prix autonome mais présentes dans une offre groupée n'apparaissent qu'avec le drapeau
`includeAlt` (ou une facette `impliesAlt`). URL : `?vue=<catalogue>&<param>=…` (enum : valeurs séparées
par des virgules ; bool : 1/0 ; `tri=<sort>` ; `np=0` masque les « non publié »).
`npm run verify` contrôle aussi : types, options, motifs, facettes ↔ attributs, tris, questions
rapides (facettes et valeurs existantes), unicité des paramètres d'URL.
Options complémentaires d'un catalogue : `"optional": true` sur un attribut (peut manquer sur une
ligne : il n'est alors ni exigé ni affiché), `"flagFalse": "Pas utilisable à l'étranger"` sur un
attribut `bool` (badge d'alerte quand la valeur publiée est « non »), `"compare": { "attrs": [a, b],
"label", "okLabel" }` (deux attributs `number` comparés : badge « écart » ou « identique »),
`"related": [{ "preset": "<id>", "label" }]` sur une question rapide (la meilleure réponse de l'autre
question est calculée et affichée à côté, ex. « Visa la moins chère » → « … utilisable à l'étranger »),
`"layout": "compact"`, `"emptyLabel"`. Le vérificateur contrôle chacune de ces déclarations.

## Repères officiels (`reperes`)
Rubrique `{ "id": "reperes", "view": "reperes" }` : pas de fiches par banque, une vue faite de
sections déclarées dans `data.reperes.sections[]` (rendu : `src/Reperes.jsx`).

```json
{ "id": "taux", "kind": "table", "table": {
    "id": "ieom-taux", "title": "…", "intro": "…", "unit": "%", "series": true,
    "columns": [ { "id": "2026-T2", "label": "T2 2026" } ],
    "headers": [ { "source": "ieom_taux_particuliers_t2_2026", "quote": "<en-tête cité>",
                   "labels": ["T1 2025", …], "columns": ["2025-T1", …] } ],
    "rows": [ { "id": "pf_habitat", "group": "Polynésie française", "label": "Crédits à l'habitat",
                "cells": { "2026-T2": { Entrée found, "num": 2.85, "pos": 6 } } } ],
    "apply": [ {Entrée} ], "notes": ["…"] } }
{ "id": "regles", "kind": "rules", "title": "…", "items": [ { "id": "ira-immo", "label": "…", …Entrée } ] }
{ "id": "engagements", "kind": "catalog", "catalog": "engagement" }
```
- Chaque cellule est une Entrée sourcée ; `pos` = rang du nombre dans la ligne citée (les nombres
  sont découpés comme le fait le contrôle des citations).
- Chaque source utilisée dans un tableau a un **en-tête** (`headers`) : citation présente dans
  l'instantané, libellés des colonnes dans l'ordre. Une cellule n'est acceptée que dans une colonne
  publiée par sa source ; pour une série (`series: true`), son `pos` doit correspondre au rang de la
  colonne (une valeur ne peut pas glisser d'un trimestre à l'autre).
- `kind: "catalog"` : catalogue de la rubrique `reperes` (ici les engagements de l'accord de
  modération 2026-2028, produits `kind: "engagement"`, une ligne par banque × service), rendu par le
  moteur générique de facettes, état dans l'URL (`?vue=engagement&eb=bt&service=carte_di`).
- Un élément non publié porte `status: "not_published"` et `checked` (liste des sources consultées).
