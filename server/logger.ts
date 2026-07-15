type Level = 'debug' | 'info' | 'warn' | 'error'

const levelOrder: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const minLevel = (process.env.LOG_LEVEL as Level) || 'info'

function shouldLog(level: Level) {
  return levelOrder[level] >= levelOrder[minLevel]
}

export function log(level: Level, message: string, fields?: Record<string, unknown>) {
  if (!shouldLog(level)) return
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
}
