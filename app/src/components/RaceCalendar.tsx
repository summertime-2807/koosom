import { useMemo, useState } from 'react'
import type { CalendarRace } from '../types/race'
import { CALENDAR_UPDATED, RACE_CALENDAR, THAIRUN_URL } from '../data/raceCalendar'
import { Card, Field, Segmented } from './ui'
import { TH_MONTHS_FULL, fmtThaiDate, uid } from '../lib/time'

interface Props {
  customRaces: CalendarRace[]
  onCustomRaces: (r: CalendarRace[]) => void
  onPlan: (race: CalendarRace, km: number) => void
}

const distLabel = (km: number) => (km >= 42 && km < 43 ? 'มาราธอน' : km >= 21 && km < 21.2 ? 'ฮาล์ฟ' : `${km}K`)

export default function RaceCalendar({ customRaces, onCustomRaces, onPlan }: Props) {
  const [filter, setFilter] = useState<'all' | '10' | '21' | '42'>('all')
  const [showPast, setShowPast] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', date: '', location: '', dists: '10, 21.1', url: '' })
  const today = new Date().toISOString().slice(0, 10)

  const all = useMemo(() => [...RACE_CALENDAR, ...customRaces], [customRaces])
  const filtered = all.filter((r) => {
    if (!showPast && r.date && r.date < today) return false
    if (filter === 'all') return true
    const want = Number(filter)
    return r.distancesKm.length === 0 || r.distancesKm.some((d) => Math.abs(d - (want === 10 ? 10 : want === 21 ? 21.1 : 42.195)) < 0.6)
  })
  const next = all.filter((r) => r.date && r.date >= today).sort((a, b) => a.date!.localeCompare(b.date!))[0]
  const daysTo = next?.date ? Math.ceil((new Date(next.date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 864e5) : null

  const groups = useMemo(() => {
    const m = new Map<string, CalendarRace[]>()
    const sorted = [...filtered].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
    for (const r of sorted) {
      const key = r.date ? r.date.slice(0, 7) : 'unknown'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(r)
    }
    return [...m.entries()]
  }, [filtered])

  function addRace() {
    if (!form.name.trim()) return
    const r: CalendarRace = {
      id: uid('cr'),
      name: form.name.trim(),
      date: form.date || undefined,
      dateText: form.date ? undefined : 'ยังไม่ระบุวัน',
      location: form.location || undefined,
      distancesKm: form.dists
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => n > 0),
      source: 'เพิ่มเอง',
      url: form.url || THAIRUN_URL,
      custom: true,
    }
    onCustomRaces([...customRaces, r])
    setForm({ name: '', date: '', location: '', dists: '10, 21.1', url: '' })
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      {next && (
        <div className="card flex items-center justify-between gap-3 bg-gradient-to-br from-zinc-900 to-zinc-950">
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500">สนามถัดไป</div>
            <div className="truncate font-semibold">{next.name}</div>
            <div className="text-xs text-zinc-400">
              {next.dateText ?? fmtThaiDate(next.date!)} {next.location && `· ${next.location}`}
            </div>
          </div>
          <div className="text-right">
            <div className="num text-3xl font-bold">{daysTo}</div>
            <div className="text-[11px] text-zinc-500">วัน</div>
          </div>
        </div>
      )}

      <Card
        title="ปฏิทินงานวิ่ง"
        right={
          <a className="btn text-xs" href={THAIRUN_URL} target="_blank" rel="noreferrer">
            เปิด race.thai.run ↗
          </a>
        }
      >
        <div className="space-y-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'ทั้งหมด' },
              { value: '10', label: '10K' },
              { value: '21', label: 'ฮาล์ฟ' },
              { value: '42', label: 'มาราธอน' },
            ]}
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> แสดงงานที่ผ่านมา
            </label>
            <span>ข้อมูล ณ {fmtThaiDate(CALENDAR_UPDATED)}</span>
          </div>
        </div>

        <div className="mt-4 space-y-5">
          {groups.map(([key, races]) => (
            <div key={key}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {key === 'unknown' ? 'ยังไม่ระบุวัน' : `${TH_MONTHS_FULL[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(0, 4)) + 543}`}
              </div>
              <ul className="space-y-2">
                {races.map((r) => (
                  <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium leading-snug">{r.name}</div>
                        <div className="mt-0.5 text-xs text-zinc-400">
                          {r.dateText ?? (r.date ? fmtThaiDate(r.date) : '')}
                          {r.location && ` · ${r.location}`}
                          {r.organizer && ` · ${r.organizer}`}
                        </div>
                      </div>
                      <a href={r.url} target="_blank" rel="noreferrer" className="chip shrink-0 text-zinc-400 hover:text-zinc-100">
                        {r.source} ↗
                      </a>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(r.distancesKm.length ? r.distancesKm : [10, 21.0975, 42.195]).map((d) => (
                        <button key={d} className="chip border-zinc-600 hover:border-zinc-300 hover:bg-zinc-800" onClick={() => onPlan(r, d)}>
                          วางแผน {distLabel(d)}
                        </button>
                      ))}
                      {r.custom && (
                        <button className="chip border-transparent text-zinc-500 hover:text-red-400" onClick={() => onCustomRaces(customRaces.filter((x) => x.id !== r.id))}>
                          ลบ
                        </button>
                      )}
                    </div>
                    {!r.distancesKm.length && <div className="mt-1 text-[11px] text-zinc-600">ยังไม่มีข้อมูลระยะ — เช็กระยะจริงบนเว็บรับสมัคร</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">ไม่มีงานที่ตรงกับตัวกรอง</p>}
        </div>
      </Card>

      <Card title="เพิ่มงานวิ่งเอง" right={!adding && <button className="btn text-xs" onClick={() => setAdding(true)}>+ เพิ่ม</button>}>
        {adding ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชื่องาน" className="col-span-2">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="วันแข่ง">
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="สถานที่">
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <Field label="ระยะ (กม. คั่นด้วย ,)">
              <input className="input" value={form.dists} onChange={(e) => setForm({ ...form, dists: e.target.value })} />
            </Field>
            <Field label="ลิงก์งาน (race.thai.run)">
              <input className="input" placeholder="https://race.thai.run/..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </Field>
            <div className="col-span-2 flex gap-2">
              <button className="btn-primary flex-1" onClick={addRace}>
                บันทึก
              </button>
              <button className="btn" onClick={() => setAdding(false)}>
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">เจองานใหม่บน race.thai.run? คัดลอกชื่อ วันที่ และลิงก์มาเพิ่มไว้ที่นี่ แล้วกด “วางแผน” ได้เลย</p>
        )}
      </Card>
    </div>
  )
}
