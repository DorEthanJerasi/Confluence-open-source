// The two "pages with this label" views (docs/done-checks/13-labels.md, 13b):
// one space at /s/:key/labels/:name and the whole wiki at /labels/:name.
// Both list only live pages the person can see (the server filters them),
// newest change first, each with its other labels.
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Tag } from 'lucide-react';
import { LABEL_VIEW_LIMIT, normaliseLabel, type LabelView } from '@stillwater/shared';
import { api } from '../api';
import { timeAgo } from '../time';
import { pageTitle } from '../tree';
import { ErrorNote, Loading } from '../ui';
import { useSpace } from '../screens/Space';
import { labelsKey, searchPath, wikiLabelPath } from './labels';

function LabelPages(props: { view: LabelView; name: string; showSpace: boolean }) {
  const { view, name } = props;
  if (view.pages.length === 0) {
    return (
      <div className="empty fade-in">
        <p className="empty-title">No pages here</p>
        <p className="muted">No page you can see has the label “{name}”.</p>
      </div>
    );
  }
  return (
    <>
      <ul className="label-pages" aria-label={`Pages with the label ${name}`}>
        {view.pages.map((p) => {
          const others = p.labels.filter((l) => l.name !== name);
          return (
            <li key={p.id}>
              <Link to={`/s/${encodeURIComponent(p.space.key)}/p/${encodeURIComponent(p.id)}`} className="label-page">
                <span className="label-page-title">
                  <FileText size={16} className="faint" aria-hidden="true" />
                  {pageTitle(p.title)}
                </span>
                <span className="label-page-meta">
                  {props.showSpace && <span className="label-page-space">{p.space.name}</span>}
                  <span>Changed {timeAgo(p.updatedAt)}</span>
                </span>
                {others.length > 0 && (
                  <span className="label-page-labels">
                    <span className="sr-only">Other labels:</span>
                    {others.map((l) => (
                      <span key={l.id} className="label-tag">
                        {l.name}
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {view.truncated && (
        <p className="muted small label-truncated">
          Showing the {LABEL_VIEW_LIMIT} most recently changed pages. There are more with this label.
        </p>
      )}
    </>
  );
}

function LabelHeading(props: { name: string; where: string; links: ReactNode }) {
  return (
    <div className="page-head page-head-top">
      <div className="grow">
        <p className="label-kicker muted">
          <Tag size={14} aria-hidden="true" /> Label
        </p>
        <h1 className="page-title">{props.name}</h1>
        <p className="muted meta">{props.where}</p>
      </div>
      <div className="row">{props.links}</div>
    </div>
  );
}

const shownName = (raw: string) => normaliseLabel(raw) ?? raw;

/** /s/:key/labels/:name — the pages of one space with this label. */
export function SpaceLabelScreen() {
  const { space } = useSpace();
  const { name: raw = '' } = useParams();
  const name = shownName(raw);
  const view = useQuery({
    queryKey: [...labelsKey, 'space', space.key, name],
    queryFn: () => api.spaceLabelView(space.key, name),
  });
  return (
    <main className="content fade-in" key={name}>
      <nav className="crumbs" aria-label="Breadcrumbs">
        <Link to={`/s/${space.key}`}>{space.name}</Link>
      </nav>
      <LabelHeading
        name={name}
        where={`Pages in ${space.name} with this label`}
        links={
          <>
            <Link to={wikiLabelPath(name)} className="btn btn-quiet">
              In all spaces
            </Link>
            <Link to={searchPath(`label:${name}`)} className="btn btn-quiet">
              Search with it
            </Link>
          </>
        }
      />
      {view.isPending ? <Loading /> : view.error ? <ErrorNote error={view.error} /> : <LabelPages view={view.data} name={name} showSpace={false} />}
    </main>
  );
}

/** /labels/:name — the pages with this label in every space the person can see. */
export function WikiLabelScreen() {
  const { name: raw = '' } = useParams();
  const name = shownName(raw);
  const view = useQuery({ queryKey: [...labelsKey, 'wiki', name], queryFn: () => api.labelView(name) });
  return (
    <main className="content fade-in" key={name}>
      <LabelHeading
        name={name}
        where="Pages in all spaces you can see with this label"
        links={
          <Link to={searchPath(`label:${name}`)} className="btn btn-quiet">
            Search with it
          </Link>
        }
      />
      {view.isPending ? <Loading /> : view.error ? <ErrorNote error={view.error} /> : <LabelPages view={view.data} name={name} showSpace />}
    </main>
  );
}
