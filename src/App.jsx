import { useMemo, useState } from 'react';
import { data, fieldsOf, fmtDate, fmtNum, sourceOf, bankById } from './lib/data.js';
import Simulator from './Simulator.jsx';
import { SourceChip, MarketPanel } from './common.jsx';

const TABS = [...data.categories, { id: 'simu', label: 'Simulateur' }];
const DEFAULT_SORT = { immo: 'immo_frais_dossier', compte: 'cpt_tenue', epargne: 'ep_livret', conso: 'conso_frais_dossier' };
const MARKET_BY_CAT = {
  immo: ['ieom_habitat', 'usure_habitat', 'usure_relais', 'ptz_pays', 'ptz_plafonds', 'aim', 'lp2025_21_ira'],
  compte: ['ieom_decouvert'],
  epargne: [],
  conso: ['ieom_conso', 'usure_conso', 'lp2025_21_ira'],
};
const BEST_LABEL = { lower: 'Le plus bas', higher: 'Le plus élevé' };

function Entry({ e, field, cur }) {
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
      {e.stale && <span className="tag tag-stale">Exemple ancien</span>}
      {e.note && <p className="note">{e.note}</p>}
      <p className="srcs">
        <SourceChip id={e.source} quote={e.quote} />
        {(e.extra || []).filter((x) => x.source !== e.source).map((x, i) => <SourceChip key={i} id={x.source} quote={x.quote} />)}
      </p>
    </div>
  );
}

function bestBank(banks, field) {
  if (!field?.better) return null;
  const vals = banks.map((b) => [b.id, b.fields[field.id]]).filter(([, e]) => e?.status === 'found' && typeof e.num === 'number');
  if (vals.length < 2) return null;
  const sorted = [...vals].sort((a, b) => (field.better === 'lower' ? a[1].num - b[1].num : b[1].num - a[1].num));
  if (sorted[0][1].num === sorted[1][1].num) return null;
  return sorted[0][0];
}

function sortBanks(banks, field) {
  if (!field) return banks;
  const key = (b) => {
    const e = b.fields[field.id];
    return e?.status === 'found' && typeof e.num === 'number' ? e.num : null;
  };
  return [...banks].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return field.better === 'higher' ? kb - ka : ka - kb;
  });
}

function Cards({ banks, fields, sortField, hideNP, cur, best }) {
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
                <span className={`headline-value${head?.status !== 'found' ? ' muted' : ''}`}>
                  {head?.status === 'found' ? (fmtNum(head.num, sortField.unit, cur) ?? head.value) : 'Non publié'}
                </span>
              </div>
            )}
            <p className="coverage"><b>{found}</b>/{fields.length} rubriques documentées</p>
            <dl className="rows">
              {rows.map((f) => (
                <div key={f.id} className="row">
                  <dt>{f.label}</dt>
                  <dd><Entry e={b.fields[f.id]} field={f} cur={cur} /></dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function Table({ banks, fields, hideNP, cur }) {
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
            const best = bestBank(banks, f);
            return (
              <tr key={f.id}>
                <th scope="row">{f.label}{f.unit && <small>{f.unit}</small>}</th>
                {banks.map((b) => (
                  <td key={b.id} className={best === b.id ? 'is-best' : ''}>
                    {best === b.id && <span className="tag tag-best">{BEST_LABEL[f.better]}</span>}
                    <Entry e={b.fields[f.id]} field={f} cur={cur} />
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
      <h2 id="sources-titre">Sources <span>{Object.keys(data.sources).length} documents, consultés le {fmtDate(data.meta.updated)}</span></h2>
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
  const [tab, setTab] = useState('immo');
  const [cur, setCur] = useState('XPF');
  const [only, setOnly] = useState(null);
  const [view, setView] = useState('cards');
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);
  const [hideNP, setHideNP] = useState(false);

  const isData = tab !== 'simu';
  const fields = isData ? fieldsOf(tab) : [];
  const sortable = fields.filter((f) => f.better && data.banks.some((b) => typeof b.fields[f.id]?.num === 'number'));
  const sortField = sortable.find((f) => f.id === sortBy[tab]) || sortable[0];
  const banks = useMemo(() => {
    const list = data.banks.filter((b) => !only || b.id === only);
    return sortBanks(list, sortField);
  }, [only, sortField]);
  const best = bestBank(banks, sortField);
  const counts = banks.reduce((acc, b) => {
    fields.forEach((f) => { acc[b.fields[f.id]?.status] = (acc[b.fields[f.id]?.status] || 0) + 1; });
    return acc;
  }, {});
  const m = data.market;

  return (
    <div className="page">
      <div className="topbar">
        <p>Édition du <time dateTime={data.meta.updated}>{fmtDate(data.meta.updated)}</time> · données publiques, chaque chiffre sourcé</p>
        <div className="cur" role="group" aria-label="Devise">
          {['XPF', 'EUR'].map((c) => (
            <button key={c} className={cur === c ? 'on' : ''} aria-pressed={cur === c} onClick={() => setCur(c)} data-testid={`cur-${c}`}>
              {c === 'EUR' ? '€' : 'XPF'}
            </button>
          ))}
          <span className="parity">1 000 XPF = 8,38 €</span>
        </div>
      </div>

      <header className="hero">
        <div className="hero-text">
          <p className="kicker">Socredo · Banque de Tahiti · Banque de Polynésie · Marara (OPT)</p>
          <h1>
            <span className="h1-main">Comparez</span>
            <span className="h1-sub">les banques du Fenua</span>
          </h1>
          <p className="lede">Crédit immobilier, frais de compte, épargne et crédit à la consommation en Polynésie française : les grilles tarifaires 2026 mises côte à côte, avec leur source. Ce qui n’est pas publié est marqué comme tel.</p>
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
      </header>
      <Tapa />

      <nav className="tabs" role="tablist" aria-label="Rubriques">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {isData ? (
          <section className="offers" aria-label={TABS.find((t) => t.id === tab).label}>
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
              ? <Cards banks={banks} fields={fields} sortField={sortField} hideNP={hideNP} cur={cur} best={best} />
              : <Table banks={banks} fields={fields} hideNP={hideNP} cur={cur} />}
            <MarketPanel ids={MARKET_BY_CAT[tab]} />
          </section>
        ) : (
          <Simulator cur={cur} />
        )}

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
        <p>Dernière mise à jour des données : <b>{fmtDate(data.meta.updated)}</b>. Outil indépendant et indicatif, sans lien avec les établissements cités. Un crédit vous engage et doit être remboursé.</p>
      </footer>
    </div>
  );
}
