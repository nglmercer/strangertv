import { useEffect, useRef, useState } from 'preact/hooks'
import { formatMessage, type Messages } from '../../i18n'
import {
  createActivityGuest,
  exchangeLaunchCode,
  fetchActivityMe,
  type ActivityGuest,
  type ActivityPresenceUser,
} from '../client'
import { applyMove, emptyBoard, isGameUpdate, turnOf, winnerOf, type Board, type Mark } from './logic'

/**
 * Tic-tac-toe, the reference activity. It authenticates exactly like any
 * third-party game would: launch code → instance token → scoped identity,
 * all with `credentials: 'omit'`, then syncs moves through the host. First
 * seat plays X, second plays O; each side validates every move locally so
 * the two boards converge without a referee.
 */
export function TicTacToe({ t }: { t: Messages }) {
  const [me, setMe] = useState<{ id: number; name: string } | null>(null)
  const [roster, setRoster] = useState<ActivityPresenceUser[]>([])
  const [board, setBoard] = useState<Board>(emptyBoard)
  const [ended, setEnded] = useState(false)
  const [failed, setFailed] = useState(false)
  const guestRef = useRef<ActivityGuest | null>(null)

  const boardRef = useRef(board)
  boardRef.current = board
  const rosterRef = useRef(roster)
  rosterRef.current = roster
  const meRef = useRef(me)
  meRef.current = me

  useEffect(() => {
    const guest = createActivityGuest()
    guestRef.current = guest

    /** Seat order decides marks: first joined plays X. */
    const markOf = (userId: number): Mark | null => {
      const seats = rosterRef.current
      if (seats[0]?.userId === userId) return 'X'
      if (seats[1]?.userId === userId) return 'O'
      return null
    }

    // The first `ready` can predate the host's listener (effects flush
    // after paint, the iframe boots on its own clock), so retry until the
    // first init lands. First init wins; later ones are answers to retries
    // already in flight, and their codes stay valid anyway.
    let gotInit = false
    const retry = window.setInterval(() => {
      if (!gotInit) guest.ready()
    }, 400)
    const offInit = guest.onInit(({ code, instanceId }) => {
      if (gotInit) return
      gotInit = true
      window.clearInterval(retry)
      exchangeLaunchCode(instanceId, code)
        .then(({ token }) => fetchActivityMe(token))
        .then(({ user }) =>
          setMe({ id: user.id, name: user.displayName || user.username || `Player ${user.id}` }),
        )
        .catch(() => setFailed(true))
    })
    const offPresence = guest.onPresence(setRoster)
    const offState = guest.onState((userId, state) => {
      if (!isGameUpdate(state)) return
      // Own echo: the move is already on the board.
      if (meRef.current && userId === meRef.current.id && 'move' in state) return
      if ('reset' in state) {
        if (winnerOf(boardRef.current)) setBoard(emptyBoard())
        return
      }
      const mark = markOf(userId)
      if (!mark) return
      const next = applyMove(boardRef.current, state.move, mark)
      if (next) setBoard(next)
    })
    const offEnded = guest.onEnded(() => setEnded(true))
    guest.ready()
    return () => {
      window.clearInterval(retry)
      offInit()
      offPresence()
      offState()
      offEnded()
      guest.dispose()
      guestRef.current = null
    }
  }, [])

  const myMark: Mark | null = me
    ? roster[0]?.userId === me.id
      ? 'X'
      : roster[1]?.userId === me.id
        ? 'O'
        : null
    : null
  const winner = winnerOf(board)
  const turn = turnOf(board)
  const myTurn = !winner && myMark !== null && myMark === turn

  const nameOf = (userId: number) =>
    roster.find((p) => p.userId === userId)?.name ?? (me?.id === userId ? me.name : `#${userId}`)

  const status = !me || roster.length < 2
    ? t.waitingForPlayers
    : winner === 'draw'
      ? t.gameDraw
      : winner
        ? formatMessage(t.gameWin, {
            name: nameOf(winner === 'X' ? (roster[0]?.userId ?? 0) : (roster[1]?.userId ?? 0)),
          })
        : myTurn
          ? `${t.yourTurn} (${myMark})`
          : formatMessage(t.waitingTurn, {
              name: nameOf(turn === 'X' ? (roster[0]?.userId ?? 0) : (roster[1]?.userId ?? 0)),
            })

  const play = (index: number) => {
    if (!me || !myTurn || board[index] || winner) return
    const next = applyMove(board, index, myMark!)
    if (!next) return
    setBoard(next)
    guestRef.current?.publish({ move: index, by: me.id })
  }

  const playAgain = () => {
    if (!me || !winner) return
    setBoard(emptyBoard())
    guestRef.current?.publish({ reset: true, by: me.id })
  }

  return (
    <div class="activity-game">
      <header class="activity-game-top">
        <h1>Tic-Tac-Toe</h1>
        <button type="button" class="social-btn" onClick={() => guestRef.current?.leave()}>
          {t.leaveGame}
        </button>
      </header>

      <p class="activity-game-status" aria-live="polite">{status}</p>
      {me && myMark && <p class="people-note">{formatMessage(t.youPlayMark, { mark: myMark })}</p>}

      {failed && <p class="people-note error">{t.genericError}</p>}

      <div class="activity-board" role="grid" aria-label="Tic-Tac-Toe">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            role="gridcell"
            class={`activity-cell ${cell ? `mark-${cell.toLowerCase()}` : ''}`}
            disabled={!myTurn || !!cell || !!winner || ended}
            onClick={() => play(i)}
            aria-label={cell ?? `empty ${i + 1}`}
          >
            {cell ?? ''}
          </button>
        ))}
      </div>

      {winner && !ended && (
        <button type="button" class="social-btn accent" onClick={playAgain}>
          {t.gamePlayAgain}
        </button>
      )}
      {ended && <p class="people-note">{t.gameEndedHint}</p>}
    </div>
  )
}
