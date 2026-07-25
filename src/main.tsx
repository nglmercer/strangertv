import { render } from 'preact'
import { Router } from 'preact-router'
import { App } from './App'
import { AdminApp } from './admin/AdminApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ADMIN_HASH, ADMIN_PATH } from '../shared/constants'
import './style.css'
import './admin.css'

const isAdmin =
  location.pathname === ADMIN_PATH ||
  location.pathname.startsWith(`${ADMIN_PATH}/`) ||
  location.hash === ADMIN_HASH

if (isAdmin) {
  render(
    <ErrorBoundary><AdminApp /></ErrorBoundary>,
    document.getElementById('root')!,
  )
} else {
  render(
    <ErrorBoundary>
      <Router>
        <App path="/" />
      </Router>
    </ErrorBoundary>,
    document.getElementById('root')!,
  )
}
