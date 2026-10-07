const MONTHS=["Հունվար","Փետրվար","Մարտ","Ապրիլ","Մայիս","Հունիս","Հուլիս","Օգոստոս","Սեպտեմբեր","Հոկտեմբեր","Նոյեմբեր","Դեկտեմբեր"];
const MSHORT=["հնվ","փտր","մրտ","ապր","մյս","հնս","հլս","օգս","սեպ","հոկ","նոյ","դեկ"];
const LKEY="promtest-events-v1";
const $=id=>document.getElementById(id);
let events=[], filter="upcoming", editingId=null, mode="loading", col=null, subs=null, downloads=null;
/* Permissions (shared mode): editors/owner write "events" and may delete anything;
   everyone else with the link (Contributor) adds into their own "subs/<id>" doc and can edit only those; nobody but editors sees Delete. */
let mainEvents=[], subDocs={}, me=null, canEdit=false, canWrite=true, userCap=null, names={};

/* ---------- data layer: shared db inside claude.ai, localStorage elsewhere ---------- */
function loadLocal(){try{return JSON.parse(localStorage.getItem(LKEY)||"[]")}catch(e){return []}}
function saveLocal(){try{localStorage.setItem(LKEY,JSON.stringify(events))}catch(e){}}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function clean(ev){const b={};for(const k in ev)if(k!=="id"&&k[0]!=="_")b[k]=ev[k];return b}
function mayEdit(ev){return mode!=="db"||canEdit||(ev&&ev._src==="sub"&&ev._owner===me)}
function merge(){
  events=[...mainEvents,...Object.entries(subDocs).flatMap(([u,d])=>Object.entries((d&&d.entries)||{}).map(([id,e])=>({...e,id,_src:"sub",_owner:u})))];
  render(); resolveNames();
}
async function writeSub(owner,id,body){
  const cur={...((subDocs[owner]&&subDocs[owner].entries)||{})};
  if(body===null)delete cur[id]; else cur[id]=body;
  await subs.doc(owner).set({entries:cur});
}
async function saveEvent(ev){
  const id=ev.id||uid(); const body=clean(ev);
  if(mode!=="db"){const i=events.findIndex(e=>e.id===id); if(i>=0)events[i]={id,...body}; else events.push({id,...body}); saveLocal(); render(); return}
  const ex=events.find(e=>e.id===id);
  if(ex){ if(ex.addedBy)body.addedBy=ex.addedBy; if(ex.addedAt)body.addedAt=ex.addedAt;
    if(ex._src==="sub")return writeSub(ex._owner,id,body);
    return col.doc(id).set(body); }
  if(me){body.addedBy=me;} body.addedAt=new Date().toISOString();
  if(canEdit)return col.doc(id).set(body);
  if(!me)throw {code:"invalid_argument"};
  return writeSub(me,id,body);
}
async function removeEvent(id){
  if(mode!=="db"){events=events.filter(e=>e.id!==id); saveLocal(); render(); return}
  const ex=events.find(e=>e.id===id); if(!ex)return;
  if(ex._src==="sub")return writeSub(ex._owner,id,null);
  return col.doc(id).delete();
}
async function resolveNames(){
  if(!userCap)return;
  const ids=[...new Set(events.map(e=>e.addedBy).filter(x=>x&&!(x in names)))]; if(!ids.length)return;
  try{const ps=await userCap.profiles(ids); let changed=false;
    ids.forEach(i=>{names[i]=(ps[i]&&ps[i].name)||""; if(names[i])changed=true}); if(changed)render();}catch(e){}
}
function applyPerms(){
  const db=mode==="db";
  $("addBtn").hidden=db&&(!canWrite||(!canEdit&&!me));
  $("importBtn").hidden=db&&!canEdit;
  $("mode").textContent=!db?"Տվյալները պահվում են այս բրաուզերում":
    canEdit?"Ընդհանուր տվյալներ · դուք ունեք լիարժեք իրավունք":
    (canWrite&&me)?"Կարող եք ավելացնել միջոցառում և խմբագրել ձեր ավելացրածը":"Միայն դիտում";
}
function useLocal(){mode="local"; events=loadLocal(); if(!events.length&&window.SEED_EVENTS){events=window.SEED_EVENTS.map(e=>({...e})); saveLocal();} applyPerms(); render();}
async function init(){
  render();
  if(!window.claude||!window.claude.use){useLocal();return}
  const db=await window.claude.use("db");
  if(!db){useLocal();return}
  userCap=await window.claude.use("user");
  if(userCap){ canEdit=await userCap.canEdit(); me=await userCap.id(); const w=await userCap.can("data.write"); canWrite=w!==false; }
  mode="db"; col=db.collection("events"); subs=db.collection("subs");
  applyPerms();
  const onErr=e=>{toast("Տվյալները չհաջողվեց բեռնել ("+e.code+")։ Թարմացրեք էջը։")};
  col.onSnapshot(s=>{mainEvents=s.docs.map(d=>({id:d.id,...d.data(),_src:"main"})); merge();},onErr);
  subs.onSnapshot(s=>{subDocs={}; s.docs.forEach(d=>{subDocs[d.id]=d.data()}); merge();},onErr);
  window.claude.use("downloads").then(d=>{downloads=d});
}

/* ---------- helpers ---------- */
const TODAY=new Date(); TODAY.setHours(0,0,0,0);
function d(iso){if(!iso)return null; const [y,m,dd]=iso.split("-").map(Number); return new Date(y,m-1,dd)}
function status(ev){const s=d(ev.start), e=d(ev.end)||s; if(!s)return"up"; if(e<TODAY)return"past"; if(s<=TODAY)return"now"; return"up"}
function daysTo(ev){return Math.round((d(ev.start)-TODAY)/864e5)}
function fmt(iso){const x=d(iso); return x?String(x.getDate()).padStart(2,"0")+"."+String(x.getMonth()+1).padStart(2,"0")+"."+x.getFullYear():""}
function fmtRange(ev){if(!ev.end||ev.end===ev.start)return fmt(ev.start); const a=d(ev.start),b=d(ev.end); return a.getMonth()===b.getMonth()?a.getDate()+"–"+fmt(ev.end):fmt(ev.start)+"–"+fmt(ev.end)}
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function toast(msg){const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,3200)}
function plural(n){return n+" օր"}

/* ---------- render ---------- */
function render(){
  const up=events.filter(e=>status(e)!=="past").sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  const next=up[0];
  const noMat=up.filter(e=>!e.materials).length;
  $("summary").innerHTML=`
    <div class="stat"><b>${events.length}</b><span>Ընդհանուր</span></div>
    <div class="stat"><b>${up.length}</b><span>Առաջիկա</span></div>
    <div class="stat"><b>${noMat}</b><span>Առանց տպագրական նյութի</span></div>
    <div class="stat next"><b>${next?esc(next.name):"—"}</b><span>${next?(status(next)==="now"?"Ընթանում է հիմա":"Հաջորդը՝ "+plural(daysTo(next))+" հետո · "+fmtRange(next)):"Առաջիկա միջոցառում չկա"}</span></div>`;

  const people=[...new Set(events.map(e=>e.responsible).filter(Boolean))].sort();
  const sel=$("person"), cur=sel.value;
  sel.innerHTML='<option value="">Բոլոր պատասխանատուները</option>'+people.map(p=>`<option${p===cur?" selected":""}>${esc(p)}</option>`).join("");
  fillLists();

  const q=$("q").value.trim().toLowerCase(), person=sel.value;
  let rows=events.filter(e=>{
    const st=status(e);
    if(filter==="upcoming"&&st==="past")return false;
    if(filter==="past"&&st!=="past")return false;
    if(person&&e.responsible!==person)return false;
    if(q&&![e.name,e.location,e.audience,e.org,e.format,e.materials,e.notes].join(" ").toLowerCase().includes(q))return false;
    return true;});
  rows.sort((a,b)=>(a.start||"").localeCompare(b.start||"")*(filter==="past"?-1:1));

  const list=$("list");
  if(mode==="loading"){list.innerHTML='<div class="empty">Բեռնվում է…</div>';return}
  if(!events.length){list.innerHTML=`<div class="empty"><strong>Միջոցառումներ դեռ չկան</strong>
    Ավելացրեք առաջինը կամ ներմուծեք Google Sheets-ից՝ File → Download → CSV։
    <div class="actions">${$("addBtn").hidden?"":'<button type="button" class="primary" onclick="openForm()">+ Նոր միջոցառում</button>'}${$("importBtn").hidden?"":'<button type="button" onclick="$(\'fileIn\').click()">Ներմուծել CSV</button>'}</div></div>`;return}
  if(!rows.length){list.innerHTML='<div class="empty"><strong>Համընկնումներ չկան</strong>Փոխեք որոնումը կամ ֆիլտրը։</div>';return}

  const groups={};
  rows.forEach(e=>{const k=(e.start||"0000-00").slice(0,7); (groups[k]=groups[k]||[]).push(e)});
  list.innerHTML=Object.entries(groups).map(([k,evs])=>{
    const [y,m]=k.split("-").map(Number);
    return `<section class="month"><h2>${m?MONTHS[m-1]+" "+y:"Առանց ամսաթվի"} <small>${evs.length} միջոցառում</small></h2>
    ${evs.map(card).join("")}</section>`}).join("");
}
function card(e){
  const st=status(e), s=d(e.start);
  const day=s?(e.end&&e.end!==e.start&&d(e.end).getMonth()===s.getMonth()?s.getDate()+"–"+d(e.end).getDate():s.getDate()):"?";
  const label=st==="past"?"Անցած":st==="now"?"Հիմա":(daysTo(e)===0?"Այսօր":plural(daysTo(e))+" հետո");
  const chips=[e.format,e.org].filter(Boolean).map(x=>`<span class="chip">${esc(x)}</span>`).join("")+
    (e.materials?`<span class="chip">🖨 ${esc(e.materials)}</span>`:(st!=="past"?'<span class="chip warn">Տպագրական նյութ նշված չէ</span>':""))+
    (e.addedBy&&names[e.addedBy]?`<span class="chip">Ավելացրել է՝ ${esc(names[e.addedBy])}</span>`:"");
  return `<button type="button" class="ev ${st==="past"?"past":""}" data-id="${esc(e.id)}">
    <div class="date"><b>${day}</b><span>${s?MSHORT[s.getMonth()]:""}${e.time?"<br>"+esc(e.time):""}</span></div>
    <div class="body"><div class="title">${esc(e.name)}</div>
      <div class="meta">${e.location?`<span>📍 ${esc(e.location)}</span>`:""}${e.responsible?`<span>👤 ${esc(e.responsible)}</span>`:""}</div>
      ${e.audience?`<div class="meta">${esc(e.audience)}</div>`:""}
      <div class="chips">${chips}</div></div>
    <span class="state ${st}">${label}</span></button>`;
}
function fillLists(){
  const map={dl_org:"org",dl_format:"format",dl_location:"location",dl_resp:"responsible",dl_mat:"materials"};
  for(const [id,f] of Object.entries(map)){$(id).innerHTML=[...new Set(events.map(e=>e[f]).filter(Boolean))].map(v=>`<option value="${esc(v)}">`).join("")}
}

/* ---------- form ---------- */
const F={name:"f_name",start:"f_start",end:"f_end",time:"f_time",regDate:"f_reg",org:"f_org",format:"f_format",location:"f_location",responsible:"f_resp",audience:"f_aud",materials:"f_mat",notes:"f_notes"};
function openForm(id){
  editingId=id||null; const ev=events.find(e=>e.id===id)||{org:"Prom-Test",format:"Հովանավոր",regDate:new Date().toISOString().slice(0,10)};
  for(const [k,el] of Object.entries(F))$(el).value=ev[k]||"";
  const ro=!!id&&!mayEdit(ev);
  for(const el of Object.values(F))$(el).disabled=ro;
  $("saveBtn").hidden=ro; $("cancelBtn").textContent=ro?"Փակել":"Չեղարկել";
  $("formTitle").textContent=!id?"Նոր միջոցառում":ro?"Միջոցառում":"Խմբագրել";
  $("delBtn").hidden=!id||(mode==="db"&&!canEdit); $("confirmBox").hidden=true; $("overlay").hidden=false; $("f_name").focus();
}
function closeForm(){$("overlay").hidden=true; editingId=null}
$("form").addEventListener("submit",async ev=>{
  ev.preventDefault();
  const o={}; for(const [k,el] of Object.entries(F))o[k]=$(el).value.trim();
  if(!o.name||!o.start){toast("Լրացրեք անվանումը և սկզբի ամսաթիվը։");return}
  if(o.end&&o.end<o.start){toast("Ավարտը չի կարող լինել սկզբից շուտ։");return}
  if(editingId)o.id=editingId;
  if(editingId&&!mayEdit(events.find(e=>e.id===editingId))){toast("Կարող եք խմբագրել միայն ձեր ավելացրածը");return}
  try{await saveEvent(o); closeForm(); toast("Պահպանված է")}catch(e){toast("Չհաջողվեց պահպանել"+(e.code==="invalid_argument"?"․ դուք խմբագրելու իրավունք չունեք":""))}
});
$("delBtn").onclick=()=>$("confirmBox").hidden=false;
$("noDel").onclick=()=>$("confirmBox").hidden=true;
$("yesDel").onclick=async()=>{if(mode==="db"&&!canEdit)return;try{await removeEvent(editingId); closeForm(); toast("Ջնջված է")}catch(e){toast("Չհաջողվեց ջնջել")}};
$("closeBtn").onclick=$("cancelBtn").onclick=closeForm;
$("overlay").addEventListener("click",e=>{if(e.target.id==="overlay")closeForm()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("overlay").hidden)closeForm()});
$("addBtn").onclick=()=>openForm();
$("list").addEventListener("click",e=>{const b=e.target.closest(".ev"); if(b)openForm(b.dataset.id)});
$("q").addEventListener("input",render); $("person").addEventListener("change",render);
document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{filter=b.dataset.f;document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed",x===b));render()});

/* ---------- CSV import / export (Google Sheets column order) ---------- */
const COLS=["Գրանցման ամսաթիվ","Միջոցառման ամսաթիվ","Ժամ","Կազմակերպություն","Ներկայացման ձևաչափ","Միջոցառման անվանում","Վայր","Պատասխանատու","Թիրախային լսարան","Տպագրական նյութեր"];
function parseCSV(t){const rows=[];let r=[],c="",q=false;for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch=='"'&&t[i+1]=='"'){c+='"';i++}else if(ch=='"')q=false;else c+=ch}
  else if(ch=='"')q=true;else if(ch==","){r.push(c);c=""}else if(ch=="\n"||ch=="\r"){if(ch=="\r"&&t[i+1]=="\n")i++;r.push(c);rows.push(r);r=[];c=""}else c+=ch}
  if(c||r.length){r.push(c);rows.push(r)}return rows}
function parseDate(s){const m=String(s||"").trim().match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\.(\d{1,2})\.(\d{4})$/);
  if(!m)return null; const p=n=>String(n).padStart(2,"0"); return {start:`${m[4]}-${p(m[3])}-${p(m[1])}`,end:m[2]?`${m[4]}-${p(m[3])}-${p(m[2])}`:""}}
$("importBtn").onclick=()=>$("fileIn").click();
$("fileIn").onchange=async e=>{
  const f=e.target.files[0]; if(!f)return; const rows=parseCSV(await f.text()); let n=0,skip=0;
  for(let r of rows){
    if(!parseDate(r[1])&&parseDate(r[2]))r=r.slice(1); // leading empty column
    const ev=parseDate(r[1]); if(!ev||!(r[5]||"").trim()){continue}
    const name=r[5].trim();
    if(events.some(x=>x.name===name&&x.start===ev.start)){skip++;continue}
    const reg=parseDate(r[0]);
    try{await saveEvent({name,start:ev.start,end:ev.end,regDate:reg?reg.start:"",time:(r[2]||"").trim(),org:(r[3]||"").trim(),format:(r[4]||"").trim(),location:(r[6]||"").trim(),responsible:(r[7]||"").trim(),audience:(r[8]||"").trim(),materials:(r[9]||"").trim(),notes:""});n++}
    catch(err){toast("Ներմուծումը կանգնեց․ "+(err.code||"սխալ"));break}
  }
  e.target.value=""; toast(`Ներմուծվեց ${n} միջոցառում`+(skip?`, ${skip} կրկնօրինակ բաց թողնվեց`:""));
};
$("exportBtn").onclick=async()=>{
  const q=v=>/[",\n]/.test(v)?'"'+String(v).replace(/"/g,'""')+'"':v;
  const lines=[COLS.join(",")].concat([...events].sort((a,b)=>(a.start||"").localeCompare(b.start||"")).map(e=>
    [fmt(e.regDate),fmtRange(e),e.time,e.org,e.format,e.name,e.location,e.responsible,e.audience,e.materials].map(v=>q(v||"")).join(",")));
  const data="﻿"+lines.join("\n"), filename="promtest-events.csv";
  if(downloads){try{await downloads.save({filename,data});}catch(err){toast("Ներբեռնումը չեղարկվեց")}return}
  if(mode==="local"){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:"text/csv"}));a.download=filename;a.click();return}
  toast("Ներբեռնումը այս դիտման մեջ հասանելի չէ");
};
init();
