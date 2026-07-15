import { Component, type ComponentChildren } from 'preact'
import { detectLocale, t as translate } from '../i18n'

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
      const tr = translate(detectLocale())
      return (
        <main class="crash">
          <h1>{tr.errorCrashTitle}</h1>
          <p>{this.state.error.message || tr.errorUnexpected}</p>
          <button type="button" class="match" onClick={() => location.reload()}>
            {tr.reload}
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
