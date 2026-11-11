import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './auth';
import { Loading } from './ui';
import { AuthPage } from './screens/AuthPage';
import { Shell } from './screens/Shell';
import { Home } from './screens/Home';
import { SpaceLayout, SpaceHome } from './screens/Space';
import { SpaceSettings, SpaceTemplatesSettings } from './screens/SpaceSettings';
import { AdminUsers } from './screens/AdminUsers';
import { NotFound } from './screens/NotFound';
import { SearchScreen } from './screens/SearchScreen';
import { AskScreen } from './screens/AskScreen';
import { TrashScreen } from './screens/Trash';
import { MyTasksScreen } from './screens/MyTasks';

// The page screen brings the editor (Tiptap, ProseMirror, code highlighting),
// which is most of the app's code. Loading it only when a page is opened keeps
// sign-in, home, search, settings and ask quick to start.
const loadPageScreen = () => import('./screens/PageScreen');
// When the app starts on a page's own address (a shared link, a reload), the
// editor is needed first thing: start fetching it now, while the sign-in check
// and the space load, instead of after them. The same import() is reused by
// the lazy screen below, so it is fetched once. A failure here is ignored; the
// lazy screen tries again and shows the error the usual way.
if (/^\/s\/[^/]+\/p\/[^/]+/.test(window.location.pathname)) loadPageScreen().catch(() => {});
const PageScreen = lazy(() => loadPageScreen().then((m) => ({ default: m.PageScreen })));

export function App() {
  const { user } = useMe();
  const location = useLocation();
  // Once someone is signed in, opening a page is the next thing they are
  // most likely to do: fetch the editor while the browser is idle, so the
  // first page they open does not wait for it.
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn) return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void loadPageScreen().catch(() => {}));
    return () => cancel(id);
  }, [signedIn]);
  if (user === undefined) return <Loading />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/search" element={<SearchScreen />} />
        <Route path="/ask" element={<AskScreen />} />
        <Route path="/tasks" element={<MyTasksScreen />} />
        <Route path="/s/:key" element={<SpaceLayout />}>
          <Route index element={<SpaceHome />} />
          <Route
            path="p/:pageId"
            element={
              <Suspense fallback={<Loading />}>
                <PageScreen />
              </Suspense>
            }
          />
          <Route path="settings" element={<SpaceSettings />} />
          <Route path="settings/templates" element={<SpaceTemplatesSettings />} />
          <Route path="trash" element={<TrashScreen />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
