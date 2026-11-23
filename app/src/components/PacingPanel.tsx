import type { PacingConfig, PacingResult, RaceMeta } from '../types/race'
import { Card, DurationInput, Field, NumInput, Segmented, Toggle } from './ui'
import { fmtHMS, fmtPace } from '../lib/time'

interface Props {
  meta: RaceMeta
  pacing: PacingConfig
  result: PacingResult
  distanceKm: number
  onMeta: (m: RaceMeta) => void
  onPacing: (p: PacingConfig) => void
}

const PRESETS: Record<string, string[]> = {
  '10': ['0:45:00', '0:50:00', '0:55:00', '1:00:00', '1:10:00'],
  '21': ['1:30:00', '1:45:00', '2:00:00', '2:15:00', '2:30:00'],
  '42': ['3:00:00', '3:30:00', '4:00:00', '4:30:00', '5:00:00'],
}

const HEAT_COLORS = {
  none: 'border-zinc-700 text-zinc-300',
  low: 'border-lime-700/60 bg-lime-950/30 text-lime-200',
  moderate: 'border-amber-600/60 bg-amber-950/30 text-amber-200',
  high: 'border-orange-600/60 bg-orange-950/40 text-orange-200',
  extreme: 'border-red-600/70 bg-red-950/40 text-red-200',
}
const HEAT_TH = { none: 'สบาย', low: 'อุ่น', moderate: 'ร้อนชื้น', high: 'ร้อนมาก', extreme: 'อันตราย' }

export default function PacingPanel({ meta, pacing, result, distanceKm, onMeta, onPacing }: Props) {
  const set = (p: Partial<PacingConfig>) => onPacing({ ...pacing, ...p })
  const presetKey = distanceKm > 30 ? '42' : distanceKm > 12 ? '21' : '10'
  const heat = result.heat

  return (
    <Card title="ข้อมูลงาน & เป้าหมาย">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ชื่องานวิ่ง" className="col-span-2">
          <input className="input" value={meta.name} onChange={(e) => onMeta({ ...meta, name: e.target.value })} />
        </Field>
        <Field label="วันแข่ง">
          <input className="input" type="date" value={meta.date} onChange={(e) => onMeta({ ...meta, date: e.target.value })} />
        </Field>
        <Field label="เวลาปล่อยตัว">
          <input className="input" type="time" value={meta.startTime} onChange={(e) => onMeta({ ...meta, startTime: e.target.value })} />
        </Field>
        <Field label="เวลาเป้าหมาย (ชม:นาที:วินาที)" className="col-span-2">
          <DurationInput valueSec={pacing.targetSec} onChange={(s) => set({ targetSec: s })} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS[presetKey].map((t) => (
              <button key={t} className="chip num hover:border-zinc-400" onClick={() => set({ targetSec: t.split(':').reduce((a, b) => a * 60 + Number(b), 0) })}>
                {t.replace(/^0:/, '')}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="mt-3 rounded-xl bg-zinc-950/70 p-3 text-center">
        <div className="text-[11px] text-zinc-500">เพซเฉลี่ย</div>
        <div className="num text-3xl font-bold">
          {fmtPace(result.avgPaceSec)} <span className="text-base font-normal text-zinc-500">/กม.</span>
        </div>
        <div className="num text-xs text-zinc-500">
          {distanceKm.toFixed(2)} กม. · {fmtHMS(result.totalSec)}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="กลยุทธ์การแบ่งเพซ">
          <Segmented
            value={pacing.strategy}
            onChange={(v) => set({ strategy: v })}
            options={[
              { value: 'even', label: 'เท่ากัน' },
              { value: 'negative', label: 'Negative' },
              { value: 'positive', label: 'Positive' },
            ]}
          />
        </Field>
        {pacing.strategy !== 'even' && (
          <Field label={`ครึ่งหลัง${pacing.strategy === 'negative' ? 'เร็วกว่า' : 'ช้ากว่า'}ครึ่งแรก ${pacing.splitPct}%`}>
            <input type="range" min={1} max={5} step={0.5} value={pacing.splitPct} onChange={(e) => set({ splitPct: Number(e.target.value) })} className="w-full" />
          </Field>
        )}
        <Toggle
          checked={pacing.gapEnabled}
          onChange={(v) => set({ gapEnabled: v })}
          label="ปรับเพซตามความชัน (GAP)"
          sub="ขึ้นเนินช้าลง ลงเนินเร็วขึ้น — เวลารวมยังตรงเป้าเป๊ะ"
        />
        {pacing.gapEnabled && (
          <Field label={`ความแรงของการปรับ ${pacing.gapStrength}%`}>
            <input type="range" min={25} max={150} step={25} value={pacing.gapStrength} onChange={(e) => set({ gapStrength: Number(e.target.value) })} className="w-full" />
          </Field>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="mb-2 text-sm font-medium">สภาพอากาศ (ไม่บังคับ)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="อุณหภูมิ (°C)">
            <NumInput value={pacing.tempC} allowEmpty onChange={(v) => set({ tempC: v })} placeholder="27" />
          </Field>
          <Field label="ความชื้น (%)">
            <NumInput value={pacing.humidity} allowEmpty min={0} max={100} onChange={(v) => set({ humidity: v })} placeholder="80" />
          </Field>
        </div>
        {heat && (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${HEAT_COLORS[heat.level]}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">🌡 {HEAT_TH[heat.level]}</span>
              <span className="num text-xs opacity-80">
                จุดน้ำค้าง {heat.dewPointC}°C · ดัชนี {heat.index}
              </span>
            </div>
            {heat.slowdownPct > 0 ? (
              <>
                <p className="mt-1 text-xs opacity-90">
                  อากาศแบบนี้มักทำให้ช้าลง ~{heat.slowdownPct}% เป้าที่สมจริงคือ{' '}
                  <b className="num">{fmtHMS(heat.adjustedTargetSec)}</b> (เพซ <b className="num">{fmtPace(heat.adjustedPaceSec)}</b>/กม.)
                </p>
                <button className="btn mt-2 w-full text-xs" onClick={() => set({ targetSec: heat.adjustedTargetSec })}>
                  ใช้เวลาที่ปรับตามอากาศเป็นเป้าหมาย
                </button>
              </>
            ) : (
              <p className="mt-1 text-xs opacity-80">อากาศไม่น่าส่งผลต่อเพซมาก</p>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
