# Shrinks the rendered icons (256-colour palette, alpha kept) so the sensor's flash and the page cache stay small.
import os, sys
from PIL import Image
out = sys.argv[1]
for f in ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon-32.png"]:
    p = os.path.join(out, f); im = Image.open(p).convert("RGBA"); a = im.getchannel("A")
    q = im.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    if a.getextrema()[0] == 255: q.save(p, optimize=True)
    else: o = q.convert("RGBA"); o.putalpha(a); o.save(p, optimize=True)
    print(f, os.path.getsize(p), "bytes")
