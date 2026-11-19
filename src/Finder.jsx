import { useMemo, useState } from 'react';
import { fmtDate, fmtMoney, fmtNum } from './lib/data.js';
import { SourceChip } from './common.jsx';
import { attrOf, bestIds, defaultState, facetOf, isActive, optionsOf, presetState, query, sameState } from './lib/catalog.js';

// Vue « trouver un produit » générique : tout (attributs, facettes, tris, questions rapides, coût) vient du
// catalogue déclaré dans les données. Aucun libellé ni attribut propre aux cartes ici.

const plural = (n, [one, many]) => `${n} ${n > 1 ? many : one}`;
const unitSuffix = (unit = '') => unit.replace(/^XPF/, '').replace('/', '/\u00a0');

function Chips({ e }) {
  if (e.status !== 'found') return <span className="srcs">{e.checked.map((c) => <SourceChip key={c} id={c} />)}</span>;
  return (
    <span className="srcs">
      <SourceChip id={e.source} quote={e.quote} />
      {(e.extra || []).map((x, i) => <SourceChip key={i} id={x.source} quote={x.quote} />)}
    </span>
  );
}

function AttrValue({ a, e, cur }) {
  if (!e) return null;
  if (e.status !== 'found') {
    return (
      <div className="pv np-inline">
        <span className="np-label">Non publié</span>
        {e.note && <span className="note">{e.note}</span>}
        <span className="checked">Vérifié dans : <Chips e={e} /></span>
      </div>
    );
  }
  const conv = cur === 'EUR' && typeof e.num === 'number' && a.unit?.startsWith('XPF') ? fmtNum(e.num, a.unit, cur) : null;
  return (
    <div className={`pv${a.type === 'bool' ? (e.code ? ' yes' : ' no') : ''}`}>
      <span className="pv-text">{e.value}</span>
      {conv && <span className="conv">≈ {conv}</span>}
      {e.note && <span className="note">{e.note}</span>}
      {e.next && <span className="next-inline"><span className="tag tag-soon">Nouvelle grille au {fmtDate(e.next.effective_from)}</span> {e.next.value} <SourceChip id={e.next.source} quote={e.next.quote} /></span>}
      <Chips e={e} />
    </div>
  );
}

function Cost({ catalog, item, cur }) {
  const c = catalog.cost, { cost, row } = item;
  const unit = unitSuffix(c.unit);
  const own = row.attrs[c.attr];
  const altAttr = c.alt && attrOf(catalog, c.alt.attr);
  return (
    <div className="pcost" data-testid="pcost">
      {cost.kind === 'standalone' ? (
        <p className="pcost-main"><span data-testid="pcost-value">{fmtMoney(cost.value, cur)}</span><small>{unit}</small></p>
      ) : cost.kind === 'alt' ? (
        <p className="pcost-main alt"><small>{c.alt.label} : </small><span data-testid="pcost-value">{fmtMoney(cost.value, cur)}</span><small>{unit}</small></p>
      ) : <p className="pcost-main muted">Prix non publié</p>}
      {own && <AttrValue a={attrOf(catalog, c.attr)} e={own} cur={cur} />}
      {cost.alts.length > 0 && (
        <ul className="palts" aria-label={altAttr?.label}>
          {cost.alts.map(({ entry }, i) => (
            <li key={i}>
              <span>{c.alt.label} <b>{entry.name}</b> : {fmtMoney(entry.num, cur)}{unitSuffix(altAttr?.unit)}</span>
              {entry.note && <span className="note">{entry.note}</span>}
              <Chips e={entry} />
            </li>
          ))}
          {c.alt.caveat && <li className="caveat">{c.alt.caveat}</li>}
        </ul>
      )}
    </div>
  );
}

function ProductCard({ catalog, item, best, bank, cur, idx }) {
  const { row } = item;
  const shown = new Set([catalog.cost?.attr, catalog.cost?.alt?.attr]);
  const summary = catalog.summary.filter((id) => !shown.has(id)).map((id) => attrOf(catalog, id));
  const rest = catalog.attributes.filter((a) => !shown.has(a.id) && !catalog.summary.includes(a.id));
  return (
    <article className="pcard" style={{ '--bank': bank?.color, '--i': Math.min(idx, 8) }} data-testid={`pcard-${row.id}`} data-product={row.productId}>
      <header className="pcard-head">
        <span className="pbank"><span className="dot" />{bank?.short}</span>
        <h3>{row.name}{row.variant && <span className="pvariant"> · {row.variant}</span>}</h3>
        <div className="ptags">
          {best && <span className="tag tag-best" data-testid="tag-cheapest">{catalog.best.label}</span>}
          {item.unknownFacets.map((f) => <span key={f} className="tag tag-np">Non publié : {facetOf(catalog, f).label.toLowerCase()}</span>)}
        </div>
      </header>
      {catalog.cost && <Cost catalog={catalog} item={item} cur={cur} />}
      <dl className="pattrs">
        {summary.map((a) => <div key={a.id}><dt>{a.label}</dt><dd><AttrValue a={a} e={row.attrs[a.id]} cur={cur} /></dd></div>)}
      </dl>
      <details className="pmore">
        <summary>Tous les attributs</summary>
        <dl className="pattrs">
          {rest.map((a) => <div key={a.id}><dt>{a.label}</dt><dd><AttrValue a={a} e={row.attrs[a.id]} cur={cur} /></dd></div>)}
        </dl>
        {row.note && <p className="note">{row.note}</p>}
      </details>
    </article>
  );
}

function Facet({ catalog, facet, value, set, fieldOptions, cur }) {
  const id = `f-${catalog.id}-${facet.id}`;
  if (facet.type === 'enum') {
    const opts = optionsOf(catalog, facet, fieldOptions);
    const v = value || [];
    return (
      <fieldset className="facet">
        <legend>{facet.label}</legend>
        <div className="facet-opts">
          {opts.map((o) => (
            <label key={o.value} className="check">
              <input type="checkbox" checked={v.includes(o.value)} data-testid={`${id}-${o.value}`}
                onChange={(e) => set(e.target.checked ? [...v, o.value] : v.filter((x) => x !== o.value))} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (facet.type === 'bool') {
    const choices = [[undefined, 'Indifférent'], [true, 'Oui'], [false, 'Non']];
    return (
      <fieldset className="facet">
        <legend>{facet.label}</legend>
        <div className="facet-opts seg-radios">
          {choices.map(([v, l]) => (
            <label key={l} className={`pill${value === v ? ' on' : ''}`}>
              <input type="radio" name={id} checked={value === v} onChange={() => set(v)} data-testid={`${id}-${l.toLowerCase()}`} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (facet.type === 'anyOf') {
    return (
      <div className="facet field">
        <label className="field-label" htmlFor={id}>{facet.label}</label>
        <select id={id} value={value || ''} onChange={(e) => set(e.target.value || undefined)} data-testid={id}>
          <option value="">Indifférent</option>
          {facet.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    );
  }
  if (facet.type === 'max') {
    return (
      <div className="facet field">
        <label className="field-label" htmlFor={id}>{facet.label} <small>({unitSuffix(facet.unit) ? `XPF${unitSuffix(facet.unit)}` : 'XPF'})</small></label>
        <div className="field-input">
          <input id={id} type="number" inputMode="numeric" min={0} step={facet.step || 1} value={value ?? ''} placeholder="sans limite" data-testid={id}
            onChange={(e) => { const n = Number(e.target.value); set(e.target.value === '' || !(n > 0) ? undefined : n); }} />
          <span className="suffix">XPF</span>
        </div>
        {cur === 'EUR' && value > 0 && <span className="hint">≈ {fmtMoney(value, 'EUR')}</span>}
      </div>
    );
  }
  // listHas / flag : simple case à cocher
  return (
    <label className="switch facet-switch">
      <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked ? true : undefined)} data-testid={id} />
      <span className="switch-ui" aria-hidden="true" />
      <span>{facet.label}</span>
    </label>
  );
}

export default function Finder({ catalog, rows, banks, cur, state, onChange }) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1080px)').matches);
  const bankById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks]);
  const fieldOptions = useMemo(() => ({ bank: banks.map((b) => ({ value: b.id, label: b.short })) }), [banks]);
  const labels = useMemo(() => ({ field: (f, v) => (f === 'bank' ? banks.findIndex((b) => b.id === v) : v) }), [banks]);
  const res = useMemo(() => query(catalog, rows, state, labels), [catalog, rows, state, labels]);
  const best = new Set(bestIds(catalog, res.matches));
  const nActive = catalog.facets.filter((f) => isActive(f, state.f[f.id])).length;
  const setFacet = (id, v) => onChange({ ...state, f: { ...state.f, [id]: v } });
  const current = catalog.presets.find((p) => sameState(catalog, state, presetState(catalog, p)));
  const [one, many] = catalog.itemLabel || ['produit', 'produits'];

  return (
    <section className="finder" aria-labelledby={`finder-${catalog.id}-titre`} data-testid={`finder-${catalog.id}`}>
      <h2 id={`finder-${catalog.id}-titre`} className="finder-title">{catalog.label}</h2>
      {catalog.intro && <p className="hint finder-intro">{catalog.intro}</p>}

      <div className="presets" role="group" aria-label="Questions rapides">
        <span className="presets-label" aria-hidden="true">Questions rapides</span>
        {catalog.presets.map((p) => (
          <button key={p.id} type="button" className={current?.id === p.id ? 'chip preset active' : 'chip preset'} aria-pressed={current?.id === p.id}
            onClick={() => onChange(presetState(catalog, p))} data-testid={`preset-${p.id}`}>{p.label}</button>
        ))}
      </div>

      <div className="finder-grid">
        <details className="facets-box" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary data-testid="facets-toggle">Filtres{nActive ? ` · ${nActive} actif${nActive > 1 ? 's' : ''}` : ''}</summary>
          <form className="facets" onSubmit={(e) => e.preventDefault()} aria-label={`Filtres : ${catalog.label}`}>
            {catalog.facets.map((f) => <Facet key={f.id} catalog={catalog} facet={f} value={state.f[f.id]} set={(v) => setFacet(f.id, v)} fieldOptions={fieldOptions} cur={cur} />)}
            <label className="switch facet-switch">
              <input type="checkbox" checked={state.includeUnknown !== false} onChange={(e) => onChange({ ...state, includeUnknown: e.target.checked })} data-testid="include-unknown" />
              <span className="switch-ui" aria-hidden="true" />
              <span>Afficher aussi les « non publié » (à vérifier)</span>
            </label>
            <button type="button" className="reset" onClick={() => onChange(defaultState(catalog))} data-testid="finder-reset">Réinitialiser</button>
          </form>
        </details>

        <div className="finder-results">
          <div className="finder-bar">
            <p className="count" aria-live="polite" data-testid="finder-count">
              <b>{plural(res.matches.length, [`${one} correspond`, `${many} correspondent`])}</b>
              {res.unknown.length > 0 && ` · ${res.unknown.length} à vérifier (non publié)`}
              {res.hiddenAlt > 0 && ` · ${res.hiddenAlt} en offre groupée seulement, masquée${res.hiddenAlt > 1 ? 's' : ''}`}
              {cur === 'EUR' && ' · conversion indicative en €'}
            </p>
            <label className="sort">
              <span>Trier par</span>
              <select value={res.sort?.id} onChange={(e) => onChange({ ...state, sort: e.target.value })} data-testid="finder-sort">
                {catalog.sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          {res.matches.length === 0 && <p className="np np-label">Aucune {one} ne correspond à tous les critères publiés.</p>}
          <ol className="plist" data-testid="finder-results">
            {res.matches.map((m, i) => <li key={m.row.id}><ProductCard catalog={catalog} item={m} best={best.has(m.row.id)} bank={bankById[m.row.bank]} cur={cur} idx={i} /></li>)}
          </ol>
          {res.unknown.length > 0 && (
            <>
              <h3 className="unknown-title">À vérifier auprès de la banque : information non publiée</h3>
              <p className="hint">Ces {many} ne sont pas exclues par vos critères, mais la banque ne publie pas l’information demandée : elles ne sont pas comptées comme correspondantes.</p>
              <ol className="plist" data-testid="finder-unknown">
                {res.unknown.map((m, i) => <li key={m.row.id}><ProductCard catalog={catalog} item={m} best={false} bank={bankById[m.row.bank]} cur={cur} idx={i} /></li>)}
              </ol>
            </>
          )}
          {catalog.notes?.length > 0 && <ul className="finder-notes">{catalog.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      </div>
    </section>
  );
}
