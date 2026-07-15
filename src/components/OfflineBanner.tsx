import { useEffect, useState } from 'preact/hooks'

export function OfflineBanner({ label }: { label: string }) {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (online) return null
  return (
    <div class="offline-banner" role="status">
      {label}
    </div>
  )
}
