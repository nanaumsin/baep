# board.html / kiosk.html = index.html 복사본 (머리 줄·제목만 다르고 feat-*.js 는 안 읽어요)
import sys
web=sys.argv[1] if len(sys.argv)>1 else '/home/claude/BaepApp/web'
s=open(web+'/index.html',encoding='utf8').read()
L=s.split('\n')
assert L[0].endswith('</head><body>') and L[1]=='<title>배프</title>'
body=[l for l in L[2:] if l not in ('<script src="feat-auth.js"></script>','<script src="feat-outing.js"></script>')]
for name,flag,title in [('board','__BOARD','배프 · 전체 화면 보기'),('kiosk','__KIOSK','배프 · 키오스크 연습')]:
    out=[L[0]+f'<script>window.{flag}=1</script>',f'<title>{title}</title>']+body
    open(f'{web}/{name}.html','w',encoding='utf8').write('\n'.join(out))
print('ok')
