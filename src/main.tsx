import { render } from 'preact'
import { App } from './App'
import { AdminApp } from './admin/AdminApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import './style.css'
import './admin.css'

const isAdmin =
  location.pathname === '/admin' ||
  location.pathname.startsWith('/admin/') ||
  location.hash === '#admin'

render(
  <ErrorBoundary>{isAdmin ? <AdminApp /> : <App />}</ErrorBoundary>,
  document.getElementById('root')!,
)
