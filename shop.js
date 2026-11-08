import {$,el,btn,money,header,label,field,api,notice,report} from './common.js';
let data,category=0,en=localStorage.getItem('station.lang')==='en';
const tr=(a,b)=>en?b:a;
const read=(key,alt)=>{try{return JSON.parse(localStorage.getItem(key))??alt}catch{return alt}};
let cart=read('station.cart',[]),favs=read('station.favs',[]);
if(!Array.isArray(cart))cart=[];
if(!Array.isArray(favs))favs=[];
let requestKey=localStorage.getItem('station.orderKey')||crypto.randomUUID();
let lastPayload=localStorage.getItem('station.lastPayload')||'';
const food=id=>data.products.find(p=>p.id===id);
const extra=id=>data.addons.find(a=>a.id===id);
const valid=l=>food(l.id)?.version===l.version;
const cost=l=>valid(l)?l.qty*(food(l.id).price+l.addons.reduce((s,id)=>s+(extra(id)?.price||0),0)):0;
const sum=()=>cart.reduce((s,l)=>s+cost(l),0);
function save(){localStorage.setItem('station.cart',JSON.stringify(cart));bar()}
function bar(){
  $('basket').hidden=!cart.length;
  $('basket').textContent=tr('عرض الطلب','View order')+' · '+cart.reduce((s,l)=>s+l.qty,0)+' · '+money(sum());
}
function draw(){
  const cats=[...data.categories.main].sort((a,b)=>Number(a.name==='مشروبات')-Number(b.name==='مشروبات'));
  $('filters').replaceChildren();
  for(const c of [{id:0,name:tr('الكل','All')},...cats,{id:-1,name:tr('المفضلة','Favorites')}]){
    const b=btn(c.name,()=>{category=c.id;draw()},category===c.id?'active':'');b.setAttribute('aria-pressed',category===c.id);$('filters').append(b);
  }
  $('foods').replaceChildren();
  const term=$('search').value.trim().toLowerCase();
  for(const c of cats){
    if(category>0&&category!==c.id)continue;
    const products=data.products.filter(p=>p.category_id===c.id&&(category!==-1||favs.includes(p.id))&&(p.name+' '+p.desc).toLowerCase().includes(term));
    if(!products.length)continue;
    const section=el('section','','group'),grid=el('div','','grid');section.append(el('h2',c.name),grid);
    for(const p of products){
      const card=btn('',()=>openFood(p),'card');
      if(p.image){const img=el('img');img.src=p.image;img.alt='';img.loading='lazy';card.append(img)}
      const foot=el('div','','line');foot.append(el('strong',money(p.price)),el('span','+','plus'));
      card.append(el('h3',p.name),el('p',p.desc),foot);grid.append(card);
    }
    $('foods').append(section);
  }
  if(!$('foods').children.length)$('foods').append(el('p',tr('ما في أصناف مطابقة.','No matching items.')));
  bar();
}
function openFood(p){
  const d=$('item');header(d,p.name);d.append(el('p',p.desc,'muted'));
  const fav=btn('',()=>{favs=favs.includes(p.id)?favs.filter(id=>id!==p.id):[...favs,p.id];localStorage.setItem('station.favs',JSON.stringify(favs));favText();draw()});
  const favText=()=>fav.textContent=favs.includes(p.id)?tr('♥ محفوظ','♥ Saved'):tr('♡ حفظ بالمفضلة','♡ Save favorite');
  favText();d.append(fav);
  const options=el('div','','options'),chosen=new Set();
  const qty=field('number',1),note=field('text','',200);qty.min=1;qty.max=30;
  for(const id of p.addons){
    const a=extra(id);if(!a)continue;
    const cb=field('checkbox');cb.onchange=()=>{cb.checked?chosen.add(id):chosen.delete(id);refresh()};
    options.append(label(a.name+' · '+money(a.price),cb));
  }
  const add=btn('',()=>{if(!qty.reportValidity()||!qty.value)return;
    if(cart.length>=50){report(d,tr('السلة ممتلئة','Cart is full'));return}
    cart.push({id:p.id,version:p.version,name:p.name,qty:Number(qty.value),addons:[...chosen],note:note.value.trim()});save();d.close();notice(tr('تمت الإضافة للسلة','Added to cart'));
  },'primary');
  const refresh=()=>{add.textContent=tr('أضف للطلب','Add to order')+' · '+money((p.price+[...chosen].reduce((s,id)=>s+extra(id).price,0))*(Number(qty.value)||0))};
  qty.required=true;qty.oninput=refresh;refresh();
  d.append(options,label(tr('الكمية','Quantity'),qty),label(tr('ملاحظات للمطبخ','Kitchen notes'),note),add);d.showModal();
}
function openCart(){
  const d=$('cart');header(d,tr('طلبك','Your order'));if(!d.open)d.showModal();
  if(!cart.length){d.append(el('p',tr('السلة فارغة','Your cart is empty')));return}
  cart.forEach((l,i)=>{
    const row=el('div','','cartline');row.append(el('strong',l.qty+' × '+l.name));
    if(valid(l))row.append(el('p',[...l.addons.map(id=>extra(id)?.name),l.note,money(cost(l))].filter(Boolean).join(' · '),'muted'));
    else row.append(el('p',tr('تغيّر الصنف. احذفه واختره مجدداً','Item changed. Remove and select it again.'),'error'));
    row.append(btn(tr('إزالة','Remove'),()=>{cart.splice(i,1);save();openCart()}));d.append(row);
  });
  d.append(el('h3',tr('مجموع الأصناف','Items total')+' · '+money(sum()),'total'));
  const f=el('form'),name=field('text','',80),phone=field('tel','',25),place=field('text','',200),mode=el('select');
  for(const [v,t] of [['داخلي',tr('داخل المطعم','Dine in')],['خارجي',tr('طلب خارجي','External order')]]){const o=el('option',t);o.value=v;mode.append(o)}
  const where=label('',place),phoneLabel=label(tr('رقم التواصل','Phone number'),phone);
  function setMode(){const out=mode.value==='خارجي';where.replaceChildren(document.createTextNode(out?tr('عنوان التسليم أو نقطة الاستلام','Delivery or pickup location'):tr('رقم الطاولة','Table number')),place);phoneLabel.hidden=!out;phone.required=out}
  mode.onchange=setMode;setMode();name.required=place.required=true;
  const send=el('button',tr('تأكيد الطلب','Confirm order'),'primary');send.disabled=cart.some(l=>!valid(l));
  f.append(label(tr('الاسم','Name'),name),label(tr('نوع الطلب','Order type'),mode),where,phoneLabel,send);
  f.onsubmit=async ev=>{ev.preventDefault();send.disabled=true;
    const payload={name:name.value.trim(),mode:mode.value,place:place.value.trim(),phone:phone.value.trim(),lines:cart.map(({name,...line})=>line)};
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    const serialized=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    if(lastPayload!==serialized){requestKey=crypto.randomUUID();lastPayload=serialized;localStorage.setItem('station.orderKey',requestKey);localStorage.setItem('station.lastPayload',serialized)}
    try{const result=await api('orders',{...payload,key:requestKey});cart=[];save();localStorage.removeItem('station.lastPayload');localStorage.removeItem('station.orderKey');lastPayload='';header(d,tr('وصل طلبك','Order received'));d.append(el('p',tr('رقم الطلب ','Order number ')+result.id))}
    catch(e){report(d,e.message);send.disabled=false}
  };d.append(f);
}
function language(){
  document.documentElement.lang=en?'en':'ar';document.documentElement.dir=en?'ltr':'rtl';
  $('lang').textContent=en?'عربي':'EN';$('menuTitle').textContent=tr('قائمة الطعام','Menu');
  $('search').placeholder=tr('ابحث عن وجبتك…','Search menu…');$('basketTop').textContent=tr('السلة','Cart');$('browse').textContent=tr('تصفّح المينو ↓','Browse menu ↓');
}
$('lang').onclick=()=>{en=!en;localStorage.setItem('station.lang',en?'en':'ar');language();if(data)draw()};
$('search').oninput=()=>{if(data)draw()};$('basket').onclick=$('basketTop').onclick=()=>{if(data)openCart()};
language();
try{data=await api('menu');draw()}catch{ $('foods').textContent='تعذّر تحميل المينو. تأكدي من تشغيل الخادم ثم حدّثي الصفحة.'}
$('captain').onclick=()=>{
  const d=$('item');header(d,tr('استدعاء الكابتن','Call your server'));const f=el('form'),table=field('text','',20);table.required=true;
  const send=el('button',tr('إرسال الاستدعاء','Call server'),'primary');f.append(label(tr('رقم الطاولة','Table number'),table),send);
  f.onsubmit=async e=>{e.preventDefault();send.disabled=true;try{await api('captain',{table:table.value.trim()});d.close();notice(tr('تم إرسال الاستدعاء','Server notified'))}catch(err){report(f,err.message)}finally{send.disabled=false}};d.append(f);d.showModal();
};
