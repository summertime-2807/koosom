import { useState } from 'react'
import type { Waypoint, WaypointType } from '../types/race'
import { Card } from './ui'
import { WP_META, WP_TYPES } from '../lib/waypointMeta'
import { uid } from '../lib/time'

interface Props {
  waypoints: Waypoint[]
  totalKm: number
  gpxWaypoints: { name: string; km: number }[]
  onChange: (w: Waypoint[]) => void
}

export default function WaypointEditor({ waypoints, totalKm, gpxWaypoints, onChange }: Props) {
  const [every, setEvery] = useState('2.5')
  const sorted = [...waypoints].sort((a, b) => a.km - b.km)
  const update = (id: string, p: Partial<Waypoint>) => onChange(waypoints.map((w) => (w.id === id ? { ...w, ...p } : w)))

  function addEvery() {
    const step = Number(every)
    if (!(step > 0)) return
    const existing = waypoints.filter((w) => w.type !== 'water')
    const list: Waypoint[] = []
    for (let k = step; k < totalKm - 0.3; k += step) list.push({ id: uid('wp'), km: Math.round(k * 100) / 100, type: 'water', label: 'จุดให้น้ำ' })
    onChange([...existing, ...list])
  }

  return (
    <Card
      title="จุดให้น้ำ & จุดสำคัญ"
      right={
        <button className="btn text-xs" onClick={() => onChange([...waypoints, { id: uid('wp'), km: Math.min(totalKm, Math.round((sorted.at(-1)?.km ?? 0) + 2.5)), type: 'water' }])}>
          + เพิ่มจุด
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1">
          <span className="label">ตั้งจุดให้น้ำอัตโนมัติทุก (กม.)</span>
          <input className="input" inputMode="decimal" value={every} onChange={(e) => setEvery(e.target.value)} />
        </label>
        <button className="btn" onClick={addEvery}>
          แทนที่จุดน้ำ
        </button>
        {gpxWaypoints.length > 0 && (
          <button
            className="btn"
            onClick={() =>
              onChange([
                ...waypoints,
                ...gpxWaypoints.map((g) => ({
                  id: uid('wp'),
                  km: g.km,
                  type: (/น้ำ|water|aid|drink/i.test(g.name) ? 'water' : /ห้องน้ำ|toilet|wc/i.test(g.name) ? 'toilet' : /u-?turn|กลับตัว/i.test(g.name) ? 'uturn' : 'hill') as WaypointType,
                  label: g.name,
                })),
              ])
            }
          >
            นำเข้า {gpxWaypoints.length} จุดจาก GPX
          </button>
        )}
      </div>

      {sorted.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">ยังไม่มีจุด — เพิ่มจุดให้น้ำเพื่อใช้ Smart Snap กับเจล</p>}
      <ul className="divide-y divide-zinc-800">
        {sorted.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 py-2 sm:flex-nowrap">
            <input
              className="input num w-20 shrink-0 px-2 py-1.5 text-sm"
              type="number"
              step={0.1}
              min={0}
              max={totalKm}
              value={w.km}
              onChange={(e) => update(w.id, { km: Math.max(0, Math.min(totalKm, Number(e.target.value) || 0)) })}
              aria-label="กม."
            />
            <select className="input min-w-0 flex-1 px-2 py-1.5 text-sm sm:w-44 sm:flex-none" value={w.type} onChange={(e) => update(w.id, { type: e.target.value as WaypointType })}>
              {WP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WP_META[t].icon} {WP_META[t].th}
                </option>
              ))}
            </select>
            <input
              className="input order-last basis-full px-2 py-1.5 text-sm sm:order-none sm:basis-auto sm:flex-1"
              placeholder="หมายเหตุ"
              value={w.label ?? ''}
              onChange={(e) => update(w.id, { label: e.target.value })}
            />
            <button className="btn-ghost shrink-0 px-2 text-zinc-500 hover:text-red-400" onClick={() => onChange(waypoints.filter((x) => x.id !== w.id))} aria-label="ลบ">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
