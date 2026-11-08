import {$,el,btn,money,header,label,field,api,notice,report} from './common.js';
let menu,orders=[],calls=[],view='products';
const states=['جديد','قيد التحضير','مكتمل','ملغى'];
function signedIn(on){$('board').hidden=!on;$('login').hidden=on;$('logout').hidden=!on}
function choose(v){view=v;$('catalog').hidden=v!=='products';$('queue').hidden=v!=='orders';
  for(const k of ['products','orders'])$(k).classList.toggle('active',k===v);
}
function select(items,value){
  const s=el('select');
  for(const [id,text] of items){const o=el('option',text);o.value=id;s.append(o)}s.value=value;return s;
}
async function load(){
  try{[menu,orders,calls]=await Promise.all([api('manage'),api('orders'),api('captain')]);drawCalls();signedIn(true);draw();drawOrders();choose(view)}
  catch(e){if(e.status===401)signedIn(false);else notice(e.message)}
}
function draw(){
  $('stats').replaceChildren();
  for(const [num,title] of [[menu.products.filter(p=>p.available).length,'أصناف متاحة'],[orders.filter(o=>o.state==='جديد').length,'جديد ضمن آخر ١٥٠ طلب'],[menu.products.filter(p=>p.category_id===4).length,'مشروبات']]){
    const s=el('div','','stat');s.append(el('strong',num),el('small',title));$('stats').append(s)
  }
  $('rows').replaceChildren();
  for(const p of menu.products){
    const cat=menu.categories.main.find(c=>c.id===p.category_id)?.name||'';
    if(!(p.name+' '+cat).includes($('find').value.trim()))continue;
    const r=el('article','','row'),info=el('div');info.append(el('strong',p.name),el('p',cat+' · '+money(p.price)+' · '+(p.available?'متوفر':'مخفي'),'muted'));
    r.append(info,btn('تعديل',()=>edit(p)));$('rows').append(r);
  }
  if(!$('rows').children.length)$('rows').append(el('p','ما في أصناف مطابقة.'));
}
async function encode(file){
  if(file.size>2000000)throw new Error('الحد الأقصى للصورة ٢ ميغابايت');
  return await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=()=>no(new Error('تعذّرت قراءة الصورة'));r.readAsDataURL(file)});
}
function edit(p={id:0,version:0,name:'',desc:'',price:0,category_id:1,quick_id:1,available:true,addons:[]}){
  const d=$('editor');header(d,p.id?'تعديل الصنف':'صنف جديد');const form=el('form');
  const name=field('text',p.name,100),desc=el('textarea'),price=field('number',p.price);
  name.required=price.required=true;desc.value=p.desc;desc.maxLength=500;price.min=0;price.max=10000000;price.step=1;
  const cats=k=>menu.categories[k].map(c=>[c.id,c.name]);
  const category=select(cats('main'),p.category_id),quick=select(cats('quick'),p.quick_id);
  const image=field('file');image.accept='image/jpeg,image/png,image/webp';
  const avail=field('checkbox');avail.checked=p.available;
  const opts=el('div','','options'),checks=[];
  for(const a of menu.addons){const box=field('checkbox');box.checked=p.addons.includes(a.id);checks.push([a.id,box]);opts.append(label(a.name+' · '+money(a.price),box))}
  const save=el('button','حفظ الصنف','primary');
  form.append(label('اسم الصنف',name),label('الوصف',desc),label('السعر بالليرة السورية',price),label('القسم',category),label('التصنيف السريع',quick),label('صورة جديدة (حتى ٢ ميغابايت)',image),el('strong','الإضافات المتاحة'),opts,label(' متوفر للطلب',avail),save);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;
    try{await api('items',{id:p.id,version:p.version,name:name.value.trim(),desc:desc.value.trim(),price:Number(price.value),category_id:Number(category.value),quick_id:Number(quick.value),available:avail.checked,addons:checks.filter(([,b])=>b.checked).map(([id])=>id),photo:image.files[0]?await encode(image.files[0]):null});d.close();await load();notice('تم حفظ الصنف')}
    catch(err){report(d,err.message)}finally{save.disabled=false}
  };d.append(form);d.showModal();
}
function drawOrders(){
  $('queue').replaceChildren();
  if(orders.length){
    const completed=orders.filter(o=>o.state==='مكتمل');
    const amount=completed.reduce((sum,o)=>sum+o.total,0);
    const top=new Map();
    for(const order of orders.filter(o=>o.state!=='ملغى')){
      for(const line of order.lines)top.set(line.name,(top.get(line.name)||0)+line.qty);
    }
    const summary=el('section','','panel');
    summary.append(el('h3','ملخص آخر '+orders.length+' طلب'),el('p','قيمة الطلبات المكتملة · '+money(amount)));
    const best=[...top].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,n])=>name+' ('+n+')').join('، ');
    if(best)summary.append(el('p','الأكثر طلباً · '+best,'muted'));
    $('queue').append(summary);
  }
  if(!orders.length)$('queue').append(el('p','ما في طلبات بعد.'));
  for(const o of orders){
    const row=el('article','','order');row.append(el('h3','#'+o.id+' · '+o.name),el('p',new Date(o.created*1000).toLocaleString('ar-SY')+' · '+[o.mode,o.place,o.phone].filter(Boolean).join(' · '),'muted'));
    for(const l of o.lines)row.append(el('p',[l.qty+' × '+l.name,...l.extras,l.note,money(l.total)].filter(Boolean).join(' · ')));
    const state=select(states.map(s=>[s,s]),o.state);
    state.onchange=async()=>{state.disabled=true;try{await api('orders/'+o.id,{state:state.value,previous:o.state});await load()}catch(e){notice(e.message);await load()}};
    row.append(el('strong',money(o.total)),label('حالة الطلب',state));$('queue').append(row);
  }
}
$('login').onsubmit=async e=>{e.preventDefault();try{await api('login',{password:$('password').value});$('password').value='';await load()}catch(err){report($('login'),err.message)}};
$('logout').onclick=async()=>{try{await api('logout',{});signedIn(false);$('queue').replaceChildren();orders=[]}catch(e){notice(e.message)}};
$('products').onclick=()=>choose('products');$('orders').onclick=async()=>{view='orders';await load()};$('refresh').onclick=load;$('add').onclick=()=>edit();$('find').oninput=draw;await load();
function drawCalls(){
  $('calls').replaceChildren();
  for(const call of calls){
    const row=el('div','','row');row.append(el('strong','استدعاء الكابتن · طاولة '+call.place),btn('تمت الاستجابة',async()=>{try{await api('captain/'+call.id,{});await load()}catch(e){notice(e.message)}}));$('calls').append(row);
  }
}
$('extras').onclick=()=>{
  const d=$('editor');header(d,'إدارة الإضافات');const list=el('div');
  for(const a of [...menu.addons,{id:0,name:'',price:0}]){
    const f=el('form','','panel'),n=field('text',a.name,80),price=field('number',a.price),save=el('button',a.id?'حفظ':'إضافة','primary');
    n.required=price.required=true;price.min=0;price.max=10000000;f.append(label(a.id?'الاسم':'إضافة جديدة',n),label('السعر (ل.س)',price),save);list.append(f);
    f.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('extras',{id:a.id,name:n.value.trim(),price:Number(price.value),previous_name:a.name,previous_price:a.price});await load();d.close();notice('تم حفظ الإضافة')}catch(err){report(f,err.message)}finally{save.disabled=false}};
  }
  d.append(list);d.showModal();
};
setInterval(()=>{if(!$('board').hidden&&!document.hidden&&!$('editor').open&&!$('find').matches(':focus')&&!$('queue').contains(document.activeElement))load()},30000);
