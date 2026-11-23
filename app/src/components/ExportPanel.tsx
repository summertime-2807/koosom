import { forwardRef, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { FuelingSummary, PacingResult, RaceMeta, RouteAnalysis, SplitRow, Waypoint } from '../types/race'
import { Card, Toggle } from './ui'
import { fmtClock, fmtHMS, fmtPace, fmtThaiDate, parseHM } from '../lib/time'
import { milestoneSplits } from '../engine/pacingEngine'
import { copyText, dataUrlToBlob, downloadFile } from '../services/download'
import { splitsToCsv, splitsToWatchText } from '../lib/exportData'

interface Props {
  meta: RaceMeta
  route: RouteAnalysis
  pacing: PacingResult
  rows: SplitRow[]
  fueling: FuelingSummary
  waypoints: Waypoint[]
  toast: (m: string) => void
}

const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'race'

/** เนินสำคัญ: รวมกิโลที่ขึ้นติดกัน แล้วเลือก 3 อันดับที่ขึ้นมากสุด */
export function keyClimbs(rows: SplitRow[], n = 3) {
  const climbs: { fromKm: number; toKm: number; gain: number; maxGrade: number }[] = []
  let cur: (typeof climbs)[number] | null = null
  let prevKm = 0
  for (const r of rows) {
    if (r.gainM >= 3) {
      if (cur && Math.abs(cur.toKm - prevKm) < 1e-6) {
        cur.toKm = r.km
        cur.gain += r.gainM
        cur.maxGrade = Math.max(cur.maxGrade, r.gradePct)
      } else {
        cur = { fromKm: prevKm, toKm: r.km, gain: r.gainM, maxGrade: r.gradePct }
        climbs.push(cur)
      }
    }
    prevKm = r.km
  }
  return climbs.sort((a, b) => b.gain - a.gain).slice(0, n).sort((a, b) => a.fromKm - b.fromKm)
}

// ───────────────── Lock Screen Card (390×845 = 9:19.5) ─────────────────
export const LockCard = forwardRef<HTMLDivElement, Omit<Props, 'toast' | 'waypoints' | 'route'> & { clockSpace: boolean; totalKm: number; gainM: number }>(
  function LockCard({ meta, pacing, rows, fueling, clockSpace, totalKm, gainM }, ref) {
    const ms = milestoneSplits(rows, 5)
    const climbs = keyClimbs(rows)
    const start = parseHM(meta.startTime)
    const dense = ms.length > 6 || fueling.events.length > 6
    return (
      <div
        ref={ref}
        style={{ width: 390, height: 845, fontFamily: '"IBM Plex Sans Thai", system-ui, sans-serif' }}
        className="flex flex-col overflow-hidden bg-black px-6 pb-8 text-white"
      >
        <div style={{ height: clockSpace ? (dense ? 200 : 250) : 32 }} className="flex shrink-0 items-end justify-center pb-3">
          {clockSpace && <span className="text-[11px] tracking-[0.3em] text-zinc-600">RACE DAY</span>}
        </div>
        <div className="text-[13px] text-zinc-400">
          {fmtThaiDate(meta.date)} · ปล่อยตัว {meta.startTime} · {totalKm.toFixed(1)} กม.{gainM >= 1 ? ` · +${gainM.toFixed(0)} ม.` : ''}
        </div>
        <div className="mt-0.5 text-[24px] font-bold leading-tight">{meta.name || 'แผนวิ่งของฉัน'}</div>
        <div className="mt-3 flex items-end gap-4 border-b border-zinc-800 pb-3">
          <div>
            <div className="text-[11px] text-zinc-500">เวลาเป้าหมาย</div>
            <div className="font-mono text-[40px] font-bold leading-none tabular-nums">{fmtHMS(pacing.totalSec)}</div>
          </div>
          <div className="pb-1">
            <div className="text-[11px] text-zinc-500">เพซเฉลี่ย</div>
            <div className="font-mono text-[22px] font-semibold tabular-nums">{fmtPace(pacing.avgPaceSec)}</div>
          </div>
        </div>

        <div className={`mt-3 grid grid-cols-[3.2rem_1fr_1fr] font-mono tabular-nums ${dense ? 'gap-y-0 text-[13.5px]' : 'gap-y-1 text-[15px]'}`}>
          <div className="text-[11px] text-zinc-500">กม.</div>
          <div className="text-right text-[11px] text-zinc-500">เวลาสะสม</div>
          <div className="text-right text-[11px] text-zinc-500">นาฬิกา</div>
          {ms.map((m, i) => (
            <div key={m.km} className="contents">
              <div className={i === ms.length - 1 ? 'font-bold text-white' : 'text-zinc-300'}>{i === ms.length - 1 ? 'FIN' : `${m.km}K`}</div>
              <div className={`text-right ${i === ms.length - 1 ? 'font-bold' : ''}`}>{fmtHMS(m.elapsedSec)}</div>
              <div className="text-right text-zinc-400">{fmtClock(start + m.elapsedSec)}</div>
            </div>
          ))}
        </div>

        {fueling.events.length > 0 && (
          <div className={`rounded-xl border border-amber-400/40 bg-amber-400/10 ${dense ? 'mt-3 p-2.5' : 'mt-4 p-3'}`}>
            <div className="mb-1 text-[12px] font-semibold text-amber-300">
              เจล {fueling.totalGels} ซอง · {fueling.carbsPerHour.toFixed(0)} g/ชม.
            </div>
            <div className="grid grid-cols-3 gap-x-1 gap-y-0.5 whitespace-nowrap font-mono text-[12.5px] tabular-nums text-amber-100">
              {fueling.events.slice(0, 9).map((e) => (
                <div key={e.n}>
                  {e.preStart ? 'ก่อน' : `${e.km.toFixed(1)}K`} <span className="text-amber-300/70">{fmtClock(e.clockSec)}</span>
                  {e.gel.caffeine ? '☕' : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        {climbs.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] text-zinc-500">เนิน/สะพานสำคัญ</div>
            {climbs.map((c) => (
              <div key={c.fromKm} className="font-mono text-[14px] tabular-nums text-red-300">
                กม. {c.fromKm.toFixed(0)}–{c.toKm.toFixed(0)} · +{c.gain.toFixed(0)} ม. · {c.maxGrade.toFixed(1)}%
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto pt-3 text-center text-[10px] text-zinc-700">ทำตามแผน · ดื่มน้ำทุกจุด · สนุกกับการวิ่ง</div>
      </div>
    )
  },
)

// ───────────────── Wrist Pace Band ─────────────────
export const WristBand = forwardRef<HTMLDivElement, { meta: RaceMeta; rows: SplitRow[]; totalSec: number; forPrint?: boolean }>(function WristBand(
  { meta, rows, totalSec, forPrint },
  ref,
) {
  const perCol = rows.length > 24 ? Math.ceil(rows.length / 2) : rows.length
  const cols = [rows.slice(0, perCol), rows.slice(perCol)].filter((c) => c.length)
  const ink = forPrint ? 'text-black border-black' : 'text-zinc-950 border-zinc-950'
  return (
    <div ref={ref} className={`inline-flex gap-3 bg-white p-2 ${ink}`} style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
      {cols.map((col, ci) => (
        <div key={ci} className="border-2 border-dashed border-current p-1.5" style={{ width: '62mm' }}>
          <div className="mb-1 truncate border-b border-current pb-0.5 text-center text-[9px] font-bold" style={{ fontFamily: '"IBM Plex Sans Thai", sans-serif' }}>
            {meta.name} · {fmtHMS(totalSec)} {cols.length > 1 ? `(${ci + 1}/2)` : ''}
          </div>
          <table className="w-full text-[10px] leading-[1.25] tabular-nums">
            <tbody>
              {col.map((r) => (
                <tr key={r.index} className={Math.abs(r.km % 5) < 1e-6 ? 'font-bold' : ''} style={{ borderTop: Math.abs(r.km % 5) < 1e-6 ? '1px solid currentColor' : undefined }}>
                  <td className="pr-1">{r.lengthKm < 0.999 ? r.km.toFixed(1) : r.km.toFixed(0)}</td>
                  <td className="pr-1 text-right">{fmtPace(r.paceSec)}</td>
                  <td className="text-right">{fmtHMS(r.elapsedSec)}</td>
                  <td className="w-3 pl-0.5 text-center">{r.gels.length ? '◆' : r.waypoints.some((w) => w.type === 'water' || w.type === 'electrolyte') ? '•' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ci === cols.length - 1 && <div className="mt-1 text-[8px]" style={{ fontFamily: '"IBM Plex Sans Thai", sans-serif' }}>◆ เจล • จุดน้ำ</div>}
        </div>
      ))}
    </div>
  )
})

export default function ExportPanel(props: Props) {
  const { meta, route, pacing, rows, fueling, toast } = props
  const cardRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const [clockSpace, setClockSpace] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = useMemo(() => slug(meta.name), [meta.name])

  async function exportPng(node: HTMLElement | null, file: string, ratio: number) {
    if (!node) return
    setBusy(true)
    try {
      const url = await toPng(node, { pixelRatio: ratio, cacheBust: true, skipFonts: true, backgroundColor: node === cardRef.current ? '#000' : '#fff' })
      setPreview(url)
      await downloadFile(file, await dataUrlToBlob(url), 'image/png')
    } catch (e) {
      toast('สร้างรูปไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card title="การ์ดหน้าจอล็อก (PNG)" right={<span className="chip text-zinc-400">9:19.5</span>}>
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="mx-auto shrink-0 overflow-hidden rounded-[28px] border-4 border-zinc-800" style={{ width: 390 * 0.62, height: 845 * 0.62 }}>
            <div style={{ transform: 'scale(0.62)', transformOrigin: 'top left' }}>
              <LockCard ref={cardRef} {...{ meta, pacing, rows, fueling, clockSpace, totalKm: route.totalDistanceKm, gainM: route.gainM }} />
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <Toggle checked={clockSpace} onChange={setClockSpace} label="เว้นที่ด้านบนให้นาฬิกาหน้าจอล็อก" />
            <button className="btn-primary w-full" disabled={busy} onClick={() => exportPng(cardRef.current, `${name}-lockscreen.png`, 3)}>
              {busy ? 'กำลังสร้าง…' : '⬇ บันทึกเป็นรูป PNG'}
            </button>
            <p className="text-xs text-zinc-500">ได้รูปความละเอียด 1170×2535 (iPhone) — ตั้งเป็นภาพหน้าจอล็อกเช้าวันแข่ง</p>
            {preview && (
              <div className="rounded-xl border border-zinc-800 p-2">
                <p className="mb-2 text-xs text-zinc-400">ถ้าไฟล์ไม่ถูกดาวน์โหลด กดค้างที่รูปเพื่อบันทึก</p>
                <img src={preview} alt="ภาพที่สร้าง" className="mx-auto max-h-72 rounded-lg" />
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title="สายรัดข้อมือเพซ (Pace Band)">
        <div className="overflow-x-auto rounded-xl bg-white p-2">
          <WristBand ref={bandRef} meta={meta} rows={rows} totalSec={pacing.totalSec} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn" onClick={() => window.print()}>
            🖨 พิมพ์
          </button>
          <button className="btn" disabled={busy} onClick={() => exportPng(bandRef.current, `${name}-paceband.png`, 4)}>
            ⬇ PNG
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">พิมพ์ A4 แล้วตัดตามเส้นประ หุ้มเทปใสกันเหงื่อ</p>
      </Card>

      <Card title="ข้อมูลสำหรับตั้งนาฬิกา (Garmin PacePro / Watch alert)">
        <pre className="max-h-56 overflow-auto rounded-xl bg-zinc-950 p-3 text-xs leading-5 text-zinc-300">{splitsToWatchText(rows)}</pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn" onClick={async () => toast((await copyText(splitsToWatchText(rows))) ? 'คัดลอกตารางแล้ว' : 'คัดลอกไม่สำเร็จ')}>
            📋 คัดลอกตาราง
          </button>
          <button className="btn" onClick={() => downloadFile(`${name}-splits.csv`, splitsToCsv(rows), 'text/csv')}>
            ⬇ CSV
          </button>
        </div>
      </Card>
    </div>
  )
}
