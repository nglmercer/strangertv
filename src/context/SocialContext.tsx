import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { PublicUser } from '../api'
import type { useMatchSocket } from '../hooks/useMatchSocket'
import type { Messages } from '../i18n'

type MatchSocket = ReturnType<typeof useMatchSocket>

interface SocialContextValue {
  user: PublicUser | null
  currentUserId: number | null
  match: MatchSocket | null
  t: Messages
  onSignIn: () => void
}

export const SocialContext = createContext<SocialContextValue | null>(null)

export function useSocialContext() {
  const ctx = useContext(SocialContext)
  if (!ctx) throw new Error('useSocialContext must be used within SocialContext.Provider')
  return ctx
}
