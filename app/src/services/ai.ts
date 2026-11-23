// ─────────────────────────────────────────────────────────────
// AI analysis — 2 ผู้ให้บริการ
//  • Claude: เมื่อเปิดในหน้า Claude artifact (capability "sample" ใช้โควต้า Claude ของผู้ใช้)
//  • Gemini: เมื่อเปิดนอก Claude — ใช้ API key ของผู้ใช้เอง (สร้างฟรีที่ aistudio.google.com)
//    key เก็บใน localStorage ของเครื่องนี้เท่านั้น
// ─────────────────────────────────────────────────────────────
type SampleFn = ((input: string, opts?: { onText?: (u: { text: string }) => void; signal?: AbortSignal; cache?: boolean }) => Promise<{ text: string; truncated: boolean }>) | null
type ClaudeGlobal = { use(name: string): Promise<unknown> }

let samplePromise: Promise<SampleFn> | undefined
export function getClaudeSample(): Promise<SampleFn> {
  const c = (window as unknown as { claude?: ClaudeGlobal }).claude
  if (!c?.use) return Promise.resolve(null)
  samplePromise ??= c.use('sample').then((x) => (x as SampleFn) ?? null).catch(() => null)
  return samplePromise
}

const GKEY = 'rp.gemini.key'
const GMODEL = 'rp.gemini.model'
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export function getGeminiSettings() {
  try {
    return { key: localStorage.getItem(GKEY) ?? '', model: localStorage.getItem(GMODEL) || DEFAULT_GEMINI_MODEL }
  } catch {
    return { key: '', model: DEFAULT_GEMINI_MODEL }
  }
}
export function setGeminiSettings(key: string, model: string) {
  try {
    if (key) localStorage.setItem(GKEY, key)
    else localStorage.removeItem(GKEY)
    localStorage.setItem(GMODEL, model || DEFAULT_GEMINI_MODEL)
  } catch {
    /* ignore */
  }
}

export async function askGemini(prompt: string, key: string, model: string, signal?: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('เชื่อมต่อ Gemini ไม่ได้ — เช็กอินเทอร์เน็ต (ถ้าเปิดในหน้า Claude จะเรียก Gemini ไม่ได้ ให้ใช้ Claude แทน)')
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (j as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
    throw new Error(res.status === 400 || res.status === 403 ? `Gemini ปฏิเสธ: ${msg} (เช็ก API key / ชื่อโมเดล)` : `Gemini error: ${msg}`)
  }
  const parts = (j as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) throw new Error('Gemini ไม่ได้ส่งคำตอบกลับมา')
  return text
}

export async function askClaude(prompt: string, onText: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const sample = await getClaudeSample()
  if (!sample) throw new Error('ใช้ Claude ได้เฉพาะตอนเปิดแอปในหน้า Claude')
  try {
    const { text } = await sample(prompt, { onText: ({ text }) => onText(text), signal, cache: false })
    return text
  } catch (e) {
    const code = (e as { code?: string }).code
    const partial = (e as { text?: string }).text
    if (code === 'cancelled') return partial ?? ''
    const msg: Record<string, string> = {
      not_granted: 'ยังไม่ได้อนุญาตให้แอปนี้ใช้ Claude',
      rate_limited: 'ใช้งานถี่เกินไป ลองใหม่อีกสักครู่',
      sampling_disabled: 'บัญชีนี้ใช้ Claude ในแอปไม่ได้',
    }
    throw new Error(msg[code ?? ''] ?? `Claude ตอบไม่สำเร็จ (${code ?? 'unknown'})`)
  }
}
