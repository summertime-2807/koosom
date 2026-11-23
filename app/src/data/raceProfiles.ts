// ─────────────────────────────────────────────────────────────
// ข้อมูลสนามจากการจัดปีที่ผ่านมา (รวบรวม 21 พ.ย. 2569)
// ใช้ประกอบการสร้างตารางซ้อม + ส่งให้ AI วิเคราะห์
// อากาศย้อนหลังรายปีดึงสดจาก Open-Meteo (ดู services/weatherHistory.ts)
// ─────────────────────────────────────────────────────────────
import type { CalendarRace, CourseType, RaceProfile } from '../types/race'

const BKK: [number, number] = [13.7563, 100.5018]

export const RACE_PROFILES: Record<string, RaceProfile> = {
  atmb26: {
    raceId: 'atmb26',
    lat: 13.7446,
    lon: 100.53,
    startTimes: { '42.195': '02:00', '21.1': '02:00' },
    cutoffs: { '42.195': '7:00 ชม. (ตามข้อมูลบุคคลที่สาม — เช็กประกาศทางการ)' },
    course: 'bridges',
    courseNotes: [
      'ปี 2025 ระยะ 42K/21K ปล่อยตัวหน้า MBK เข้าเส้นชัยสนามหลวง ส่วน 10K วนสนามหลวง',
      'ความชันจริงมีแค่ขึ้น-ลงสะพานปิ่นเกล้า สะพานพระราม 8 และทางยกระดับ 1 จุด อยู่ใน 5 กม.แรก',
      'ความท้าทายหลักคือความร้อนชื้น ไม่ใช่ความชัน',
      'ผ่านราชดำเนิน อนุสาวรีย์ชัยฯ สวนลุมฯ สีลม สาทร',
    ],
    climate: { tempC: 25.4, humidity: 80, note: 'เฉลี่ยช่วงวิ่ง ~25°C ความชื้น ~80% โอกาสฝน ~15%' },
    pastEditions: [
      { year: 2025, date: '2025-11-30', note: 'ครั้งที่ 8 · ผู้สมัครกว่า 48,000 คน · แชมป์ชายมาราธอน 2:14:26 · ฮาล์ฟปล่อยตัวราว 02:00–02:15' },
      { year: 2024, note: 'แชมป์ชายมาราธอน 2:16:42' },
    ],
    stats: ['สนามใหญ่สุดของไทย ผู้สมัครกว่า 48,000 คน (2025)', 'เป็นสนามคัดเลือก Boston (BQ) ตามข้อมูลบุคคลที่สาม'],
    sources: [
      { title: 'thailand.go.th — ATMB 2025', url: 'https://thailand.go.th/event-detail/amazing-thailand-marathon-bangkok-2025' },
      { title: 'rundida — สภาพอากาศ/ความชัน', url: 'https://rundida.com/marathon/bangkok/' },
      { title: 'hdsports — ผลการแข่งขัน', url: 'https://www.hdsports.org/running/results-bangkok-marathon-photos' },
    ],
    dataLevel: 'good',
  },
  bs21: {
    raceId: 'bs21',
    lat: 13.2865,
    lon: 100.9155,
    startTimes: { '21.1': '04:00' },
    course: 'flat',
    courseNotes: [
      'สนามเร็ว ระยะมาตรฐาน 21.0975 กม. ได้ World Athletics Platinum Label',
      'เลียบชายหาดบางแสน → ถนนบางแสน-อ่างศิลา → กลับตัวที่แยก ถ.พระยาสัจจา → เข้าเส้นชัยบางแสนสาย 1',
      'ช่วงท้ายเป็นถนนเลียบทะเลราบและโล่ง ไม่มีที่บังลม',
    ],
    climate: { tempC: 25, humidity: 78, note: 'ลมทะเลช่วงเช้ามืด ช่วงท้ายโล่ง แดดเริ่มออกหลัง 06:30', estimated: true },
    pastEditions: [
      { year: 2025, date: '2025-12-21', note: 'ปล่อยตัว 04:00 · แชมป์ชาย 1:02:59' },
      { year: 2024, date: '2024-12-15', note: 'แชมป์ชาย 1:02:32 · แชมป์หญิง 1:10:01' },
      { year: 2022, note: 'สถิติสนาม ชาย 1:01:56 / หญิง 1:07:45 · ผู้เข้าเส้นชัย 5,255 คน' },
      { year: 2019, note: 'ผู้เข้าเส้นชัย 10,426 คน (มากสุด)' },
    ],
    stats: ['ผู้เข้าเส้นชัย 5,000–10,000 คน/ปี', 'ใช้ชิปจับเวลา ผลอยู่บน my.raceresult.com'],
    sources: [
      { title: 'Wikipedia — Bangsaen21', url: 'https://en.wikipedia.org/wiki/Bangsaen21_Half_Marathon' },
      { title: 'Course description', url: 'https://www.watchathletics.com/page/7214/bangsaen21-half-marathon-course-description' },
      { title: 'TAGTHAi — Bangsaen21 2025', url: 'https://www.tagthai.com/explore/events/p/bangsaen21half-arathon' },
    ],
    dataLevel: 'good',
  },
  cmm26: {
    raceId: 'cmm26',
    lat: 18.7877,
    lon: 98.9937,
    startTimes: { '42.195': '03:00', '21.1': '03:00' },
    course: 'rolling',
    courseNotes: [
      'ปล่อยตัวประตูท่าแพ ตอนตี 3 วิ่งในความมืดเกือบทั้งเส้นทาง',
      'มาราธอนมีความสูงสะสมประมาณ 280 ม. (เนินเล็ก ๆ ต่อเนื่อง)',
      'มีรีวิวว่าบางปีเลื่อนเวลาปล่อยตัวกระชั้นชิด และไฟถนนบางช่วงน้อย — พกไฟคาดหัวถ้าวิ่งช้า',
    ],
    climate: { tempC: 18, humidity: 70, note: 'ธ.ค. หน้าหนาวแห้ง ต่ำสุดราว 17°C สูงสุดราว 29°C ฝนน้อยมาก' },
    pastEditions: [
      { year: 2025, date: '2025-12-21', note: 'ครั้งที่ 20 · นักวิ่งกว่า 5,000 คนจาก 64 ประเทศ' },
      { year: 2006, date: '2006-12-24', note: 'จัดครั้งแรกที่ประตูท่าแพ' },
    ],
    stats: ['นักวิ่งต่างชาติเยอะที่สุดสนามหนึ่งของไทย'],
    sources: [
      { title: 'marathon-index — Chiang Mai Marathon', url: 'https://marathon-index.com/races/chiangmai-marathon/' },
      { title: 'timeoutdoors — CMM 2025', url: 'https://www.timeoutdoors.com/events/muang-thai-chiang-mai-marathon' },
    ],
    dataLevel: 'good',
  },
  kathu26: {
    raceId: 'kathu26',
    lat: 7.9135,
    lon: 98.3336,
    startTimes: { '21.1': '05:30', '42.195': '04:00' },
    course: 'rolling',
    courseNotes: [
      'เทศบาลกะทู้ระบุว่าพื้นที่มีทั้งทางลาดชันและทางราบยาว',
      'ปี 2024 ปรับเป็น “Kathu Super Half” 23 กม. · ปี 2025 เพิ่มระยะมาราธอน',
      'ภูเก็ตร้อนชื้นทั้งปี ปล่อยตัวเช้าแต่ช่วงท้ายมักเจอแดด',
    ],
    climate: { tempC: 26, humidity: 82, note: 'ภาคใต้ฝั่งอันดามัน ธ.ค. ปลายฝน ร้อนชื้น', estimated: true },
    pastEditions: [
      { year: 2025, note: 'เพิ่มระยะมาราธอน 42 กม.' },
      { year: 2024, note: 'Kathu Super Half 23 กม.' },
      { year: 2023, date: '2023-12-10', note: 'ฮาล์ฟปล่อยตัว 05:30 · มินิ 06:00' },
    ],
    stats: [],
    sources: [
      { title: 'The Phuket News — Kathu Marathon', url: 'https://mail.thephuketnews.com/kathu-marathon-stretches-its-legs-98044.php' },
      { title: 'The Phuket News — Kathu Half 2023', url: 'https://www.thephuketnews.com/registration-open-for-kathu-half-marathon-90193.php' },
    ],
    dataLevel: 'partial',
  },
  npm26: {
    raceId: 'npm26',
    lat: 17.4048,
    lon: 104.7865,
    startTimes: {},
    course: 'flat',
    courseNotes: ['เลียบแม่น้ำโขง ลานแสงสิงห์แก้ว นครพนม', 'อยู่ในซีรีส์ Scenic Marathon (สนามปิดซีรีส์ปี 2026)'],
    climate: { tempC: 19, humidity: 75, note: 'อีสาน ธ.ค. อากาศเย็นและแห้ง', estimated: true },
    pastEditions: [{ year: 2025, date: '2025-10-26', note: 'จัดที่ลานแสงสิงห์แก้ว (ปีนี้ย้ายมา ธ.ค.)' }],
    stats: ['ซีรีส์ Scenic Marathon จัดมา 10 ปี'],
    sources: [{ title: 'Thairath — Scenic Marathon Series 2026', url: 'https://en.thairath.co.th/sport/others/2914959' }],
    dataLevel: 'partial',
  },
  rama8_27: {
    raceId: 'rama8_27',
    lat: 13.7735,
    lon: 100.4935,
    startTimes: { '10': '05:00', '5': '05:15' },
    course: 'bridges',
    courseNotes: [
      'ปล่อยตัว-เข้าเส้นชัยใต้สะพานพระราม 8 ฝั่งธนฯ เส้นทางไป-กลับ',
      'ข้ามสะพานพระราม 8 และวิ่งบนถนนยกระดับบรมราชชนนี — ขึ้นลงทางลาดหลายรอบ',
      'จัดเดือน พ.ค. = หน้าร้อนกรุงเทพฯ ร้อนชื้นมาก',
    ],
    climate: { tempC: 28, humidity: 78, note: 'พ.ค. กรุงเทพฯ เช้ามืดราว 27–29°C ชื้นมาก', estimated: true },
    pastEditions: [
      { year: 2026, date: '2026-05-17', note: 'เลื่อนมาจาก พ.ย. 2025' },
      { year: 2024, date: '2024-09-22', note: '10K ปล่อยตัว 05:00 · 5K 05:15' },
    ],
    stats: [],
    sources: [
      { title: 'ahotu — Rama 8', url: 'https://marathons.ahotu.com/event/rama-8' },
      { title: 'worldsmarathons — Rama 8', url: 'https://worldsmarathons.com/marathon/rama-8' },
    ],
    dataLevel: 'partial',
  },
}

/** พิกัดจังหวัด (ไทย/อังกฤษ) สำหรับดึงอากาศย้อนหลัง */
const PLACE_COORDS: [RegExp, [number, number]][] = [
  [/เชียงใหม่|chiang ?mai/i, [18.79, 98.99]],
  [/เชียงราย|chiang ?rai/i, [19.91, 99.83]],
  [/แม่ฮ่องสอน|mae hong son/i, [19.3, 97.97]],
  [/ลำปาง|lampang/i, [18.29, 99.49]],
  [/ลำพูน|lamphun/i, [18.58, 99.01]],
  [/น่าน|nan\b/i, [18.78, 100.78]],
  [/พะเยา|phayao/i, [19.17, 99.9]],
  [/แพร่|phrae/i, [18.14, 100.14]],
  [/ตาก|\btak\b/i, [16.88, 99.13]],
  [/สุโขทัย|sukhothai/i, [17.01, 99.82]],
  [/พิษณุโลก|phitsanulok/i, [16.82, 100.26]],
  [/เพชรบูรณ์|phetchabun/i, [16.42, 101.16]],
  [/พิจิตร|phichit/i, [16.44, 100.35]],
  [/นครสวรรค์|nakhon sawan/i, [15.7, 100.14]],
  [/ภูเก็ต|กะทู้|phuket|kathu/i, [7.89, 98.39]],
  [/กระบี่|krabi/i, [8.09, 98.91]],
  [/พังงา|phang ?nga/i, [8.45, 98.53]],
  [/สุราษฎร์|surat thani|samui/i, [9.14, 99.33]],
  [/นครศรีธรรมราช|nakhon si thammarat/i, [8.43, 99.96]],
  [/สงขลา|หาดใหญ่|songkhla|hat ?yai/i, [7.01, 100.47]],
  [/ตรัง|trang/i, [7.56, 99.61]],
  [/ชุมพร|chumphon/i, [10.49, 99.18]],
  [/ประจวบ|หัวหิน|ปราณบุรี|prachuap|hua ?hin|pran ?buri/i, [12.57, 99.96]],
  [/เพชรบุรี|ชะอำ|phetchaburi|cha-?am/i, [13.11, 99.94]],
  [/กาญจนบุรี|kanchanaburi/i, [14.02, 99.53]],
  [/ราชบุรี|ratchaburi/i, [13.54, 99.82]],
  [/นครปฐม|nakhon pathom/i, [13.82, 100.06]],
  [/อยุธยา|ayutthaya/i, [14.35, 100.57]],
  [/สระบุรี|saraburi/i, [14.53, 100.91]],
  [/ลพบุรี|lop ?buri/i, [14.8, 100.65]],
  [/นครนายก|nakhon nayok/i, [14.2, 101.21]],
  [/ปราจีนบุรี|prachin/i, [14.05, 101.37]],
  [/ชลบุรี|บางแสน|ศรีราชา|พัทยา|chon ?buri|bang ?saen|sri ?racha|pattaya/i, [13.17, 100.93]],
  [/ระยอง|rayong/i, [12.68, 101.27]],
  [/จันทบุรี|chanthaburi/i, [12.61, 102.1]],
  [/ตราด|trat/i, [12.24, 102.51]],
  [/นครราชสีมา|โคราช|nakhon ratchasima|korat|khao ?yai/i, [14.97, 102.1]],
  [/ขอนแก่น|khon ?kaen/i, [16.44, 102.83]],
  [/อุดรธานี|udon/i, [17.41, 102.79]],
  [/หนองคาย|โพธิ์ตาก|nong ?khai/i, [17.88, 102.74]],
  [/เลย|เชียงคาน|\bloei\b|chiang ?khan/i, [17.49, 101.72]],
  [/สกลนคร|sakon nakhon/i, [17.16, 104.15]],
  [/นครพนม|nakhon phanom/i, [17.4, 104.78]],
  [/อุบล|ubon/i, [15.24, 104.85]],
  [/บุรีรัมย์|buri ?ram/i, [14.99, 103.1]],
  [/สุรินทร์|surin/i, [14.88, 103.49]],
  [/ชัยภูมิ|chaiyaphum/i, [15.81, 102.03]],
  [/มหาสารคาม|maha sarakham/i, [16.18, 103.3]],
  [/ร้อยเอ็ด|roi ?et/i, [16.05, 103.65]],
  [/กาฬสินธุ์|kalasin/i, [16.43, 103.51]],
  [/โฮจิมินห์|ho chi minh|hcmc|saigon/i, [10.78, 106.7]],
  [/ดานัง|da ?nang/i, [16.05, 108.2]],
  [/ฮานอย|hanoi/i, [21.03, 105.85]],
  [/กรุงเทพ|bangkok|นนทบุรี|nonthaburi|ปทุมธานี|pathum thani|สมุทรปราการ|samut prakan/i, [13.7563, 100.5018]],
]

type Region = 'central' | 'north' | 'northeast' | 'south' | 'east' | 'abroad'
function regionOf([lat, lon]: [number, number]): Region {
  if (lon > 105.7 || lon < 97.3 || lat > 20.6 || lat < 5.5) return 'abroad'
  if (lat < 11) return 'south'
  if (lat > 17.2 && lon < 101.3) return 'north'
  if (lat > 14.3 && lon > 101.3) return 'northeast'
  if (lat < 14 && lon > 100.8) return 'east'
  return 'central'
}

/** ภูมิอากาศช่วงเช้ามืดโดยประมาณ (°C) ราย เดือน 1–12 */
const DAWN_TEMP: Record<string, number[]> = {
  central: [22, 24, 26, 27, 27, 26, 26, 26, 25, 25, 24, 22],
  east: [23, 25, 26, 27, 27, 27, 26, 26, 25, 25, 24, 23],
  north: [14, 15, 19, 23, 24, 24, 23, 23, 23, 21, 18, 15],
  northeast: [17, 19, 22, 24, 25, 25, 24, 24, 23, 22, 19, 16],
  south: [23, 23, 24, 25, 25, 25, 25, 25, 24, 24, 24, 23],
  abroad: [22, 22, 24, 26, 26, 25, 25, 25, 24, 24, 23, 22],
}

export function guessCourse(race: CalendarRace): CourseType {
  if (/trail/i.test(race.name)) return 'trail'
  return 'flat'
}

/** คืนข้อมูลสนาม: ถ้าไม่มีในฐานข้อมูล จะสร้างค่าประมาณจากจังหวัด/เดือน */
export function getRaceProfile(race: CalendarRace | undefined, fallbackDate?: string): RaceProfile {
  if (race && RACE_PROFILES[race.id]) return RACE_PROFILES[race.id]
  const loc = race?.location ?? ''
  const hit = PLACE_COORDS.find(([re]) => re.test(loc)) ?? PLACE_COORDS.find(([re]) => re.test(race?.name ?? ''))
  const [lat, lon] = hit?.[1] ?? BKK
  const region = regionOf([lat, lon])
  const date = race?.date ?? fallbackDate
  const month = date ? Number(date.slice(5, 7)) : 12
  const temp = DAWN_TEMP[region][month - 1]
  const night = race && /ไนท์|night/i.test(race.name)
  return {
    raceId: race?.id ?? 'custom',
    lat,
    lon,
    startTimes: night ? { default: '18:00' } : {},
    course: race ? guessCourse(race) : 'flat',
    courseNotes: [
      race ? 'ยังไม่มีข้อมูลเส้นทางจากปีที่ผ่านมา — อัปโหลด GPX ของงานเพื่อให้วิเคราะห์ความชันได้' : 'แผนนี้ไม่ได้ผูกกับงานในปฏิทิน',
      ...(night ? ['งานวิ่งกลางคืน — ซ้อมวิ่งช่วงเย็น/ค่ำ และวางแผนมื้ออาหารก่อนแข่ง'] : []),
      ...(race?.distancesKm.length === 0 ? ['ยังไม่ทราบระยะทางที่เปิดรับสมัคร'] : []),
    ],
    climate: {
      tempC: night ? temp + 5 : temp,
      humidity: region === 'north' || region === 'northeast' ? 70 : 80,
      note: `ค่าประมาณภูมิอากาศ${night ? 'ช่วงค่ำ' : 'ช่วงเช้ามืด'} เดือน ${month} (${region === 'abroad' ? 'ต่างประเทศ' : 'ภาค' + { central: 'กลาง', east: 'ตะวันออก', north: 'เหนือ', northeast: 'อีสาน', south: 'ใต้' }[region]})`,
      estimated: true,
    },
    pastEditions: [],
    stats: [],
    sources: race ? [{ title: race.source, url: race.url }] : [],
    dataLevel: 'minimal',
  }
}

export function startTimeFor(profile: RaceProfile, distanceKm: number, fallback: string): string {
  const keys = Object.keys(profile.startTimes)
  if (!keys.length) return fallback
  const best = keys
    .filter((k) => k !== 'default')
    .map((k) => ({ k, d: Math.abs(Number(k) - distanceKm) }))
    .sort((a, b) => a.d - b.d)[0]
  if (best && best.d < 1.5) return profile.startTimes[best.k]
  return profile.startTimes.default ?? fallback
}

export const COURSE_TH: Record<CourseType, string> = {
  flat: 'ทางราบ',
  bridges: 'ราบ + ขึ้นลงสะพาน',
  rolling: 'เนินลูกคลื่น',
  hilly: 'เนินชัน',
  trail: 'เทรล',
}
