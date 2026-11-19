// Données « Repères officiels » et logique associée (question liée, comparaison IEOM / grille, alerte flagFalse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataAt } from '../src/lib/effective.js';
import { codesOf, compareOf, presetBest, query, presetState, rowsOf } from '../src/lib/catalog.js';

const d = dataAt(JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url))), '2026-11-18');
const buildRows = (c, products) => rowsOf(c, products, d.banks);
const sec = (id) => d.reperes.sections.find((s) => s.id === id);
const cat = (id) => d.catalogs.find((c) => c.id === id);
const NOW = '2026-11-18';
const labels = { field: (f, v) => d.banks.findIndex((b) => b.id === v) };

test('rubrique Repères officiels déclarée comme vue, avec son catalogue d’engagements', () => {
  const c = d.categories.find((x) => x.id === 'reperes');
  assert.equal(c.view, 'reperes');
  assert.equal(cat('engagement').category, 'reperes');
  assert.deepEqual(d.reperes.sections.map((s) => s.id), ['taux', 'usure', 'regles', 'accord', 'extrait', 'engagements']);
});

test('taux IEOM : dernière colonne = repères du bandeau (habitat, conso, découvert)', () => {
  const t = sec('taux').table, last = t.columns.at(-1).id;
  const cell = (id) => t.rows.find((r) => r.id === id).cells[last];
  assert.equal(cell('pf_habitat').num, d.market.ieom_habitat.num);
  assert.equal(cell('pf_conso').num, d.market.ieom_conso.num);
  assert.equal(cell('pf_decouvert').num, d.market.ieom_decouvert.num);
});

test('taux IEOM : historique continu de 9 trimestres, chaque cellule chiffrée et sourcée', () => {
  const t = sec('taux').table;
  assert.equal(t.columns.length, 9);
  for (const r of t.rows.filter((x) => x.id.startsWith('pf_'))) {
    for (const c of t.columns) {
      const e = r.cells[c.id];
      assert.ok(e && e.status === 'found' && typeof e.num === 'number' && e.source.startsWith('ieom_'), `${r.id}[${c.id}]`);
    }
  }
});

test('seuils d’usure : seuil immobilier ≥ 20 ans courant = paramètre du simulateur', () => {
  const t = sec('usure').table;
  const cols = t.columns.map((c) => c.id);
  assert.deepEqual(cols, [...cols].sort());
  const cur = cols.filter((c) => c <= NOW).at(-1);
  const r = t.rows.find((x) => x.id === 'immo_20_plus');
  assert.equal(r.cells[cur].num, d.market.usure_habitat.num);
});

test('barème IRA (arrêté 1813 CM) : 6 mois d’intérêts plafonnés à 3 % du capital restant dû', () => {
  const ira = sec('regles').items.find((i) => i.id === 'ira-immo');
  assert.equal(ira.status, 'found');
  assert.equal(ira.source, 'lexpol_arrete_1813_cm_2025');
  assert.match(ira.value, /6 mois/);
  assert.match(ira.value, /3 %/);
});

test('fiche d’information type (FIT) obligatoire pour le crédit immobilier, citée de la LP 2025-21', () => {
  const fit = sec('regles').items.find((i) => i.id === 'fit-immo');
  assert.equal(fit.source, 'lexpol_lp_2025_21');
  assert.match(fit.quote, /fiche d'information/i);
});

test('engagements : une ligne par banque × service, filtrables par banque, gratuité = 0 XPF', () => {
  const c = cat('engagement');
  const rows = buildRows(c, d.products, NOW);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of ['bdp', 'bt', 'socredo', 'marara']) assert.ok(rows.some((r) => r.bank === b), b);
  const st = presetState(c, c.presets.find((p) => p.id === 'gratuites'));
  const res = query(c, rows, st, labels);
  assert.deepEqual(new Set(res.matches.map((m) => m.row.bank)), new Set(["bdp", "bt", "socredo", "marara"]));
  for (const m of res.matches) assert.equal(m.row.attrs.tarif.num, 0, m.row.id);
});

test('compareOf : seul l’écart BT (virement permanent IEOM vs grille) est signalé', () => {
  const c = cat('engagement');
  const rows = buildRows(c, d.products, NOW);
  const diffs = rows.filter((r) => compareOf(c, r) === 'diff').map((r) => r.id);
  assert.deepEqual(diffs, ['eng-bt-suivi']);
  assert.equal(compareOf(c, rows.find((r) => r.id === 'eng-bdp-carte_di')), 'same');
  assert.equal(compareOf(c, rows.find((r) => r.id === 'eng-bdp-virement_internet')), null); // pas de prix « grille » cité
});

test('Visa la moins chère : la carte est signalée « pas utilisable à l’étranger » ; la question liée donne une Visa internationale', () => {
  const c = cat('carte');
  const rows = buildRows(c, d.products, NOW);
  const intl = c.attributes.find((a) => a.id === 'international');
  assert.ok(intl.flagFalse);
  const visa = presetBest(c, rows, 'visa-moins-chere', labels);
  assert.ok(visa.length >= 1);
  const v0 = visa[0].row;
  // calcul indépendant : moins chère des cartes Visa / internationales, d'après les données
  const cheapest = (pred) => {
    const ok = rows.filter((r) => codesOf(r.attrs.reseau).includes('visa') && pred(r) && typeof r.attrs.cotisation?.num === 'number');
    const min = Math.min(...ok.map((r) => r.attrs.cotisation.num));
    return { min, ids: ok.filter((r) => r.attrs.cotisation.num === min).map((r) => r.id) };
  };
  const all = cheapest(() => true);
  assert.ok(all.ids.includes(v0.id));
  assert.equal(v0.attrs.international.code, false, 'la Visa la moins chère n’est pas utilisable à l’étranger (si cela change, le test le dira)');
  const abroad = presetBest(c, rows, 'visa-etranger-moins-chere', labels);
  const exp = cheapest((r) => r.attrs.international?.code === true);
  assert.deepEqual(abroad.map((m) => m.row.id).sort(), exp.ids.sort());
  assert.ok(abroad.every((m) => m.row.attrs.international.code === true && m.cost.value === exp.min));
  const rel = c.presets.find((p) => p.id === 'visa-moins-chere').related;
  assert.deepEqual(rel.map((r) => r.preset), ['visa-etranger-moins-chere']);
});

test('presetBest : question inconnue → aucune ligne', () => {
  const c = cat('carte');
  assert.deepEqual(presetBest(c, buildRows(c, d.products, NOW), 'nope', labels), []);
});
