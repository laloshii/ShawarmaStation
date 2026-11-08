export const $=id=>document.getElementById(id);
export function el(tag,text='',cls=''){
  const node=document.createElement(tag);
  if(text!=='')node.textContent=text;
  if(cls)node.className=cls;
  return node;
}
export function btn(text,action,cls=''){
  const b=el('button',text,cls);b.type='button';b.onclick=action;return b;
}
export const money=n=>new Intl.NumberFormat('ar-SY').format(n)+' ل.س';
export function header(d,title){
  d.replaceChildren();const row=el('div','','dialoghead');
  row.append(el('h2',title),btn('×',()=>d.close()));d.append(row);
}
export function label(text,control){const l=el('label',text);l.append(control);return l}
export function field(type,value='',max=200){
  const n=el('input');n.type=type;n.value=value;n.maxLength=max;return n;
}
export async function api(path,body){
  const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok){const e=new Error(typeof data.detail==='string'?data.detail:'تحققي من الحقول المدخلة');e.status=r.status;throw e}
  return data;
}
let timer;
export function notice(msg){
  const n=$('notice');n.hidden=false;n.textContent=msg;clearTimeout(timer);timer=setTimeout(()=>n.hidden=true,6500);
}
export function report(d,msg){
  let n=d.querySelector('[role=alert]');if(!n){n=el('p','','error');n.setAttribute('role','alert');d.append(n)}n.textContent=msg;n.scrollIntoView({block:'nearest'});
}
const theme=document.querySelector('[data-theme]');
document.documentElement.classList.toggle('dark',localStorage.getItem('station.theme')==='dark');
theme.onclick=()=>localStorage.setItem('station.theme',document.documentElement.classList.toggle('dark')?'dark':'light');
