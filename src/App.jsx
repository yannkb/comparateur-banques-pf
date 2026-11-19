import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CATALOG_INDEX, data, fieldsOf, fmtDate, fmtNum, fmtMoney, bankById, loadCatalog, loadReperes } from './lib/data.js';
import { SourceChip, MarketPanel } from './common.jsx';
import { entryCost } from './lib/cost.js';
import { defaultState, inputsOf, paramsToState, stateToParams } from './lib/catalog.js';

// Vues chargées à la demande (code-splitting) : simulateur, moteur de catalogues, Repères officiels.
const Simulator = lazy(() => import('./Simulator.jsx'));
const Finder = lazy(() => import('./Finder.jsx'));
const Reperes = lazy(() => import('./Reperes.jsx'));

const TABS = [...data.categories, { id: 'simu', label: 'Simulateur' }];
// Rubriques « vue » (ex. Repères officiels) : pas de fiches par banque ; leurs catalogues sont intégrés à la vue.
const VIEW_TABS = new Set(data.categories.filter((c) => c.view).map((c) => c.id));
const DEFAULT_SORT = { immo: 'immo_frais_dossier', compte: 'cpt_tenue', epargne: 'ep_livret', conso: 'conso_frais_dossier' };
const MARKET_BY_CAT = {
  immo: ['ieom_habitat', 'usure_habitat_moins_10', 'usure_habitat_10_20', 'usure_habitat', 'usure_relais', 'ptz_pays', 'ptz_plafonds', 'aim', 'lp2025_21_ira'],
  compte: ['ieom_decouvert'],
  epargne: [],
  conso: ['ieom_conso', 'usure_conso', 'lp2025_21_ira'],
};
const BEST_LABEL = { lower: 'Le plus bas', higher: 'Le plus élevé' };

// Vues « trouver un produit » (catalogues déclarés dans les données), rattachées à une rubrique.
const FIELD_OPTIONS = { bank: data.banks.map((b) => ({ value: b.id, label: b.short })) };
const VIEW_PARAM = 'vue';
/** État initial lu dans l'URL (?vue=<catalogue>&filtres…), pour des liens partageables ; les filtres sont lus quand le catalogue est chargé. */
function initialView() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const c = CATALOG_INDEX.find((x) => x.id === params.get(VIEW_PARAM));
  return { tab: c?.category, sub: c ? { [c.category]: c.id } : {}, catalog: c?.id, params, embedded: !!c && VIEW_TABS.has(c.category) };
}

/** Charge une ressource asynchrone (catalogue, repères) et la garde tant que la clé ne change pas. */
function useLoaded(loader, key) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!key) return undefined;
    let on = true;
    loader(key).then((x) => on && setV({ key, value: x }));
    return () => { on = false; };
  }, [loader, key]);
  return v && v.key === key ? v.value : null;
}
const Loading = () => <p className="loading" role="status">Chargement…</p>;

/** Valeur de classement : coût réel pour le montant saisi (barème publié, moteur commun `cost.js`), sinon `num`. */
function sortValue(e, field, amount) {
  if (e?.status !== 'found') return null;
  if (field.costFor) return entryCost(e, amount);
  return typeof e.num === 'number' ? e.num : null;
}
/** Montant saisi : partagé par clé (`costFor.key`) entre la comparaison des banques et les catalogues (`inputs[].key`). */
const amountKey = (f) => f.costFor?.key || f.id;
const amountOf = (amounts, f) => amounts[amountKey(f)] ?? f.costFor?.default;
const inputKey = (c, i) => i.key || `${c.id}.${i.id}`;

function Entry({ e, field, cur, amount }) {
  if (!e) return null;
  if (e.status === 'not_published') {
    return (
      <div className="entry np">
        <span className="np-label">Non publié</span>
        {e.note && <p className="note">{e.note}</p>}
        <p className="checked">
          Vérifié dans : {e.checked.map((c) => <SourceChip key={c} id={c} />)}
        </p>
      </div>
    );
  }
  const n = fmtNum(e.num, field.unit, cur);
  const showConv = cur === 'EUR' && n && field.unit?.startsWith('XPF');
  return (
    <div className={`entry${e.stale ? ' stale' : ''}`}>
      <p className="value">{e.value}</p>
      {showConv && <p className="conv">≈ {n}</p>}
      {field.costFor && e.fee && amount > 0 && <p className="conv" data-testid="fee-cost">Pour {fmtMoney(amount, cur)} empruntés : {fmtMoney(entryCost(e, amount), cur)}</p>}
      {e.stale && <span className="tag tag-stale">Exemple ancien</span>}
      {e.indicative && <span className="tag tag-indicative" data-testid="tag-indicative">{e.indicative}</span>}
      {e.next && (
        <div className="next" data-testid="next-badge">
          <span className="tag tag-soon">Nouvelle grille au {fmtDate(e.next.effective_from)}</span>
          <p className="next-value">{e.next.value}</p>
          <SourceChip id={e.next.source} quote={e.next.quote} />
        </div>
      )}
      {e.note && <p className="note">{e.note}</p>}
      <p className="srcs">
        <SourceChip id={e.source} quote={e.quote} />
        {(e.extra || []).filter((x) => x.source !== e.source).map((x, i) => <SourceChip key={i} id={x.source} quote={x.quote} />)}
      </p>
    </div>
  );
}

function bestBank(banks, field, amount) {
  if (!field?.better) return null;
  const vals = banks.map((b) => [b.id, sortValue(b.fields[field.id], field, amount)]).filter(([, v]) => v !== null);
  if (vals.length < 2) return null;
  const sorted = [...vals].sort((a, b) => (field.better === 'lower' ? a[1] - b[1] : b[1] - a[1]));
  if (sorted[0][1] === sorted[1][1]) return null;
  return sorted[0][0];
}

function sortBanks(banks, field, amount) {
  if (!field) return banks;
  const key = (b) => sortValue(b.fields[field.id], field, amount);
  return [...banks].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return field.better === 'higher' ? kb - ka : ka - kb;
  });
}

function Cards({ banks, fields, sortField, hideNP, cur, best, amounts }) {
  return (
    <div className="grid">
      {banks.map((b, idx) => {
        const head = sortField ? b.fields[sortField.id] : null;
        const rows = fields.filter((f) => !(hideNP && b.fields[f.id]?.status === 'not_published'));
        const found = fields.filter((f) => b.fields[f.id]?.status === 'found').length;
        if (found === 0) {
          const checked = [...new Set(fields.flatMap((f) => b.fields[f.id]?.checked || []))];
          const note = b.fields[fields[0].id]?.note;
          return (
            <article key={b.id} className="card card-empty" style={{ '--bank': b.color, '--i': idx }} data-testid={`card-${b.id}`}>
              <header className="card-head"><span className="bank-chip"><span className="dot" />{b.name}</span></header>
              <p className="group">{b.group}</p>
              <div className="entry np">
                <span className="np-label">Aucune offre publiée dans cette rubrique</span>
                {note && <p className="note">{note}</p>}
                <p className="checked">Vérifié dans : {checked.map((c) => <SourceChip key={c} id={c} />)}</p>
              </div>
            </article>
          );
        }
        return (
          <article key={b.id} className="card" style={{ '--bank': b.color, '--i': idx }} data-testid={`card-${b.id}`}>
            <header className="card-head">
              <span className="bank-chip"><span className="dot" />{b.name}</span>
              {best === b.id && <span className="tag tag-best">{BEST_LABEL[sortField.better]} · {sortField.label.toLowerCase()}</span>}
            </header>
            <p className="group">{b.group}</p>
            {sortField && (
              <div className="headline">
                <span className="headline-label">{sortField.label}</span>
                <span className={`headline-value${head?.status !== 'found' ? ' muted' : ''}`} data-testid="headline">
                  {head?.status !== 'found' ? 'Non publié'
                    : sortField.costFor && head.fee ? fmtMoney(sortValue(head, sortField, amountOf(amounts, sortField)), cur)
                      : (fmtNum(head.num, sortField.unit, cur) ?? head.value)}
                </span>
                {sortField.costFor && head?.fee && <small className="headline-sub">pour {fmtMoney(amountOf(amounts, sortField), cur)} empruntés</small>}
              </div>
            )}
            <p className="coverage"><b>{found}</b>/{fields.length} rubriques documentées</p>
            <dl className="rows">
              {rows.map((f) => (
                <div key={f.id} className="row">
                  <dt>{f.label}</dt>
                  <dd><Entry e={b.fields[f.id]} field={f} cur={cur} amount={amountOf(amounts, f)} /></dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function Table({ banks, fields, hideNP, cur, amounts }) {
  const visible = fields.filter((f) => !(hideNP && banks.every((b) => b.fields[f.id]?.status === 'not_published')));
  return (
    <div className="table-wrap" role="region" aria-label="Tableau comparatif" tabIndex={0}>
      <table className="cmp">
        <thead>
          <tr>
            <th scope="col">Rubrique</th>
            {banks.map((b) => <th key={b.id} scope="col" style={{ '--bank': b.color }}><span className="dot" />{b.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.map((f) => {
            const best = bestBank(banks, f, amountOf(amounts, f));
            return (
              <tr key={f.id}>
                <th scope="row">{f.label}{f.unit && <small>{f.unit}</small>}</th>
                {banks.map((b) => (
                  <td key={b.id} className={best === b.id ? 'is-best' : ''}>
                    {best === b.id && <span className="tag tag-best">{BEST_LABEL[f.better]}</span>}
                    <Entry e={b.fields[f.id]} field={f} cur={cur} amount={amountOf(amounts, f)} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tapa() {
  return <div className="tapa" aria-hidden="true" />;
}

function Sources() {
  const groups = useMemo(() => {
    const g = {};
    for (const [id, s] of Object.entries(data.sources)) (g[s.publisher] ||= []).push({ id, ...s });
    return Object.entries(g);
  }, []);
  return (
    <section className="sources" id="sources" aria-labelledby="sources-titre">
      <h2 id="sources-titre">Sources <span>{Object.keys(data.sources).length} documents, dernière vérification le {fmtDate(data.meta.verified)}</span></h2>
      <div className="src-groups">
        {groups.map(([pub, list]) => (
          <div key={pub} className="src-group">
            <h3>{pub}</h3>
            <ul>
              {list.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                  <span>{s.dateLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [init] = useState(initialView);
  const [tab, setTab] = useState(init.tab || 'immo');
  const [sub, setSub] = useState(init.sub);
  const [finder, setFinder] = useState({});
  const [pending, setPending] = useState(null);
  const [cur, setCur] = useState('XPF');
  const [only, setOnly] = useState(null);
  const [view, setView] = useState('cards');
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);
  const [hideNP, setHideNP] = useState(false);
  const [amounts, setAmounts] = useState({});

  const isView = VIEW_TABS.has(tab);
  const isData = tab !== 'simu' && !isView;
  const fields = isData ? fieldsOf(tab) : [];
  const sortable = fields.filter((f) => f.better && data.banks.some((b) => typeof b.fields[f.id]?.num === 'number' || b.fields[f.id]?.fee));
  const sortField = sortable.find((f) => f.id === sortBy[tab]) || sortable[0];
  const amount = sortField ? amountOf(amounts, sortField) : undefined;
  const banks = useMemo(() => {
    const list = data.banks.filter((b) => !only || b.id === only);
    return sortBanks(list, sortField, amount);
  }, [only, sortField, amount]);
  const best = bestBank(banks, sortField, amount);
  const counts = banks.reduce((acc, b) => {
    fields.forEach((f) => { acc[b.fields[f.id]?.status] = (acc[b.fields[f.id]?.status] || 0) + 1; });
    return acc;
  }, {});
  const m = data.market;
  const catalogsHere = CATALOG_INDEX.filter((c) => c.category === tab);
  const activeId = isView ? catalogsHere[0]?.id : catalogsHere.find((c) => c.id === sub[tab])?.id;
  const loaded = useLoaded(loadCatalog, activeId);
  const reperes = useLoaded(loadReperes, isView ? 'reperes' : null);

  /** État d'un catalogue : saisi, sinon lu dans l'URL d'arrivée, sinon par défaut ; montants partagés par clé. */
  const stateOf = (c) => {
    const st = finder[c.id] || (init.catalog === c.id ? paramsToState(c, init.params, FIELD_OPTIONS) : defaultState(c));
    return { ...st, inputs: Object.fromEntries(inputsOf(c).map((i) => [i.id, amounts[inputKey(c, i)] ?? st.inputs?.[i.id] ?? i.default])) };
  };
  const setStateOf = (c) => (st) => {
    setFinder((f) => ({ ...f, [c.id]: st }));
    const upd = Object.fromEntries(inputsOf(c).filter((i) => st.inputs?.[i.id] !== undefined).map((i) => [inputKey(c, i), st.inputs[i.id] === '' ? 0 : st.inputs[i.id]]));
    if (Object.keys(upd).length) setAmounts((a) => ({ ...a, ...upd }));
  };
  // Lien entre catalogues (ex. carte incluse dans une offre groupée → fiche de la carte) : ouvre le catalogue cible
  // filtré sur la banque du produit, puis fait défiler jusqu'à sa fiche.
  const onOpen = (link) => {
    const target = CATALOG_INDEX.find((c) => c.id === link.catalog);
    if (!target) return;
    setTab(target.category);
    setSub((s) => ({ ...s, [target.category]: target.id }));
    setPending(link);
  };
  useEffect(() => {
    if (!pending || !loaded || loaded.catalog.id !== pending.catalog) return;
    const { catalog, rows } = loaded;
    const row = rows.find((r) => r.id === pending.row);
    const f = {};
    for (const fc of catalog.facets) {
      if (fc.field === 'bank' && row) f[fc.id] = [row.bank];
      if (fc.role === 'includeAlt') f[fc.id] = true;
    }
    setFinder((s) => ({ ...s, [catalog.id]: { ...defaultState(catalog), f } }));
    setPending(null);
    setTimeout(() => document.getElementById(`pcard-${pending.row}`)?.scrollIntoView({ block: 'center' }), 60);
  }, [pending, loaded]);

  // URL partageable : ?vue=<catalogue>&<filtres> tant que la vue « trouver » est affichée.
  useEffect(() => {
    if (init.catalog && !init.embedded && loaded?.catalog.id === init.catalog) document.querySelector('.finder')?.scrollIntoView({ block: 'start' });
  }, [init, loaded]);
  useEffect(() => {
    if (activeId && !loaded) return; // catalogue en cours de chargement : ne pas toucher à l'URL
    const url = new URL(window.location.href);
    const c = loaded?.catalog;
    const next = c ? `?${new URLSearchParams([[VIEW_PARAM, c.id], ...stateToParams(c, stateOf(c))])}` : '';
    if (url.search !== next) window.history.replaceState(null, '', `${url.pathname}${next}${url.hash}`);
  });

  // Onglets au clavier (motif ARIA « tabs ») : flèches gauche/droite, Début/Fin ; activation automatique.
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    setTab(t.id);
    document.getElementById(`tab-${t.id}`)?.focus();
  };
  const finderFor = (l) => <Finder catalog={l.catalog} rows={l.rows} banks={data.banks} cur={cur} state={stateOf(l.catalog)} onChange={setStateOf(l.catalog)} onOpen={onOpen} />;

  return (
    <div className="page">
      <header className="masthead">
      <div className="topbar">
        <p>Édition du <time dateTime={data.meta.updated}>{fmtDate(data.meta.updated)}</time> · dernière vérification des sources : <time dateTime={data.meta.verified}>{fmtDate(data.meta.verified)}</time> · chaque chiffre sourcé</p>
        <div className="cur" role="group" aria-label="Devise">
          {['XPF', 'EUR'].map((c) => (
            <button key={c} className={cur === c ? 'on' : ''} aria-pressed={cur === c} onClick={() => setCur(c)} data-testid={`cur-${c}`}>
              {c === 'EUR' ? '€' : 'XPF'}
            </button>
          ))}
          <span className="parity">1 000 XPF = 8,38 €</span>
        </div>
      </div>

      <div className="hero">
        <div className="hero-text">
          <p className="kicker">Socredo · Banque de Tahiti · Banque de Polynésie · Marara (OPT)</p>
          <h1>
            <span className="h1-main">Comparez</span>
            <span className="h1-sub">les banques du Fenua</span>
          </h1>
          <p className="lede">Crédit immobilier, frais de compte et cartes bancaires, épargne et crédit à la consommation en Polynésie française : les grilles tarifaires en vigueur mises côte à côte, avec leur source. Ce qui n’est pas publié est marqué comme tel.</p>
        </div>
        <div className="ledger" aria-label="Repères IEOM et Banque de France">
          {[['ieom_habitat', 'Crédit habitat'], ['ieom_conso', 'Prêt personnel'], ['usure_habitat', 'Usure immo ≥ 20 ans']].map(([id, lbl], i) => (
            <div key={id} className="ledger-row" style={{ '--i': i }}>
              <span className="ledger-label">{lbl}<small>{i < 2 ? 'taux moyen PF, T2 2026' : 'seuil légal, T4 2026'}</small></span>
              <span className="ledger-value">{m[id].value}</span>
              <SourceChip id={m[id].source} quote={m[id].quote} />
            </div>
          ))}
        </div>
      </div>
      <Tapa />
      </header>

      <nav className="tabs" aria-label="Rubriques">
        <div className="tablist" role="tablist" aria-label="Rubriques" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} data-testid="tabpanel">
        {isData ? (
          <section className="offers" aria-label={TABS.find((t) => t.id === tab).label}>
            {catalogsHere.length > 0 && (
              <div className="subviews seg" role="group" aria-label="Affichage de la rubrique">
                <button type="button" className={!activeId ? 'on' : ''} aria-pressed={!activeId} onClick={() => setSub({ ...sub, [tab]: null })} data-testid="subview-compare">Comparer les banques</button>
                {catalogsHere.map((c) => (
                  <button key={c.id} type="button" className={activeId === c.id ? 'on' : ''} aria-pressed={activeId === c.id} onClick={() => setSub({ ...sub, [tab]: c.id })} data-testid={`subview-${c.id}`}>{c.label}</button>
                ))}
              </div>
            )}
            {activeId ? (
              <Suspense fallback={<Loading />}>{loaded ? finderFor(loaded) : <Loading />}</Suspense>
            ) : (<>
            <div className="controls">
              <div className="chips" role="group" aria-label="Établissement">
                <button className={!only ? 'chip active' : 'chip'} onClick={() => setOnly(null)}>Tous</button>
                {data.banks.map((b) => (
                  <button key={b.id} style={{ '--bank': b.color }} className={only === b.id ? 'chip active' : 'chip'} aria-pressed={only === b.id} onClick={() => setOnly(only === b.id ? null : b.id)}>
                    <span className="dot" />{b.short}
                  </button>
                ))}
              </div>
              <div className="filters">
                {sortable.length > 0 && (
                  <label className="sort">
                    <span>Trier par</span>
                    <select value={sortField?.id} onChange={(e) => setSortBy({ ...sortBy, [tab]: e.target.value })} data-testid="sort">
                      {sortable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </label>
                )}
                {sortField?.costFor && (
                  <label className="sort amount">
                    <span>{sortField.costFor.label}</span>
                    <input type="number" min={0} step={sortField.costFor.step} value={amountOf(amounts, sortField)} data-testid="cost-amount"
                      onChange={(e) => setAmounts({ ...amounts, [amountKey(sortField)]: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0) })} />
                    <span>XPF</span>
                  </label>
                )}
                <div className="seg" role="group" aria-label="Affichage">
                  <button className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')} data-testid="view-cards">Fiches</button>
                  <button className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')} data-testid="view-table">Tableau</button>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={hideNP} onChange={(e) => setHideNP(e.target.checked)} />
                  <span className="switch-ui" aria-hidden="true" />
                  <span>Masquer les « non publié »</span>
                </label>
              </div>
            </div>
            <p className="count" data-testid="count">
              {banks.length} établissement{banks.length > 1 ? 's' : ''} · <b>{counts.found || 0}</b> données sourcées · {counts.not_published || 0} non publiées
              {cur === 'EUR' && ' · montants des grilles en XPF, conversion indicative en €'}
            </p>
            {view === 'cards'
              ? <Cards banks={banks} fields={fields} sortField={sortField} hideNP={hideNP} cur={cur} best={best} amounts={amounts} />
              : <Table banks={banks} fields={fields} hideNP={hideNP} cur={cur} amounts={amounts} />}
            {sortField?.costFor && <p className="hint" data-testid="cost-hint">Classement par frais de dossier : coût réel pour le montant saisi, soit max(% × montant, minimum) selon chaque grille ; une banque au minimum bas n’est pas forcément la moins chère pour un gros prêt.</p>}
            </>)}
            <MarketPanel ids={MARKET_BY_CAT[tab]} />
          </section>
        ) : isView ? (
          <Suspense fallback={<Loading />}>
            {reperes ? <Reperes reperes={reperes} renderCatalog={(id) => (loaded?.catalog.id === id ? finderFor(loaded) : <Loading />)} /> : <Loading />}
          </Suspense>
        ) : (
          <Suspense fallback={<Loading />}><Simulator cur={cur} /></Suspense>
        )}
        </div>

        <section className="method" aria-labelledby="method-titre">
          <h2 id="method-titre">Méthode & limites</h2>
          <ul>
            {data.meta.notes.map((n) => <li key={n}>{n}</li>)}
            <li>Chaque valeur renvoie à son document (survol du lien : citation exacte). Un script vérifie que chaque citation figure bien dans la copie texte du document.</li>
            <li>Les taux de crédit réellement accordés dépendent du dossier : les banques polynésiennes publient très peu de taux. Repère : taux moyen habitat IEOM {m.ieom_habitat.value}.</li>
            {data.meta.otherInstitutions.map((o) => <li key={o.name}><b>{o.name}</b> ({o.type}) : {o.note}</li>)}
            <li>Banque de Tahiti : {bankById.bt.description}</li>
          </ul>
        </section>
        <Sources />
      </main>

      <footer className="foot">
        <Tapa />
        <p>Édition du <b>{fmtDate(data.meta.updated)}</b> · dernière vérification des sources : <b>{fmtDate(data.meta.verified)}</b>. Outil indépendant et indicatif, sans lien avec les établissements cités. Un crédit vous engage et doit être remboursé.</p>
      </footer>
    </div>
  );
}
