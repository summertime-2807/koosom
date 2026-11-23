import { useRef, useState } from 'react'
import type { PostRaceLog, RacePlan } from '../types/race'
import { Card, Field } from './ui'
import { fmtHMS, fmtThaiDate, parseHMS } from '../lib/time'
import { analyzeRoute } from '../engine/gpxParser'

interface Props {
  plans: RacePlan[]
  current: RacePlan
  onOpen: (id: string) => void
  onNew: () => void
  onDuplicate: (p: RacePlan) => void
  onDelete: (id: string) => void
  onPostRace: (log: PostRaceLog) => void
  onExport: () => void
  onImport: (data: unknown, mode: 'merge' | 'replace') => void
  toast: (m: string) => void
}

export default function Archive({ plans, current, onOpen, onNew, onDuplicate, onDelete, onPostRace, onExport, onImport, toast }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const log = current.postRace
  const actual = parseHMS(log.actualFinish)
  const diff = Number.isFinite(actual) ? actual - current.pacing.targetSec : NaN
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      <Card title={`บันทึกหลังแข่ง — ${current.meta.name}`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="รองเท้าที่ใส่" className="col-span-2">
            <input className="input" placeholder="เช่น Adidas Adios Pro 4" value={log.shoes} onChange={(e) => onPostRace({ ...log, shoes: e.target.value })} />
          </Field>
          <Field label="เวลาจริง (ชม:นาที:วินาที)" hint={Number.isFinite(diff) ? (diff <= 0 ? `เร็วกว่าเป้า ${fmtHMS(-diff)} 🎉` : `ช้ากว่าเป้า ${fmtHMS(diff)}`) : `เป้า ${fmtHMS(current.pacing.targetSec)}`}>
            <input className="input font-mono" placeholder="2:10:45" value={log.actualFinish} onChange={(e) => onPostRace({ ...log, actualFinish: e.target.value })} />
          </Field>
          <Field label="HR เฉลี่ย (bpm)">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={log.avgHr ?? ''}
              onChange={(e) => onPostRace({ ...log, avgHr: e.target.value ? Number(e.target.value) : undefined })}
            />
          </Field>
          <Field label="โน้ต: เจล / ท้อง / HR / อากาศ / สิ่งที่จะปรับครั้งหน้า" className="col-span-2">
            <textarea className="input min-h-[96px]" value={log.notes} onChange={(e) => onPostRace({ ...log, notes: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card
        title={`แผนที่บันทึกไว้ (${plans.length})`}
        right={
          <button className="btn text-xs" onClick={onNew}>
            + แผนใหม่
          </button>
        }
      >
        <ul className="divide-y divide-zinc-800">
          {plans.map((p) => {
            let km = 0
            try {
              km = analyzeRoute(p.route).totalDistanceKm
            } catch {
              /* ignore */
            }
            const done = !!p.postRace.actualFinish
            const past = p.meta.date < today
            return (
              <li key={p.id} className={`flex items-center gap-3 py-2.5 ${p.id === current.id ? 'opacity-100' : 'opacity-90'}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(p.id)}>
                  <div className="flex items-center gap-2">
                    {p.id === current.id && <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-100" />}
                    <span className="truncate font-medium">{p.meta.name || 'ไม่มีชื่อ'}</span>
                  </div>
                  <div className="num text-xs text-zinc-500">
                    {fmtThaiDate(p.meta.date)} · {km.toFixed(1)} กม. · เป้า {fmtHMS(p.pacing.targetSec)}
                    {done && <span className="ml-1 text-green-400">· จริง {p.postRace.actualFinish}</span>}
                    {!done && past && <span className="ml-1 text-amber-400">· ยังไม่บันทึกผล</span>}
                  </div>
                </button>
                <button className="btn-ghost px-2 text-xs" onClick={() => onDuplicate(p)} title="ทำสำเนา">
                  ⧉
                </button>
                {confirmDel === p.id ? (
                  <button
                    className="btn border-red-500 px-2 text-xs text-red-300"
                    onClick={() => {
                      onDelete(p.id)
                      setConfirmDel(null)
                    }}
                  >
                    ยืนยันลบ
                  </button>
                ) : (
                  <button className="btn-ghost px-2 text-xs text-zinc-500 hover:text-red-400" disabled={plans.length <= 1} onClick={() => setConfirmDel(p.id)}>
                    ลบ
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      <Card title="สำรอง / กู้คืนข้อมูล (JSON)">
        <p className="mb-3 text-xs text-zinc-500">ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น — สำรองเป็นไฟล์ JSON ไว้ย้ายเครื่องหรือกันข้อมูลหาย</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={onExport}>
            ⬇ ส่งออกทั้งหมด
          </button>
          <select className="input w-auto py-1.5 text-sm" value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">นำเข้าแบบรวม</option>
            <option value="replace">นำเข้าแบบแทนที่ทั้งหมด</option>
          </select>
          <button className="btn" onClick={() => file.current?.click()}>
            ⬆ นำเข้า
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                onImport(JSON.parse(await f.text()), importMode)
              } catch {
                toast('อ่านไฟล์ JSON ไม่ได้')
              }
            }}
          />
        </div>
      </Card>
    </div>
  )
}
