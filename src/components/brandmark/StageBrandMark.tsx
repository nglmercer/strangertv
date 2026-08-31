import { useEffect, useRef, useState } from 'preact/hooks'
import { BrandMark3D } from './BrandMark3D'
import type { DeviceRendererAPI } from './renderer'
import { createStageStatusScreen } from './screens/stageStatus'

export interface StageBrandMarkProps {
  finding: boolean
  title: string
  body: string
}

const MIN_ZOOM = 0.68
const MAX_ZOOM = 1.35

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

export function StageBrandMark({ finding, title, body }: StageBrandMarkProps) {
  const deviceRef = useRef<DeviceRendererAPI | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    deviceRef.current?.screen.setRenderer(createStageStatusScreen({ title, body, finding }))
  }, [title, body, finding])

  useEffect(() => () => {
    deviceRef.current = null
  }, [])

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const amount = Math.max(-0.1, Math.min(0.1, -event.deltaY * 0.0015))
    setZoom((current) => Math.round(clampZoom(current + amount) * 100) / 100)
  }

  return (
    <>
      <div
        class="stage-brandmark-shell"
        style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}
        onWheel={onWheel}
        onDblClick={() => setZoom(1)}
      >
        <BrandMark3D
          autoSpin={false}
          defaultScreenEffect={false}
          onReady={(device) => {
            deviceRef.current = device
            device.setRotation(0.08, 0.1)
            device.screen.setRenderer(createStageStatusScreen({ title, body, finding }))
          }}
        />
      </div>
      <div class="stage-status-a11y" aria-live="polite">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </>
  )
}
