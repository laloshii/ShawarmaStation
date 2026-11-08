"""Shawarma Station storefront and administration. Run setup before serving."""
import base64
import hashlib
import hmac
import io
import json
import os
import secrets
import sqlite3
import sys
import time
from contextlib import contextmanager
from getpass import getpass
from pathlib import Path
from typing import Literal


from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('STATION_DATA', ROOT / 'private'))
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
DB = DATA / 'station.sqlite'
ORIGIN = os.environ.get('STATION_ORIGIN', 'http://127.0.0.1:8000').rstrip('/')
local = ORIGIN in ('http://127.0.0.1:8000', 'http://localhost:8000')
if not local and not ORIGIN.startswith('https://'):
    raise RuntimeError('Public origins require HTTPS')

@contextmanager
def db(write=False):
    conn = sqlite3.connect(DB, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
        yield conn
        conn.commit()
    finally:
        conn.close()

def setup():
    password = getpass('New admin password (14+ characters): ')
    if len(password) < 14 or password != getpass('Repeat password: '):
        raise SystemExit('Password is short or does not match')
    with db(True) as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY,v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, data BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,place TEXT,created INTEGER,done INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS limits(k TEXT PRIMARY KEY, n INTEGER,until INTEGER);
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE, fingerprint TEXT, created INTEGER, state TEXT, body TEXT);
        """)
        if not c.execute("SELECT 1 FROM config WHERE k='categories'").fetchone():
            seed = json.loads((ROOT/'seed.json').read_text())
            for k in ('categories','addons'):
                c.execute('INSERT INTO config VALUES(?,?)',(k,json.dumps(seed[k])))
            for p in seed['products']:
                p['version'] = 1
                c.execute('INSERT INTO items VALUES(?,?)',(p['id'],json.dumps(p)))
        salt = secrets.token_bytes(16)
        hashed = derive(password,salt)
        c.execute("INSERT OR REPLACE INTO config VALUES('auth',?)",(salt.hex()+':'+hashed.hex(),))
        c.execute('DELETE FROM sessions')
    DB.chmod(0o600)

def derive(password,salt):
    return hashlib.scrypt(password.encode(),salt=salt,n=2**16,r=8,p=2,maxmem=128*1024*1024)

app = FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

@app.middleware('http')
async def guard(req, call_next):
    if req.method not in ('GET','HEAD'):
        if req.headers.get('origin') != ORIGIN:
            return JSONResponse({'detail':'مصدر الطلب غير مسموح'},403)
        limit = 3_000_000 if req.url.path == '/api/items' else 80_000
        length = req.headers.get('content-length','')
        if not length.isdecimal() or int(length)>limit or req.headers.get('transfer-encoding'):
            return JSONResponse({'detail':'حجم الطلب غير مسموح'},413)
    res = await call_next(req)
    res.headers.update({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'"})
    if req.url.path.startswith('/api/'):
        res.headers['Cache-Control']='no-store'
    return res

def fail(code,msg):
    raise HTTPException(code,msg)

def config(c,k):
    return c.execute('SELECT v FROM config WHERE k=?',(k,)).fetchone()[0]

def catalog(c):
    return dict(products=[json.loads(r[0]) for r in c.execute('SELECT body FROM items ORDER BY id')],
                categories=json.loads(config(c,'categories')),addons=json.loads(config(c,'addons')))

def admin(req:Request):
    token = req.cookies.get('station_session','')
    digest=hashlib.sha256(token.encode()).hexdigest()
    with db() as c:
        if not c.execute('SELECT 1 FROM sessions WHERE token=? AND expires>?',(digest,time.time())).fetchone():
            fail(401,'سجّلي الدخول للمتابعة')
    return digest

def throttle(req,scope,maximum,seconds):
    now=int(time.time())
    key=scope+':'+req.client.host
    with db(True) as c:
        c.execute('DELETE FROM limits WHERE until<=?',(now,))
        c.execute('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1',(key,now+seconds))
        if c.execute('SELECT n FROM limits WHERE k=?',(key,)).fetchone()[0]>maximum:
            fail(429,'محاولات كثيرة، حاولي لاحقاً')

class Login(BaseModel):
    password:str=Field(max_length=512)

@app.post('/api/login')
def login(data:Login,req:Request,res:Response):
    throttle(req,'login',8,300)
    with db() as c:
        salt,expected=config(c,'auth').split(':')
    if not hmac.compare_digest(derive(data.password,bytes.fromhex(salt)).hex(),expected):
        fail(401,'كلمة المرور غير صحيحة')
    token=secrets.token_urlsafe(32)
    with db(True) as c:
        c.execute('DELETE FROM sessions WHERE expires<=?',(time.time(),))
        c.execute('INSERT INTO sessions VALUES(?,?)',(hashlib.sha256(token.encode()).hexdigest(),int(time.time())+14400))
    res.set_cookie('station_session',token,httponly=True,secure=not local,samesite='strict',max_age=14400,path='/api')
    return {'ok':True}

@app.post('/api/logout')
def logout(res:Response, digest=Depends(admin)):
    with db(True) as c:
        c.execute('DELETE FROM sessions WHERE token=?',(digest,))
    res.delete_cookie('station_session',path='/api')
    return {'ok':True}

@app.get('/api/menu')
def menu():
    with db() as c:
        data=catalog(c)
    data['products']=[p for p in data['products'] if p['available']]
    return data

@app.get('/api/manage')
def manage(_=Depends(admin)):
    with db() as c:
        return catalog(c)

class Item(BaseModel):
    id:int=Field(ge=0)
    version:int=Field(ge=0)
    name:str=Field(min_length=1,max_length=100,pattern=r'\S')
    desc:str=Field(max_length=500)
    price:int=Field(ge=0,le=10000000)
    category_id:int
    quick_id:int
    addons:list[int]=Field(max_length=30)
    available:bool
    photo:str|None=Field(default=None,max_length=2800000)

def photo(text):
    try:
        raw=base64.b64decode(text,validate=True)
        with Image.open(io.BytesIO(raw),formats=('JPEG','PNG','WEBP')) as im:
            if im.width*im.height>12000000:
                fail(400,'اختاري صورة أصغر')
            im=ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((1200,1200))
            stream=io.BytesIO()
            im.save(stream,'JPEG',quality=83)
            return stream.getvalue()
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError):
        fail(400,'ملف الصورة غير صالح')

@app.post('/api/items')
def save_item(p:Item,_=Depends(admin)):
    picture=photo(p.photo) if p.photo else None
    with db(True) as c:
        cats=json.loads(config(c,'categories'))
        allowed=json.loads(config(c,'addons'))
        if (p.category_id not in [v['id'] for v in cats['main']] or p.quick_id not in [v['id'] for v in cats['quick']]
            or not set(p.addons)<= {v['id'] for v in allowed}):
            fail(400,'تحققي من التصنيف والإضافات')
        row=c.execute('SELECT body FROM items WHERE id=?',(p.id,)).fetchone()
        old=json.loads(row[0]) if row else {}
        if p.id and old.get('version')!=p.version:
            fail(409,'تغيّر الصنف. حدّثي الصفحة ثم أعيدي التعديل')
        item=p.model_dump(exclude={'photo'})
        if not p.id:
            item['id']=c.execute('SELECT COALESCE(MAX(id),0)+1 FROM items').fetchone()[0]
        item['version']=old.get('version',0)+1
        item['image']=old.get('image','')
        if picture:
            key=hashlib.sha256(picture).hexdigest()
            c.execute('INSERT OR IGNORE INTO photos VALUES(?,?)',(key,picture))
            item['image']='/images/'+key
        c.execute('INSERT OR REPLACE INTO items VALUES(?,?)',(item['id'],json.dumps(item)))
    return {'ok':True}

@app.get('/images/{key}')
def image(key:str):
    with db() as c:
        row=c.execute('SELECT data FROM photos WHERE id=?',(key,)).fetchone()
    if not row:fail(404,'الصورة غير موجودة')
    return Response(row[0],media_type='image/jpeg')

class Line(BaseModel):
    id:int
    qty:int=Field(ge=1,le=30)
    addons:list[int]=Field(max_length=30)
    version:int
    note:str=Field(default='',max_length=200)

class Order(BaseModel):
    key:str=Field(pattern='^[a-f0-9-]{36}$')
    name:str=Field(min_length=1,max_length=80,pattern=r'\S')
    mode:Literal['داخلي','خارجي']
    place:str=Field(min_length=1,max_length=200,pattern=r'\S')
    phone:str=Field(default='',max_length=25)
    lines:list[Line]=Field(min_length=1,max_length=50)

@app.post('/api/orders')
def order(p:Order,req:Request):
    throttle(req,'order',30,600)
    fingerprint=hashlib.sha256(p.model_dump_json().encode()).hexdigest()
    with db(True) as c:
        prior=c.execute('SELECT id,fingerprint FROM orders WHERE request_id=?',(p.key,)).fetchone()
        if prior:
            if fingerprint!=prior[1]:fail(409,'أعيد استخدام رقم محاولة سابق')
            return {'id':prior[0]}
        if p.mode=='خارجي' and not p.phone.strip():fail(400,'أدخلي رقم التواصل')
        data=catalog(c)
        foods={f['id']:f for f in data['products']}
        extras={a['id']:a for a in data['addons']}
        lines=[]
        for l in p.lines:
            f=foods.get(l.id)
            if not f or not f['available'] or l.version!=f['version']:
                fail(409,'تغيّر أحد الأصناف. حدّثي المينو وأعيدي اختياره')
            if len(set(l.addons))!=len(l.addons) or not set(l.addons)<=set(f['addons']):
                fail(400,'إضافات غير متاحة للصنف')
            selected=[extras[i] for i in l.addons]
            lines.append(dict(name=f['name'],qty=l.qty,extras=[a['name'] for a in selected],note=l.note,
                              total=l.qty*(f['price']+sum(a['price'] for a in selected))))
        body=p.model_dump(exclude={'lines','key'})
        body.update(lines=lines,total=sum(l['total'] for l in lines))
        oid=c.execute('INSERT INTO orders(request_id,fingerprint,created,state,body) VALUES(?,?,?,?,?)',
            (p.key,fingerprint,int(time.time()),'جديد',json.dumps(body))).lastrowid
    return {'id':oid}

@app.get('/api/orders')
def list_orders(_=Depends(admin)):
    with db() as c:
        return [dict(id=r[0],created=r[1],state=r[2],**json.loads(r[3])) for r in c.execute('SELECT id,created,state,body FROM orders ORDER BY id DESC LIMIT 150')]

class Status(BaseModel):
    state:Literal['جديد','قيد التحضير','مكتمل','ملغى']
    previous:str

@app.post('/api/orders/{oid}')
def status(oid:int,p:Status,_=Depends(admin)):
    with db(True) as c:
        if not c.execute('UPDATE orders SET state=? WHERE id=? AND state=?',(p.state,oid,p.previous)).rowcount:
            fail(409,'تغيّرت حالة الطلب. حدّثي القائمة')
    return {'ok':True}

class Extra(BaseModel):
    id:int=Field(ge=0)
    name:str=Field(min_length=1,max_length=80,pattern=r'\S')
    price:int=Field(ge=0,le=10000000)
    previous_price:int|None=None
    previous_name:str|None=None

@app.post('/api/extras')
def update_extra(p:Extra,_=Depends(admin)):
    with db(True) as c:
        extras=json.loads(config(c,'addons'))
        old=next((a for a in extras if a['id']==p.id),None)
        if p.id and (not old or old['price']!=p.previous_price or old['name']!=p.previous_name):
            fail(409,'تغيّرت الإضافة. حدّثي الصفحة')
        if old:
            old.update(name=p.name,price=p.price)
        else:
            extras.append(dict(id=max([a['id'] for a in extras],default=0)+1,name=p.name,price=p.price))
        c.execute("UPDATE config SET v=? WHERE k='addons'",(json.dumps(extras),))
        for row in c.execute('SELECT body FROM items').fetchall():
            item=json.loads(row[0])
            if p.id in item['addons']:
                item['version']+=1
                c.execute('UPDATE items SET body=? WHERE id=?',(json.dumps(item),item['id']))
    return {'ok':True}

class Call(BaseModel):
    table:str=Field(min_length=1,max_length=20,pattern=r'\S')

@app.post('/api/captain')
def captain(data:Call,req:Request):
    throttle(req,'captain',4,300)
    with db(True) as c:
        now=int(time.time())
        if not c.execute('SELECT 1 FROM calls WHERE place=? AND done=0 AND created>?',(data.table,now-300)).fetchone():
            c.execute('INSERT INTO calls(place,created) VALUES(?,?)',(data.table,now))
    return {'ok':True}

@app.get('/api/captain')
def pending(_=Depends(admin)):
    with db() as c:
        return [dict(r) for r in c.execute('SELECT id,place,created FROM calls WHERE done=0 ORDER BY id')]

@app.post('/api/captain/{cid}')
def resolve_call(cid:int,_=Depends(admin)):
    with db(True) as c:
        c.execute('UPDATE calls SET done=1 WHERE id=?',(cid,))
    return {'ok':True}

@app.get('/admin/index.html')
@app.get('/admin/')
def admin_page():
    return FileResponse(ROOT/'public/admin.html')

app.mount('/',StaticFiles(directory=ROOT/'public',html=True),name='public')

if __name__=='__main__' and sys.argv[1:]==['setup']:
    setup()
