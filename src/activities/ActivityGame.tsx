import { useState } from 'preact/hooks'
import { detectLocale, t } from '../i18n'
import { TicTacToe } from './tictactoe/TicTacToe'

/**
 * What the activity iframe loads. The same bundle serves the host app and
 * the games (the server falls back to index.html for `/activities/<slug>`);
 * `main.tsx` renders this shell instead of the app when the path matches, so
 * games share the SDK and styles with zero build changes.
 */
export function ActivityGame() {
  const [messages] = useState(() => t(detectLocale()))
  const slug = location.pathname.split('/')[2] ?? ''

  if (slug === 'tictactoe') {
    return <TicTacToe t={messages} />
  }
  return (
    <div class="activity-game">
      <p class="people-note">{messages.noActivities}</p>
    </div>
  )
}
