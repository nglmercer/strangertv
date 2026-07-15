/** Browser getUserMedia failure codes we surface in the UI. */
export type MediaErrorCode =
  | 'permission'
  | 'in_use'
  | 'not_found'
  | 'overconstrained'
  | 'security'
  | 'abort'
  | 'unknown'

export type ClassifiedMediaError = {
  code: MediaErrorCode
  name: string
  message: string
}

/**
 * Map DOMException / getUserMedia failures to stable app codes.
 * - permission: denied or dismissed prompt
 * - in_use: device busy (another app/tab holds the camera)
 * - not_found: no camera/mic hardware
 * - overconstrained: saved deviceId invalid
 * - security: insecure context (non-HTTPS / non-localhost)
 */
export function classifyMediaError(err: unknown): ClassifiedMediaError {
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : ''
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : String(err ?? '')

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { code: 'security', name: name || 'SecurityError', message }
  }

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { code: 'permission', name, message }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      // Chromium often uses NotReadableError when the cam is held by another process.
      // AbortError can mean the same on some platforms.
      if (name === 'AbortError' && /permission/i.test(message)) {
        return { code: 'permission', name, message }
      }
      if (name === 'AbortError') {
        return { code: 'abort', name, message }
      }
      return { code: 'in_use', name, message }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'not_found', name, message }
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { code: 'overconstrained', name, message }
    case 'SecurityError':
      return { code: 'security', name, message }
    default:
      if (/Permission|NotAllowed/i.test(message)) return { code: 'permission', name, message }
      if (/Could not start|busy|in use|Device in use/i.test(message)) {
        return { code: 'in_use', name, message }
      }
      if (/Requested device not found|not found/i.test(message)) {
        return { code: 'not_found', name, message }
      }
      return { code: 'unknown', name: name || 'Error', message }
  }
}

export type MediaErrorMessages = {
  mediaPermission: string
  mediaInUse: string
  mediaNotFound: string
  mediaOverconstrained: string
  mediaSecurity: string
  mediaGeneric: string
  cameraNeeded: string
}

export function mediaErrorMessage(t: MediaErrorMessages, code: MediaErrorCode | null | undefined): string {
  switch (code) {
    case 'permission':
      return t.mediaPermission
    case 'in_use':
      return t.mediaInUse
    case 'not_found':
      return t.mediaNotFound
    case 'overconstrained':
      return t.mediaOverconstrained
    case 'security':
      return t.mediaSecurity
    case 'abort':
      return t.mediaGeneric
    case 'unknown':
      return t.mediaGeneric
    default:
      return t.cameraNeeded
  }
}

export function mediaErrorHelp(t: { mediaHelpPermission: string; mediaHelpInUse: string; mediaHelpNotFound: string; mediaHelpSecurity: string }, code: MediaErrorCode | null | undefined): string {
  switch (code) {
    case 'permission':
      return t.mediaHelpPermission
    case 'in_use':
      return t.mediaHelpInUse
    case 'not_found':
      return t.mediaHelpNotFound
    case 'security':
      return t.mediaHelpSecurity
    default:
      return ''
  }
}
