import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './auth';
import { Loading } from './ui';
import { AuthPage } from './screens/AuthPage';
import { Shell } from './screens/Shell';
import { Home } from './screens/Home';
import { SpaceLayout, SpaceHome } from './screens/Space';
import { SpaceSettings } from './screens/SpaceSettings';
import { AdminUsers } from './screens/AdminUsers';
import { NotFound } from './screens/NotFound';
import { SearchScreen } from './screens/SearchScreen';
import { AskScreen } from './screens/AskScreen';

// The page screen brings the editor (Tiptap, ProseMirror, code highlighting),
// which is most of the app's code. Loading it only when a page is opened keeps
// sign-in, home, search, settings and ask quick to start.
const PageScreen = lazy(() => import('./screens/PageScreen').then((m) => ({ default: m.PageScreen })));

export function App() {
  const { user } = useMe();
  const location = useLocation();
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
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
