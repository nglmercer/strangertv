import { logger } from './logger'
import { ALERT_TYPE, HTTP_HEADERS, METRIC_NAMES, MIME_TYPE } from '../shared/constants'
import { inc } from './metrics'

const windowMs = 5 * 60_000
const reportTimes: number[] = []

async function postAlert(payload: Record<string, unknown>) {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) {
    logger.warn('alerts.event', { ...payload, webhook: false })
    return
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { [HTTP_HEADERS.contentType]: MIME_TYPE.json },
      body: JSON.stringify({ ...payload, ts: new Date().toISOString() }),
    })
    inc(METRIC_NAMES.alertsSent)
    logger.warn('alerts.sent', payload)
  } catch (err) {
    logger.error('alerts.webhook_failed', { err: String(err) })
  }
}

/**
 * Track report rate; if threshold exceeded, POST ALERT_WEBHOOK_URL.
 * Env: ALERT_WEBHOOK_URL, ALERT_REPORTS_THRESHOLD (default 10 / 5 min)
 */
export async function noteReport(reason?: string) {
  const now = Date.now()
  reportTimes.push(now)
  while (reportTimes.length && now - reportTimes[0]! > windowMs) reportTimes.shift()

  if (reason === 'underage') {
    inc(METRIC_NAMES.reportsUnderage)
    await postAlert({
      type: ALERT_TYPE.underageReport,
      priority: 'critical',
      reason,
      recentReports: reportTimes.length,
    })
  }

  const threshold = Number(process.env.ALERT_REPORTS_THRESHOLD ?? 10)
  if (reportTimes.length < threshold) return

  await postAlert({
    type: ALERT_TYPE.reportSpike,
    count: reportTimes.length,
    windowMinutes: 5,
    threshold,
  })
  // cool down: clear so we don't spam
  reportTimes.length = 0
}
