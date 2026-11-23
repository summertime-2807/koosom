import { useRef, useState } from 'react'
import type { StoredRoute } from '../types/race'
import { gpxToStoredRoute } from '../engine/gpxParser'
import { generateFlatRoute } from '../engine/routeGen'
import { SAMPLE_GPX, sampleRoute } from '../data/sampleRoute'
import { downloadFile } from '../services/download'

interface Props {
  onRoute: (r: StoredRoute, opts?: { useSampleWaypoints?: boolean }) => void
  onError: (msg: string) => void
}

export default function GpxUpload({ onRoute, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [flatKm, setFlatKm] = useState('10')

  async function handleFile(file?: File) {
    if (!file) return
    if (!/\.gpx$/i.test(file.name) && !file.type.includes('xml')) {
      onError('รองรับเฉพาะไฟล์ .gpx')
      return
    }
    try {
      const text = await file.text()
      const r = gpxToStoredRoute(text, file.name.replace(/\.gpx$/i, ''))
      onRoute(r)
    } catch (e) {
      onError((e as Error).message || 'อ่านไฟล์ GPX ไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          handleFile(e.dataTransfer.files?.[0])
        }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          drag ? 'border-zinc-200 bg-zinc-800/60' : 'border-zinc-700 hover:border-zinc-500'
        }`}
      >
        <div className="text-2xl">🗺️</div>
        <div className="mt-1 text-sm font-medium">ลากไฟล์ .gpx มาวาง หรือแตะเพื่อเลือกไฟล์</div>
        <div className="text-xs text-zinc-500">ประมวลผลในเครื่อง 100% · ไม่อัปโหลดขึ้นเซิร์ฟเวอร์</div>
        <input
          ref={input}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => onRoute(sampleRoute(), { useSampleWaypoints: true })}>
          ใช้เส้นทางตัวอย่าง 21.1K
        </button>
        <button className="btn-ghost text-xs text-zinc-400" onClick={() => downloadFile('sample-bkk-half.gpx', SAMPLE_GPX, 'application/gpx+xml')}>
          ⬇ ไฟล์ GPX ตัวอย่าง
        </button>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="label">ยังไม่มี GPX? สร้างเส้นทางราบจำลอง (กม.)</span>
          <select className="input" value={flatKm} onChange={(e) => setFlatKm(e.target.value)}>
            <option value="5">5K</option>
            <option value="10">10K</option>
            <option value="21.0975">ฮาล์ฟมาราธอน 21.1K</option>
            <option value="42.195">มาราธอน 42.195K</option>
          </select>
        </label>
        <button
          className="btn"
          onClick={() => {
            const km = Number(flatKm)
            onRoute(generateFlatRoute(km, `เส้นทางราบจำลอง ${km >= 42 ? '42.195' : km >= 21 ? '21.1' : km}K`))
          }}
        >
          สร้าง
        </button>
      </div>
    </div>
  )
}
