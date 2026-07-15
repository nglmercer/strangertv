import { Component, type ComponentChildren } from 'preact'

type Props = { children: ComponentChildren }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('App crash', error)
  }

  render() {
    if (this.state.error) {
      return (
        <main class="crash">
          <h1>Something went wrong</h1>
          <p>{this.state.error.message || 'Unexpected error'}</p>
          <button type="button" class="match" onClick={() => location.reload()}>
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
