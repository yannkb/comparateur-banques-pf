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
