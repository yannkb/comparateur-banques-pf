// Moteur de facettes générique (src/lib/catalog.js) : filtres, « non publié », tri, questions rapides, URL,
// valeurs à date d'effet (grille Banque de Tahiti 2027). Un catalogue jouet vérifie l'indépendance vis-à-vis des cartes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataAt } from '../src/lib/effective.js';
import { bestIds, codesOf, costOf, defaultState, facetCounts, publishedBanks, rareAttributes, paramsToState, presetState, query, rowsOf, sameState, stateToParams } from '../src/lib/catalog.js';

const raw = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const at = (iso) => {
  const d = dataAt(raw, iso);
  const cat = d.catalogs.find((c) => c.id === 'carte');
  const labels = { field: (f, v) => d.banks.findIndex((b) => b.id === v) };
  return { d, cat, rows: rowsOf(cat, d.products, d.banks), run: (st) => query(cat, rowsOf(cat, d.products, d.banks), st, labels) };
};
const NOW = at('2026-11-18');
const preset = (id, ctx = NOW) => ctx.run(presetState(ctx.cat, ctx.cat.presets.find((p) => p.id === id)));
const ids = (items) => items.map((m) => m.row.id);
const row = (id, ctx = NOW) => ctx.rows.find((r) => r.id === id);

// Réimplémentation naïve et indépendante : la moins chère des lignes dont l'attribut vaut `code`, prix autonome publié.
function naiveCheapest(ctx, attr, code) {
  const c = ctx.rows.filter((r) => r.attrs[attr]?.status === 'found' && codesOf(r.attrs[attr]).includes(code) && typeof r.attrs.cotisation?.num === 'number');
  const min = Math.min(...c.map((r) => r.attrs.cotisation.num));
  return c.filter((r) => r.attrs.cotisation.num === min).map((r) => r.id).sort();
}

test('catalogue : une ligne par produit × variante, attributs fusionnés', () => {
  assert.equal(NOW.rows.length, NOW.d.products.filter((p) => p.kind === 'carte').reduce((n, p) => n + (p.variants?.length || 1), 0));
  const v = row('socredo-visa-classic/differe');
  assert.equal(v.attrs.debit.code, 'differe');
  assert.deepEqual(codesOf(v.attrs.reseau), ['visa']); // attribut commun au produit
  assert.equal(v.variant, 'débit différé');
});

test('« Visa la moins chère » : la moins chère des cartes au réseau Visa (calcul indépendant)', () => {
  const r = preset('visa-moins-chere');
  assert.deepEqual(bestIds(NOW.cat, r.matches), naiveCheapest(NOW, 'reseau', 'visa'));
  assert.equal(r.matches[0].row.id, 'bt-tiare');
  assert.equal(r.matches[0].cost.value, 3604);
  assert.ok(r.matches.every((m) => codesOf(m.row.attrs.reseau).includes('visa')));
  for (let i = 1; i < r.matches.length; i++) assert.ok(r.matches[i - 1].cost.value <= r.matches[i].cost.value, 'tri croissant');
});

test('« Sans contact la moins chère » : les « non publié » ne comptent jamais comme « oui »', () => {
  const r = preset('sans-contact-moins-chere');
  assert.deepEqual(bestIds(NOW.cat, r.matches), naiveCheapest(NOW, 'sans_contact', true));
  assert.ok(r.matches.every((m) => m.row.attrs.sans_contact.status === 'found' && m.row.attrs.sans_contact.code === true));
  // carte FENUA (2 640 XPF/an, moins chère) : sans contact non publié → à vérifier, pas « la moins chère »
  assert.ok(ids(r.unknown).includes('marara-fenua'));
  assert.ok(!ids(r.matches).includes('marara-fenua'));
  assert.deepEqual(r.unknown.find((m) => m.row.id === 'marara-fenua').unknownFacets, ['sans_contact']);
  // carte SOCREDO Classic : « Non » publié → exclue
  assert.ok(![...ids(r.matches), ...ids(r.unknown)].includes('socredo-classic'));
  // option « masquer les non publié »
  const hidden = NOW.run({ ...presetState(NOW.cat, NOW.cat.presets.find((p) => p.id === 'sans-contact-moins-chere')), includeUnknown: false });
  assert.equal(hidden.unknown.length, 0);
  assert.deepEqual(ids(hidden.matches), ids(r.matches));
});

test('booléen « Non » et facette anyOf (Apple Pay ou Google Pay)', () => {
  const non = NOW.run({ ...defaultState(NOW.cat), f: { sans_contact: false } });
  assert.ok(non.matches.length > 0 && non.matches.every((m) => m.row.attrs.sans_contact.code === false));
  const r = preset('apple-google-pay');
  assert.ok(r.matches.length > 0);
  for (const m of r.matches) assert.ok(m.row.attrs.apple_pay.code === true || m.row.attrs.google_pay.code === true);
  assert.ok(!ids(r.matches).includes('bt-tiare') && !ids(r.unknown).includes('bt-tiare'), 'Tiare : « Non » publié (CGU) → exclue');
  assert.ok(r.unknown.every((m) => m.row.attrs.apple_pay.status === 'not_published'));
});

test('offres groupées : masquées par défaut, coût « via offre groupée » sans être « la moins chère »', () => {
  const base = NOW.run(defaultState(NOW.cat));
  assert.ok(base.hiddenAlt >= 1);
  assert.ok(!ids([...base.matches, ...base.unknown]).includes('socredo-uru-jeunes'));
  const r = preset('carte-jeune');
  assert.equal(r.includeAlt, true);
  const uru = r.matches.find((m) => m.row.id === 'socredo-uru-jeunes');
  assert.deepEqual([uru.cost.kind, uru.cost.value], ['alt', 389 * 12]);
  assert.ok(r.matches.every((m) => m.row.attrs.packages.some((p) => ['jeunes', 'etudiants'].includes(p.audience))));
  assert.ok(!bestIds(NOW.cat, r.matches).includes('socredo-uru-jeunes'), 'pas de « moins chère » sur un prix de package');
  const v = costOf(NOW.cat, row('socredo-visa-classic/immediat'), true);
  assert.deepEqual([v.kind, v.value, v.alts[0].entry.num], ['standalone', 5666, 1100]);
});

test('budget maximum, banque, tris (banque, gamme, frais à l’étranger)', () => {
  const r = NOW.run({ ...defaultState(NOW.cat), f: { budget: 5000, banque: ['marara', 'bt'] } });
  assert.ok(r.matches.every((m) => m.cost.value <= 5000 && ['marara', 'bt'].includes(m.row.bank)));
  assert.deepEqual(ids(r.matches).sort(), ['bt-tiare', 'marara-fenua', 'marara-kaveka', 'marara-visa-classic'].sort());
  const byBank = NOW.run({ ...defaultState(NOW.cat), sort: 'banque' }).matches.map((m) => m.row.bank);
  assert.deepEqual([...new Set(byBank)], NOW.d.banks.map((b) => b.id));
  const order = NOW.cat.attributes.find((a) => a.id === 'gamme').options.map((o) => o.value);
  const g = NOW.run({ ...defaultState(NOW.cat), sort: 'gamme' }).matches.map((m) => order.indexOf(m.row.attrs.gamme.code)).map((i) => (i < 0 ? 99 : i));
  assert.deepEqual(g, [...g].sort((a, b) => a - b));
  const travel = preset('voyager');
  assert.ok(travel.matches.every((m) => m.row.attrs.international.code === true));
  assert.equal(travel.matches[0].row.attrs.frais_etranger.num, 0);
});

test('URL : aller-retour état ⇄ paramètres, valeurs invalides ignorées, questions rapides partageables', () => {
  for (const p of NOW.cat.presets) {
    const st = presetState(NOW.cat, p);
    const back = paramsToState(NOW.cat, new URLSearchParams(stateToParams(NOW.cat, st).toString()), { bank: NOW.d.banks.map((b) => ({ value: b.id })) });
    assert.ok(sameState(NOW.cat, st, back), p.id);
  }
  assert.equal(stateToParams(NOW.cat, presetState(NOW.cat, NOW.cat.presets.find((p) => p.id === 'sans-contact-moins-chere'))).toString(), 'sans_contact=1');
  assert.equal(stateToParams(NOW.cat, presetState(NOW.cat, NOW.cat.presets.find((p) => p.id === 'visa-etranger-moins-chere'))).toString(), 'reseau=visa&etranger=1');
  const s = paramsToState(NOW.cat, new URLSearchParams('reseau=visa,bidon&sans_contact=2&tri=xxx&budget=-3&np=0'));
  assert.deepEqual(s.f, { reseau: ['visa'] });
  assert.equal(s.sort, NOW.cat.defaultSort);
  assert.equal(s.includeUnknown, false);
});

test('grille BT 2027 : cotisations des cartes à date d’effet', () => {
  const before = { 'bt-visa-premier/immediat': 22557, 'bt-visa-premier/differe': 22328, 'bt-visa-infinite': 55843, 'bt-visa-as': 7369, 'bt-tiare': 3604, 'bt-visa-classic/immediat': 5813 };
  const after = { 'bt-visa-premier/immediat': 23008, 'bt-visa-premier/differe': 22775, 'bt-visa-infinite': 56960, 'bt-visa-as': 7516, 'bt-tiare': 3604, 'bt-visa-classic/immediat': 5813 };
  for (const day of ['2026-11-18', '2026-12-31']) {
    const c = at(day);
    for (const [id, v] of Object.entries(before)) {
      assert.equal(row(id, c).attrs.cotisation.num, v, `${day} ${id}`);
      assert.equal(row(id, c).attrs.cotisation.next.effective_from, '2027-01-01');
    }
  }
  const c27 = at('2027-01-02');
  for (const [id, v] of Object.entries(after)) {
    const e = row(id, c27).attrs.cotisation;
    assert.equal(e.num, v, id);
    assert.equal(e.source, 'bt_tarifs_2027');
    assert.equal(e.next, undefined);
  }
  assert.match(row('bt-visa-as', c27).attrs.frais_etranger.value, /859/);
  const hg = preset('haut-de-gamme', c27);
  assert.equal(hg.matches.find((m) => m.row.id === 'bt-visa-infinite').cost.value, 56960);
  // les autres banques ne bougent pas
  assert.equal(row('marara-visa-classic', c27).attrs.cotisation.num, 5000);
});

test('moteur indépendant du type de produit (catalogue jouet « livret »)', () => {
  const cat = {
    id: 'livret', attributes: [{ id: 'taux', type: 'number' }, { id: 'jeune', type: 'bool', options: [] }, { id: 'frais', type: 'number' }],
    cost: { attr: 'frais' }, best: { label: 'Le moins cher', basis: 'standalone' },
    facets: [{ id: 'jeune', param: 'j', type: 'bool', attr: 'jeune' }],
    sorts: [{ id: 'taux', by: [{ attr: 'taux', dir: 'desc' }] }], defaultSort: 'taux', presets: [],
  };
  const E = (num, code) => ({ status: 'found', value: 'x', num, code, source: 's', quote: 'q' });
  const products = [
    { id: 'a', kind: 'livret', bank: 'b1', name: 'A', attrs: { taux: E(1), jeune: E(undefined, true), frais: E(0) } },
    { id: 'b', kind: 'livret', bank: 'b2', name: 'B', attrs: { taux: E(3), jeune: { status: 'not_published', checked: ['s'] }, frais: E(10) } },
    { id: 'c', kind: 'livret', bank: 'b3', name: 'C', attrs: { taux: E(2), jeune: E(undefined, false), frais: E(5) } },
    { id: 'z', kind: 'autre', bank: 'b3', name: 'Z', attrs: {} },
  ];
  const rows = rowsOf(cat, products);
  assert.equal(rows.length, 3);
  assert.deepEqual(ids(query(cat, rows, defaultState(cat)).matches), ['b', 'c', 'a']);
  const r = query(cat, rows, { ...defaultState(cat), f: { jeune: true } });
  assert.deepEqual([ids(r.matches), ids(r.unknown)], [['a'], ['b']]);
  assert.deepEqual(bestIds(cat, query(cat, rows, defaultState(cat)).matches), ['a']);
});

test('attributs communs de la banque : hérités par les cartes, redéfinis par produit (override)', () => {
  const soc = NOW.d.banks.find((b) => b.id === 'socredo');
  const v = row('socredo-visa-classic/immediat');
  assert.ok(v.inherited.includes('retrait_pf') && v.inherited.includes('frais_etranger'));
  assert.deepEqual(v.attrs.retrait_pf, soc.shared.retrait_pf, 'valeur commune déclarée une seule fois');
  // override : la carte URU JEUNES (modèle non précisé) garde son « non publié »
  const uru = row('socredo-uru-jeunes');
  assert.ok(!uru.inherited.includes('retrait_pf'));
  assert.equal(uru.attrs.retrait_pf.status, 'not_published');
  assert.ok(uru.attrs.retrait_pf.override);
  // BT 2027 : la valeur commune suit la grille à date d'effet (frais en devises plafonnés à 859 XPF)
  assert.match(row('bt-visa-premier/immediat', at('2027-01-02')).attrs.frais_etranger.value, /859/);
  // sans les banques : rien n'est hérité (le moteur n'invente pas de valeur)
  assert.equal(rowsOf(NOW.cat, NOW.d.products).find((r) => r.id === 'socredo-visa-classic/immediat').attrs.retrait_pf, undefined);
});

test('attributs communs : jouet (hérité, redéfini, absent)', () => {
  const cat = { id: 't', attributes: [{ id: 'x', type: 'number', shared: true }, { id: 'y', type: 'number' }], facets: [], sorts: [], presets: [] };
  const E = (num) => ({ status: 'found', value: String(num), num, source: 's', quote: 'q' });
  const banks = [{ id: 'b1', shared: { x: E(1) } }, { id: 'b2' }];
  const rows = rowsOf(cat, [
    { id: 'p1', kind: 't', bank: 'b1', name: 'P1', attrs: { y: E(5) } },
    { id: 'p2', kind: 't', bank: 'b1', name: 'P2', attrs: { x: { ...E(2), override: 'tarif propre' }, y: E(5) } },
    { id: 'p3', kind: 't', bank: 'b2', name: 'P3', attrs: { y: E(5) } },
  ], banks);
  assert.deepEqual(rows.map((r) => r.attrs.x?.num), [1, 2, undefined]);
  assert.deepEqual(rows.map((r) => r.inherited), [['x'], [], []]);
});

test('réseau multiple (CB + Visa) : chaque code compte pour son option, tri sur la première option', () => {
  const tiare = row('bt-tiare');
  assert.deepEqual(codesOf(tiare.attrs.reseau).sort(), ['cb', 'visa']);
  const cb = NOW.run({ ...defaultState(NOW.cat), f: { reseau: ['cb'] } });
  assert.ok(cb.matches.length >= 2 && cb.matches.every((m) => codesOf(m.row.attrs.reseau).includes('cb')));
  assert.ok(ids(cb.matches).includes('bt-tiare') && ids(preset('visa-moins-chere').matches).includes('bt-tiare'), 'une carte CB-Visa répond à « CB » ET à « Visa »');
  assert.ok(!ids(cb.matches).includes('socredo-visa-classic/immediat'));
});

test('comptes par option : résultats si l’on choisit cette option, autres filtres actifs, « non publié » jamais comptés', () => {
  const fo = { bank: NOW.d.banks.map((b) => ({ value: b.id })) };
  const st = { ...defaultState(NOW.cat), f: { etranger: true } };
  const counts = facetCounts(NOW.cat, NOW.rows, st, fo);
  // recalcul naïf : cartes utilisables à l'étranger (publié « oui ») et au réseau donné, prix autonome publié
  for (const code of ['visa', 'cb', 'local', 'upi']) {
    const exp = NOW.rows.filter((r) => r.attrs.international?.status === 'found' && r.attrs.international.code === true
      && r.attrs.reseau?.status === 'found' && codesOf(r.attrs.reseau).includes(code) && typeof r.attrs.cotisation?.num === 'number').length;
    assert.equal(counts.reseau[code], exp, code);
  }
  assert.equal(counts.reseau.local, 0, 'cartes locales : pas utilisables à l’étranger');
  // la facette elle-même : son option remplace la valeur courante (Oui / Non)
  assert.equal(counts.etranger.true, NOW.run(st).matches.length);
  assert.equal(counts.etranger.false, NOW.run({ ...st, f: { etranger: false } }).matches.length);
  // anyOf : par choix
  assert.equal(counts.mobile.apple_pay, NOW.run({ ...st, f: { ...st.f, mobile: 'apple_pay' } }).matches.length);
  // banque (champ structurel)
  assert.equal(Object.values(counts.banque).reduce((a, b) => a + b, 0), NOW.run(st).matches.length);
});

test('critères peu publiés : attributs publiés par moins de deux banques, jamais exposés en filtre', () => {
  for (const f of NOW.cat.facets.filter((x) => x.attr)) assert.ok(publishedBanks(NOW.rows, f.attr).size >= 2, f.id);
  const toy = { id: 't', attributes: [{ id: 'a', type: 'bool' }, { id: 'b', type: 'bool' }], facets: [], sorts: [], presets: [] };
  const E = (code) => ({ status: 'found', value: 'v', code, source: 's', quote: 'q' });
  const NP = { status: 'not_published', checked: ['s'] };
  const rows = rowsOf(toy, [
    { id: '1', kind: 't', bank: 'b1', name: '1', attrs: { a: E(true), b: E(true) } },
    { id: '2', kind: 't', bank: 'b1', name: '2', attrs: { a: E(false), b: NP } },
    { id: '3', kind: 't', bank: 'b2', name: '3', attrs: { a: E(true), b: NP } },
  ]);
  assert.deepEqual(rareAttributes(toy, rows), ['b']);
});
