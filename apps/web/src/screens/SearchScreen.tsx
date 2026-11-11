// The /search?q=… results page (docs/done-checks/03-search-history.md, 3a).
// The query lives in the URL, so reload and back work. Snippets arrive as
// plain text with hit markers; splitSnippet turns them into text parts and
// the hits go inside <mark>. Nothing here is ever inserted as raw HTML.
// `label:name` words in the query are the label filter (done-check 13): the
// server reads them, and this screen shows them as removable chips. A label
// on a result adds it to the filter.
import { Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tag, X } from 'lucide-react';
import { splitSnippet, type SearchResult } from '@stillwater/shared';
import { api } from '../api';
import { joinQuery, searchPath, splitQuery } from '../labels/labels';
import { ErrorNote, Loading } from '../ui';

function Snippet({ text }: { text: string }) {
  return (
    <p className="result-snippet">
      {splitSnippet(text).map((part, i) =>
        part.hit ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </p>
  );
}

function Result({ r, active, onLabel }: { r: SearchResult; active: string[]; onLabel: (name: string) => void }) {
  return (
    <li className="result-item">
      <Link to={`/s/${encodeURIComponent(r.spaceKey)}/p/${encodeURIComponent(r.pageId)}`} className="result">
        <span className="result-title">{r.title || 'Untitled'}</span>
        <span className="result-where">
          <span className="result-space">{r.spaceName}</span>
          {r.breadcrumbs.map((c) => (
            <span key={c.id} className="result-crumb">
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
              {c.title || 'Untitled'}
            </span>
          ))}
        </span>
        {r.snippet && <Snippet text={r.snippet} />}
      </Link>
      {r.labels.length > 0 && (
        <ul className="result-labels" aria-label={`Labels of ${r.title || 'Untitled'}`}>
          {r.labels.map((l) => {
            const on = active.includes(l.name);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  className={`label-tag label-tag-btn${on ? ' is-on' : ''}`}
                  onClick={() => onLabel(l.name)}
                  disabled={on}
                  title={on ? 'Already in the filter' : `Only show pages with the label ${l.name}`}
                >
                  {l.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function SearchScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = (params.get('q') ?? '').trim();
  const { text, labels } = splitQuery(q);
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q !== '',
  });
  const go = (nextLabels: string[]) => {
    const next = joinQuery(text, nextLabels);
    navigate(next ? searchPath(next) : '/search');
  };

  return (
    <main className="content fade-in">
      <div className="page-head page-head-top">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="muted">
            {text ? (
              <>
                Pages that match <span className="search-term">“{text}”</span>
                {labels.length > 0 && (labels.length === 1 ? ' with this label' : ' with all these labels')}
              </>
            ) : labels.length > 0 ? (
              labels.length === 1 ? (
                'Pages with this label, last changed first'
              ) : (
                'Pages with all these labels, last changed first'
              )
            ) : (
              <>
                Type in the search field above and press Enter. Add <span className="search-term">label:name</span> to
                filter by a label.
              </>
            )}
          </p>
          {labels.length > 0 && (
            <ul className="label-list search-labels" aria-label="Label filter">
              {labels.map((name) => (
                <li key={name} className="label-chip">
                  <span className="label-chip-link">
                    <Tag size={12} aria-hidden="true" className="label-chip-icon" />
                    {name}
                  </span>
                  <button
                    type="button"
                    className="label-chip-remove"
                    aria-label={`Remove label filter ${name}`}
                    title={`Remove label filter ${name}`}
                    onClick={() => go(labels.filter((l) => l !== name))}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!q ? null : search.isPending ? (
        <Loading />
      ) : search.error ? (
        <ErrorNote error={search.error} />
      ) : search.data.results.length === 0 ? (
        <div className="empty fade-in">
          <p className="empty-title">No results</p>
          <p className="muted">
            {labels.length > 0
              ? 'No page you can see matches that yet. Try fewer words or labels.'
              : 'Nothing you can see matches that yet. Try fewer or different words.'}
          </p>
        </div>
      ) : (
        <ul className="results" aria-label="Search results" key={q}>
          {search.data.results.map((r) => (
            <Result key={r.pageId} r={r} active={labels} onLabel={(name) => !labels.includes(name) && go([...labels, name])} />
          ))}
        </ul>
      )}
    </main>
  );
}
