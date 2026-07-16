import type { Gender, MatchPreferences } from '../../shared/types'
import { DEFAULT_COUNTRY, DEFAULT_GENDER, DEFAULT_LANGUAGE, GENDERS, STORAGE_KEYS } from '../../shared/constants'
import { parseInterests, parseJson } from '../../shared/json'
import { type PublicUser, get, getBool, getFlag, set, setBool, setFlag } from './storage'

export { get, set }
import { isAdult } from './age'

/** Bump when legal copy changes so users re-accept terms. */
export const TERMS_VERSION = 'v1'

export const storageKeys = STORAGE_KEYS

export function isAgeGateComplete(): boolean {
  if (getBool(storageKeys.profileComplete)) return true
  const birth = get(storageKeys.birthDate)
  return Boolean(birth && isAdult(birth))
}

export function markAgeGateComplete(birthDate: string) {
  set(storageKeys.birthDate, birthDate)
  setBool(storageKeys.profileComplete, true)
}

export function isTermsAccepted(): boolean {
  const v = get(storageKeys.termsAccepted)
  return v === TERMS_VERSION || getBool(storageKeys.termsAccepted)
}

export function acceptTerms() {
  set(storageKeys.termsAccepted, TERMS_VERSION)
}

export function areDevicesReady(): boolean {
  return getFlag(storageKeys.devicesReady)
}

export function markDevicesReady() {
  setFlag(storageKeys.devicesReady, true)
}

export function isMatchSetupComplete(): boolean {
  return getFlag(storageKeys.setupComplete) && isTermsAccepted() && areDevicesReady() && isAgeGateComplete()
}

export function markMatchSetupComplete() {
  acceptTerms()
  markDevicesReady()
  setFlag(storageKeys.setupComplete, true)
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

/** First incomplete wizard step (0 devices, 1 prefs). Age/terms are handled by the age gate. */
export function getStartWizardStep(): 0 | 1 {
  if (!areDevicesReady()) return 0
  return 1
}

const genders = GENDERS as readonly Gender[]

function asGender(v: string | undefined | null): Gender {
  return v && genders.includes(v as Gender) ? (v as Gender) : DEFAULT_GENDER
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

  let lookingFor: Gender = DEFAULT_GENDER
  const stored = get(storageKeys.prefs)
  if (stored) {
    const parsed = parseJson<MatchPreferences | null>(stored, null)
    lookingFor = asGender(parsed?.lookingFor)
  }

  const prefs: MatchPreferences = {
    country: user.country || DEFAULT_COUNTRY,
    language: user.language || DEFAULT_LANGUAGE,
    gender: asGender(user.gender),
    lookingFor,
    interests: Array.isArray(user.interests) ? user.interests.slice(0, 5) : [],
  }

  return { profileComplete, prefs }
}
