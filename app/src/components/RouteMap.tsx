import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { GelEvent, RouteAnalysis, Waypoint } from '../types/race'
import { latLonAt } from '../engine/gpxParser'
import { GEL_COLOR, WP_META, gradeColor } from '../lib/waypointMeta'

interface Props {
  route: RouteAnalysis
  waypoints: Waypoint[]
  gels: GelEvent[]
  height?: number
}

function pin(color: string, text: string, size = 22) {
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2px solid #09090b;display:flex;align-items:center;justify-content:center;font:700 11px/1 system-ui;color:#09090b;box-shadow:0 0 0 1px ${color}">${text}</div>`,
  })
}

export default function RouteMap({ route, waypoints, gels, height = 340 }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // fit เฉพาะเมื่อเปลี่ยนเส้นทาง
  useEffect(() => {
    const m = map.current
    if (!m) return
    const b = L.latLngBounds(route.points.map((p) => [p.lat, p.lon] as [number, number]))
    m.fitBounds(b, { padding: [20, 20] })
  }, [route])

  useEffect(() => {
    const g = layer.current
    if (!g) return
    g.clearLayers()
    const pts = route.points

    // เส้นทางระบายสีตามความชันรายกิโล
    let pi = 0
    for (const seg of route.segments) {
      const coords: [number, number][] = [latLonAt(pts, seg.startKm * 1000)]
      while (pi < pts.length && pts[pi].distM <= seg.startKm * 1000) pi++
      let j = pi
      while (j < pts.length && pts[j].distM < seg.endKm * 1000) coords.push([pts[j].lat, pts[j++].lon])
      coords.push(latLonAt(pts, seg.endKm * 1000))
      L.polyline(coords, { color: '#09090b', weight: 8, opacity: 0.9 }).addTo(g)
      L.polyline(coords, { color: gradeColor(seg.gradePct), weight: 4.5, opacity: 1 })
        .bindTooltip(`กม. ${seg.startKm.toFixed(0)}–${seg.endKm.toFixed(1)} · ความชัน ${seg.gradePct.toFixed(1)}%`, { sticky: true })
        .addTo(g)
    }

    // km markers
    const total = route.totalDistanceKm
    const step = total > 30 ? 5 : total > 12 ? 2 : 1
    for (let k = step; k < total - 0.2; k += step) {
      const [lat, lon] = latLonAt(pts, k * 1000)
      L.marker([lat, lon], { icon: L.divIcon({ className: '', html: `<span class="km-label">${k}</span>`, iconAnchor: [8, 8] }), interactive: false }).addTo(g)
    }

    // waypoints
    for (const w of waypoints) {
      const meta = WP_META[w.type]
      const [lat, lon] = latLonAt(pts, w.km * 1000)
      L.marker([lat, lon], { icon: pin(meta.color, '', 14) })
        .bindTooltip(`${meta.icon} ${w.label || meta.th} · กม. ${w.km.toFixed(1)}`)
        .addTo(g)
    }
    // gels
    for (const e of gels.filter((x) => !x.preStart)) {
      const [lat, lon] = latLonAt(pts, e.km * 1000)
      L.marker([lat, lon], { icon: pin(GEL_COLOR, String(e.n), 20), zIndexOffset: 500 })
        .bindTooltip(`เจล #${e.n} ${e.gel.name}${e.gel.caffeine ? ' ☕' : ''} · กม. ${e.km.toFixed(2)}`)
        .addTo(g)
    }
    // start / finish
    const s = pts[0]
    const f = pts[pts.length - 1]
    const loop = Math.hypot(s.lat - f.lat, s.lon - f.lon) < 0.0008
    L.marker([s.lat, s.lon], { icon: pin('#4ade80', 'S', 24), zIndexOffset: 1000 }).bindTooltip('จุดปล่อยตัว').addTo(g)
    L.marker([f.lat, f.lon], { icon: pin('#f4f4f5', 'F', 24), zIndexOffset: loop ? 900 : 1000 }).bindTooltip('เส้นชัย').addTo(g)
  }, [route, waypoints, gels])

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-xl border border-zinc-800" />
}
