/* app.js - Daily Progress Tracker */
const STORE='tracker_v3', SKEY='tracker_streak_v3', UKEY='tracker_user_v1';
const REWARDS=['Outstanding work! You\'re on fire! 🔥','Excellent! Keep crushing it! 💪',
  'Great job! You\'re building momentum! 🚀','Well done! Every step counts! ⭐',
  'Nice work! Consistency is key! 🎯','Task done! Keep going! 👏','Great progress! 🌟'];
const LVLS={daily:'Daily Task',weekly:'Weekly Goal',monthly:'Monthly Goal',yearly:'Yearly Goal'};

let tasks=[], streak={count:0,lastDate:null}, user={name:'User'};
let currentUser=null; // set by auth.js after login
let realtimeChannel=null;
let view='dashboard', editId=null, filterTab='all', lvlFilter='all', sortBy='newest';
let clockInterval=null;

/* ── Storage ── */
const defaultPrefs = {compact:false, autoMiss:true, eod:"23:59", streakGoal:30, freeze:false, notifs:false};
const save=()=>{localStorage.setItem(STORE,JSON.stringify(tasks));localStorage.setItem(SKEY,JSON.stringify(streak))};
const load=()=>{
  tasks=JSON.parse(localStorage.getItem(STORE)||'[]');
  streak=JSON.parse(localStorage.getItem(SKEY)||'{"count":0,"lastDate":null}');
  user=JSON.parse(localStorage.getItem(UKEY)||'{"name":"User"}');
  if(!user.prefs) user.prefs = {...defaultPrefs};
};
const saveUser=()=>localStorage.setItem(UKEY,JSON.stringify(user));

/* ── Supabase Field Mapping ────────────────────────────────────────── */
const toDb=t=>({id:t.id,user_id:currentUser?.id||null,title:t.title,
  description:t.description,level:t.level,status:t.status,
  start_date:t.startDate||null,deadline:t.deadline||null,parent_id:t.parentId||null,
  stars:t.stars,reward_message:t.rewardMessage,missed_remark:t.missedRemark,
  completed_at:t.completedAt||null,created_at:t.createdAt||null});
const fromDb=r=>({id:r.id,title:r.title,description:r.description||'',
  level:r.level,status:r.status,startDate:r.start_date,deadline:r.deadline,
  parentId:r.parent_id,stars:r.stars||0,rewardMessage:r.reward_message||'',
  missedRemark:r.missed_remark||'',completedAt:r.completed_at,createdAt:r.created_at});

/* ── Supabase Background Sync (non-blocking) ───────────────────────── */
const sbSync=async t=>{
  if(!sb||!currentUser||!navigator.onLine)return;
  try{
    const res = await sb.from('tasks').upsert(toDb(t),{onConflict:'id'});
    if(res.error) {
      console.error('[Sync Error]', res.error.message, res.error.details);
      toast('Sync Error', res.error.message, 'error');
    }
  }catch(e){
    console.warn('[Sync EX]',e.message);
    toast('Sync Error', e.message, 'error');
  }
};
const sbDel=async id=>{
  if(!sb||!currentUser||!navigator.onLine)return;
  try{await sb.from('tasks').delete().eq('id',id).eq('user_id',currentUser.id);}catch(e){console.warn('[Del]',e.message);};
};
const sbSyncStreak=async()=>{
  if(!sb||!currentUser||!navigator.onLine)return;
  try{await sb.from('streaks').upsert({user_id:currentUser.id,count:streak.count,last_date:streak.lastDate},{onConflict:'user_id'});}catch(e){};
};

/* ── Load All Data from Supabase (or fall back to localStorage) ─────── */
const loadDataFromSupabase=async()=>{
  user=JSON.parse(localStorage.getItem(UKEY)||'{"name":"User"}');
  if(!user.prefs) user.prefs = {...defaultPrefs};
  if(!sb||!currentUser){
    tasks=JSON.parse(localStorage.getItem(STORE)||'[]');
    streak=JSON.parse(localStorage.getItem(SKEY)||'{"count":0,"lastDate":null}');
    return;
  }
  try{
    const{data:td,error:te}=await sb.from('tasks').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(!te){
      const srvTasks = td.map(fromDb);
      const locTasks = JSON.parse(localStorage.getItem(STORE)||'[]');
      // Find tasks uniquely local (failed to sync previously or offline)
      const unsynced = locTasks.filter(lt => !srvTasks.find(st => st.id === lt.id));
      tasks = [...unsynced, ...srvTasks];
      localStorage.setItem(STORE,JSON.stringify(tasks));
      // Retry syncing them quietly in the background
      unsynced.forEach(t => sbSync(t));
    } else {
      tasks=JSON.parse(localStorage.getItem(STORE)||'[]');
    }
  }catch(e){tasks=JSON.parse(localStorage.getItem(STORE)||'[]');}
  try{
    const{data:sd}=await sb.from('streaks').select('*').eq('user_id',currentUser.id).maybeSingle();
    streak=sd?{count:sd.count,lastDate:sd.last_date}:{count:0,lastDate:null};
    localStorage.setItem(SKEY,JSON.stringify(streak));
  }catch(e){streak=JSON.parse(localStorage.getItem(SKEY)||'{"count":0,"lastDate":null}');}
};

/* ── App Start (called by auth.js after data is ready) ─────────────── */
const appStart=()=>{
  updateOnlineStatus();
  autoMiss();
  navigate('dashboard');
};

/* ── Realtime Subscription ─────────────────────────────────────────── */
const subscribeRealtime=()=>{
  if(!sb||!currentUser)return;
  if(realtimeChannel)sb.removeChannel(realtimeChannel);
  realtimeChannel=sb.channel(`tasks:${currentUser.id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:`user_id=eq.${currentUser.id}`},
      ({eventType:ev,new:nr,old:or})=>{
        if(ev==='INSERT'&&!tasks.find(t=>t.id===nr.id)){tasks.unshift(fromDb(nr));save();render();}
        else if(ev==='UPDATE'){const i=tasks.findIndex(t=>t.id===nr.id);if(i>=0){tasks[i]=fromDb(nr);save();render();}}
        else if(ev==='DELETE'){const b=tasks.length;tasks=tasks.filter(t=>t.id!==or.id);if(tasks.length!==b){save();render();}}
      })
    .subscribe();
};

/* ── Online / Offline Indicator ────────────────────────────────────── */
const updateOnlineStatus=()=>{
  const el=document.getElementById('online-status');
  if(!el)return;
  el.textContent=navigator.onLine?'🟢 Online':'🔴 Offline';
  el.style.color=navigator.onLine?'var(--success)':'var(--danger)';
};
window.addEventListener('online',()=>{updateOnlineStatus();if(currentUser)loadDataFromSupabase().then(()=>render());});
window.addEventListener('offline',updateOnlineStatus);

/* ── ID & Helpers ── */
const uid=()=>{
  if(crypto&&crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);
  });
};
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isPast=d=>d&&new Date(d)<new Date();
const isSoon=d=>{if(!d)return false;const g=new Date(d)-new Date();return g>0&&g<86400000*3};
const today=()=>new Date().toDateString();
const fmtDate=s=>{
  if(!s)return'—';
  const d=new Date(s),n=new Date();
  d.setHours(0,0,0,0); n.setHours(0,0,0,0);
  const df=Math.round((d-n)/86400000);
  if(df===0)return'Today';if(df===1)return'Tomorrow';if(df===-1)return'Yesterday';
  if(df>1&&df<7)return`In ${df} days`;if(df<0&&df>-7)return`${Math.abs(df)}d ago`;
  return new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric'});
};
const fmtFull=s=>s?new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const progress=pid=>{const c=tasks.filter(t=>t.parentId===pid);if(!c.length)return null;
  const d=c.filter(t=>t.status==='completed').length;return{done:d,total:c.length,pct:Math.round(d/c.length*100)}};
const pcColor=p=>p>=80?'g':p>=40?'y':'r';
const stars=p=>p===100?5:p>=80?4:p>=60?3:p>=40?2:1;
const renderStars=(n,tot=5)=>'⭐'.repeat(n)+'☆'.repeat(tot-n);

/* ── Auto-Miss ── */
const autoMiss=()=>{
  let ch=false;
  tasks.forEach(t=>{if(t.status==='pending'&&isPast(t.deadline)){
    t.status='missed';t.missedRemark="You didn't follow up on this task. Stay consistent!";ch=true;}});
  if(ch)save();
};

/* ── Streak ── */
const updateStreak=()=>{
  const td=today(),yd=new Date(Date.now()-86400000).toDateString();
  const todayMissed=tasks.some(t=>t.level==='daily'&&t.status==='missed'&&
    t.deadline&&new Date(t.deadline).toDateString()===td);
  if(todayMissed&&streak.count>0){streak.count=0;streak.lastDate=null;save();sbSyncStreak();return;}
  const hasDone=tasks.some(t=>t.status==='completed'&&t.completedAt&&new Date(t.completedAt).toDateString()===td);
  if(!hasDone||streak.lastDate===td)return;
  streak.count=streak.lastDate===yd?streak.count+1:1;
  streak.lastDate=td;save();sbSyncStreak();
};

/* ── Toast ── */
const toast=(title,msg,type='success')=>{
  const icons={success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  const c=document.getElementById('toast-wrap');
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span class="ti">${icons[type]}</span><div><div class="ttitle">${esc(title)}</div>${msg?`<div class="tmsg">${esc(msg)}</div>`:''}</div>`;
  c.appendChild(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),280)},3500);
};

/* ── Navigate with pre-set filter ── */
const navToFilter=(v,f)=>{filterTab=f;navigate(v);};

/* ── Confetti ── */
const confetti=()=>{
  const cols=['#4F6AF5','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#fff'];
  for(let i=0;i<55;i++){
    const el=document.createElement('div');el.className='cf';
    el.style.cssText=`left:${Math.random()*100}%;background:${cols[Math.floor(Math.random()*cols.length)]};
      --dur:${2+Math.random()*2}s;--del:${Math.random()*.7}s;--dr:${(Math.random()-.5)*200}px;
      width:${5+Math.random()*8}px;height:${5+Math.random()*8}px;border-radius:${Math.random()>.5?'50%':'2px'}`;
    document.body.appendChild(el);
    const ms=(parseFloat(el.style.getPropertyValue('--dur'))+parseFloat(el.style.getPropertyValue('--del')))*1000+500;
    setTimeout(()=>el.remove(),ms);
  }
};

/* ── Reward Popup ── */
const showReward=task=>{
  const msg=REWARDS[Math.floor(Math.random()*REWARDS.length)];
  task.stars=task.stars||3;task.rewardMessage=msg;
  confetti();
  const el=document.createElement('div');el.className='reward-pop';
  el.innerHTML=`<span class="rw-emoji">🏆</span>
    <div class="rw-title">Task Completed!</div>
    <div class="rw-msg">${esc(msg)}</div>
    <span class="rw-stars">${renderStars(task.stars)}</span>
    <button class="btn btn-primary" onclick="this.closest('.reward-pop').remove()" style="margin-top:4px">Awesome! 🎉</button>`;
  document.body.appendChild(el);
  setTimeout(()=>{if(el.parentNode){el.style.animation='tout .3s ease forwards';setTimeout(()=>el.remove(),300);}},7000);
};

/* ── Timeliness-Based Star Rating ── */
const calcStars=t=>{
  let s=3;
  if(t.deadline&&t.completedAt){
    const dl=new Date(t.deadline),done=new Date(t.completedAt),diff=dl-done;
    if(diff>86400000*2)s=5;     // >2 days early → 5 stars
    else if(diff>0)s=4;          // completed before deadline → 4 stars
    else if(diff>-3600000)s=3;   // up to 1hr late → 3 stars
    else s=2;                     // more than 1hr late → 2 stars
  }
  if(streak.count>=7)s=Math.min(5,s+1); // +1 star for 7-day streak
  return s;
};

/* ── Sort Utility ── */
const sortTasks=list=>{
  if(sortBy==='deadline')return[...list].sort((a,b)=>{
    if(!a.deadline)return 1;if(!b.deadline)return -1;
    return new Date(a.deadline)-new Date(b.deadline);
  });
  if(sortBy==='oldest')return[...list].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  return[...list].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
};

/* ── CRUD ── */
const createTask=d=>{
  const t={id:uid(),title:d.title.trim(),description:d.description?.trim()||'',
    level:d.level,startDate:d.startDate,deadline:d.deadline,status:'pending',
    parentId:d.parentId||null,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:new Date().toISOString()};
  tasks.unshift(t);save();sbSync(t);return t;
};
const updateTask=(id,d)=>{const i=tasks.findIndex(t=>t.id===id);if(i<0)return;
  tasks[i]={...tasks[i],...d};save();sbSync(tasks[i]);return tasks[i]};
const deleteTask=id=>{
  tasks.filter(t=>t.parentId===id).forEach(c=>{tasks=tasks.filter(x=>x.id!==c.id);sbDel(c.id);});
  tasks=tasks.filter(t=>t.id!==id);save();sbDel(id);
};
const completeTask=id=>{
  const t=tasks.find(x=>x.id===id);if(!t||t.status==='completed')return;
  t.status='completed';t.completedAt=new Date().toISOString();
  t.stars=calcStars(t);
  updateStreak();save();sbSync(t);showReward(t);render();
};
const uncompleteTask=id=>{
  const t=tasks.find(x=>x.id===id);if(!t)return;
  t.status='pending';t.completedAt=null;t.stars=0;t.rewardMessage='';save();sbSync(t);render();
};
const deleteAndRender=id=>{
  const t=tasks.find(x=>x.id===id);if(!t)return;
  const ch=tasks.filter(x=>x.parentId===id).length;
  if(!confirm(`Delete "${t.title}"${ch?` and ${ch} sub-task(s)`:''}?`))return;
  deleteTask(id);toast('Deleted',`"${t.title}" removed`,'error');render();
};

/* ── Modal ── */
const openModal=(id=null)=>{
  editId=id;
  const m=document.getElementById('task-modal');
  document.getElementById('task-form').reset();
  const parents=tasks.filter(t=>t.level!=='daily'&&t.id!==id);
  document.getElementById('f-parent').innerHTML='<option value="">None (standalone)</option>'+
    parents.map(t=>`<option value="${t.id}">${esc(t.title)} (${LVLS[t.level]})</option>`).join('');
  if(id){
    const t=tasks.find(x=>x.id===id);if(!t)return;
    document.getElementById('modal-title-text').textContent='Edit Task';
    document.getElementById('f-title').value=t.title;
    document.getElementById('f-desc').value=t.description;
    document.getElementById('f-level').value=t.level;
    document.getElementById('f-start').value=t.startDate?t.startDate.slice(0,16):'';
    document.getElementById('f-deadline').value=t.deadline?t.deadline.slice(0,16):'';
    document.getElementById('f-parent').value=t.parentId||'';
  } else {
    document.getElementById('modal-title-text').textContent='New Task / Goal';
    const tzo=(new Date()).getTimezoneOffset()*60000;
    const localISO=(new Date(Date.now()-tzo)).toISOString().slice(0,16);
    document.getElementById('f-start').value=localISO;
  }
  m.classList.remove('hidden');
};
const closeModal=()=>{document.getElementById('task-modal').classList.add('hidden');editId=null};
const openModalWithParent=pid=>{
  openModal();
  setTimeout(()=>{document.getElementById('f-parent').value=pid;
    document.getElementById('f-level').value='daily';},50);
};
const handleSubmit=e=>{
  e.preventDefault();
  const title=document.getElementById('f-title').value.trim();
  if(!title){toast('Title required','Please enter a task title','warning');return;}
  const d={title,description:document.getElementById('f-desc').value,
    level:document.getElementById('f-level').value,
    startDate:document.getElementById('f-start').value,
    deadline:document.getElementById('f-deadline').value,
    parentId:document.getElementById('f-parent').value||null};
  if(editId){updateTask(editId,d);toast('Updated',`"${title}" saved`,'success');}
  else{createTask(d);toast('Task Added!',`"${title}" added to tracker`,'success');}
  closeModal();render();
};

/* ── Circular SVG Ring ── */
const ring=(pct,sz=88,clr='var(--primary)',lbl='')=>{
  const r=(sz-12)/2,circ=2*Math.PI*r,off=circ-(pct/100)*circ;
  return`<svg class="ring-svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
    <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="9"/>
    <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${clr}" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 ${sz/2} ${sz/2})"/>
    <text x="${sz/2}" y="${sz/2-(lbl?6:0)}" text-anchor="middle" dominant-baseline="middle"
      font-size="${sz*.18}px" font-weight="800" fill="var(--t1)" font-family="Outfit,sans-serif">${pct}%</text>
    ${lbl?`<text x="${sz/2}" y="${sz/2+sz*.15}" text-anchor="middle" font-size="${sz*.1}px" fill="var(--t3)" font-family="Inter,sans-serif">${lbl}</text>`:''}</svg>`;
};

/* ── Build Task Card HTML ── */
const taskCard=(t,mini=false)=>{
  const prog=progress(t.id);
  const dlClass=t.deadline&&isSoon(t.deadline)&&t.status!=='completed'?'soon':
    t.deadline&&isPast(t.deadline)&&t.status!=='completed'?'over':'';
  const chkClass=t.status==='completed'?'done':t.status==='missed'?'no-go':'';
  const chkAction=t.status==='pending'?`onclick="completeTask('${t.id}')"`
    :t.status==='completed'?`onclick="uncompleteTask('${t.id}')"`:'';
  const par=t.parentId?tasks.find(x=>x.id===t.parentId):null;
  return`<div class="task-card s-${t.status}">
    <div class="tc-check ${chkClass}" ${chkAction} title="${t.status==='pending'?'Mark complete':t.status==='completed'?'Unmark':'Missed'}"></div>
    <div class="tc-body">
      <div class="tc-title-row">
        <span class="tc-title">${esc(t.title)}</span>
        <span class="lvl-badge lv-${t.level}">${LVLS[t.level]}</span>
        ${par?`<span class="lvl-badge lv-daily" style="background:rgba(6,182,212,.1);color:var(--cyan)">↳ ${esc(par.title)}</span>`:''}
      </div>
      ${t.description&&!mini?`<div class="tc-desc">${esc(t.description)}</div>`:''}
      <div class="tc-meta">
        ${t.deadline?`<span class="tc-meta-item ${dlClass}">📅 ${t.status==='completed'?'Done: '+fmtDate(t.completedAt):'Due: '+fmtDate(t.deadline)}</span>`:''}
        ${t.startDate&&!mini?`<span class="tc-meta-item">🗓️ ${fmtDate(t.startDate)}</span>`:''}
        ${t.stars?`<span class="tc-stars">${renderStars(t.stars)}</span>`:''}
      </div>
      ${prog!==null?`<div class="tc-prog">
        <div class="prog-row"><span class="prog-lbl">Sub-tasks ${prog.done}/${prog.total}</span><span class="prog-pct">${prog.pct}%</span></div>
        <div class="prog-track"><div class="prog-fill pf-${pcColor(prog.pct)}" style="width:${prog.pct}%"></div></div>
      </div>`:''}
      ${t.missedRemark?`<div class="tc-remark remark-missed">⚠️ ${esc(t.missedRemark)}</div>`:''}
      ${t.rewardMessage&&!t.missedRemark?`<div class="tc-remark remark-done">🏆 ${esc(t.rewardMessage)}</div>`:''}
    </div>
    <div class="tc-actions">
      <button class="ic-btn" onclick="openModal('${t.id}')" title="Edit">✏️</button>
      <button class="ic-btn del" onclick="deleteAndRender('${t.id}')" title="Delete">🗑️</button>
    </div>
  </div>`;
};

const empty=(icon,text,sub)=>`<div class="empty"><div class="empty-icon">${icon}</div>
  <div class="empty-text">${text}</div><div class="empty-sub">${sub}</div></div>`;

/* ═══════════════ VIEW RENDERERS ════════════════════════════════ */

/* ── Dashboard ── */
const renderDashboard=()=>{
  const td=today();
  const todayTasks=tasks.filter(t=>{
    if(t.level!=='daily')return false;
    return(t.deadline&&new Date(t.deadline).toDateString()===td)||(t.startDate&&new Date(t.startDate).toDateString()===td);
  });
  const comp=tasks.filter(t=>t.status==='completed');
  const pend=tasks.filter(t=>t.status==='pending');
  const miss=tasks.filter(t=>t.status==='missed');
  document.getElementById('s-comp').textContent=comp.length;
  document.getElementById('s-pend').textContent=pend.length;
  document.getElementById('s-miss').textContent=miss.length;
  document.getElementById('s-streak').textContent=streak.count;
  document.getElementById('sb-streak').textContent=streak.count;
  document.getElementById('nb-tasks').textContent=pend.filter(t=>t.level==='daily').length||'';
  document.getElementById('nb-goals').textContent=tasks.filter(t=>t.level!=='daily').length||'';
  // ── Smart Insights ──
  const tdTasks=tasks.filter(t=>{
    if(t.level!=='daily')return false;
    return(t.deadline&&new Date(t.deadline).toDateString()===td)||(t.startDate&&new Date(t.startDate).toDateString()===td);
  });
  const tdDone=tdTasks.filter(t=>t.status==='completed').length;
  const tdPct=tdTasks.length?Math.round(tdDone/tdTasks.length*100):0;
  const wkStart=new Date(Date.now()-7*86400000);
  const wkMissed=tasks.filter(t=>t.status==='missed'&&t.deadline&&new Date(t.deadline)>wkStart).length;
  const dSoon=tasks.filter(t=>t.status==='pending'&&isSoon(t.deadline)).length;
  const ib=document.getElementById('insights-banner');
  if(ib){
    const chips=[
      tdTasks.length?`<div class="ins-chip ${tdPct===100?'c-green':tdPct>=60?'c-yellow':'c-blue'}">📊 Completed ${tdDone}/${tdTasks.length} of today's tasks (${tdPct}%)${tdPct===100?' — All done! 🎉':''}</div>`:'',
      wkMissed?`<div class="ins-chip c-red">⚠️ You missed ${wkMissed} task${wkMissed>1?'s':''} this week</div>`:'',
      dSoon?`<div class="ins-chip c-yellow">⏰ ${dSoon} task${dSoon>1?'s':''} due soon — stay on track!</div>`:'',
      streak.count>=3?`<div class="ins-chip c-green">🔥 ${streak.count}-day streak — Keep it going!</div>`:''
    ].filter(Boolean);
    ib.innerHTML=chips.length?chips.join(''):'<div class="ins-chip c-blue">👋 Welcome! Add tasks and start tracking your progress.</div>';
  }
  // Today's tasks
  document.getElementById('today-list').innerHTML=todayTasks.length
    ?todayTasks.map(t=>taskCard(t)).join(''):empty('📋','No tasks for today','Click "+ New Task" to add one!');
  // Completed
  document.getElementById('comp-list').innerHTML=comp.slice(0,3).length
    ?comp.slice(0,3).map(t=>taskCard(t,true)).join(''):empty('✅','Nothing completed yet','Complete a task to see it here!');
  // Missed
  document.getElementById('miss-list').innerHTML=miss.slice(0,3).length
    ?miss.slice(0,3).map(t=>taskCard(t,true)).join(''):empty('🎯','No missed tasks!','You\'re staying on track!');
  // Upcoming
  const up=tasks.filter(t=>{if(!t.deadline||t.status!=='pending')return false;
    const g=new Date(t.deadline)-new Date();return g>0&&g<86400000*7;})
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline)).slice(0,5);
  document.getElementById('upcoming').innerHTML=up.length?up.map(t=>{
    const d=new Date(t.deadline);
    return`<div class="up-item">
      <div class="up-date"><div class="up-day">${d.getDate()}</div><div class="up-mon">${d.toLocaleDateString('en-US',{month:'short'})}</div></div>
      <div class="up-info"><div class="up-title">${esc(t.title)}</div><div class="up-meta">${LVLS[t.level]} · ${fmtDate(t.deadline)}</div></div>
      <span class="lvl-badge lv-${t.level}">${t.level}</span></div>`;
  }).join(''):`<div class="empty" style="padding:16px"><div class="empty-text" style="font-size:13px">No upcoming deadlines 🎉</div></div>`;
  // Streak
  document.getElementById('streak-block').innerHTML=`<div class="streak-card">
    <div class="streak-fire">🔥</div>
    <div><div class="streak-num">${streak.count}</div>
    <div class="streak-lbl">Day Streak</div>
    <div class="streak-sub">${streak.count>0?'Keep it up!':'Complete a task to start!'}</div></div></div>`;
};

/* ── Daily Tasks ── */
const renderDaily=()=>{
  let list=tasks.filter(t=>t.level==='daily');
  if(filterTab==='pending')list=list.filter(t=>t.status==='pending');
  else if(filterTab==='completed')list=list.filter(t=>t.status==='completed');
  else if(filterTab==='missed')list=list.filter(t=>t.status==='missed');
  list=sortTasks(list);
  document.querySelectorAll('#view-daily .ftab').forEach(b=>b.classList.toggle('active',b.dataset.f===filterTab));
  const sortEl=document.getElementById('sort-select');
  if(sortEl)sortEl.value=sortBy;
  document.getElementById('daily-list').innerHTML=list.length?list.map(t=>taskCard(t)).join(''):
    empty('📋','No tasks here','Change the filter or add a new daily task!');
};

/* ── Goals ── */
const renderGoals=()=>{
  let goalLvl=lvlFilter==='all'?['weekly','monthly','yearly']:[lvlFilter];
  const goals=tasks.filter(t=>goalLvl.includes(t.level));
  document.querySelectorAll('#view-goals .ftab').forEach(b=>b.classList.toggle('active',b.dataset.g===lvlFilter));
  if(!goals.length){document.getElementById('goals-grid').innerHTML=empty('🎯','No goals yet','Create a Weekly, Monthly, or Yearly goal to get started!');return;}
  document.getElementById('goals-grid').innerHTML=goals.map(g=>{
    const prog=progress(g.id);
    const subs=tasks.filter(t=>t.parentId===g.id);
    const clr={'weekly':'var(--cyan)','monthly':'var(--purple)','yearly':'var(--warning)'}[g.level]||'var(--primary)';
    const pct=prog?prog.pct:0;
    const st=prog?stars(pct):0;
    const banner=prog&&pct===100?`<div class="gc-banner ok">🎉 Goal achieved! Amazing work!</div>`
      :g.deadline&&isPast(g.deadline)&&pct<100?`<div class="gc-banner warn">⚠️ Goal not achieved. Improve consistency.</div>`:'';
    return`<div class="goal-card">
      <div class="gc-head">
        <div><div class="gc-title">${esc(g.title)}</div>${g.description?`<div class="gc-desc">${esc(g.description)}</div>`:''}</div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px">
          <span class="lvl-badge lv-${g.level}">${LVLS[g.level]}</span>
          <div style="display:flex;gap:5px">
            <button class="ic-btn" onclick="openModal('${g.id}')" title="Edit">✏️</button>
            <button class="ic-btn del" onclick="deleteAndRender('${g.id}')" title="Delete">🗑️</button>
          </div>
        </div>
      </div>
      ${g.deadline?`<div class="gc-deadline">📅 Deadline: ${fmtFull(g.deadline)}</div>`:''}
      <div class="gc-progress">
        <div class="gc-ring">${ring(pct,90,clr)}</div>
        <div class="gc-prog-info">
          <div class="gc-pct-big">${pct}%</div>
          <div class="gc-prog-sub">${prog?`${prog.done} of ${prog.total} done`:'No sub-tasks yet'}</div>
          ${st?`<div class="gc-stars">${renderStars(st)}</div>`:''}
        </div>
      </div>
      ${banner}
      ${subs.length?`<div class="gc-subtasks">${subs.map(s=>`<div class="gc-st-row">
        <div class="st-dot ${s.status}"></div>
        <span class="st-name ${s.status==='completed'?'done':''}">${esc(s.title)}</span>
        <span class="st-date">${s.deadline?fmtDate(s.deadline):''}</span>
        <div class="st-chk ${s.status==='completed'?'done':s.status==='missed'?'miss':''}"
          ${s.status==='pending'?`onclick="completeTask('${s.id}')"`
            :s.status==='completed'?`onclick="uncompleteTask('${s.id}')"`:''}
          title="${s.status==='pending'?'Mark done':s.status==='completed'?'Unmark':'Missed'}">
          ${s.status==='completed'?'✓':s.status==='missed'?'✕':''}</div>
      </div>`).join('')}</div>`:''}
      <button class="gc-add-sub" onclick="openModalWithParent('${g.id}')">+ Add Sub-task</button>
    </div>`;
  }).join('');
};

/* ── Progress Overview ── */
const renderProgress=()=>{
  const lvls=['weekly','monthly','yearly'];
  const clrs={weekly:'var(--cyan)',monthly:'var(--purple)',yearly:'var(--warning)'};
  const ems={weekly:'📆',monthly:'🗓️',yearly:'📅'};
  // Big rings
  document.getElementById('po-rings').innerHTML=lvls.map(lv=>{
    const goals=tasks.filter(t=>t.level===lv);
    const allPcts=goals.map(g=>{const p=progress(g.id);return p?p.pct:0});
    const avg=allPcts.length?Math.round(allPcts.reduce((a,b)=>a+b,0)/allPcts.length):0;
    return`<div class="po-card">
      <div class="po-ring-wrap">${ring(avg,112,clrs[lv],lv)}</div>
      <div class="po-title">${ems[lv]} ${lv.charAt(0).toUpperCase()+lv.slice(1)} Goals</div>
      <div class="po-sub">${goals.length} goal${goals.length!==1?'s':''} · avg ${avg}%</div>
    </div>`;
  }).join('');
  // Insights
  const total=tasks.length,comp=tasks.filter(t=>t.status==='completed').length;
  const miss=tasks.filter(t=>t.status==='missed').length;
  const rate=total?Math.round(comp/total*100):0;
  document.getElementById('insights').innerHTML=`
    <div class="insight-row"><span class="ins-label">Total Tasks</span><span class="ins-val">${total}</span></div>
    <div class="insight-row"><span class="ins-label">Completed</span><span class="ins-val text-success">${comp}</span></div>
    <div class="insight-row"><span class="ins-label">Missed</span><span class="ins-val text-danger">${miss}</span></div>
    <div class="insight-row"><span class="ins-label">Completion Rate</span><span class="ins-val text-primary">${rate}%</span></div>
    <div class="insight-row"><span class="ins-label">Best Streak</span><span class="ins-val">🔥 ${streak.count} days</span></div>`;
  // 7-day heatmap
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today7=new Date();
  const hm=Array.from({length:7},(_,i)=>{
    const d=new Date(today7);d.setDate(d.getDate()-(6-i));const ds=d.toDateString();
    const day=tasks.filter(t=>t.deadline&&new Date(t.deadline).toDateString()===ds);
    const done=day.filter(t=>t.status==='completed').length;
    const hasMissed=day.some(t=>t.status==='missed');
    const cls=day.length===0?'':done===day.length&&day.length>0?'all-done':hasMissed?'some-missed':'has-tasks';
    return{day:days[(d.getDay()+6)%7],num:d.getDate(),cls,count:done};
  });
  document.getElementById('heatmap').innerHTML=
    `<div class="week-labels">${hm.map(h=>`<div class="week-lbl">${h.day}</div>`).join('')}</div>`+
    `<div class="heatmap">${hm.map(h=>`<div class="hm-cell ${h.cls}" title="${h.day} ${h.num}: ${h.count} done">${h.num}</div>`).join('')}</div>`;
};

/* ── Settings ── */
const renderSettings=()=>{
  document.getElementById('s-name').value=user.name||'';
  
  // Toggles
  const thmTog=document.getElementById('tog-dark');
  if(thmTog)thmTog.classList.toggle('on',document.documentElement.getAttribute('data-theme')==='dark');
  const compTog=document.getElementById('tog-compact');
  if(compTog)compTog.classList.toggle('on',user.prefs?.compact);
  const amTog=document.getElementById('tog-automiss');
  if(amTog)amTog.classList.toggle('on',!!user.prefs?.autoMiss);
  const frTog=document.getElementById('tog-freeze');
  if(frTog)frTog.classList.toggle('on',user.prefs?.freeze);
  const ntTog=document.getElementById('tog-notifs');
  if(ntTog)ntTog.classList.toggle('on',user.prefs?.notifs);

  // Inputs
  const selEod=document.getElementById('sel-eod');
  if(selEod)selEod.value=user.prefs?.eod||'23:59';
  const inpStreak=document.getElementById('inp-streak-goal');
  if(inpStreak)inpStreak.value=user.prefs?.streakGoal||30;
  
  // Security
  const secEm=document.getElementById('sec-email');
  if(secEm)secEm.textContent=currentUser?currentUser.email:'Not authenticated';
};

const saveSettings=()=>{
  user.name=document.getElementById('s-name').value.trim()||'User';
  saveUser();updateGreeting();toast('Saved','Profile updated successfully','success');
};

const togglePref=(key)=>{
  user.prefs[key]=!user.prefs[key];
  saveUser();
  if(key==='compact') document.querySelector('.app').classList.toggle('compact-ui',user.prefs.compact);
  renderSettings();
};

const updatePref=(key,val)=>{
  user.prefs[key]=val;
  saveUser();
};

const exportData=()=>{
  const data = JSON.stringify({tasks, streak, user}, null, 2);
  const blob = new Blob([data], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `progress_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported','Data backup downloaded','success');
};

const clearAllData=()=>{
  if(!confirm('Clear ALL local tasks and reset data? This cannot be undone.'))return;
  tasks=[];save();streak={count:0,lastDate:null};
  localStorage.setItem(SKEY,JSON.stringify(streak));
  toast('Cleared','Local data has been reset','warning');render();
};

/* ═══ CLOCK & GREETING ══════════════════════════════════════════ */
const updateClock=()=>{
  const n=new Date();
  const t=n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const d=n.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const el=document.getElementById('time-disp');
  const dl=document.getElementById('date-disp');
  if(el)el.textContent=t;if(dl)dl.textContent=d;
};
const updateGreeting=()=>{
  const h=new Date().getHours();
  const g=h<12?'Good Morning ☀️':h<17?'Good Afternoon 🌤️':h<21?'Good Evening 🌆':'Good Night 🌙';
  const el=document.getElementById('greeting');
  const nm=document.getElementById('user-name-disp');
  const sb=document.getElementById('sb-name');
  if(el)el.textContent=`${g}, ${user.name}!`;
  if(nm)nm.textContent=user.name;
  if(sb)sb.textContent=user.name;
  const ppn=document.getElementById('pp-name-disp');
  if(ppn)ppn.textContent=user.name;
  
  const subs=['Stay consistent today 💪','Every task brings you closer 🎯','Progress over perfection ✨','You\'ve got this! 🚀'];
  const sub=document.getElementById('greeting-sub');
  if(sub)sub.textContent=subs[new Date().getDay()%subs.length];
};
const initClock=()=>{updateClock();clockInterval=setInterval(updateClock,30000)};

/* ═══ NAVIGATION ════════════════════════════════════════════════ */
const navigate=v=>{
  view=v;filterTab='all';lvlFilter='all';
  document.querySelectorAll('.nav-item,.mn-item').forEach(el=>el.classList.toggle('active',el.dataset.view===v));
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${v}`));
  render();
};

/* ═══ MAIN RENDER ════════════════════════════════════════════════ */
const render=()=>{
  autoMiss();updateStreak();updateGreeting();
  if(view==='dashboard')renderDashboard();
  else if(view==='daily')renderDaily();
  else if(view==='goals')renderGoals();
  else if(view==='progress')renderProgress();
  else if(view==='settings')renderSettings();
};

/* ═══ DARK MODE ══════════════════════════════════════════════════ */
const initTheme=()=>document.documentElement.setAttribute('data-theme',localStorage.getItem('tracker_theme')||'light');
const toggleTheme=()=>{
  const t=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',t);localStorage.setItem('tracker_theme',t);
  renderSettings();
};

/* ═══ SEED DATA ══════════════════════════════════════════════════ */
const seed=()=>{
  if(tasks.length)return;
  const n=new Date(),tm=t=>new Date(n.getTime()+t*86400000).toISOString();
  const mg=uid(),wg=uid(),yg=uid();
  tasks=[
    {id:mg,title:'Learn HTML & CSS',description:'Complete a full HTML/CSS course with practice projects.',level:'monthly',startDate:n.toISOString(),deadline:tm(30),status:'pending',parentId:null,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
    {id:wg,title:'Study JavaScript Basics',description:'Cover variables, functions, loops and DOM manipulation.',level:'weekly',startDate:n.toISOString(),deadline:tm(7),status:'pending',parentId:mg,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
    {id:yg,title:'Become a Full-Stack Developer',description:'Learn HTML, CSS, JS, React, Node.js and build 3 projects.',level:'yearly',startDate:n.toISOString(),deadline:tm(365),status:'pending',parentId:null,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
    {id:uid(),title:'Learn HTML Tags & Structure',description:'Study headings, paragraphs, lists, and links.',level:'daily',startDate:n.toISOString(),deadline:n.toISOString(),status:'completed',parentId:mg,stars:4,rewardMessage:'Great job! Keep it up!',missedRemark:'',completedAt:n.toISOString(),createdAt:n.toISOString()},
    {id:uid(),title:'Practice HTML Forms',description:'Build input forms, dropdowns, and buttons.',level:'daily',startDate:n.toISOString(),deadline:tm(1),status:'pending',parentId:mg,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
    {id:uid(),title:'CSS Selectors & Box Model',description:'Master selectors, padding, margin, borders.',level:'daily',startDate:tm(1),deadline:tm(2),status:'pending',parentId:mg,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
    {id:uid(),title:'CSS Flexbox Layout',description:'Create a responsive nav bar with flexbox.',level:'daily',startDate:tm(-1),deadline:tm(-1),status:'missed',parentId:mg,stars:0,rewardMessage:'',missedRemark:"You didn't follow up on this task. Stay consistent!",completedAt:null,createdAt:tm(-1)},
    {id:uid(),title:'Morning Exercise Routine',description:'30 min workout to start the day strong.',level:'daily',startDate:n.toISOString(),deadline:n.toISOString(),status:'pending',parentId:null,stars:0,rewardMessage:'',missedRemark:'',completedAt:null,createdAt:n.toISOString()},
  ];
  save();
};

/* ═══ EVENT LISTENERS ════════════════════════════════════════════ */
const initEvents=()=>{
  document.querySelectorAll('.nav-item,.mn-item').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.view)));
  document.getElementById('btn-new').addEventListener('click',()=>openModal());
  document.getElementById('task-form').addEventListener('submit',handleSubmit);
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-close-btn').addEventListener('click',closeModal);
  document.getElementById('task-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal()});
  document.getElementById('dark-toggle').addEventListener('click',toggleTheme);
  // Daily view filters
  document.querySelectorAll('#view-daily .ftab').forEach(b=>b.addEventListener('click',()=>{filterTab=b.dataset.f;renderDaily()}));
  // Goals level filter
  document.querySelectorAll('#view-goals .ftab').forEach(b=>b.addEventListener('click',()=>{lvlFilter=b.dataset.g;renderGoals()}));
  
  // Settings Interactions
  document.getElementById('save-settings')?.addEventListener('click',saveSettings);
  document.getElementById('clear-data')?.addEventListener('click',clearAllData);
  document.getElementById('btn-export')?.addEventListener('click',exportData);
  document.getElementById('tog-dark')?.addEventListener('click',toggleTheme);
  document.getElementById('tog-compact')?.addEventListener('click',()=>togglePref('compact'));
  document.getElementById('tog-automiss')?.addEventListener('click',()=>togglePref('autoMiss'));
  document.getElementById('tog-freeze')?.addEventListener('click',()=>togglePref('freeze'));
  document.getElementById('tog-notifs')?.addEventListener('click',()=>togglePref('notifs'));
  document.getElementById('sel-eod')?.addEventListener('change',(e)=>updatePref('eod',e.target.value));
  document.getElementById('inp-streak-goal')?.addEventListener('change',(e)=>updatePref('streakGoal',parseInt(e.target.value)||30));
  
  // Settings Sidebar Navigation
  document.querySelectorAll('.set-nav-item').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.set-nav-item').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.set-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pan-'+btn.dataset.setpan).classList.add('active');
    });
  });

  // Sort control
  document.getElementById('sort-select')?.addEventListener('change',e=>{sortBy=e.target.value;renderDaily()});
  // Auto re-check on focus
  window.addEventListener('focus',()=>{autoMiss();render()});
  // Mobile sidebar toggle
  const sb = document.querySelector('.sidebar');
  document.getElementById('menu-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    sb.classList.toggle('active');
  });
  document.getElementById('sb-close')?.addEventListener('click', () => {
    sb.classList.remove('active');
  });
  // Close sidebar on navigate (mobile)
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 1100) sb.classList.remove('active');
    });
  });
  // Close sidebar when clicking outside
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 1100 && sb.classList.contains('active') && !sb.contains(e.target)) {
      sb.classList.remove('active');
    }
  });
};

/* ═══ INIT ═══════════════════════════════════════════════════════ */
const init=()=>{
  initTheme();initClock();initEvents();
  // Apply initial prefs
  if(user.prefs?.compact) document.querySelector('.app').classList.add('compact-ui');
  // Expose functions used in dynamic onclick HTML + auth.js to window
  Object.assign(window,{
    openModal,completeTask,uncompleteTask,deleteAndRender,
    openModalWithParent,navigate,toggleTheme,navToFilter,
    renderDaily,renderGoals,
    appStart,load,seed,loadDataFromSupabase,subscribeRealtime,
  });
  // Periodic auto-miss check every 60 seconds
  setInterval(()=>{autoMiss();if(view==='dashboard')renderDashboard();},60000);
  // NOTE: data loading + navigation handled by auth.js via appStart()
};
document.addEventListener('DOMContentLoaded',init);
