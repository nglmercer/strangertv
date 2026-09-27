/**
 * Shared identity helpers for the social surface. Both `PublicUser` shapes
 * (generated API type and client storage type) carry email plus optional
 * username/displayName, so one helper covers friends, members, and search.
 */
export type NamedUser = {
  email: string
  username?: string | null
  displayName?: string | null
}

/** Display name with graceful fallback: profile name, handle, email part. */
export function userDisplayName(user: NamedUser): string {
  return user.displayName || user.username || user.email.split('@')[0] || user.email
}
