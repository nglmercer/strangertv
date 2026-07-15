import { useEffect, useState } from 'preact/hooks'
import {
  authApi,
  clearSession,
  fetchHealth,
  fetchIceServers,
  getToken,
  setSession,
  type PublicUser,
} from '../api'
import { detectLocale, t as translate } from '../i18n'

type Options = {
  setUser: (u: PublicUser | null) => void
  setAuth: (v: boolean) => void
  setResetToken: (t: string) => void
  setStatus: (s: string) => void
  setOnline: (n: number) => void
  setWaitingCount: (n: number) => void
}

/** One-time boot: deep links, session refresh, health poll, ICE warm-up. */
export function useSessionBootstrap({
  setUser,
  setAuth,
  setResetToken,
  setStatus,
  setOnline,
  setWaitingCount,
}: Options) {
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const reset = params.get('reset')
    if (reset) {
      setResetToken(reset)
      setAuth(true)
      history.replaceState({}, '', location.pathname)
    }
    const verify = params.get('verify')
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

    if (getToken()) {
      void authApi
        .refresh()
        .then((r) => {
          setSession(r.token, r.user)
          setUser(r.user)
        })
        .catch(() =>
          authApi
            .me()
            .then((r) => setUser(r.user))
            .catch(() => {
              clearSession()
              setUser(null)
            }),
        )
    }

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
    }, 20_000)
    return () => clearInterval(iv)
  }, [setUser, setAuth, setResetToken, setStatus, setOnline, setWaitingCount])

  return { appVersion }
}
