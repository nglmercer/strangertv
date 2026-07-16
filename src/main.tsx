import { render } from 'preact'
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

render(
  <ErrorBoundary>{isAdmin ? <AdminApp /> : <App />}</ErrorBoundary>,
  document.getElementById('root')!,
)
