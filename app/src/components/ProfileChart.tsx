import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { GelEvent, RouteAnalysis, SplitRow, Waypoint } from '../types/race'
import { eleAt } from '../engine/gpxParser'
import { fmtPace } from '../lib/time'
import { GEL_COLOR, WP_META } from '../lib/waypointMeta'

interface Props {
  route: RouteAnalysis
  rows: SplitRow[]
  waypoints: Waypoint[]
  gels: GelEvent[]
  height?: number
}

export default function ProfileChart({ route, rows, waypoints, gels, height = 260 }: Props) {
  const data = useMemo(() => {
    const total = route.totalDistanceKm
    const step = total > 30 ? 0.2 : 0.1
    const out: { km: number; ele: number; pace: number }[] = []
    let ri = 0
    for (let k = 0; k <= total + 1e-9; k += step) {
      const km = Math.min(total, Math.round(k * 1000) / 1000)
      while (ri < rows.length - 1 && km > rows[ri].km + 1e-9) ri++
      out.push({ km, ele: Math.round(eleAt(route.points, km * 1000) * 10) / 10, pace: rows[ri]?.paceSec ?? 0 })
    }
    if (out[out.length - 1].km < total) out.push({ km: total, ele: eleAt(route.points, total * 1000), pace: rows.at(-1)?.paceSec ?? 0 })
    return out
  }, [route, rows])

  const paces = rows.map((r) => r.paceSec).filter((p) => p > 0)
  const pMin = Math.floor((Math.min(...paces) - 10) / 10) * 10
  const pMax = Math.ceil((Math.max(...paces) + 10) / 10) * 10
  const eMin = Math.floor(route.minEle - 2)
  const eMax = Math.ceil(Math.max(route.maxEle + 5, route.minEle + 20))

  return (
    <div style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a1a1aa" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#a1a1aa" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="km"
            type="number"
            domain={[0, route.totalDistanceKm]}
            tickCount={8}
            tickFormatter={(v: number) => `${Math.round(v)}`}
            stroke="#52525b"
            tick={{ fill: '#a1a1aa', fontSize: 11 }}
            allowDecimals={false}
          />
          <YAxis yAxisId="ele" domain={[eMin, eMax]} stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} width={40} unit="ม." />
          <YAxis
            yAxisId="pace"
            orientation="right"
            reversed
            domain={[pMin, pMax]}
            stroke="#52525b"
            tick={{ fill: '#e4e4e7', fontSize: 10 }}
            tickFormatter={(v: number) => fmtPace(v)}
            width={40}
          />
          <Tooltip
            contentStyle={{ background: '#09090b', border: '1px solid #3f3f46', borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: '#a1a1aa' }}
            labelFormatter={(v) => `กม. ${Number(v).toFixed(1)}`}
            formatter={(v, name) => (name === 'pace' ? [`${fmtPace(Number(v))} /กม.`, 'เพซ'] : [`${Number(v).toFixed(1)} ม.`, 'ความสูง'])}
          />
          <Area yAxisId="ele" type="monotone" dataKey="ele" stroke="#d4d4d8" strokeWidth={1.2} fill="url(#eleFill)" isAnimationActive={false} />
          <Line yAxisId="pace" type="stepBefore" dataKey="pace" stroke="#f4f4f5" strokeWidth={2} dot={false} isAnimationActive={false} />
          {waypoints
            .filter((w) => w.type === 'water' || w.type === 'electrolyte')
            .map((w) => (
              <ReferenceLine key={w.id} yAxisId="ele" x={w.km} stroke={WP_META[w.type].color} strokeDasharray="2 3" strokeOpacity={0.7} />
            ))}
          {waypoints
            .filter((w) => w.type !== 'water' && w.type !== 'electrolyte')
            .map((w) => (
              <ReferenceLine key={w.id} yAxisId="ele" x={w.km} stroke={WP_META[w.type].color} strokeOpacity={0.5} label={{ value: WP_META[w.type].icon, position: 'insideTop', fontSize: 11 }} />
            ))}
          {gels
            .filter((g) => !g.preStart)
            .map((g) => (
              <ReferenceLine
                key={`g${g.n}`}
                yAxisId="ele"
                x={g.km}
                stroke={GEL_COLOR}
                strokeWidth={2}
                label={{ value: `G${g.n}${g.gel.caffeine ? '☕' : ''}`, position: 'top', fill: GEL_COLOR, fontSize: 11, fontWeight: 700 }}
              />
            ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
