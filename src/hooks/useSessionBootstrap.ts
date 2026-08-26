import { useEffect, useState } from 'preact/hooks'
import {
  authApi,
  clearSession,
  fetchHealth,
  fetchIceServers,
  getToken,
  setAuthenticatedUser,
  setSession,
  type PublicUser,
} from '../api'
import { detectLocale, t as translate } from '../i18n'
import { TIMING_MS, URL_PARAM } from '../../shared/constants'
import type { MatchPreferences } from '../../shared/types'
import { readSharedPrefs, sanitizeSharedPrefs } from '../utils/sharePrefs'

type Options = {
  setUser: (u: PublicUser | null) => void
  setAuth: (v: boolean) => void
  setResetToken: (t: string) => void
  setGoogleSignupToken: (t: string) => void
  setStatus: (s: string) => void
  setOnline: (n: number) => void
  setWaitingCount: (n: number) => void
}

/** One-time boot: deep links, session refresh, health poll, ICE warm-up. */
export function useSessionBootstrap({
  setUser,
  setAuth,
  setResetToken,
  setGoogleSignupToken,
  setStatus,
  setOnline,
  setWaitingCount,
}: Options) {
  const [appVersion, setAppVersion] = useState('')
  const [sharedPrefs, setSharedPrefs] = useState<Partial<MatchPreferences> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const reset = params.get(URL_PARAM.reset)
    if (reset) {
      setResetToken(reset)
      setAuth(true)
      history.replaceState({}, '', location.pathname)
    }
    // Coming back from a provider redirect. `ok` needs no work: the session
    // cookie is already set and the `me()` call below picks it up.
    const oauth = params.get(URL_PARAM.oauth)
    if (oauth) {
      const messages = translate(detectLocale())
      if (oauth === 'signup') {
        const pending = params.get(URL_PARAM.oauthToken)
        if (pending) {
          setGoogleSignupToken(pending)
          setAuth(true)
        }
      } else if (oauth === 'cancelled') {
        setStatus(messages.googleSignInCancelled)
      } else if (oauth === 'error') {
        setStatus(messages.googleSignInFailed)
      }
      // Drop the token from the address bar before anything can leak it into
      // a referrer or the history entry the user shares.
      history.replaceState({}, '', location.pathname)
    }
    const verify = params.get(URL_PARAM.verify)
    if (verify) {
      void authApi
        .verifyEmail(verify)
        .then(() => {
          setStatus(translate(detectLocale()).emailVerified)
          history.replaceState({}, '', location.pathname)
          if (getToken()) {
            void authApi
              .me()
              .then((r) => setUser(r.user))
              .catch(() => undefined)
          }
        })
        .catch(() => setStatus(translate(detectLocale()).emailVerifyFailed))
    }
    const raw = readSharedPrefs()
    if (raw) {
      const cleaned = sanitizeSharedPrefs(raw)
      if (cleaned) setSharedPrefs(cleaned)
      history.replaceState({}, '', location.pathname)
    }

    void authApi
      .me()
      .then((r) => {
        if (!getToken()) setAuthenticatedUser(r.user)
        setUser(r.user)
      })
      .catch(() => {
        if (!getToken()) {
          setUser(null)
          return
        }
        void authApi
          .refresh()
          .then((r) => {
            setSession(r.token, r.user)
            setUser(r.user)
          })
          .catch(() => {
            clearSession()
            setUser(null)
          })
      })

    void fetchHealth().then((h) => {
      if (h.ok) {
        setOnline(h.online)
        setWaitingCount(h.waiting)
        if (h.version) setAppVersion(h.version)
      }
    })
    void fetchIceServers().catch(() => undefined)

    const iv = window.setInterval(() => {
      void fetchHealth().then((h) => {
        if (h.ok) {
          setOnline(h.online)
          setWaitingCount(h.waiting)
        }
      })
    }, TIMING_MS.healthPollClient)
    return () => clearInterval(iv)
  }, [
    setUser,
    setAuth,
    setResetToken,
    setGoogleSignupToken,
    setStatus,
    setOnline,
    setWaitingCount,
  ])

  return { appVersion, sharedPrefs }
}
