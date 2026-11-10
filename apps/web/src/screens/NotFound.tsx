import { Link } from 'react-router-dom';

/** `trashLink`: the page is in the trash and this person may open the Trash view (editors and up). */
export function NotFound({ what = 'page', trashLink }: { what?: string; trashLink?: string }) {
  return (
    <div className="empty">
      <h1 className="empty-title">Nothing here</h1>
      <p className="muted">This {what} does not exist, or you do not have access to it.</p>
      {trashLink && (
        <p className="muted">
          This page is in the trash. <Link to={trashLink}>Open the trash</Link> to restore it.
        </p>
      )}
      <Link className="btn btn-quiet" to="/">
        Back to spaces
      </Link>
    </div>
  );
}
