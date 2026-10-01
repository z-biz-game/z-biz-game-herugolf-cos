#!/usr/bin/env python3
"""ヘルゴルフ（Herugolf）视觉母题生成器 —— 只用 python3 标准库，可复现、零依赖。

为什么不用外部图库：这一族的资产要能被任何人 `python3 assets/gen/make_art.py` 重跑出来并逐字节
对账（PIL / rsvg 都属于"这台机器恰好装了"的口径）。所以 PNG 编码走 zlib + struct 手写，
抗锯齿走解析式覆盖率，缩图走 2D 前序和面积平均（预乘 alpha，避免透明边缘长白边）。

母题（玩法决定形状，不是装饰）：
  和紙 ground（论理谜题是纸笔游戏）· 墨迹直线（R2 每动都是直线，一动比一动短）·
  带数字的白球 → H 球洞（R1 一球一洞）· 灰蓝池 wash（R4 可穿过不可停）· 朱红小旗（日章）。
  图标那张就是引擎真出得来的一个三动走法：球 3 走上、右、下，末格停在 H。

配色是从引擎/题面语义定的（纸 #f3ece0 / 墨 #1d1a17 / 洞 #2f6b4f / 池 #6f93a5 / 旗 #c2453a），
不是凭"好看"抽的：墨=线、纸=盘面、绿=洞、蓝灰=池，玩家在游戏里看到的颜色和图标上是同一套语义。

产物（全部是真 PNG，跑完后 `file` + IHDR 可验）：
  web/icons/master-1024.png                品牌母图
  web/icons/favicon-16/32/48/64/96.png     多尺寸 favicon
  web/icons/apple-touch-icon-180.png       iOS（不透明，iOS 不吃透明底）
  web/icons/icon-192.png icon-512.png      PWA
  web/icons/icon-maskable-512.png          PWA maskable（内容在 80% 安全区里）
  web/social/og-1200x630.png               社交卡
  web/img/paper-256.png pond-128.png       可平铺纹理（游戏内盘面/池）
  web/img/ball-96.png hole-96.png          sprite（数字由 canvas 现画，不进 sprite）
  web/img/particles-128.png                2x2 粒子图集（reduceMotion 时整张不画）
"""
import os
import struct
import zlib
from array import array
from math import floor, sqrt

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

PAPER = (0.953, 0.925, 0.878)
PAPER_HI = (0.996, 0.988, 0.965)
SUMI = (0.114, 0.102, 0.086)
INK_SOFT = (0.29, 0.262, 0.224)
GREEN = (0.184, 0.42, 0.31)
GREEN_HI = (0.31, 0.58, 0.42)
WATER = (0.435, 0.578, 0.647)
VERMILION = (0.76, 0.27, 0.227)
WHITE = (0.996, 0.988, 0.965)

# ───────────────────────────────── PNG 编码 / 解码（读 IHDR 用）

def write_png(path, w, h, buf):
    """buf: float array RGBA(0..1) → 8bit RGBA PNG（filter 0 逐行）。"""
    raw = bytearray(h * (w * 4 + 1))
    pos = 0
    for y in range(h):
        raw[pos] = 0
        pos += 1
        base = y * w * 4
        for x in range(w):
            i = base + x * 4
            for c in range(4):
                v = buf[i + c]
                raw[pos] = 0 if v != v else max(0, min(255, int(round(v * 255))))
                pos += 1
    blocks = [
        (b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)),
        (b'IDAT', zlib.compress(bytes(raw), 9)),
        (b'IEND', b''),
    ]
    out = bytearray(b'\x89PNG\r\n\x1a\n')
    for tag, data in blocks:
        out += struct.pack('>I', len(data)) + tag + data
        out += struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, 'wb') as f:
        f.write(bytes(out))
    return len(out)


def png_ihdr(path):
    with open(path, 'rb') as f:
        head = f.read(33)
    assert head[:8] == b'\x89PNG\r\n\x1a\n', f'{path} 不是 PNG'
    w, h, depth, color = struct.unpack('>IIBB', head[16:26])
    return w, h, depth, color

# ───────────────────────────────── 画布：float RGBA + 解析式 AA

def canvas(w, h, rgba=(0.0, 0.0, 0.0, 0.0)):
    b = array('f', [0.0]) * (w * h * 4)
    if rgba[3] > 0:
        for i in range(w * h):
            j = i * 4
            b[j], b[j + 1], b[j + 2], b[j + 3] = rgba
    return b


def cov(d, feather=1.25):
    """到形状边缘的有符号距离 → 覆盖率（d<0 在内）。"""
    if d >= feather:
        return 0.0
    if d <= -feather:
        return 1.0
    t = (d + feather) / (2.0 * feather)
    return 1.0 - (t * t * (3.0 - 2.0 * t))


def over(buf, idx, rgb, a):
    if a <= 0.0:
        return
    j = idx * 4
    da = buf[j + 3]
    na = a + da * (1.0 - a)
    if na <= 0:
        return
    for c in range(3):
        sv = buf[j + c]
        buf[j + c] = (rgb[c] * a + sv * da * (1.0 - a)) / na
    buf[j + 3] = na


def paint_rect(buf, w, h, x0, y0, x1, y1, rgb, alpha, feather=1.25):
    xa, xb = max(0, int(floor(x0 - 2))), min(w, int(floor(x1 + 3)))
    ya, yb = max(0, int(floor(y0 - 2))), min(h, int(floor(y1 + 3)))
    for y in range(ya, yb):
        dy = max(y0 - y, y - y1, 0.0)
        row = y * w
        for x in range(xa, xb):
            dx = max(x0 - x, x - x1, 0.0)
            d = sqrt(dx * dx + dy * dy) - 0.5
            over(buf, row + x, rgb, alpha * cov(d, feather))


def paint_round_rect(buf, w, h, x0, y0, x1, y1, r, rgb, alpha, feather=1.25, outline=0.0):
    """outline>0 时只画那条粗度的边（留空内部）。"""
    xa, xb = max(0, int(floor(x0 - 3))), min(w, int(floor(x1 + 4)))
    ya, yb = max(0, int(floor(y0 - 3))), min(h, int(floor(y1 + 4)))
    for y in range(ya, yb):
        for x in range(xa, xb):
            dx = min(max(x, x0 + r), x1 - r) - x
            dy = min(max(y, y0 + r), y1 - r) - y
            d = sqrt(dx * dx + dy * dy) - r
            if outline > 0:
                d = abs(d - outline * 0.5) - outline * 0.5
            over(buf, y * w + x, rgb, alpha * cov(d, feather))


def paint_disc(buf, w, h, cx, cy, rad, rgb, alpha, feather=1.25, ring=0.0):
    xa, xb = max(0, int(cx - rad - 3)), min(w, int(cx + rad + 4))
    ya, yb = max(0, int(cy - rad - 3)), min(h, int(cy + rad + 4))
    for y in range(ya, yb):
        dy = y - cy
        row = y * w
        for x in range(xa, xb):
            dx = x - cx
            d = sqrt(dx * dx + dy * dy) - rad
            if ring > 0:
                d = abs(d - ring * 0.5) - ring * 0.5
            over(buf, row + x, rgb, alpha * cov(d, feather))


def paint_polyline(buf, w, h, pts, width, rgb, alpha, feather=1.5):
    """墨线：逐段圆头粗线（R2 的"每动一条直线"就是这个形状）。"""
    half = width * 0.5
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        vx, vy = bx - ax, by - ay
        seg = sqrt(vx * vx + vy * vy)
        if seg <= 0:
            paint_disc(buf, w, h, ax, ay, half, rgb, alpha, feather)
            continue
        xa = max(0, int(min(ax, bx) - half - 3))
        xb = min(w, int(max(ax, bx) + half + 4))
        ya = max(0, int(min(ay, by) - half - 3))
        yb = min(h, int(max(ay, by) + half + 4))
        for y in range(ya, yb):
            row = y * w
            for x in range(xa, xb):
                t = ((x - ax) * vx + (y - ay) * vy) / (seg * seg)
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                px, py = ax + t * vx - x, ay + t * vy - y
                d = sqrt(px * px + py * py) - half
                over(buf, row + x, rgb, alpha * cov(d, feather))


def paint_tri(buf, w, h, a, b, c, rgb, alpha, feather=1.25):
    xs = [p[0] for p in (a, b, c)]
    ys = [p[1] for p in (a, b, c)]
    xa, xb = max(0, int(min(xs) - 3)), min(w, int(max(xs) + 4))
    ya, yb = max(0, int(min(ys) - 3)), min(h, int(max(ys) + 4))

    def edge(p, q, r):
        return (r[0] - q[0]) * (p[1] - q[1]) - (r[1] - q[1]) * (p[0] - q[0])

    for y in range(ya, yb):
        for x in range(xa, xb):
            d1 = edge((x, y), a, b)
            d2 = edge((x, y), b, c)
            d3 = edge((x, y), c, a)
            neg = min(d1, d2, d3)
            pos = max(d1, d2, d3)
            if neg > 0 or pos < 0:
                continue
            # 到最近一条边的距离（同号边长归一）
            best = 1e9
            for p, q in ((a, b), (b, c), (c, a)):
                lx, ly = q[0] - p[0], q[1] - p[1]
                L = sqrt(lx * lx + ly * ly) or 1.0
                best = min(best, abs(edge((x, y), p, q)) / L)
            over(buf, y * w + x, rgb, alpha * cov(feather - best, feather))

# ───────────────────────────────── 可平铺 value noise（和紙的筋）

def _hash2(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274133487 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967295.0


def tile_noise(w, h, period, seed, octaves=3):
    """周期 = period 格整除 w/h ⇒ 四方连续，平铺不见缝。"""
    out = [0.0] * (w * h)
    amp_total = 0.0
    amp = 1.0
    for o in range(octaves):
        per = max(2, period >> o)
        if per > w or per > h:
            per = 2
        step_x = w / per
        step_y = h / per
        lat = [[_hash2(ix, iy, seed + o * 7919) for iy in range(per)] for ix in range(per)]
        for y in range(h):
            fy = y / step_y
            iy0 = int(fy) % per
            iy1 = (iy0 + 1) % per
            ty = fy - int(fy)
            ty = ty * ty * (3.0 - 2.0 * ty)
            for x in range(w):
                fx = x / step_x
                ix0 = int(fx) % per
                ix1 = (ix0 + 1) % per
                tx = fx - int(fx)
                tx = tx * tx * (3.0 - 2.0 * tx)
                a = lat[ix0][iy0]
                b = lat[ix1][iy0]
                c = lat[ix0][iy1]
                d = lat[ix1][iy1]
                out[y * w + x] += amp * ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty)
        amp_total += amp
        amp *= 0.5
    for i in range(w * h):
        out[i] /= amp_total or 1.0
    return out


def paint_paper(buf, w, h, scale=1.0, grain=0.075, warp=True):
    """和紙底：竖向纤维 + 细微斑点 + 左上到右下的浅渐变。"""
    noise = tile_noise(w, h, max(4, int(24 * scale)), 4231, 3)
    noise2 = tile_noise(w, h, max(4, int(7 * scale)), 9173, 2)
    for y in range(h):
        fy = y / h
        row = y * w
        for x in range(w):
            fx = x / w
            grad = 0.5 - (fx * 0.62 + fy * 0.38)
            n = noise[row + x]
            n2 = noise2[row + x]
            v = 1.0 + grad * 0.085 + (n - 0.5) * grain * (2.0 if warp else 1.0) + (n2 - 0.5) * grain * 0.7
            j = (row + x) * 4
            for c in range(3):
                buf[j + c] = max(0.0, min(1.0, PAPER[c] * v + (PAPER_HI[c] - PAPER[c]) * grad * 0.04))
            buf[j + 3] = 1.0

# ───────────────────────────────── 5x7 位图字体（og 卡上的拉丁字）

_GLYPH_SRC = {
    'A': '01110,10001,10001,10001,11111,10001,10001', 'B': '11110,10001,10001,11110,10001,10001,11110',
    'C': '01110,10001,10000,10000,10000,10001,01110', 'D': '11110,10001,10001,10001,10001,10001,11110',
    'E': '11111,10000,10000,11110,10000,10000,11111', 'F': '11111,10000,10000,11110,10000,10000,10000',
    'G': '01110,10001,10000,10111,10001,10001,01111', 'H': '10001,10001,10001,11111,10001,10001,10001',
    'I': '11111,00100,00100,00100,00100,00100,11111', 'J': '00111,00010,00010,00010,00010,10010,01100',
    'K': '10001,10010,10100,11000,10100,10010,10001', 'L': '10000,10000,10000,10000,10000,10000,11111',
    'M': '10001,11011,10101,10101,10001,10001,10001', 'N': '10001,11001,10101,10011,10001,10001,10001',
    'O': '01110,10001,10001,10001,10001,10001,01110', 'P': '11110,10001,10001,11110,10000,10000,10000',
    'Q': '01110,10001,10001,10001,10101,10010,01101', 'R': '11110,10001,10001,11110,10100,10010,10001',
    'S': '01111,10000,10000,01110,00001,00001,11110', 'T': '11111,00100,00100,00100,00100,00100,00100',
    'U': '10001,10001,10001,10001,10001,10001,01110', 'V': '10001,10001,10001,10001,10001,01010,00100',
    'W': '10001,10001,10001,10101,10101,10101,01010', 'X': '10001,10001,01010,00100,01010,10001,10001',
    'Y': '10001,10001,01010,00100,00100,00100,00100', 'Z': '11111,00001,00010,00100,01000,10000,11111',
    '0': '01110,10001,10011,10101,11001,10001,01110', '1': '00100,01100,00100,00100,00100,00100,01110',
    '2': '01110,10001,00001,00010,00100,01000,11111', '3': '11110,00001,00001,01110,00001,00001,11110',
    '4': '10010,10010,10010,11111,00010,00010,00010', '5': '11111,10000,11110,00001,00001,10001,01110',
    '6': '00110,01000,10000,11110,10001,10001,01110', '7': '11111,00001,00010,00100,01000,01000,01000',
    '8': '01110,10001,10001,01110,10001,10001,01110', '9': '01110,10001,10001,01111,00001,00010,01100',
    ' ': '00000,00000,00000,00000,00000,00000,00000', '.': '00000,00000,00000,00000,00000,00110,00110',
    '-': '00000,00000,00000,11111,00000,00000,00000', ':': '00000,00100,00100,00000,00100,00100,00000',
    '/': '00001,00010,00010,00100,01000,01000,10000',
}


def _load_glyphs(src):
    """字形表在导入期就自证：谁手抄漏了一格，这里当场报出是哪个字，而不是渲染到一半越界。"""
    out = {}
    for name, rows in src.items():
        parts = rows.split(',')
        bad = [r for r in parts if len(r) != 5]
        if len(parts) != 7 or bad:
            raise AssertionError(f'字形「{name}」不是 7 行 x 5 列（行数 {len(parts)}，坏行 {bad}）')
        out[name] = parts
    return out


GLYPHS = _load_glyphs(_GLYPH_SRC)


def draw_text(buf, w, h, x, y, text, s, rgb, alpha=1.0):
    """s = 字形里一个像素的边长；5x7 网格，字距一格。"""
    cx = x
    for ch in text.upper():
        g = GLYPHS.get(ch)
        if g is None:
            cx += 6 * s
            continue
        for gy in range(7):
            row = g[gy]
            for gx in range(5):
                if row[gx] == '1':
                    paint_rect(buf, w, h, cx + gx * s, y + gy * s, cx + gx * s + s - 0.35, y + gy * s + s - 0.35,
                               rgb, alpha, feather=max(0.6, min(1.6, s * 0.3)))
        cx += 6 * s
    return cx


def text_width(text, s):
    return len(text) * 6 * s - s

# ───────────────────────────────── 缩图（2D 前序和 · 预乘 alpha）

def premultiply(buf):
    out = array('f', buf)
    for i in range(len(out) // 4):
        j = i * 4
        a = out[j + 3]
        out[j] *= a
        out[j + 1] *= a
        out[j + 2] *= a
    return out


def unpremultiply(buf):
    for i in range(len(buf) // 4):
        j = i * 4
        a = buf[j + 3]
        if a > 1e-6:
            buf[j] /= a
            buf[j + 1] /= a
            buf[j + 2] /= a
    return buf


def build_prefix(pma, sw, sh):
    """2D 前序和（预乘 alpha）：缩图的成本只付一次，之后每根线都从它取面积平均。"""
    stride = (sw + 1) * 4
    pre = array('f', [0.0]) * ((sw + 1) * (sh + 1) * 4)
    for y in range(sh):
        acc = [0.0] * 4
        src_row = y * sw * 4
        dst_row = (y + 1) * stride
        prev_row = y * stride
        for x in range(sw):
            j = src_row + x * 4
            for c in range(4):
                acc[c] += pma[j + c]
            d = dst_row + (x + 1) * 4
            p = prev_row + (x + 1) * 4
            for c in range(4):
                pre[d + c] = pre[p + c] + acc[c]
    return pre, stride


def resize_from_prefix(pre, stride, sw, sh, dw, dh):
    out = array('f', [0.0]) * (dw * dh * 4)
    sx = sw / dw
    sy = sh / dh
    for y in range(dh):
        y0 = floor(y * sy)
        y1 = min(sh, max(y0 + 1, floor((y + 1) * sy + 0.5)))
        for x in range(dw):
            x0 = floor(x * sx)
            x1 = min(sw, max(x0 + 1, floor((x + 1) * sx + 0.5)))
            area = (x1 - x0) * (y1 - y0)
            j = (y * dw + x) * 4
            r0 = y0 * stride
            r1 = y1 * stride
            for c in range(4):
                out[j + c] = (pre[r1 + x1 * 4 + c] - pre[r0 + x1 * 4 + c]
                              - pre[r1 + x0 * 4 + c] + pre[r0 + x0 * 4 + c]) / area
    return out


def master_prefix(buf):
    pre, stride = build_prefix(premultiply(buf), S, S)
    return (pre, stride)


def save_from_prefix(pre_stride, path, size, force_opaque=None):
    pre, stride = pre_stride
    small = unpremultiply(resize_from_prefix(pre, stride, S, S, size, size))
    if force_opaque is not None:
        for i in range(size * size):
            j = i * 4
            a = small[j + 3]
            for c in range(3):
                small[j + c] = small[j + c] * a + force_opaque[c] * (1.0 - a)
            small[j + 3] = 1.0
    return write_png(path, size, size, small)


def save_scaled(buf, w, h, path, size, force_opaque=None):
    return save_from_prefix(build_prefix(premultiply(buf), w, h), path, size, force_opaque)

# ───────────────────────────────── 游戏内画的东西（图标与 og 共用）

def draw_route_and_ball(buf, w, h, pts, ball_at, digit, width, hole_at, hole_r):
    """墨线 + 白球（带数字）+ H 洞（绿圈 + 朱旗）。坐标都是画布像素。"""
    paint_polyline(buf, w, h, pts, width, SUMI, 0.94)
    # 每一动的落点：墨点，读作"停了一动"
    for p in pts[1:-1]:
        paint_disc(buf, w, h, p[0], p[1], width * 0.30, SUMI, 0.55)
    bx, by = ball_at
    br = width * 1.62
    paint_disc(buf, w, h, bx + br * 0.16, by + br * 0.2, br, SUMI, 0.16)  # 纸上的投影
    paint_disc(buf, w, h, bx, by, br, WHITE, 1.0)
    paint_disc(buf, w, h, bx, by, br * 0.965, SUMI, 0.92, ring=width * 0.15)
    paint_disc(buf, w, h, bx - br * 0.28, by - br * 0.34, br * 0.30, (1, 1, 1), 0.55)
    ds = br * 0.22
    draw_text(buf, w, h, bx - text_width(digit, ds) / 2.0, by - 3.5 * ds, digit, ds, SUMI, 1.0)
    hx, hy = hole_at
    paint_disc(buf, w, h, hx, hy, hole_r * 1.26, GREEN, 0.22)
    paint_disc(buf, w, h, hx, hy, hole_r, (0.07, 0.09, 0.08), 0.95)
    paint_disc(buf, w, h, hx, hy, hole_r, GREEN_HI, 0.9, ring=hole_r * 0.30)
    # 旗杆 + 朱旗
    paint_rect(buf, w, h, hx - hole_r * 0.10, hy - hole_r * 3.1, hx + hole_r * 0.10, hy, SUMI, 0.9)
    paint_tri(buf, w, h, (hx + hole_r * 0.06, hy - hole_r * 3.05), (hx + hole_r * 1.75, hy - hole_r * 2.35),
              (hx + hole_r * 0.06, hy - hole_r * 1.7), VERMILION, 0.96)


def draw_grid(buf, w, h, x0, y0, x1, y1, n, alpha=0.13):
    for i in range(n + 1):
        t = i / n
        paint_rect(buf, w, h, x0 + (x1 - x0) * t - 0.5, y0, x0 + (x1 - x0) * t + 0.5, y1, SUMI, alpha, feather=0.6)
        paint_rect(buf, w, h, x0, y0 + (y1 - y0) * t - 0.5, x1, y0 + (y1 - y0) * t + 0.5, SUMI, alpha, feather=0.6)


# ───────────────────────────────── 母图 1024

S = 1024


def make_master():
    buf = canvas(S, S)
    paint_paper(buf, S, S, scale=4.0, grain=0.055)
    # 圆角方（保留四角透明，favicon 上就是那枚和紙方片）
    keep = canvas(S, S)
    paint_round_rect(keep, S, S, 0, 0, S - 1, S - 1, S * 0.215, PAPER, 1.0, feather=2.0)
    merged = canvas(S, S)
    for i in range(S * S):
        j = i * 4
        a = keep[j + 3]
        for c in range(3):
            merged[j + c] = buf[j + c] * a
        merged[j + 3] = a
    buf = merged
    m = S * 0.075
    paint_round_rect(buf, S, S, m, m, S - m, S - m, S * 0.165, SUMI, 0.82, feather=1.4, outline=S * 0.011)
    # 盘面：5x5（引擎题面的最小可读单位）
    gx0, gy0, gx1, gy1 = S * 0.17, S * 0.17, S * 0.83, S * 0.83
    draw_grid(buf, S, S, gx0, gy0, gx1, gy1, 5, 0.12)
    cell = (gx1 - gx0) / 5.0
    # 池（R4：可穿过、不许停）
    paint_rect(buf, S, S, gx0 + cell * 3, gy0 + cell * 3, gx0 + cell * 4, gy0 + cell * 4, WATER, 0.42)
    for k in range(3):
        yy = gy0 + cell * (3.22 + k * 0.24)
        paint_polyline(buf, S, S, [(gx0 + cell * 3.18, yy), (gx0 + cell * 3.82, yy)], S * 0.008, WATER, 0.55)
    # 三动走法：上 → 右 → 下，末格停在 H（球里写 3）
    pts = [(gx0 + cell * 1.5, gy0 + cell * 4.5), (gx0 + cell * 1.5, gy0 + cell * 1.5),
           (gx0 + cell * 3.5, gy0 + cell * 1.5), (gx0 + cell * 3.5, gy0 + cell * 2.5)]
    draw_route_and_ball(buf, S, S, pts, pts[0], '3', S * 0.042, pts[-1], S * 0.040)
    return buf


def make_maskable():
    """maskable：满幅出血 + 内容缩到 80% 安全区（OS 会裁圆/胶囊）。"""
    buf = canvas(S, S)
    paint_paper(buf, S, S, scale=4.0, grain=0.05)
    m = S * 0.10
    gx0, gy0, gx1, gy1 = m + S * 0.06, m + S * 0.06, S - m - S * 0.06, S - m - S * 0.06
    draw_grid(buf, S, S, gx0, gy0, gx1, gy1, 5, 0.11)
    cell = (gx1 - gx0) / 5.0
    paint_rect(buf, S, S, gx0 + cell * 3, gy0 + cell * 3, gx0 + cell * 4, gy0 + cell * 4, WATER, 0.40)
    pts = [(gx0 + cell * 1.5, gy0 + cell * 4.5), (gx0 + cell * 1.5, gy0 + cell * 1.5),
           (gx0 + cell * 3.5, gy0 + cell * 1.5), (gx0 + cell * 3.5, gy0 + cell * 2.5)]
    draw_route_and_ball(buf, S, S, pts, pts[0], '3', S * 0.034, pts[-1], S * 0.032)
    return buf

# ───────────────────────────────── 社交卡 1200x630

def make_og():
    W, H = 1200, 630
    buf = canvas(W, H)
    paint_paper(buf, W, H, scale=3.0, grain=0.06)
    m = 34
    paint_round_rect(buf, W, H, m, m, W - m, H - m, 26, SUMI, 0.8, feather=1.4, outline=3.0)
    # 左：字标（5x7 位图拉丁，可复现；日文假名不在位图字体里，所以文案只写拉丁）
    draw_text(buf, W, H, 108, 150, 'HERU', 13, SUMI)
    draw_text(buf, W, H, 108, 262, 'GOLF', 13, SUMI)
    paint_rect(buf, W, H, 108, 392, 470, 396, VERMILION, 0.92)
    draw_text(buf, W, H, 108, 424, 'NIKOLI LOGIC PUZZLE', 4.6, INK_SOFT)
    draw_text(buf, W, H, 108, 484, 'ONE BALL ONE HOLE', 4.6, INK_SOFT)
    draw_text(buf, W, H, 108, 530, 'UNIQUE / ZERO GUESS', 4.6, GREEN)
    # 右：一张 6x6 小盘，三条互不相交的走法（就是引擎给的解的形状）
    bx0, by0, bx1, by1 = 610, 92, 1122, 538
    draw_grid(buf, W, H, bx0, by0, bx1, by1, 6, 0.16)
    cw = (bx1 - bx0) / 6.0
    ch = (by1 - by0) / 6.0

    def cc(col, row):
        return (bx0 + cw * (col + 0.5), by0 + ch * (row + 0.5))
    paint_rect(buf, W, H, bx0 + cw * 4, by0 + ch * 4, bx0 + cw * 5, by0 + ch * 5, WATER, 0.42)
    paint_rect(buf, W, H, bx0 + cw * 0, by0 + ch * 1, bx0 + cw * 1, by0 + ch * 2, WATER, 0.42)
    # 三条走法照 R2 排长度：第一动 = 球里的数字，之后每动减 1，末动停在 H（R1 一球一洞，R3 互不相交）
    routes = [
        {'digit': '3', 'pts': [(2, 5), (2, 2), (0, 2), (0, 3)]},
        {'digit': '2', 'pts': [(4, 1), (4, 3), (5, 3)]},
        {'digit': '2', 'pts': [(1, 0), (3, 0), (3, 1)]},
    ]
    for rt in routes:
        pxs = [cc(c, r) for (c, r) in rt['pts']]
        draw_route_and_ball(buf, W, H, pxs, pxs[0], rt['digit'], cw * 0.10, pxs[-1], ch * 0.13)
    return buf

# ───────────────────────────────── 纹理 / sprite

def make_paper_tile(size=256):
    buf = canvas(size, size)
    paint_paper(buf, size, size, scale=1.0, grain=0.085)
    return buf


def make_pond_tile(size=128):
    buf = canvas(size, size)
    n = tile_noise(size, size, 8, 7717, 2)
    n2 = tile_noise(size, size, 3, 3311, 2)
    for y in range(size):
        for x in range(size):
            i = y * size + x
            ripple = 0.5 + 0.5 * ((n[i] - 0.5) * 2.0)
            a = 0.30 + 0.34 * ripple + (n2[i] - 0.5) * 0.12
            j = i * 4
            tint = 0.86 + 0.28 * ripple
            buf[j] = WATER[0] * tint
            buf[j + 1] = WATER[1] * tint
            buf[j + 2] = WATER[2] * tint
            buf[j + 3] = max(0.0, min(1.0, a))
    for k in range(3):
        yy = size * (0.22 + k * 0.28)
        paint_polyline(buf, size, size, [(size * 0.12, yy), (size * 0.88, yy)], size * 0.018, WHITE, 0.16)
    return buf


def make_ball(size=96):
    buf = canvas(size, size)
    c = size * 0.5
    r = size * 0.42
    paint_disc(buf, size, size, c + r * 0.12, c + r * 0.16, r, SUMI, 0.20)
    paint_disc(buf, size, size, c, c, r, WHITE, 1.0)
    paint_disc(buf, size, size, c, c, r * 0.98, (0.90, 0.87, 0.80), 0.55)
    paint_disc(buf, size, size, c, c, r, SUMI, 0.95, ring=size * 0.045)
    paint_disc(buf, size, size, c - r * 0.3, c - r * 0.34, r * 0.3, (1, 1, 1), 0.62)
    return buf


def make_hole(size=96):
    buf = canvas(size, size)
    c = size * 0.5
    r = size * 0.36
    paint_disc(buf, size, size, c, c, r * 1.24, GREEN, 0.26)
    paint_disc(buf, size, size, c, c, r, (0.06, 0.085, 0.075), 0.96)
    paint_disc(buf, size, size, c, c, r, GREEN_HI, 0.0, ring=size * 0.05)
    paint_disc(buf, size, size, c - r * 0.2, c - r * 0.25, r * 0.42, (0.16, 0.24, 0.2), 0.5)
    return buf


def make_particles(size=128):
    """2x2 图集（64/格）：软点 · 墨滴环 · 火花 · 纸屑。"""
    buf = canvas(size, size)
    q = size // 2
    for gy in range(2):
        for gx in range(2):
            ox, oy = gx * q, gy * q
            cx, cy = ox + q / 2, oy + q / 2
            k = gy * 2 + gx
            if k == 0:
                paint_disc(buf, size, size, cx, cy, q * 0.34, WHITE, 0.9)
                paint_disc(buf, size, size, cx, cy, q * 0.46, WHITE, 0.28)
            elif k == 1:
                paint_disc(buf, size, size, cx, cy, q * 0.36, SUMI, 0.0, ring=q * 0.09)
                paint_disc(buf, size, size, cx, cy, q * 0.18, SUMI, 0.35)
            elif k == 2:
                paint_polyline(buf, size, size, [(cx - q * 0.36, cy), (cx + q * 0.36, cy)], q * 0.09, GREEN_HI, 0.9)
                paint_polyline(buf, size, size, [(cx, cy - q * 0.36), (cx, cy + q * 0.36)], q * 0.09, GREEN_HI, 0.9)
            else:
                paint_tri(buf, size, size, (cx, cy - q * 0.34), (cx + q * 0.26, cy + q * 0.3), (cx - q * 0.26, cy + q * 0.3), VERMILION, 0.9)
    return buf

# ───────────────────────────────── 落盘

def main():
    dirs = ['web/icons', 'web/social', 'web/img']
    for d in dirs:
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
    rows = []

    master = make_master()
    mp = master_prefix(master)
    rows.append(('web/icons/master-1024.png', save_from_prefix(mp, os.path.join(ROOT, 'web/icons/master-1024.png'), 1024)))
    for size in (512, 192, 96, 64, 48, 32, 16):
        name = f'web/icons/icon-{size}.png' if size >= 192 else f'web/icons/favicon-{size}.png'
        rows.append((name, save_from_prefix(mp, os.path.join(ROOT, name), size)))
    # apple-touch：iOS 的圆角蒙版自己加，底必须不透明
    rows.append(('web/icons/apple-touch-icon-180.png', save_from_prefix(mp, os.path.join(ROOT, 'web/icons/apple-touch-icon-180.png'), 180, force_opaque=PAPER)))
    rows.append(('web/icons/icon-180.png', save_from_prefix(mp, os.path.join(ROOT, 'web/icons/icon-180.png'), 180, force_opaque=PAPER)))
    mask = make_maskable()
    rows.append(('web/icons/icon-maskable-512.png', save_scaled(mask, S, S, os.path.join(ROOT, 'web/icons/icon-maskable-512.png'), 512)))
    og = make_og()
    rows.append(('web/social/og-1200x630.png', write_png(os.path.join(ROOT, 'web/social/og-1200x630.png'), 1200, 630, og)))
    tiles = [
        ('web/img/paper-256.png', make_paper_tile(256), 256),
        ('web/img/pond-128.png', make_pond_tile(128), 128),
        ('web/img/ball-96.png', make_ball(96), 96),
        ('web/img/hole-96.png', make_hole(96), 96),
        ('web/img/particles-128.png', make_particles(128), 128),
    ]
    for name, buf, size in tiles:
        rows.append((name, write_png(os.path.join(ROOT, name), size, size, buf)))

    print(f'{"file":38s} {"bytes":>8s}  IHDR')
    for name, nbytes in rows:
        w, h, depth, color = png_ihdr(os.path.join(ROOT, name))
        print(f'{name:38s} {nbytes:8d}  {w}x{h} depth={depth} color={color}')
    total = sum(n for _, n in rows)
    print(f'WROTE {len(rows)} PNG total={total} bytes avg={total // len(rows)}')


if __name__ == '__main__':
    main()
