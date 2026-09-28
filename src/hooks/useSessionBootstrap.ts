import { useEffect, useState } from 'preact/hooks'
import {
  authApi,
  clearSession,
  fetchHealth,
  fetchIceServers,
  fetchPublicConfig,
  getToken,
  setSession,
  setStoredUser,
  type PublicUser,
} from '../api'
import { detectLocale, t as translate } from '../i18n'
import { TIMING_MS, URL_PARAM } from '../../shared/constants'
import type { MatchPreferences } from '../../shared/types'
import { readSharedPrefs, sanitizeSharedPrefs } from '../utils/sharePrefs'
import { waitForApi } from '../utils/waitForApi'

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
  /** Whether guests may queue. Null until the public config answers. */
  const [anonymousMatchEnabled, setAnonymousMatchEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
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
    const raw = readSharedPrefs()
    if (raw) {
      const cleaned = sanitizeSharedPrefs(raw)
      if (cleaned) setSharedPrefs(cleaned)
      history.replaceState({}, '', location.pathname)
    }

    // Boot requests wait for the API instead of failing while it is still
    // compiling or restarting (dev `cargo watch`, deploys). Without the gate
    // a page loaded in that window sticks in a logged-out state until the
    // user reloads. Past the deadline the calls run anyway and their normal
    // error handling applies.
    const boot = async () => {
      const health = await waitForApi(fetchHealth, {
        timeoutMs: TIMING_MS.apiBootWait,
        retryMs: TIMING_MS.apiBootRetry,
        isCancelled: () => cancelled,
      })
      if (!health) return

      if (verify) {
        void authApi
          .verifyEmail(verify)
          .then(() => {
            setStatus(translate(detectLocale()).emailVerified)
            history.replaceState({}, '', location.pathname)
            // Cookie sessions hold no bearer, so refresh unconditionally: the
            // call simply fails when nobody is signed in.
            void authApi
              .me()
              .then((r) => setUser(r.user))
              .catch(() => undefined)
          })
          .catch(() => setStatus(translate(detectLocale()).emailVerifyFailed))
      }

      void authApi
        .me()
        .then((r) => {
          // Persist the profile but keep any in-memory legacy bearer: in
          // legacy-only mode it is the sole credential and must survive.
          setStoredUser(r.user)
          setUser(r.user)
        })
        .catch(() => {
          if (!getToken()) {
            setUser(null)
            return
          }
          // Legacy compat path only: cookie sessions never hold a bearer, so a
          // present one means a legacy session worth attempting to refresh.
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

      if (health.ok) {
        setOnline(health.online)
        setWaitingCount(health.waiting)
        if (health.version) setAppVersion(health.version)
      }
      void fetchPublicConfig()
        .then((c) => {
          if (typeof c.features?.anonymousMatch === 'boolean') {
            setAnonymousMatchEnabled(c.features.anonymousMatch)
          }
        })
        .catch(() => undefined)
      void fetchIceServers().catch(() => undefined)
    }
    void boot()

    const iv = window.setInterval(() => {
      void fetchHealth().then((h) => {
        if (h.ok) {
          setOnline(h.online)
          setWaitingCount(h.waiting)
        }
      })
    }, TIMING_MS.healthPollClient)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [
    setUser,
    setAuth,
    setResetToken,
    setGoogleSignupToken,
    setStatus,
    setOnline,
    setWaitingCount,
  ])

  return { appVersion, sharedPrefs, anonymousMatchEnabled }
}
