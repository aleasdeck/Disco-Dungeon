import subprocess, sys, numpy as np
import json
for p in sys.argv[1:]:
    name = p.split('/')[-1].split('.')[0]
    raw = subprocess.run(['ffmpeg','-loglevel','error','-i',p,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32); sr=44100
    L = json.load(open(f'out/{name}.json'))['L']; P=0.3; a=int(P*sr); b=a+int(round(L*sr)); k=int(0.25*sr)
    d = x[a-k:a+k]-x[b-k:b+k]
    jump = abs(x[b-1]-x[a]) ; step = np.abs(np.diff(x[a-k:a+k])).mean()
    print(f'{p:20s} len {len(x)/sr:.3f} seam diff {20*np.log10(np.sqrt((d**2).mean())+1e-9):6.1f} dB vs signal {20*np.log10(np.sqrt((x[a-k:a+k]**2).mean())):6.1f} dB; jump {jump:.4f} typical step {step:.4f}')
