// Coûts calculés à partir d'un montant saisi (src/lib/cost.js) et leur usage par le moteur de catalogues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryCost, feeAmount, interestTotal, loanCost, monthlyPayment, rateFor } from '../src/lib/cost.js';
import { costOf, defaultState, paramsToState, presetState, query, rowsOf, sameState, stateToParams } from '../src/lib/catalog.js';
import { fraisDossier } from '../src/lib/simulator.js';

test('feeAmount : max(pct × montant, minimum), plafonné si un maximum est publié', () => {
  assert.equal(feeAmount({ pct: 1, min: 10310 }, 20_000_000), 200_000);
  assert.equal(feeAmount({ pct: 1, min: 10310 }, 500_000), 10_310);
  assert.equal(feeAmount({ pct: 0.75, min: 51300 }, 20_000_000), 150_000);
  assert.equal(feeAmount({ pct: 1, min: 10000, max: 100000 }, 20_000_000), 100_000);
  assert.equal(feeAmount({ pct: 1, min: 10000, max: 100000 }, 5_000_000), 50_000);
  assert.equal(feeAmount({ pct: 1, min: 10000 }, 0), 0, 'rien emprunté : pas de frais');
  assert.equal(feeAmount({ pct: 1, min: 10000 }, -5), 0);
  assert.equal(feeAmount(null, 1_000_000), 0);
});

test('le simulateur utilise le même barème (fraisDossier ≡ feeAmount)', () => {
  for (const [m, pct, min] of [[20e6, 1, 17878], [1e6, 1, 17878], [3e6, 0.75, 51300], [0, 1, 5]]) assert.equal(fraisDossier(m, pct, min), feeAmount({ pct, min }, m));
});

test('mensualité et intérêts : calcul de référence (taux 0 compris)', () => {
  assert.equal(monthlyPayment(1_200_000, 0, 12), 100_000);
  assert.equal(interestTotal(1_200_000, 0, 12), 0);
  // Cas de contrôle publié (exemple Socredo, prêt personnel) : 1 000 000 FCFP sur 24 mois à 4,50 %, « montant total dû :
  // 1 057 552 FCFP dont 10 000 FCFP de frais de dossier » → mensualité arrondie 43 648, intérêts 47 552.
  assert.equal(Math.round(monthlyPayment(1_000_000, 4.5, 24)) * 24 + 10_000, 1_057_552);
  assert.ok(Math.abs(interestTotal(1_000_000, 4.5, 24) - 47_552) < 5, 'écart dû au seul arrondi de la mensualité');
});

test('entryCost : barème publié, montant fixe, non publié ou non chiffré', () => {
  const E = (x) => ({ status: 'found', value: 'v', source: 's', quote: 'q', ...x });
  assert.equal(entryCost(E({ fee: { pct: 1, min: 18000 } }), 1_000_000), 18000);
  assert.equal(entryCost(E({ num: 0 }), 1_000_000), 0);
  assert.equal(entryCost(E({}), 1_000_000), null, 'frais « réduits » non chiffrés : pas de coût inventé');
  assert.equal(entryCost({ status: 'not_published', checked: ['s'] }, 1_000_000), null);
});

test('loanCost : jamais de taux deviné (taux non publié → null)', () => {
  const fee = { status: 'found', fee: { pct: 1, min: 10000 } };
  assert.equal(loanCost({ feeEntry: fee, rateEntry: { status: 'not_published', checked: ['x'] }, amount: 1e6, months: 24 }), null);
  const r = loanCost({ feeEntry: fee, rateEntry: { status: 'found', num: 4.5 }, amount: 1e6, months: 24 });
  assert.equal(r.fee, 10000);
  assert.ok(Math.abs(r.total - (r.interest + 10000)) < 1e-9);
});

// Catalogue jouet « crédit » : le classement suit le coût réel pour le montant saisi (et non le minimum publié).
const E = (x) => ({ status: 'found', value: 'v', source: 's', quote: 'q', ...x });
const credit = {
  id: 'pret', attributes: [{ id: 'frais', type: 'number', unit: 'XPF' }, { id: 'taux', type: 'number', unit: '%' }],
  inputs: [{ id: 'montant', param: 'montant', label: 'Montant', default: 20_000_000, min: 0, max: 200_000_000 }, { id: 'duree', param: 'duree', label: 'Durée', default: 240, min: 12, max: 360 }],
  cost: { attr: 'frais', unit: 'XPF', amount: 'montant', loan: { rate: 'taux', months: 'duree', label: 'Coût total indicatif' } },
  best: { label: 'Le moins cher', basis: 'standalone' },
  facets: [{ id: 'budget', param: 'budget', type: 'max', cost: true }],
  sorts: [{ id: 'cout', by: [{ cost: true }] }, { id: 'total', by: [{ cost: 'total' }] }], defaultSort: 'cout',
  presets: [{ id: 'p', label: 'P', state: {}, sort: 'cout' }],
};
const products = [
  { id: 'a', kind: 'pret', bank: 'A', name: 'A', attrs: { frais: E({ num: 10310, fee: { pct: 1, min: 10310 } }), taux: { status: 'not_published', checked: ['s'] } } },
  { id: 'b', kind: 'pret', bank: 'B', name: 'B', attrs: { frais: E({ num: 51300, fee: { pct: 0.75, min: 51300 } }), taux: E({ num: 3.5 }) } },
  { id: 'c', kind: 'pret', bank: 'C', name: 'C', attrs: { frais: E({}), taux: E({ num: 2.7 }) } },
];
const rows = rowsOf(credit, products);
const order = (st) => query(credit, rows, st).matches.map((m) => m.row.id);

test('catalogue : coût calculé pour le montant saisi, le classement s’inverse selon le montant', () => {
  assert.deepEqual(order(defaultState(credit)), ['b', 'a', 'c'], '20 MF : 0,75 % (150 000) < 1 % (200 000) ; frais non chiffrés en dernier');
  assert.deepEqual(order({ ...defaultState(credit), inputs: { montant: 1_000_000, duree: 240 } }), ['a', 'b', 'c'], '1 MF : minimum 10 310 < 51 300');
  const b = costOf(credit, rows[1], false, { montant: 20_000_000, duree: 240 });
  assert.deepEqual([b.value, b.kind, b.amount], [150_000, 'standalone', 20_000_000]);
  assert.ok(b.loan && Math.abs(b.loan.total - (interestTotal(20e6, 3.5, 240) + 150_000)) < 1e-6);
  assert.equal(costOf(credit, rows[0], false, {}).loan, null, 'taux non publié : pas de coût total');
  // budget maximum appliqué au coût calculé
  assert.deepEqual(query(credit, rows, { ...defaultState(credit), f: { budget: 160_000 } }).matches.map((m) => m.row.id), ['b']);
  // tri par coût total indicatif : seuls les taux publiés ont une clé, les autres en dernier
  assert.deepEqual(order({ ...defaultState(credit), sort: 'total' }).slice(0, 2), ['c', 'b']);
});

test('catalogue : montants saisis bornés, dans l’URL, conservés par les questions rapides', () => {
  const st = { ...defaultState(credit), inputs: { montant: 1_000_000, duree: 240 } };
  assert.equal(stateToParams(credit, st).toString(), 'montant=1000000');
  assert.equal(stateToParams(credit, defaultState(credit)).toString(), '', 'valeur par défaut omise');
  assert.deepEqual(paramsToState(credit, new URLSearchParams('montant=999999999999&duree=abc')).inputs, { montant: 200_000_000, duree: 240 });
  assert.deepEqual(presetState(credit, credit.presets[0], st.inputs).inputs, st.inputs);
  assert.ok(sameState(credit, st, presetState(credit, credit.presets[0])), 'une question rapide reste active quel que soit le montant');
});

test('rateFor : paliers publiés (montant ou durée), jamais extrapolés ; exemple ancien jamais utilisé', () => {
  const byMonths = { status: 'found', num: 3.5, tiers: [{ upToMonths: 120, num: 3 }, { upToMonths: 240, num: 3.2 }, { upToMonths: 300, num: 3.5 }] };
  assert.equal(rateFor(byMonths, 1e6, 120), 3);
  assert.equal(rateFor(byMonths, 1e6, 121), 3.2);
  assert.equal(rateFor(byMonths, 1e6, 300), 3.5);
  assert.equal(rateFor(byMonths, 1e6, 360), null, 'au-delà du dernier palier publié : pas de taux');
  const byAmount = { status: 'found', num: 7.5, tiers: [{ upToAmount: 358000, num: 22 }, { upToAmount: 716000, num: 14 }, { upToAmount: 30000000, num: 7.5 }] };
  assert.equal(rateFor(byAmount, 300000, 48), 22);
  assert.equal(rateFor(byAmount, 716000, 48), 14);
  assert.equal(rateFor(byAmount, 1e6, 48), 7.5);
  assert.equal(rateFor(byAmount, 5e7, 48), null);
  assert.equal(rateFor({ status: 'found', num: 4.5, stale: true }, 1e6, 24), null, 'exemple 2019 : affiché, pas utilisé pour un coût');
  assert.equal(loanCost({ feeEntry: { status: 'found', num: 0 }, rateEntry: { status: 'found', num: 4.5, stale: true }, amount: 1e6, months: 24 }), null);
  const c = loanCost({ feeEntry: { status: 'found', fee: { pct: 1, min: 17878 } }, rateEntry: byAmount, amount: 1e6, months: 48 });
  assert.equal(c.rate, 7.5);
  assert.ok(Math.abs(c.total - (interestTotal(1e6, 7.5, 48) + 17878)) < 1e-6);
});

test('crédit conso (données) : coût total au palier BT du montant saisi ; frais sans minimum publié (1 %)', async () => {
  const { readFileSync } = await import('node:fs');
  const { dataAt } = await import('../src/lib/effective.js');
  const data = dataAt(JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url))), '2026-11-18');
  const c = data.catalogs.find((x) => x.id === 'credit_conso');
  const rows = rowsOf(c, data.products, data.banks);
  const bt = rows.find((r) => r.id === 'conso-bt-conso');
  assert.equal(costOf(c, bt, false, { montant: 500000, duree: 24 }).loan.rate, 14);
  assert.equal(costOf(c, bt, false, { montant: 1000000, duree: 24 }).loan.rate, 7.5);
  const eco = rows.find((r) => r.id === 'conso-socredo-eco');
  assert.equal(costOf(c, eco, false, { montant: 500000 }).value, 5000, '1 % sans minimum');
  const perso = rows.find((r) => r.id === 'conso-socredo-perso');
  assert.equal(costOf(c, perso, false, { montant: 1000000, duree: 24 }).loan, null, 'taux 2019 (stale) : pas de coût total');
});
