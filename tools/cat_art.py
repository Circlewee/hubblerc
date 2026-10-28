"""The sidebar's cat: a Siamese sitting, 32x32, drawn from shapes (outlined, cream with seal points,
blue eyes), each frame a pose of eyes, mouth, ear and tail.

  python3 tools/cat_art.py                      writes plugins/hubblerc/hooks/cat-art.ts
  python3 tools/cat_art.py --sheet OUT.png      an enlarged sheet of every pose, to look at
"""
import math, struct, sys, zlib

N = 32
PALETTE = {
    'O': (70, 50, 42),     # outline
    'C': (247, 238, 222),  # cream
    'L': (226, 210, 188),  # cream shade
    'M': (176, 136, 108),  # mask, light
    'S': (104, 72, 56),    # seal point
    'B': (100, 170, 236),  # eye
    'K': (40, 44, 60),     # pupil
    'W': (255, 255, 255),  # eye shine
    'P': (238, 146, 166),  # nose, inner ear
    'R': (246, 196, 200),  # blush
}


def in_ellipse(x, y, cx, cy, rx, ry):
    return ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1


def in_triangle(x, y, a, b, c):
    px, py = x + 0.5, y + 0.5
    def side(p, q):
        return (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1])
    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def frame(eyes='open', mouth='closed', ear='up', tail=0.0):
    """tail: 0 rests curled at the right foot, 1 raised at the side."""
    part = [[None] * N for _ in range(N)]   # which shape owns the pixel (drawn later wins)
    color = [[None] * N for _ in range(N)]

    def put(x, y, who, c):
        if 0 <= x < N and 0 <= y < N:
            part[y][x], color[y][x] = who, c

    # Tail: a thick curve from the hip, drawn first so the body sits over its root.
    root = (22.0, 27.0)
    tip = (29.0 - 1.0 * tail, 27.0 - 13.0 * tail - 3.0)
    mid = (30.5, 28.5 - 6.0 * tail)
    for i in range(80):
        t = i / 79
        x = (1 - t) ** 2 * root[0] + 2 * (1 - t) * t * mid[0] + t * t * tip[0]
        y = (1 - t) ** 2 * root[1] + 2 * (1 - t) * t * mid[1] + t * t * tip[1]
        r = 1.5 - 0.4 * t
        for yy in range(int(y - 2), int(y + 3)):
            for xx in range(int(x - 2), int(x + 3)):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r:
                    put(xx, yy, 'tail', 'S' if t > 0.35 else 'M')

    # Body: a pear, sitting.
    for y in range(N):
        for x in range(N):
            if y <= 30 and (in_ellipse(x, y, 16, 24.5, 8.5, 7) or in_ellipse(x, y, 16, 20, 6, 5)):
                put(x, y, 'body', 'C')
    # Shade: the body's right and bottom edges.
    for y in range(N):
        for x in range(N):
            if part[y][x] == 'body' and any(part[y + dy][x + dx] != 'body' for dx, dy in ((1, 0), (2, 0), (0, 1)) if 0 <= x + dx < N and 0 <= y + dy < N):
                if x >= 16 or y >= 29:
                    color[y][x] = 'L'
    # Front paws: seal toes at the foot of the body, a line between them.
    for cx in (12.5, 19.5):
        for x in range(int(cx - 2), int(cx + 2)):
            put(x, 30, 'body', 'S')
            if part[29][x] == 'body':
                color[29][x] = 'C'
    for x in (15, 16):
        for y in (29, 30):
            put(x, y, 'body', 'L')
    for y in (28, 29, 30):
        color[y][16] = 'O' if part[y][16] == 'body' else color[y][16]

    # Ears: triangles, seal, pink inside.
    ears = {'left': ((5.5, 10), (7.0, 0.5), (13.5, 5.5)), 'right': ((26.5, 10), (25.0, 0.5), (18.5, 5.5))}
    if ear == 'flick':
        ears['right'] = ((26.5, 10), (29.5, 3.5), (19.5, 5.5))
    for name, (a, b, c) in ears.items():
        for y in range(N):
            for x in range(N):
                if in_triangle(x, y, a, b, c):
                    put(x, y, 'ear', 'S')
        # Inner ear: the triangle shrunk toward its centre.
        gx, gy = (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3
        shrink = lambda p: (gx + (p[0] - gx) * 0.45, gy + (p[1] - gy) * 0.45 + 0.8)
        ia, ib, ic = shrink(a), shrink(b), shrink(c)
        for y in range(N):
            for x in range(N):
                if in_triangle(x, y, ia, ib, ic):
                    put(x, y, 'ear', 'P')

    # Head: wide and round, the mask darkening toward the muzzle.
    hx, hy = 16, 11.5
    for y in range(N):
        for x in range(N):
            if in_ellipse(x, y, hx, hy, 11, 8.5):
                d = math.hypot((x + 0.5 - 16) / 1.25, y + 0.5 - 15.2)
                c = 'S' if d < 2.6 else 'M' if d < 4.6 else 'C'
                put(x, y, 'head', c)
    # Mask reaching up to the eyes.
    for ex in (10, 21):
        for y in range(9, 15):
            for x in range(ex - 2, ex + 2):
                if in_ellipse(x, y, ex + 0.0, 12.2, 2.6, 2.4) and part[y][x] == 'head' and color[y][x] == 'C':
                    color[y][x] = 'M'

    # Eyes: 2 wide, 3 tall, a shine at the top.
    def eye(ex, dx=0, dy=0):
        x0, y0 = ex - 1 + dx, 11 + dy
        for y in range(y0, y0 + 3):
            for x in range(x0, x0 + 2):
                put(x, y, 'head', 'B')
        put(x0 + (1 if dx >= 0 else 0), y0 + 1, 'head', 'K')
        put(x0 + (1 if dx >= 0 else 0), y0 + 2, 'head', 'K')
        put(x0, y0, 'head', 'W')

    if eyes == 'shut':
        for ex in (10, 21):
            for x in range(ex - 1, ex + 1):
                put(x, 13, 'head', 'O')
            put(ex - 2, 12, 'head', 'O')
            put(ex + 1, 12, 'head', 'O')
    else:
        dx = {'left': -1, 'right': 1}.get(eyes, 0)
        dy = -1 if eyes == 'up' else 0
        for ex in (10, 21):
            eye(ex, dx, dy)
        if eyes == 'wide':
            for ex in (10, 21):
                put(ex - 1, 10, 'head', 'B')
                put(ex, 10, 'head', 'B')
                put(ex - 1, 10, 'head', 'W')

    # Blush, nose, mouth.
    for x in (6, 7):
        put(x, 15, 'head', 'R')
    for x in (24, 25):
        put(x, 15, 'head', 'R')
    put(15, 14, 'head', 'P')
    put(16, 14, 'head', 'P')
    if mouth == 'open':
        put(15, 16, 'head', 'O'); put(16, 16, 'head', 'O')
        put(15, 17, 'head', 'P'); put(16, 17, 'head', 'P')
    else:
        put(15, 16, 'head', 'O'); put(16, 16, 'head', 'O')
        put(14, 16, 'head', 'O'); put(17, 16, 'head', 'O')

    # Outline: empty pixels touching a shape; and a line where a shape lies over a different one.
    out = [row[:] for row in color]
    order = {'tail': 0, 'body': 1, 'paw': 2, 'ear': 2, 'head': 3}
    for y in range(N):
        for x in range(N):
            here = part[y][x]
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                there = part[ny][nx] if 0 <= nx < N and 0 <= ny < N else None
                if here is None and there is not None:
                    out[y][x] = 'O'
                elif here is not None and there is not None and here != there and order[here] < order[there] and not (here == 'ear' and there == 'head'):
                    out[y][x] = 'O'
    return [''.join(c or '.' for c in row) for row in out]


POSES = {
    'rest': {},
    'blink': {'eyes': 'shut'},
    'sleep': {'eyes': 'shut', 'tail': 0.0},
    'think': {'eyes': 'up'},
    'mouth': {'mouth': 'open'},
    'left': {'eyes': 'left', 'tail': 0.5},
    'right': {'eyes': 'right', 'ear': 'flick', 'tail': 1.0},
    'startled': {'eyes': 'wide', 'mouth': 'open', 'tail': 1.0},
    'tail-mid': {'tail': 0.5},
    'tail-up': {'tail': 1.0},
}


def write_png(path, img):
    h, w = len(img), len(img[0])
    raw = b''.join(b'\x00' + bytes(c for p in row for c in p) for row in img)
    ch = lambda k, d: struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))


def sheet(path, names, z=8):
    bg, panel = (20, 20, 24), (36, 36, 42)
    W = len(names) * (N + 2) * z + z * 2
    canvas = [[bg] * W for _ in range((N + 4) * z)]
    for k, n in enumerate(names):
        art = frame(**POSES[n])
        ox, oy = z * 2 + k * (N + 2) * z, z * 2
        for y, r in enumerate(art):
            for x, c in enumerate(r):
                p = PALETTE.get(c, panel)
                for j in range(z):
                    canvas[oy + y * z + j][ox + x * z:ox + (x + 1) * z] = [p] * z
    write_png(path, canvas)


# The frames the mod uses, by the name it gives them, and what each is.
EXPORTS = {
    'REST': ('rest', 'Sitting, eyes open, the tail curled at its foot.'),
    'SHUT': ('blink', 'Eyes shut: asleep, or a blink.'),
    'LOOK_UP': ('think', 'Eyes up: thinking.'),
    'MOUTH': ('mouth', 'The mouth open: writing.'),
    'LOOK_LEFT': ('left', 'Eyes left, the tail half raised: a tool runs.'),
    'LOOK_RIGHT': ('right', 'Eyes right, the right ear flicked, the tail raised: a tool runs.'),
    'STARTLED': ('startled', 'Wide eyes, the mouth open, the tail up: a call failed.'),
}


def write_ts(path):
    lines = ['/**',
             " * The sidebar's cat: a Siamese sitting, 32 pixels by 32. Written by `tools/cat_art.py` (edit",
             ' * there, then run it): `.` transparent, other letters keys of `CAT_PALETTE`.',
             ' */',
             '',
             'export const CAT_PALETTE: Record<string, string> = {']
    lines += [f"  {k}: '#{r:02X}{g:02X}{b:02X}'," for k, (r, g, b) in PALETTE.items()]
    lines += ['}', '']
    for const, (pose, note) in EXPORTS.items():
        lines += [f'/** {note} */', f'export const {const}: readonly string[] = [']
        lines += [f"  '{row}'," for row in frame(**POSES[pose])]
        lines += [']', '']
    open(path, 'w').write('\n'.join(lines).rstrip() + '\n')


if __name__ == '__main__':
    import os
    if len(sys.argv) > 2 and sys.argv[1] == '--sheet':
        sheet(sys.argv[2], list(POSES))
    else:
        here = os.path.dirname(os.path.abspath(__file__))
        write_ts(os.path.join(here, '..', 'plugins', 'hubblerc', 'hooks', 'cat-art.ts'))
