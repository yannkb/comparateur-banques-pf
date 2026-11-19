import { data, fmtDate, sourceOf } from './lib/data.js';

export function SourceChip({ id, quote, prefix = '' }) {
  const s = sourceOf(id);
  if (!s) return null;
  const date = fmtDate(s.documentDate);
  const title = `${s.publisher} — ${s.title} (${s.dateLabel}). Consulté le ${fmtDate(s.accessed)}.${quote ? `\nCitation : « ${quote} »` : ''}`;
  return (
    <a className="src" href={s.url} target="_blank" rel="noopener noreferrer" title={title}>
      <span aria-hidden="true">↗</span>
      <span className="src-pub">{prefix}{s.short}</span>
      <span className="src-date">{date || `vu ${fmtDate(s.accessed)}`}</span>
      <span className="visually-hidden">{title}</span>
    </a>
  );
}

/** Étiquette « source secondaire » (paramètre non tiré d'un texte officiel). */
export function SecondaryTag({ detail }) {
  const text = typeof detail === 'string' ? detail : 'source secondaire, à confirmer par un notaire';
  const label = /notaire/.test(text) ? 'source secondaire, à confirmer par un notaire' : 'source secondaire';
  return <span className="tag tag-secondary" title={text} data-testid="tag-secondary">{label}</span>;
}

export function MarketPanel({ ids, title = 'Repères du marché' }) {
  if (!ids.length) return null;
  return (
    <aside className="market" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {ids.map((id) => {
          const m = data.market[id];
          return (
            <li key={id}>
              <span className="m-label">{m.label}</span>
              {m.status === 'found' ? <span className="m-value">{m.value}</span> : <span className="m-value np-label">Non publié</span>}
              {m.secondary && <SecondaryTag detail={m.secondary} />}
              {m.note && <span className="note">{m.note}</span>}
              <span className="srcs">
                {m.status === 'found'
                  ? [<SourceChip key="s" id={m.source} quote={m.quote} />, ...(m.extra || []).filter((x) => x.source !== m.source).map((x, i) => <SourceChip key={i} id={x.source} quote={x.quote} />)]
                  : m.checked.map((c) => <SourceChip key={c} id={c} />)}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
