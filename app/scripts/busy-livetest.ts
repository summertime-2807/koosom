// ทดสอบ "ติดงาน/วิ่งสั้น/กลับมาซ้อม" กับ Intervals.icu จริง ในช่วงวันที่ไกลเกินแผน (ไม่กระทบตารางจริง)
// สร้าง workout ทดสอบ → ติดงาน → กลับมาซ้อม → วิ่งสั้น → กลับมาซ้อม → ลบทิ้ง · พิมพ์เฉพาะสถานะ
import { IntervalsClient } from "../src/coach/intervals";
import { busyNotes, endBusy, setBusy, setShort } from "../src/coach/busy";
import { addDays } from "../src/engine/trainingEngine";

const id = process.env.INTERVALS_ATHLETE_ID!.trim();
const key = process.env.INTERVALS_API_KEY!.trim();
const D0 = process.env.TEST_DAY || "2027-08-02"; // จันทร์
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "OK  " : "FAIL"} ${m}`);
  if (!c) process.exitCode = 1;
};

async function main() {
  const c = new IntervalsClient(id, key);
  const cfg = await c.loadConfig();
  if (!cfg) throw new Error("no config");
  if (D0 <= (cfg.raceDate ?? cfg.to)) throw new Error("TEST_DAY ต้องอยู่หลังแผน");
  const win = () => c.events(addDays(D0, -3), addDays(D0, 14));
  const cleanup = async () => {
    for (const e of await win())
      if (
        e.external_id?.startsWith("rp-livetest-") ||
        e.external_id?.startsWith("rp-busy-")
      )
        await c.deleteEvent(e.id);
  };
  await cleanup();
  try {
    // workout ทดสอบ: ง่าย (จ.) · ยาว (พ.) · interval (เสาร์)
    const mk = (d: string, name: string, km: number) => ({
      external_id: `rp-livetest-${d}`,
      category: "WORKOUT",
      type: "Run",
      start_date_local: `${d}T00:00:00`,
      name,
      description: `- ${km}km 80-88% LTHR`,
    });
    await c.upsertEvents([
      mk(D0, "TEST วิ่งง่าย 6 กม.", 6),
      mk(addDays(D0, 2), "TEST วิ่งยาว 14 กม.", 14),
      mk(addDays(D0, 5), "TEST Interval 6x800", 9),
    ]);
    let ev = await win();
    ok(
      ev.filter((e) => e.external_id?.startsWith("rp-livetest-")).length === 3,
      "สร้าง workout ทดสอบ 3 รายการ",
    );

    // ติดงาน จ.–พ. (3 วัน) → ข้ามวิ่งง่าย, ย้ายวิ่งยาวไป พฤ./ศ./อา.
    const r = await setBusy(c, cfg, D0, addDays(D0, 2), D0);
    ev = await win();
    const easy = ev.find((e) => e.external_id === `rp-livetest-${D0}`);
    const long = ev.find((e) => e.name === "TEST วิ่งยาว 14 กม.");
    ok(!easy, "ติดงาน: ข้าม (ลบ) วิ่งง่ายในช่วงติดงาน");
    ok(
      !!long && long.start_date_local.slice(0, 10) > addDays(D0, 2),
      `ติดงาน: ย้ายวิ่งยาวออกจากช่วงติดงาน (${r.period.changes.map((x) => x.kind).join(",")})`,
    );
    ok(busyNotes(ev).length === 1, "ติดงาน: มี NOTE ของช่วงติดงาน");

    // กลับมาซ้อม (วันเดียวกับเริ่ม) → คืนทุกอย่าง + ลบ NOTE
    const e1 = await endBusy(c, cfg, D0);
    ev = await win();
    ok(e1.restored >= 2, `กลับมาซ้อม: คืนค่า ${e1.restored} รายการ`);
    ok(
      !!ev.find(
        (e) =>
          e.external_id === `rp-livetest-${D0}` && e.category === "WORKOUT",
      ),
      "กลับมาซ้อม: วิ่งง่ายกลับมา",
    );
    ok(
      ev
        .find((e) => e.name === "TEST วิ่งยาว 14 กม.")
        ?.start_date_local.slice(0, 10) === addDays(D0, 2),
      "กลับมาซ้อม: วิ่งยาวกลับวันเดิม",
    );
    ok(busyNotes(ev).length === 0, "กลับมาซ้อม: ลบ NOTE");

    // วิ่งสั้น เสาร์ → interval เปลี่ยนเป็น 25 นาที แล้วคืนค่า
    const sat = addDays(D0, 5);
    await setShort(c, cfg, sat);
    ev = await win();
    const s1 = ev.find((e) => e.external_id === `rp-livetest-${sat}`);
    ok(!!s1?.name?.includes("25 นาที"), "วิ่งสั้น: เปลี่ยนชื่อ/รายละเอียดเป็น 25 นาที");
    await endBusy(c, cfg, sat);
    ev = await win();
    ok(
      ev.find((e) => e.external_id === `rp-livetest-${sat}`)?.name ===
        "TEST Interval 6x800",
      "วิ่งสั้น → กลับมาซ้อม: คืนชื่อเดิม",
    );
  } finally {
    await cleanup();
  }
  const ev2 = await win();
  ok(
    !ev2.some(
      (e) =>
        e.external_id?.startsWith("rp-livetest-") ||
        e.external_id?.startsWith("rp-busy-"),
    ),
    "ลบข้อมูลทดสอบหมดแล้ว",
  );
}

main().catch(async (e) => {
  console.error("livetest failed:", (e as Error).message.slice(0, 200));
  process.exit(1);
});
