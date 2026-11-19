// Cellules dérivées : une valeur déjà saisie dans un catalogue (ou dans les attributs communs d'une banque) n'est jamais
// ressaisie ailleurs. Une cellule de la comparaison par banque (`banks[].fields`) ou un élément de liste d'un produit
// peut déclarer `from: [{ row: "<produit>[/<variante>]", attr: "<attribut>", label? } | { shared: "<attribut>", label? }]` :
// l'entrée affichée (valeur, nombre, source, citation, barème, changements à date d'effet) est recopiée depuis le catalogue.
// La première référence donne la valeur principale ; les suivantes deviennent des sous-valeurs sourcées (`extra`).

const isFound = (e) => e?.status === 'found';
const PRESENTATION = new Set(['from', 'note', 'fromCatalog']);
const COPIED = ['status', 'value', 'num', 'source', 'quote', 'fee', 'checked', 'code'];

/** Entrée référencée par `ref` pour la banque `bankId` (attribut du produit/variante, sinon attribut commun de la banque). */
export function resolveRef(data, bankId, ref) {
  const bank = data.banks.find((b) => b.id === bankId);
  if (ref.shared) return { entry: bank?.shared?.[ref.shared], error: bank?.shared?.[ref.shared] ? null : `attribut commun ${ref.shared} absent de ${bankId}` };
  const [pid, vid] = String(ref.row || '').split('/');
  const p = (data.products || []).find((x) => x.id === pid);
  if (!p) return { error: `produit inconnu ${pid}` };
  if (p.bank !== bankId) return { error: `le produit ${pid} n'appartient pas à ${bankId}` };
  const v = vid ? (p.variants || []).find((x) => x.id === vid) : null;
  if (vid && !v) return { error: `variante inconnue ${ref.row}` };
  if (!vid && p.variants?.length) return { error: `${pid} a des variantes : préciser <produit>/<variante>` };
  const entry = v?.attrs?.[ref.attr] ?? p.attrs?.[ref.attr] ?? bank?.shared?.[ref.attr];
  if (entry === undefined || Array.isArray(entry)) return { error: `attribut ${ref.attr} absent (ou liste) pour ${ref.row}` };
  return { entry };
}

const at = (e, iso) => (iso ? [...(e.changes || [])].filter((c) => c.effective_from <= iso).sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1) || e : e);
const strip = ({ changes, ...rest }) => rest;
const labelled = (ref, e) => (ref.label ? `${ref.label} : ${e.value}` : e.value);

/** Entrée composée à la date `iso` (null = entrée de base) à partir des entrées référencées. */
function compose(parts, cell, iso) {
  const es = parts.map(([ref, e]) => [ref, strip(at(e, iso))]);
  const [mainRef, main] = es[0];
  if (!isFound(main)) {
    const checked = [...new Set(es.flatMap(([, e]) => e.checked || []))];
    return { status: 'not_published', checked, ...(cell.note || main.note ? { note: cell.note || main.note } : {}) };
  }
  const others = es.slice(1).filter(([, e]) => isFound(e));
  const out = { status: 'found', value: [labelled(mainRef, main), ...others.map(([r, e]) => labelled(r, e))].join(' ; ') };
  for (const k of ['num', 'source', 'quote', 'fee', 'code', 'derived', 'stale', 'indicative', 'secondary']) if (main[k] !== undefined) out[k] = main[k];
  const extra = [...(main.extra || []), ...others.map(([r, e]) => ({ ...strip(e), value: labelled(r, e) }))];
  if (extra.length) out.extra = extra;
  const note = cell.note || main.note;
  if (note) out.note = note;
  return out;
}

/** Cellule dérivée complète (avec `changes` recomposés aux dates d'effet de chacune des entrées référencées). */
export function deriveCell(data, bankId, cell) {
  const parts = cell.from.map((ref) => [ref, resolveRef(data, bankId, ref).entry]);
  if (parts.some(([, e]) => !e)) return null;
  const base = compose(parts, cell, null);
  const dates = [...new Set(parts.flatMap(([, e]) => (e.changes || []).map((c) => c.effective_from)))].sort();
  const changes = dates.map((d) => ({ effective_from: d, ...compose(parts, cell, d) }));
  return { ...base, ...(changes.length ? { changes } : {}), from: cell.from, fromCatalog: true };
}

const needsDerive = (c) => c && Array.isArray(c.from) && !c.fromCatalog;

/** Jeu de données où toutes les cellules `from` sont recopiées depuis les catalogues (idempotent). */
export function deriveData(data) {
  const bankNeeds = data.banks.some((b) => Object.values(b.fields || {}).some(needsDerive));
  const prodNeeds = (data.products || []).some((p) => [p.attrs, ...(p.variants || []).map((v) => v.attrs)].some((a) => Object.values(a || {}).some((x) => Array.isArray(x) && x.some(needsDerive))));
  if (!bankNeeds && !prodNeeds) return data;
  const banks = data.banks.map((b) => ({
    ...b,
    fields: Object.fromEntries(Object.entries(b.fields || {}).map(([k, c]) => [k, needsDerive(c) ? deriveCell(data, b.id, c) || c : c])),
  }));
  const listItems = (bank, attrs) => Object.fromEntries(Object.entries(attrs || {}).map(([k, x]) => [k, Array.isArray(x)
    ? x.map((it) => (needsDerive(it) ? { ...(deriveCell(data, it.from[0].bank || bank, { from: it.from, note: it.note }) || {}), name: it.name, audience: it.audience } : it))
    : x]));
  const products = (data.products || []).map((p) => ({
    ...p, attrs: listItems(p.bank, p.attrs), ...(p.variants ? { variants: p.variants.map((v) => ({ ...v, attrs: listItems(p.bank, v.attrs) })) } : {}),
  }));
  return { ...data, banks, products };
}

/**
 * Contrôles de cohérence (pour scripts/verify-data.mjs) : références résolues, aucune valeur ressaisie qui diverge du
 * catalogue, champs déclarés `derive` réellement dérivés. Renvoie une liste de messages d'erreur.
 */
export function derivationErrors(raw) {
  const errors = [];
  const check = (bankId, cell, where) => {
    for (const ref of cell.from) {
      const r = resolveRef(raw, ref.bank || bankId, ref);
      if (r.error) errors.push(`${where}: référence ${JSON.stringify(ref)} invalide (${r.error})`);
    }
    if (errors.some((e) => e.startsWith(where))) return;
    const d = deriveCell(raw, cell.from[0].bank || bankId, cell);
    for (const k of Object.keys(cell)) {
      if (PRESENTATION.has(k) || ['name', 'audience'].includes(k)) continue;
      if (!COPIED.includes(k)) { errors.push(`${where}: champ « ${k} » interdit sur une cellule dérivée (from)`); continue; }
      if (JSON.stringify(cell[k]) !== JSON.stringify(d[k])) errors.push(`${where}: ${k} ${JSON.stringify(cell[k])} diverge du catalogue (${JSON.stringify(d[k])}) — la valeur doit être saisie une seule fois`);
    }
  };
  const derived = new Set((raw.fields || []).filter((f) => f.derive).map((f) => f.id));
  for (const b of raw.banks) {
    for (const [k, c] of Object.entries(b.fields || {})) {
      if (Array.isArray(c?.from)) { if (!c.from.length) errors.push(`${b.id}.${k}: from vide`); else check(b.id, c, `${b.id}.${k}`); }
      else if (derived.has(k) && c?.status === 'found') errors.push(`${b.id}.${k}: champ couvert par un catalogue (derive) saisi à la main — utiliser « from »`);
    }
  }
  for (const p of raw.products || []) {
    for (const [pre, attrs] of [[p.id, p.attrs], ...(p.variants || []).map((v) => [`${p.id}/${v.id}`, v.attrs])]) {
      for (const [k, x] of Object.entries(attrs || {})) if (Array.isArray(x)) x.forEach((it, i) => { if (Array.isArray(it?.from)) check(p.bank, it, `produit ${pre}.${k}[${i}]`); });
    }
  }
  return errors;
}
