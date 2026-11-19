// Cellules de la comparaison par banque dérivées des catalogues (src/lib/derive.js) : une valeur n'est saisie qu'une fois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveData, derivationErrors, resolveRef } from '../src/lib/derive.js';
import { dataAt } from '../src/lib/effective.js';
import { rowsOf } from '../src/lib/catalog.js';

const raw = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const derived = deriveData(raw);
const cell = (d, b, f) => d.banks.find((x) => x.id === b).fields[f];

test('chaque cellule « from » est identique à sa source dans le catalogue (valeur, nombre, citation, barème)', () => {
  assert.deepEqual(derivationErrors(raw), []);
  let n = 0;
  for (const b of raw.banks) for (const [k, c] of Object.entries(b.fields)) {
    if (!Array.isArray(c.from)) continue;
    n++;
    const d = cell(derived, b.id, k);
    const src = resolveRef(raw, b.id, c.from[0]).entry;
    for (const key of ['status', 'num', 'source', 'quote', 'fee']) assert.deepEqual(d[key], src[key], `${b.id}.${k}.${key}`);
    assert.ok(d.fromCatalog);
  }
  assert.ok(n >= 12, `au moins les cartes et retraits des 4 banques (${n})`);
});

test('valeurs de la comparaison inchangées après dérivation (cartes, retraits)', () => {
  const exp = {
    socredo: { carte_classic: 5666, carte_premium: 21700, cpt_retrait_autre: 120 },
    bt: { carte_classic: 5813, carte_premium: 22557, cpt_retrait_autre: 121 },
    bdp: { carte_classic: 5735, carte_premium: 20300, cpt_retrait_autre: 122 },
    marara: { carte_classic: 5000, carte_premium: 16000, cpt_retrait_autre: 118 },
  };
  for (const [b, fs] of Object.entries(exp)) for (const [f, v] of Object.entries(fs)) assert.equal(cell(derived, b, f).num, v, `${b}.${f}`);
});

test('dérivation à date d’effet : la grille BT 2027 des cartes passe dans la comparaison', () => {
  const before = cell(dataAt(raw, '2026-12-31'), 'bt', 'carte_premium');
  assert.equal(before.num, 22557);
  assert.equal(before.next.effective_from, '2027-01-01');
  assert.match(before.next.value, /23 008/);
  const after = cell(dataAt(raw, '2027-01-02'), 'bt', 'carte_premium');
  assert.equal(after.num, 23008);
  assert.match(after.value, /56 960/, 'Visa Infinite 2027 dans la sous-valeur');
  assert.equal(after.source, 'bt_tarifs_2027');
});

test('cellule dérivée = cellule du catalogue (même ligne que celle affichée par Trouver ma carte)', () => {
  const d = dataAt(raw, '2026-11-18');
  const cat = d.catalogs.find((c) => c.id === 'carte');
  const rows = rowsOf(cat, d.products, d.banks);
  for (const b of raw.banks) for (const [k, c] of Object.entries(b.fields)) {
    if (!Array.isArray(c.from) || !c.from[0].row) continue;
    const r = rows.find((x) => x.id === c.from[0].row);
    if (!r) continue;
    assert.equal(cell(d, b.id, k).num, r.attrs[c.from[0].attr].num, `${b.id}.${k}`);
  }
});

test('dérivation idempotente et sans effet sur un jeu sans « from »', () => {
  assert.equal(deriveData(derived), derived);
  const plain = { banks: [{ id: 'x', fields: { a: { status: 'not_published', checked: ['s'] } } }], products: [] };
  assert.equal(deriveData(plain), plain);
});

test('derivationErrors : références invalides et valeurs ressaisies', () => {
  const d = structuredClone(raw);
  const b = d.banks.find((x) => x.id === 'socredo');
  b.fields.carte_classic.num = 9999;
  b.fields.carte_premium.from[0].row = 'bt-visa-premier/immediat';
  b.fields.cpt_retrait_autre.from = [{ shared: 'inexistant' }];
  const errs = derivationErrors(d);
  assert.ok(errs.some((e) => /carte_classic: num 9999 diverge du catalogue/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /carte_premium.*n'appartient pas à socredo/.test(e)));
  assert.ok(errs.some((e) => /cpt_retrait_autre.*attribut commun inexistant/.test(e)));
});

test('règles communes : recopiées des Repères officiels dans le catalogue (jamais ressaisies)', () => {
  const d = deriveData(raw);
  for (const c of d.catalogs.filter((x) => x.rules)) {
    assert.equal(c.ruleItems.length, c.rules.length, c.id);
    for (const r of c.ruleItems) {
      const src = raw.reperes.sections.filter((s) => s.kind === 'rules').flatMap((s) => s.items).find((x) => x.id === r.id);
      assert.deepEqual(r, src);
    }
  }
  assert.deepEqual(d.catalogs.find((x) => x.id === 'credit_immo').ruleItems.map((r) => r.id).slice(0, 2), ['ira-immo', 'ira-immo-partiel']);
});

test('offres groupées des cartes dérivées du catalogue « compte » (prix saisi une seule fois)', () => {
  const d = deriveData(raw);
  const card = d.products.find((p) => p.id === 'socredo-visa-classic').attrs.packages[0];
  const cpt = d.products.find((p) => p.id === 'cpt-socredo-hiva').variants.find((v) => v.id === 'reference').attrs.prix;
  assert.equal(card.num, cpt.num);
  assert.equal(card.quote, cpt.quote);
  assert.equal(card.audience, 'tous');
});
