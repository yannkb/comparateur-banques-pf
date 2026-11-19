import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataAt, entryAt, todayIso } from '../src/lib/effective.js';
import { capacite } from '../src/lib/simulator.js';

const raw = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const bt = (d) => d.banks.find((b) => b.id === 'bt').fields;
const preset = (d) => d.simulator.bankDossierPresets.find((p) => p.bank === 'bt');

test('jusqu’au 31/12/2026 : grille BT 2026 affichée, grille 2027 annoncée', () => {
  for (const day of ['2026-11-18', '2026-12-31']) {
    const d = dataAt(raw, day);
    assert.equal(bt(d).immo_frais_dossier.num, 17878);
    assert.equal(bt(d).immo_frais_dossier.next.effective_from, '2027-01-01');
    assert.equal(bt(d).immo_frais_dossier.next.num, 18236);
    assert.equal(preset(d).min, 17878);
    assert.equal(preset(d).next.min, 18236);
    assert.equal(d.simulator.defaults.fraisDossierMin, 17878);
  }
});

test('à partir du 01/01/2027 (date simulée 2027-01-02) : valeurs BT 2027, plus de badge', () => {
  const d = dataAt(raw, '2027-01-02');
  const f = bt(d);
  const expected = { immo_frais_dossier: 18236, conso_frais_dossier: 18236, immo_avenant: 25000, carte_premium: 23008, vir_international: 5734, cpt_rejet_cheque: 5012, cpt_rejet_prelevement: 1431, vir_sepa: 0, ep_livret: 0.3 };
  for (const [k, v] of Object.entries(expected)) {
    assert.equal(f[k].num, v, k);
    assert.equal(f[k].next, undefined, `${k} : badge absent`);
    assert.equal(f[k].changes, undefined);
  }
  assert.match(f.immo_garanties.value, /22 238/);
  assert.match(f.cpt_decouvert.value, /8 458/);
  assert.match(f.ep_livret.extra.map((x) => x.quote).join(' '), /2 032/);
  assert.equal(f.immo_frais_dossier.source, 'bt_tarifs_2027');
  assert.deepEqual(f.immo_frais_dossier.fee, { pct: 1, min: 18236 });
  assert.equal(preset(d).min, 18236);
  assert.equal(preset(d).next, undefined);
  assert.equal(d.simulator.defaults.fraisDossierMin, 18236);
  // le simulateur applique le minimum 2027 aux petits prêts BT
  const r = capacite({ ...d.simulator.defaults, revenu: 20000, charges: 0 }, d.simulator.params);
  assert.equal(r.frais.lines.find((l) => l.key === 'dossier').amount, 18236);
});

test('les autres banques et champs ne changent pas avec la date', () => {
  const a = dataAt(raw, '2026-11-18'), b = dataAt(raw, '2027-01-02');
  for (const id of ['socredo', 'bdp', 'marara']) assert.deepEqual(a.banks.find((x) => x.id === id), b.banks.find((x) => x.id === id));
  assert.equal(bt(b).cpt_tenue.num, 317);
});

test('entryAt sans changements renvoie l’entrée telle quelle ; todayIso au format local AAAA-MM-JJ', () => {
  const e = { status: 'found', value: 'x' };
  assert.equal(entryAt(e, '2030-01-01'), e);
  assert.equal(todayIso(new Date(2027, 0, 2, 23, 59)), '2027-01-02');
});
