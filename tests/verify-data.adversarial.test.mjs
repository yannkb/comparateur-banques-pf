// Tests adversariaux du vérificateur : chaque cas DEVRAIT être rejeté (exit 1).
// Un test qui échoue ici = une faille du vérificateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = process.env.VERIFY_SCRIPT || new URL('../scripts/verify-data.mjs', import.meta.url).pathname;
const data = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const run = (d) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cbpf-adv-')), 'banks.json');
  writeFileSync(p, JSON.stringify(d));
  return spawnSync('node', [script, p], { encoding: 'utf8' });
};
const mustReject = (d) => {
  const r = run(d);
  assert.equal(r.status, 1, 'le vérificateur a accepté des données falsifiées');
  assert.match(r.stderr, /✗ /, `rejet sans diagnostic (plantage ?) : ${r.stderr.slice(0, 300)}`);
};
const clone = () => structuredClone(data);
const bank = (d, id) => d.banks.find((b) => b.id === id);

test('A1 valeur affichée falsifiée, citation intacte', () => {
  const d = clone();
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { value: '38 XPF/mois', num: 38 });
  mustReject(d);
});

test('A2 citation tronquée au milieu d’un nombre (383 → 38)', () => {
  const d = clone();
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { value: '38 XPF/mois', num: 38, quote: 'Tenue de compte à vue (forfait mensuel) 38' });
  mustReject(d);
});

test('A3 nombre recomposé par suppression des blancs (« 3 83 » ≡ « 383 »)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.quote = 'Tenue de compte à vue (forfait mensuel) 3 83';
  mustReject(d);
});

test('A4 citation composée uniquement de blancs (8 espaces)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.quote = '        ';
  mustReject(d);
});

test('A5 paramètre du simulateur falsifié (droits 7 % → 1 %)', () => {
  const d = clone();
  d.simulator.params.droitsAncien.value = 0.01;
  mustReject(d);
});

test('A6 barème S1 falsifié', () => {
  const d = clone();
  d.simulator.params.baremeS1.tranches[0][1] = 0.5;
  mustReject(d);
});

test('A7 parité XPF/EUR falsifiée (aucune référence)', () => {
  const d = clone();
  d.simulator.params.xpfToEur.value = 0.01;
  mustReject(d);
});

test('A8 preset de frais de dossier falsifié (BT 1 % → 0,1 %, min 1)', () => {
  const d = clone();
  Object.assign(d.simulator.bankDossierPresets.find((p) => p.bank === 'bt'), { pct: 0.1, min: 1 });
  mustReject(d);
});

test('A9 date de consultation périmée / incohérente', () => {
  const d = clone();
  d.sources.socredo_tarifs_2026.accessed = '1999-01-01';
  d.sources.socredo_tarifs_2026.documentDate = '2099-12-31';
  mustReject(d);
});

test('A10 chemin d’instantané hors de data/sources (lecture arbitraire)', () => {
  const d = clone();
  d.sources.evil = { ...d.sources.socredo_tarifs_2026, snapshot: 'package-lock.json' };
  Object.assign(bank(d, 'socredo').fields.cpt_tenue, { source: 'evil', quote: '"name": "comparateur-banques-pf"' });
  mustReject(d);
});

test('A11 valeur vide déguisée (une espace)', () => {
  const d = clone();
  bank(d, 'socredo').fields.cpt_tenue.value = ' ';
  mustReject(d);
});

test('A12 valeur de tri calculée sans déclaration « derived »', () => {
  const d = clone();
  delete bank(d, 'bt').fields.cpt_tenue.derived;
  mustReject(d);
});

test('A13 parité sans référence sourcée', () => {
  const d = clone();
  delete d.simulator.params.xpfToEur.ref;
  mustReject(d);
});

test('A14 instantané remonté hors de data/sources via « ../ »', () => {
  const d = clone();
  d.sources.socredo_tarifs_2026.snapshot = 'data/sources/../../package.json';
  mustReject(d);
});

test('A15 calcul « derived » faux (951 / 3 annoncé, num 300)', () => {
  const d = clone();
  bank(d, 'bt').fields.cpt_tenue.num = 300;
  mustReject(d);
});

test('A16 opérande d’un calcul « derived » absent de la citation', () => {
  const d = clone();
  Object.assign(bank(d, 'bt').fields.cpt_tenue, { num: 400, derived: '1 200 / 3' });
  mustReject(d);
});

test('A17 paramètre simulateur : « cite » qui n’est pas une citation de la référence', () => {
  const d = clone();
  Object.assign(d.simulator.params.droitsAncien, { value: 0.01, cite: 'droit réduit à 1 %' });
  mustReject(d);
});

test('A18 barème de frais de dossier (tri par coût) falsifié', () => {
  const d = clone();
  bank(d, 'bdp').fields.immo_frais_dossier.fee = { pct: 0.1, min: 51300 };
  mustReject(d);
});

test('A19 valeur 2027 falsifiée (citation 2027 intacte)', () => {
  const d = clone();
  Object.assign(bank(d, 'bt').fields.immo_frais_dossier.changes[0], { num: 1823, value: '1 % (min. 1 823 XPF)' });
  mustReject(d);
});

// La cellule « carte haut de gamme » de la BT est dérivée du catalogue : on falsifie la cotisation du produit.
const btPremier = (d) => d.products.find((p) => p.id === 'bt-visa-premier').variants.find((v) => v.id === 'immediat').attrs.cotisation;

test('A20 preset BT 2027 falsifié / date d’effet invalide', () => {
  const d = clone();
  d.simulator.bankDossierPresets.find((p) => p.bank === 'bt').changes[0].min = 1;
  mustReject(d);
  const d2 = clone();
  btPremier(d2).changes[0].effective_from = '1er janvier';
  mustReject(d2);
});

test('A21 grille datée après la date d’effet annoncée', () => {
  const d = clone();
  btPremier(d).changes[0].effective_from = '2026-12-01';
  mustReject(d);
});

// ---------- Catalogue de cartes ----------
const prod = (d, id) => d.products.find((p) => p.id === id);

test('A22 attribut de carte inventé : « sans contact : oui » sur la carte FENUA avec une citation fabriquée', () => {
  const d = clone();
  prod(d, 'marara-fenua').attrs.sans_contact = { status: 'found', value: 'Oui', code: true, source: 'marara_cartes_locales', quote: 'La carte Fenua est équipée du paiement sans contact.' };
  mustReject(d);
});

test('A23 attribut de carte appuyé sur une citation réelle mais hors sujet (Apple Pay « justifié » par un prix)', () => {
  const d = clone();
  prod(d, 'marara-visa-classic').attrs.apple_pay = { status: 'found', value: 'Oui', code: true, source: 'marara_tarifs_2026', quote: 'Pack MARARA (par mois) 650' };
  mustReject(d);
});

test('A24 code d’énumération contredit par la citation (Tiare « débit différé »)', () => {
  const d = clone();
  prod(d, 'bt-tiare').attrs.debit.code = 'differe';
  mustReject(d);
  const d2 = clone();
  prod(d2, 'bt-tiare').attrs.reseau.code = 'amex';
  mustReject(d2);
});

test('A25 cotisation mensuelle convertie en annuel sans « derived » (FENUA 220/mois → 2 640/an)', () => {
  const d = clone();
  delete prod(d, 'marara-fenua').attrs.cotisation.derived;
  mustReject(d);
  const d2 = clone();
  Object.assign(prod(d2, 'marara-fenua').attrs.cotisation, { num: 2400, derived: '200 × 12' });
  mustReject(d2);
});

test('A26 « non publié » qui cache une valeur, ou sans source consultée', () => {
  const d = clone();
  Object.assign(prod(d, 'bdp-hoa').attrs.sans_contact, { code: true });
  mustReject(d);
  const d2 = clone();
  prod(d2, 'bdp-hoa').attrs.sans_contact.checked = [];
  mustReject(d2);
});

test('A27 attribut manquant ou inconnu sur une carte', () => {
  const d = clone();
  delete prod(d, 'socredo-gold').attrs.google_pay;
  mustReject(d);
  const d2 = clone();
  prod(d2, 'socredo-gold').attrs.cashback = { status: 'not_published', checked: ['socredo_cartes'] };
  mustReject(d2);
});

test('A28 facette ou question rapide incohérente avec les attributs déclarés', () => {
  const d = clone();
  d.catalogs[0].presets[0].state = { reseau: ['amex'] };
  mustReject(d);
  const d2 = clone();
  d2.catalogs[0].facets.find((f) => f.id === 'sans_contact').attr = 'cotisation';
  mustReject(d2);
});

test('A29 cotisation BT 2027 falsifiée (citation 2027 intacte) et offre groupée sans prix', () => {
  const d = clone();
  prod(d, 'bt-visa-premier').variants.find((v) => v.id === 'immediat').attrs.cotisation.changes[0].num = 2300;
  mustReject(d);
  const d2 = clone();
  delete prod(d2, 'socredo-classic').attrs.packages[0].num;
  mustReject(d2);
});

const sec = (d, id) => d.reperes.sections.find((s) => s.id === id);
const taux = (d) => sec(d, 'taux').table;
const habitat = (d) => taux(d).rows.find((r) => r.id === 'pf_habitat').cells;

test('A30 repère officiel falsifié : taux moyen habitat IEOM 2,85 % → 2,50 % (citation intacte)', () => {
  const d = clone();
  Object.assign(habitat(d)['2026-T2'], { value: '2,50 %', num: 2.5 });
  mustReject(d);
});

test('A31 repère décalé d’un trimestre : la valeur T1 2026 (2,86) présentée comme T2 2026', () => {
  const d = clone();
  Object.assign(habitat(d)['2026-T2'], { value: '2,86 %', num: 2.86, pos: 5 });
  mustReject(d);
});

test('A32 repère dans une colonne que sa source ne publie pas (T2 2024 cité depuis la note T2 2026)', () => {
  const d = clone();
  habitat(d)['2024-T2'] = { ...habitat(d)['2026-T2'], pos: 1, value: '3,45 %', num: 3.45 };
  mustReject(d);
});

test('A33 repère inventé : règle LP 2025-21 avec citation absente de l’instantané', () => {
  const d = clone();
  const it = sec(d, 'regles').items.find((i) => i.id === 'ira-immo');
  it.quote = 'ne peut excéder la valeur de deux mois d’intérêt sur le capital remboursé';
  mustReject(d);
});

test('A34 engagement de l’accord : tarif IEOM falsifié, ou rubrique reperes vers un catalogue d’une autre rubrique', () => {
  const d = clone();
  Object.assign(prod(d, 'eng-bt-carte_di').attrs.tarif, { value: '4 813 XPF/an', num: 4813 });
  mustReject(d);
  const d2 = clone();
  sec(d2, 'engagements').catalog = 'carte';
  mustReject(d2);
});

test('A35 question liée vers une question rapide inconnue, alerte flagFalse sur un attribut non booléen', () => {
  const d = clone();
  d.catalogs.find((c) => c.id === 'carte').presets.find((p) => p.id === 'visa-moins-chere').related[0].preset = 'inexistante';
  mustReject(d);
  const d2 = clone();
  d2.catalogs.find((c) => c.id === 'carte').attributes.find((a) => a.id === 'cotisation').flagFalse = 'x';
  mustReject(d2);
});

test('les données versionnées passent la vérification stricte', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'cbpf-adv-')), 'banks.json');
  writeFileSync(p, JSON.stringify(data));
  assert.equal(spawnSync('node', [script, p, '--strict'], { encoding: 'utf8' }).status, 0);
});

// ---------- Cellules dérivées des catalogues, attributs communs, critères peu publiés ----------
test('A40 cellule de comparaison ressaisie qui diverge de sa source dans le catalogue', () => {
  const d = clone();
  Object.assign(bank(d, 'socredo').fields.carte_classic, { num: 4999 }); // « from » + chiffre ressaisi
  mustReject(d);
  const d2 = clone();
  Object.assign(bank(d2, 'bdp').fields.carte_premium, { value: 'Visa Premier 2 030 XPF/an' });
  mustReject(d2);
});

test('A41 cellule couverte par un catalogue saisie à la main (sans « from »)', () => {
  const d = clone();
  bank(d, 'bt').fields.carte_classic = { status: 'found', value: 'Visa Classic 5 813 XPF/an', num: 5813, source: 'bt_tarifs_2026_v06', quote: 'Cotisation carte (à débit immédiat) - Cotisation annuelle 5 813' };
  mustReject(d);
});

test('A42 cellule dérivée pointant vers le produit d’une autre banque ou une variante inconnue', () => {
  const d = clone();
  bank(d, 'socredo').fields.carte_premium.from[0].row = 'marara-visa-premier';
  mustReject(d);
  const d2 = clone();
  bank(d2, 'socredo').fields.carte_classic.from[0].row = 'socredo-visa-classic/inconnue';
  mustReject(d2);
});

test('A43 valeur commune de la banque falsifiée (citation intacte)', () => {
  const d = clone();
  Object.assign(bank(d, 'bdp').shared.retrait_pf, { num: 12, value: '12 XPF/retrait' });
  mustReject(d);
});

test('A44 valeur héritée contredite par un produit avec la même citation', () => {
  const d = clone();
  // 842 figure bien dans les citations BT (plafond par paiement) : seul le contrôle de contradiction peut rejeter
  prod(d, 'bt-visa-infinite').attrs.frais_etranger = { ...structuredClone(bank(d, 'bt').shared.frais_etranger), num: 842, override: 'Infinite' };
  const r = run(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contredit l'attribut commun/);
});

test('A45 redéfinition d’un attribut commun sans raison (override) ou redondante', () => {
  const d = clone();
  delete prod(d, 'bdp-hoa').attrs.frais_etranger.override;
  mustReject(d);
  const d2 = clone();
  prod(d2, 'bt-visa-infinite').attrs.retrait_banque = { ...structuredClone(bank(d2, 'bt').shared.retrait_banque), override: 'copie' };
  mustReject(d2);
});

test('A46 filtre sur un critère publié par moins de deux établissements', () => {
  const d = clone();
  const c = d.catalogs.find((x) => x.id === 'carte');
  c.attributes.push({ id: 'cashback', label: 'Cashback', type: 'bool', optional: true, match: 'cashback', options: [{ value: true, label: 'Oui' }, { value: false, label: 'Non' }] });
  c.facets.push({ id: 'cashback', param: 'cashback', label: 'Cashback', type: 'bool', attr: 'cashback' });
  const r = run(d); // personne ne publie : 0 établissement
  assert.equal(r.status, 1);
  assert.match(r.stderr, /facette cashback: critère publié par 0 établissement/);
  const d2 = clone();
  const c2 = d2.catalogs.find((x) => x.id === 'carte');
  c2.attributes.find((a) => a.id === 'samsung_pay').label = 'Samsung Pay';
  // garder seules les valeurs Samsung Pay d'UNE banque (les autres → non publié)
  for (const p of d2.products.filter((x) => x.kind === 'carte' && x.bank !== 'bt')) for (const a of [p.attrs, ...(p.variants || []).map((v) => v.attrs)]) {
    if (a.samsung_pay) a.samsung_pay = { status: 'not_published', checked: ['bt_cgu_samsung_pay'] };
  }
  c2.facets.push({ id: 'samsung', param: 'samsung', label: 'Samsung Pay', type: 'bool', attr: 'samsung_pay' });
  const r2 = run(d2);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /facette samsung: critère publié par 1 établissement/);
});

test('A47 plusieurs réseaux sur un attribut non « multi », ou réseau non justifié par la citation', () => {
  const d = clone();
  d.catalogs.find((x) => x.id === 'carte').attributes.find((a) => a.id === 'reseau').multi = false;
  mustReject(d);
  const d2 = clone();
  prod(d2, 'bdp-visa-red').attrs.reseau.code = ['cb', 'visa']; // la citation BDP ne parle pas de CB
  mustReject(d2);
});
