import { Link } from 'react-router-dom';

export function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <div className="empty">
      <h1 className="empty-title">Nothing here</h1>
      <p className="muted">This {what} does not exist, or you do not have access to it.</p>
      <Link className="btn btn-quiet" to="/">
        Back to spaces
      </Link>
    </div>
  );
}
