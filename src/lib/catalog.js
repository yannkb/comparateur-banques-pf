// Moteur de facettes générique : aucune connaissance des cartes (ou de tout autre type de produit).
// Tout ce qui est spécifique (attributs, facettes, tris, coût, montants saisis, questions rapides) est déclaré dans
// `data.catalogs[]` ; les produits sont dans `data.products[]` (`kind` = id du catalogue) ; les attributs communs à
// tous les produits d'une banque (frais de retrait, frais en devises…) sont déclarés une fois dans `bank.shared`.
//
// Statut d'une ligne vis-à-vis d'un filtre actif : 'match' | 'nomatch' | 'unknown' (valeur non publiée).
// Une valeur non publiée n'est JAMAIS comptée comme correspondant au filtre.
import { entryCost, loanCost } from './cost.js';

export const isFound = (e) => e?.status === 'found';
/** Codes d'un attribut `enum` (un attribut `multi` peut en porter plusieurs, ex. réseau CB + Visa). */
export const codesOf = (e) => (Array.isArray(e?.code) ? e.code : e?.code === undefined ? [] : [e.code]);

/**
 * Lignes du catalogue : un produit sans variante = 1 ligne ; sinon 1 ligne par variante (attributs fusionnés).
 * Les attributs déclarés `shared` sont hérités de la banque (`bank.shared`) sauf si le produit ou la variante les redéfinit.
 */
export function rowsOf(catalog, products, banks = []) {
  const sharedIds = catalog.attributes.filter((a) => a.shared).map((a) => a.id);
  const bankShared = Object.fromEntries(banks.map((b) => [b.id, b.shared || {}]));
  return products.filter((p) => p.kind === catalog.id).flatMap((p) => (p.variants?.length ? p.variants : [null]).map((v) => {
    const own = { ...p.attrs, ...(v?.attrs || {}) };
    const inherited = sharedIds.filter((id) => own[id] === undefined && bankShared[p.bank]?.[id] !== undefined);
    return {
      id: v ? `${p.id}/${v.id}` : p.id,
      productId: p.id,
      bank: p.bank,
      name: p.name,
      variant: v?.label || null,
      note: p.note || null,
      links: p.links || [],
      attrs: { ...Object.fromEntries(inherited.map((id) => [id, bankShared[p.bank][id]])), ...own },
      inherited,
    };
  }));
}

export const attrOf = (catalog, id) => catalog.attributes.find((a) => a.id === id);
export const facetOf = (catalog, id) => catalog.facets.find((f) => f.id === id);

// ---------- Montants saisis (ex. montant emprunté) ----------
export const inputsOf = (catalog) => catalog.inputs || [];
export const defaultInputs = (catalog) => Object.fromEntries(inputsOf(catalog).map((i) => [i.id, i.default]));
/** Montant saisi borné à [min, max] ; valeur par défaut si vide ou invalide. */
export function inputValue(catalog, inputs, id) {
  const def = inputsOf(catalog).find((i) => i.id === id);
  if (!def) return undefined;
  const v = Number(inputs?.[id]);
  if (inputs?.[id] === undefined || inputs?.[id] === '' || !Number.isFinite(v)) return def.default;
  return Math.min(Math.max(v, def.min ?? 0), def.max ?? Infinity);
}

/**
 * Coût de classement : valeur autonome (`cost.attr`) ou, si autorisé, la moins chère des offres groupées (`cost.alt`).
 * Si le catalogue déclare `cost.amount` (id d'un montant saisi), le coût est calculé pour ce montant à partir du barème
 * publié (`fee: { pct, min, max }`) ; `cost.loan` ajoute le coût total indicatif (frais + intérêts au taux publié).
 */
export function costOf(catalog, row, includeAlt, inputs = {}) {
  const c = catalog.cost;
  if (!c) return { value: null, kind: null, alts: [] };
  const e = row.attrs[c.attr];
  const amount = c.amount ? inputValue(catalog, inputs, c.amount) : undefined;
  const alts = c.alt ? (row.attrs[c.alt.attr] || []).filter((x) => isFound(x) && typeof x.num === 'number')
    .map((x) => ({ entry: x, value: x.num * (c.alt.factor || 1) })).sort((a, b) => a.value - b.value) : [];
  const loan = c.loan ? loanCost({ feeEntry: e, rateEntry: row.attrs[c.loan.rate], amount, months: inputValue(catalog, inputs, c.loan.months) }) : null;
  const own = c.amount ? entryCost(e, amount) : isFound(e) && typeof e.num === 'number' ? e.num : null;
  if (own !== null) return { value: own, kind: 'standalone', entry: e, alts, amount, loan };
  if (includeAlt && alts.length) return { value: alts[0].value, kind: 'alt', entry: alts[0].entry, alts, amount, loan };
  return { value: null, kind: null, alts, amount, loan };
}
/** Ligne disponible uniquement via une offre groupée (pas de prix autonome publié). */
export const altOnly = (catalog, row) => !!catalog.cost?.alt && !isFound(row.attrs[catalog.cost.attr]) && costOf(catalog, row, true).kind === 'alt';

export function isActive(facet, v) {
  switch (facet.type) {
    case 'enum': return Array.isArray(v) && v.length > 0;
    case 'bool': return v === true || v === false;
    case 'anyOf': return typeof v === 'string' && facet.choices.some((c) => c.value === v);
    case 'listHas': case 'flag': return v === true;
    case 'max': return typeof v === 'number' && Number.isFinite(v) && v > 0;
    default: return false;
  }
}

export function includeAltOf(catalog, state) {
  return catalog.facets.some((f) => isActive(f, state.f?.[f.id]) && (f.role === 'includeAlt' || f.impliesAlt));
}

/** Évalue un filtre actif sur une ligne. */
export function evalFacet(catalog, facet, row, v, includeAlt, inputs) {
  if (!isActive(facet, v)) return null;
  if (facet.type === 'flag') return null; // option du moteur, pas un filtre
  if (facet.field) return v.includes(String(row[facet.field])) ? 'match' : 'nomatch';
  if (facet.type === 'max') {
    const c = costOf(catalog, row, includeAlt, inputs).value;
    return c === null ? 'unknown' : c <= v ? 'match' : 'nomatch';
  }
  if (facet.type === 'listHas') {
    const list = row.attrs[facet.attr] || [];
    return list.some((x) => isFound(x) && facet.values.includes(x[facet.listField])) ? 'match' : 'nomatch';
  }
  if (facet.type === 'anyOf') {
    const ch = facet.choices.find((c) => c.value === v);
    const es = ch.attrs.map((a) => row.attrs[a]);
    if (es.some((e) => isFound(e) && e.code === true)) return 'match';
    return es.some((e) => !isFound(e)) ? 'unknown' : 'nomatch';
  }
  const e = row.attrs[facet.attr];
  if (!isFound(e)) return 'unknown';
  if (facet.type === 'bool') return e.code === v ? 'match' : 'nomatch';
  if (facet.type === 'enum') return codesOf(e).some((c) => v.includes(c)) ? 'match' : 'nomatch';
  return null;
}

export const defaultState = (catalog) => ({ f: {}, sort: catalog.defaultSort || catalog.sorts?.[0]?.id, includeUnknown: true, inputs: defaultInputs(catalog) });

/**
 * Filtre + tri. Renvoie { matches, unknown, hiddenAlt, includeAlt } ; chaque élément = { row, cost, unknownFacets }.
 * `labels.field(field, value)` sert au tri par champ structurel (ex. nom de la banque).
 */
export function query(catalog, rows, state, labels = {}) {
  const includeAlt = includeAltOf(catalog, state);
  const inputs = state.inputs || defaultInputs(catalog);
  const active = catalog.facets.filter((f) => isActive(f, state.f?.[f.id]) && f.type !== 'flag');
  const matches = [], unknown = [];
  let hiddenAlt = 0;
  for (const row of rows) {
    if (!includeAlt && altOnly(catalog, row)) { hiddenAlt++; continue; }
    const res = active.map((f) => [f, evalFacet(catalog, f, row, state.f[f.id], includeAlt, inputs)]);
    if (res.some(([, r]) => r === 'nomatch')) continue;
    const item = { row, cost: costOf(catalog, row, includeAlt, inputs), unknownFacets: res.filter(([, r]) => r === 'unknown').map(([f]) => f.id) };
    (item.unknownFacets.length ? unknown : matches).push(item);
  }
  const sort = (catalog.sorts || []).find((s) => s.id === state.sort) || catalog.sorts?.[0];
  return { matches: sortItems(catalog, matches, sort, labels), unknown: state.includeUnknown === false ? [] : sortItems(catalog, unknown, sort, labels), hiddenAlt, includeAlt, sort };
}

function keyOf(catalog, item, k, labels) {
  if (k.cost === 'total') return item.cost.loan ? item.cost.loan.total : null;
  if (k.cost) return item.cost.value;
  if (k.field) return labels.field ? labels.field(k.field, item.row[k.field]) : item.row[k.field];
  const a = attrOf(catalog, k.attr), e = item.row.attrs[k.attr];
  if (!isFound(e)) return null;
  if (a.type === 'enum') {
    const idx = codesOf(e).map((c) => a.options.findIndex((o) => o.value === c)).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : null;
  }
  return typeof e.num === 'number' ? e.num : null;
}

export function sortItems(catalog, items, sort, labels = {}) {
  if (!sort) return items;
  const cmp = (x, y) => {
    for (const k of sort.by) {
      const a = keyOf(catalog, x, k, labels), b = keyOf(catalog, y, k, labels);
      if (a === b) continue;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      const d = typeof a === 'string' ? a.localeCompare(b, 'fr') : a - b;
      if (d) return k.dir === 'desc' ? -d : d;
    }
    return x.row.id.localeCompare(y.row.id);
  };
  return [...items].sort(cmp);
}

/**
 * Identifiants des lignes « meilleures » parmi les correspondances : coût autonome minimal par défaut, ou valeur extrême
 * d'un attribut (`best.by: { attr, dir }`, ex. meilleur taux d'épargne publié).
 */
export function bestIds(catalog, matches) {
  if (!catalog.best) return [];
  if (catalog.best.by) {
    const k = catalog.best.by;
    const vals = matches.map((m) => [m, keyOf(catalog, m, k, {})]).filter(([, v]) => typeof v === 'number');
    if (!vals.length) return [];
    const ext = (k.dir === 'desc' ? Math.max : Math.min)(...vals.map(([, v]) => v));
    return vals.filter(([, v]) => v === ext).map(([m]) => m.row.id);
  }
  const pool = matches.filter((m) => m.cost.value !== null && (catalog.best.basis !== 'standalone' || m.cost.kind === 'standalone'));
  if (!pool.length) return [];
  const min = Math.min(...pool.map((m) => m.cost.value));
  return pool.filter((m) => m.cost.value === min).map((m) => m.row.id);
}

/** Options d'une facette `enum` : celles de l'attribut, ou `fieldOptions[field]` pour un champ structurel. */
export function optionsOf(catalog, facet, fieldOptions = {}) {
  if (facet.field) return fieldOptions[facet.field] || [];
  if (facet.type === 'enum') return attrOf(catalog, facet.attr)?.options || [];
  if (facet.type === 'bool') return attrOf(catalog, facet.attr)?.options || [];
  if (facet.type === 'anyOf') return facet.choices;
  return [];
}

/**
 * Nombre de résultats par option de chaque facette, en tenant compte des AUTRES filtres actifs (l'option remplace la
 * valeur courante de sa facette). Les « non publié » ne sont jamais comptés. Clés : valeur de l'option (texte), `true`/`false`.
 */
export function facetCounts(catalog, rows, state, fieldOptions = {}) {
  const out = {};
  for (const f of catalog.facets) {
    let opts;
    if (f.type === 'enum') opts = optionsOf(catalog, f, fieldOptions).map((o) => [String(o.value), [o.value]]);
    else if (f.type === 'bool') opts = [['true', true], ['false', false]];
    else if (f.type === 'anyOf') opts = f.choices.map((c) => [c.value, c.value]);
    else if (f.type === 'listHas') opts = [['true', true]];
    else continue;
    out[f.id] = Object.fromEntries(opts.map(([k, v]) => [k, query(catalog, rows, { ...state, includeUnknown: false, f: { ...state.f, [f.id]: v } }).matches.length]));
  }
  return out;
}

/** Banques qui publient un attribut (au moins une ligne `found` ; pour une liste, au moins un élément `found`). */
export function publishedBanks(rows, attrId) {
  const s = new Set();
  for (const r of rows) {
    const e = r.attrs[attrId];
    if (Array.isArray(e) ? e.some(isFound) : isFound(e)) s.add(r.bank);
  }
  return s;
}
/** Attributs d'un catalogue publiés par moins de `min` établissements : « critère peu publié », jamais proposé en filtre. */
export function rareAttributes(catalog, rows, min = 2) {
  return catalog.attributes.filter((a) => publishedBanks(rows, a.id).size < min).map((a) => a.id);
}

// ---------- État ⇄ paramètres d'URL (partageable) ----------
const SORT_PARAM = 'tri', UNKNOWN_PARAM = 'np';

export function stateToParams(catalog, state, { inputs = true } = {}) {
  const p = new URLSearchParams();
  for (const f of catalog.facets) {
    const v = state.f?.[f.id];
    if (!isActive(f, v)) continue;
    if (f.type === 'enum') p.set(f.param, v.join(','));
    else if (f.type === 'bool') p.set(f.param, v ? '1' : '0');
    else if (f.type === 'listHas' || f.type === 'flag') p.set(f.param, '1');
    else p.set(f.param, String(v));
  }
  if (state.sort && state.sort !== defaultState(catalog).sort) p.set(SORT_PARAM, state.sort);
  if (state.includeUnknown === false) p.set(UNKNOWN_PARAM, '0');
  if (inputs) for (const i of inputsOf(catalog)) {
    const v = inputValue(catalog, state.inputs, i.id);
    if (v !== i.default) p.set(i.param, String(v));
  }
  return p;
}

export function paramsToState(catalog, params, fieldOptions = {}) {
  const s = defaultState(catalog);
  for (const f of catalog.facets) {
    const raw = params.get(f.param);
    if (raw === null) continue;
    let v;
    if (f.type === 'enum') {
      const ok = new Set(optionsOf(catalog, f, fieldOptions).map((o) => String(o.value)));
      v = raw.split(',').filter((x) => ok.has(x));
    } else if (f.type === 'bool') v = raw === '1' ? true : raw === '0' ? false : undefined;
    else if (f.type === 'listHas' || f.type === 'flag') v = raw === '1' ? true : undefined;
    else if (f.type === 'max') v = Number(raw);
    else v = raw;
    if (isActive(f, v)) s.f[f.id] = v;
  }
  const sort = params.get(SORT_PARAM);
  if (sort && catalog.sorts.some((x) => x.id === sort)) s.sort = sort;
  if (params.get(UNKNOWN_PARAM) === '0') s.includeUnknown = false;
  for (const i of inputsOf(catalog)) {
    const raw = params.get(i.param);
    if (raw !== null && raw.trim() !== '' && Number.isFinite(Number(raw))) s.inputs[i.id] = inputValue(catalog, { [i.id]: Number(raw) }, i.id);
  }
  return s;
}

/** Une question rapide = un état de filtres + un tri (les montants saisis sont conservés). */
export const presetState = (catalog, preset, inputs) => ({ ...defaultState(catalog), f: { ...preset.state }, sort: preset.sort || defaultState(catalog).sort, ...(inputs ? { inputs } : {}) });
/** Même question (filtres, tri, « non publié ») ; les montants saisis ne comptent pas. */
export const sameState = (catalog, a, b) => stateToParams(catalog, a, { inputs: false }).toString() === stateToParams(catalog, b, { inputs: false }).toString();

/** Meilleure(s) ligne(s) d'une question rapide (ex. « Visa la moins chère utilisable à l'étranger »), pour l'afficher à côté d'une autre. */
export function presetBest(catalog, rows, presetId, labels = {}, inputs) {
  const p = (catalog.presets || []).find((x) => x.id === presetId);
  if (!p) return [];
  const res = query(catalog, rows, presetState(catalog, p, inputs), labels);
  const best = new Set(bestIds(catalog, res.matches));
  return res.matches.filter((m) => best.has(m.row.id));
}

/** Comparaison de deux attributs numériques déclarée par le catalogue (`compare`) : 'same' | 'diff' | null (incomplet). */
export function compareOf(catalog, row) {
  const [a, b] = catalog.compare?.attrs || [];
  const x = row.attrs[a], y = row.attrs[b];
  if (!isFound(x) || !isFound(y) || typeof x.num !== 'number' || typeof y.num !== 'number') return null;
  return Math.abs(x.num - y.num) < 1e-9 ? 'same' : 'diff';
}
