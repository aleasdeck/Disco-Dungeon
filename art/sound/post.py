# post.py name [lufs] — out/name.f32 (one pass + tail) -> seamless loop with master dynamics -> out/name.mp3 (+ .wav)
import os, sys, json, subprocess, numpy as np
name = sys.argv[1]; target = float(sys.argv[2]) if len(sys.argv) > 2 else -16.5
meta = json.load(open(f'out/{name}.json')); sr = meta['sr']; L = int(round(meta['L'] * sr)); P = int(0.3 * sr)
y = np.fromfile(f'out/{name}.f32', dtype=np.float32).reshape(-1, 2)
z = y[:L].copy(); tail = y[L:]; z[:len(tail)] += tail
def lufs(raw):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', '-af', 'ebur128=peak=true', '-f', 'null', '-'], input=raw, capture_output=True)
    t = r.stderr.decode().split('Summary:')[1]
    return float(t.split('I:')[1].split('LUFS')[0]), float(t.split('Peak:')[1].split('dBFS')[0])
# dynamics on three copies in a row, keep the middle one and a little either side: the result is periodic
I0, _ = lufs(z.astype(np.float32).tobytes())
# bring the dry mix near the target first, so the limiter only shaves the peaks
z = z * 10 ** ((target + 1.0 - I0) / 20)
tiled = np.concatenate([z, z, z]).astype(np.float32)
af = 'acompressor=threshold=0.25:ratio=2:attack=15:release=180:knee=2.8,alimiter=limit=0.79:attack=4:release=80:level=0'
p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', '-af', af, '-f', 'f32le', '-'], input=tiled.tobytes(), capture_output=True)
d = np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2)
seg = d[L - P: 2 * L + P]
open(f'out/{name}.loop.f32', 'wb').write(seg.astype(np.float32).tobytes())
I, pk = lufs(seg.tobytes())
# a last trim, never up past the limiter's ceiling
g = min(10 ** ((target - I) / 20), 0.8 / max(1e-6, np.abs(seg).max()))
seg = seg * g
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', '-c:a', 'libmp3lame', '-q:a', os.environ.get('Q', '4'), f'out/{name}.mp3'], input=seg.astype(np.float32).tobytes())
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', '-c:a', 'pcm_s16le', f'out/{name}.wav'], input=np.clip(seg, -1, 1).astype(np.float32).tobytes())
I2, pk2 = lufs(seg.astype(np.float32).tobytes())
print(f'{name}: dry {I0:.1f} LUFS, after dynamics {I:.1f}, final {I2:.1f} LUFS tp {pk2:.1f} dBFS, loop {meta["L"]:.4f} s')
