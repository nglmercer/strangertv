import { lazy, Suspense } from 'preact/compat'
import { render } from 'preact'
import { Router } from 'preact-router'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ADMIN_HASH, ADMIN_PATH } from '../shared/constants'
import './style.css'

// Route-level code splitting: the admin console and profile pages download
// only when visited, never on the main call route.
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const ProfileEditPage = lazy(() =>
  import('./pages/ProfileEditPage').then((m) => ({ default: m.ProfileEditPage })),
)

const isAdmin =
  location.pathname === ADMIN_PATH ||
  location.pathname.startsWith(`${ADMIN_PATH}/`) ||
  location.hash === ADMIN_HASH

const isActivity = location.pathname.startsWith('/activities/')

if (isActivity) {
  // Dynamic import keeps the game shell out of the admin check below and
  // makes the branch obvious in the bundle graph.
  void import('./activities/ActivityGame').then(({ ActivityGame }) => {
    render(
      <ErrorBoundary><ActivityGame /></ErrorBoundary>,
      document.getElementById('root')!,
    )
  })
} else if (isAdmin) {
  render(
    <ErrorBoundary>
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    </ErrorBoundary>,
    document.getElementById('root')!,
  )
} else {
  render(
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Router>
          <App path="/" />
          <App path="/social" />
          <ProfilePage path="/u/:handle" />
          <ProfileEditPage path="/u/:handle/edit" />
        </Router>
      </Suspense>
    </ErrorBoundary>,
    document.getElementById('root')!,
  )
}
