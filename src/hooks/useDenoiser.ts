import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { DenoiserChain, isDenoiserSupported } from '../denoise/denoiser'
import { isDenoiseEnabled, setDenoiseEnabled } from '../utils/clientStorage'

type PublishedCache = {
  raw: MediaStream
  audioId: string
  videoIds: string
  out: MediaStream
}

/**
 * Session-level noise reduction: a persisted on/off toggle plus the mapping
 * from the raw mic stream to the stream that gets published to peers (raw
 * video tracks + denoised audio track). Any failure degrades to the raw mic.
 */
export function useDenoiser() {
  const [supported] = useState(() => {
    try {
      return isDenoiserSupported()
    } catch {
      return false
    }
  })
  const [enabled, setEnabledState] = useState(() => supported && isDenoiseEnabled())
  const chainRef = useRef<DenoiserChain | null>(null)
  const cacheRef = useRef<PublishedCache | null>(null)

  useEffect(() => {
    return () => {
      chainRef.current?.dispose()
      chainRef.current = null
      cacheRef.current = null
    }
  }, [])

  const toPublishStream = useCallback(
    async (raw: MediaStream): Promise<MediaStream> => {
      if (!supported || !enabled) return raw
      const audio = raw.getAudioTracks()[0]
      if (!audio || audio.readyState !== 'live') return raw
      const videoIds = raw
        .getVideoTracks()
        .map((t) => t.id)
        .join(',')
      const cached = cacheRef.current
      if (cached && cached.raw === raw && cached.audioId === audio.id && cached.videoIds === videoIds) {
        return cached.out
      }
      try {
        const chain = chainRef.current ?? new DenoiserChain()
        chainRef.current = chain
        const denoised = await chain.attach(audio)
        const out = new MediaStream([...raw.getVideoTracks(), denoised])
        cacheRef.current = { raw, audioId: audio.id, videoIds, out }
        return out
      } catch (err) {
        console.warn('[denoise] falling back to raw mic', err)
        return raw
      }
    },
    [enabled, supported],
  )

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on)
      setDenoiseEnabled(on)
      cacheRef.current = null
      if (!on) chainRef.current?.detach()
    },
    [],
  )

  return { supported, enabled, setEnabled, toPublishStream }
}

export type DenoiserApi = ReturnType<typeof useDenoiser>
