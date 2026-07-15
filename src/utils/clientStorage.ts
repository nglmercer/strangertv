import type { Gender, MatchPreferences } from '../../shared/types'
import type { PublicUser } from '../api'
import { isAdult } from './age'

/** Bump when legal copy changes so users re-accept terms. */
export const TERMS_VERSION = 'v1'

export const storageKeys = {
  profileComplete: 'stranger-profile-complete',
  birthDate: 'stranger-birth-date',
  termsAccepted: 'stranger-terms-accepted',
  setupComplete: 'stranger-setup-complete',
  devicesReady: 'stranger-devices-ready',
  videoDevice: 'stranger-video-device-id',
  audioDevice: 'stranger-audio-device-id',
  prefs: 'stranger-prefs',
} as const

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode / quota */
  }
}

export function isAgeGateComplete(): boolean {
  if (get(storageKeys.profileComplete) === 'true') return true
  const birth = get(storageKeys.birthDate)
  return Boolean(birth && isAdult(birth))
}

export function markAgeGateComplete(birthDate: string) {
  set(storageKeys.birthDate, birthDate)
  set(storageKeys.profileComplete, 'true')
}

export function isTermsAccepted(): boolean {
  const v = get(storageKeys.termsAccepted)
  return v === TERMS_VERSION || v === 'true'
}

export function acceptTerms() {
  set(storageKeys.termsAccepted, TERMS_VERSION)
}

export function areDevicesReady(): boolean {
  return get(storageKeys.devicesReady) === '1'
}

export function markDevicesReady() {
  set(storageKeys.devicesReady, '1')
}

export function isMatchSetupComplete(): boolean {
  return get(storageKeys.setupComplete) === '1' && isTermsAccepted() && areDevicesReady()
}

export function markMatchSetupComplete() {
  acceptTerms()
  markDevicesReady()
  set(storageKeys.setupComplete, '1')
}

/** True when Start can join the queue without re-opening the wizard. */
export function canQuickStart(): boolean {
  return isAgeGateComplete() && isMatchSetupComplete()
}

export function loadDeviceIds(): { videoId: string; audioId: string } {
  return {
    videoId: get(storageKeys.videoDevice) ?? '',
    audioId: get(storageKeys.audioDevice) ?? '',
  }
}

export function saveVideoDeviceId(id: string) {
  set(storageKeys.videoDevice, id)
}

export function saveAudioDeviceId(id: string) {
  set(storageKeys.audioDevice, id)
}

/** First incomplete wizard step (0 terms, 1 devices, 2 prefs). */
export function getStartWizardStep(): 0 | 1 | 2 {
  if (!isTermsAccepted()) return 0
  if (!areDevicesReady()) return 1
  return 2
}

const genders: Gender[] = ['any', 'male', 'female', 'other']

function asGender(v: string | undefined | null): Gender {
  return v && genders.includes(v as Gender) ? (v as Gender) : 'any'
}

/** Mirror account age/consent into local storage; optional match prefs from profile. */
export function applyUserToClient(user: PublicUser): {
  profileComplete: boolean
  prefs: MatchPreferences | null
} {
  let profileComplete = isAgeGateComplete()

  if (user.birthDate && isAdult(user.birthDate)) {
    markAgeGateComplete(user.birthDate)
    profileComplete = true
  } else if (user.birthDate) {
    set(storageKeys.birthDate, user.birthDate)
  }

  // Registered/logged-in users already passed server-side age + terms consent.
  if (profileComplete) {
    acceptTerms()
  }

  const hasProfilePrefs =
    Boolean(user.country) || Boolean(user.language) || Boolean(user.gender) || Boolean(user.interests?.length)

  if (!hasProfilePrefs) {
    return { profileComplete, prefs: null }
  }

  let lookingFor: Gender = 'any'
  try {
    const raw = get(storageKeys.prefs)
    if (raw) {
      const parsed = JSON.parse(raw) as MatchPreferences
      lookingFor = asGender(parsed.lookingFor)
    }
  } catch {
    /* ignore */
  }

  const prefs: MatchPreferences = {
    country: user.country || 'any',
    language: user.language || 'any',
    gender: asGender(user.gender),
    lookingFor,
    interests: Array.isArray(user.interests) ? user.interests.slice(0, 5) : [],
  }

  return { profileComplete, prefs }
}
