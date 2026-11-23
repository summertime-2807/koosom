import type { SplitRow } from '../types/race'
import { fmtClock, fmtHMS, fmtPace, signed } from '../lib/time'
import { GEL_COLOR, WP_META, gradeColor } from '../lib/waypointMeta'

export default function SplitTable({ rows, avgPaceSec }: { rows: SplitRow[]; avgPaceSec: number }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-0 bg-zinc-950 text-[11px] uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-2 py-2 text-left">กม.</th>
            <th className="px-2 py-2 text-right">ความชัน</th>
            <th className="px-2 py-2 text-right">เพซ</th>
            <th className="px-2 py-2 text-right">สปลิต</th>
            <th className="px-2 py-2 text-right">เวลาสะสม</th>
            <th className="px-2 py-2 text-right">นาฬิกา</th>
            <th className="px-2 py-2 text-left">จุดสำคัญ / เจล</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((r) => {
            const diff = r.paceSec - avgPaceSec
            const milestone = Math.abs(r.km % 5) < 1e-6 || r.index === rows.length - 1
            return (
              <tr key={r.index} className={`border-t border-zinc-800/80 ${milestone ? 'bg-zinc-900/70' : ''}`}>
                <td className="px-2 py-1.5 font-semibold">{r.lengthKm < 0.999 ? r.km.toFixed(2) : r.km.toFixed(0)}</td>
                <td className="px-2 py-1.5 text-right">
                  <span style={{ color: gradeColor(r.gradePct) }}>{signed(r.gradePct, 1)}%</span>
                  <span className="ml-1 text-[11px] text-zinc-500">
                    +{r.gainM.toFixed(0)}/-{r.lossM.toFixed(0)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-semibold">
                  {fmtPace(r.paceSec)}
                  {Math.abs(diff) >= 1 && (
                    <span className={`ml-1 text-[10px] ${diff > 0 ? 'text-red-300' : 'text-green-300'}`}>
                      {diff > 0 ? '+' : '−'}
                      {Math.round(Math.abs(diff))}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-300">{fmtHMS(r.splitSec).replace(/^0:/, '')}</td>
                <td className="px-2 py-1.5 text-right">{fmtHMS(r.elapsedSec)}</td>
                <td className="px-2 py-1.5 text-right text-zinc-400">{fmtClock(r.clockSec)}</td>
                <td className="px-2 py-1.5 font-sans text-xs">
                  <div className="flex flex-wrap gap-1">
                    {r.gels.map((g) => (
                      <span key={`g${g.n}`} className="chip border-amber-500/50 font-semibold" style={{ color: GEL_COLOR }}>
                        {g.preStart ? 'เจลก่อนสตาร์ท' : `G${g.n} @${g.km.toFixed(2)}`}
                        {g.gel.caffeine && '☕'}
                      </span>
                    ))}
                    {r.waypoints.map((w) => (
                      <span key={w.id} className="chip" style={{ borderColor: `${WP_META[w.type].color}66`, color: WP_META[w.type].color }}>
                        {WP_META[w.type].icon} {w.label || WP_META[w.type].short} {w.km.toFixed(1)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
