import { useEffect, useRef, useState } from 'preact/hooks'
import { API_ROUTES } from '../../../shared/constants'
import type { MediaMetaDTO } from '../../../shared/types'
import { mediaApi } from '../../api'
import { Icon, icons } from '../icons'
import { FieldGroup } from './EditorFields'
import { MEDIA_ICON_PREFIX } from './linkIcons'

/**
 * Per-user custom icon library for the link editor: upload an image, click
 * one to assign it to the selected link, delete what you no longer use.
 * `onDelete` lets the parent clear the icon from links still referencing it.
 */
export function CustomIcons({
  current,
  onAssign,
  onDelete,
}: {
  current: string
  onAssign: (icon: string) => void
  onDelete: (id: number) => void
}) {
  const [items, setItems] = useState<MediaMetaDTO[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    mediaApi.list('icon').then(
      ({ media }) => {
        if (live.current) setItems(media)
      },
      () => {
        if (live.current) setItems([])
      },
    )
  }, [])

  const refresh = async () => {
    try {
      const { media } = await mediaApi.list('icon')
      if (live.current) setItems(media)
    } catch {
      /* keep the stale list: the error below already explains */
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    const res = await mediaApi.uploadFile('icon', file)
    if (!live.current) return
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onAssign(`${MEDIA_ICON_PREFIX}${res.upload.id}`)
    await refresh()
  }

  const remove = async (id: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await mediaApi.remove(id)
      if (!live.current) return
      setItems((prev) => prev?.filter((item) => item.id !== id) ?? prev)
      onDelete(id)
    } catch {
      if (live.current) setError('Could not delete that icon.')
    } finally {
      if (live.current) setBusy(false)
    }
  }

  return (
    <FieldGroup label="Custom icons">
      <div class="pedit-icons">
        {items?.map((item) => {
          const value = `${MEDIA_ICON_PREFIX}${item.id}`
          const selected = current === value
          return (
            <span key={item.id} class={selected ? 'pedit-icon is-on' : 'pedit-icon'}>
              <button
                type="button"
                class="pedit-icon-pick"
                aria-label={`Use custom icon ${item.id}`}
                aria-pressed={selected}
                onClick={() => onAssign(value)}
              >
                <img src={API_ROUTES.mediaById(item.id)} alt="" width={22} height={22} loading="lazy" />
              </button>
              <button
                type="button"
                class="pedit-icon-del"
                aria-label={`Delete custom icon ${item.id}`}
                disabled={busy}
                onClick={() => void remove(item.id)}
              >
                <Icon d={icons.close} size={11} />
              </button>
            </span>
          )
        })}
        <button
          type="button"
          class="pedit-icon-pick pedit-icon-add"
          aria-label={busy ? 'Uploading icon' : 'Upload custom icon'}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon d={icons.plus} size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            void upload(e.currentTarget.files?.[0])
            e.currentTarget.value = ''
          }}
        />
      </div>
      {error && <p class="pedit-error">{error}</p>}
    </FieldGroup>
  )
}
