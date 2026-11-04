#!/usr/bin/env python3
"""Nhập tài nguyên: 78 lá JPG + mặt sau + cắt thần Ra từ ảnh giao diện mẫu.
Dùng: python3 tools/import_assets.py --cards Cards-jpg --back back.png --mock mockup.png
(cần Pillow, numpy, opencv-python)"""
import argparse, glob, os, re, shutil
import numpy as np, cv2
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--cards', required=True); ap.add_argument('--back', required=True); ap.add_argument('--mock', required=True)
a = ap.parse_args()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'public', 'cards'); os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, '*')): os.remove(f)

# ---- 78 lá: 00-TheFool.jpg → major-00 ; Cups01.jpg → cups-01 ----
n = 0
for f in sorted(glob.glob(os.path.join(a.cards, '*.jpg'))):
    b = os.path.basename(f)
    m = re.match(r'^(\d\d)-', b); s = re.match(r'^(Wands|Cups|Swords|Pentacles)(\d\d)\.jpg$', b)
    cid = f'major-{m.group(1)}' if m else (f'{s.group(1).lower()}-{s.group(2)}' if s else None)
    if cid: shutil.copy(f, os.path.join(OUT, cid + '.jpg')); n += 1
print('lá bài:', n)
Image.open(a.back).convert('RGB').resize((640, 1137), Image.LANCZOS).save(os.path.join(OUT, 'back.jpg'), quality=90)

# ---- Thần Ra: cắt từ ảnh mẫu, xoá chữ/avatar/pill, làm mờ viền để hoà vào nền ----
im = cv2.imread(a.mock); H, W = im.shape[:2]
mask = np.zeros((H, W), np.uint8)
for x0, y0, x1, y1 in [(18, 8, 278, 68), (632, 8, 928, 68), (96, 250, 200, 520), (768, 250, 850, 420)]:
    mask[y0:y1, x0:x1] = 255
clean = cv2.inpaint(im, mask, 6, cv2.INPAINT_TELEA)
noise = np.random.default_rng(3).normal(0, 5, clean.shape).astype(np.int16)
clean = np.where(mask[..., None] > 0, np.clip(clean.astype(np.int16) + noise, 0, 255), clean).astype(np.uint8)
X0, X1, Y0, Y1 = 100, 840, 0, 540
crop = clean[Y0:Y1, X0:X1]; h, w = crop.shape[:2]
def ramp(v, a0, a1): t = np.clip((v - a0) / (a1 - a0), 0, 1); return t * t * (3 - 2 * t)
xs, ys = np.arange(w)[None, :], np.arange(h)[:, None]
alpha = ramp(xs, 0, 80) * ramp(w - xs, 0, 80) * ramp(ys, 0, 28) * ramp(h - ys, 0, 85)
alpha *= 1 - np.clip(ramp(ys, 230, 262) * (1 - ramp(xs, 0, 118)), 0, 1)                      # vệt avatar bên trái
alpha *= 1 - np.clip((1 - ramp(ys, 45, 120)) * (ramp(w * 0.3 - xs, 0, 70) + ramp(xs - w * 0.7, 0, 70)), 0, 1)  # vệt pill hai góc trên
rgba = np.dstack([cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])
img = Image.fromarray(rgba, 'RGBA').resize((w * 3 // 2, h * 3 // 2), Image.LANCZOS)
img.save(os.path.join(ROOT, 'public', 'assets', 'ra.png'), optimize=True)
print('ra.png', img.size)
