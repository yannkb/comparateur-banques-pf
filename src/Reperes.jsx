import { Fragment } from 'react';
import { data, fmtDate, sourceOf } from './lib/data.js';
import { SecondaryTag, SourceChip } from './common.jsx';

// Onglet « Repères officiels » : sections déclarées dans data.reperes (tableaux sourcés cellule par cellule,
// listes de règles, catalogues filtrables rendus par le moteur générique). Aucun chiffre en dur ici.

const slug = (s) => `rep-${s}`;
const tooltip = (e) => {
  const s = sourceOf(e.source);
  return s ? `${s.publisher} — ${s.title} (${s.dateLabel}).\nCitation : « ${e.quote} »` : '';
};

/** Valeur d'une cellule : lien vers le document, citation au survol, source lisible par les lecteurs d'écran. */
function Cell({ e, strong }) {
  if (!e) return <span className="cell-none" title="Période non couverte par les publications reprises">—</span>;
  if (e.status !== 'found') return <span className="np-label">Non publié</span>;
  const s = sourceOf(e.source);
  return (
    <a className={`cell-src${strong ? ' strong' : ''}`} href={s.url} target="_blank" rel="noopener noreferrer" title={tooltip(e)}>
      {e.value}
      <span className="visually-hidden"> (source : {s.short}, {s.dateLabel})</span>
    </a>
  );
}

function SourcedTable({ id, t }) {
  const groups = [];
  for (const r of t.rows) {
    const g = groups.find((x) => x.name === (r.group || ''));
    if (g) g.rows.push(r); else groups.push({ name: r.group || '', rows: [r] });
  }
  const last = t.columns.at(-1).id;
  return (
    <section className="rep-block" aria-labelledby={slug(id)} data-testid={`rep-${id}`}>
      <h2 id={slug(id)} className="rep-title">{t.title}</h2>
      {t.intro && <p className="hint rep-intro">{t.intro}</p>}
      <div className="table-wrap" role="region" aria-label={`Tableau défilant : ${t.title}`} tabIndex={0}>
        <table className="rep-table">
          <thead>
            <tr>
              <th scope="col">{t.unit === '%' ? 'Taux (%)' : 'Montant'}</th>
              {t.columns.map((c) => <th key={c.id} scope="col">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {g.name && groups.length > 1 && <tr className="rep-group"><th scope="colgroup" colSpan={t.columns.length + 1}>{g.name}</th></tr>}
                {g.rows.map((r) => (
                  <tr key={r.id} data-testid={`rep-row-${r.id}`}>
                    <th scope="row">{r.label}</th>
                    {t.columns.map((c) => <td key={c.id}><Cell e={r.cells[c.id]} strong={c.id === last} /></td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="srcs rep-srcs">
        Sources :{' '}
        {t.headers.map((h) => <SourceChip key={h.source} id={h.source} quote={h.quote} />)}
      </p>
      {(t.apply || []).length > 0 && (
        <ul className="rep-apply">
          {t.apply.map((e, i) => <li key={i}>{e.value} <SourceChip id={e.source} quote={e.quote} /></li>)}
        </ul>
      )}
      {(t.notes || []).length > 0 && <ul className="finder-notes">{t.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </section>
  );
}

function Rules({ s }) {
  return (
    <section className="rep-block" aria-labelledby={slug(s.id)} data-testid={`rep-${s.id}`}>
      <h2 id={slug(s.id)} className="rep-title">{s.title}</h2>
      {s.intro && <p className="hint rep-intro">{s.intro}</p>}
      <dl className="rules">
        {s.items.map((it) => (
          <div key={it.id} className="rule" data-testid={`rule-${it.id}`}>
            <dt>{it.label}</dt>
            <dd>
              {it.status === 'found' ? <p className="rule-value">{it.value}</p> : <p className="np-label">Non publié</p>}
              {it.secondary && <SecondaryTag detail={it.secondary} />}
              {it.note && <p className="note">{it.note}</p>}
              <p className="srcs">
                {it.status === 'found'
                  ? [<SourceChip key="s" id={it.source} quote={it.quote} />, ...(it.extra || []).map((x, i) => <SourceChip key={i} id={x.source} quote={x.quote} />)]
                  : it.checked.map((c) => <SourceChip key={c} id={c} />)}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function Reperes({ renderCatalog }) {
  const r = data.reperes;
  return (
    <section className="reperes" aria-labelledby="reperes-titre" data-testid="reperes">
      <h2 id="reperes-titre" className="finder-title">{r.title}</h2>
      <p className="hint rep-lede">{r.intro} Données vérifiées le {fmtDate(data.meta.verified)}.</p>
      <nav className="rep-toc" aria-label="Sommaire des repères">
        {r.sections.map((s) => {
          const title = s.kind === 'table' ? s.table.title : s.kind === 'rules' ? s.title : data.catalogs.find((c) => c.id === s.catalog)?.label;
          return <a key={s.id} href={`#${s.kind === 'catalog' ? `finder-${s.catalog}-titre` : slug(s.kind === 'table' ? s.table.id : s.id)}`}>{title}</a>;
        })}
      </nav>
      {r.sections.map((s) => (
        s.kind === 'table' ? <SourcedTable key={s.id} id={s.table.id} t={s.table} />
          : s.kind === 'rules' ? <Rules key={s.id} s={s} />
            : <div key={s.id} className="rep-block">{renderCatalog(s.catalog)}</div>
      ))}
    </section>
  );
}
