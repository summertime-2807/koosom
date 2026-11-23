import type { ReactNode } from 'react'

/** Markdown แบบย่อ: #/##/### หัวข้อ, - * bullet, 1. ลำดับ, **ตัวหนา**, `code` — ไม่ใช้ innerHTML */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    out.push(t.startsWith('**') ? <b key={k++}>{t.slice(2, -2)}</b> : <code key={k++} className="rounded bg-zinc-800 px-1">{t.slice(1, -1)}</code>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={blocks.length} className={`my-1.5 space-y-1 pl-5 ${list.ordered ? 'list-decimal' : 'list-disc'} marker:text-zinc-500`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    )
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const lvl = h[1].length
      blocks.push(
        <div key={blocks.length} className={lvl <= 2 ? 'mt-4 mb-1 text-base font-semibold text-zinc-50' : 'mt-3 mb-1 text-sm font-semibold text-zinc-200'}>
          {inline(h[2])}
        </div>,
      )
    } else if (ul || ol) {
      const ordered = !!ol && !ul
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push((ul ?? ol)![1])
    } else if (!line.trim()) flush()
    else {
      flush()
      blocks.push(
        <p key={blocks.length} className="my-1.5">
          {inline(line)}
        </p>,
      )
    }
  }
  flush()
  return <div className="text-sm leading-relaxed text-zinc-300">{blocks}</div>
}
