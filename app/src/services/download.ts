// ดาวน์โหลดไฟล์ — ใช้ capability "downloads" เมื่อรันเป็น Claude artifact,
// ไม่งั้นใช้ <a download> ปกติ
type DownloadsNs = { save(req: { filename: string; data: string | Blob }): Promise<unknown> }
type ClaudeGlobal = { use(name: string): Promise<unknown> }

let nsPromise: Promise<DownloadsNs | null> | undefined
function claudeDownloads(): Promise<DownloadsNs | null> {
  const c = (window as unknown as { claude?: ClaudeGlobal }).claude
  if (!c?.use) return Promise.resolve(null)
  nsPromise ??= c.use('downloads').then((x) => (x as DownloadsNs) ?? null).catch(() => null)
  return nsPromise
}

export async function downloadFile(filename: string, data: string | Blob, mime = 'text/plain'): Promise<void> {
  const ns = await claudeDownloads()
  if (ns) {
    try {
      await ns.save({ filename, data })
      return
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (code === 'declined') return
      // ตกไปใช้วิธีปกติ
    }
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
