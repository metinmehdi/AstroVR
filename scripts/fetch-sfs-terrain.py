#!/usr/bin/env python3
"""
Real Nobile Rim 1 surface from NASA's Shape-from-Shading products for the Artemis III candidate regions
(Bertone et al. 2026, PSJ; NASA GSFC PGDA product 104; Zenodo 10.5281/zenodo.17954508), region A3CLR22-#7 (A307):
  A307_GLDELEV_005.tif  5 m/px elevation (SfS, tied to LOLA)
  A307_GLDOMOS_005.tif  5 m/px "maximally lit" LROC NAC orthomosaic (real photo of the ground, few shadows)
Only these two files are read out of the 2 GB zip with HTTP range requests (~77 MB).
Outputs (scene frame: x = east, z = south, metres relative to the site centre):
  src/data/terrain-nobile.json          heights, SIZE m square at STEP m
  public/textures/nobile-albedo.jpg     the orthomosaic resampled onto the same square (1024²), shading flattened
  python -I scripts/fetch-sfs-terrain.py      (needs numpy, tifffile, opencv-python)
"""
import io, json, math, os, sys, time, urllib.request, zipfile
import numpy as np
import tifffile
import cv2

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, '.cache', 'sfs')
os.makedirs(CACHE, exist_ok=True)
URL = 'https://zenodo.org/records/17954508/files/A3CLR22_7_Nobile_Rim_1.zip?download=1'
SIZE_ZIP = 1962014939
MEMBERS = {'elev': 'A3CLR22_7_Nobile_Rim_1/A307_GLDELEV_005.tif', 'omos': 'A3CLR22_7_Nobile_Rim_1/A307_GLDOMOS_005.tif'}
SITE = {'lat': -85.3003, 'lon': 37.0989}
R = 1737400.0
SIZE = 1280  # metres (square scene)
STEP = 5     # metres between height samples (native resolution)
TEX = 1024   # albedo texture size


class HttpFile(io.RawIOBase):
    """a seekable read-only file over HTTP range requests"""
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b''
        end = min(self.size, self.pos + n) - 1
        for attempt in range(6):
            try:
                req = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{end}'})
                data = urllib.request.urlopen(req, timeout=120).read()
                break
            except Exception as e:  # flaky network: retry
                if attempt == 5: raise
                time.sleep(2 + attempt * 2)
        self.pos += len(data)
        return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def fetch():
    need = [k for k, m in MEMBERS.items() if not os.path.exists(os.path.join(CACHE, os.path.basename(m)))]
    if not need: return
    z = zipfile.ZipFile(io.BufferedReader(HttpFile(URL, SIZE_ZIP), buffer_size=1 << 20))
    for k in need:
        m = MEMBERS[k]
        out = os.path.join(CACHE, os.path.basename(m))
        print('downloading', os.path.basename(m), round(z.getinfo(m).compress_size / 1e6, 1), 'MB', flush=True)
        with z.open(m) as src, open(out + '.part', 'wb') as dst:
            while True:
                chunk = src.read(4 << 20)
                if not chunk: break
                dst.write(chunk)
        os.replace(out + '.part', out)


def georef(tif):
    page = tif.pages[0]
    scale = page.tags['ModelPixelScaleTag'].value
    tie = page.tags['ModelTiepointTag'].value
    return tie[3], tie[4], scale[0]  # x0 (left), y0 (top), pixel size


def polar_xy(lat, lon):
    rho = 2 * R * math.tan(math.radians(90 + lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def sampler(img, x0, y0, px):
    """bilinear sample at projected (x, y) arrays"""
    def f(x, y):
        fc = (x - x0) / px - 0.5
        fr = (y0 - y) / px - 0.5
        return cv2.remap(img, fc.astype(np.float32), fr.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return f


def main():
    fetch()
    cx, cy = polar_xy(SITE['lat'], SITE['lon'])
    lon = math.radians(SITE['lon'])
    # local frame: north = away from the pole, east = increasing longitude (same as scripts/fetch-nasa-data.mjs)
    def to_proj(east, north):
        return cx + east * math.cos(lon) + north * math.sin(lon), cy - east * math.sin(lon) + north * math.cos(lon)

    with tifffile.TiffFile(os.path.join(CACHE, os.path.basename(MEMBERS['elev']))) as t:
        ex0, ey0, epx = georef(t)
        elev = t.asarray().astype(np.float32)
    nod = elev < -1e30
    if nod.any():
        elev[nod] = np.nan
    print('elev', elev.shape, 'px', epx, 'x0', ex0, 'y0', ey0, flush=True)
    elev = np.nan_to_num(elev, nan=float(np.nanmedian(elev)))
    elev = cv2.GaussianBlur(elev, (0, 0), 0.85)  # calm SfS image-seam striping; craters ≥ 15 m stay
    samp = sampler(elev, ex0, ey0, epx)

    half = SIZE / 2
    n = int(SIZE / STEP) + 1
    zs = -half + np.arange(n) * STEP          # rows: north (z = -half) → south
    xs = -half + np.arange(n) * STEP          # columns: west → east
    X, Z = np.meshgrid(xs, zs)
    E, N = X, -Z
    PX = cx + E * math.cos(lon) + N * math.sin(lon)
    PY = cy - E * math.sin(lon) + N * math.cos(lon)
    H = samp(PX, PY)
    centre = float(samp(np.array([[cx]]), np.array([[cy]]))[0, 0])
    H = H - centre
    out = {
        'source': 'NASA Shape-from-Shading 5 m/px elevation for Artemis III candidate region A3CLR22-#7 (Nobile Rim 1), '
                  'Bertone et al. 2026 (PSJ), NASA GSFC PGDA product 104, tied to LRO LOLA',
        'url': 'https://pgda.gsfc.nasa.gov/products/104',
        'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'site': SITE,
        'centreElevationM': round(centre, 1),
        'sizeM': SIZE,
        'stepM': STEP,
        'n': n,
        'layout': 'row-major; rows from north (z=-sizeM/2) to south; columns from west to east; metres relative to the centre',
        'minM': round(float(np.nanmin(H)), 1),
        'maxM': round(float(np.nanmax(H)), 1),
        'heights': [round(float(v), 2) for v in H.ravel()],
    }
    with open(os.path.join(ROOT, 'src', 'data', 'terrain-nobile.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print('terrain', n, 'x', n, 'range', out['minM'], out['maxM'], flush=True)

    # albedo: the maximally lit LROC NAC mosaic on the same square, shading flattened (we light it ourselves)
    with tifffile.TiffFile(os.path.join(CACHE, os.path.basename(MEMBERS['omos']))) as t:
        ox0, oy0, opx = georef(t)
        omos = t.asarray().astype(np.float32)
    omos[~np.isfinite(omos)] = 0
    print('omos', omos.shape, 'px', opx, 'range', float(np.percentile(omos, 1)), float(np.percentile(omos, 99)), flush=True)
    us = -half + (np.arange(TEX) + 0.5) * SIZE / TEX
    UX, UZ = np.meshgrid(us, us)
    PX = cx + UX * math.cos(lon) + (-UZ) * math.sin(lon)
    PY = cy - UX * math.sin(lon) + (-UZ) * math.cos(lon)
    A = sampler(omos, ox0, oy0, opx)(PX, PY)
    valid = A > 1e-4
    lo, hi = np.percentile(A[valid], [2, 99.5]) if valid.any() else (0, 1)
    A = np.clip((A - lo) / max(hi - lo, 1e-6), 0, 1)
    A[~valid] = np.median(A[valid]) if valid.any() else 0.5
    # flatten residual shading: divide by a heavy blur (keeps albedo detail: rays, fresh craters, boulders)
    low = cv2.GaussianBlur(A, (0, 0), 24)
    flat = np.clip(0.55 + (A - low) * 0.75 + (low - float(np.mean(low))) * 0.25, 0, 1)
    flat = cv2.bilateralFilter(flat.astype(np.float32), 5, 0.08, 3)  # keep crater rims, calm the noise
    img = (flat * 255).astype(np.uint8)
    cv2.imwrite(os.path.join(ROOT, 'public', 'textures', 'nobile-albedo.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    cv2.imwrite(os.path.join(CACHE, 'albedo-raw.jpg'), (A * 255).astype(np.uint8))
    print('albedo written', flush=True)


if __name__ == '__main__':
    main()
