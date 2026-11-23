import type { ReactNode } from 'react'
import { fmtHMS, parseHMS } from '../lib/time'
import { useEffect, useState } from 'react'

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="h2">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, children, hint, className = '' }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  )
}

export function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  allowEmpty = false,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  step?: number
  min?: number
  max?: number
  placeholder?: string
  allowEmpty?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    if (value == null) {
      setText('')
      return
    }
    setText((t) => (Number(t) === value ? t : String(value)))
  }, [value])
  return (
    <input
      className="input"
      inputMode="decimal"
      type="number"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value === '') {
          if (allowEmpty) onChange(undefined)
          return
        }
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

/** อินพุตเวลา HH:MM:SS ที่ตรวจรูปแบบ */
export function DurationInput({ valueSec, onChange }: { valueSec: number; onChange: (sec: number) => void }) {
  const [text, setText] = useState(fmtHMS(valueSec))
  useEffect(() => {
    setText((t) => (parseHMS(t) === valueSec ? t : fmtHMS(valueSec)))
  }, [valueSec])
  const bad = !Number.isFinite(parseHMS(text)) || parseHMS(text) <= 0
  return (
    <input
      className={`input font-mono ${bad ? 'border-red-500' : ''}`}
      inputMode="numeric"
      placeholder="H:MM:SS"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const s = parseHMS(e.target.value)
        if (Number.isFinite(s) && s > 0) onChange(s)
      }}
      onBlur={() => !bad && setText(fmtHMS(parseHMS(text)))}
    />
  )
}

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left"
      aria-pressed={checked}
    >
      <span>
        <span className="block text-sm text-zinc-100">{label}</span>
        {sub && <span className="block text-xs text-zinc-500">{sub}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-zinc-100' : 'bg-zinc-700'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full transition ${checked ? 'left-[22px] bg-zinc-950' : 'left-0.5 bg-zinc-300'}`} />
      </span>
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1.5 text-sm transition ${value === o.value ? 'bg-zinc-100 font-semibold text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub, accent }: { label: ReactNode; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`num text-lg font-semibold leading-tight ${accent ?? 'text-zinc-50'}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  )
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="no-print fixed inset-x-0 bottom-24 z-[1200] flex justify-center px-4 md:bottom-6">
      <div className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm shadow-xl">{msg}</div>
    </div>
  )
}
