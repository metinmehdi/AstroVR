#!/usr/bin/env python3
"""
Builds the capsule interior from a REAL NASA 360° photo of the Orion crew module that flew Artemis I
(KSC-20220808-PH-FMX02_0002, NASA/Frank Michaux, public domain, taken in the VAB on 8 Aug 2022).
  public/textures/orion-cabin.jpg       4096×2048 equirectangular (lightly sharpened)
  public/textures/orion-cabin-mask.png  4096×2048 alpha: 0 = window glass / open hatch (real footage / space shows
                                        through), 255 = cabin
The two side-window panes are found automatically (the white "REMOVE BEFORE FLIGHT" covers, holes filled); the open
side hatch is a traced polygon minus the yellow ground-support hose in front of it.
  python -I scripts/build-cabin-pano.py        (needs opencv-python + numpy; curl downloads the photo once)
"""
import os, subprocess, sys
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, '.cache', 'pano')
os.makedirs(CACHE, exist_ok=True)
SRC = os.path.join(CACHE, 'KSC-20220808-PH-FMX02_0002.jpg')
URL = 'https://images-assets.nasa.gov/image/KSC-20220808-PH-FMX02_0002/KSC-20220808-PH-FMX02_0002~orig.jpg'
if not os.path.exists(SRC):
    subprocess.run(['curl', '-s', '-L', '-o', SRC, URL], check=True)

img = cv2.imread(SRC)  # 3840×2160 equirectangular (full sphere, 16:9)
H0, W0 = img.shape[:2]
mask = np.full((H0, W0), 255, np.uint8)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)


def window_pane(x0, y0, x1, y1):
    """the white cover plate inside the box → filled outline of the window pane"""
    roi = hsv[y0:y1, x0:x1]
    white = ((roi[..., 2] > 62) & (roi[..., 1] < 60)).astype(np.uint8) * 255
    white = cv2.morphologyEx(white, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(white)
    # the black straps cut the cover into pieces: keep every large piece whose centre is well inside the box
    h, w = white.shape
    comp = np.zeros_like(white)
    for k in range(1, n):
        x, y, cw, ch, area = stats[k]
        cx, cy = x + cw / 2, y + ch / 2
        if area > 1500 and cw < 0.97 * w and 0.12 * w < cx < 0.88 * w and 0.12 * h < cy < 0.88 * h:
            comp[lab == k] = 255
    pts = cv2.findNonZero(comp)
    filled = np.zeros_like(comp)
    cv2.drawContours(filled, [cv2.convexHull(pts)], -1, 255, -1)
    filled = cv2.erode(filled, np.ones((7, 7), np.uint8))  # stay just inside the frame
    mask[y0:y1, x0:x1][filled > 0] = 0
    ys, xs = np.nonzero(filled)
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max(), y0 + ys.max())


w1 = window_pane(480, 860, 860, 1170)
def window_poly(points):
    """a pane traced by hand on the full-size photo (this cover sits in shadow; thresholds are unreliable)"""
    m = np.zeros_like(mask)
    cv2.fillPoly(m, [np.array(points, np.int32)], 255)
    m = cv2.erode(m, np.ones((5, 5), np.uint8))
    mask[m > 0] = 0
    ys, xs = np.nonzero(m)
    return (xs.min(), ys.min(), xs.max(), ys.max())


w2 = window_poly([(962, 910), (1000, 885), (1110, 878), (1250, 910), (1310, 935), (1335, 1000), (1330, 1090), (1300, 1145),
                  (1255, 1160), (1050, 1162), (980, 1145), (958, 1090), (955, 990)])

# open side hatch (wraps across the seam): traced opening, minus the yellow ground-support hose in front of it
hatch = np.zeros((H0, W0), np.uint8)
left = np.array([[3635, 760], [3670, 720], [3770, 702], [3840, 700], [3840, 1018], [3740, 1018], [3680, 1000], [3645, 930], [3640, 800]], np.int32)
right = np.array([[0, 700], [20, 700], [55, 718], [70, 750], [72, 1000], [55, 1015], [0, 1018]], np.int32)
cv2.fillPoly(hatch, [left, right], 255)
yellow = cv2.inRange(hsv, (15, 90, 90), (40, 255, 255))
n, lab, st, _ = cv2.connectedComponentsWithStats(yellow)
hose = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8) * 255  # the hose = biggest yellow part
keep = cv2.dilate(hose, np.ones((9, 9), np.uint8))
hatch[keep > 0] = 0
mask[hatch > 0] = 0

# soft edges
mask = cv2.GaussianBlur(mask, (5, 5), 0)

W, H = 4096, 2048
out = cv2.resize(img, (W, H), interpolation=cv2.INTER_LANCZOS4)
blur = cv2.GaussianBlur(out, (0, 0), 1.2)
out = cv2.addWeighted(out, 1.45, blur, -0.45, 0)  # gentle unsharp mask
cv2.imwrite(os.path.join(ROOT, 'public', 'textures', 'orion-cabin.jpg'), out, [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
m = cv2.resize(mask, (W, H), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(ROOT, 'public', 'textures', 'orion-cabin-mask.png'), m, [cv2.IMWRITE_PNG_COMPRESSION, 9])

# window directions (for placing the footage behind them): azimuth/elevation in degrees of the photo
def dirs(b):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return round(cx / W0 * 360 - 180, 1), round((H0 / 2 - cy) / H0 * 180, 1), round((b[2] - b[0]) / W0 * 360, 1), round((b[3] - b[1]) / H0 * 180, 1)
print('window 1 az/el/w/h', dirs(w1))
print('window 2 az/el/w/h', dirs(w2))
print('wrote orion-cabin.jpg', os.path.getsize(os.path.join(ROOT, 'public', 'textures', 'orion-cabin.jpg')) // 1024, 'KB, mask',
      os.path.getsize(os.path.join(ROOT, 'public', 'textures', 'orion-cabin-mask.png')) // 1024, 'KB')
# preview for checking the mask by eye
prev = cv2.resize(img, (1920, 1080))
mm = cv2.resize(mask, (1920, 1080))
prev[mm < 128] = (prev[mm < 128] * 0.3 + np.array([255, 0, 255]) * 0.7).astype(np.uint8)
cv2.imwrite(os.path.join(CACHE, 'mask-preview.jpg'), prev)
