import { useMemo, useState } from 'react';
import { fmtDate, fmtMoney, fmtNum, fmtPct } from './lib/data.js';
import { SecondaryTag, SourceChip } from './common.jsx';
import {
  attrOf, bestIds, compareOf, defaultState, facetCounts, facetOf, inputValue, inputsOf, isActive, isFound, optionsOf,
  presetBest, presetState, query, rareAttributes, sameState,
} from './lib/catalog.js';

// Vue « trouver un produit » générique : tout (attributs, facettes, tris, questions rapides, coût, montants saisis) vient
// du catalogue déclaré dans les données. Aucun libellé ni attribut propre à un type de produit ici.

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

/** Badges de fiabilité d'une valeur : exemple ancien, valeur indicative, source secondaire. */
function Badges({ e }) {
  return (
    <>
      {e.stale && <span className="tag tag-stale" data-testid="tag-stale">Exemple ancien</span>}
      {e.indicative && <span className="tag tag-indicative" data-testid="tag-indicative">{e.indicative}</span>}
      {e.secondary && <SecondaryTag detail={e.secondary} />}
    </>
  );
}

function AttrValue({ a, e, cur, inherited, onOpen }) {
  if (!e) return null;
  const inh = inherited && <span className="inh" data-testid="inherited">commun à la banque</span>;
  if (e.status !== 'found') {
    return (
      <div className="pv np-inline">
        <span className="np-label">Non publié</span>
        {inh}
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
      {inh}
      <Badges e={e} />
      {e.link && onOpen && (
        <button type="button" className="linkish plink" onClick={() => onOpen(e.link)} data-testid={`link-${e.link.row}`}>{e.link.label || 'voir le produit'}</button>
      )}
      {e.note && <span className="note">{e.note}</span>}
      {e.next && <span className="next-inline"><span className="tag tag-soon">Nouvelle grille au {fmtDate(e.next.effective_from)}</span> {e.next.value} <SourceChip id={e.next.source} quote={e.next.quote} /></span>}
      <Chips e={e} />
    </div>
  );
}

function Cost({ catalog, item, cur, inputs }) {
  const c = catalog.cost, { cost, row } = item;
  const unit = unitSuffix(c.unit);
  const own = row.attrs[c.attr];
  const altAttr = c.alt && attrOf(catalog, c.alt.attr);
  const amountDef = c.amount && inputsOf(catalog).find((i) => i.id === c.amount);
  const loan = cost.loan;
  const rate = c.loan && row.attrs[c.loan.rate];
  return (
    <div className="pcost" data-testid="pcost">
      {cost.kind === 'standalone' ? (
        <p className="pcost-main"><span data-testid="pcost-value">{fmtMoney(cost.value, cur)}</span><small>{unit}</small>
          {amountDef && <small className="pcost-for"> {c.label || attrOf(catalog, c.attr).label} pour {fmtMoney(cost.amount, cur)} {amountDef.suffix || ''}</small>}</p>
      ) : cost.kind === 'alt' ? (
        <p className="pcost-main alt"><small>{c.alt.label} : </small><span data-testid="pcost-value">{fmtMoney(cost.value, cur)}</span><small>{unit}</small></p>
      ) : <p className="pcost-main muted">{isFound(own) ? 'Montant non chiffré' : 'Prix non publié'}</p>}
      {own && <AttrValue a={attrOf(catalog, c.attr)} e={own} cur={cur} inherited={row.inherited?.includes(c.attr)} />}
      {loan && (
        <p className="ploan" data-testid="pcost-loan">
          {c.loan.label} sur {Math.round(inputValue(catalog, inputs, c.loan.months) / 12)} ans au taux publié de {fmtPct(rate.num, 3)} : intérêts {fmtMoney(loan.interest, cur)}
          {loan.fee !== null && <> + frais {fmtMoney(loan.fee, cur)}</>} = <b>{fmtMoney(loan.total, cur)}</b>{' '}<Badges e={rate} />
        </p>
      )}
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

const RareTag = () => <span className="tag tag-rare" data-testid="tag-rare">critère peu publié</span>;

function ProductCard({ catalog, item, best, bank, cur, idx, rare, inputs, onOpen }) {
  const { row } = item;
  const shown = new Set([catalog.cost?.attr, catalog.cost?.alt?.attr]);
  // attributs facultatifs (`optional`) absents d'une ligne : simplement non affichés
  const summary = catalog.summary.filter((id) => !shown.has(id) && row.attrs[id] !== undefined).map((id) => attrOf(catalog, id));
  const rest = catalog.attributes.filter((a) => !shown.has(a.id) && !catalog.summary.includes(a.id) && row.attrs[a.id] !== undefined);
  // alerte déclarée dans les données (`flagFalse`) quand un attribut booléen publié vaut « non » (ex. pas utilisable à l'étranger)
  const flags = catalog.attributes.filter((a) => a.flagFalse && isFound(row.attrs[a.id]) && row.attrs[a.id].code === false);
  const cmp = catalog.compare ? compareOf(catalog, row) : null;
  const dl = (list) => (
    <dl className="pattrs">
      {list.map((a) => (
        <div key={a.id}>
          <dt>{a.label}{rare.has(a.id) && <> <RareTag /></>}</dt>
          <dd><AttrValue a={a} e={row.attrs[a.id]} cur={cur} inherited={row.inherited?.includes(a.id)} onOpen={onOpen} /></dd>
        </div>
      ))}
    </dl>
  );
  return (
    <article className="pcard" id={`pcard-${row.id}`} style={{ '--bank': bank?.color, '--i': Math.min(idx, 8) }} data-testid={`pcard-${row.id}`} data-product={row.productId}>
      <header className="pcard-head">
        <span className="pbank"><span className="dot" />{bank?.short}</span>
        <h3>{row.name}{row.variant && <span className="pvariant"> · {row.variant}</span>}</h3>
        <div className="ptags">
          {best && <span className="tag tag-best" data-testid="tag-cheapest">{catalog.best.label}</span>}
          {flags.map((a) => <span key={a.id} className="tag tag-warn" data-testid={`tag-flag-${a.id}`}>{a.flagFalse}</span>)}
          {cmp === 'diff' && <span className="tag tag-warn" data-testid="tag-compare-diff">{catalog.compare.label}</span>}
          {cmp === 'same' && <span className="tag tag-ok" data-testid="tag-compare-same">{catalog.compare.okLabel}</span>}
          {item.unknownFacets.map((f) => <span key={f} className="tag tag-np">Non publié : {facetOf(catalog, f).label.toLowerCase()}</span>)}
        </div>
      </header>
      {catalog.cost && <Cost catalog={catalog} item={item} cur={cur} inputs={inputs} />}
      {dl(summary)}
      {(rest.length > 0 || row.note) && (
        <details className="pmore">
          <summary>{rest.length ? 'Tous les attributs' : 'Précisions'}</summary>
          {rest.length > 0 && dl(rest)}
          {row.note && <p className="note">{row.note}</p>}
        </details>
      )}
    </article>
  );
}

const Count = ({ n }) => (n === undefined ? null : <span className="fcount" data-testid="fcount">({n})</span>);

function Facet({ catalog, facet, value, set, fieldOptions, cur, counts }) {
  const id = `f-${catalog.id}-${facet.id}`;
  const cnt = counts?.[facet.id] || {};
  if (facet.type === 'enum') {
    const opts = optionsOf(catalog, facet, fieldOptions);
    const v = value || [];
    return (
      <fieldset className="facet">
        <legend>{facet.label}</legend>
        <div className="facet-opts">
          {opts.map((o) => (
            <label key={o.value} className={`check${cnt[String(o.value)] === 0 && !v.includes(o.value) ? ' zero' : ''}`}>
              <input type="checkbox" checked={v.includes(o.value)} data-testid={`${id}-${o.value}`}
                onChange={(e) => set(e.target.checked ? [...v, o.value] : v.filter((x) => x !== o.value))} />
              <span>{o.label} <Count n={cnt[String(o.value)]} /></span>
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
              <span>{l}{v !== undefined && <> <Count n={cnt[String(v)]} /></>}</span>
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
          {facet.choices.map((c) => <option key={c.value} value={c.value}>{c.label}{cnt[c.value] !== undefined ? ` (${cnt[c.value]})` : ''}</option>)}
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
      <span>{facet.label} {facet.type === 'listHas' && <Count n={cnt.true} />}</span>
    </label>
  );
}

/** Montant saisi par le visiteur (ex. montant emprunté) : recalcule les coûts du catalogue. */
function Inputs({ catalog, state, onChange, cur }) {
  const list = inputsOf(catalog);
  if (!list.length) return null;
  return (
    <div className="finder-inputs" role="group" aria-label="Montants pour le calcul des coûts">
      {list.map((i) => {
        const id = `in-${catalog.id}-${i.id}`;
        const v = state.inputs?.[i.id] ?? i.default;
        return (
          <div key={i.id} className="facet field finder-input">
            <label className="field-label" htmlFor={id}>{i.label}</label>
            <div className="field-input">
              <input id={id} type="number" inputMode="numeric" min={i.min ?? 0} max={i.max} step={i.step || 1} value={v} data-testid={id}
                aria-describedby={i.hint ? `${id}-hint` : undefined}
                onChange={(e) => onChange({ ...state, inputs: { ...state.inputs, [i.id]: e.target.value === '' ? '' : Number(e.target.value) } })} />
              <span className="suffix">{i.unit || 'XPF'}</span>
            </div>
            {i.hint && <span className="hint" id={`${id}-hint`}>{i.hint}</span>}
            {cur === 'EUR' && (i.unit || 'XPF') === 'XPF' && Number(v) > 0 && <span className="hint">≈ {fmtMoney(Number(v), 'EUR')}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Réponse d'une question liée (ex. « Visa la moins chère » → « … utilisable à l'étranger »), calculée par le moteur. */
function Related({ catalog, rows, labels, rel, bankById, cur, onApply, inputs }) {
  const best = presetBest(catalog, rows, rel.preset, labels, inputs);
  const unit = unitSuffix(catalog.cost?.unit);
  return (
    <p className="related" data-testid={`related-${rel.preset}`}>
      <span className="related-label">{rel.label} :</span>{' '}
      {best.length ? best.map((m, i) => (
        <span key={m.row.id}>{i > 0 && ', '}<b>{bankById[m.row.bank]?.short} {m.row.name}{m.row.variant ? ` (${m.row.variant})` : ''}</b>{m.cost.value !== null && <> · {fmtMoney(m.cost.value, cur)}{unit}</>}</span>
      )) : <span>aucune réponse publiée</span>}{' '}
      <button type="button" className="linkish" onClick={onApply} data-testid={`related-apply-${rel.preset}`}>voir</button>
    </p>
  );
}

export default function Finder({ catalog, rows, banks, cur, state, onChange, onOpen }) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1080px)').matches);
  const bankById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks]);
  const fieldOptions = useMemo(() => ({ bank: banks.map((b) => ({ value: b.id, label: b.short })) }), [banks]);
  const labels = useMemo(() => ({ field: (f, v) => (f === 'bank' ? banks.findIndex((b) => b.id === v) : v) }), [banks]);
  const res = useMemo(() => query(catalog, rows, state, labels), [catalog, rows, state, labels]);
  const counts = useMemo(() => facetCounts(catalog, rows, state, fieldOptions), [catalog, rows, state, fieldOptions]);
  const rare = useMemo(() => new Set(rareAttributes(catalog, rows)), [catalog, rows]);
  const best = new Set(bestIds(catalog, res.matches));
  const nActive = catalog.facets.filter((f) => isActive(f, state.f[f.id])).length;
  const setFacet = (id, v) => onChange({ ...state, f: { ...state.f, [id]: v } });
  const current = catalog.presets.find((p) => sameState(catalog, state, presetState(catalog, p)));
  const [one, many] = catalog.itemLabel || ['produit', 'produits'];
  const applyPreset = (p) => onChange(presetState(catalog, p, state.inputs));
  const rareList = catalog.attributes.filter((a) => rare.has(a.id) && !catalog.hideRare?.includes(a.id));
  const absent = (catalog.absent || []).filter((a) => !rows.some((r) => r.bank === a.bank));

  return (
    <section className="finder" aria-labelledby={`finder-${catalog.id}-titre`} data-testid={`finder-${catalog.id}`} data-layout={catalog.layout || 'cards'}>
      <h2 id={`finder-${catalog.id}-titre`} className="finder-title">{catalog.label}</h2>
      {catalog.intro && <p className="hint finder-intro">{catalog.intro}</p>}

      <div className="presets" role="group" aria-label="Questions rapides">
        <span className="presets-label" aria-hidden="true">Questions rapides</span>
        {catalog.presets.map((p) => (
          <button key={p.id} type="button" className={current?.id === p.id ? 'chip preset active' : 'chip preset'} aria-pressed={current?.id === p.id}
            onClick={() => applyPreset(p)} data-testid={`preset-${p.id}`}>{p.label}</button>
        ))}
      </div>
      {current?.related?.map((rel) => (
        <Related key={rel.preset} catalog={catalog} rows={rows} labels={labels} rel={rel} bankById={bankById} cur={cur} inputs={state.inputs}
          onApply={() => applyPreset(catalog.presets.find((p) => p.id === rel.preset))} />
      ))}
      {current?.answer && <p className="hint preset-answer" data-testid={`answer-${current.id}`}>{current.answer}</p>}
      <Inputs catalog={catalog} state={state} onChange={onChange} cur={cur} />

      <div className="finder-grid">
        <details className="facets-box" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary data-testid="facets-toggle">Filtres{nActive ? ` · ${nActive} actif${nActive > 1 ? 's' : ''}` : ''}</summary>
          <form className="facets" onSubmit={(e) => e.preventDefault()} aria-label={`Filtres : ${catalog.label}`}>
            {catalog.facets.map((f) => <Facet key={f.id} catalog={catalog} facet={f} value={state.f[f.id]} set={(v) => setFacet(f.id, v)} fieldOptions={fieldOptions} cur={cur} counts={counts} />)}
            <label className="switch facet-switch">
              <input type="checkbox" checked={state.includeUnknown !== false} onChange={(e) => onChange({ ...state, includeUnknown: e.target.checked })} data-testid="include-unknown" />
              <span className="switch-ui" aria-hidden="true" />
              <span>Afficher aussi les « non publié » (à vérifier)</span>
            </label>
            <button type="button" className="reset" onClick={() => onChange({ ...defaultState(catalog), inputs: state.inputs })} data-testid="finder-reset">Réinitialiser</button>
            {rareList.length > 0 && (
              <p className="hint rare-note" data-testid="rare-note">
                <RareTag /> publié par moins de deux établissements, donc pas proposé comme filtre (visible dans les fiches) : {rareList.map((a) => a.label.toLowerCase()).join(', ')}.
              </p>
            )}
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
          {res.matches.length === 0 && <p className="np np-label">{catalog.emptyLabel || `Aucune ${one} ne correspond à tous les critères publiés.`}</p>}
          <ol className="plist" data-testid="finder-results">
            {res.matches.map((m, i) => <li key={m.row.id}><ProductCard catalog={catalog} item={m} best={best.has(m.row.id)} bank={bankById[m.row.bank]} cur={cur} idx={i} rare={rare} inputs={state.inputs} onOpen={onOpen} /></li>)}
          </ol>
          {res.unknown.length > 0 && (
            <>
              <h3 className="unknown-title">À vérifier auprès de la banque : information non publiée</h3>
              <p className="hint">Ces {many} ne sont pas exclues par vos critères, mais la banque ne publie pas l’information demandée : elles ne sont pas comptées comme correspondantes.</p>
              <ol className="plist" data-testid="finder-unknown">
                {res.unknown.map((m, i) => <li key={m.row.id}><ProductCard catalog={catalog} item={m} best={false} bank={bankById[m.row.bank]} cur={cur} idx={i} rare={rare} inputs={state.inputs} onOpen={onOpen} /></li>)}
              </ol>
            </>
          )}
          {absent.length > 0 && (
            <ul className="finder-absent" data-testid="finder-absent">
              {absent.map((a) => (
                <li key={a.bank}><b>{bankById[a.bank]?.short}</b> : aucun produit publié dans ce catalogue{a.note ? ` (${a.note})` : ''}. <span className="checked">Vérifié dans : {a.checked.map((c) => <SourceChip key={c} id={c} />)}</span></li>
              ))}
            </ul>
          )}
          {catalog.ruleItems?.length > 0 && (
            <section className="finder-rules" aria-labelledby={`regles-${catalog.id}`} data-testid="finder-rules">
              <h3 id={`regles-${catalog.id}`}>Règles communes à toutes les banques</h3>
              <ul>
                {catalog.ruleItems.map((r) => (
                  <li key={r.id} data-testid={`rule-${r.id}`}><b>{r.label}</b> : {r.value} <SourceChip id={r.source} quote={r.quote} /></li>
                ))}
              </ul>
            </section>
          )}
          {catalog.notes?.length > 0 && <ul className="finder-notes">{catalog.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      </div>
    </section>
  );
}
