// The /search?q=… results page (docs/done-checks/03-search-history.md, 3a).
// The query lives in the URL, so reload and back work. Snippets arrive as
// plain text with hit markers; splitSnippet turns them into text parts and
// the hits go inside <mark>. Nothing here is ever inserted as raw HTML.
import { Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { splitSnippet, type SearchResult } from '@stillwater/shared';
import { api } from '../api';
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

function Result({ r }: { r: SearchResult }) {
  return (
    <li>
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
    </li>
  );
}

export function SearchScreen() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q !== '',
  });

  return (
    <main className="content fade-in">
      <div className="page-head page-head-top">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="muted">
            {q ? (
              <>
                Pages that match <span className="search-term">“{q}”</span>
              </>
            ) : (
              'Type in the search field above and press Enter.'
            )}
          </p>
        </div>
      </div>
      {!q ? null : search.isPending ? (
        <Loading />
      ) : search.error ? (
        <ErrorNote error={search.error} />
      ) : search.data.results.length === 0 ? (
        <div className="empty fade-in">
          <p className="empty-title">No results</p>
          <p className="muted">Nothing you can see matches that yet. Try fewer or different words.</p>
        </div>
      ) : (
        <ul className="results" aria-label="Search results" key={q}>
          {search.data.results.map((r) => (
            <Result key={r.pageId} r={r} />
          ))}
        </ul>
      )}
    </main>
  );
}
