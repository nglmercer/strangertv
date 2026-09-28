/** Polls `probe` until it reports ok or the budget runs out. */
export async function waitForApi<T extends { ok: boolean }>(
  probe: () => Promise<T>,
  opts: { timeoutMs: number; retryMs: number; isCancelled?: () => boolean },
): Promise<T | null> {
  const cancelled = opts.isCancelled ?? (() => false)
  let result = await probe()
  const deadline = Date.now() + opts.timeoutMs
  while (!result.ok && !cancelled() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, opts.retryMs))
    if (cancelled()) return null
    result = await probe()
  }
  return cancelled() ? null : result
}
