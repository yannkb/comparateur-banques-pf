// Réponses des questions rapides de chaque catalogue (données courantes, date du jour).
import { readFileSync } from 'node:fs';
import { deriveData } from '../src/lib/derive.js';
import { dataAt } from '../src/lib/effective.js';
import { rowsOf, query, presetState, bestIds, rareAttributes, facetCounts } from '../src/lib/catalog.js';
const raw = JSON.parse(readFileSync(new URL('../data/banks.json', import.meta.url)));
const iso = process.argv[2] || new Date().toISOString().slice(0, 10);
const data = dataAt(raw, iso);
const order = data.banks.map((b) => b.id);
const labels = { field: (f, v) => (f === 'bank' ? order.indexOf(v) : v) };
for (const c of data.catalogs.filter((x) => process.argv.slice(3).length ? process.argv.slice(3).includes(x.id) : x.id !== 'engagement')) {
  const rows = rowsOf(c, data.products, data.banks);
  console.log(`\n## ${c.id} — ${rows.length} lignes ; critères peu publiés : ${rareAttributes(c, rows).join(', ') || '—'}`);
  for (const p of c.presets || []) {
    const r = query(c, rows, presetState(c, p));
    const best = new Set(bestIds(c, r.matches));
    const fmt = (m) => `${best.has(m.row.id) ? '★ ' : ''}${m.row.id}${m.cost.value !== null && m.cost.value !== undefined ? ` [${Math.round(m.cost.value)}]` : ''}${m.cost.loan ? ` {total ${Math.round(m.cost.loan.total)}}` : ''}${c.best?.by ? ` (${m.row.attrs[c.best.by.attr]?.num ?? 'np'} %)` : ''}`;
    console.log(`- ${p.id} : ${r.matches.length} ; ${r.matches.map(fmt).join(' | ')}${r.unknown.length ? ` ; à vérifier : ${r.unknown.map((m) => m.row.id).join(', ')}` : ''}`);
  }
}
