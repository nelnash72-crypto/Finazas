(function(){
"use strict";

/* ================= IndexedDB ================= */
const DB_NAME = "libroFinanzasDB_v2";
const DB_VERSION = 5;
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('accounts')) d.createObjectStore('accounts', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('categories')) d.createObjectStore('categories', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('transactions')){
        const s = d.createObjectStore('transactions', {keyPath:'id', autoIncrement:true});
        s.createIndex('date','date');
      }
      if(!d.objectStoreNames.contains('transfers')){
        const s = d.createObjectStore('transfers', {keyPath:'id', autoIncrement:true});
        s.createIndex('date','date');
      }
      if(!d.objectStoreNames.contains('budgets')) d.createObjectStore('budgets', {keyPath:'categoryId'});
      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', {keyPath:'key'});
      if(!d.objectStoreNames.contains('goals')) d.createObjectStore('goals', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('recurring')) d.createObjectStore('recurring', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('reminders')) d.createObjectStore('reminders', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('debts')) d.createObjectStore('debts', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('installments')) d.createObjectStore('installments', {keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('shortcuts')) d.createObjectStore('shortcuts', {keyPath:'id', autoIncrement:true});
      // Guarda referencias a archivos locales (ej. handle de sincronización con OneDrive).
      // Es local a este dispositivo/navegador a propósito: NUNCA se incluye en ALL_STORES,
      // para que no viaje dentro de los exports/imports JSON portables.
      if(!d.objectStoreNames.contains('fileHandles')) d.createObjectStore('fileHandles', {keyPath:'key'});
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e.target.error);
  });
}
function tx(store, mode){ return db.transaction(store, mode).objectStore(store); }
function p(req){ return new Promise((res, rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
const idb = {
  getAll: (s)=> p(tx(s,'readonly').getAll()),
  put: (s,v)=> p(tx(s,'readwrite').put(v)),
  delete: (s,k)=> p(tx(s,'readwrite').delete(k)),
  clear: (s)=> p(tx(s,'readwrite').clear()),
};

/* ================= Constants ================= */
const CURRENCY_META = {
  EUR:{symbol:'€', name:'Euro'}, USD:{symbol:'$', name:'Dólar EE.UU.'}, GBP:{symbol:'£', name:'Libra'},
  MXN:{symbol:'$', name:'Peso mexicano'}, COP:{symbol:'$', name:'Peso colombiano'}, ARS:{symbol:'$', name:'Peso argentino'},
  JPY:{symbol:'¥', name:'Yen'}, CHF:{symbol:'CHF', name:'Franco suizo'}, CAD:{symbol:'$', name:'Dólar canadiense'}
};
const MASTER_EUR_RATE = { EUR:1, USD:0.92, GBP:1.17, MXN:0.051, COP:0.00021, ARS:0.00082, JPY:0.0059, CHF:1.06, CAD:0.66 };
const CURRENCIES = Object.keys(CURRENCY_META);
const PALETTE = ['#3D7D72','#B9702C','#A5842E','#7C6FA8','#4C7EA8','#AE4B42','#5B8C5A','#8A6FA0','#B8763E','#6E7079'];

const ACCENT_PALETTE = [
  {name:'Dorado', accent:'#A5842E', soft:'#F1EAD4'},
  {name:'Salvia', accent:'#5B8C5A', soft:'#E3EEE2'},
  {name:'Azul pizarra', accent:'#4C7EA8', soft:'#E1EBF3'},
  {name:'Ciruela', accent:'#7C5C7C', soft:'#EFE5EF'},
];
function applyAccent(hex){
  const entry = ACCENT_PALETTE.find(a=>a.accent===hex) || ACCENT_PALETTE[0];
  document.documentElement.style.setProperty('--gold', entry.accent);
  document.documentElement.style.setProperty('--gold-soft', entry.soft);
}
function applyTextScale(scale){
  document.documentElement.style.zoom = (scale/100);
}

const DEFAULT_CATEGORIES = [
  {name:'Vivienda', kind:'expense', subcategories:['Alquiler','Mantenimiento','Servicios'], icon:'🏠'},
  {name:'Comida', kind:'expense', subcategories:['Supermercado','Restaurantes'], icon:'🍽️'},
  {name:'Transporte', kind:'expense', subcategories:[], icon:'🚗'},
  {name:'Ocio', kind:'expense', subcategories:[], icon:'🎬'},
  {name:'Salud', kind:'expense', subcategories:[], icon:'💊'},
  {name:'Viajes', kind:'expense', subcategories:[], icon:'✈️'},
  {name:'Suscripciones', kind:'expense', subcategories:[], icon:'🔁'},
  {name:'Compras', kind:'expense', subcategories:[], icon:'🛍️'},
  {name:'Otros', kind:'expense', subcategories:[], icon:'🏷️'},
  {name:'Salario', kind:'income', subcategories:[], icon:'💼'},
  {name:'Freelance', kind:'income', subcategories:[], icon:'💻'},
  {name:'Inversiones', kind:'income', subcategories:[], icon:'📈'},
  {name:'Regalos', kind:'income', subcategories:[], icon:'🎁'},
  {name:'Otros', kind:'income', subcategories:[], icon:'🏷️'},
];

const ICON_GROUPS = [
  {label:'Hogar', icons:['🏠','🏢','🏡','🔑','🛋️','🛏️','🚿','🧹','🧺','🔧','💡','🔥','🪴','🧯','🚪','🪟']},
  {label:'Comida y bebida', icons:['🍽️','🍔','🍕','🌮','🍎','🥗','☕','🍺','🍷','🛒','🥐','🍜','🍣','🧁','🍫','🥤']},
  {label:'Transporte', icons:['🚗','🚕','🚌','🚆','🚇','⛽','🅿️','🚲','✈️','🧳','🚢','🛵','🚦','🛣️','🚘']},
  {label:'Ocio y entretenimiento', icons:['🎬','🎮','🎵','🎨','📚','🎉','🎁','🎓','🐾','🌳','🎯','🎳','🎤','🎭','📷','🎸']},
  {label:'Deporte y salud', icons:['💊','🏥','🦷','🧴','😷','🏋️','⚽','🏃','🧘','🚴','🏊','🩺']},
  {label:'Compras y moda', icons:['👕','👗','👟','💍','👜','🕶️','💄','🧢','👶']},
  {label:'Finanzas', icons:['💼','💻','📈','📉','💰','🏦','💳','🧾','⚖️','📱','🔁','📦','🛡️']},
  {label:'Otros', icons:['🧸','🏷️','📌','🗂️','🎗️','❓','✨']},
];
function catIcon(cat){ return (cat && cat.icon) || '🏷️'; }

/* ================= State ================= */
let state = {
  accounts:[], categories:[], transactions:[], transfers:[], budgets:{},
  baseCurrency:'EUR', rateOverrides:{},
  showHiddenAccts:false,
  txType:'expense',
  qkType:'expense',
  txDebtMode:'payment',
  qkDebtMode:'payment',
  recDebtMode:'payment',
  goals:[], recurring:[], reminders:[], debts:[], installments:[], shortcuts:[],
  lastBackupDate:null, backupReminderShown:false, editingTxId:null, editingTransferId:null, accentColor:'#A5842E', darkMode:false, textScale:100, iconPickerTarget:null, generalBudget:0,
  resumenPeriod:{mode:'month', ref:todayISO()},
  movPeriod:{mode:'month', ref:todayISO()},
};

function todayISO(){ return localISO(new Date()); }
function pad2(n){ return String(n).padStart(2,'0'); }
function localISO(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }

function toast(msg, actionLabel, actionFn, duration){
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const actionEl = document.getElementById('toast-action');
  msgEl.textContent = msg;
  if(actionLabel && actionFn){
    actionEl.textContent = actionLabel;
    actionEl.style.display = 'inline-block';
    actionEl.onclick = ()=>{ actionFn(); el.classList.remove('show'); clearTimeout(toast._t); };
  } else {
    actionEl.style.display = 'none';
    actionEl.onclick = null;
  }
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove('show'), duration || 2200);
}

/* ================= Deshacer al borrar ================= */
let pendingDelete = null;
function scheduleDelete(message, commitFn, restoreFn){
  if(pendingDelete){
    clearTimeout(pendingDelete.timeoutId);
    pendingDelete.commitFn();
  }
  const timeoutId = setTimeout(async ()=>{
    pendingDelete = null;
    await commitFn();
  }, 5000);
  pendingDelete = {timeoutId, commitFn};
  toast(message, 'Deshacer', async ()=>{
    clearTimeout(timeoutId);
    pendingDelete = null;
    await restoreFn();
  }, 5000);
}

/* ================= Currency helpers ================= */
function effectiveRate(cur){
  if(cur === state.baseCurrency) return 1;
  if(state.rateOverrides[cur] != null) return state.rateOverrides[cur];
  const inEur = MASTER_EUR_RATE[cur] ?? 1;
  const baseInEur = MASTER_EUR_RATE[state.baseCurrency] ?? 1;
  return inEur / baseInEur;
}
function toBase(amount, cur){ return amount * effectiveRate(cur); }
function fmtMoney(amount, cur){
  cur = cur || state.baseCurrency;
  const meta = CURRENCY_META[cur] || {symbol:cur};
  const digits = cur === 'JPY' ? 0 : 2;
  const sign = amount < 0 ? '-' : '';
  return sign + meta.symbol + Math.abs(amount).toLocaleString('es-ES', {minimumFractionDigits:digits, maximumFractionDigits:digits});
}
function fmtDate(iso){
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString('es-ES', {day:'2-digit', month:'short'});
}
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

/* ================= Data load ================= */
async function loadAll(){
  const [accounts, categories, transactions, transfers, budgets, settings, goals, recurring, reminders, debts, installments, shortcuts] = await Promise.all([
    idb.getAll('accounts'), idb.getAll('categories'), idb.getAll('transactions'),
    idb.getAll('transfers'), idb.getAll('budgets'), idb.getAll('settings'),
    idb.getAll('goals'), idb.getAll('recurring'), idb.getAll('reminders'), idb.getAll('debts'), idb.getAll('installments'), idb.getAll('shortcuts')
  ]);
  state.accounts = accounts;
  state.categories = categories;
  state.transactions = transactions.sort((a,b)=> b.date.localeCompare(a.date) || b.id-a.id);
  state.transfers = transfers.sort((a,b)=> b.date.localeCompare(a.date) || b.id-a.id);
  state.budgets = {}; budgets.forEach(b=> state.budgets[b.categoryId] = b.limit);
  const baseSetting = settings.find(s=>s.key==='baseCurrency');
  if(baseSetting) state.baseCurrency = baseSetting.value;
  const rateSetting = settings.find(s=>s.key==='rateOverrides');
  if(rateSetting) state.rateOverrides = rateSetting.value || {};
  const backupSetting = settings.find(s=>s.key==='lastBackupDate');
  state.lastBackupDate = backupSetting ? backupSetting.value : null;
  const generalBudgetSetting = settings.find(s=>s.key==='generalBudget');
  state.generalBudget = generalBudgetSetting ? generalBudgetSetting.value : 0;
  const accentSetting = settings.find(s=>s.key==='accentColor');
  state.accentColor = accentSetting ? accentSetting.value : ACCENT_PALETTE[0].accent;
  const darkSetting = settings.find(s=>s.key==='darkMode');
  state.darkMode = darkSetting ? darkSetting.value : false;
  const scaleSetting = settings.find(s=>s.key==='textScale');
  state.textScale = scaleSetting ? scaleSetting.value : 100;
  state.goals = goals;
  state.recurring = recurring;
  state.reminders = reminders.sort((a,b)=> (a.done===b.done?0:(a.done?1:-1)) || (a.dueDate||'').localeCompare(b.dueDate||''));
  state.debts = debts;
  state.installments = installments;
  state.shortcuts = shortcuts;
}

async function seedIfEmpty(){
  const accounts = await idb.getAll('accounts');
  const categories = await idb.getAll('categories');
  if(categories.length === 0){
    for(const c of DEFAULT_CATEGORIES) await idb.put('categories', c);
  }
  if(accounts.length === 0){
    await idb.put('accounts', {name:'Efectivo', type:'efectivo', currency:'EUR', country:'', visible:true});
  }
}

async function ensureAdjustmentCategories(){
  const categories = await idb.getAll('categories');
  if(!categories.some(c=>c.kind==='expense' && c.name==='Ajuste')){
    await idb.put('categories', {name:'Ajuste', kind:'expense', subcategories:[], icon:'⚖️'});
  }
  if(!categories.some(c=>c.kind==='income' && c.name==='Ajuste')){
    await idb.put('categories', {name:'Ajuste', kind:'income', subcategories:[], icon:'⚖️'});
  }
}

async function ensureCategoryIcons(){
  const categories = await idb.getAll('categories');
  for(const c of categories){
    if(!c.icon){
      const match = DEFAULT_CATEGORIES.find(d=>d.name===c.name && d.kind===c.kind);
      c.icon = match ? match.icon : '🏷️';
      await idb.put('categories', c);
    }
  }
}

function findCategoryByName(name, kind){ return state.categories.find(c=>c.kind===kind && c.name===name); }

async function applyDebtPayment(debtId, amount){
  if(!debtId) return;
  const debts = await idb.getAll('debts');
  const debt = debts.find(d=>d.id===debtId);
  if(!debt) return;
  const newAmount = Math.max(0, (debt.amount||0) - amount);
  await idb.put('debts', {...debt, amount:newAmount, settled: newAmount<=0.005});
}
async function revertDebtPayment(debtId, amount){
  if(!debtId) return;
  const debts = await idb.getAll('debts');
  const debt = debts.find(d=>d.id===debtId);
  if(!debt) return;
  const newAmount = (debt.amount||0) + amount;
  await idb.put('debts', {...debt, amount:newAmount, settled:false});
}
async function applyDebtIncrease(debtId, amount){
  if(!debtId) return;
  const debts = await idb.getAll('debts');
  const debt = debts.find(d=>d.id===debtId);
  if(!debt) return;
  const newAmount = (debt.amount||0) + amount;
  await idb.put('debts', {...debt, amount:newAmount, settled:false});
}
async function revertDebtIncrease(debtId, amount){
  if(!debtId) return;
  const debts = await idb.getAll('debts');
  const debt = debts.find(d=>d.id===debtId);
  if(!debt) return;
  const newAmount = Math.max(0, (debt.amount||0) - amount);
  await idb.put('debts', {...debt, amount:newAmount, settled: newAmount<=0.005});
}
async function applyDebtEffect(debtId, effect, amount){
  if(effect==='loan') await applyDebtIncrease(debtId, amount);
  else await applyDebtPayment(debtId, amount);
}
async function revertDebtEffect(debtId, effect, amount){
  if(effect==='loan') await revertDebtIncrease(debtId, amount);
  else await revertDebtPayment(debtId, amount);
}
async function findOrCreateDebtFor(person, direction){
  const name = person.trim();
  if(!name) return null;
  const debts = await idb.getAll('debts');
  const existing = debts.find(d=> d.direction===direction && !d.settled && d.person.trim().toLowerCase()===name.toLowerCase());
  if(existing) return existing.id;
  return await idb.put('debts', {person:name, amount:0, direction, note:'', settled:false});
}
function loanDirectionForKind(kind){
  return kind==='income' ? 'debo' : 'me_deben';
}
function debtsForLoanKind(kind){
  return state.debts.filter(d=>d.direction===loanDirectionForKind(kind) && !d.settled);
}
function debtsForKind(kind){
  const direction = kind==='income' ? 'me_deben' : 'debo';
  return state.debts.filter(d=>d.direction===direction);
}
function populateDebtSelect(selectEl, kind, mode){
  if(!selectEl) return;
  if(mode==='loan'){
    const debts = debtsForLoanKind(kind);
    selectEl.innerHTML = '<option value="">Ninguna</option>' + debts.map(d=>`<option value="${d.id}">${escapeHtml(d.person)} — ${fmtMoney(d.amount)}${d.note?' ('+escapeHtml(d.note)+')':''}</option>`).join('') + '<option value="__new__">+ Nueva persona…</option>';
    return;
  }
  const debts = debtsForKind(kind);
  selectEl.innerHTML = '<option value="">Ninguna</option>' + debts.map(d=>`<option value="${d.id}">${escapeHtml(d.person)} — ${fmtMoney(d.amount)}${d.note?' ('+escapeHtml(d.note)+')':''}</option>`).join('');
}

function getCategory(id){ return state.categories.find(c=>c.id===id); }
function sortedCategories(kind){
  return state.categories.filter(c=>c.kind===kind).sort((a,b)=> (a.order??a.id) - (b.order??b.id));
}
async function moveCategory(id, dir){
  const cat = getCategory(id);
  if(!cat) return;
  const sorted = sortedCategories(cat.kind);
  const idx = sorted.findIndex(c=>c.id===id);
  const swapIdx = idx + dir;
  if(swapIdx<0 || swapIdx>=sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const aOrder = a.order ?? a.id, bOrder = b.order ?? b.id;
  await idb.put('categories', {...a, order:bOrder});
  await idb.put('categories', {...b, order:aOrder});
  await loadAll(); renderAll();
}
function getAccount(id){ return state.accounts.find(a=>a.id===id); }

function buildEqualSchedule(totalAmount, count){
  if(count<=0) return [];
  const base = Math.floor((totalAmount/count)*100)/100;
  const schedule = new Array(count).fill(base);
  const remainder = Math.round((totalAmount - base*count)*100)/100;
  schedule[schedule.length-1] = Math.round((schedule[schedule.length-1]+remainder)*100)/100;
  return schedule;
}
function installmentAmountFor(it, index){
  if(Array.isArray(it.schedule) && it.schedule[index]!=null) return it.schedule[index];
  return it.amount || 0;
}
function installmentTotals(it){
  const sched = Array.isArray(it.schedule) ? it.schedule : [];
  let paid = 0, total = 0;
  for(let i=0; i<it.totalInstallments; i++){
    const amt = sched[i]!=null ? sched[i] : (it.amount||0);
    total += amt;
    if(i < it.paidInstallments) paid += amt;
  }
  return {paid, total, remaining: Math.max(0, total-paid)};
}
function normalizeSchedule(schedule, totalInstallments, fallbackAmount){
  const sched = Array.isArray(schedule) ? schedule.slice(0, totalInstallments) : [];
  while(sched.length < totalInstallments){
    sched.push(sched.length>0 ? sched[sched.length-1] : (fallbackAmount||0));
  }
  return sched;
}

function nextRecurringDate(dateStr, freq){
  const d = new Date(dateStr + "T00:00:00");
  if(freq==='weekly') d.setDate(d.getDate()+7);
  else if(freq==='yearly') d.setFullYear(d.getFullYear()+1);
  else d.setMonth(d.getMonth()+1);
  return localISO(d);
}

async function generateDueRecurring(){
  const today = todayISO();
  for(const r of state.recurring){
    if(r.active===false) continue;
    let next = r.lastGenerated ? nextRecurringDate(r.lastGenerated, r.frequency) : r.startDate;
    let iterations = 0;
    let changed = false;
    while(next && next <= today && iterations < 36){
      if(r.isTransfer){
        await idb.put('transfers', {fromAccountId:r.fromAccountId, toAccountId:r.toAccountId, fromAmount:r.fromAmount, toAmount:r.toAmount, date:next, note:(r.note ? r.note+' · ' : '')+'Recurrente'});
      } else {
        await idb.put('transactions', {accountId:r.accountId, kind:r.kind, amount:r.amount, categoryId:r.categoryId, subcategory:r.subcategory||'', date:next, note:(r.note ? r.note+' · ' : '')+'Recurrente', debtId:r.debtId||null, debtEffect:r.debtId?(r.debtEffect||'payment'):null, source:'recurring'});
        if(r.debtId) await applyDebtEffect(r.debtId, r.debtEffect||'payment', r.amount);
      }
      r.lastGenerated = next;
      next = nextRecurringDate(next, r.frequency);
      changed = true;
      iterations++;
    }
    if(changed) await idb.put('recurring', r);
  }
}

async function generateDueInstallments(){
  const today = todayISO();
  for(const it of state.installments){
    if(it.active===false) continue;
    if(it.paidInstallments >= it.totalInstallments){ it.active=false; await idb.put('installments', it); continue; }
    let next = it.lastGenerated ? nextRecurringDate(it.lastGenerated, 'monthly') : it.startDate;
    let iterations = 0;
    let changed = false;
    while(next && next <= today && it.paidInstallments < it.totalInstallments && iterations < 36){
      const cuotaAmount = installmentAmountFor(it, it.paidInstallments);
      it.paidInstallments++;
      await idb.put('transactions', {accountId:it.accountId, kind:'expense', amount:cuotaAmount, categoryId:it.categoryId, subcategory:it.subcategory||'', date:next, note:`${it.name} · Cuota ${it.paidInstallments}/${it.totalInstallments}`, debtId:it.debtId||null, source:'installment'});
      if(it.debtId) await applyDebtPayment(it.debtId, cuotaAmount);
      it.lastGenerated = next;
      next = nextRecurringDate(next, 'monthly');
      changed = true;
      iterations++;
    }
    if(it.paidInstallments >= it.totalInstallments) it.active = false;
    if(changed) await idb.put('installments', it);
  }
}

function dateForDayInMonth(year, month, day){
  const lastDay = new Date(year, month+1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}
function nextMonthlyOnDay(fromISO, day){
  const d = new Date(fromISO + "T00:00:00");
  let month = d.getMonth()+1, year = d.getFullYear();
  if(month>11){ month=0; year++; }
  return localISO(dateForDayInMonth(year, month, day));
}
function firstCardDueDate(day, fromISO){
  const d = new Date(fromISO + "T00:00:00");
  let candidate = dateForDayInMonth(d.getFullYear(), d.getMonth(), day);
  if(candidate < d){
    let month = d.getMonth()+1, year = d.getFullYear();
    if(month>11){ month=0; year++; }
    candidate = dateForDayInMonth(year, month, day);
  }
  return localISO(candidate);
}
function cutoffDayFor(a){ return a.cutoffDay || a.paymentDay; }
function paymentDateForCutoff(cutoffISO, paymentDay){
  return firstCardDueDate(paymentDay, cutoffISO);
}
function cardNextCycle(a, fromISO){
  const cutoffDay = cutoffDayFor(a);
  let cutoff = a.lastAutopayGenerated
    ? nextMonthlyOnDay(a.lastAutopayGenerated, cutoffDay)
    : (()=>{ const td=new Date(fromISO+"T00:00:00"); return localISO(dateForDayInMonth(td.getFullYear(), td.getMonth(), cutoffDay)); })();
  let paymentDate = paymentDateForCutoff(cutoff, a.paymentDay);
  let iterations = 0;
  while(paymentDate < fromISO && iterations < 36){
    cutoff = nextMonthlyOnDay(cutoff, cutoffDay);
    paymentDate = paymentDateForCutoff(cutoff, a.paymentDay);
    iterations++;
  }
  return {cutoff, paymentDate};
}
async function generateDueCardPayments(){
  const today = todayISO();
  for(const a of state.accounts){
    if(a.type !== 'tarjeta_credito' || !a.paymentDay || !a.autopayAccountId) continue;
    const fromAcc = getAccount(a.autopayAccountId);
    if(!fromAcc) continue;
    const cutoffDay = cutoffDayFor(a);
    let nextCutoff;
    if(a.lastAutopayGenerated){
      nextCutoff = nextMonthlyOnDay(a.lastAutopayGenerated, cutoffDay);
    } else {
      const td = new Date(today + "T00:00:00");
      nextCutoff = localISO(dateForDayInMonth(td.getFullYear(), td.getMonth(), cutoffDay));
    }
    let iterations = 0;
    let changed = false;
    while(iterations < 36){
      const paymentDate = paymentDateForCutoff(nextCutoff, a.paymentDay);
      if(paymentDate > today) break;
      const used = Math.max(0, -accountBalanceAsOf(a.id, nextCutoff));
      if(used > 0.004){
        const crossRate = effectiveRate(fromAcc.currency) / effectiveRate(a.currency);
        const fromAmount = Math.round((used / crossRate) * 100) / 100;
        const transferRecord = {fromAccountId:a.autopayAccountId, toAccountId:a.id, fromAmount, toAmount:used, date:paymentDate, note:'Pago automático tarjeta · '+a.name};
        await idb.put('transfers', transferRecord);
        state.transfers.push(transferRecord);
      }
      a.lastAutopayGenerated = nextCutoff;
      nextCutoff = nextMonthlyOnDay(nextCutoff, cutoffDay);
      changed = true;
      iterations++;
    }
    if(changed) await idb.put('accounts', a);
  }
}

function cardPendingInstallments(accountId){
  return state.installments.filter(it=>it.accountId===accountId && it.active!==false).reduce((sum,it)=>{
    const sched = Array.isArray(it.schedule) ? it.schedule : [];
    let pending = 0;
    for(let i=it.paidInstallments; i<it.totalInstallments; i++){
      pending += (sched[i]!=null ? sched[i] : (it.amount||0));
    }
    return sum + pending;
  }, 0);
}

/* ================= Balances ================= */
function accountBalance(accId){
  let bal = 0;
  state.transactions.forEach(t=>{
    if(t.accountId !== accId) return;
    bal += t.kind==='income' ? t.amount : -t.amount;
  });
  state.transfers.forEach(tr=>{
    if(tr.fromAccountId === accId) bal -= tr.fromAmount;
    if(tr.toAccountId === accId) bal += tr.toAmount;
  });
  return bal;
}
function totalBalanceBase(includeHidden){
  return state.accounts.reduce((sum,a)=>{
    if(!includeHidden && a.visible===false) return sum;
    return sum + toBase(accountBalance(a.id), a.currency);
  }, 0);
}

function accountBalanceAsOf(accId, asOfDate){
  let bal = 0;
  state.transactions.forEach(t=>{
    if(t.accountId !== accId || t.date > asOfDate) return;
    bal += t.kind==='income' ? t.amount : -t.amount;
  });
  state.transfers.forEach(tr=>{
    if(tr.date > asOfDate) return;
    if(tr.fromAccountId === accId) bal -= tr.fromAmount;
    if(tr.toAccountId === accId) bal += tr.toAmount;
  });
  return bal;
}
function totalBalanceBaseAsOf(asOfDate, includeHidden){
  return state.accounts.reduce((sum,a)=>{
    if(!includeHidden && a.visible===false) return sum;
    return sum + toBase(accountBalanceAsOf(a.id, asOfDate), a.currency);
  }, 0);
}
function computeBalanceTrend(days){
  const points = [];
  const today = new Date(todayISO()+"T00:00:00");
  for(let i=days-1;i>=0;i--){
    const d = new Date(today);
    d.setDate(d.getDate()-i);
    points.push(totalBalanceBaseAsOf(toISO(d)));
  }
  return points;
}
function renderBalanceTrend(){
  const svg = document.getElementById('balance-trend');
  if(!svg) return;
  const points = computeBalanceTrend(30);
  const w=300, h=56, pad=4;
  const min = Math.min(...points), max = Math.max(...points);
  const range = (max-min) || 1;
  const stepX = points.length>1 ? (w-2*pad)/(points.length-1) : 0;
  const coords = points.map((v,i)=>{
    const x = pad + i*stepX;
    const y = h-pad - ((v-min)/range)*(h-2*pad);
    return [x,y];
  });
  const linePath = coords.map((c,i)=> (i===0?'M':'L')+c[0].toFixed(1)+','+c[1].toFixed(1)).join(' ');
  const fillPath = linePath + ` L${coords[coords.length-1][0].toFixed(1)},${h-pad} L${coords[0][0].toFixed(1)},${h-pad} Z`;
  svg.classList.toggle('neg', points[points.length-1] < 0);
  svg.innerHTML = `<path class="trend-fill" d="${fillPath}"></path><path class="trend-line" d="${linePath}"></path>`;
}

/* ================= Period helpers ================= */
function startOfWeek(d){ const dt=new Date(d); const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); dt.setHours(0,0,0,0); return dt; }
function endOfWeek(d){ const s=startOfWeek(d); const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e; }
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999); }
function startOfYear(d){ return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d){ return new Date(d.getFullYear(), 11, 31, 23,59,59,999); }
function toISO(d){ return localISO(d); }

function periodRange(period){
  if(period.mode === 'range'){
    return {start: period.start || todayISO(), end: period.end || todayISO()};
  }
  const ref = new Date(period.ref + "T00:00:00");
  let s,e;
  if(period.mode==='day'){ s=ref; e=ref; }
  else if(period.mode==='week'){ s=startOfWeek(ref); e=endOfWeek(ref); }
  else if(period.mode==='month'){ s=startOfMonth(ref); e=endOfMonth(ref); }
  else { s=startOfYear(ref); e=endOfYear(ref); }
  return {start: toISO(s), end: toISO(e)};
}
function periodLabel(period){
  if(period.mode==='range') return period.start + ' – ' + period.end;
  const ref = new Date(period.ref + "T00:00:00");
  if(period.mode==='day') return cap(ref.toLocaleDateString('es-ES',{weekday:'short', day:'2-digit', month:'short', year:'numeric'}));
  if(period.mode==='week'){ const s=startOfWeek(ref), e=endOfWeek(ref); return s.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}) + ' – ' + e.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}); }
  if(period.mode==='month') return cap(ref.toLocaleDateString('es-ES',{month:'long', year:'numeric'}));
  return String(ref.getFullYear());
}
function navigatePeriod(period, dir){
  if(period.mode==='range') return period;
  const ref = new Date(period.ref + "T00:00:00");
  if(period.mode==='day') ref.setDate(ref.getDate()+dir);
  else if(period.mode==='week') ref.setDate(ref.getDate()+7*dir);
  else if(period.mode==='month') ref.setMonth(ref.getMonth()+dir);
  else ref.setFullYear(ref.getFullYear()+dir);
  return {...period, ref: toISO(ref)};
}
function txInRange(list, start, end){
  return list.filter(t => t.date >= start && t.date <= end);
}

/* ================= Period bar component ================= */
function renderPeriodBar(containerId, periodKey, onChange){
  const el = document.getElementById(containerId);
  const period = state[periodKey];
  const modes = [['day','Día'],['week','Semana'],['month','Mes'],['year','Año'],['range','Rango']];
  el.innerHTML = `
    <div class="period-modes">${modes.map(([m,l])=>`<button class="pm-btn ${period.mode===m?'active':''}" data-mode="${m}">${l}</button>`).join('')}</div>
    ${period.mode==='range'
      ? `<div class="range-inputs"><input type="date" id="${containerId}-start" value="${period.start||todayISO()}"><span style="color:var(--text-faint)">–</span><input type="date" id="${containerId}-end" value="${period.end||todayISO()}"></div>`
      : `<div class="period-nav"><button class="pn-btn" data-nav="-1">‹</button><div class="period-label">${periodLabel(period)}</div><button class="pn-btn" data-nav="1">›</button></div>`
    }
  `;
  el.querySelectorAll('.pm-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const mode = btn.dataset.mode;
      let np = {...period, mode};
      if(mode==='range' && !np.start){ np.start = todayISO(); np.end = todayISO(); }
      state[periodKey] = np;
      onChange();
    });
  });
  el.querySelectorAll('.pn-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state[periodKey] = navigatePeriod(period, Number(btn.dataset.nav));
      onChange();
    });
  });
  if(period.mode==='range'){
    document.getElementById(containerId+'-start').addEventListener('change', e=>{ state[periodKey] = {...state[periodKey], start:e.target.value}; onChange(); });
    document.getElementById(containerId+'-end').addEventListener('change', e=>{ state[periodKey] = {...state[periodKey], end:e.target.value}; onChange(); });
  }
}

/* ================= Rendering: Resumen ================= */
function renderResumen(){
  renderQuickAdd();
  renderShortcutsRow();
  const includeHidden = state.showHiddenAccts;
  const bal = totalBalanceBase(false);
  const balEl = document.getElementById('stat-balance');
  balEl.textContent = fmtMoney(bal);
  balEl.classList.toggle('neg', bal<0);
  document.getElementById('balance-sub').textContent = 'En ' + (CURRENCY_META[state.baseCurrency]?.name || state.baseCurrency);
  renderBalanceTrend();
  renderNetWorth();
  renderPaymentAlerts();
  renderCashflow();

  const miniEl = document.getElementById('accounts-mini');
  miniEl.innerHTML = '';
  state.accounts.filter(a => includeHidden || a.visible !== false).forEach(a=>{
    const row = document.createElement('div');
    row.className = 'acct-mini-row';
    row.innerHTML = `<span class="name">${escapeHtml(a.name)} ${a.visible===false?'<span style="color:var(--text-faint); font-weight:400;">(oculta)</span>':''}</span><span class="amt">${fmtMoney(accountBalance(a.id), a.currency)}</span>`;
    miniEl.appendChild(row);
  });
  document.getElementById('toggle-hidden-accts').textContent = includeHidden ? 'Ocultar cuentas ocultas' : 'Mostrar cuentas ocultas';

  const now = new Date();
  const mStart = toISO(startOfMonth(now)), mEnd = toISO(endOfMonth(now));
  const monthExpenses = txInRange(state.transactions, mStart, mEnd).filter(t=>t.kind==='expense');
  const spendByCat = {};
  monthExpenses.forEach(t=>{ const acc=getAccount(t.accountId); const amt = toBase(t.amount, acc?acc.currency:state.baseCurrency); spendByCat[t.categoryId] = (spendByCat[t.categoryId]||0)+amt; });
  const budgetCats = Object.keys(state.budgets).filter(cid => state.budgets[cid] > 0);
  const budgetsEl = document.getElementById('resumen-budgets');
  budgetsEl.innerHTML = '';
  renderGeneralBudget(monthExpenses, 'resumen-general-budget', computeMonthFixedProjection(mStart, mEnd));
  if(budgetCats.length===0){
    budgetsEl.innerHTML = '<div class="empty-note">Fija límites en la pestaña Presupuestos.</div>';
  } else {
    budgetCats.slice(0,5).forEach(cid=>{
      const cat = getCategory(Number(cid));
      if(!cat) return;
      budgetsEl.appendChild(budgetRowEl(catIcon(cat)+' '+cat.name, spendByCat[cid]||0, state.budgets[cid], cat.id));
    });
  }

  renderPeriodBar('resumen-period', 'resumenPeriod', renderResumen);
  const range = periodRange(state.resumenPeriod);
  const periodTx = txInRange(state.transactions, range.start, range.end);
  let income=0, expense=0, incomeCount=0, expenseCount=0;
  const catSpend = {};
  periodTx.forEach(t=>{
    const acc = getAccount(t.accountId);
    const amt = toBase(t.amount, acc?acc.currency:state.baseCurrency);
    if(t.kind==='income'){ income+=amt; incomeCount++; }
    else{ expense+=amt; expenseCount++; catSpend[t.categoryId]=(catSpend[t.categoryId]||0)+amt; }
  });
  document.getElementById('stat-income').textContent = fmtMoney(income);
  document.getElementById('stat-income-count').textContent = incomeCount + (incomeCount===1?' movimiento':' movimientos');
  document.getElementById('stat-expense').textContent = fmtMoney(expense);
  document.getElementById('stat-expense-count').textContent = expenseCount + (expenseCount===1?' movimiento':' movimientos');
  const netEl = document.getElementById('stat-net');
  netEl.textContent = fmtMoney(income-expense);
  netEl.style.color = (income-expense) < 0 ? 'var(--over)' : 'var(--text)';

  const compareEl = document.getElementById('stat-compare');
  if(state.resumenPeriod.mode === 'month'){
    const ref = new Date(state.resumenPeriod.ref + "T00:00:00");
    const prevRef = new Date(ref.getFullYear(), ref.getMonth()-1, 1);
    const pStart = toISO(startOfMonth(prevRef)), pEnd = toISO(endOfMonth(prevRef));
    const prevExpenses = txInRange(state.transactions, pStart, pEnd).filter(t=>t.kind==='expense')
      .reduce((s,t)=>{ const acc=getAccount(t.accountId); return s + toBase(t.amount, acc?acc.currency:state.baseCurrency); }, 0);
    if(prevExpenses > 0){
      const diffPct = ((expense - prevExpenses) / prevExpenses) * 100;
      const arrow = diffPct > 0 ? '▲' : (diffPct < 0 ? '▼' : '·');
      compareEl.textContent = `${arrow} ${Math.abs(diffPct).toFixed(0)}% en gastos vs mes anterior`;
      compareEl.style.color = diffPct > 0 ? 'var(--over)' : 'var(--teal)';
    } else {
      compareEl.textContent = '';
    }
  } else {
    compareEl.textContent = '';
  }

  renderChart('resumen-chart', catSpend, periodTx);

  const recentEl = document.getElementById('resumen-recent');
  recentEl.innerHTML = '';
  const recentItems = mergedLedger().slice(0,6);
  if(recentItems.length===0){
    recentEl.innerHTML = '<div class="empty-note">Aún no hay movimientos.</div>';
  } else {
    recentItems.forEach(it => recentEl.appendChild(ledgerRowEl(it)));
  }
}

function renderPaymentAlerts(){
  const card = document.getElementById('card-payment-alerts');
  const list = document.getElementById('payment-alerts-list');
  const today = todayISO();
  const alerts = [];
  state.accounts.forEach(a=>{
    if(a.type!=='tarjeta_credito' || !a.paymentDay) return;
    const {cutoff, paymentDate} = cardNextCycle(a, today);
    const used = Math.max(0, -accountBalanceAsOf(a.id, cutoff));
    if(used <= 0.004) return;
    const dueDate = paymentDate;
    const daysUntil = Math.round((new Date(dueDate+"T00:00:00") - new Date(today+"T00:00:00")) / 86400000);
    if(daysUntil >= 0 && daysUntil <= 3){
      alerts.push({account:a, used, dueDate, daysUntil, autopayAcc: a.autopayAccountId ? getAccount(a.autopayAccountId) : null});
    }
  });
  if(alerts.length===0){ card.style.display='none'; return; }
  card.style.display='block';
  alerts.sort((x,y)=> x.daysUntil - y.daysUntil);
  list.innerHTML = alerts.map(al=>{
    const when = al.daysUntil===0 ? 'hoy' : (al.daysUntil===1 ? 'mañana' : `en ${al.daysUntil} días`);
    const debitMsg = al.autopayAcc ? `Se debitará automáticamente desde ${escapeHtml(al.autopayAcc.name)}.` : 'No tienes débito automático configurado · recuerda pagarla a tiempo.';
    return `<div class="budget-row"><div class="budget-top"><div class="budget-cat">💳 ${escapeHtml(al.account.name)}</div><div class="budget-nums">${fmtMoney(al.used, al.account.currency)}</div></div><div class="stat-sub">Se paga ${when} (${fmtDate(al.dueDate)}) · ${debitMsg}</div></div>`;
  }).join('');
}

/* ================= Proyección de flujo de caja ================= */
function projectRecurringOccurrences(r, fromDate, toDate){
  const out = [];
  if(r.active===false) return out;
  let next = r.lastGenerated ? nextRecurringDate(r.lastGenerated, r.frequency) : r.startDate;
  let iterations = 0;
  while(next && next <= toDate && iterations < 60){
    if(next >= fromDate){
      if(r.isTransfer){
        const fromAcc = getAccount(r.fromAccountId);
        out.push({date:next, label:'⇄ '+(r.note||'Transferencia recurrente'), amount:r.fromAmount, currency: fromAcc?fromAcc.currency:state.baseCurrency, kind:'transfer'});
      } else {
        out.push({date:next, label:(r.note || getCategory(r.categoryId)?.name || 'Recurrente'), amount:r.amount, currency: getAccount(r.accountId)?.currency||state.baseCurrency, kind:r.kind});
      }
    }
    next = nextRecurringDate(next, r.frequency);
    iterations++;
  }
  return out;
}
function projectInstallmentOccurrences(it, fromDate, toDate){
  const out = [];
  if(it.active===false) return out;
  let next = it.lastGenerated ? nextRecurringDate(it.lastGenerated,'monthly') : it.startDate;
  let paid = it.paidInstallments;
  let iterations = 0;
  while(next && next <= toDate && paid < it.totalInstallments && iterations < 60){
    if(next >= fromDate){
      out.push({date:next, label:`${it.name} · Cuota ${paid+1}/${it.totalInstallments}`, amount:installmentAmountFor(it, paid), currency: getAccount(it.accountId)?.currency||state.baseCurrency, kind:'expense'});
    }
    paid++;
    next = nextRecurringDate(next, 'monthly');
    iterations++;
  }
  return out;
}
function projectCardPaymentOccurrences(a, fromDate, toDate){
  const out = [];
  if(a.type!=='tarjeta_credito' || !a.paymentDay) return out;
  const {cutoff, paymentDate} = cardNextCycle(a, fromDate);
  const used = Math.max(0, -accountBalanceAsOf(a.id, cutoff));
  if(used <= 0.004) return out;
  if(paymentDate >= fromDate && paymentDate <= toDate){
    const label = '💳 ' + a.name + (a.autopayAccountId ? ' (pago automático)' : ' (pendiente de pagar)');
    out.push({date:paymentDate, label, amount:used, currency:a.currency, kind:'expense'});
  }
  return out;
}
function computeMonthFixedProjection(monthStart, monthEnd){
  let total = 0;
  state.recurring.forEach(r=>{
    if(r.isTransfer || r.kind!=='expense') return;
    projectRecurringOccurrences(r, monthStart, monthEnd).forEach(o=>{ total += toBase(o.amount, o.currency); });
  });
  state.installments.forEach(it=>{
    projectInstallmentOccurrences(it, monthStart, monthEnd).forEach(o=>{ total += toBase(o.amount, o.currency); });
  });
  return total;
}
function computeCashflowProjection(days){
  const today = todayISO();
  const endD = new Date(today+"T00:00:00"); endD.setDate(endD.getDate()+days);
  const toDate = toISO(endD);
  let items = [];
  state.recurring.forEach(r=> items = items.concat(projectRecurringOccurrences(r, today, toDate)));
  state.installments.forEach(it=> items = items.concat(projectInstallmentOccurrences(it, today, toDate)));
  state.accounts.forEach(a=> items = items.concat(projectCardPaymentOccurrences(a, today, toDate)));
  items.sort((x,y)=> x.date.localeCompare(y.date));
  return items;
}
function renderCashflow(){
  const sel = document.getElementById('cashflow-range');
  const days = Number(sel.value) || 30;
  const items = computeCashflowProjection(days);
  const listEl = document.getElementById('cashflow-list');
  const totalEl = document.getElementById('cashflow-total');
  if(items.length===0){
    listEl.innerHTML = '<div class="empty-note">Sin pagos ni ingresos comprometidos en este período.</div>';
    totalEl.textContent = '';
    return;
  }
  let committedExpense = 0, expectedIncome = 0;
  items.forEach(it=>{
    const base = toBase(it.amount, it.currency);
    if(it.kind==='income') expectedIncome += base;
    else if(it.kind==='expense') committedExpense += base;
  });
  totalEl.textContent = `Comprometido: ${fmtMoney(committedExpense)} · Ingresos esperados: ${fmtMoney(expectedIncome)} · Neto: ${fmtMoney(expectedIncome-committedExpense)}`;
  listEl.innerHTML = items.map(it=>{
    const sign = it.kind==='income' ? '+' : (it.kind==='transfer' ? '' : '−');
    return `<div class="budget-row"><div class="budget-top"><div class="budget-cat">${escapeHtml(it.label)}</div><div class="ledger-amount ${it.kind}">${sign}${fmtMoney(it.amount, it.currency).replace('-','')}</div></div><div class="stat-sub">${fmtDate(it.date)}</div></div>`;
  }).join('');
}

function renderNetWorth(){
  const total = totalBalanceBase(true);
  const totalEl = document.getElementById('networth-total');
  totalEl.textContent = fmtMoney(total);
  totalEl.style.color = total < 0 ? 'var(--over)' : 'var(--text)';
  const byType = {};
  state.accounts.forEach(a=>{
    const val = toBase(accountBalance(a.id), a.currency);
    byType[a.type] = (byType[a.type]||0) + val;
  });
  const typeLabels = {efectivo:'Efectivo', banco:'Banco', ahorros:'Ahorros', otro:'Otro'};
  const el = document.getElementById('networth-breakdown');
  const entries = Object.entries(byType).filter(([,v])=>v!==0);
  if(entries.length===0){ el.innerHTML = '<div class="empty-note">Sin cuentas todavía.</div>'; return; }
  const maxAbs = Math.max(...entries.map(([,v])=>Math.abs(v))) || 1;
  el.innerHTML = entries.map(([type,val])=>{
    const pct = Math.min(100, Math.abs(val)/maxAbs*100);
    return `
      <div class="budget-row">
        <div class="budget-top"><div class="budget-cat">${typeLabels[type]||cap(type)}</div><div class="budget-nums">${fmtMoney(val)}</div></div>
        <div class="budget-track"><div class="budget-fill" style="width:${pct}%; background:${val<0?'var(--over)':'var(--teal)'};"></div></div>
      </div>
    `;
  }).join('');
}

function renderGeneralBudget(monthExpenses, elId, pendingFixed){
  const el = document.getElementById(elId || 'general-budget-summary');
  if(!el) return;
  if(!elId) document.getElementById('general-budget-input').value = state.generalBudget || '';

  let fixedTotal = 0, variableTotal = 0;
  monthExpenses.forEach(t=>{
    const acc = getAccount(t.accountId);
    const amt = toBase(t.amount, acc?acc.currency:state.baseCurrency);
    if(t.source==='recurring' || t.source==='installment') fixedTotal += amt;
    else variableTotal += amt;
  });
  const pending = pendingFixed || 0;
  fixedTotal += pending;
  const total = fixedTotal + variableTotal;
  const limit = state.generalBudget || 0;
  const remaining = limit - total;

  if(!limit){
    if(elId){ el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="stat-sub" style="margin-bottom:10px;">Fija un límite mensual abajo para ver cuánto te queda libre.</div>
      <div class="budget-row" style="border:none; padding:0;">
        <div class="budget-top"><div class="budget-cat">Fijos (recurrentes y cuotas)</div><div class="budget-nums">${fmtMoney(fixedTotal)}</div></div>
      </div>
      <div class="budget-row" style="border:none; padding-top:0;">
        <div class="budget-top"><div class="budget-cat">Variables (anotados a mano)</div><div class="budget-nums">${fmtMoney(variableTotal)}</div></div>
      </div>
    `;
    return;
  }
  const pct = limit>0 ? Math.min(100, total/limit*100) : 0;
  const over = total>limit;
  const warn = !over && pct>80;

  const today = new Date();
  const totalDaysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
  const daysRemaining = totalDaysInMonth - today.getDate() + 1;
  const freeForVariables = limit - fixedTotal;
  const dailyBaseline = freeForVariables / totalDaysInMonth;
  const dailyRemaining = (freeForVariables - variableTotal) / daysRemaining;

  const todayStr = todayISO();
  let todaySpent = 0;
  monthExpenses.forEach(t=>{
    if(t.date!==todayStr || t.source==='recurring' || t.source==='installment') return;
    const acc = getAccount(t.accountId);
    todaySpent += toBase(t.amount, acc?acc.currency:state.baseCurrency);
  });
  const todayLeft = dailyBaseline - todaySpent;

  el.innerHTML = `
    <div${elId ? ' style="padding-bottom:14px; border-bottom:1px solid var(--rule);"' : ''}>
      <div class="budget-top"><div class="budget-cat">${elId ? 'Presupuesto general' : 'Gastado este mes'}</div><div class="budget-nums">${fmtMoney(total)} / ${fmtMoney(limit)}</div></div>
      <div class="budget-track"><div class="budget-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
      <div class="stat-sub" style="margin-top:8px; color:${remaining<0?'var(--over)':'var(--text-soft)'};">${remaining<0 ? 'Te pasaste por '+fmtMoney(Math.abs(remaining)) : 'Te queda '+fmtMoney(remaining)}</div>
      <div style="display:flex; gap:20px; margin-top:12px;">
        <div class="stat-sub">🔁 Fijos: <strong style="color:var(--text);">${fmtMoney(fixedTotal)}</strong>${pending>0.004 ? ` <span class="muted">(incluye ${fmtMoney(pending)} aún no facturados)</span>` : ''}</div>
        <div class="stat-sub">✏️ Variables: <strong style="color:var(--text);">${fmtMoney(variableTotal)}</strong></div>
      </div>
      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--rule);">
        <div class="stat-label">Presupuesto diario libre <span class="muted" style="text-transform:none; font-weight:500;">(descontando fijos)</span></div>
        <div class="balance-num" style="font-size:26px; margin:6px 0 2px; color:${dailyRemaining<0?'var(--over)':'var(--text)'};">${fmtMoney(dailyRemaining)}<span style="font-size:14px; color:var(--text-soft); font-weight:500;"> /día</span></div>
        <div class="stat-sub">Para los ${daysRemaining} días que quedan del mes · si lo repartes parejo desde el día 1: ${fmtMoney(dailyBaseline)}/día</div>
      </div>
      <div style="margin-top:12px; padding:10px 14px; background:var(--paper); border:1px solid var(--rule); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <div class="stat-sub">Hoy: gastaste <strong style="color:var(--text);">${fmtMoney(todaySpent)}</strong> de ${fmtMoney(dailyBaseline)}</div>
        <div class="stat-sub" style="color:${todayLeft<0?'var(--over)':'var(--teal)'}; font-weight:600;">${todayLeft<0 ? 'Te pasaste '+fmtMoney(Math.abs(todayLeft)) : 'Te quedan '+fmtMoney(todayLeft)}</div>
      </div>
    </div>
  `;
}

function budgetRowEl(name, spent, limit, categoryId){
  const div = document.createElement('div');
  div.className = 'budget-row';
  const pct = limit>0 ? Math.min(100,(spent/limit)*100) : 0;
  const over = spent>limit;
  const warn = !over && pct>80;
  div.innerHTML = `
    <div class="budget-top"><div class="budget-cat">${escapeHtml(name)}</div><div class="budget-nums">${fmtMoney(spent)} / ${fmtMoney(limit)}</div></div>
    <div class="budget-track"><div class="budget-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
  `;
  if(categoryId){
    div.style.cursor = 'pointer';
    div.title = 'Editar límite de presupuesto';
    div.addEventListener('click', ()=> goToBudgetEdit(categoryId));
  }
  return div;
}

function goToBudgetEdit(categoryId){
  document.querySelectorAll('.nav-btn[data-view="presupuestos"]')[0].click();
  const input = document.querySelector(`[data-budget-cat="${categoryId}"]`);
  if(!input) return;
  input.scrollIntoView({behavior:'smooth', block:'center'});
  input.focus();
  input.select();
  const row = input.closest('.rate-row');
  if(row){
    row.style.transition = 'background .3s ease';
    row.style.background = 'var(--gold-soft)';
    setTimeout(()=>{ row.style.background = ''; }, 1200);
  }
}

function renderChart(containerId, catSpend, periodTx){
  const el = document.getElementById(containerId);
  const entries = Object.entries(catSpend).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(entries.length===0){ el.innerHTML = '<div class="empty-note">Sin gastos en este período.</div>'; return; }
  const total = entries.reduce((s,[,v])=>s+v,0);
  let gradParts = []; let acc = 0;
  const legendItems = entries.map(([cid,amt],i)=>{
    const cat = getCategory(Number(cid));
    const color = PALETTE[i % PALETTE.length];
    const pct = amt/total*100;
    gradParts.push(`${color} ${acc}% ${acc+pct}%`);
    acc += pct;
    return {catId: cid, name: cat?cat.name:'Otros', amt, color};
  });
  el.innerHTML = `
    <div class="pie" style="background:conic-gradient(${gradParts.join(',')});"></div>
    <div class="legend">${legendItems.map(li=>`
      <div class="legend-item" data-legend-toggle="${li.catId}" style="cursor:pointer;">
        <span class="legend-swatch" style="background:${li.color}"></span><span class="legend-name">${escapeHtml(li.name)}</span><span class="legend-amt">${fmtMoney(li.amt)}</span>
      </div>
      <div class="ledger" id="legend-detail-${li.catId}" style="display:none; margin:4px 0 8px;"></div>
    `).join('')}</div>
  `;
  el.querySelectorAll('[data-legend-toggle]').forEach(row=>{
    row.addEventListener('click', ()=>{
      const catId = row.dataset.legendToggle;
      const detailEl = document.getElementById('legend-detail-'+catId);
      const isOpen = detailEl.style.display !== 'none';
      el.querySelectorAll('[id^="legend-detail-"]').forEach(d=> d.style.display='none');
      if(isOpen) return;
      const items = periodTx.filter(t=>t.kind==='expense' && String(t.categoryId)===String(catId))
        .sort((a,b)=> b.date.localeCompare(a.date));
      detailEl.innerHTML = items.map(t=>ledgerRowEl({...t, itemType:'tx'}).outerHTML).join('');
      detailEl.style.display = 'block';
    });
  });
}

function mergedLedger(){
  const txItems = state.transactions.map(t=>({...t, itemType:'tx'}));
  const trItems = state.transfers.map(t=>({...t, itemType:'transfer'}));
  return [...txItems, ...trItems].sort((a,b)=> b.date.localeCompare(a.date) || (b.id-a.id));
}

function ledgerRowEl(item){
  const div = document.createElement('div');
  div.className = 'ledger-row';
  if(item.itemType==='transfer'){
    const from = getAccount(item.fromAccountId), to = getAccount(item.toAccountId);
    div.innerHTML = `
      <div class="ledger-date">${fmtDate(item.date)}</div>
      <div class="ledger-desc"><div class="ledger-note">${escapeHtml(item.note || 'Transferencia')}</div><div class="ledger-cat">${from?escapeHtml(from.name):'?'} → ${to?escapeHtml(to.name):'?'}</div></div>
      <div><span class="tag transfer">Transferencia</span></div>
      <div class="ledger-amount transfer">${fmtMoney(item.fromAmount, from?from.currency:state.baseCurrency)}</div>
      <button class="del-btn" data-edit-transfer="${item.id}" title="Editar">✎</button>
      <button class="del-btn" data-del-transfer="${item.id}" title="Eliminar">✕</button>
    `;
  } else {
    const acc = getAccount(item.accountId);
    const cat = getCategory(item.categoryId);
    const catLabel = cat ? (catIcon(cat)+' '+cat.name) : 'Sin categoría';
    const secondaryLabel = [item.subcategory ? escapeHtml(item.subcategory) : null, item.note ? escapeHtml(item.note) : null, acc?escapeHtml(acc.name):null].filter(Boolean).join(' · ');
    div.innerHTML = `
      <div class="ledger-date">${fmtDate(item.date)}</div>
      <div class="ledger-desc"><div class="ledger-note">${escapeHtml(catLabel)}</div><div class="ledger-cat">${secondaryLabel}</div></div>
      <div><span class="tag ${item.kind}">${item.kind==='income'?'Ingreso':'Gasto'}</span></div>
      <div class="ledger-amount ${item.kind}">${item.kind==='income'?'+':'-'}${fmtMoney(item.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</div>
      <button class="del-btn" data-edit-tx="${item.id}" title="Editar">✎</button>
      <button class="del-btn" data-del-tx="${item.id}" title="Eliminar">✕</button>
    `;
  }
  return div;
}

/* ================= Rendering: Movimientos ================= */
function renderMovimientos(){
  populateAccountSelects();
  populateCategorySelect(document.getElementById('tx-category'), state.txType);
  populateSubcategorySelect();
  populateDebtSelect(document.getElementById('tx-debt'), state.txType);

  document.getElementById('filter-account').innerHTML = '<option value="all">Todas las cuentas</option>' + state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const allCats = state.categories.map(c=>`<option value="${c.id}">${catIcon(c)} ${escapeHtml(c.name)} (${c.kind==='expense'?'gasto':'ingreso'})</option>`).join('');
  document.getElementById('filter-category').innerHTML = '<option value="all">Todas las categorías</option>' + allCats;

  renderPeriodBar('mov-period', 'movPeriod', renderMovimientos);
  filterAndRenderTx();
}

function populateAccountSelects(){
  const opts = state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} — ${fmtMoney(accountBalance(a.id), a.currency)}</option>`).join('');
  const defaultId = getDefaultAccountId();
  ['tx-account','tr-from','tr-to','qk-account','qk-tr-from','qk-tr-to'].forEach(id=>{
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = opts;
    if(prev) sel.value = prev;
    else if((id==='tx-account' || id==='qk-account') && defaultId) sel.value = defaultId;
  });
}
function populateCategorySelect(selectEl, kind){
  const cats = sortedCategories(kind);
  selectEl.innerHTML = cats.map(c=>`<option value="${c.id}">${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('');
}
function populateSubcategorySelect(){
  const catId = Number(document.getElementById('tx-category').value);
  const cat = getCategory(catId);
  const sel = document.getElementById('tx-subcategory');
  const subs = cat ? cat.subcategories : [];
  sel.innerHTML = '<option value="">Ninguna</option>' + subs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function filterAndRenderTx(){
  const range = periodRange(state.movPeriod);
  const accVal = document.getElementById('filter-account').value;
  const typeVal = document.getElementById('filter-type').value;
  const catVal = document.getElementById('filter-category').value;
  const searchVal = (document.getElementById('filter-search').value || '').trim().toLowerCase();

  let list = mergedLedger().filter(it => it.date >= range.start && it.date <= range.end);
  if(accVal !== 'all'){
    const accId = Number(accVal);
    list = list.filter(it => it.itemType==='transfer' ? (it.fromAccountId===accId || it.toAccountId===accId) : it.accountId===accId);
  }
  if(typeVal !== 'all'){
    list = list.filter(it => it.itemType==='transfer' ? typeVal==='transfer' : it.kind===typeVal);
  }
  if(catVal !== 'all'){
    list = list.filter(it => it.itemType==='tx' && it.categoryId===Number(catVal));
  }
  if(searchVal){
    list = list.filter(it => {
      const note = (it.note || '').toLowerCase();
      const catName = it.itemType==='tx' ? (getCategory(it.categoryId)?.name || '').toLowerCase() + ' ' + (it.subcategory||'').toLowerCase() : '';
      return note.includes(searchVal) || catName.includes(searchVal);
    });
  }

  const listEl = document.getElementById('tx-list');
  listEl.innerHTML = '';
  if(list.length===0){
    listEl.innerHTML = '<div class="empty-note">No hay movimientos que coincidan con estos filtros.</div>';
  } else {
    list.forEach(it => listEl.appendChild(ledgerRowEl(it)));
  }

  renderSearchExtras(searchVal);
}

function renderSearchExtras(searchVal){
  const el = document.getElementById('search-extra-results');
  if(!searchVal){ el.innerHTML = ''; return; }
  const matchedGoals = state.goals.filter(g => g.name.toLowerCase().includes(searchVal));
  const matchedDebts = state.debts.filter(d => d.person.toLowerCase().includes(searchVal) || (d.note||'').toLowerCase().includes(searchVal));
  const matchedReminders = state.reminders.filter(r => r.text.toLowerCase().includes(searchVal));
  const total = matchedGoals.length + matchedDebts.length + matchedReminders.length;
  if(total===0){ el.innerHTML = ''; return; }
  let html = '<div class="section-title" style="font-size:15px; margin-top:22px;">También en Más <span class="muted">Toca para ir ahí</span></div>';
  matchedGoals.forEach(g=> html += `<div class="budget-row" style="cursor:pointer;" data-goto-mas="goal-${g.id}"><div class="budget-top"><div class="budget-cat">🎯 ${escapeHtml(g.name)}</div><div class="budget-nums">Meta de ahorro</div></div></div>`);
  matchedDebts.forEach(d=> html += `<div class="budget-row" style="cursor:pointer;" data-goto-mas="debt-${d.id}"><div class="budget-top"><div class="budget-cat">🤝 ${escapeHtml(d.person)}</div><div class="budget-nums">${d.direction==='debo'?'Yo debo':'Me deben'}</div></div></div>`);
  matchedReminders.forEach(r=> html += `<div class="budget-row" style="cursor:pointer;" data-goto-mas="reminder-${r.id}"><div class="budget-top"><div class="budget-cat">📌 ${escapeHtml(r.text)}</div><div class="budget-nums">Recordatorio</div></div></div>`);
  el.innerHTML = html;
}

function setupSearch(){
  document.getElementById('filter-search').addEventListener('input', filterAndRenderTx);
  document.addEventListener('click', (e)=>{
    const goto = e.target.closest('[data-goto-mas]');
    if(goto){
      document.querySelectorAll('.nav-btn[data-view="mas"]').forEach(b=>b.click());
    }
  });
}

/* ================= Rendering: Cuentas ================= */
function renderCuentas(){
  const el = document.getElementById('accounts-list');
  el.innerHTML = '';
  if(state.accounts.length===0){
    el.innerHTML = '<div class="empty-note">Añade tu primera cuenta abajo.</div>';
  } else {
    const sortMode = document.getElementById('account-sort').value;
    let accountsSorted = state.accounts.slice();
    if(sortMode==='balance-desc') accountsSorted.sort((a,b)=> toBase(accountBalance(b.id),b.currency) - toBase(accountBalance(a.id),a.currency));
    else if(sortMode==='balance-asc') accountsSorted.sort((a,b)=> toBase(accountBalance(a.id),a.currency) - toBase(accountBalance(b.id),b.currency));
    else if(sortMode==='name') accountsSorted.sort((a,b)=> a.name.localeCompare(b.name));
    else accountsSorted.sort((a,b)=> (a.order??a.id) - (b.order??b.id));
    const showReorder = sortMode==='default';
    const typeLabels = {efectivo:'Efectivo', banco:'Banco', ahorros:'Ahorros', tarjeta_credito:'Tarjeta de crédito', otro:'Otro'};
    accountsSorted.forEach((a,idx)=>{
      const div = document.createElement('div');
      div.className = 'account-card' + (a.visible===false ? ' hidden-acct' : '');
      const isCard = a.type==='tarjeta_credito';
      const bal = accountBalance(a.id);
      const pendingInstallments = isCard ? cardPendingInstallments(a.id) : 0;
      const used = isCard ? Math.max(0, -bal) + pendingInstallments : 0;
      const limit = isCard ? (a.creditLimit || 0) : 0;
      const pct = limit>0 ? Math.min(100, used/limit*100) : 0;
      const over = used>limit && limit>0;
      const warn = !over && pct>80;
      div.innerHTML = `
        <div class="acct-main-row">
          <div>
            <div class="acct-name">${a.isDefault?'⭐ ':''}${escapeHtml(a.name)}</div>
            <div class="acct-meta">${typeLabels[a.type]||cap(a.type)} ${a.country?'· '+escapeHtml(a.country):''} <span class="currency-badge">${a.currency}</span></div>
          </div>
          <div class="acct-right">
            <div class="acct-balance">${fmtMoney(bal, a.currency)}</div>
            ${showReorder ? `<button class="icon-btn" data-move-account="${a.id}" data-dir="-1" title="Subir" ${idx===0?'disabled style="opacity:.3;"':''}>▲</button><button class="icon-btn" data-move-account="${a.id}" data-dir="1" title="Bajar" ${idx===accountsSorted.length-1?'disabled style="opacity:.3;"':''}>▼</button>` : ''}
            <button class="icon-btn" data-set-default-account="${a.id}" title="${a.isDefault?'Es tu cuenta preferida':'Marcar como preferida'}">${a.isDefault?'⭐':'☆'}</button>
            <button class="icon-btn" data-acct-edit-toggle="${a.id}" title="Corregir saldo">✎</button>
            <button class="icon-btn" data-toggle-visible="${a.id}" title="${a.visible===false?'Mostrar en saldo':'Ocultar del saldo'}">${a.visible===false?'🙈':'👁'}</button>
            <button class="icon-btn" data-del-account="${a.id}" title="Eliminar cuenta">✕</button>
          </div>
        </div>
        ${isCard && limit>0 ? `
          <div class="budget-track" style="margin-top:10px;"><div class="budget-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
          <div class="stat-sub" style="margin-top:4px;">Consumido ${fmtMoney(used, a.currency)} de ${fmtMoney(limit, a.currency)} · disponible ${fmtMoney(Math.max(0,limit-used), a.currency)}${pendingInstallments>0.004 ? ` <span class="muted">(incluye ${fmtMoney(pendingInstallments, a.currency)} en cuotas pendientes)</span>` : ''}</div>
        ` : ''}
        ${isCard ? `
          <div class="stat-sub" style="margin-top:4px;">${a.paymentDay ? (cutoffDayFor(a)!==a.paymentDay ? `Corte el día ${cutoffDayFor(a)}, pago el día ${a.paymentDay}` : `Pago el día ${a.paymentDay} de cada mes`) : 'Sin día de pago configurado'}${a.paymentDay ? (a.autopayAccountId ? ' · Débito automático desde '+escapeHtml(getAccount(a.autopayAccountId)?.name||'cuenta eliminada') : ' · Sin débito automático') : ''}</div>
        ` : ''}
        <div class="acct-edit-row" id="acct-edit-${a.id}" style="display:none; flex-direction:column; gap:10px;">
          <div class="form-grid">
            <div class="field"><label>Corregir saldo</label><input type="number" step="0.01" data-acct-edit-input="${a.id}" value="${accountBalance(a.id).toFixed(2)}"></div>
            ${isCard ? `
              <div class="field"><label>Día de corte <span class="muted">opcional</span></label><input type="number" min="1" max="31" data-acct-edit-cutoff="${a.id}" value="${a.cutoffDay||''}" placeholder="Ej. 15"></div>
              <div class="field"><label>Día de pago mensual</label><input type="number" min="1" max="31" data-acct-edit-payday="${a.id}" value="${a.paymentDay||''}" placeholder="Ej. 15"></div>
              <div class="field"><label>Débito automático desde</label><select data-acct-edit-autopay="${a.id}"><option value="">Sin débito automático</option>${state.accounts.filter(x=>x.id!==a.id && x.type!=='tarjeta_credito').map(x=>`<option value="${x.id}" ${x.id===a.autopayAccountId?'selected':''}>${escapeHtml(x.name)} (${x.currency})</option>`).join('')}</select></div>
            ` : ''}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-acct-edit-save="${a.id}">Guardar</button>
            <button class="btn-secondary btn-sm" data-acct-edit-cancel="${a.id}">Cancelar</button>
          </div>
        </div>
      `;
      el.appendChild(div);
    });
  }
  const curSel = document.getElementById('acc-currency');
  curSel.innerHTML = CURRENCIES.map(c=>`<option value="${c}">${c} — ${CURRENCY_META[c].name}</option>`).join('');
  const autopaySel = document.getElementById('acc-card-autopay');
  if(autopaySel){
    const prevAutopay = autopaySel.value;
    autopaySel.innerHTML = '<option value="">Sin débito automático</option>' + state.accounts.filter(x=>x.type!=='tarjeta_credito').map(x=>`<option value="${x.id}">${escapeHtml(x.name)} (${x.currency})</option>`).join('');
    if(prevAutopay) autopaySel.value = prevAutopay;
  }
}

function getDefaultAccountId(){
  const d = state.accounts.find(a=>a.isDefault);
  return d ? d.id : (state.accounts[0] ? state.accounts[0].id : null);
}

async function moveAccount(id, dir){
  const sorted = state.accounts.slice().sort((a,b)=> (a.order??a.id) - (b.order??b.id));
  const idx = sorted.findIndex(a=>a.id===id);
  const swapIdx = idx + dir;
  if(swapIdx<0 || swapIdx>=sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const aOrder = a.order ?? a.id, bOrder = b.order ?? b.id;
  await idb.put('accounts', {...a, order:bOrder});
  await idb.put('accounts', {...b, order:aOrder});
  await loadAll(); renderAll();
}

/* ================= Rendering: Presupuestos ================= */
function renderPresupuestos(){
  const now = new Date();
  const mStart = toISO(startOfMonth(now)), mEnd = toISO(endOfMonth(now));
  const monthExpenses = txInRange(state.transactions, mStart, mEnd).filter(t=>t.kind==='expense');
  const spendByCat = {};
  monthExpenses.forEach(t=>{ const acc=getAccount(t.accountId); const amt=toBase(t.amount, acc?acc.currency:state.baseCurrency); spendByCat[t.categoryId]=(spendByCat[t.categoryId]||0)+amt; });

  renderGeneralBudget(monthExpenses, undefined, computeMonthFixedProjection(mStart, mEnd));

  const expenseCats = sortedCategories('expense');

  const progEl = document.getElementById('presupuestos-progress');
  progEl.innerHTML = '';
  const active = expenseCats.filter(c => (state.budgets[c.id]>0) || spendByCat[c.id]);
  if(active.length===0){
    progEl.innerHTML = '<div class="empty-note">Fija límites abajo para ver tu progreso mensual aquí.</div>';
  } else {
    active.forEach(c => progEl.appendChild(budgetRowEl(catIcon(c)+' '+c.name, spendByCat[c.id]||0, state.budgets[c.id]||0, c.id)));
  }

  const editEl = document.getElementById('presupuestos-edit');
  editEl.innerHTML = expenseCats.map(c=>`
    <div class="rate-row"><label>${catIcon(c)} ${escapeHtml(c.name)}</label><input type="number" min="0" step="1" data-budget-cat="${c.id}" value="${state.budgets[c.id]||''}" placeholder="0"></div>
  `).join('');

  renderCategoriesEditor('cats-expense', 'expense');
  renderCategoriesEditor('cats-income', 'income');
}

function renderCategoriesEditor(containerId, kind){
  const el = document.getElementById(containerId);
  const cats = sortedCategories(kind);
  el.innerHTML = '';
  cats.forEach((cat,idx)=>{
    const block = document.createElement('div');
    block.className = 'cat-block';
    block.innerHTML = `
      <div class="cat-block-top">
        <button type="button" class="icon-pick-btn" data-icon-pick="${cat.id}" title="Cambiar icono">${catIcon(cat)}</button>
        <input type="text" value="${escapeHtml(cat.name)}" data-rename-cat="${cat.id}">
        <button class="icon-btn" data-move-cat="${cat.id}" data-dir="-1" title="Subir" ${idx===0?'disabled style="opacity:.3;"':''}>▲</button>
        <button class="icon-btn" data-move-cat="${cat.id}" data-dir="1" title="Bajar" ${idx===cats.length-1?'disabled style="opacity:.3;"':''}>▼</button>
        <button class="icon-btn" data-del-cat="${cat.id}" title="Eliminar categoría">✕</button>
      </div>
      <div class="subcats">${cat.subcategories.map(s=>`<span class="subcat-chip">${escapeHtml(s)}<button data-del-subcat="${cat.id}|${escapeHtml(s)}">✕</button></span>`).join('')}</div>
      <div class="add-subcat"><input type="text" placeholder="Nueva subcategoría" data-new-subcat-input="${cat.id}"><button class="btn-secondary btn-sm" data-add-subcat="${cat.id}">Añadir</button></div>
    `;
    el.appendChild(block);
  });
}

/* ================= Rendering: Ajustes ================= */
/* ================= Rendering: Más (metas, recurrentes, recordatorios, deudas) ================= */
function renderMas(){
  // Metas de ahorro
  const goalsEl = document.getElementById('goals-list');
  goalsEl.innerHTML = '';
  if(state.goals.length===0){
    goalsEl.innerHTML = '<div class="empty-note">Aún no has creado metas de ahorro.</div>';
  } else {
    state.goals.forEach(g=>{
      const pct = g.targetAmount>0 ? Math.min(100, (g.savedAmount||0)/g.targetAmount*100) : 0;
      const div = document.createElement('div');
      div.className = 'budget-row';
      div.innerHTML = `
        <div class="budget-top">
          <div class="budget-cat">${escapeHtml(g.name)} ${g.targetDate?`<span style="color:var(--text-faint); font-weight:400; font-size:12px;">· ${fmtDate(g.targetDate)}</span>`:''}</div>
          <div class="budget-nums">${fmtMoney(g.savedAmount||0)} / ${fmtMoney(g.targetAmount)}</div>
        </div>
        <div class="budget-track"><div class="budget-fill" style="width:${pct}%"></div></div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn-secondary btn-sm" data-goal-add="${g.id}">+ Añadir aporte</button>
          <button class="btn-secondary btn-sm" data-goal-edit-toggle="${g.id}">✎ Editar</button>
          <button class="btn-secondary btn-sm btn-danger" data-goal-del="${g.id}">Eliminar</button>
        </div>
        <div class="acct-edit-row" id="goal-edit-${g.id}" style="display:none; flex-direction:column; gap:10px;">
          <div class="form-grid">
            <div class="field"><label>Nombre</label><input type="text" data-goal-edit-name="${g.id}" value="${escapeHtml(g.name)}"></div>
            <div class="field"><label>Objetivo</label><input type="number" step="0.01" min="0" data-goal-edit-target="${g.id}" value="${g.targetAmount}"></div>
            <div class="field"><label>Ahorrado</label><input type="number" step="0.01" min="0" data-goal-edit-saved="${g.id}" value="${g.savedAmount||0}"></div>
            <div class="field"><label>Fecha límite</label><input type="date" data-goal-edit-date="${g.id}" value="${g.targetDate||''}"></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-goal-edit-save="${g.id}">Guardar</button>
            <button class="btn-secondary btn-sm" data-goal-edit-cancel="${g.id}">Cancelar</button>
          </div>
        </div>
      `;
      goalsEl.appendChild(div);
    });
  }

  // Recurrentes
  const recTypeNow = (document.querySelector('#rec-type-toggle .type-btn.active')||{}).dataset?.type || 'expense';
  populateCategorySelect(document.getElementById('rec-category'), recTypeNow);
  populateDebtSelect(document.getElementById('rec-debt'), recTypeNow);
  const recAccSel = document.getElementById('rec-account');
  const prevRecAcc = recAccSel.value;
  const accOptsWithBalance = state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} — ${fmtMoney(accountBalance(a.id), a.currency)}</option>`).join('');
  recAccSel.innerHTML = accOptsWithBalance;
  if(prevRecAcc) recAccSel.value = prevRecAcc;
  ['rec-tr-from','rec-tr-to'].forEach(id=>{
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = accOptsWithBalance;
    if(prev) sel.value = prev;
  });

  const recEl = document.getElementById('recurring-list');
  recEl.innerHTML = '';
  if(state.recurring.length===0){
    recEl.innerHTML = '<div class="empty-note">Sin movimientos recurrentes todavía.</div>';
  } else {
    state.recurring.forEach(r=>{
      const freqLabel = {weekly:'Semanal', monthly:'Mensual', yearly:'Anual'}[r.frequency] || r.frequency;
      const div = document.createElement('div');
      div.className = 'account-card' + (r.active===false ? ' hidden-acct' : '');

      if(r.isTransfer){
        const fromAcc = getAccount(r.fromAccountId), toAcc = getAccount(r.toAccountId);
        div.innerHTML = `
          <div class="acct-main-row">
          <div>
            <div class="acct-name">${escapeHtml(r.note || 'Transferencia recurrente')}</div>
            <div class="acct-meta">${freqLabel} · ${fromAcc?escapeHtml(fromAcc.name):'?'} → ${toAcc?escapeHtml(toAcc.name):'?'}</div>
          </div>
          <div class="acct-right">
            <div class="acct-balance transfer">${fmtMoney(r.fromAmount, fromAcc?fromAcc.currency:state.baseCurrency)}</div>
            <button class="icon-btn" data-rec-edit-toggle="${r.id}" title="Editar">✎</button>
            <button class="icon-btn" data-toggle-recurring="${r.id}" title="${r.active===false?'Activar':'Pausar'}">${r.active===false?'▶':'⏸'}</button>
            <button class="icon-btn" data-del-recurring="${r.id}" title="Eliminar">✕</button>
          </div>
          </div>
          <div class="acct-edit-row" id="rec-edit-${r.id}" style="display:none; flex-direction:column; gap:10px;">
            <div class="form-grid">
              <div class="field"><label>Cuenta origen</label><select data-rec-edit-tr-from="${r.id}">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===r.fromAccountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
              <div class="field"><label>Cuenta destino</label><select data-rec-edit-tr-to="${r.id}">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===r.toAccountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
              <div class="field"><label>Importe enviado</label><input type="number" step="0.01" min="0" data-rec-edit-tr-amount-from="${r.id}" value="${r.fromAmount}"></div>
              <div class="field"><label>Importe recibido</label><input type="number" step="0.01" min="0" data-rec-edit-tr-amount-to="${r.id}" value="${r.toAmount}"></div>
              <div class="field"><label>Frecuencia</label><select data-rec-edit-tr-frequency="${r.id}">${['weekly','monthly','yearly'].map(f=>`<option value="${f}" ${f===r.frequency?'selected':''}>${({weekly:'Semanal',monthly:'Mensual',yearly:'Anual'})[f]}</option>`).join('')}</select></div>
              <div class="field"><label>Nota</label><input type="text" data-rec-edit-tr-note="${r.id}" value="${escapeHtml(r.note||'')}"></div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn-secondary btn-sm" data-rec-edit-tr-save="${r.id}">Guardar</button>
              <button class="btn-secondary btn-sm" data-rec-edit-cancel="${r.id}">Cancelar</button>
            </div>
          </div>
        `;
        recEl.appendChild(div);
        return;
      }

      const acc = getAccount(r.accountId), cat = getCategory(r.categoryId);
      div.innerHTML = `
        <div class="acct-main-row">
        <div>
          <div class="acct-name">${escapeHtml(r.note || (cat?cat.name:'Recurrente'))}${r.debtId && r.debtEffect==='loan' ? ' <span class="muted" style="font-weight:normal;">(préstamo nuevo)</span>' : ''}</div>
          <div class="acct-meta">${freqLabel} · ${cat?catIcon(cat)+' '+escapeHtml(cat.name):''} · ${acc?escapeHtml(acc.name):''}</div>
        </div>
        <div class="acct-right">
          <div class="acct-balance ${r.kind}">${r.kind==='income'?'+':'-'}${fmtMoney(r.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</div>
          <button class="icon-btn" data-rec-edit-toggle="${r.id}" title="Editar">✎</button>
          <button class="icon-btn" data-toggle-recurring="${r.id}" title="${r.active===false?'Activar':'Pausar'}">${r.active===false?'▶':'⏸'}</button>
          <button class="icon-btn" data-del-recurring="${r.id}" title="Eliminar">✕</button>
        </div>
        </div>
        <div class="acct-edit-row" id="rec-edit-${r.id}" style="display:none; flex-direction:column; gap:10px;">
          <div class="form-grid">
            <div class="field"><label>Cuenta</label><select data-rec-edit-account="${r.id}">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===r.accountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
            <div class="field"><label>Importe</label><input type="number" step="0.01" min="0" data-rec-edit-amount="${r.id}" value="${r.amount}"></div>
            <div class="field"><label>Categoría</label><select data-rec-edit-category="${r.id}">${sortedCategories(r.kind).map(c=>`<option value="${c.id}" ${c.id===r.categoryId?'selected':''}>${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Frecuencia</label><select data-rec-edit-frequency="${r.id}">${['weekly','monthly','yearly'].map(f=>`<option value="${f}" ${f===r.frequency?'selected':''}>${({weekly:'Semanal',monthly:'Mensual',yearly:'Anual'})[f]}</option>`).join('')}</select></div>
            <div class="field"><label>Tipo con la deuda</label><select data-rec-edit-debtmode="${r.id}"><option value="payment" ${r.debtEffect!=='loan'?'selected':''}>Pago/abono</option><option value="loan" ${r.debtEffect==='loan'?'selected':''}>Préstamo nuevo (suma)</option></select></div>
            <div class="field"><label>Deuda relacionada</label><select data-rec-edit-debt="${r.id}"><option value="">Ninguna</option>${(r.debtEffect==='loan' ? debtsForLoanKind(r.kind) : debtsForKind(r.kind)).map(d=>`<option value="${d.id}" ${d.id===r.debtId?'selected':''}>${escapeHtml(d.person)} — ${fmtMoney(d.amount)}</option>`).join('')}</select></div>
            <div class="field"><label>Persona</label><input type="text" data-rec-edit-person="${r.id}" value="${escapeHtml(r.person||'')}"></div>
            <div class="field" style="grid-column:1/-1;"><label>Nota</label><input type="text" data-rec-edit-note="${r.id}" value="${escapeHtml(r.note||'')}"></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-rec-edit-save="${r.id}">Guardar</button>
            <button class="btn-secondary btn-sm" data-rec-edit-cancel="${r.id}">Cancelar</button>
          </div>
        </div>
      `;
      recEl.appendChild(div);
    });
  }

  // Recordatorios
  const remEl = document.getElementById('reminders-list');
  remEl.innerHTML = '';
  if(state.reminders.length===0){
    remEl.innerHTML = '<div class="empty-note">Sin recordatorios.</div>';
  } else {
    state.reminders.forEach(r=>{
      const wrap = document.createElement('div');
      const div = document.createElement('div');
      div.className = 'ledger-row';
      div.style.gridTemplateColumns = '28px 1fr 90px 28px 28px';
      div.innerHTML = `
        <input type="checkbox" data-toggle-reminder="${r.id}" ${r.done?'checked':''}>
        <div class="ledger-desc"><div class="ledger-note" style="${r.done?'text-decoration:line-through; color:var(--text-faint);':''}">${escapeHtml(r.text)}</div></div>
        <div class="ledger-date">${r.dueDate?fmtDate(r.dueDate):''}</div>
        <button class="del-btn" data-reminder-edit-toggle="${r.id}" title="Editar">✎</button>
        <button class="del-btn" data-del-reminder="${r.id}" title="Eliminar">✕</button>
      `;
      wrap.appendChild(div);
      const editRow = document.createElement('div');
      editRow.className = 'acct-edit-row';
      editRow.id = 'reminder-edit-' + r.id;
      editRow.style.cssText = 'display:none; margin-top:0; padding:10px 4px 14px; border-top:none;';
      editRow.innerHTML = `
        <input type="text" data-reminder-edit-text="${r.id}" value="${escapeHtml(r.text)}" style="flex:2;">
        <input type="date" data-reminder-edit-date="${r.id}" value="${r.dueDate||''}">
        <button class="btn-secondary btn-sm" data-reminder-edit-save="${r.id}">Guardar</button>
        <button class="btn-secondary btn-sm" data-reminder-edit-cancel="${r.id}">Cancelar</button>
      `;
      wrap.appendChild(editRow);
      remEl.appendChild(wrap);
    });
  }

  // Deudas
  const debtsEl = document.getElementById('debts-list');
  debtsEl.innerHTML = '';
  if(state.debts.length===0){
    debtsEl.innerHTML = '<div class="empty-note">Sin deudas ni préstamos registrados.</div>';
  } else {
    state.debts.forEach(d=>{
      const original = d.originalAmount || d.amount;
      const paid = Math.max(0, original - d.amount);
      const pct = original>0 ? Math.min(100, paid/original*100) : 0;
      const div = document.createElement('div');
      div.className = 'account-card' + (d.settled ? ' hidden-acct' : '');
      div.innerHTML = `
        <div class="acct-main-row">
        <div>
          <div class="acct-name">${escapeHtml(d.person)}</div>
          <div class="acct-meta">${d.direction==='debo'?'Yo debo':'Me deben'} ${d.note?'· '+escapeHtml(d.note):''} ${d.settled?'· Liquidada':''}</div>
        </div>
        <div class="acct-right">
          <div class="acct-balance">${fmtMoney(d.amount)}</div>
          <button class="icon-btn" data-debt-edit-toggle="${d.id}" title="Editar">✎</button>
          <button class="icon-btn" data-toggle-debt="${d.id}" title="${d.settled?'Marcar pendiente':'Marcar liquidada'}">${d.settled?'↺':'✓'}</button>
          <button class="icon-btn" data-del-debt="${d.id}" title="Eliminar">✕</button>
        </div>
        </div>
        ${original>d.amount || original!==d.amount ? `<div class="budget-track" style="margin-top:10px;"><div class="budget-fill" style="width:${pct}%"></div></div><div class="stat-sub" style="margin-top:4px;">Pagado ${fmtMoney(paid)} de ${fmtMoney(original)}</div>` : ''}
        <div class="acct-edit-row" id="debt-edit-${d.id}" style="display:none; flex-direction:column; gap:10px;">
          <div class="type-toggle" style="max-width:320px;" id="debt-edit-type-${d.id}">
            <button type="button" class="type-btn ${d.direction==='debo'?'active':''}" data-debt-edit-direction="debo">Yo debo</button>
            <button type="button" class="type-btn ${d.direction==='me_deben'?'active':''}" data-debt-edit-direction="me_deben">Me deben</button>
          </div>
          <div class="form-grid">
            <div class="field"><label>Persona</label><input type="text" data-debt-edit-person="${d.id}" value="${escapeHtml(d.person)}"></div>
            <div class="field"><label>Saldo pendiente</label><input type="number" step="0.01" min="0" data-debt-edit-amount="${d.id}" value="${d.amount}"></div>
            <div class="field" style="grid-column:1/-1;"><label>Nota</label><input type="text" data-debt-edit-note="${d.id}" value="${escapeHtml(d.note||'')}"></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-debt-edit-save="${d.id}">Guardar</button>
            <button class="btn-secondary btn-sm" data-debt-edit-cancel="${d.id}">Cancelar</button>
          </div>
        </div>
      `;
      debtsEl.appendChild(div);
    });
  }

  // Compras a plazos
  const instAccSel = document.getElementById('inst-account');
  const prevInstAcc = instAccSel.value;
  instAccSel.innerHTML = state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join('');
  if(prevInstAcc) instAccSel.value = prevInstAcc;
  populateCategorySelect(document.getElementById('inst-category'), 'expense');
  populateDebtSelect(document.getElementById('inst-debt'), 'expense');

  const instEl = document.getElementById('installments-list');
  instEl.innerHTML = '';
  if(state.installments.length===0){
    instEl.innerHTML = '<div class="empty-note">Sin compras a plazos registradas.</div>';
  } else {
    state.installments.forEach(it=>{
      const acc = getAccount(it.accountId);
      const pct = it.totalInstallments>0 ? Math.min(100, it.paidInstallments/it.totalInstallments*100) : 0;
      const nextDate = it.paidInstallments < it.totalInstallments ? (it.lastGenerated ? nextRecurringDate(it.lastGenerated,'monthly') : it.startDate) : null;
      const totals = installmentTotals(it);
      const curr = acc?acc.currency:state.baseCurrency;
      const div = document.createElement('div');
      div.className = 'budget-row';
      div.innerHTML = `
        <div class="budget-top">
          <div class="budget-cat">${escapeHtml(it.name)} <span style="color:var(--text-faint); font-weight:400; font-size:12px;">· ${acc?escapeHtml(acc.name):''}</span></div>
          <div class="budget-nums">Cuota ${it.paidInstallments} / ${it.totalInstallments}</div>
        </div>
        <div class="budget-track"><div class="budget-fill" style="width:${pct}%"></div></div>
        <div class="stat-sub" style="margin-top:6px;">Pagado ${fmtMoney(totals.paid, curr)} de ${fmtMoney(totals.total, curr)} · Adeudado ${fmtMoney(totals.remaining, curr)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <div class="stat-sub">${it.paidInstallments>=it.totalInstallments ? '✔ Pagada por completo' : (nextDate ? `Próximo pago: ${fmtDate(nextDate)} · ${fmtMoney(installmentAmountFor(it, it.paidInstallments), curr)}` : '')}</div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-inst-edit-toggle="${it.id}">✎ Editar</button>
            <button class="btn-secondary btn-sm btn-danger" data-del-installment="${it.id}">Eliminar</button>
          </div>
        </div>
        <div class="acct-edit-row" id="inst-edit-${it.id}" style="display:none; flex-direction:column; gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid var(--rule);">
          <div class="form-grid">
            <div class="field"><label>Nombre</label><input type="text" data-inst-edit-name="${it.id}" value="${escapeHtml(it.name)}"></div>
            <div class="field"><label>Cuenta</label><select data-inst-edit-account="${it.id}">${state.accounts.map(a=>`<option value="${a.id}" ${a.id===it.accountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
            <div class="field"><label>Cuota actual/próxima</label><input type="number" step="0.01" min="0" data-inst-edit-amount="${it.id}" value="${installmentAmountFor(it, it.paidInstallments)}"></div>
            <div class="field"><label>Monto total restante <span class="muted">opcional, recalcula las cuotas futuras por igual</span></label><input type="number" step="0.01" min="0" data-inst-edit-remaining="${it.id}" placeholder="Dejar en blanco para no recalcular"></div>
            <div class="field"><label>Número de cuotas</label><input type="number" min="1" step="1" data-inst-edit-total="${it.id}" value="${it.totalInstallments}"></div>
            <div class="field"><label>Cuotas pagadas</label><input type="number" min="0" step="1" data-inst-edit-paid="${it.id}" value="${it.paidInstallments}"></div>
            <div class="field"><label>Categoría</label><select data-inst-edit-category="${it.id}">${sortedCategories('expense').map(c=>`<option value="${c.id}" ${c.id===it.categoryId?'selected':''}>${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Deuda relacionada</label><select data-inst-edit-debt="${it.id}"><option value="">Ninguna</option>${state.debts.filter(d=>d.direction==='debo').map(d=>`<option value="${d.id}" ${d.id===it.debtId?'selected':''}>${escapeHtml(d.person)} — ${fmtMoney(d.amount)}</option>`).join('')}</select></div>
            <div class="field"><label>Persona</label><input type="text" data-inst-edit-person="${it.id}" value="${escapeHtml(it.person||'')}"></div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-secondary btn-sm" data-inst-edit-save="${it.id}">Guardar</button>
            <button class="btn-secondary btn-sm" data-inst-edit-cancel="${it.id}">Cancelar</button>
          </div>
        </div>
      `;
      instEl.appendChild(div);
    });
  }

  renderPersonSummary();
}

function renderPersonSummary(){
  const el = document.getElementById('person-summary');
  const groups = {};
  state.recurring.forEach(r=>{
    if(r.active===false || !r.person || !r.person.trim()) return;
    if(r.frequency !== 'monthly') return;
    const acc = getAccount(r.accountId);
    const key = r.person.trim();
    groups[key] = groups[key] || [];
    groups[key].push({label: r.note || (getCategory(r.categoryId)?.name || 'Recurrente'), amount: r.amount, currency: acc?acc.currency:state.baseCurrency});
  });
  state.installments.forEach(it=>{
    if(it.active===false || !it.person || !it.person.trim()) return;
    if(it.paidInstallments >= it.totalInstallments) return;
    const acc = getAccount(it.accountId);
    const key = it.person.trim();
    groups[key] = groups[key] || [];
    groups[key].push({label: `${it.name} (cuota ${it.paidInstallments+1}/${it.totalInstallments})`, amount: installmentAmountFor(it, it.paidInstallments), currency: acc?acc.currency:state.baseCurrency});
  });

  const people = Object.keys(groups);
  if(people.length===0){
    el.innerHTML = '<div class="empty-note">Asigna una persona a un recurrente mensual o compra a plazos para verla aquí.</div>';
    return;
  }
  el.innerHTML = people.map(person=>{
    const items = groups[person];
    const byCurrency = {};
    items.forEach(i=>{ byCurrency[i.currency] = (byCurrency[i.currency]||0) + i.amount; });
    const currencyTotals = Object.entries(byCurrency).map(([cur,amt])=> fmtMoney(amt, cur)).join('  +  ');
    const baseTotal = items.reduce((s,i)=> s + toBase(i.amount, i.currency), 0);
    const showBaseRef = !(Object.keys(byCurrency).length===1 && byCurrency[state.baseCurrency]!==undefined);
    return `
      <div class="budget-row">
        <div class="budget-top"><div class="budget-cat">${escapeHtml(person)}</div><div class="budget-nums">${currencyTotals}</div></div>
        <div class="stat-sub">${showBaseRef ? '≈ '+fmtMoney(baseTotal)+' · ' : ''}${items.map(i=>escapeHtml(i.label)+' ('+fmtMoney(i.amount, i.currency)+')').join(' · ')}</div>
      </div>
    `;
  }).join('');
}

function renderShortcutsRow(){
  const el = document.getElementById('shortcuts-row');
  if(state.shortcuts.length===0){ el.innerHTML = ''; return; }
  el.innerHTML = state.shortcuts.map(s=>{
    const acc = getAccount(s.accountId);
    return `<button type="button" class="shortcut-chip" data-shortcut-fire="${s.id}">${escapeHtml(s.label)} <span class="amt">${s.kind==='income'?'+':'-'}${fmtMoney(s.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</span></button>`;
  }).join('');
}

function renderShortcutsList(){
  const el = document.getElementById('shortcuts-list');
  if(state.shortcuts.length===0){ el.innerHTML = '<div class="empty-note">Sin accesos rápidos todavía.</div>'; return; }
  el.innerHTML = state.shortcuts.map(s=>{
    const acc = getAccount(s.accountId);
    const cat = getCategory(s.categoryId);
    return `
      <div class="acct-main-row" style="padding:10px 0; border-bottom:1px solid var(--rule);">
        <div>
          <div class="acct-name">${escapeHtml(s.label)}</div>
          <div class="acct-meta">${cat?catIcon(cat)+' '+escapeHtml(cat.name):''} · ${acc?escapeHtml(acc.name):''}</div>
        </div>
        <div class="acct-right">
          <div class="acct-balance ${s.kind}">${s.kind==='income'?'+':'-'}${fmtMoney(s.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</div>
          <button class="icon-btn" data-del-shortcut="${s.id}" title="Eliminar">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function openIconPicker(categoryId){
  state.iconPickerTarget = categoryId;
  const cat = getCategory(categoryId);
  const current = catIcon(cat);
  const grid = document.getElementById('icon-picker-grid');
  grid.innerHTML = ICON_GROUPS.map(g=>`
    <div class="icon-group-label">${escapeHtml(g.label)}</div>
    <div class="icon-grid">${g.icons.map(ic=>`<button type="button" class="icon-grid-btn ${ic===current?'selected':''}" data-icon-grid-pick="${ic}">${ic}</button>`).join('')}</div>
  `).join('');
  document.getElementById('icon-picker-overlay').style.display = 'flex';
  pushOverlayState();
}
function closeIconPicker(){
  state.iconPickerTarget = null;
  history.back();
}
function setupIconPicker(){
  document.getElementById('icon-picker-close').addEventListener('click', closeIconPicker);
  document.getElementById('icon-picker-overlay').addEventListener('click', (e)=>{
    if(e.target.id === 'icon-picker-overlay') closeIconPicker();
  });
  document.addEventListener('click', async (e)=>{
    const openBtn = e.target.closest('[data-icon-pick]');
    if(openBtn){ openIconPicker(Number(openBtn.dataset.iconPick)); return; }
    const pickBtn = e.target.closest('[data-icon-grid-pick]');
    if(pickBtn && state.iconPickerTarget){
      const cat = getCategory(state.iconPickerTarget);
      if(cat){
        await idb.put('categories', {...cat, icon: pickBtn.dataset.iconGridPick});
        await loadAll(); renderAll();
      }
      closeIconPicker();
      return;
    }
  });
}

function setupShortcuts(){
  let shortcutType = 'expense';
  document.getElementById('shortcut-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#shortcut-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      shortcutType = btn.dataset.type;
      populateCategorySelect(document.getElementById('shortcut-category'), shortcutType);
    });
  });

  document.getElementById('open-shortcut-modal').addEventListener('click', ()=>{
    const accSel = document.getElementById('shortcut-account');
    accSel.innerHTML = state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join('');
    populateCategorySelect(document.getElementById('shortcut-category'), shortcutType);
    document.getElementById('shortcut-modal-overlay').style.display = 'flex';
    pushOverlayState();
  });
  document.getElementById('shortcut-modal-close').addEventListener('click', ()=> closeMasModal('shortcut-modal-overlay'));
  document.getElementById('shortcut-modal-overlay').addEventListener('click', (e)=>{
    if(e.target.id === 'shortcut-modal-overlay') closeMasModal('shortcut-modal-overlay');
  });

  document.getElementById('shortcut-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.accounts.length===0){ toast('Añade primero una cuenta'); return; }
    const label = document.getElementById('shortcut-label').value.trim();
    const amount = parseFloat(document.getElementById('shortcut-amount').value);
    if(!label || !amount || amount<=0){ toast('Revisa los datos'); return; }
    await idb.put('shortcuts', {
      label, kind: shortcutType, amount,
      accountId: Number(document.getElementById('shortcut-account').value),
      categoryId: Number(document.getElementById('shortcut-category').value)
    });
    await loadAll(); renderAll();
    document.getElementById('shortcut-label').value=''; document.getElementById('shortcut-amount').value='';
    closeMasModal('shortcut-modal-overlay');
    toast('Acceso rápido creado');
  });

  document.addEventListener('click', async (e)=>{
    const del = e.target.closest('[data-del-shortcut]');
    if(del){
      await idb.delete('shortcuts', Number(del.dataset.delShortcut));
      await loadAll(); renderAll();
      return;
    }
    const fire = e.target.closest('[data-shortcut-fire]');
    if(fire){
      const s = state.shortcuts.find(x=>x.id===Number(fire.dataset.shortcutFire));
      if(!s) return;
      const t = {accountId:s.accountId, kind:s.kind, amount:s.amount, categoryId:s.categoryId, subcategory:'', date:todayISO(), note:s.label, debtId:null};
      await idb.put('transactions', t);
      await loadAll(); renderAll();
      toast((t.kind==='expense' && budgetAlertMessage(t.categoryId)) || `${s.label} anotado`);
      return;
    }
  });
}

function setupGoals(){
  document.getElementById('goal-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('goal-name').value.trim();
    const targetAmount = parseFloat(document.getElementById('goal-target').value);
    if(!name || !targetAmount || targetAmount<=0) return;
    await idb.put('goals', {name, targetAmount, savedAmount:0, targetDate: document.getElementById('goal-date').value || null});
    await loadAll(); renderAll();
    document.getElementById('goal-name').value=''; document.getElementById('goal-target').value=''; document.getElementById('goal-date').value='';
    closeMasModal('goal-modal-overlay');
    toast('Meta creada');
  });
  document.addEventListener('click', async (e)=>{
    const addBtn = e.target.closest('[data-goal-add]');
    if(addBtn){
      const id = Number(addBtn.dataset.goalAdd);
      const goal = state.goals.find(g=>g.id===id);
      const amountStr = prompt('¿Cuánto quieres aportar a "' + goal.name + '"?');
      const amount = parseFloat(amountStr);
      if(!amount || amount<=0) return;
      await idb.put('goals', {...goal, savedAmount:(goal.savedAmount||0)+amount});
      await loadAll(); renderAll();
      toast('Aporte añadido');
      return;
    }
    const delBtn = e.target.closest('[data-goal-del]');
    if(delBtn){
      if(!confirm('¿Eliminar esta meta de ahorro?')) return;
      await idb.delete('goals', Number(delBtn.dataset.goalDel));
      await loadAll(); renderAll();
      return;
    }
    const editToggle = e.target.closest('[data-goal-edit-toggle]');
    if(editToggle){
      const row = document.getElementById('goal-edit-'+editToggle.dataset.goalEditToggle);
      row.style.display = row.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-goal-edit-cancel]');
    if(editCancel){
      document.getElementById('goal-edit-'+editCancel.dataset.goalEditCancel).style.display = 'none';
      return;
    }
    const editSave = e.target.closest('[data-goal-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.goalEditSave);
      const goal = state.goals.find(g=>g.id===id);
      const name = document.querySelector(`[data-goal-edit-name="${id}"]`).value.trim();
      const targetAmount = parseFloat(document.querySelector(`[data-goal-edit-target="${id}"]`).value);
      const savedAmount = parseFloat(document.querySelector(`[data-goal-edit-saved="${id}"]`).value) || 0;
      const targetDate = document.querySelector(`[data-goal-edit-date="${id}"]`).value || null;
      if(!name || !targetAmount || targetAmount<=0){ toast('Revisa los datos'); return; }
      await idb.put('goals', {...goal, name, targetAmount, savedAmount, targetDate});
      await loadAll(); renderAll();
      toast('Meta actualizada');
      return;
    }
  });
}

function setupRecurring(){
  let recType = 'expense';
  document.getElementById('rec-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#rec-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      recType = btn.dataset.type;
      const isTransfer = recType === 'transfer';
      document.getElementById('rec-fields-normal').style.display = isTransfer ? 'none' : 'block';
      document.getElementById('rec-fields-transfer').style.display = isTransfer ? 'block' : 'none';
      if(!isTransfer){
        populateCategorySelect(document.getElementById('rec-category'), recType);
        populateDebtSelect(document.getElementById('rec-debt'), recType, state.recDebtMode);
      }
    });
  });
  populateCategorySelect(document.getElementById('rec-category'), recType);

  document.getElementById('rec-debt-mode-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#rec-debt-mode-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.recDebtMode = btn.dataset.debtmode;
      populateDebtSelect(document.getElementById('rec-debt'), recType, state.recDebtMode);
      document.getElementById('rec-debt-newperson-field').style.display = 'none';
      document.getElementById('rec-debt-newperson').value = '';
    });
  });
  document.getElementById('rec-debt').addEventListener('change', (e)=>{
    document.getElementById('rec-debt-newperson-field').style.display = e.target.value==='__new__' ? 'block' : 'none';
  });

  document.addEventListener('change', (e)=>{
    const modeSel = e.target.closest('[data-rec-edit-debtmode]');
    if(modeSel){
      const id = modeSel.dataset.recEditDebtmode;
      const r = state.recurring.find(x=>x.id===Number(id));
      if(!r) return;
      const mode = modeSel.value;
      const debtSel = document.querySelector(`[data-rec-edit-debt="${id}"]`);
      const debts = mode==='loan' ? debtsForLoanKind(r.kind) : debtsForKind(r.kind);
      debtSel.innerHTML = '<option value="">Ninguna</option>' + debts.map(d=>`<option value="${d.id}">${escapeHtml(d.person)} — ${fmtMoney(d.amount)}</option>`).join('');
    }
  });

  document.getElementById('rec-tr-from').addEventListener('change', updateRecTransferSuggestion);
  document.getElementById('rec-tr-to').addEventListener('change', updateRecTransferSuggestion);
  document.getElementById('rec-tr-amount-from').addEventListener('input', updateRecTransferSuggestion);

  document.getElementById('recurring-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.accounts.length===0){ toast('Añade primero una cuenta'); return; }

    if(recType === 'transfer'){
      const fromId = Number(document.getElementById('rec-tr-from').value);
      const toId = Number(document.getElementById('rec-tr-to').value);
      const fromAmount = parseFloat(document.getElementById('rec-tr-amount-from').value);
      const toAmount = parseFloat(document.getElementById('rec-tr-amount-to').value);
      const startDate = document.getElementById('rec-tr-date').value;
      if(!fromId || !toId || fromId===toId){ toast('Elige dos cuentas distintas'); return; }
      if(!fromAmount || fromAmount<=0 || !toAmount || toAmount<=0){ toast('Introduce importes válidos'); return; }
      if(!startDate){ toast('Elige una fecha de inicio'); return; }
      await idb.put('recurring', {
        isTransfer: true,
        fromAccountId: fromId, toAccountId: toId, fromAmount, toAmount,
        frequency: document.getElementById('rec-tr-frequency').value,
        startDate, lastGenerated: null,
        note: document.getElementById('rec-tr-note').value.trim(),
        active: true
      });
      document.getElementById('rec-tr-amount-from').value=''; document.getElementById('rec-tr-amount-to').value=''; document.getElementById('rec-tr-note').value='';
    } else {
      const amount = parseFloat(document.getElementById('rec-amount').value);
      if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
      const startDate = document.getElementById('rec-date').value;
      if(!startDate) { toast('Elige una fecha de inicio'); return; }
      const debtIdVal = document.getElementById('rec-debt').value;
      if(debtIdVal==='__new__' && !document.getElementById('rec-debt-newperson').value.trim()){ toast('Escribe el nombre de la persona'); return; }
      let resolvedDebtId = debtIdVal ? Number(debtIdVal) : null;
      if(debtIdVal==='__new__'){
        resolvedDebtId = await findOrCreateDebtFor(document.getElementById('rec-debt-newperson').value, loanDirectionForKind(recType));
      }
      await idb.put('recurring', {
        accountId: Number(document.getElementById('rec-account').value),
        kind: recType,
        amount,
        categoryId: Number(document.getElementById('rec-category').value),
        subcategory: '',
        frequency: document.getElementById('rec-frequency').value,
        startDate,
        lastGenerated: null,
        note: document.getElementById('rec-note').value.trim(),
        person: document.getElementById('rec-person').value.trim(),
        debtId: resolvedDebtId,
        debtEffect: resolvedDebtId ? state.recDebtMode : null,
        active: true
      });
      document.getElementById('rec-amount').value=''; document.getElementById('rec-note').value=''; document.getElementById('rec-person').value='';
      document.getElementById('rec-debt-newperson').value=''; document.getElementById('rec-debt-newperson-field').style.display='none';
    }

    await loadAll();
    await generateDueRecurring();
    await loadAll(); renderAll();
    closeMasModal('recurring-modal-overlay');
    toast('Recurrente creado');
  });

  document.addEventListener('click', async (e)=>{
    const tgl = e.target.closest('[data-toggle-recurring]');
    if(tgl){
      const id = Number(tgl.dataset.toggleRecurring);
      const r = state.recurring.find(x=>x.id===id);
      await idb.put('recurring', {...r, active: !(r.active!==false)});
      await loadAll(); renderAll();
      return;
    }
    const del = e.target.closest('[data-del-recurring]');
    if(del){
      if(!confirm('¿Eliminar este recurrente? Los movimientos ya generados no se borrarán.')) return;
      await idb.delete('recurring', Number(del.dataset.delRecurring));
      await loadAll(); renderAll();
      return;
    }
    const editToggle = e.target.closest('[data-rec-edit-toggle]');
    if(editToggle){
      const row = document.getElementById('rec-edit-'+editToggle.dataset.recEditToggle);
      row.style.display = row.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-rec-edit-cancel]');
    if(editCancel){
      document.getElementById('rec-edit-'+editCancel.dataset.recEditCancel).style.display = 'none';
      return;
    }
    const editSave = e.target.closest('[data-rec-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.recEditSave);
      const r = state.recurring.find(x=>x.id===id);
      const accountId = Number(document.querySelector(`[data-rec-edit-account="${id}"]`).value);
      const amount = parseFloat(document.querySelector(`[data-rec-edit-amount="${id}"]`).value);
      const categoryId = Number(document.querySelector(`[data-rec-edit-category="${id}"]`).value);
      const frequency = document.querySelector(`[data-rec-edit-frequency="${id}"]`).value;
      const note = document.querySelector(`[data-rec-edit-note="${id}"]`).value.trim();
      const person = document.querySelector(`[data-rec-edit-person="${id}"]`).value.trim();
      const debtIdVal = document.querySelector(`[data-rec-edit-debt="${id}"]`).value;
      const debtEffect = document.querySelector(`[data-rec-edit-debtmode="${id}"]`).value;
      if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
      await idb.put('recurring', {...r, accountId, amount, categoryId, frequency, note, person, debtId: debtIdVal ? Number(debtIdVal) : null, debtEffect: debtIdVal ? debtEffect : null});
      await loadAll(); renderAll();
      toast('Recurrente actualizado');
      return;
    }
    const editTrSave = e.target.closest('[data-rec-edit-tr-save]');
    if(editTrSave){
      const id = Number(editTrSave.dataset.recEditTrSave);
      const r = state.recurring.find(x=>x.id===id);
      const fromAccountId = Number(document.querySelector(`[data-rec-edit-tr-from="${id}"]`).value);
      const toAccountId = Number(document.querySelector(`[data-rec-edit-tr-to="${id}"]`).value);
      const fromAmount = parseFloat(document.querySelector(`[data-rec-edit-tr-amount-from="${id}"]`).value);
      const toAmount = parseFloat(document.querySelector(`[data-rec-edit-tr-amount-to="${id}"]`).value);
      const frequency = document.querySelector(`[data-rec-edit-tr-frequency="${id}"]`).value;
      const note = document.querySelector(`[data-rec-edit-tr-note="${id}"]`).value.trim();
      if(!fromAccountId || !toAccountId || fromAccountId===toAccountId){ toast('Elige dos cuentas distintas'); return; }
      if(!fromAmount || fromAmount<=0 || !toAmount || toAmount<=0){ toast('Introduce importes válidos'); return; }
      await idb.put('recurring', {...r, fromAccountId, toAccountId, fromAmount, toAmount, frequency, note});
      await loadAll(); renderAll();
      toast('Recurrente actualizado');
      return;
    }
  });
}

function setupReminders(){
  document.getElementById('reminder-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const text = document.getElementById('reminder-text').value.trim();
    if(!text) return;
    await idb.put('reminders', {text, dueDate: document.getElementById('reminder-date').value || null, done:false});
    await loadAll(); renderAll();
    document.getElementById('reminder-text').value=''; document.getElementById('reminder-date').value='';
    closeMasModal('reminder-modal-overlay');
    toast('Recordatorio añadido');
  });
  document.addEventListener('change', async (e)=>{
    const chk = e.target.closest('[data-toggle-reminder]');
    if(chk){
      const id = Number(chk.dataset.toggleReminder);
      const r = state.reminders.find(x=>x.id===id);
      await idb.put('reminders', {...r, done: chk.checked});
      await loadAll(); renderAll();
    }
  });
  document.addEventListener('click', async (e)=>{
    const del = e.target.closest('[data-del-reminder]');
    if(del){
      await idb.delete('reminders', Number(del.dataset.delReminder));
      await loadAll(); renderAll();
      return;
    }
    const editToggle = e.target.closest('[data-reminder-edit-toggle]');
    if(editToggle){
      const row = document.getElementById('reminder-edit-'+editToggle.dataset.reminderEditToggle);
      row.style.display = row.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-reminder-edit-cancel]');
    if(editCancel){
      document.getElementById('reminder-edit-'+editCancel.dataset.reminderEditCancel).style.display = 'none';
      return;
    }
    const editSave = e.target.closest('[data-reminder-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.reminderEditSave);
      const r = state.reminders.find(x=>x.id===id);
      const text = document.querySelector(`[data-reminder-edit-text="${id}"]`).value.trim();
      const dueDate = document.querySelector(`[data-reminder-edit-date="${id}"]`).value || null;
      if(!text){ toast('Escribe un texto'); return; }
      await idb.put('reminders', {...r, text, dueDate});
      await loadAll(); renderAll();
      toast('Recordatorio actualizado');
      return;
    }
  });
}

function setupDebts(){
  let debtDirection = 'debo';
  document.getElementById('debt-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#debt-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      debtDirection = btn.dataset.type;
    });
  });
  document.getElementById('debt-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const person = document.getElementById('debt-person').value.trim();
    const amount = parseFloat(document.getElementById('debt-amount').value);
    if(!person || !amount || amount<=0) return;
    await idb.put('debts', {person, direction:debtDirection, amount, originalAmount:amount, note: document.getElementById('debt-note').value.trim(), settled:false, date: todayISO()});
    await loadAll(); renderAll();
    document.getElementById('debt-person').value=''; document.getElementById('debt-amount').value=''; document.getElementById('debt-note').value='';
    closeMasModal('debt-modal-overlay');
    toast('Deuda añadida');
  });
  document.addEventListener('click', async (e)=>{
    const tgl = e.target.closest('[data-toggle-debt]');
    if(tgl){
      const id = Number(tgl.dataset.toggleDebt);
      const d = state.debts.find(x=>x.id===id);
      await idb.put('debts', {...d, settled: !d.settled});
      await loadAll(); renderAll();
      return;
    }
    const del = e.target.closest('[data-del-debt]');
    if(del){
      if(!confirm('¿Eliminar este registro de deuda?')) return;
      await idb.delete('debts', Number(del.dataset.delDebt));
      await loadAll(); renderAll();
      return;
    }
    const editToggle = e.target.closest('[data-debt-edit-toggle]');
    if(editToggle){
      const row = document.getElementById('debt-edit-'+editToggle.dataset.debtEditToggle);
      row.style.display = row.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-debt-edit-cancel]');
    if(editCancel){
      document.getElementById('debt-edit-'+editCancel.dataset.debtEditCancel).style.display = 'none';
      return;
    }
    const editDir = e.target.closest('[data-debt-edit-direction]');
    if(editDir){
      const group = editDir.closest('.type-toggle');
      group.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
      editDir.classList.add('active');
      return;
    }
    const editSave = e.target.closest('[data-debt-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.debtEditSave);
      const d = state.debts.find(x=>x.id===id);
      const person = document.querySelector(`[data-debt-edit-person="${id}"]`).value.trim();
      const amount = parseFloat(document.querySelector(`[data-debt-edit-amount="${id}"]`).value);
      const note = document.querySelector(`[data-debt-edit-note="${id}"]`).value.trim();
      const direction = document.querySelector(`#debt-edit-type-${id} .type-btn.active`).dataset.debtEditDirection;
      if(!person || !amount || amount<=0){ toast('Revisa los datos'); return; }
      await idb.put('debts', {...d, person, amount, note, direction});
      await loadAll(); renderAll();
      toast('Deuda actualizada');
      return;
    }
  });
}

function setupInstallments(){
  document.getElementById('installment-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.accounts.length===0){ toast('Añade primero una cuenta'); return; }
    const name = document.getElementById('inst-name').value.trim();
    const totalAmount = parseFloat(document.getElementById('inst-total-amount').value);
    const totalInstallments = parseInt(document.getElementById('inst-total').value, 10);
    const paidInstallments = parseInt(document.getElementById('inst-paid').value, 10) || 0;
    const startDate = document.getElementById('inst-date').value;
    if(!name || !totalAmount || totalAmount<=0 || !totalInstallments || totalInstallments<1 || !startDate){ toast('Revisa los datos del formulario'); return; }
    if(paidInstallments >= totalInstallments){ toast('Las cuotas pagadas deben ser menos que el total'); return; }
    const debtIdVal = document.getElementById('inst-debt').value;
    const schedule = buildEqualSchedule(totalAmount, totalInstallments);
    await idb.put('installments', {
      name,
      accountId: Number(document.getElementById('inst-account').value),
      amount: schedule[0]||0,
      totalAmount,
      schedule,
      totalInstallments,
      paidInstallments,
      categoryId: Number(document.getElementById('inst-category').value),
      subcategory: '',
      startDate,
      lastGenerated: null,
      note: '',
      person: document.getElementById('inst-person').value.trim(),
      debtId: debtIdVal ? Number(debtIdVal) : null,
      active: true
    });
    await loadAll();
    await generateDueInstallments();
    await loadAll(); renderAll();
    document.getElementById('inst-name').value=''; document.getElementById('inst-total-amount').value=''; document.getElementById('inst-total').value=''; document.getElementById('inst-paid').value='0'; document.getElementById('inst-person').value='';
    closeMasModal('installment-modal-overlay');
    toast('Compra a plazos creada');
  });

  document.addEventListener('click', async (e)=>{
    const del = e.target.closest('[data-del-installment]');
    if(del){
      if(!confirm('¿Eliminar esta compra a plazos? Los pagos ya generados no se borrarán.')) return;
      await idb.delete('installments', Number(del.dataset.delInstallment));
      await loadAll(); renderAll();
      return;
    }
    const editToggle = e.target.closest('[data-inst-edit-toggle]');
    if(editToggle){
      const row = document.getElementById('inst-edit-'+editToggle.dataset.instEditToggle);
      row.style.display = row.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-inst-edit-cancel]');
    if(editCancel){
      document.getElementById('inst-edit-'+editCancel.dataset.instEditCancel).style.display = 'none';
      return;
    }
    const editSave = e.target.closest('[data-inst-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.instEditSave);
      const it = state.installments.find(x=>x.id===id);
      const name = document.querySelector(`[data-inst-edit-name="${id}"]`).value.trim();
      const accountId = Number(document.querySelector(`[data-inst-edit-account="${id}"]`).value);
      const nextAmount = parseFloat(document.querySelector(`[data-inst-edit-amount="${id}"]`).value);
      const remainingRaw = document.querySelector(`[data-inst-edit-remaining="${id}"]`).value;
      const totalInstallments = parseInt(document.querySelector(`[data-inst-edit-total="${id}"]`).value, 10);
      const paidInstallments = parseInt(document.querySelector(`[data-inst-edit-paid="${id}"]`).value, 10) || 0;
      const categoryId = Number(document.querySelector(`[data-inst-edit-category="${id}"]`).value);
      const person = document.querySelector(`[data-inst-edit-person="${id}"]`).value.trim();
      const debtIdVal = document.querySelector(`[data-inst-edit-debt="${id}"]`).value;
      if(!name || !nextAmount || nextAmount<=0 || !totalInstallments || totalInstallments<1){ toast('Revisa los datos'); return; }
      if(paidInstallments >= totalInstallments){ toast('Las cuotas pagadas deben ser menos que el total'); return; }
      let schedule = normalizeSchedule(it.schedule, totalInstallments, it.amount);
      const remainingTotal = parseFloat(remainingRaw);
      if(remainingRaw && !isNaN(remainingTotal) && remainingTotal>0){
        const remainingCount = totalInstallments - paidInstallments;
        const evenSplit = buildEqualSchedule(remainingTotal, remainingCount);
        schedule = [...schedule.slice(0, paidInstallments), ...evenSplit];
      }
      schedule[paidInstallments] = nextAmount;
      const active = paidInstallments < totalInstallments;
      const totalAmount = schedule.reduce((s,v)=>s+v, 0);
      await idb.put('installments', {...it, name, accountId, amount:schedule[0]||nextAmount, totalAmount, schedule, totalInstallments, paidInstallments, categoryId, person, debtId: debtIdVal ? Number(debtIdVal) : null, active});
      await loadAll(); renderAll();
      toast('Compra a plazos actualizada');
      return;
    }
  });
}

function renderAjustes(){
  const sel = document.getElementById('base-currency-select');
  sel.innerHTML = CURRENCIES.map(c=>`<option value="${c}">${c} — ${CURRENCY_META[c].name}</option>`).join('');
  sel.value = state.baseCurrency;
  document.getElementById('dark-mode-toggle').checked = !!state.darkMode;
  document.getElementById('text-scale-select').value = String(state.textScale);
  renderShortcutsList();

  const ratesEl = document.getElementById('rates-list');
  ratesEl.innerHTML = CURRENCIES.filter(c=>c!==state.baseCurrency).map(c=>`
    <div class="rate-row"><label>1 ${c} = ? ${state.baseCurrency}</label><input type="number" step="0.0001" min="0" data-rate="${c}" value="${effectiveRate(c).toFixed(4)}"></div>
  `).join('');

  const backupDesc = document.getElementById('last-backup-desc');
  if(state.lastBackupDate){
    const days = daysSince(state.lastBackupDate);
    backupDesc.textContent = days===0 ? 'Última copia: hoy' : `Última copia: ${fmtDate(state.lastBackupDate)} (hace ${days} día${days===1?'':'s'})`;
  } else {
    backupDesc.textContent = 'Todavía no has hecho ninguna copia de seguridad';
  }

  const swatchEl = document.getElementById('accent-swatches');
  swatchEl.innerHTML = ACCENT_PALETTE.map(a=>`
    <button type="button" class="accent-swatch ${a.accent===state.accentColor?'selected':''}" data-accent="${a.accent}" style="background:${a.accent};" title="${a.name}">${a.accent===state.accentColor?'✓':''}</button>
  `).join('');

  refreshOneDriveSyncUI();
}

/* ================= Global render ================= */
function renderAll(){
  renderResumen();
  renderMovimientos();
  renderCuentas();
  renderPresupuestos();
  renderMas();
  renderAjustes();
}

/* ================= Events: nav ================= */
let currentView = 'resumen';

function switchToView(view, push){
  document.querySelectorAll('.nav-btn[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.getElementById('mobile-drawer').classList.remove('open');
  currentView = view;
  if(push!==false) history.pushState({view}, '');
}

function closeAllOverlays(){
  document.querySelectorAll('.modal-overlay').forEach(m=> m.style.display='none');
  document.getElementById('mobile-drawer').classList.remove('open');
}

function pushOverlayState(){
  history.pushState({view: currentView, overlay:true}, '');
}

function setupNav(){
  history.replaceState({view:'resumen'}, '');

  window.addEventListener('popstate', (e)=>{
    closeAllOverlays();
    const view = (e.state && e.state.view) || 'resumen';
    switchToView(view, false);
  });

  document.querySelectorAll('.nav-btn[data-view]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.view !== currentView) switchToView(btn.dataset.view, true);
      else document.getElementById('mobile-drawer').classList.remove('open');
    });
  });

  document.getElementById('mobile-menu-toggle').addEventListener('click', ()=>{
    const drawer = document.getElementById('mobile-drawer');
    if(drawer.classList.contains('open')) history.back();
    else { drawer.classList.add('open'); pushOverlayState(); }
  });

  ['brand-home-mobile','brand-home-desktop'].forEach(id=>{
    document.getElementById(id).addEventListener('click', ()=>{
      document.querySelectorAll('.nav-btn[data-view="resumen"]').forEach(b=>b.click());
    });
  });
}

/* ================= Events: transactions form ================= */
function setupTxForm(){
  document.getElementById('tx-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#tx-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.txType = btn.dataset.type;
      const isTransfer = state.txType === 'transfer';
      document.getElementById('tx-fields-normal').style.display = isTransfer ? 'none' : 'block';
      document.getElementById('tx-fields-transfer').style.display = isTransfer ? 'block' : 'none';
      if(!isTransfer){ populateCategorySelect(document.getElementById('tx-category'), state.txType); populateSubcategorySelect(); populateDebtSelect(document.getElementById('tx-debt'), state.txType, state.txDebtMode); }
    });
  });

  document.getElementById('tx-debt-mode-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#tx-debt-mode-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.txDebtMode = btn.dataset.debtmode;
      populateDebtSelect(document.getElementById('tx-debt'), state.txType, state.txDebtMode);
      document.getElementById('tx-debt-newperson-field').style.display = 'none';
      document.getElementById('tx-debt-newperson').value = '';
    });
  });
  document.getElementById('tx-debt').addEventListener('change', (e)=>{
    document.getElementById('tx-debt-newperson-field').style.display = e.target.value==='__new__' ? 'block' : 'none';
  });

  document.getElementById('tx-category').addEventListener('change', populateSubcategorySelect);
  document.getElementById('tx-date').value = todayISO();
  document.getElementById('tr-date').value = todayISO();

  document.getElementById('tr-from').addEventListener('change', updateTransferSuggestion);
  document.getElementById('tr-to').addEventListener('change', updateTransferSuggestion);
  document.getElementById('tr-amount-from').addEventListener('input', updateTransferSuggestion);

  document.getElementById('tx-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.accounts.length===0){ toast('Añade primero una cuenta en la pestaña Cuentas'); return; }
    if(state.txType === 'transfer'){
      const fromId = Number(document.getElementById('tr-from').value);
      const toId = Number(document.getElementById('tr-to').value);
      const fromAmount = parseFloat(document.getElementById('tr-amount-from').value);
      const toAmount = parseFloat(document.getElementById('tr-amount-to').value);
      if(!fromId || !toId || fromId===toId){ toast('Elige dos cuentas distintas'); return; }
      if(!fromAmount || fromAmount<=0 || !toAmount || toAmount<=0){ toast('Introduce importes válidos'); return; }
      const trData = {fromAccountId:fromId, toAccountId:toId, fromAmount, toAmount, date:document.getElementById('tr-date').value, note:document.getElementById('tr-note').value.trim()};
      if(state.editingTransferId){
        trData.id = state.editingTransferId;
        await idb.put('transfers', trData);
        await loadAll(); renderAll();
        exitEditMode();
        toast('Transferencia actualizada');
      } else {
        await idb.put('transfers', trData);
        await loadAll(); renderAll();
        document.getElementById('tr-amount-from').value=''; document.getElementById('tr-amount-to').value=''; document.getElementById('tr-note').value='';
        toast('Transferencia guardada');
      }
    } else {
      const amount = parseFloat(document.getElementById('tx-amount').value);
      if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
      const debtIdVal = document.getElementById('tx-debt').value;
      const debtEffect = state.txDebtMode;
      if(debtIdVal==='__new__' && !document.getElementById('tx-debt-newperson').value.trim()){ toast('Escribe el nombre de la persona'); return; }
      const t = {
        accountId: Number(document.getElementById('tx-account').value),
        kind: state.txType,
        amount,
        categoryId: Number(document.getElementById('tx-category').value),
        subcategory: document.getElementById('tx-subcategory').value,
        date: document.getElementById('tx-date').value,
        note: document.getElementById('tx-note').value.trim(),
        debtId: (debtIdVal && debtIdVal!=='__new__') ? Number(debtIdVal) : null,
        debtEffect: debtIdVal ? debtEffect : null
      };
      if(debtIdVal==='__new__'){
        t.debtId = await findOrCreateDebtFor(document.getElementById('tx-debt-newperson').value, loanDirectionForKind(t.kind));
        t.debtEffect = 'loan';
      }
      if(state.editingTxId){
        const oldTx = state.transactions.find(tx=>tx.id===state.editingTxId);
        t.id = state.editingTxId;
        await idb.put('transactions', t);
        if(oldTx && oldTx.debtId) await revertDebtEffect(oldTx.debtId, oldTx.debtEffect, oldTx.amount);
        if(t.debtId && t.debtEffect) await applyDebtEffect(t.debtId, t.debtEffect, t.amount);
        await loadAll(); renderAll();
        exitEditMode();
        toast('Movimiento actualizado');
      } else {
        await idb.put('transactions', t);
        if(t.debtId && t.debtEffect) await applyDebtEffect(t.debtId, t.debtEffect, t.amount);
        await loadAll(); renderAll();
        document.getElementById('tx-amount').value=''; document.getElementById('tx-note').value=''; document.getElementById('tx-debt-newperson').value=''; document.getElementById('tx-debt-newperson-field').style.display='none';
        toast((t.kind==='expense' && budgetAlertMessage(t.categoryId)) || 'Movimiento guardado');
      }
    }
  });

  document.getElementById('tx-cancel-edit').addEventListener('click', exitEditMode);
}

function enterEditMode(tx){
  state.editingTxId = tx.id;
  document.querySelectorAll('#tx-type-toggle .type-btn').forEach(b=>b.classList.toggle('active', b.dataset.type===tx.kind));
  state.txType = tx.kind;
  document.getElementById('tx-fields-normal').style.display = 'block';
  document.getElementById('tx-fields-transfer').style.display = 'none';
  populateCategorySelect(document.getElementById('tx-category'), tx.kind);
  document.getElementById('tx-account').value = tx.accountId;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-category').value = tx.categoryId;
  populateSubcategorySelect();
  document.getElementById('tx-subcategory').value = tx.subcategory || '';
  state.txDebtMode = tx.debtEffect==='loan' ? 'loan' : 'payment';
  document.querySelectorAll('#tx-debt-mode-toggle .type-btn').forEach(b=>b.classList.toggle('active', b.dataset.debtmode===state.txDebtMode));
  populateDebtSelect(document.getElementById('tx-debt'), tx.kind, state.txDebtMode);
  document.getElementById('tx-debt').value = tx.debtId || '';
  document.getElementById('tx-debt-newperson-field').style.display = 'none';
  document.getElementById('tx-debt-newperson').value = '';
  document.getElementById('tx-date').value = tx.date;
  document.getElementById('tx-note').value = tx.note || '';
  document.getElementById('tx-form-title').textContent = 'Editar movimiento';
  document.getElementById('tx-submit-btn').textContent = 'Guardar cambios';
  document.getElementById('tx-cancel-edit').style.display = 'inline-block';
  document.querySelectorAll('.nav-btn[data-view="movimientos"]')[0].click();
  document.getElementById('tx-form').scrollIntoView({behavior:'smooth', block:'start'});
}

function enterTransferEditMode(tr){
  state.editingTransferId = tr.id;
  document.querySelectorAll('#tx-type-toggle .type-btn').forEach(b=>b.classList.toggle('active', b.dataset.type==='transfer'));
  state.txType = 'transfer';
  document.getElementById('tx-fields-normal').style.display = 'none';
  document.getElementById('tx-fields-transfer').style.display = 'block';
  document.getElementById('tr-from').value = tr.fromAccountId;
  document.getElementById('tr-to').value = tr.toAccountId;
  document.getElementById('tr-amount-from').value = tr.fromAmount;
  document.getElementById('tr-amount-to').value = tr.toAmount;
  document.getElementById('tr-date').value = tr.date;
  document.getElementById('tr-note').value = tr.note || '';
  document.getElementById('tx-form-title').textContent = 'Editar transferencia';
  document.getElementById('tx-submit-btn').textContent = 'Guardar cambios';
  document.getElementById('tx-cancel-edit').style.display = 'inline-block';
  document.querySelectorAll('.nav-btn[data-view="movimientos"]')[0].click();
  document.getElementById('tx-form').scrollIntoView({behavior:'smooth', block:'start'});
}

function exitEditMode(){
  state.editingTxId = null;
  state.editingTransferId = null;
  document.getElementById('tx-form-title').textContent = 'Añadir movimiento';
  document.getElementById('tx-submit-btn').textContent = 'Guardar movimiento';
  document.getElementById('tx-cancel-edit').style.display = 'none';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  document.getElementById('tx-date').value = todayISO();
  document.getElementById('tr-amount-from').value = '';
  document.getElementById('tr-amount-to').value = '';
  document.getElementById('tr-note').value = '';
  document.getElementById('tr-date').value = todayISO();
  state.txDebtMode = 'payment';
  document.querySelectorAll('#tx-debt-mode-toggle .type-btn').forEach(b=>b.classList.toggle('active', b.dataset.debtmode==='payment'));
  populateDebtSelect(document.getElementById('tx-debt'), state.txType, state.txDebtMode);
  document.getElementById('tx-debt-newperson-field').style.display = 'none';
  document.getElementById('tx-debt-newperson').value = '';
}

/* ================= Quick add (Resumen) ================= */
function renderQuickAdd(){
  const isTransfer = state.qkType === 'transfer';
  document.getElementById('qk-category-field').style.display = isTransfer ? 'none' : 'block';
  document.getElementById('qk-fields-normal').style.display = isTransfer ? 'none' : 'grid';
  document.getElementById('qk-fields-transfer').style.display = isTransfer ? 'grid' : 'none';
  if(isTransfer){
    populateAccountSelects();
  } else {
    populateCategorySelect(document.getElementById('qk-category'), state.qkType);
    populateQkSubcategory();
    populateDebtSelect(document.getElementById('qk-debt'), state.qkType, state.qkDebtMode);
    renderQkCategoryGrid();
  }
  document.getElementById('qk-date').value = document.getElementById('qk-date').value || todayISO();
  renderQkDateChips();
}
function renderQkCategoryGrid(){
  const cats = sortedCategories(state.qkType);
  const currentVal = document.getElementById('qk-category').value;
  const grid = document.getElementById('qk-category-grid');
  grid.innerHTML = cats.map((c,i)=>{
    const color = PALETTE[i % PALETTE.length];
    const selected = String(c.id)===String(currentVal);
    return `
      <button type="button" class="cat-grid-item ${selected?'selected':''}" data-qk-cat-pick="${c.id}">
        <span class="cat-grid-circle" style="background:${color}26; border-color:${selected?color:'transparent'};">${catIcon(c)}</span>
        <span class="cat-grid-label">${escapeHtml(c.name)}</span>
      </button>
    `;
  }).join('');
}
function renderQkDateChips(){
  const today = todayISO();
  const y = new Date(today+"T00:00:00"); y.setDate(y.getDate()-1);
  const d2 = new Date(today+"T00:00:00"); d2.setDate(d2.getDate()-2);
  const chips = [[today,'Hoy'],[toISO(y),'Ayer'],[toISO(d2),'Hace 2 días']];
  const current = document.getElementById('qk-date').value || today;
  document.getElementById('qk-date-chips').innerHTML = chips.map(([d,label])=>
    `<button type="button" class="date-chip ${current===d?'active':''}" data-qk-date-pick="${d}">${label}</button>`
  ).join('');
}
function populateQkSubcategory(){
  const catId = Number(document.getElementById('qk-category').value);
  const cat = getCategory(catId);
  const sel = document.getElementById('qk-subcategory');
  const subs = cat ? cat.subcategories : [];
  sel.innerHTML = '<option value="">Ninguna</option>' + subs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}
function setupQuickAdd(){
  document.getElementById('qk-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#qk-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.qkType = btn.dataset.type;
      const isTransfer = state.qkType === 'transfer';
      document.getElementById('qk-category-field').style.display = isTransfer ? 'none' : 'block';
      document.getElementById('qk-fields-normal').style.display = isTransfer ? 'none' : 'grid';
      document.getElementById('qk-fields-transfer').style.display = isTransfer ? 'grid' : 'none';
      if(!isTransfer){
        populateCategorySelect(document.getElementById('qk-category'), state.qkType);
        populateQkSubcategory();
        populateDebtSelect(document.getElementById('qk-debt'), state.qkType, state.qkDebtMode);
        renderQkCategoryGrid();
      } else {
        populateAccountSelects();
      }
    });
  });
  document.getElementById('qk-debt-mode-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#qk-debt-mode-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.qkDebtMode = btn.dataset.debtmode;
      populateDebtSelect(document.getElementById('qk-debt'), state.qkType, state.qkDebtMode);
      document.getElementById('qk-debt-newperson-field').style.display = 'none';
      document.getElementById('qk-debt-newperson').value = '';
    });
  });
  document.getElementById('qk-debt').addEventListener('change', (e)=>{
    document.getElementById('qk-debt-newperson-field').style.display = e.target.value==='__new__' ? 'block' : 'none';
  });
  document.getElementById('qk-category').addEventListener('change', populateQkSubcategory);
  document.getElementById('qk-date').value = todayISO();
  document.getElementById('qk-date').addEventListener('change', renderQkDateChips);

  document.getElementById('qk-tr-from').addEventListener('change', updateQkTransferSuggestion);
  document.getElementById('qk-tr-to').addEventListener('change', updateQkTransferSuggestion);
  document.getElementById('qk-tr-amount-from').addEventListener('input', updateQkTransferSuggestion);

  document.addEventListener('click', (e)=>{
    const catPick = e.target.closest('[data-qk-cat-pick]');
    if(catPick){
      document.getElementById('qk-category').value = catPick.dataset.qkCatPick;
      populateQkSubcategory();
      renderQkCategoryGrid();
      return;
    }
    const datePick = e.target.closest('[data-qk-date-pick]');
    if(datePick){
      document.getElementById('qk-date').value = datePick.dataset.qkDatePick;
      renderQkDateChips();
      return;
    }
  });

  document.getElementById('fab-add').addEventListener('click', openQuickAdd);
  document.getElementById('quick-add-close').addEventListener('click', closeQuickAdd);
  document.getElementById('quick-add-overlay').addEventListener('click', (e)=>{
    if(e.target.id === 'quick-add-overlay') closeQuickAdd();
  });

  document.getElementById('qk-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(state.accounts.length===0){ toast('Añade primero una cuenta en la pestaña Cuentas'); return; }
    const qkDate = document.getElementById('qk-date').value || todayISO();
    if(state.qkType === 'transfer'){
      const fromId = Number(document.getElementById('qk-tr-from').value);
      const toId = Number(document.getElementById('qk-tr-to').value);
      const fromAmount = parseFloat(document.getElementById('qk-tr-amount-from').value);
      const toAmount = parseFloat(document.getElementById('qk-tr-amount-to').value);
      if(!fromId || !toId || fromId===toId){ toast('Elige dos cuentas distintas'); return; }
      if(!fromAmount || fromAmount<=0 || !toAmount || toAmount<=0){ toast('Introduce importes válidos'); return; }
      await idb.put('transfers', {fromAccountId:fromId, toAccountId:toId, fromAmount, toAmount, date:qkDate, note:document.getElementById('qk-note').value.trim()});
      await loadAll(); renderAll();
      document.getElementById('qk-tr-amount-from').value=''; document.getElementById('qk-tr-amount-to').value=''; document.getElementById('qk-note').value='';
      closeQuickAdd();
      toast('Transferencia guardada');
      return;
    }
    const amount = parseFloat(document.getElementById('qk-amount').value);
    if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
    const debtIdVal = document.getElementById('qk-debt').value;
    if(debtIdVal==='__new__' && !document.getElementById('qk-debt-newperson').value.trim()){ toast('Escribe el nombre de la persona'); return; }
    const t = {
      accountId: Number(document.getElementById('qk-account').value),
      kind: state.qkType,
      amount,
      categoryId: Number(document.getElementById('qk-category').value),
      subcategory: document.getElementById('qk-subcategory').value,
      date: qkDate,
      note: document.getElementById('qk-note').value.trim(),
      debtId: (debtIdVal && debtIdVal!=='__new__') ? Number(debtIdVal) : null,
      debtEffect: debtIdVal ? state.qkDebtMode : null
    };
    if(debtIdVal==='__new__'){
      t.debtId = await findOrCreateDebtFor(document.getElementById('qk-debt-newperson').value, loanDirectionForKind(t.kind));
      t.debtEffect = 'loan';
    }
    await idb.put('transactions', t);
    if(t.debtId && t.debtEffect) await applyDebtEffect(t.debtId, t.debtEffect, t.amount);
    await loadAll(); renderAll();
    document.getElementById('qk-amount').value=''; document.getElementById('qk-note').value='';
    document.getElementById('qk-date').value = todayISO();
    document.getElementById('qk-debt-newperson').value=''; document.getElementById('qk-debt-newperson-field').style.display='none';
    closeQuickAdd();
    toast((t.kind==='expense' && budgetAlertMessage(t.categoryId)) || 'Movimiento guardado');
  });
}

function openQuickAdd(){
  state.qkDebtMode = 'payment';
  document.querySelectorAll('#qk-debt-mode-toggle .type-btn').forEach(b=>b.classList.toggle('active', b.dataset.debtmode==='payment'));
  document.getElementById('qk-debt-newperson-field').style.display = 'none';
  document.getElementById('qk-debt-newperson').value = '';
  renderQuickAdd();
  document.getElementById('quick-add-overlay').style.display = 'flex';
  pushOverlayState();
  setTimeout(()=> document.getElementById('qk-amount').focus(), 50);
}
function closeQuickAdd(){
  history.back();
}

function setupMasModals(){
  const modals = [
    ['open-goal-modal','goal-modal-overlay','goal-modal-close'],
    ['open-recurring-modal','recurring-modal-overlay','recurring-modal-close'],
    ['open-reminder-modal','reminder-modal-overlay','reminder-modal-close'],
    ['open-debt-modal','debt-modal-overlay','debt-modal-close'],
    ['open-installment-modal','installment-modal-overlay','installment-modal-close'],
  ];
  modals.forEach(([openId, overlayId, closeId])=>{
    document.getElementById(openId).addEventListener('click', ()=>{
      document.getElementById(overlayId).style.display = 'flex';
      pushOverlayState();
    });
    document.getElementById(closeId).addEventListener('click', ()=> closeMasModal(overlayId));
    document.getElementById(overlayId).addEventListener('click', (e)=>{
      if(e.target.id === overlayId) closeMasModal(overlayId);
    });
  });
}
function closeMasModal(overlayId){
  history.back();
}

function budgetAlertMessage(categoryId){
  if(!categoryId) return null;
  const limit = state.budgets[categoryId];
  if(!limit || limit<=0) return null;
  const now = new Date();
  const mStart = toISO(startOfMonth(now)), mEnd = toISO(endOfMonth(now));
  const spend = txInRange(state.transactions, mStart, mEnd).filter(t=>t.kind==='expense' && t.categoryId===categoryId)
    .reduce((s,t)=>{ const acc=getAccount(t.accountId); return s + toBase(t.amount, acc?acc.currency:state.baseCurrency); }, 0);
  const cat = getCategory(categoryId);
  if(!cat) return null;
  const pct = spend/limit*100;
  if(spend > limit) return `⚠️ Te pasaste del presupuesto de ${cat.name}: ${fmtMoney(spend)} / ${fmtMoney(limit)}`;
  if(pct >= 80) return `⚠️ Vas al ${pct.toFixed(0)}% del presupuesto de ${cat.name}`;
  return null;
}

function updateQkTransferSuggestion(){
  const fromId = Number(document.getElementById('qk-tr-from').value);
  const toId = Number(document.getElementById('qk-tr-to').value);
  const fromAcc = getAccount(fromId), toAcc = getAccount(toId);
  const fromAmount = parseFloat(document.getElementById('qk-tr-amount-from').value);
  if(!fromAcc || !toAcc || !fromAmount) return;
  const crossRate = effectiveRate(fromAcc.currency) / effectiveRate(toAcc.currency);
  document.getElementById('qk-tr-amount-to').value = (fromAmount * crossRate).toFixed(2);
}
function updateTransferSuggestion(){
  const fromId = Number(document.getElementById('tr-from').value);
  const toId = Number(document.getElementById('tr-to').value);
  const fromAcc = getAccount(fromId), toAcc = getAccount(toId);
  const fromAmount = parseFloat(document.getElementById('tr-amount-from').value);
  if(!fromAcc || !toAcc || !fromAmount) return;
  const crossRate = effectiveRate(fromAcc.currency) / effectiveRate(toAcc.currency);
  document.getElementById('tr-amount-to').value = (fromAmount * crossRate).toFixed(2);
}
function updateRecTransferSuggestion(){
  const fromId = Number(document.getElementById('rec-tr-from').value);
  const toId = Number(document.getElementById('rec-tr-to').value);
  const fromAcc = getAccount(fromId), toAcc = getAccount(toId);
  const fromAmount = parseFloat(document.getElementById('rec-tr-amount-from').value);
  if(!fromAcc || !toAcc || !fromAmount) return;
  const crossRate = effectiveRate(fromAcc.currency) / effectiveRate(toAcc.currency);
  document.getElementById('rec-tr-amount-to').value = (fromAmount * crossRate).toFixed(2);
}

/* ================= Events: ledger delegation ================= */
function setupLedgerDelegation(){
  document.addEventListener('click', async (e)=>{
    const editTx = e.target.closest('[data-edit-tx]');
    if(editTx){
      const tx = state.transactions.find(t=>t.id===Number(editTx.dataset.editTx));
      if(tx) enterEditMode(tx);
      return;
    }
    const editTr = e.target.closest('[data-edit-transfer]');
    if(editTr){
      const tr = state.transfers.find(t=>t.id===Number(editTr.dataset.editTransfer));
      if(tr) enterTransferEditMode(tr);
      return;
    }
    const delTx = e.target.closest('[data-del-tx]');
    if(delTx){
      const id = Number(delTx.dataset.delTx);
      const tx = state.transactions.find(t=>t.id===id);
      if(!tx) return;
      state.transactions = state.transactions.filter(t=>t.id!==id);
      renderAll();
      scheduleDelete('Movimiento eliminado',
        async ()=>{
          await idb.delete('transactions', id);
          if(tx.debtId) await revertDebtEffect(tx.debtId, tx.debtEffect, tx.amount);
          await loadAll(); renderAll();
        },
        async ()=>{ await loadAll(); renderAll(); }
      );
      return;
    }
    const delTr = e.target.closest('[data-del-transfer]');
    if(delTr){
      const id = Number(delTr.dataset.delTransfer);
      const tr = state.transfers.find(t=>t.id===id);
      if(!tr) return;
      state.transfers = state.transfers.filter(t=>t.id!==id);
      renderAll();
      scheduleDelete('Transferencia eliminada',
        async ()=>{ await idb.delete('transfers', id); await loadAll(); renderAll(); },
        async ()=>{ await loadAll(); renderAll(); }
      );
      return;
    }
  });
}

/* ================= Events: filters ================= */
function setupFilters(){
  ['filter-account','filter-type','filter-category'].forEach(id=>{
    document.getElementById(id).addEventListener('change', filterAndRenderTx);
  });
}

/* ================= Events: accounts ================= */
function setupAccounts(){
  document.getElementById('account-sort').addEventListener('change', renderCuentas);

  document.getElementById('acc-type').addEventListener('change', (e)=>{
    const isCard = e.target.value==='tarjeta_credito';
    document.getElementById('acc-credit-limit-field').style.display = isCard ? 'flex' : 'none';
    document.getElementById('acc-card-cutoff-field').style.display = isCard ? 'flex' : 'none';
    document.getElementById('acc-card-payday-field').style.display = isCard ? 'flex' : 'none';
    document.getElementById('acc-card-autopay-field').style.display = isCard ? 'flex' : 'none';
  });

  document.getElementById('account-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('acc-name').value.trim();
    if(!name) return;
    const type = document.getElementById('acc-type').value;
    const isCard = type==='tarjeta_credito';
    const paydayVal = parseInt(document.getElementById('acc-card-payday').value, 10);
    if(isCard && document.getElementById('acc-card-payday').value && (isNaN(paydayVal) || paydayVal<1 || paydayVal>31)){ toast('El día de pago debe estar entre 1 y 31'); return; }
    const cutoffVal = parseInt(document.getElementById('acc-card-cutoff').value, 10);
    if(isCard && document.getElementById('acc-card-cutoff').value && (isNaN(cutoffVal) || cutoffVal<1 || cutoffVal>31)){ toast('El día de corte debe estar entre 1 y 31'); return; }
    const autopayVal = document.getElementById('acc-card-autopay').value;
    await idb.put('accounts', {
      name, type,
      currency: document.getElementById('acc-currency').value,
      country: document.getElementById('acc-country').value.trim(),
      creditLimit: isCard ? (parseFloat(document.getElementById('acc-credit-limit').value) || 0) : null,
      paymentDay: isCard && paydayVal>=1 && paydayVal<=31 ? paydayVal : null,
      cutoffDay: isCard && cutoffVal>=1 && cutoffVal<=31 ? cutoffVal : null,
      autopayAccountId: isCard && autopayVal ? Number(autopayVal) : null,
      lastAutopayGenerated: null,
      visible: true
    });
    await loadAll();
    await generateDueCardPayments();
    await loadAll(); renderAll();
    document.getElementById('acc-name').value=''; document.getElementById('acc-country').value=''; document.getElementById('acc-credit-limit').value=''; document.getElementById('acc-card-cutoff').value=''; document.getElementById('acc-card-payday').value=''; document.getElementById('acc-card-autopay').value='';
    document.getElementById('acc-credit-limit-field').style.display = 'none';
    document.getElementById('acc-card-payday-field').style.display = 'none';
    document.getElementById('acc-card-autopay-field').style.display = 'none';
    toast('Cuenta añadida');
  });

  document.addEventListener('click', async (e)=>{
    const tgl = e.target.closest('[data-toggle-visible]');
    if(tgl){
      const id = Number(tgl.dataset.toggleVisible);
      const acc = getAccount(id);
      await idb.put('accounts', {...acc, visible: !(acc.visible!==false)});
      await loadAll(); renderAll();
      return;
    }
    const moveBtn = e.target.closest('[data-move-account]');
    if(moveBtn){
      await moveAccount(Number(moveBtn.dataset.moveAccount), Number(moveBtn.dataset.dir));
      return;
    }
    const defaultBtn = e.target.closest('[data-set-default-account]');
    if(defaultBtn){
      const id = Number(defaultBtn.dataset.setDefaultAccount);
      for(const acc of state.accounts){
        if(acc.isDefault && acc.id!==id) await idb.put('accounts', {...acc, isDefault:false});
      }
      const target = getAccount(id);
      await idb.put('accounts', {...target, isDefault: !target.isDefault});
      await loadAll(); renderAll();
      toast(target.isDefault ? 'Ya no es tu cuenta preferida' : `${target.name} es ahora tu cuenta preferida`);
      return;
    }
    const delAcc = e.target.closest('[data-del-account]');
    if(delAcc){
      if(!confirm('¿Eliminar esta cuenta? Sus movimientos y transferencias asociados no se borrarán automáticamente.')) return;
      await idb.delete('accounts', Number(delAcc.dataset.delAccount));
      await loadAll(); renderAll();
      toast('Cuenta eliminada');
      return;
    }
    const toggleHidden = e.target.closest('#toggle-hidden-accts');
    if(toggleHidden){ state.showHiddenAccts = !state.showHiddenAccts; renderResumen(); return; }

    const editToggle = e.target.closest('[data-acct-edit-toggle]');
    if(editToggle){
      const id = editToggle.dataset.acctEditToggle;
      const row = document.getElementById('acct-edit-'+id);
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      return;
    }
    const editCancel = e.target.closest('[data-acct-edit-cancel]');
    if(editCancel){
      document.getElementById('acct-edit-'+editCancel.dataset.acctEditCancel).style.display = 'none';
      return;
    }
    const editSave = e.target.closest('[data-acct-edit-save]');
    if(editSave){
      const id = Number(editSave.dataset.acctEditSave);
      const acc = getAccount(id);
      const input = document.querySelector(`[data-acct-edit-input="${id}"]`);
      const newVal = parseFloat(input.value);
      if(isNaN(newVal)){ toast('Introduce un número válido'); return; }
      const current = accountBalance(id);
      const diff = Math.round((newVal - current) * 100) / 100;
      let balanceChanged = false;
      if(Math.abs(diff) >= 0.005){
        const kind = diff > 0 ? 'income' : 'expense';
        const cat = findCategoryByName('Ajuste', kind);
        await idb.put('transactions', {accountId:id, kind, amount:Math.abs(diff), categoryId: cat?cat.id:null, subcategory:'', date:todayISO(), note:'Ajuste de saldo'});
        balanceChanged = true;
      }
      const paydayInput = document.querySelector(`[data-acct-edit-payday="${id}"]`);
      let cardChanged = false;
      if(paydayInput){
        const autopayInput = document.querySelector(`[data-acct-edit-autopay="${id}"]`);
        const cutoffInput = document.querySelector(`[data-acct-edit-cutoff="${id}"]`);
        const paydayVal = parseInt(paydayInput.value, 10);
        if(paydayInput.value && (isNaN(paydayVal) || paydayVal<1 || paydayVal>31)){ toast('El día de pago debe estar entre 1 y 31'); return; }
        const cutoffVal = cutoffInput ? parseInt(cutoffInput.value, 10) : NaN;
        if(cutoffInput && cutoffInput.value && (isNaN(cutoffVal) || cutoffVal<1 || cutoffVal>31)){ toast('El día de corte debe estar entre 1 y 31'); return; }
        const autopayVal = autopayInput ? autopayInput.value : '';
        const newPayday = paydayVal>=1 && paydayVal<=31 ? paydayVal : null;
        const newCutoff = cutoffVal>=1 && cutoffVal<=31 ? cutoffVal : null;
        const newAutopay = autopayVal ? Number(autopayVal) : null;
        if(newPayday !== (acc.paymentDay||null) || newCutoff !== (acc.cutoffDay||null) || newAutopay !== (acc.autopayAccountId||null)){
          const cutoffChanged = newCutoff !== (acc.cutoffDay||null);
          await idb.put('accounts', {...acc, paymentDay:newPayday, cutoffDay:newCutoff, autopayAccountId:newAutopay, lastAutopayGenerated: cutoffChanged ? null : acc.lastAutopayGenerated});
          cardChanged = true;
        }
      }
      if(!balanceChanged && !cardChanged){ document.getElementById('acct-edit-'+id).style.display='none'; toast('Sin cambios'); return; }
      await loadAll();
      if(cardChanged) await generateDueCardPayments();
      await loadAll(); renderAll();
      toast('Cuenta actualizada');
      return;
    }
  });
}

/* ================= Events: budgets & categories ================= */
function setupBudgets(){
  document.getElementById('save-general-budget').addEventListener('click', async ()=>{
    const val = parseFloat(document.getElementById('general-budget-input').value) || 0;
    await idb.put('settings', {key:'generalBudget', value:val});
    state.generalBudget = val;
    renderAll();
    toast('Presupuesto general guardado');
  });

  document.getElementById('save-budgets').addEventListener('click', async ()=>{
    const inputs = document.querySelectorAll('[data-budget-cat]');
    for(const inp of inputs){
      const limit = parseFloat(inp.value) || 0;
      await idb.put('budgets', {categoryId: Number(inp.dataset.budgetCat), limit});
    }
    await loadAll(); renderAll();
    toast('Límites guardados');
  });

  document.getElementById('add-cat-expense').addEventListener('click', ()=> addCategory('expense'));
  document.getElementById('add-cat-income').addEventListener('click', ()=> addCategory('income'));

  async function addCategory(kind){
    const name = prompt('Nombre de la nueva categoría de ' + (kind==='expense'?'gasto':'ingreso') + ':');
    if(!name || !name.trim()) return;
    await idb.put('categories', {name:name.trim(), kind, subcategories:[], icon:'🏷️'});
    await loadAll(); renderAll();
    toast('Categoría añadida');
  }

  document.addEventListener('change', async (e)=>{
    const rename = e.target.closest('[data-rename-cat]');
    if(rename){
      const id = Number(rename.dataset.renameCat);
      const cat = getCategory(id);
      if(cat && rename.value.trim()){
        await idb.put('categories', {...cat, name: rename.value.trim()});
        await loadAll(); renderAll();
      }
    }
  });

  document.addEventListener('click', async (e)=>{
    const moveCat = e.target.closest('[data-move-cat]');
    if(moveCat){
      await moveCategory(Number(moveCat.dataset.moveCat), Number(moveCat.dataset.dir));
      return;
    }
    const delCat = e.target.closest('[data-del-cat]');
    if(delCat){
      if(!confirm('¿Eliminar esta categoría? Los movimientos que la usan mantendrán la referencia antigua.')) return;
      await idb.delete('categories', Number(delCat.dataset.delCat));
      await idb.delete('budgets', Number(delCat.dataset.delCat));
      await loadAll(); renderAll();
      return;
    }
    const addSub = e.target.closest('[data-add-subcat]');
    if(addSub){
      const catId = Number(addSub.dataset.addSubcat);
      const input = document.querySelector(`[data-new-subcat-input="${catId}"]`);
      const val = input.value.trim();
      if(!val) return;
      const cat = getCategory(catId);
      if(cat.subcategories.includes(val)) { toast('Esa subcategoría ya existe'); return; }
      await idb.put('categories', {...cat, subcategories:[...cat.subcategories, val]});
      await loadAll(); renderAll();
      return;
    }
    const delSub = e.target.closest('[data-del-subcat]');
    if(delSub){
      const [catId, subName] = delSub.dataset.delSubcat.split('|');
      const cat = getCategory(Number(catId));
      await idb.put('categories', {...cat, subcategories: cat.subcategories.filter(s=>s!==subName)});
      await loadAll(); renderAll();
      return;
    }
  });
}

/* ================= Events: ajustes ================= */
function setupAjustes(){
  document.getElementById('base-currency-select').addEventListener('change', async (e)=>{
    await idb.put('settings', {key:'baseCurrency', value:e.target.value});
    await loadAll(); renderAll();
    toast('Moneda base actualizada');
  });

  document.getElementById('dark-mode-toggle').addEventListener('change', async (e)=>{
    state.darkMode = e.target.checked;
    document.documentElement.classList.toggle('dark', state.darkMode);
    await idb.put('settings', {key:'darkMode', value:state.darkMode});
  });

  document.getElementById('text-scale-select').addEventListener('change', async (e)=>{
    state.textScale = Number(e.target.value);
    applyTextScale(state.textScale);
    await idb.put('settings', {key:'textScale', value:state.textScale});
  });

  document.addEventListener('click', async (e)=>{
    const swatch = e.target.closest('[data-accent]');
    if(swatch){
      const hex = swatch.dataset.accent;
      await idb.put('settings', {key:'accentColor', value:hex});
      state.accentColor = hex;
      applyAccent(hex);
      renderAjustes();
      toast('Color de acento actualizado');
    }
  });

  document.addEventListener('change', async (e)=>{
    const rateInput = e.target.closest('[data-rate]');
    if(rateInput){
      const cur = rateInput.dataset.rate;
      const val = parseFloat(rateInput.value);
      if(!val || val<=0) return;
      const newOverrides = {...state.rateOverrides, [cur]: val};
      await idb.put('settings', {key:'rateOverrides', value:newOverrides});
      await loadAll(); renderAll();
      toast('Tasa de cambio actualizada');
    }
  });

  document.getElementById('export-btn').addEventListener('click', async ()=>{
    const data = await buildBackupData();
    const filename = 'libro-finanzas-backup-' + todayISO() + '.json';
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const file = new File([blob], filename, {type:'application/json'});

    let shared = false;
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file], title:'Copia de seguridad de Libro'});
        shared = true;
      }catch(err){
        shared = false; // usuario canceló o falló; caemos a la descarga normal
      }
    }
    if(!shared){
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    await idb.put('settings', {key:'lastBackupDate', value: todayISO()});
    state.lastBackupDate = todayISO();
    dismissBackupReminder();
    renderAjustes();
    if(shared) toast('Copia de seguridad compartida');
    else toast('Copia de seguridad descargada');
  });

  document.getElementById('export-csv-btn').addEventListener('click', ()=>{
    const rows = [['Fecha','Tipo','Cuenta','Categoría','Subcategoría','Importe','Moneda','Nota']];
    mergedLedger().forEach(it=>{
      if(it.itemType==='transfer'){
        const from=getAccount(it.fromAccountId), to=getAccount(it.toAccountId);
        rows.push([it.date,'Transferencia', (from?from.name:'')+' → '+(to?to.name:''), '', '', it.fromAmount, from?from.currency:state.baseCurrency, it.note||'']);
      } else {
        const acc=getAccount(it.accountId), cat=getCategory(it.categoryId);
        rows.push([it.date, it.kind==='income'?'Ingreso':'Gasto', acc?acc.name:'', cat?cat.name:'', it.subcategory||'', it.amount, acc?acc.currency:state.baseCurrency, it.note||'']);
      }
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(["\uFEFF"+csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'libro-finanzas-movimientos-' + todayISO() + '.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('CSV descargado');
  });

  document.getElementById('export-pdf-btn').addEventListener('click', ()=>{
    const range = periodRange(state.movPeriod);
    const items = mergedLedger().filter(it => it.date >= range.start && it.date <= range.end);
    const rowsHtml = items.map(it=>{
      if(it.itemType==='transfer'){
        const from=getAccount(it.fromAccountId), to=getAccount(it.toAccountId);
        return `<tr><td>${it.date}</td><td>Transferencia</td><td>${escapeHtml((from?from.name:'')+' → '+(to?to.name:''))}</td><td></td><td style="text-align:right;">${fmtMoney(it.fromAmount, from?from.currency:state.baseCurrency)}</td></tr>`;
      }
      const acc=getAccount(it.accountId), cat=getCategory(it.categoryId);
      return `<tr><td>${it.date}</td><td>${it.kind==='income'?'Ingreso':'Gasto'}</td><td>${escapeHtml(cat?cat.name:'')}</td><td>${escapeHtml(it.note||'')}</td><td style="text-align:right;">${it.kind==='income'?'+':'-'}${fmtMoney(it.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</td></tr>`;
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Reporte Libro</title>
      <style>
        body{font-family:Arial,sans-serif; padding:30px; color:#222;}
        h1{font-size:20px;} p{color:#666; font-size:13px;}
        table{width:100%; border-collapse:collapse; margin-top:16px;}
        th,td{border-bottom:1px solid #ddd; padding:8px; text-align:left; font-size:13px;}
        th{background:#f4f4f4;}
      </style></head><body>
      <h1>Reporte de movimientos — Libro</h1>
      <p>Período: ${range.start} a ${range.end}</p>
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría / Cuentas</th><th>Nota</th><th>Importe</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="5">Sin movimientos en este período.</td></tr>'}</tbody></table>
      </body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  });

  document.getElementById('import-btn').addEventListener('click', ()=> document.getElementById('import-input').click());
  document.getElementById('import-input').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const data = JSON.parse(await file.text());
      await restoreFromBackupData(data);
      toast('Datos importados');
    }catch(err){ toast('No se pudo importar el archivo'); }
    e.target.value = '';
  });

  document.getElementById('reset-btn').addEventListener('click', async ()=>{
    if(!confirm('¿Seguro que quieres borrar todos tus datos? No se puede deshacer.')) return;
    await Promise.all(ALL_STORES_BACKUP.map(s=>idb.clear(s)));
    await seedIfEmpty();
    await loadAll(); renderAll();
    toast('Todos los datos han sido borrados');
  });

  setupOneDriveSync();
}

/* ================= Copia de seguridad: datos compartidos entre export/import y sync con OneDrive ================= */
const ALL_STORES_BACKUP = ['accounts','categories','transactions','transfers','budgets','settings','goals','recurring','reminders','debts','installments','shortcuts'];
async function buildBackupData(){
  const data = {};
  for(const s of ALL_STORES_BACKUP) data[s] = await idb.getAll(s);
  data.exportedAt = new Date().toISOString();
  return data;
}
async function restoreFromBackupData(data){
  await Promise.all(ALL_STORES_BACKUP.map(s=>idb.clear(s)));
  for(const s of ALL_STORES_BACKUP){
    for(const record of (data[s]||[])){
      await idb.put(s, record);
    }
  }
  await loadAll(); renderAll();
}

/* ================= Sincronización con carpeta local (OneDrive, Google Drive, etc.) ================= */
// Usa la File System Access API del navegador (Chrome/Edge) para leer y escribir directamente
// en un archivo dentro de una carpeta sincronizada localmente, sin exportar/importar a mano.
// El handle del archivo se guarda en el store local 'fileHandles' (no viaja en los backups JSON).
async function getSyncFileHandle(){
  const records = await idb.getAll('fileHandles');
  const rec = records.find(r=>r.key==='oneDriveSync');
  return rec ? rec.handle : null;
}
async function verifyFileHandlePermission(handle, mode){
  const opts = {mode};
  if((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
function renderOneDriveSyncCard(hasHandle, fileName){
  const card = document.getElementById('onedrive-sync-card');
  if(!card) return;
  const supported = 'showSaveFilePicker' in window;
  card.style.display = supported ? 'block' : 'none';
  if(!supported) return;
  document.getElementById('onedrive-sync-status').textContent = hasHandle
    ? `Sincronizando con: ${fileName}${state.lastOneDriveSync ? ' · última vez: '+state.lastOneDriveSync : ''}`
    : 'No has elegido ningún archivo todavía.';
  document.getElementById('onedrive-choose-btn').textContent = hasHandle ? 'Cambiar archivo' : 'Elegir archivo';
  document.getElementById('onedrive-push-btn').style.display = hasHandle ? 'inline-block' : 'none';
  document.getElementById('onedrive-pull-btn').style.display = hasHandle ? 'inline-block' : 'none';
}
async function refreshOneDriveSyncUI(){
  if(!('showSaveFilePicker' in window)) return;
  const handle = await getSyncFileHandle();
  renderOneDriveSyncCard(!!handle, handle ? handle.name : '');
}
function setupOneDriveSync(){
  if(!('showSaveFilePicker' in window)){
    const card = document.getElementById('onedrive-sync-card');
    if(card) card.style.display = 'none';
    return;
  }
  refreshOneDriveSyncUI();

  document.getElementById('onedrive-choose-btn').addEventListener('click', async ()=>{
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName: 'libro-finanzas-sync.json',
        types: [{description:'JSON', accept:{'application/json':['.json']}}]
      });
      const ok = await verifyFileHandlePermission(handle, 'readwrite');
      if(!ok){ toast('Permiso denegado para ese archivo'); return; }
      await idb.put('fileHandles', {key:'oneDriveSync', handle});
      // Primera vez: escribimos el estado actual para dejar el archivo listo.
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(await buildBackupData(), null, 2));
      await writable.close();
      state.lastOneDriveSync = new Date().toLocaleString('es-ES');
      await refreshOneDriveSyncUI();
      toast('Archivo de sincronización configurado');
    }catch(err){
      if(err.name !== 'AbortError') toast('No se pudo elegir el archivo');
    }
  });

  document.getElementById('onedrive-push-btn').addEventListener('click', async ()=>{
    const handle = await getSyncFileHandle();
    if(!handle){ toast('Elige primero un archivo'); return; }
    try{
      const ok = await verifyFileHandlePermission(handle, 'readwrite');
      if(!ok){ toast('Permiso denegado para ese archivo'); return; }
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(await buildBackupData(), null, 2));
      await writable.close();
      state.lastOneDriveSync = new Date().toLocaleString('es-ES');
      await refreshOneDriveSyncUI();
      toast('Sincronizado — datos subidos al archivo');
    }catch(err){ toast('No se pudo sincronizar'); }
  });

  document.getElementById('onedrive-pull-btn').addEventListener('click', async ()=>{
    const handle = await getSyncFileHandle();
    if(!handle){ toast('Elige primero un archivo'); return; }
    if(!confirm('Esto reemplaza todos tus datos actuales con los del archivo. ¿Seguro?')) return;
    try{
      const ok = await verifyFileHandlePermission(handle, 'read');
      if(!ok){ toast('Permiso denegado para ese archivo'); return; }
      const file = await handle.getFile();
      const data = JSON.parse(await file.text());
      await restoreFromBackupData(data);
      state.lastOneDriveSync = new Date().toLocaleString('es-ES');
      await refreshOneDriveSyncUI();
      toast('Datos cargados desde el archivo');
    }catch(err){ toast('No se pudo leer el archivo'); }
  });
}

/* ================= Init ================= */
function daysSince(dateStr){
  const then = new Date(dateStr + "T00:00:00");
  const now = new Date(todayISO() + "T00:00:00");
  return Math.round((now - then) / 86400000);
}

function dismissBackupReminder(){
  const el = document.getElementById('backup-reminder-banner');
  if(el) el.remove();
}

function checkBackupReminder(){
  if(state.backupReminderShown) return;
  if(state.transactions.length===0 && state.transfers.length===0) return;
  const overdue = !state.lastBackupDate || daysSince(state.lastBackupDate) >= 14;
  if(!overdue) return;
  state.backupReminderShown = true;
  const pageHead = document.querySelector('#view-resumen .page-head');
  if(!pageHead || document.getElementById('backup-reminder-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'backup-reminder-banner';
  banner.style.cssText = 'background:var(--gold-soft); border:1px solid var(--gold); color:var(--gold); border-radius:10px; padding:14px 16px; margin-bottom:20px; font-size:13.5px; line-height:1.5; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;';
  banner.innerHTML = `
    <span>${state.lastBackupDate ? 'Han pasado más de 14 días desde tu última copia de seguridad.' : 'Todavía no has hecho una copia de seguridad de tus datos.'} Te recomendamos exportarla.</span>
    <span style="display:flex; gap:8px; flex-shrink:0;">
      <button class="btn-secondary btn-sm" id="backup-reminder-export">Exportar ahora</button>
      <button class="btn-secondary btn-sm" id="backup-reminder-dismiss">Ahora no</button>
    </span>
  `;
  pageHead.after(banner);
  document.getElementById('backup-reminder-export').addEventListener('click', ()=>{
    document.querySelectorAll('.nav-btn[data-view="ajustes"]')[0].click();
    dismissBackupReminder();
  });
  document.getElementById('backup-reminder-dismiss').addEventListener('click', dismissBackupReminder);
}

function showFatalError(err){
  console.error(err);
  const content = document.querySelector('.content');
  const banner = document.createElement('div');
  banner.style.cssText = 'background:var(--over-soft); border:1px solid var(--over); color:var(--over); border-radius:10px; padding:16px 18px; margin-bottom:20px; font-size:13.5px; line-height:1.6;';
  banner.innerHTML = `
    <strong>No se pudo abrir el almacenamiento local de este dispositivo.</strong><br>
    Esto suele pasar cuando abres el archivo con doble clic directamente (algunos navegadores bloquean el guardado de datos en ese caso). Prueba una de estas opciones:<br>
    1) Ábrelo con Google Chrome si estás usando otro navegador.<br>
    2) Súbelo a un hosting como Netlify Drop y ábrelo desde esa dirección web — ahí funciona siempre sin problema.
  `;
  content.prepend(banner);
}

async function init(){
  setupNav();
  try{
    await openDB();
    await seedIfEmpty();
    await loadAll();
    applyAccent(state.accentColor);
    document.documentElement.classList.toggle('dark', state.darkMode);
    applyTextScale(state.textScale);
    await ensureAdjustmentCategories();
    await ensureCategoryIcons();
    await generateDueRecurring();
    await generateDueInstallments();
    await generateDueCardPayments();
    await loadAll();
    setupTxForm();
    setupQuickAdd();
    setupMasModals();
    setupShortcuts();
    setupIconPicker();
    setupLedgerDelegation();
    setupFilters();
    setupAccounts();
    setupBudgets();
    setupAjustes();
    setupGoals();
    setupRecurring();
    setupReminders();
    setupDebts();
    setupInstallments();
    setupSearch();
    document.getElementById('cashflow-range').addEventListener('change', renderCashflow);
    renderAll();
    checkBackupReminder();
  }catch(err){
    showFatalError(err);
  }
}
init();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
})();
