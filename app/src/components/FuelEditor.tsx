import type { FuelingConfig, FuelingSummary, GelItem } from '../types/race'
import { Card, Field, NumInput, Segmented, Stat, Toggle } from './ui'
import { fmtClock, fmtHMS, uid } from '../lib/time'

interface Props {
  cfg: FuelingConfig
  summary: FuelingSummary
  onChange: (c: FuelingConfig) => void
}

export default function FuelEditor({ cfg, summary, onChange }: Props) {
  const set = (p: Partial<FuelingConfig>) => onChange({ ...cfg, ...p })
  const setGel = (id: string, p: Partial<GelItem>) => set({ gels: cfg.gels.map((g) => (g.id === id ? { ...g, ...p } : g)) })
  const cph = summary.carbsPerHour

  return (
    <Card title="แผนเติมเจล">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="จำนวนเจล" value={summary.totalGels} sub="ซอง" accent="text-gel" />
        <Stat label="คาร์บรวม" value={`${summary.totalCarbsG} g`} />
        <Stat
          label="คาร์บ/ชม."
          value={`${cph.toFixed(0)} g`}
          sub={cph < 30 ? 'ค่อนข้างน้อย' : cph > 90 ? 'สูง — ต้องฝึกท้อง' : 'อยู่ในช่วงแนะนำ'}
          accent={cph < 30 || cph > 90 ? 'text-amber-300' : 'text-zinc-50'}
        />
        <Stat label="คาเฟอีน" value={`${summary.caffeineCount} ซอง`} sub={`โซเดียม ${summary.totalSodiumMg} mg`} />
      </div>

      <div className="mt-4 space-y-3">
        <Field label="ตั้งเวลากินเจล">
          <Segmented
            value={cfg.mode}
            onChange={(v) => set({ mode: v, interval: v === 'time' ? 40 : 7, firstAt: v === 'time' ? 40 : 7 })}
            options={[
              { value: 'time', label: 'ทุก X นาที' },
              { value: 'distance', label: 'ทุก X กม.' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label={cfg.mode === 'time' ? 'ทุก (นาที)' : 'ทุก (กม.)'}>
            <NumInput value={cfg.interval} step={cfg.mode === 'time' ? 5 : 0.5} min={1} onChange={(v) => set({ interval: v ?? cfg.interval })} />
          </Field>
          <Field label={cfg.mode === 'time' ? 'เจลแรก (นาที)' : 'เจลแรก (กม.)'}>
            <NumInput value={cfg.firstAt} step={cfg.mode === 'time' ? 5 : 0.5} min={0} onChange={(v) => set({ firstAt: v ?? cfg.firstAt })} />
          </Field>
          <Field label="งดช่วงท้าย (กม.)">
            <NumInput value={cfg.stopBeforeFinishKm} step={0.5} min={0} onChange={(v) => set({ stopBeforeFinishKm: v ?? 0 })} />
          </Field>
        </div>

        <Toggle
          checked={cfg.snapEnabled}
          onChange={(v) => set({ snapEnabled: v })}
          label="Smart Snap เข้าจุดให้น้ำ"
          sub="เลื่อนเวลากินเจลไปก่อนถึงจุดน้ำ เพื่อกินแล้วดื่มน้ำตามได้ทันที"
        />
        {cfg.snapEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="เลื่อนได้ไม่เกิน (กม.)">
              <NumInput value={cfg.snapThresholdKm} step={0.25} min={0} onChange={(v) => set({ snapThresholdKm: v ?? 0 })} />
            </Field>
            <Field label={`กินก่อนถึงจุดน้ำ ${cfg.snapOffsetM} ม.`}>
              <input type="range" min={200} max={300} step={25} value={cfg.snapOffsetM} onChange={(e) => set({ snapOffsetM: Number(e.target.value) })} className="mt-2 w-full" />
            </Field>
          </div>
        )}
        <Toggle checked={cfg.caffeineSecondHalf} onChange={(v) => set({ caffeineSecondHalf: v })} label="ใช้เจลคาเฟอีนเฉพาะครึ่งหลัง" />
        <Toggle checked={cfg.preStartGel} onChange={(v) => set({ preStartGel: v })} label="กินเจลก่อนปล่อยตัว 15 นาที" />
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">เจลที่พกไป</span>
          <button className="btn text-xs" onClick={() => set({ gels: [...cfg.gels, { id: uid('gel'), name: 'เจลใหม่', carbsG: 22, sodiumMg: 40, caffeine: false }] })}>
            + เพิ่มเจล
          </button>
        </div>
        <div className="space-y-2">
          {cfg.gels.map((g) => (
            <div key={g.id} className="grid grid-cols-[1fr_4.2rem_4.8rem_auto_auto] items-center gap-1.5">
              <input className="input px-2 py-1.5 text-sm" value={g.name} onChange={(e) => setGel(g.id, { name: e.target.value })} aria-label="ชื่อเจล" />
              <label className="relative">
                <input className="input num px-2 py-1.5 pr-5 text-sm" type="number" value={g.carbsG} onChange={(e) => setGel(g.id, { carbsG: Number(e.target.value) || 0 })} aria-label="คาร์บ g" />
                <span className="pointer-events-none absolute right-1.5 top-2 text-[10px] text-zinc-500">g</span>
              </label>
              <label className="relative">
                <input className="input num px-2 py-1.5 pr-6 text-sm" type="number" value={g.sodiumMg} onChange={(e) => setGel(g.id, { sodiumMg: Number(e.target.value) || 0 })} aria-label="โซเดียม mg" />
                <span className="pointer-events-none absolute right-1.5 top-2 text-[10px] text-zinc-500">mg</span>
              </label>
              <button
                className={`rounded-lg border px-2 py-1.5 text-sm ${g.caffeine ? 'border-amber-400 bg-amber-400/15' : 'border-zinc-700 opacity-50'}`}
                onClick={() => setGel(g.id, { caffeine: !g.caffeine })}
                title="คาเฟอีน"
              >
                ☕
              </button>
              <button className="btn-ghost px-1.5 text-zinc-500 hover:text-red-400" disabled={cfg.gels.length <= 1} onClick={() => set({ gels: cfg.gels.filter((x) => x.id !== g.id) })}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {summary.events.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-[11px] text-zinc-500">
              <tr>
                <th className="px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-right">กม.</th>
                <th className="px-2 py-1.5 text-right">เวลาสะสม</th>
                <th className="px-2 py-1.5 text-right">นาฬิกา</th>
                <th className="px-2 py-1.5 text-left">เจล</th>
              </tr>
            </thead>
            <tbody className="num">
              {summary.events.map((e) => (
                <tr key={e.n} className="border-t border-zinc-800">
                  <td className="px-2 py-1.5 font-bold text-gel">{e.preStart ? 'ก่อน' : `G${e.n}`}</td>
                  <td className="px-2 py-1.5 text-right">
                    {e.preStart ? '—' : e.km.toFixed(2)}
                    {e.snappedToId && <span className="ml-1 text-water" title={`เลื่อนจาก กม. ${e.originalKm}`}>💧</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">{e.preStart ? '-0:15:00' : fmtHMS(e.elapsedSec)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtClock(e.clockSec)}</td>
                  <td className="px-2 py-1.5 font-sans text-xs">
                    {e.gel.name}
                    {e.gel.caffeine && ' ☕'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
