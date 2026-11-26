"""สร้างรูป Rich menu ของคู่ซ้อม (2500x843, 4x2 ปุ่ม)"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 843
COLS = 4
CW, CH = W // COLS, H // 2
FONT = "/tmp/fonts/package/files/noto-sans-thai-thai-{}-normal.woff"
LAT = "/tmp/fonts/package/files/noto-sans-thai-latin-{}-normal.woff"
big = (ImageFont.truetype(FONT.format(700), 84), ImageFont.truetype(LAT.format(700), 84))
small = (ImageFont.truetype(FONT.format(500), 40), ImageFont.truetype(LAT.format(500), 40))

BG = (15, 23, 42)
CELL = (30, 41, 59)
ACCENT = (52, 211, 153)
ACC2 = (56, 189, 248)
TXT = (241, 245, 249)
SUB = (148, 163, 184)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)


def icon(kind, cx, cy, col):
    s = 64
    w = 10
    if kind == "today":  # ปฏิทิน + เครื่องหมายถูก
        d.rounded_rectangle([cx - s, cy - s + 12, cx + s, cy + s], 16, outline=col, width=w)
        d.line([cx - s, cy - s + 50, cx + s, cy - s + 50], fill=col, width=w)
        for x in (cx - 30, cx + 30):
            d.line([x, cy - s - 4, x, cy - s + 28], fill=col, width=w)
        d.line([cx - 28, cy + 22, cx - 6, cy + 42, cx + 32, cy + 2], fill=col, width=w, joint="curve")
    elif kind == "week":  # แท่ง 7 วัน
        hs = [30, 70, 45, 95, 55, 80, 40]
        for i, h in enumerate(hs):
            x = cx - s + i * 21
            d.rounded_rectangle([x, cy + s - h, x + 14, cy + s], 5, fill=col)
    elif kind == "battery":
        d.rounded_rectangle([cx - s, cy - 38, cx + s - 12, cy + 38], 14, outline=col, width=w)
        d.rounded_rectangle([cx + s - 8, cy - 16, cx + s + 6, cy + 16], 5, fill=col)
        d.rounded_rectangle([cx - s + 16, cy - 22, cx + 22, cy + 22], 6, fill=col)
    elif kind == "chat":
        d.rounded_rectangle([cx - s, cy - s + 8, cx + s, cy + 30], 26, outline=col, width=w)
        d.polygon([(cx - 30, cy + 26), (cx - 52, cy + s + 6), (cx + 2, cy + 26)], fill=col)
        for x in (cx - 32, cx, cx + 32):
            d.ellipse([x - 9, cy - 22, x + 9, cy - 4], fill=col)
    elif kind == "report":  # กราฟเส้น
        d.line([cx - s, cy + s, cx + s, cy + s], fill=col, width=w)
        d.line([cx - s, cy - s, cx - s, cy + s], fill=col, width=w)
        d.line([cx - 44, cy + 30, cx - 10, cy - 4, cx + 16, cy + 16, cx + 56, cy - 40], fill=col, width=w, joint="curve")
    elif kind == "sync":  # ลูกศรวนสองทาง
        d.arc([cx - s, cy - s, cx + s, cy + s], 200, 340, fill=col, width=w)
        d.arc([cx - s, cy - s, cx + s, cy + s], 20, 160, fill=col, width=w)
        d.polygon([(cx + s - 2, cy - 44), (cx + s + 24, cy - 8), (cx + s - 34, cy - 2)], fill=col)
        d.polygon([(cx - s + 2, cy + 44), (cx - s - 24, cy + 8), (cx - s + 34, cy + 2)], fill=col)
    elif kind == "busy":  # กระเป๋าทำงาน
        d.rounded_rectangle([cx - s, cy - 30, cx + s, cy + s - 6], 14, outline=col, width=w)
        d.rounded_rectangle([cx - 30, cy - 58, cx + 30, cy - 26], 10, outline=col, width=w)
        d.line([cx - s, cy + 8, cx + s, cy + 8], fill=col, width=w)
    elif kind == "shuttle":  # ลูกขนไก่
        d.ellipse([cx - 22, cy + 26, cx + 22, cy + s], fill=col)
        d.polygon([(cx - 20, cy + 32), (cx - s + 4, cy - s + 6), (cx + s - 4, cy - s + 6), (cx + 20, cy + 32)], outline=col, width=w)
        d.line([cx, cy + 30, cx, cy - s + 8], fill=col, width=6)
        d.line([cx - 10, cy + 30, cx - 34, cy - s + 8], fill=col, width=6)
        d.line([cx + 10, cy + 30, cx + 34, cy - s + 8], fill=col, width=6)
    elif kind == "shield":
        d.polygon([(cx, cy - s), (cx + s - 4, cy - s + 22), (cx + s - 12, cy + 18), (cx, cy + s), (cx - s + 12, cy + 18), (cx - s + 4, cy - s + 22)], outline=col, width=w)
        d.line([cx - 22, cy + 2, cx - 4, cy + 20, cx + 26, cy - 18], fill=col, width=w, joint="curve")
    elif kind == "moon":
        d.ellipse([cx - s + 6, cy - s + 6, cx + s - 6, cy + s - 6], fill=col)
        d.ellipse([cx - s + 34, cy - s - 6, cx + s + 18, cy + s - 30], fill=CELL)
    elif kind == "more":
        for y in (cy - 36, cy, cy + 36):
            d.rounded_rectangle([cx - s, y - 6, cx + s, y + 6], 6, fill=col)


def mixed(xy, text, fonts, col):
    """วาดข้อความไทยปนอังกฤษ: อักษรไทยใช้ฟอนต์ไทย ที่เหลือใช้ฟอนต์ละติน"""
    x, y = xy
    runs = []
    for ch in text:
        th = "\u0e00" <= ch <= "\u0e7f"
        if runs and runs[-1][0] == th:
            runs[-1][1] += ch
        else:
            runs.append([th, ch])
    for th, run in runs:
        f = fonts[0] if th else fonts[1]
        d.text((x, y), run, font=f, fill=col, anchor="ls")
        x += d.textlength(run, font=f)


VARIANT = sys.argv[2] if len(sys.argv) > 2 else "run"
if VARIANT == "badminton":
    cells = [
        ("today", "วันนี้", "ฝึกอะไรดี", ACCENT),
        ("week", "สัปดาห์", "ตาราง 7 วัน", ACCENT),
        ("shuttle", "บันทึกเล่น", "เวลา + ความเหนื่อย", ACCENT),
        ("report", "ภาระ", "เสี่ยงเจ็บไหม", ACCENT),
        ("shield", "กันเจ็บ", "ไหล่ เข่า ข้อเท้า", ACC2),
        ("moon", "การนอน", "หนี้การนอน", ACC2),
        ("chat", "ถามโค้ช", "AI ตอบจากข้อมูลจริง", ACC2),
        ("more", "เพิ่มเติม", "แข่ง · วอร์ม · ตั้งค่า", ACC2),
    ]
else:
    cells = [
        ("today", "วันนี้", "ซ้อมอะไรดี", ACCENT),
        ("week", "สัปดาห์", "7 วันข้างหน้า", ACCENT),
        ("battery", "สรุป", "แบต & ความพร้อม", ACCENT),
        ("sync", "ซิงก์", "อัปเดตทั้งหมด", ACCENT),
        ("chat", "ถามโค้ช", "AI ตอบจากข้อมูลจริง", ACC2),
        ("report", "รายงาน", "สรุปสัปดาห์นี้", ACC2),
        ("busy", "ติดงาน", "ข้าม/วิ่งสั้น", ACC2),
        ("more", "เพิ่มเติม", "แข่ง · รองเท้า · นอน", ACC2),
    ]

for i, (kind, label, sub, col) in enumerate(cells):
    c, r = i % COLS, i // COLS
    x0, y0 = c * CW + 12, r * CH + 12
    x1, y1 = (c + 1) * CW - 12, (r + 1) * CH - 12
    d.rounded_rectangle([x0, y0, x1, y1], 32, fill=CELL)
    icon(kind, x0 + 115, (y0 + y1) // 2, col)
    tx = x0 + 205
    mixed((tx, (y0 + y1) // 2 - 14), label, big, TXT)
    mixed((tx, (y0 + y1) // 2 + 56), sub, small, SUB)

out = sys.argv[1] if len(sys.argv) > 1 else "richmenu.png"
img.save(out, optimize=True)
print(out)
