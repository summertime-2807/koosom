// ─────────────────────────────────────────────────────────────
// ผู้ใช้หลายคน (เบต้าเพื่อน/ครอบครัว) — เก็บใน Cloudflare KV
//  • เจ้าของ (LINE_USER_ID) ใช้ secrets เดิม ไม่ต้องลงทะเบียน
//  • คนอื่นเข้าได้ด้วยรหัสเชิญจากเจ้าของเท่านั้น → ลงทะเบียนในหน้าเว็บ (ยินยอม PDPA + คีย์ Intervals ของตัวเอง)
//  • คีย์ Intervals เข้ารหัส AES-GCM (กุญแจได้จาก channel secret) ก่อนเก็บ
// ─────────────────────────────────────────────────────────────

export type Sport = 'run' | 'badminton'

export interface UserRec {
  uid: string
  name: string
  athleteId: string
  keyEnc: string
  sport: Sport
  /** รับข้อความอัตโนมัติ (ตื่นแล้ว/สรุปคืน) — ใช้โควตา push ของ LINE */
  push: boolean
  consentAt: string
  createdAt: string
  invitedBy?: string
}

export interface User {
  uid: string
  isOwner: boolean
  name: string
  athleteId: string
  apiKey: string
  sport: Sport
  push: boolean
}

/** KV ขั้นต่ำที่ใช้ (เข้ากันได้กับ Cloudflare KVNamespace) */
export interface KVLike {
  get(key: string): Promise<string | null>
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(opts?: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}

export interface UserEnv {
  LINE_CHANNEL_SECRET: string
  LINE_USER_ID?: string
  INTERVALS_ATHLETE_ID: string
  INTERVALS_API_KEY: string
  KV?: KVLike
}

const USER_PREFIX = 'user:'
const INVITE_PREFIX = 'invite:'
const OWNER_PREFS = 'owner:prefs'

// ── เข้ารหัส ──
async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:koosom-user-key`))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function encrypt(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), new TextEncoder().encode(plain)))
  return `${b64(iv)}.${b64(ct)}`
}
export async function decrypt(secret: string, enc: string): Promise<string> {
  const [iv, ct] = enc.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(secret), unb64(ct))
  return new TextDecoder().decode(pt)
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── ผู้ใช้ ──
export const isOwnerUid = (env: UserEnv, uid: string) => !!env.LINE_USER_ID && uid === env.LINE_USER_ID

export async function getUser(env: UserEnv, uid: string): Promise<User | null> {
  if (isOwnerUid(env, uid)) {
    const prefs = env.KV ? ((await env.KV.get(OWNER_PREFS, 'json')) as Partial<UserRec> | null) : null
    return { uid, isOwner: true, name: prefs?.name ?? 'เจ้าของ', athleteId: env.INTERVALS_ATHLETE_ID, apiKey: env.INTERVALS_API_KEY, sport: prefs?.sport ?? 'run', push: true }
  }
  if (!env.KV || !uid) return null
  const rec = (await env.KV.get(`${USER_PREFIX}${uid}`, 'json')) as UserRec | null
  if (!rec) return null
  return { uid, isOwner: false, name: rec.name, athleteId: rec.athleteId, apiKey: await decrypt(env.LINE_CHANNEL_SECRET, rec.keyEnc), sport: rec.sport, push: rec.push }
}

export async function saveUser(env: UserEnv, rec: Omit<UserRec, 'keyEnc'> & { apiKey: string }): Promise<void> {
  if (!env.KV) throw new Error('KV ไม่พร้อม')
  const { apiKey, ...rest } = rec
  const stored: UserRec = { ...rest, keyEnc: await encrypt(env.LINE_CHANNEL_SECRET, apiKey) }
  await env.KV.put(`${USER_PREFIX}${rec.uid}`, JSON.stringify(stored))
}

/** แก้ค่าตั้งค่า (กีฬา/รับข้อความ/ชื่อ) — เจ้าของเก็บแยกใน owner:prefs */
export async function updateUser(env: UserEnv, uid: string, patch: Partial<Pick<UserRec, 'sport' | 'push' | 'name'>>): Promise<void> {
  if (!env.KV) return
  if (isOwnerUid(env, uid)) {
    const prev = ((await env.KV.get(OWNER_PREFS, 'json')) as Partial<UserRec> | null) ?? {}
    await env.KV.put(OWNER_PREFS, JSON.stringify({ ...prev, ...patch }))
    return
  }
  const rec = (await env.KV.get(`${USER_PREFIX}${uid}`, 'json')) as UserRec | null
  if (!rec) return
  await env.KV.put(`${USER_PREFIX}${uid}`, JSON.stringify({ ...rec, ...patch }))
}

export async function deleteUser(env: UserEnv, uid: string): Promise<boolean> {
  if (!env.KV || isOwnerUid(env, uid)) return false
  await env.KV.delete(`${USER_PREFIX}${uid}`)
  // ลบ token/สถานะที่ผูกกับผู้ใช้
  const keys = await env.KV.list({ prefix: `u:${uid}:` })
  await Promise.all(keys.keys.map((k: { name: string }) => env.KV!.delete(k.name)))
  return true
}

export async function listMembers(env: UserEnv): Promise<UserRec[]> {
  if (!env.KV) return []
  const out: UserRec[] = []
  let cursor: string | undefined
  do {
    const page = await env.KV.list({ prefix: USER_PREFIX, cursor })
    for (const k of page.keys) {
      const rec = (await env.KV.get(k.name, 'json')) as UserRec | null
      if (rec) out.push(rec)
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return out
}

/** key ใน KV ต่อผู้ใช้ (เจ้าของใช้ key เดิม เพื่อไม่ต้องเชื่อม Google ใหม่) */
export const ukey = (u: Pick<User, 'uid' | 'isOwner'>, base: string) => (u.isOwner ? base : `u:${u.uid}:${base}`)

// ── รหัสเชิญ ──
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export async function createInvite(env: UserEnv, by: string, sport: Sport = 'run'): Promise<string> {
  if (!env.KV) throw new Error('KV ไม่พร้อม')
  const rnd = crypto.getRandomValues(new Uint8Array(6))
  const code = [...rnd].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
  await env.KV.put(`${INVITE_PREFIX}${code}`, JSON.stringify({ by, sport, at: new Date().toISOString() }), { expirationTtl: 3 * 86400 })
  return code
}
export async function readInvite(env: UserEnv, code: string): Promise<{ by: string; sport: Sport } | null> {
  if (!env.KV) return null
  return (await env.KV.get(`${INVITE_PREFIX}${code.toUpperCase()}`, 'json')) as { by: string; sport: Sport } | null
}
export const useInvite = (env: UserEnv, code: string) => env.KV?.delete(`${INVITE_PREFIX}${code.toUpperCase()}`)

// ── ลิงก์ลงทะเบียน (เซ็นด้วย channel secret, หมดอายุ 30 นาที) ──
export async function registerToken(env: UserEnv, uid: string, code: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 30 * 60
  const payload = `${uid}|${code}|${exp}`
  return `${btoa(payload)}.${await hmacHex(env.LINE_CHANNEL_SECRET, `reg:${payload}`)}`
}
export async function readRegisterToken(env: UserEnv, token: string | null): Promise<{ uid: string; code: string } | null> {
  if (!token) return null
  const [p, sig] = token.split('.')
  if (!p || !sig) return null
  let payload: string
  try {
    payload = atob(p)
  } catch {
    return null
  }
  if ((await hmacHex(env.LINE_CHANNEL_SECRET, `reg:${payload}`)) !== sig) return null
  const [uid, code, exp] = payload.split('|')
  if (Number(exp) < Date.now() / 1000) return null
  return { uid, code }
}
