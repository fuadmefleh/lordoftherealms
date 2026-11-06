# Make a seamless tile from a uniform texture crop and verify it.
import sys, math
from PIL import Image, ImageChops, ImageFilter, ImageStat
def flatten(t, r=60):
    blur=t.filter(ImageFilter.GaussianBlur(r)); mean=ImageStat.Stat(t).mean
    a=t.load(); b=blur.load(); o=Image.new('RGB',t.size); p=o.load()
    for y in range(t.size[1]):
        for x in range(t.size[0]):
            p[x,y]=tuple(max(0,min(255,int(a[x,y][c]*mean[c]/max(1,b[x,y][c])))) for c in range(3))
    return o
def seamless(t):
    N=t.size[0]
    m=Image.new('L',(N,N)); mp=m.load()
    for y in range(N):
        for x in range(N):
            v=math.sin(math.pi*(x+0.5)/N)*math.sin(math.pi*(y+0.5)/N); mp[x,y]=int(255*min(1,v*1.8))
    return Image.composite(t, ImageChops.offset(t,N//2,N//2), m)
def metrics(t):
    W,H=t.size; a=t.load()
    d=lambda p,q: sum(abs(p[i]-q[i]) for i in range(3))
    inner=sum(d(a[x,y],a[x-1,y]) for y in range(H) for x in range(1,W))/(H*(W-1))
    wrapx=sum(d(a[0,y],a[W-1,y]) for y in range(H))/H
    wrapy=sum(d(a[x,0],a[x,H-1]) for x in range(W))/W
    L=lambda p:0.299*p[0]+0.587*p[1]+0.114*p[2]
    q=[0]*4
    for y in range(H):
        for x in range(W): q[(y>=H//2)*2+(x>=W//2)]+=L(a[x,y])
    q=[round(v/(W*H/4),1) for v in q]
    return dict(inner=round(inner,1), wrapx=round(wrapx,1), wrapy=round(wrapy,1), quadL=q, mean=[round(v) for v in ImageStat.Stat(t).mean])
if __name__=='__main__':
    src,box,out=sys.argv[1],tuple(map(int,sys.argv[2].split(','))),sys.argv[3]
    size=int(sys.argv[4]) if len(sys.argv)>4 else 128
    t=Image.open(src).convert('RGB').crop(box)
    t=flatten(t)
    t=seamless(t)
    # downscale wrapping round: a 3x3 repeat, the middle cut out
    N=t.size[0]; big3=Image.new('RGB',(N*3,N*3))
    for yy in range(3):
        for xx in range(3): big3.paste(t,(xx*N,yy*N))
    t=big3.resize((size*3,size*3),Image.LANCZOS).crop((size,size,size*2,size*2))
    t.save(out)
    print(metrics(t))
    big=Image.new('RGB',(size*4,size*4))
    for yy in range(4):
        for xx in range(4): big.paste(t,(xx*size,yy*size))
    big.save(out.replace('.png','_4x4.png'))
