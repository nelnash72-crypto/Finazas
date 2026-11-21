/* ÍNDICE — secciones de este archivo, en orden (busca el título con Ctrl+F):
    1. IndexedDB
    2. Constants
    3. State
    4. Deshacer al borrar
    5. Currency helpers
    6. Data load
    7. Ciclos de tarjeta con ajuste manual
    8. Balances
    9. Period helpers
   10. Period bar component
   11. Rendering: Resumen
   12. Personalización de bloques del Resumen
   13. Gastos por ciclo (cada N días, renovación manual)
   14. Proyección de flujo de caja
   15. Gráfico de patrimonio: patrimonio neto, activos y deudas en el tiempo
   16. Barras: ingresos y gastos por día (mes actual / 30 días) o por mes (6 / 12 meses / todo)
   17. Ventana de detalle (al tocar totales/grupos)
   18. Constructores de la ventana de detalle: uno por tipo. Devuelven true si ya no hay que añadir el botón Volver
   19. Rendering: Movimientos
   20. Atajos de periodo (siempre con "Mes actual" junto a "30 días")
   21. Selección múltiple: cambiar categoría o cuenta, o eliminar varios a la vez
   22. Búsqueda: resultados extra en Más
   23. Rendering: Cuentas
   24. Rendering: Presupuestos
   25. Informe: tendencias por periodo y categoría
   26. Rendering: Más (metas, recurrentes, recordatorios, deudas, compras a plazos)
   27. Fraccionar un gasto de tarjeta en cuotas (p = 'qk' Añadir rápido, 'tx' Movimientos)
   28. Events: ciclos, recurrentes, recordatorios, deudas y compras a plazos
   29. Rendering: Ajustes
   30. Global render
   31. Events: nav
   32. Events: transactions form
   33. Pantallas vacías con acción
   34. Quick add (Resumen)
   35. Repetir último gasto
   36. Quick add (Resumen): categorías, subcategorías y formulario
   37. Events: ledger delegation
   38. Events: filters
   39. Events: accounts
   40. Events: budgets & categories
   41. Events: ajustes
   42. Copia de seguridad: datos compartidos entre export/import y sync con OneDrive
   43. Respaldo automático a carpeta (Chrome/Edge en laptop)
   44. Sincronización con carpeta local (OneDrive, Google Drive, etc.)
   45. Init
*/
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
  put: (s,v)=> p(tx(s,'readwrite').put(v)).then(r=>{ noteDataChanged(s); return r; }),
  delete: (s,k)=> p(tx(s,'readwrite').delete(k)).then(r=>{ noteDataChanged(s); return r; }),
  clear: (s)=> p(tx(s,'readwrite').clear()).then(r=>{ noteDataChanged(s); return r; }),
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
  lastAccountId:null,
  recDebtMode:'payment',
  goals:[], recurring:[], reminders:[], debts:[], installments:[], shortcuts:[],
  lastBackupDate:null, backupReminderShown:false, editingTxId:null, editingTransferId:null, accentColor:'#A5842E', darkMode:false, textScale:100, iconPickerTarget:null, generalBudget:0,
  finStartDay:12,
  resumenPeriod:{mode:'month', ref:todayISO()},
  movPeriod:{mode:'month', ref:todayISO()},
  movGroup:'date', selMode:false, sel:new Set(), collapsedCats:new Set(),
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
function fmtDateHeader(iso){
  const d = new Date(iso + "T00:00:00");
  const full = d.toLocaleDateString('es-ES', {day:'numeric', month:'long', year:'numeric'});
  const wd = d.toLocaleDateString('es-ES', {weekday:'short'}).replace(/\.$/, '');
  return `${full} (${wd})`;
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
  const incomeSetting = settings.find(s=>s.key==='monthlyIncome');
  state.monthlyIncome = incomeSetting ? incomeSetting.value : 0;
  state.budgetConfig = {}; state.budgets = {};
  budgets.forEach(b=>{
    const mode = b.mode || 'fixed';
    const value = (b.value !== undefined) ? b.value : (b.limit || 0);
    state.budgetConfig[b.categoryId] = {mode, value};
    state.budgets[b.categoryId] = mode==='percent' ? (value/100) * state.monthlyIncome : value;
  });
  const baseSetting = settings.find(s=>s.key==='baseCurrency');
  if(baseSetting) state.baseCurrency = baseSetting.value;
  const rateSetting = settings.find(s=>s.key==='rateOverrides');
  if(rateSetting) state.rateOverrides = rateSetting.value || {};
  const remDaysSetting = settings.find(s=>s.key==='backupReminderDays');
  state.backupReminderDays = remDaysSetting && [3,7,14,30].includes(Number(remDaysSetting.value)) ? Number(remDaysSetting.value) : 7;
  const backupSetting = settings.find(s=>s.key==='lastBackupDate');
  state.lastBackupDate = backupSetting ? backupSetting.value : null;
  const lastAccSetting = settings.find(s=>s.key==='lastAccountId');
  state.lastAccountId = lastAccSetting ? lastAccSetting.value : null;
  const generalBudgetSetting = settings.find(s=>s.key==='generalBudget');
  state.generalBudget = generalBudgetSetting ? generalBudgetSetting.value : 0;
  const accentSetting = settings.find(s=>s.key==='accentColor');
  state.accentColor = accentSetting ? accentSetting.value : ACCENT_PALETTE[0].accent;
  const darkSetting = settings.find(s=>s.key==='darkMode');
  state.darkMode = darkSetting ? darkSetting.value : false;
  const scaleSetting = settings.find(s=>s.key==='textScale');
  state.textScale = scaleSetting ? scaleSetting.value : 100;
  const finDaySetting = settings.find(s=>s.key==='finStartDay');
  state.finStartDay = finDaySetting ? clampFinDay(finDaySetting.value) : 12;
  const resumenLayoutSetting = settings.find(s=>s.key==='resumenLayout');
  state.resumenLayout = resumenLayoutSetting ? resumenLayoutSetting.value : defaultResumenLayout();
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
function sortedAccounts(){
  return state.accounts.slice().sort((a,b)=> (a.order??a.id) - (b.order??b.id));
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
    if(r.frequency==='cycle'){ if(r.autoCharge) await generateAutoCycle(r); continue; }  // los de ciclo sin débito automático se registran a mano
    let next = r.lastGenerated ? nextRecurringDate(r.lastGenerated, r.frequency) : r.startDate;
    let iterations = 0;
    let changed = false;
    while(next && next <= today && iterations < 36){
      if(r.isTransfer){
        const transferRecord = {fromAccountId:r.fromAccountId, toAccountId:r.toAccountId, fromAmount:r.fromAmount, toAmount:r.toAmount, date:next, note:(r.note ? r.note+' · ' : '')+'Recurrente'};
        transferRecord.id = await idb.put('transfers', transferRecord);
        state.transfers.push(transferRecord);
      } else {
        const txRecord = {accountId:r.accountId, kind:r.kind, amount:r.amount, categoryId:r.categoryId, subcategory:r.subcategory||'', date:next, note:(r.note ? r.note+' · ' : '')+'Recurrente', debtId:r.debtId||null, debtEffect:r.debtId?(r.debtEffect||'payment'):null, source:'recurring'};
        txRecord.id = await idb.put('transactions', txRecord);
        state.transactions.push(txRecord);
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

/* Cada N días con débito automático: se registra en cada fecha programada (nextDue) y el siguiente cobro
   se cuenta desde esa fecha programada, no desde el día en que se abre la app (así no se acumula desfase). */
async function generateAutoCycle(r){
  if(r.isTransfer) return;
  const today = todayISO();
  const days = Math.max(1, Number(r.cycleDays)||30);
  let next = cycleNextDue(r);
  let iterations = 0, changed = false;
  while(next && next <= today && iterations < 60){
    const txRecord = {accountId:r.accountId, kind:r.kind, amount:r.amount, categoryId:r.categoryId, subcategory:r.subcategory||'', date:next, note:(r.note ? r.note+' · ' : '')+'Recurrente', debtId:r.debtId||null, debtEffect:r.debtId?(r.debtEffect||'payment'):null, source:'recurring'};
    txRecord.id = await idb.put('transactions', txRecord);
    state.transactions.push(txRecord);
    if(r.debtId) await applyDebtEffect(r.debtId, r.debtEffect||'payment', r.amount);
    r.lastGenerated = next;
    next = addDaysISO(next, days);
    r.nextDue = next;
    changed = true; iterations++;
  }
  if(changed) await idb.put('recurring', r);
}

/* Siguiente cuota: mismo día de cada mes (el día de inicio), ajustado a fin de mes si no existe (29/30/31) */
function installmentNextDate(it, fromISO){
  return nextMonthlyOnDay(fromISO, Number((it.startDate || fromISO).slice(8,10)));
}
/* Modelo con cuotas iniciales (creado desde Fraccionar): las primeras `initialCount` cuotas caen en startDate
   y las demás, una al mes, el día `payDay` (la primera, el primer día `payDay` posterior a startDate).
   Las compras a plazos antiguas no tienen payDay y siguen el cálculo de siempre. */
function installmentDateAt(it, idx){
  const k = Math.max(1, Number(it.initialCount)||1);
  if(idx < k) return it.startDate;
  const s0 = new Date(it.startDate+'T00:00:00');
  const y = s0.getFullYear();
  let m = s0.getMonth();
  if(dateForDayInMonth(y, m, it.payDay) <= s0) m++;
  return localISO(dateForDayInMonth(y, m + (idx-k), it.payDay));
}
function installmentUpcomingDate(it){
  if(it.payDay) return installmentDateAt(it, it.paidInstallments);
  return it.lastGenerated ? installmentNextDate(it, it.lastGenerated) : it.startDate;
}
function installmentAfter(it, prevISO, nextIdx){
  return it.payDay ? installmentDateAt(it, nextIdx) : installmentNextDate(it, prevISO);
}
async function generateDueInstallments(){
  const today = todayISO();
  for(const it of state.installments){
    if(it.active===false) continue;
    if(it.paidInstallments >= it.totalInstallments){ it.active=false; await idb.put('installments', it); continue; }
    let next = installmentUpcomingDate(it);
    let iterations = 0;
    let changed = false;
    while(next && next <= today && it.paidInstallments < it.totalInstallments && iterations < 36){
      const cuotaAmount = installmentAmountFor(it, it.paidInstallments);
      it.paidInstallments++;
      const txRecord = {accountId:it.accountId, kind:'expense', amount:cuotaAmount, categoryId:it.categoryId, subcategory:it.subcategory||'', date:next, note:`${it.name} · Cuota ${it.paidInstallments}/${it.totalInstallments}`, debtId:it.debtId||null, source:'installment'};
      txRecord.id = await idb.put('transactions', txRecord);
      state.transactions.push(txRecord);
      if(it.debtId) await applyDebtPayment(it.debtId, cuotaAmount);
      it.lastGenerated = next;
      next = installmentAfter(it, next, it.paidInstallments);
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
/* ===== Ciclos de tarjeta con ajuste manual =====
   t.cycleShift: +1 = el movimiento pasó al ciclo siguiente (aunque la fecha caiga en el corte); -1 = cuenta en el ciclo anterior. */
function cardPrevCutoff(a, cutoffISO){
  const d = new Date(cutoffISO+'T00:00:00');
  return localISO(dateForDayInMonth(d.getFullYear(), d.getMonth()-1, cutoffDayFor(a)));
}
function cardNaturalCutoff(a, dateISO){
  const cd = cutoffDayFor(a);
  const d = new Date(dateISO+'T00:00:00');
  let cutoff = localISO(dateForDayInMonth(d.getFullYear(), d.getMonth(), cd));
  if(cutoff < dateISO) cutoff = nextMonthlyOnDay(cutoff, cd);
  return cutoff;
}
function cardTxCutoff(a, t){
  let c = cardNaturalCutoff(a, t.date);
  const sh = t.cycleShift || 0;
  if(sh>0) c = nextMonthlyOnDay(c, cutoffDayFor(a));
  else if(sh<0) c = cardPrevCutoff(a, c);
  return c;
}
/* Saldo de la tarjeta al corte, respetando los movimientos que el usuario movió de ciclo */
function cardBalanceAtCutoff(a, cutoffISO){
  let bal = accountBalanceAsOf(a.id, cutoffISO);
  if(!cutoffDayFor(a)) return bal;
  state.transactions.forEach(t=>{
    if(t.accountId!==a.id || !t.cycleShift) return;
    const eff = t.kind==='income' ? t.amount : -t.amount;
    const cyc = cardTxCutoff(a, t);
    if(t.date <= cutoffISO && cyc > cutoffISO) bal -= eff;       // se movió a un ciclo posterior
    else if(t.date > cutoffISO && cyc <= cutoffISO) bal += eff;  // se movió a este ciclo o a uno anterior
  });
  return bal;
}
function cardCycleSummary(a){
  if(!a || a.type!=='tarjeta_credito' || !a.paymentDay) return null;
  const today = todayISO(), cd = cutoffDayFor(a);
  const A = cardNextCycle(a, today);
  const bal = accountBalance(a.id);
  if(A.cutoff > today){
    return {billed:0, billedCutoff:null, billedPay:null, current:Math.max(0,-bal), cutoff:A.cutoff, pay:A.paymentDate};
  }
  const atCut = cardBalanceAtCutoff(a, A.cutoff);
  const nextCut = nextMonthlyOnDay(A.cutoff, cd);
  return {billed:Math.max(0,-atCut), billedCutoff:A.cutoff, billedPay:A.paymentDate,
          current:Math.max(0, -(bal-atCut)), cutoff:nextCut, pay:paymentDateForCutoff(nextCut, a.paymentDay)};
}
function cardCycleLine(a){
  const c = cardCycleSummary(a); if(!c) return '';
  const cur = a.currency;
  const parts = [];
  if(c.billedCutoff) parts.push(`✂ Facturado (corte ${fmtDate(c.billedCutoff)}): <strong>${fmtMoney(c.billed, cur)}</strong> · se paga el ${fmtDate(c.billedPay)}`);
  parts.push(`${c.billedCutoff?'Ciclo nuevo':'Ciclo en curso'} (corte ${fmtDate(c.cutoff)}): <strong>${fmtMoney(c.current, cur)}</strong> · se paga el ${fmtDate(c.pay)}`);
  return parts.join('<br>');
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
      const used = Math.max(0, -cardBalanceAtCutoff(a, nextCutoff));
      if(used > 0.004){
        const crossRate = effectiveRate(fromAcc.currency) / effectiveRate(a.currency);
        const fromAmount = Math.round((used / crossRate) * 100) / 100;
        const transferRecord = {fromAccountId:a.autopayAccountId, toAccountId:a.id, fromAmount, toAmount:used, date:paymentDate, note:'Pago automático tarjeta · '+a.name};
        transferRecord.id = await idb.put('transfers', transferRecord);
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

/* ================= Tarjeta: en qué mes se paga lo gastado ================= */
// Los gastos se muestran por fecha de compra (mes calendario). Esto añade una referencia: de lo gastado con tarjeta
// en un periodo, cuánto ya pasó el corte y se paga después, y cuánto se paga dentro del periodo por compras anteriores.
function cardPayInfo(t){
  if(t.kind!=='expense') return null;
  const a = getAccount(t.accountId);
  if(!a || a.type!=='tarjeta_credito' || !a.paymentDay) return null;
  const cutoff = cardTxCutoff(a, t);
  return {acc:a, cutoff, pay: paymentDateForCutoff(cutoff, a.paymentDay)};
}
function cardCashView(start, end){
  const v = {later:0, laterByMonth:{}, laterByCat:{}, laterItems:[], sameRange:0, paidBefore:0, paidBeforeGroups:{}, laterGroups:{}, cardTotal:0};
  const grp = (map, info, amt)=>{
    const k = info.acc.id+'|'+info.cutoff;
    if(!map[k]) map[k] = {acc:info.acc, cutoff:info.cutoff, pay:info.pay, total:0};
    map[k].total += amt;
  };
  state.transactions.forEach(t=>{
    const info = cardPayInfo(t); if(!info) return;
    const amt = toBase(t.amount, info.acc.currency);
    const inRange = t.date>=start && t.date<=end;
    const payInRange = info.pay>=start && info.pay<=end;
    if(inRange){
      v.cardTotal += amt;
      if(info.pay > end){
        v.later += amt;
        const ym = info.pay.slice(0,7);
        v.laterByMonth[ym] = (v.laterByMonth[ym]||0) + amt;
        v.laterByCat[t.categoryId] = (v.laterByCat[t.categoryId]||0) + amt;
        v.laterItems.push(t);
        grp(v.laterGroups, info, amt);
      } else if(payInRange) v.sameRange += amt;
    } else if(t.date < start && payInRange){
      v.paidBefore += amt;
      grp(v.paidBeforeGroups, info, amt);
    }
  });
  return v;
}
function cardMonthLabel(ym){
  const d = new Date(ym+'-01T00:00:00');
  const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('es-ES', same ? {month:'short'} : {month:'short', year:'2-digit'}).replace('.','');
}
function cardCashLineHtml(start, end){
  const v = cardCashView(start, end);
  if(v.later<=0.004 && v.paidBefore<=0.004) return '';
  const parts = [];
  if(v.later>0.004){
    const months = Object.keys(v.laterByMonth).sort().map(ym=>`${cardMonthLabel(ym)} ${fmtMoney(v.laterByMonth[ym])}`).join(' · ');
    parts.push(`💳 Con tarjeta, <strong>${fmtMoney(v.later)}</strong> de estos gastos se paga después (${months})`);
  }
  if(v.paidBefore>0.004) parts.push(`en este periodo también pagas <strong>${fmtMoney(v.paidBefore)}</strong> de compras anteriores`);
  return parts.join(' · ') + ' <span class="card-cash-more">Ver detalle ›</span>';
}
function renderCardCashLine(elId, start, end, detailReq){
  const el = document.getElementById(elId); if(!el) return;
  const html = cardCashLineHtml(start, end);
  el.style.display = html ? '' : 'none';
  el.innerHTML = html;
  if(html){ el.dataset.detail = 'cardcash'; el.dataset.detailStart = start; el.dataset.detailEnd = end; }
}
function detail_cardcash(req, d){
  const v = cardCashView(req.start, req.end);
  d.title = '💳 Tarjeta: en qué mes se paga';
  d.summary = `Gastos con tarjeta en el periodo: <strong style="color:var(--text);">${fmtMoney(v.cardTotal)}</strong>`
    + `<div style="margin-top:4px;">${fmtDate(req.start)} – ${fmtDate(req.end)}</div>`;
  const rows = (map)=> Object.values(map).sort((a,b)=>a.pay.localeCompare(b.pay)).map(g=>
    `<div class="detail-kv-row"><span>${escapeHtml(g.acc.name)} <span class="muted">· corte ${fmtDate(g.cutoff)} · se paga ${fmtDate(g.pay)}</span></span><span>${fmtMoney(g.total, state.baseCurrency)}</span></div>`).join('');
  let html = '';
  html += `<div class="cmp-sep">Compras de este periodo que se pagan después · ${fmtMoney(v.later)}</div>`;
  html += v.later>0.004 ? `<div class="detail-kv">${rows(v.laterGroups)}</div>` : '<div class="empty-note">Ninguna: todo lo de tarjeta se paga dentro del periodo.</div>';
  html += `<div class="cmp-sep">Compras de este periodo que se pagan dentro de él · ${fmtMoney(v.sameRange)}</div>`;
  if(v.paidBefore>0.004){
    html += `<div class="cmp-sep">Compras de antes del periodo que pagas dentro de él · ${fmtMoney(v.paidBefore)}</div><div class="detail-kv">${rows(v.paidBeforeGroups)}</div>`;
  }
  d.html = html;
  d.list = sortLedgerDesc(v.laterItems);
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
const TREND_OPTIONS = [{key:'month', label:'Mes actual', phrase:'este mes'}, {key:'30', label:'30 días', phrase:'30 días'}, {key:'90', label:'90 días', phrase:'90 días'}, {key:'365', label:'1 año', phrase:'1 año'}];
const NW_OPTIONS = TREND_OPTIONS.concat([{key:'all', label:'Todo', phrase:'todo el historial'}]);
function firstActivityDate(){
  let first = todayISO();
  state.transactions.forEach(t=>{ if(t.date && t.date < first) first = t.date; });
  (state.transfers||[]).forEach(t=>{ if(t.date && t.date < first) first = t.date; });
  return first;
}
function trendKeyToDays(key){
  if(key==='all'){
    const a = new Date(firstActivityDate()+'T00:00:00'), b = new Date(todayISO()+'T00:00:00');
    return Math.max(2, Math.round((b-a)/86400000)+1);
  }
  if(key==='month') return Math.max(2, Number(todayISO().slice(8,10)));  // del día 1 a hoy (mín. 2 puntos)
  return Number(key);
}
function getTrendKey(){
  let k = '30';
  try{ k = localStorage.getItem('libro_trend_days') || '30'; }catch(e){}
  return TREND_OPTIONS.some(o=>o.key===k) ? k : '30';
}
function computeBalanceTrend(days){
  // máximo ~120 puntos: en rangos largos se toma un punto cada varios días (el último siempre es hoy)
  const step = Math.max(1, Math.ceil(days/120));
  const points = [];
  const today = new Date(todayISO()+"T00:00:00");
  for(let i=days-1;i>=0;i-=step){
    const d = new Date(today);
    d.setDate(d.getDate()-i);
    const iso = toISO(d);
    points.push({date: iso, v: totalBalanceBaseAsOf(iso)});
  }
  if(((days-1) % step) !== 0) points.push({date: todayISO(), v: totalBalanceBaseAsOf(todayISO())});
  return points;
}
let trendModel = null;
function trendHeadDefault(){
  const m = trendModel; if(!m) return '';
  const diff = m.last - m.first;
  const pct = m.first !== 0 ? (diff/Math.abs(m.first))*100 : null;
  const sign = diff>=0 ? '+' : '−';
  const label = TREND_OPTIONS.find(o=>o.key===m.key).phrase;
  return `<span class="${diff<0?'down':'up'}">${diff>=0?'▲':'▼'} ${sign}${fmtMoney(Math.abs(diff))}` + (pct!==null ? ` · ${sign}${Math.abs(pct).toFixed(1).replace('.',',')} %` : '') + `</span> <span class="trend-period">en ${label}</span>`;
}
function renderBalanceTrend(){
  const svg = document.getElementById('balance-trend');
  if(!svg) return;
  const key = getTrendKey();
  const days = trendKeyToDays(key);
  const points = computeBalanceTrend(days);
  const W = Math.max(200, Math.round(svg.getBoundingClientRect().width) || 300), H = 110, padX = 4, padTop = 10, padBot = 8;
  const vals = points.map(p=>p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max-min) || 1;
  const stepX = points.length>1 ? (W-2*padX)/(points.length-1) : 0;
  const coords = points.map((p,i)=>[padX + i*stepX, H-padBot - ((p.v-min)/range)*(H-padTop-padBot)]);
  const linePath = coords.map((c,i)=> (i===0?'M':'L')+c[0].toFixed(1)+','+c[1].toFixed(1)).join(' ');
  const fillPath = linePath + ` L${coords[coords.length-1][0].toFixed(1)},${H-padBot} L${coords[0][0].toFixed(1)},${H-padBot} Z`;
  const first = vals[0], last = vals[vals.length-1];
  const up = last >= first;
  trendModel = {key, days, points, coords, first, last, W, H};
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.classList.toggle('down', !up);
  svg.classList.toggle('neg', last < 0);
  const baseY = coords[0][1].toFixed(1);
  svg.innerHTML = `<defs><linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="trend-stop" stop-opacity="0.28"/><stop offset="1" class="trend-stop" stop-opacity="0"/></linearGradient></defs>`
    + `<line class="trend-base" x1="${padX}" x2="${W-padX}" y1="${baseY}" y2="${baseY}"></line>`
    + `<path class="trend-fill" d="${fillPath}"></path><path class="trend-line" d="${linePath}"></path>`
    + `<g class="trend-scrub" style="display:none"><line class="trend-cursor" y1="0" y2="${H}"></line><circle class="trend-dot" r="4.5"></circle></g>`;
  const head = document.getElementById('trend-head');
  if(head) head.innerHTML = trendHeadDefault();
  const chips = document.getElementById('trend-chips');
  if(chips){
    chips.innerHTML = TREND_OPTIONS.map(o=>`<button type="button" class="date-chip${o.key===key?' active':''}" data-trend-days="${o.key}">${o.label}</button>`).join('');
  }
  const info = document.getElementById('trend-info');
  if(info){
    info.innerHTML = `<span>${fmtDate(points[0].date)}</span><span>Hoy</span>`;
  }
}
function trendScrub(e){
  const m = trendModel, svg = document.getElementById('balance-trend');
  if(!m || !svg) return;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / (rect.width || 1)) * m.W;
  let idx = Math.round((x - 4) / ((m.W-8) / Math.max(1, m.points.length-1)));
  idx = Math.max(0, Math.min(m.points.length-1, idx));
  const [cx, cy] = m.coords[idx], p = m.points[idx];
  const g = svg.querySelector('.trend-scrub');
  g.style.display = '';
  g.querySelector('.trend-cursor').setAttribute('x1', cx); g.querySelector('.trend-cursor').setAttribute('x2', cx);
  const dot = g.querySelector('.trend-dot'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
  const d = new Date(p.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'short', day:'numeric', month:'short', year:'numeric'});
  document.getElementById('trend-head').innerHTML = `<span class="trend-hover">${fmtMoney(p.v)}</span> <span class="trend-period">${d}</span>`;
}
function trendScrubEnd(){
  const svg = document.getElementById('balance-trend');
  if(!svg) return;
  const g = svg.querySelector('.trend-scrub'); if(g) g.style.display = 'none';
  const head = document.getElementById('trend-head'); if(head) head.innerHTML = trendHeadDefault();
}
function setupTrendScrub(){
  document.addEventListener('pointerdown', (e)=>{
    const svg = e.target.closest && e.target.closest('#balance-trend');
    if(!svg) return;
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    trendScrub(e);
  });
  document.addEventListener('pointermove', (e)=>{
    const svg = document.getElementById('balance-trend');
    if(!svg) return;
    if(e.pointerType==='mouse' || svg.hasPointerCapture?.(e.pointerId)){
      if(e.pointerType==='mouse' && !(e.target.closest && e.target.closest('#balance-trend'))) return;
      trendScrub(e);
    }
  });
  ['pointerup','pointercancel'].forEach(t=> document.addEventListener(t, trendScrubEnd));
  document.addEventListener('pointerout', (e)=>{ if(e.pointerType==='mouse' && e.target.id==='balance-trend') trendScrubEnd(); });
  let rt; window.addEventListener('resize', ()=>{ clearTimeout(rt); rt = setTimeout(renderBalanceTrend, 150); });
}

/* ================= Period helpers ================= */
function startOfWeek(d){ const dt=new Date(d); const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); dt.setHours(0,0,0,0); return dt; }
function endOfWeek(d){ const s=startOfWeek(d); const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e; }
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999); }
function startOfYear(d){ return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d){ return new Date(d.getFullYear(), 11, 31, 23,59,59,999); }
function toISO(d){ return localISO(d); }

/* Mes financiero: empieza el día finStartDay (ej. 12) y termina el día anterior del mes siguiente (11) */
function clampFinDay(v){ v = Math.round(Number(v)); return (v>=1 && v<=28) ? v : 12; }
function finMonthRange(refISO){
  const ref = new Date(refISO + "T00:00:00"), sd = clampFinDay(state.finStartDay);
  let y = ref.getFullYear(), m = ref.getMonth();
  if(ref.getDate() < sd) m--;
  return {start: toISO(new Date(y, m, sd)), end: toISO(new Date(y, m+1, sd-1))};
}
function periodRange(period){
  if(period.mode === 'fmonth') return finMonthRange(period.ref);
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
  if(period.mode==='fmonth'){ const r = finMonthRange(period.ref); const f = x=>new Date(x+'T00:00:00').toLocaleDateString('es-ES',{day:'2-digit',month:'short'}); return f(r.start)+' – '+f(r.end)+' '+r.end.slice(0,4); }
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
  else if(period.mode==='fmonth'){ const st = new Date(finMonthRange(period.ref).start+'T00:00:00'); st.setMonth(st.getMonth()+dir); return {...period, ref: toISO(st)}; }
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
  renderResumenBlocksContainer();
  renderShortcutsRow();
  const includeHidden = state.showHiddenAccts;

  const balEl = document.getElementById('stat-balance');
  if(balEl){
    const bal = totalBalanceBase(false);
    balEl.textContent = fmtMoney(bal);
    balEl.classList.toggle('neg', bal<0);
    document.getElementById('balance-sub').textContent = 'En ' + (CURRENCY_META[state.baseCurrency]?.name || state.baseCurrency);
    renderBalanceTrend();
    const miniEl = document.getElementById('accounts-mini');
    miniEl.innerHTML = '';
    sortedAccounts().filter(a => includeHidden || a.visible !== false).forEach(a=>{
      const row = document.createElement('div');
      row.className = 'acct-mini-row';
      row.dataset.detail = 'acct'; row.dataset.detailId = a.id; row.style.cursor = 'pointer';
      row.innerHTML = `<span class="name">${escapeHtml(a.name)} ${a.visible===false?'<span style="color:var(--text-faint); font-weight:400;">(oculta)</span>':''}</span><span class="amt">${fmtMoney(accountBalance(a.id), a.currency)}</span>`;
      miniEl.appendChild(row);
    });
    document.getElementById('toggle-hidden-accts').textContent = includeHidden ? 'Ocultar cuentas ocultas' : 'Mostrar cuentas ocultas';
  }

  renderNetWorth();
  renderPaymentAlerts();
  renderCashflow();

  const now = new Date();
  const mStart = toISO(startOfMonth(now)), mEnd = toISO(endOfMonth(now));
  const monthExpenses = txInRange(state.transactions, mStart, mEnd).filter(t=>t.kind==='expense');

  if(document.getElementById('resumen-general-budget')){
    renderGeneralBudget(monthExpenses, 'resumen-general-budget', computeMonthFixedProjection(mStart, mEnd));
  }
  const budgetsEl = document.getElementById('resumen-budgets');
  if(budgetsEl){
    const spendByCat = {};
    monthExpenses.forEach(t=>{ const acc=getAccount(t.accountId); const amt = toBase(t.amount, acc?acc.currency:state.baseCurrency); spendByCat[t.categoryId] = (spendByCat[t.categoryId]||0)+amt; });
    const budgetCats = Object.keys(state.budgets).filter(cid => state.budgets[cid] > 0);
    budgetsEl.innerHTML = '';
    if(budgetCats.length===0){
      budgetsEl.innerHTML = emptyState('🎯','Sin presupuestos','Fija un límite por categoría y verás aquí cuánto llevas gastado.','Ir a Presupuestos','goto-presupuestos');
    } else {
      budgetCats.slice(0,5).forEach(cid=>{
        const cat = getCategory(Number(cid));
        if(!cat) return;
        budgetsEl.appendChild(budgetRowEl(catIcon(cat)+' '+cat.name, spendByCat[cid]||0, state.budgets[cid], cat.id));
      });
    }
  }

  if(document.getElementById('resumen-period')){
    renderPeriodBar('resumen-period', 'resumenPeriod', renderResumen);
    renderFinMonthRow();
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
    renderCardCashLine('card-cash-line', range.start, range.end);
    renderIncomeSplit(periodTx, income, expense);

    const compareEl = document.getElementById('stat-compare');
    if(state.resumenPeriod.mode === 'month' || state.resumenPeriod.mode === 'fmonth'){
      const isFin = state.resumenPeriod.mode === 'fmonth';
      const ref = new Date(state.resumenPeriod.ref + "T00:00:00");
      const prevRef = new Date(ref.getFullYear(), ref.getMonth()-1, 1);
      const prevFin = isFin ? finMonthRange(navigatePeriod(state.resumenPeriod, -1).ref) : null;
      const pStart = isFin ? prevFin.start : toISO(startOfMonth(prevRef)), pEnd = isFin ? prevFin.end : toISO(endOfMonth(prevRef));
      const prevExpenses = txInRange(state.transactions, pStart, pEnd).filter(t=>t.kind==='expense')
        .reduce((s,t)=>{ const acc=getAccount(t.accountId); return s + toBase(t.amount, acc?acc.currency:state.baseCurrency); }, 0);
      if(prevExpenses > 0){
        const diffPct = ((expense - prevExpenses) / prevExpenses) * 100;
        const arrow = diffPct > 0 ? '▲' : (diffPct < 0 ? '▼' : '·');
        compareEl.textContent = `${arrow} ${Math.abs(diffPct).toFixed(0)}% en gastos vs ${isFin?'mes financiero anterior':'mes anterior'}`;
        compareEl.style.color = diffPct > 0 ? 'var(--over)' : 'var(--teal)';
        if(isFin){ delete compareEl.dataset.detail; compareEl.style.cursor = ''; compareEl.style.textDecoration = ''; }
        else {
        compareEl.dataset.detail = 'cmp';
        compareEl.style.cursor = 'pointer';
        compareEl.style.textDecoration = 'underline dotted var(--rule-strong)';
        compareEl.style.textUnderlineOffset = '4px';
        }
      } else {
        compareEl.textContent = '';
        delete compareEl.dataset.detail;
      }
    } else {
      compareEl.textContent = '';
      delete compareEl.dataset.detail;
    }

    renderChart('resumen-chart', catSpend, periodTx);
  }

  const recentEl = document.getElementById('resumen-recent');
  if(recentEl){
    const recentItems = mergedLedger().slice(0,6);
    if(recentItems.length===0){
      recentEl.innerHTML = state.accounts.length===0 ? emptyState('🏦','Empieza creando una cuenta','Una cuenta puede ser efectivo, un banco o una tarjeta. Luego podrás registrar movimientos.','Crear cuenta','goto-cuentas') : emptyState('📝','Aún no hay movimientos','Registra tu primer gasto o ingreso; solo toma unos segundos.','Añadir movimiento','add-tx');
    } else {
      renderLedgerList(recentEl, recentItems);
    }
  }
}

/* ================= Personalización de bloques del Resumen ================= */
const RESUMEN_BLOCKS_META = [
  {id:'saldo', label:'Saldo total'},
  {id:'presupuestos', label:'Presupuestos de este mes'},
  {id:'avisos', label:'Avisos (tarjeta y renovaciones)'},
  {id:'patrimonio', label:'Patrimonio neto'},
  {id:'ingresos-gastos', label:'Ingresos y gastos'},
  {id:'barras', label:'Ingresos y gastos por mes (barras)'},
  {id:'flujo-caja', label:'Proyección de flujo de caja'},
  {id:'movimientos', label:'Últimos movimientos'}
];
const RESUMEN_BLOCK_HTML = {
  saldo: `<div class="card">
      <div class="balance-label">Saldo total</div>
      <div class="balance-num" id="stat-balance">€0,00</div>
      <div class="balance-sub" id="balance-sub"></div>
      <div class="trend-head" id="trend-head"></div>
      <svg class="balance-trend" id="balance-trend" viewBox="0 0 300 110"></svg>
      <div class="trend-info" id="trend-info"></div>
      <div class="date-chip-row trend-chips" id="trend-chips"></div>
      <div class="accounts-mini" id="accounts-mini"></div>
      <button class="link-btn" id="toggle-hidden-accts">Mostrar cuentas ocultas</button>
    </div>`,
  presupuestos: `<div class="card">
      <div class="section-title" style="margin-bottom:10px;">Presupuestos de este mes</div>
      <div id="resumen-general-budget" style="margin-bottom:14px;"></div>
      <div id="resumen-budgets"></div>
    </div>`,
  avisos: `<div class="card" id="card-payment-alerts" style="display:none;">
      <div class="section-title">Avisos</div>
      <div id="payment-alerts-list"></div>
    </div>`,
  patrimonio: `<div class="card">
      <div class="section-title">Patrimonio neto <span class="muted">Incluye cuentas ocultas</span></div>
      <div class="balance-num" id="networth-total" style="font-size:26px; margin-bottom:4px;">€0,00</div>
      <div class="stat-sub" id="networth-note" style="display:none; margin-bottom:6px;"></div>
      <div class="trend-head" id="nw-head"></div>
      <svg class="balance-trend nw-chart" id="nw-chart" viewBox="0 0 300 130"></svg>
      <div class="trend-info" id="nw-info"></div>
      <div class="date-chip-row trend-chips" id="nw-chips"></div>
      <div class="nw-legend" id="nw-legend"></div>
      <div id="networth-breakdown" style="margin-top:14px;"></div>
      <div class="split-row" id="nw-extras-row" style="display:none; margin-top:14px;"><div><div class="settings-label" style="font-size:13.5px;">Incluir cuotas y deudas pendientes</div><div class="settings-desc" style="margin-top:2px;">Suma lo que debes y resta lo que aún pagarás</div></div><label class="switch"><input type="checkbox" id="nw-extras-toggle"><span class="switch-slider"></span></label></div>
    </div>`,
  'ingresos-gastos': `<div class="card">
      <div class="section-title">Ingresos y gastos</div>
      <div class="period-bar" id="resumen-period"></div>
      <div class="grid-3" style="margin-bottom:22px;">
        <div data-detail="pinc" style="cursor:pointer;">
          <div class="stat-label">Ingresos</div>
          <div class="stat-num income" id="stat-income">€0,00</div>
          <div class="stat-sub" id="stat-income-count"></div>
        </div>
        <div data-detail="pexp" style="cursor:pointer;">
          <div class="stat-label">Gastos</div>
          <div class="stat-num expense" id="stat-expense">€0,00</div>
          <div class="stat-sub" id="stat-expense-count"></div>
        </div>
        <div>
          <div class="stat-label">Balance del período</div>
          <div class="stat-num" id="stat-net">€0,00</div>
          <div class="stat-sub" id="stat-compare"></div>
        </div>
      </div>
      <div class="card-cash-line" id="card-cash-line" style="display:none;"></div>
      <div class="section-title" style="font-size:15px;">¿A dónde va tu ingreso?</div>
      <div id="resumen-split" style="margin-bottom:22px;"></div>
      <div class="section-title" style="font-size:15px;">Gastos por categoría</div>
      <div class="chart-wrap" id="resumen-chart"></div>
    </div>`,
  barras: `<div class="card">
      <div class="section-title">Ingresos y gastos por mes</div>
      <div class="trend-head" id="bars-head"></div>
      <svg class="balance-trend bars-chart" id="bars-chart" viewBox="0 0 300 130"></svg>
      <div class="trend-info" id="bars-info"></div>
      <div class="date-chip-row trend-chips" id="bars-chips"></div>
      <div class="nw-legend" id="bars-legend"></div>
    </div>`,
  'flujo-caja': `<div class="card">
      <div class="section-title">Proyección de flujo de caja <select id="cashflow-range" style="font-family:var(--font-body); font-size:12.5px; font-weight:500; border:1px solid var(--rule-strong); border-radius:7px; padding:5px 8px; background:var(--paper);">
        <option value="30" __SEL30__>Próximos 30 días</option>
        <option value="60" __SEL60__>Próximos 60 días</option>
        <option value="month" __SELMONTH__>Mes actual (lo que falta)</option>
        <option value="next" __SELNEXT__>Mes siguiente</option>
      </select></div>
      <div class="stat-sub" id="cashflow-total" style="margin-bottom:10px;"></div>
      <div id="cashflow-list"></div>
    </div>`,
  movimientos: `<div class="card">
      <div class="section-title">Últimos movimientos</div>
      <div class="ledger" id="resumen-recent"></div>
    </div>`
};
function defaultResumenLayout(){
  return RESUMEN_BLOCKS_META.map(b=>({id:b.id, visible:true}));
}
function getResumenLayout(){
  const saved = state.resumenLayout || [];
  const validIds = new Set(RESUMEN_BLOCKS_META.map(b=>b.id));
  const merged = saved.filter(x=>validIds.has(x.id));
  const mergedIds = new Set(merged.map(x=>x.id));
  // los bloques nuevos entran justo después del que les precede en la lista original
  RESUMEN_BLOCKS_META.forEach((b,i)=>{
    if(mergedIds.has(b.id)) return;
    const prev = i>0 ? merged.findIndex(x=>x.id===RESUMEN_BLOCKS_META[i-1].id) : -1;
    merged.splice(prev>=0 ? prev+1 : merged.length, 0, {id:b.id, visible:true});
    mergedIds.add(b.id);
  });
  return merged;
}
function renderResumenBlocksContainer(){
  const container = document.getElementById('resumen-blocks');
  if(!container) return;
  const layout = getResumenLayout();
  const range = String(state.cashflowRange || 30);
  container.innerHTML = layout.filter(b=>b.visible).map(b=>{
    let html = RESUMEN_BLOCK_HTML[b.id];
    if(b.id==='flujo-caja'){
      html = html.replace('__SEL30__', range==='30' ? 'selected' : '').replace('__SEL60__', range==='60' ? 'selected' : '').replace('__SELMONTH__', range==='month' ? 'selected' : '').replace('__SELNEXT__', range==='next' ? 'selected' : '');
    }
    return html;
  }).join('');
}
async function saveResumenLayout(layout){
  state.resumenLayout = layout;
  await idb.put('settings', {key:'resumenLayout', value: layout});
}
function renderResumenLayoutSettings(){
  const el = document.getElementById('resumen-layout-list');
  if(!el) return;
  const layout = getResumenLayout();
  const metaById = {}; RESUMEN_BLOCKS_META.forEach(b=> metaById[b.id]=b.label);
  el.innerHTML = layout.map((b,i)=>`
    <div class="rate-row">
      <div style="${b.visible?'':'color:var(--text-faint);'}">${metaById[b.id]||b.id}</div>
      <div style="display:flex; gap:6px;">
        <button type="button" class="icon-btn" data-resumen-up="${b.id}" ${i===0?'disabled':''} title="Subir">▲</button>
        <button type="button" class="icon-btn" data-resumen-down="${b.id}" ${i===layout.length-1?'disabled':''} title="Bajar">▼</button>
        <button type="button" class="icon-btn" data-resumen-vis="${b.id}" title="${b.visible?'Ocultar':'Mostrar'}">${b.visible?'👁':'🚫'}</button>
      </div>
    </div>
  `).join('');
}
function setupResumenLayoutSettings(){
  document.addEventListener('click', async (e)=>{
    const visBtn = e.target.closest('[data-resumen-vis]');
    if(visBtn){
      const layout = getResumenLayout();
      const item = layout.find(x=>x.id===visBtn.dataset.resumenVis);
      if(item) item.visible = !item.visible;
      await saveResumenLayout(layout);
      renderResumenLayoutSettings();
      renderResumen();
      return;
    }
    const upBtn = e.target.closest('[data-resumen-up]');
    if(upBtn){
      const layout = getResumenLayout();
      const idx = layout.findIndex(x=>x.id===upBtn.dataset.resumenUp);
      if(idx>0){ const tmp=layout[idx-1]; layout[idx-1]=layout[idx]; layout[idx]=tmp; await saveResumenLayout(layout); renderResumenLayoutSettings(); renderResumen(); }
      return;
    }
    const downBtn = e.target.closest('[data-resumen-down]');
    if(downBtn){
      const layout = getResumenLayout();
      const idx = layout.findIndex(x=>x.id===downBtn.dataset.resumenDown);
      if(idx>=0 && idx<layout.length-1){ const tmp=layout[idx+1]; layout[idx+1]=layout[idx]; layout[idx]=tmp; await saveResumenLayout(layout); renderResumenLayoutSettings(); renderResumen(); }
      return;
    }
  });
}


/* ===== Gastos por ciclo (cada N días: manual, o automático si autoCharge) ===== */
function cycleDueList(){
  return state.recurring.filter(r=> r.frequency==='cycle' && !r.autoCharge && r.active!==false && !r.isTransfer);
}
async function registerCycle(id, dateISO){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return;
  const payDate = dateISO || todayISO();
  const days = Math.max(1, Number(r.cycleDays)||30);
  const txRecord = {accountId:r.accountId, kind:r.kind, amount:r.amount, categoryId:r.categoryId, subcategory:r.subcategory||'', date:payDate, note:(r.note ? r.note+' · ' : '')+'Ciclo', debtId:r.debtId||null, debtEffect:r.debtId?(r.debtEffect||'payment'):null, source:'recurring'};
  txRecord.id = await idb.put('transactions', txRecord);
  if(r.debtId) await applyDebtEffect(r.debtId, r.debtEffect||'payment', r.amount);
  r.lastGenerated = payDate;
  r.nextDue = addDaysISO(payDate, days);   // el siguiente ciclo cuenta desde el día real del pago
  await idb.put('recurring', r);
  await loadAll(); renderAll();
  toast('Registrado · próximo ' + fmtDate(r.nextDue));
}
async function postponeCycle(id, dateISO){
  const r = state.recurring.find(x=>x.id===id);
  if(!r || !dateISO) return;
  r.nextDue = dateISO;
  await idb.put('recurring', r);
  await loadAll(); renderAll();
  toast('Pospuesto al ' + fmtDate(dateISO));
}
function cycleActionsHtml(r){
  return `${r.autoCharge ? '' : `<button type="button" class="btn-secondary btn-sm" data-cycle-pay="${r.id}">Registrar</button>`}
    <label class="date-cal-btn" title="${r.autoCharge?'Cambiar la fecha del próximo cobro':'Posponer / cambiar fecha'}" style="margin-left:0; display:inline-flex; vertical-align:middle;"><span>📅 ${r.autoCharge?'Cambiar fecha':'Posponer'}</span><input type="date" data-cycle-postpone="${r.id}" value="${cycleNextDue(r)}"></label>`;
}
/* Selector "Mes / Mes financiero" bajo la barra de periodo del Resumen (solo cuando el periodo es un mes) */
function renderFinMonthRow(){
  const bar = document.getElementById('resumen-period');
  const mode = state.resumenPeriod.mode;
  if(!bar || (mode!=='month' && mode!=='fmonth')) return;
  const row = document.createElement('div');
  row.className = 'fin-row';
  row.innerHTML = `<div class="period-modes"><button type="button" class="pm-btn ${mode==='month'?'active':''}" data-fin="month">Mes</button><button type="button" class="pm-btn ${mode==='fmonth'?'active':''}" data-fin="fmonth">Mes financiero</button></div>`
    + (mode==='fmonth' ? `<label class="fin-day">Empieza el día <input type="number" id="fin-start-day" min="1" max="28" step="1" value="${clampFinDay(state.finStartDay)}" inputmode="numeric"></label>` : '');
  bar.appendChild(row);
  row.querySelectorAll('[data-fin]').forEach(b=> b.addEventListener('click', ()=>{
    state.resumenPeriod = {...state.resumenPeriod, mode:b.dataset.fin};
    renderResumen();
  }));
  const di = row.querySelector('#fin-start-day');
  if(di) di.addEventListener('change', async ()=>{
    state.finStartDay = clampFinDay(di.value);
    await idb.put('settings', {key:'finStartDay', value:state.finStartDay});
    renderResumen();
  });
}
/* Reparto del ingreso: prioritarios (fijos: recurrentes y cuotas) / variables / lo que sobra */
function isFixedTx(t){ return t.source==='recurring' || t.source==='installment'; }
function renderIncomeSplit(periodTx, income, expense){
  const el = document.getElementById('resumen-split');
  if(!el) return;
  let fixed = 0, variable = 0;
  periodTx.forEach(t=>{
    if(t.kind!=='expense') return;
    const acc = getAccount(t.accountId);
    const amt = toBase(t.amount, acc?acc.currency:state.baseCurrency);
    if(isFixedTx(t)) fixed += amt; else variable += amt;
  });
  if(income<=0.004 && expense<=0.004){ el.innerHTML = '<div class="empty-note">Sin movimientos en este período.</div>'; return; }
  const left = income - expense;
  const over = left < 0;
  const base = Math.max(income, expense);
  const pct = v => base>0 ? Math.max(0, v/base*100) : 0;
  const pOfInc = v => income>0.004 ? ' · '+Math.round(v/income*100)+'% del ingreso' : '';
  const C = {fixed:'#4C7EA8', variable:'#B9702C', left:'var(--teal)'};
  const seg = (v, color, detail)=> v>0.004 ? `<div ${detail?`data-detail="${detail}"`:''} style="width:${pct(v)}%; background:${color}; ${detail?'cursor:pointer;':''}"></div>` : '';
  const row = (color, label, v, detail, extra)=> `<div class="legend-item" ${detail?`data-detail="${detail}" style="cursor:pointer;"`:''}><span class="legend-swatch" style="background:${color}"></span><span class="legend-name">${label}<span class="muted" style="font-weight:400;">${extra||''}</span></span><span class="legend-amt">${fmtMoney(v)}</span></div>`;
  el.innerHTML = `
    <div style="display:flex; height:22px; border-radius:7px; overflow:hidden; background:var(--rule); margin-bottom:12px;">
      ${seg(fixed, C.fixed, 'pfixed')}${seg(variable, C.variable, 'pvar')}${over ? '' : seg(left, C.left, null)}
    </div>
    <div class="legend">
      ${row(C.fixed, '🔁 Prioritarios (fijos)', fixed, 'pfixed', pOfInc(fixed))}
      ${row(C.variable, '✏️ Variables', variable, 'pvar', pOfInc(variable))}
      ${over
        ? `<div class="legend-item"><span class="legend-swatch" style="background:var(--over)"></span><span class="legend-name" style="color:var(--over);">Te pasaste del ingreso</span><span class="legend-amt" style="color:var(--over);">${fmtMoney(-left)}</span></div>`
        : row(C.left, '💰 Te sobra', left, null, pOfInc(left))}
    </div>`;
}

function renderPaymentAlerts(){
  const card = document.getElementById('card-payment-alerts');
  const list = document.getElementById('payment-alerts-list');
  if(!card || !list) return;
  const today = todayISO();
  const alerts = [];
  state.accounts.forEach(a=>{
    if(a.type!=='tarjeta_credito' || !a.paymentDay) return;
    const {cutoff, paymentDate} = cardNextCycle(a, today);
    const used = Math.max(0, -cardBalanceAtCutoff(a, cutoff));
    if(used <= 0.004) return;
    const dueDate = paymentDate;
    const daysUntil = Math.round((new Date(dueDate+"T00:00:00") - new Date(today+"T00:00:00")) / 86400000);
    if(daysUntil >= 0 && daysUntil <= 3){
      alerts.push({account:a, used, dueDate, daysUntil, autopayAcc: a.autopayAccountId ? getAccount(a.autopayAccountId) : null});
    }
  });
  const cycleAlerts = [];
  cycleDueList().forEach(r=>{
    const due = cycleNextDue(r);
    const daysUntil = Math.round((new Date(due+"T00:00:00") - new Date(today+"T00:00:00")) / 86400000);
    if(daysUntil <= 3) cycleAlerts.push({r, due, daysUntil});
  });
  if(alerts.length===0 && cycleAlerts.length===0){ card.style.display='none'; return; }
  card.style.display='block';
  alerts.sort((x,y)=> x.daysUntil - y.daysUntil);
  cycleAlerts.sort((x,y)=> x.daysUntil - y.daysUntil);
  const cycleHtml = cycleAlerts.map(ca=>{
    const r = ca.r, acc = getAccount(r.accountId), cat = getCategory(r.categoryId);
    const when = ca.daysUntil<0 ? `vencido hace ${-ca.daysUntil} ${(-ca.daysUntil)===1?'día':'días'}` : (ca.daysUntil===0 ? 'vence hoy' : (ca.daysUntil===1 ? 'vence mañana' : `vence en ${ca.daysUntil} días`));
    return `<div class="budget-row"><div class="budget-top"><div class="budget-cat">🔄 ${escapeHtml(r.note || (cat?cat.name:'Renovación'))}</div><div class="budget-nums">${fmtMoney(r.amount, acc?acc.currency:state.baseCurrency)}</div></div><div class="stat-sub" style="${ca.daysUntil<0?'color:var(--over);':''}">Cada ${r.cycleDays} días · ${when} (${fmtDate(ca.due)})</div><div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${cycleActionsHtml(r)}</div></div>`;
  }).join('');
  list.innerHTML = cycleHtml + alerts.map(al=>{
    const when = al.daysUntil===0 ? 'hoy' : (al.daysUntil===1 ? 'mañana' : `en ${al.daysUntil} días`);
    const debitMsg = al.autopayAcc ? `Se debitará automáticamente desde ${escapeHtml(al.autopayAcc.name)}.` : 'No tienes débito automático configurado · recuerda pagarla a tiempo.';
    return `<div class="budget-row"><div class="budget-top"><div class="budget-cat">💳 ${escapeHtml(al.account.name)}</div><div class="budget-nums">${fmtMoney(al.used, al.account.currency)}</div></div><div class="stat-sub">Se paga ${when} (${fmtDate(al.dueDate)}) · ${debitMsg}</div></div>`;
  }).join('');
}

/* ================= Proyección de flujo de caja ================= */
function cycleNextDue(r){ return r.nextDue || r.startDate; }
function addDaysISO(iso, n){ const d = new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return localISO(d); }
function projectRecurringOccurrences(r, fromDate, toDate){
  const out = [];
  if(r.active===false) return out;
  if(r.frequency==='cycle'){
    const days = Math.max(1, Number(r.cycleDays)||30);
    let next = cycleNextDue(r);
    if(next < fromDate) next = fromDate;   // vencido: se espera hoy
    let it = 0;
    while(next && next <= toDate && it < 60){
      out.push({date:next, label:(r.note || getCategory(r.categoryId)?.name || 'Recurrente'), amount:r.amount, currency: getAccount(r.accountId)?.currency||state.baseCurrency, kind:r.kind});
      next = addDaysISO(next, days); it++;
    }
    return out;
  }
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
  let next = installmentUpcomingDate(it);
  let paid = it.paidInstallments;
  let iterations = 0;
  while(next && next <= toDate && paid < it.totalInstallments && iterations < 60){
    if(next >= fromDate){
      out.push({date:next, label:`${it.name} · Cuota ${paid+1}/${it.totalInstallments}`, amount:installmentAmountFor(it, paid), currency: getAccount(it.accountId)?.currency||state.baseCurrency, kind:'expense'});
    }
    paid++;
    next = installmentAfter(it, next, paid);
    iterations++;
  }
  return out;
}
/* Pagos de tarjeta proyectados: lo ya cargado hasta el corte + los cargos futuros (recurrentes y cuotas)
   que caerán en cada corte. Los cargos individuales de la tarjeta NO se listan aparte (se pagan juntos en la fecha de pago). */
function projectCardPaymentOccurrences(a, fromDate, toDate, cardCharges){
  const out = [];
  if(a.type!=='tarjeta_credito' || !a.paymentDay) return out;
  const today = todayISO();
  const cutoffDay = cutoffDayFor(a);
  let {cutoff, paymentDate} = cardNextCycle(a, today);
  let prevCutoff = null;
  const charges = (cardCharges || []).slice().sort((x,y)=> x.date.localeCompare(y.date));
  for(let k=0; k<14 && paymentDate <= toDate; k++){
    const lo = prevCutoff ? addDaysISO(prevCutoff, 1) : today;
    const inCycle = charges.filter(c=> c.date >= (lo > today ? lo : today) && c.date <= cutoff);
    let amount = inCycle.reduce((sum,c)=> sum + c.amount, 0);   // en la moneda de la tarjeta
    if(k===0) amount += Math.max(0, -cardBalanceAtCutoff(a, cutoff));   // lo ya cargado y sin pagar
    if(amount > 0.004 && paymentDate >= fromDate){
      const label = '💳 ' + a.name + (a.autopayAccountId ? ' (pago automático)' : ' (pendiente de pagar)');
      const names = inCycle.map(c=> c.label);
      const detail = names.length ? 'Incluye cargos previstos: ' + names.slice(0,4).join(', ') + (names.length>4 ? ` y ${names.length-4} más` : '') : '';
      out.push({date:paymentDate, label, amount, currency:a.currency, kind:'expense', detail});
    }
    prevCutoff = cutoff;
    cutoff = nextMonthlyOnDay(cutoff, cutoffDay);
    paymentDate = paymentDateForCutoff(cutoff, a.paymentDay);
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
function cashflowWindow(range){
  const today = todayISO();
  const td = new Date(today+"T00:00:00");
  if(range==='month'){
    return {from: today, to: toISO(new Date(td.getFullYear(), td.getMonth()+1, 0))};
  }
  if(range==='next'){
    return {from: toISO(new Date(td.getFullYear(), td.getMonth()+1, 1)), to: toISO(new Date(td.getFullYear(), td.getMonth()+2, 0))};
  }
  const endD = new Date(today+"T00:00:00"); endD.setDate(endD.getDate()+(Number(range)||30));
  return {from: today, to: toISO(endD)};
}
function isPaidByCard(accountId){
  const a = getAccount(accountId);
  return !!a && a.type==='tarjeta_credito' && !!a.paymentDay;
}
function computeCashflowProjection(range){
  const {from: fromDate, to: toDate} = cashflowWindow(range);
  const today = todayISO();
  const projFrom = fromDate < today ? fromDate : today;
  let items = [];
  const cardCharges = {};   // accountId -> cargos futuros a esa tarjeta
  const addCardCharge = (accId, o)=> (cardCharges[accId] = cardCharges[accId] || []).push(o);
  state.recurring.forEach(r=>{
    const occ = projectRecurringOccurrences(r, projFrom, toDate);
    occ.forEach(o=>{
      if(!r.isTransfer && o.kind==='expense' && isPaidByCard(r.accountId)) addCardCharge(r.accountId, o);
      else if(o.date >= fromDate) items.push(o);
    });
  });
  state.installments.forEach(it=>{
    projectInstallmentOccurrences(it, projFrom, toDate).forEach(o=>{
      if(isPaidByCard(it.accountId)) addCardCharge(it.accountId, o);
      else if(o.date >= fromDate) items.push(o);
    });
  });
  state.accounts.forEach(a=> items = items.concat(projectCardPaymentOccurrences(a, fromDate, toDate, cardCharges[a.id])));
  items.sort((x,y)=> x.date.localeCompare(y.date));
  return items;
}
function renderCashflow(){
  const sel = document.getElementById('cashflow-range');
  const listEl = document.getElementById('cashflow-list');
  const totalEl = document.getElementById('cashflow-total');
  if(!sel || !listEl || !totalEl) return;
  const items = computeCashflowProjection(sel.value || '30');
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
    return `<div class="budget-row"><div class="budget-top"><div class="budget-cat">${escapeHtml(it.label)}</div><div class="ledger-amount ${it.kind}">${sign}${fmtMoney(it.amount, it.currency).replace('-','')}</div></div><div class="stat-sub">${fmtDate(it.date)}${it.detail ? ' · '+escapeHtml(it.detail) : ''}</div></div>`;
  }).join('');
}

/* ===== Gráfico de patrimonio: patrimonio neto, activos y deudas en el tiempo ===== */
const NW_SERIES = [
  {id:'net', label:'Patrimonio', color:'var(--teal)', width:2.2},
  {id:'assets', label:'Activos', color:'var(--gold)', width:1.4},
  {id:'debts', label:'Deudas', color:'var(--over)', width:1.4}
];
let nwHidden = new Set();
let nwModel = null;
function getNwKey(){
  let k = '30';
  try{ k = localStorage.getItem('libro_nw_days') || '30'; }catch(e){}
  return NW_OPTIONS.some(o=>o.key===k) ? k : '30';
}
function computeNetWorthSeries(days){
  const step = Math.max(1, Math.ceil(days/120));
  const dates = [];
  const today = new Date(todayISO()+'T00:00:00');
  for(let i=days-1;i>=0;i-=step){ const d = new Date(today); d.setDate(d.getDate()-i); dates.push(toISO(d)); }
  if(((days-1) % step) !== 0) dates.push(todayISO());
  return dates.map(date=>{
    let assets = 0, debts = 0;
    state.accounts.forEach(a=>{
      const v = toBase(accountBalanceAsOf(a.id, date), a.currency);
      if(v>=0) assets += v; else debts += v;   // deudas = saldos negativos (p. ej. tarjetas)
    });
    return {date, assets, debts, net: assets+debts};
  });
}
function nwHeadDefault(){
  const m = nwModel; if(!m) return '';
  const first = m.points[0].net, last = m.points[m.points.length-1].net, diff = last-first;
  const pct = first !== 0 ? (diff/Math.abs(first))*100 : null;
  const sign = diff>=0 ? '+' : '−';
  const phrase = NW_OPTIONS.find(o=>o.key===m.key).phrase;
  return `<span class="${diff<0?'down':'up'}">${diff>=0?'▲':'▼'} ${sign}${fmtMoney(Math.abs(diff))}` + (pct!==null ? ` · ${sign}${Math.abs(pct).toFixed(1).replace('.',',')} %` : '') + `</span> <span class="trend-period">en ${phrase}</span>`;
}
function renderNwLegend(idx){
  const el = document.getElementById('nw-legend'); if(!el || !nwModel) return;
  const p = nwModel.points[idx==null ? nwModel.points.length-1 : idx];
  el.innerHTML = NW_SERIES.map(sr=>{
    const off = nwHidden.has(sr.id);
    return `<button type="button" class="nw-chip${off?' off':''}" data-nw-series="${sr.id}"><span class="nw-dot" style="background:${sr.color}"></span><span class="nw-name">${sr.label}</span><span class="nw-val">${fmtMoney(p[sr.id])}</span></button>`;
  }).join('');
}
function renderNetChart(){
  const svg = document.getElementById('nw-chart');
  if(!svg) return;
  const key = getNwKey(), days = trendKeyToDays(key);
  const points = computeNetWorthSeries(days);
  const hasDebts = points.some(p=>p.debts!==0);
  const W = Math.max(200, Math.round(svg.getBoundingClientRect().width) || 300), H = 130, padX = 4, padTop = 10, padBot = 8;
  const visible = NW_SERIES.filter(sr=> !nwHidden.has(sr.id) && (sr.id!=='debts' || hasDebts));
  const all = visible.length ? visible.flatMap(sr=> points.map(p=>p[sr.id])) : [0,1];
  const min = Math.min(...all), max = Math.max(...all), range = (max-min) || 1;
  const stepX = points.length>1 ? (W-2*padX)/(points.length-1) : 0;
  const yOf = v => H-padBot - ((v-min)/range)*(H-padTop-padBot);
  const xOf = i => padX + i*stepX;
  nwModel = {key, days, points, W, H, xOf, yOf, visible};
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const net = points.map(p=>p.net), up = net[net.length-1] >= net[0];
  svg.classList.toggle('down', !up);
  const pathOf = id => points.map((p,i)=> (i===0?'M':'L')+xOf(i).toFixed(1)+','+yOf(p[id]).toFixed(1)).join(' ');
  let html = `<defs><linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="trend-stop" stop-opacity="0.22"/><stop offset="1" class="trend-stop" stop-opacity="0"/></linearGradient></defs>`;
  if(min<0 && max>0) html += `<line class="trend-base" x1="${padX}" x2="${W-padX}" y1="${yOf(0).toFixed(1)}" y2="${yOf(0).toFixed(1)}"></line>`;
  if(visible.some(sr=>sr.id==='net')){
    const line = pathOf('net');
    html += `<path class="trend-fill" style="fill:url(#nw-grad)" d="${line} L${xOf(points.length-1).toFixed(1)},${H-padBot} L${xOf(0).toFixed(1)},${H-padBot} Z"></path>`;
  }
  visible.slice().reverse().forEach(sr=>{ html += `<path class="nw-line" d="${pathOf(sr.id)}" style="stroke:${sr.color}; stroke-width:${sr.width}"></path>`; });
  html += `<g class="trend-scrub" style="display:none"><line class="trend-cursor" y1="0" y2="${H}"></line>${visible.map(sr=>`<circle class="trend-dot" data-s="${sr.id}" r="4" style="fill:${sr.color}"></circle>`).join('')}</g>`;
  svg.innerHTML = html;
  const head = document.getElementById('nw-head'); if(head) head.innerHTML = nwHeadDefault();
  const chips = document.getElementById('nw-chips');
  if(chips) chips.innerHTML = NW_OPTIONS.map(o=>`<button type="button" class="date-chip${o.key===key?' active':''}" data-nw-days="${o.key}">${o.label}</button>`).join('');
  const info = document.getElementById('nw-info');
  if(info) info.innerHTML = `<span>${fmtDate(points[0].date)}</span><span>Hoy</span>`;
  renderNwLegend();
}
function nwScrub(e){
  const m = nwModel, svg = document.getElementById('nw-chart'); if(!m||!svg) return;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / (rect.width || 1)) * m.W;
  let idx = Math.round((x - 4) / ((m.W-8) / Math.max(1, m.points.length-1)));
  idx = Math.max(0, Math.min(m.points.length-1, idx));
  const p = m.points[idx], cx = m.xOf(idx);
  const g = svg.querySelector('.trend-scrub'); g.style.display = '';
  const cur = g.querySelector('.trend-cursor'); cur.setAttribute('x1', cx); cur.setAttribute('x2', cx);
  g.querySelectorAll('.trend-dot').forEach(c=>{ c.setAttribute('cx', cx); c.setAttribute('cy', m.yOf(p[c.dataset.s])); });
  const d = new Date(p.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'short', day:'numeric', month:'short', year:'numeric'});
  document.getElementById('nw-head').innerHTML = `<span class="trend-hover">${fmtMoney(p.net)}</span> <span class="trend-period">${d}</span>`;
  renderNwLegend(idx);
}
function nwScrubEnd(){
  const svg = document.getElementById('nw-chart'); if(!svg) return;
  const g = svg.querySelector('.trend-scrub'); if(g) g.style.display = 'none';
  const head = document.getElementById('nw-head'); if(head) head.innerHTML = nwHeadDefault();
  renderNwLegend();
}
function setupNwChart(){
  document.addEventListener('pointerdown', (e)=>{
    const svg = e.target.closest && e.target.closest('#nw-chart'); if(!svg) return;
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    nwScrub(e);
  });
  document.addEventListener('pointermove', (e)=>{
    const svg = document.getElementById('nw-chart'); if(!svg) return;
    if(e.pointerType==='mouse'){ if(e.target.closest && e.target.closest('#nw-chart')) nwScrub(e); }
    else if(svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) nwScrub(e);
  });
  ['pointerup','pointercancel'].forEach(t=> document.addEventListener(t, nwScrubEnd));
  document.addEventListener('pointerout', (e)=>{ if(e.pointerType==='mouse' && e.target.id==='nw-chart') nwScrubEnd(); });
  document.addEventListener('click', (e)=>{
    const pb = e.target.closest('[data-nw-days]');
    if(pb){ try{ localStorage.setItem('libro_nw_days', pb.dataset.nwDays); }catch(err){} renderNetChart(); return; }
    const sb = e.target.closest('[data-nw-series]');
    if(sb){
      const id = sb.dataset.nwSeries;
      if(nwHidden.has(id)) nwHidden.delete(id); else if(nwHidden.size < NW_SERIES.length-1) nwHidden.add(id);
      renderNetChart();
    }
  });
  let rt; window.addEventListener('resize', ()=>{ clearTimeout(rt); rt = setTimeout(renderNetChart, 150); });
}
setupNwChart();
/* ===== Barras: ingresos y gastos por día (mes actual / 30 días) o por mes (6 / 12 meses / todo) ===== */
const BARS_OPTIONS = [
  {key:'month', label:'Mes actual', phrase:'este mes'},
  {key:'30', label:'30 días', phrase:'30 días'},
  {key:'6m', label:'6 meses', phrase:'6 meses'},
  {key:'12m', label:'12 meses', phrase:'12 meses'},
  {key:'all', label:'Todo', phrase:'todo el historial'}
];
let barsModel = null, barsSel = null;
function getBarsKey(){
  let k = 'month';
  try{ k = localStorage.getItem('libro_bars_key') || 'month'; }catch(e){}
  return BARS_OPTIONS.some(o=>o.key===k) ? k : 'month';
}
function computeBarsBuckets(key){
  const today = new Date(todayISO()+'T00:00:00');
  const buckets = [];
  const mk = (id, label, from, to)=> buckets.push({id, label, from, to, inc:0, exp:0});
  if(key==='month' || key==='30'){
    const n = key==='month' ? today.getDate() : 30;
    for(let i=n-1;i>=0;i--){
      const d = new Date(today); d.setDate(d.getDate()-i); const iso = toISO(d);
      mk(iso, new Date(iso+'T00:00:00').toLocaleDateString('es-ES',{weekday:'short', day:'numeric', month:'short'}), iso, iso);
    }
    buckets.mode = 'day';
  } else {
    let n = key==='6m' ? 6 : 12;
    if(key==='all'){
      const f = new Date(firstActivityDate()+'T00:00:00');
      n = Math.max(1, (today.getFullYear()-f.getFullYear())*12 + today.getMonth()-f.getMonth() + 1);
    }
    for(let i=n-1;i>=0;i--){
      const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
      const ym = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      mk(ym, cap(d.toLocaleDateString('es-ES',{month:'long', year:'numeric'})), ym+'-01', ym+'-31');
    }
    buckets.mode = 'month';
  }
  const idx = {}; buckets.forEach((b,i)=> idx[b.id]=i);
  state.transactions.forEach(t=>{
    if(t.kind!=='income' && t.kind!=='expense') return;
    const id = buckets.mode==='day' ? t.date : (t.date||'').slice(0,7);
    const i = idx[id]; if(i===undefined) return;
    const acc = getAccount(t.accountId);
    const v = toBase(t.amount, acc?acc.currency:state.baseCurrency);
    if(t.kind==='income') buckets[i].inc += v; else buckets[i].exp += v;
  });
  return buckets;
}
function barsHead(sel){
  const m = barsModel; if(!m) return '';
  if(sel!=null){ const b = m.buckets[sel]; return `<span class="trend-hover">${fmtMoney(b.inc-b.exp)}</span> <span class="trend-period">${b.label}</span>`; }
  const inc = m.buckets.reduce((s,b)=>s+b.inc,0), exp = m.buckets.reduce((s,b)=>s+b.exp,0), net = inc-exp;
  return `<span class="${net<0?'down':'up'}">${net>=0?'▲':'▼'} ${net>=0?'+':'−'}${fmtMoney(Math.abs(net))}</span> <span class="trend-period">balance en ${BARS_OPTIONS.find(o=>o.key===m.key).phrase}</span>`;
}
function renderBarsLegend(sel){
  const el = document.getElementById('bars-legend'); if(!el || !barsModel) return;
  const src = sel!=null ? [barsModel.buckets[sel]] : barsModel.buckets;
  const inc = src.reduce((s,b)=>s+b.inc,0), exp = src.reduce((s,b)=>s+b.exp,0);
  const chip = (c,name,val)=>`<span class="nw-chip static"><span class="nw-dot" style="background:${c}"></span><span class="nw-name">${name}</span><span class="nw-val">${fmtMoney(val)}</span></span>`;
  el.innerHTML = chip('var(--teal)','Ingresos',inc) + chip('var(--over)','Gastos',exp) + chip('var(--gold)','Neto',inc-exp);
}
function renderBarsChart(){
  const svg = document.getElementById('bars-chart'); if(!svg) return;
  const key = getBarsKey();
  const buckets = computeBarsBuckets(key);
  const W = Math.max(200, Math.round(svg.getBoundingClientRect().width) || 300), H = 130, padX = 4, padTop = 8, padBot = 6;
  const max = Math.max(1, ...buckets.map(b=>Math.max(b.inc,b.exp)));
  const slot = (W-2*padX)/buckets.length;
  const bw = Math.max(1.5, Math.min(14, slot*0.38));
  const hOf = v => (v/max)*(H-padTop-padBot);
  barsModel = {key, buckets, W, H, slot, padX};
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let html = `<line class="trend-base" x1="${padX}" x2="${W-padX}" y1="${H-padBot}" y2="${H-padBot}" style="stroke-dasharray:none"></line><rect class="bars-hl" x="0" y="0" width="${slot}" height="${H}" style="display:none"></rect>`;
  buckets.forEach((b,i)=>{
    const cx = padX + slot*i + slot/2;
    if(b.inc>0) html += `<rect class="bar-inc" x="${(cx-bw-0.5).toFixed(1)}" y="${(H-padBot-hOf(b.inc)).toFixed(1)}" width="${bw.toFixed(1)}" height="${hOf(b.inc).toFixed(1)}" rx="1.5"></rect>`;
    if(b.exp>0) html += `<rect class="bar-exp" x="${(cx+0.5).toFixed(1)}" y="${(H-padBot-hOf(b.exp)).toFixed(1)}" width="${bw.toFixed(1)}" height="${hOf(b.exp).toFixed(1)}" rx="1.5"></rect>`;
  });
  svg.innerHTML = html;
  const short = b => buckets.mode==='day' ? fmtDate(b.id) : cap(new Date(b.id+'-01T00:00:00').toLocaleDateString('es-ES',{month:'short', year:'2-digit'}));
  document.getElementById('bars-head').innerHTML = barsHead(null);
  document.getElementById('bars-info').innerHTML = `<span>${short(buckets[0])}</span><span>${short(buckets[buckets.length-1])}</span>`;
  document.getElementById('bars-chips').innerHTML = BARS_OPTIONS.map(o=>`<button type="button" class="date-chip${o.key===key?' active':''}" data-bars-key="${o.key}">${o.label}</button>`).join('');
  renderBarsLegend(null);
}
function barsScrub(e){
  const m = barsModel, svg = document.getElementById('bars-chart'); if(!m||!svg) return;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / (rect.width || 1)) * m.W;
  const i = Math.max(0, Math.min(m.buckets.length-1, Math.floor((x - m.padX)/m.slot)));
  const hl = svg.querySelector('.bars-hl'); hl.style.display=''; hl.setAttribute('x', m.padX + m.slot*i);
  document.getElementById('bars-head').innerHTML = barsHead(i);
  renderBarsLegend(i);
}
function barsScrubEnd(){
  const svg = document.getElementById('bars-chart'); if(!svg) return;
  const hl = svg.querySelector('.bars-hl'); if(hl) hl.style.display='none';
  const h = document.getElementById('bars-head'); if(h) h.innerHTML = barsHead(null);
  renderBarsLegend(null);
}
function setupBarsChart(){
  document.addEventListener('pointerdown', (e)=>{
    const svg = e.target.closest && e.target.closest('#bars-chart'); if(!svg) return;
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    barsScrub(e);
  });
  document.addEventListener('pointermove', (e)=>{
    const svg = document.getElementById('bars-chart'); if(!svg) return;
    if(e.pointerType==='mouse'){ if(e.target.closest && e.target.closest('#bars-chart')) barsScrub(e); }
    else if(svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) barsScrub(e);
  });
  ['pointerup','pointercancel'].forEach(t=> document.addEventListener(t, barsScrubEnd));
  document.addEventListener('pointerout', (e)=>{ if(e.pointerType==='mouse' && e.target.id==='bars-chart') barsScrubEnd(); });
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('[data-bars-key]'); if(!b) return;
    try{ localStorage.setItem('libro_bars_key', b.dataset.barsKey); }catch(err){}
    renderBarsChart();
  });
  let rt; window.addEventListener('resize', ()=>{ clearTimeout(rt); rt = setTimeout(renderBarsChart, 150); });
}
setupBarsChart();
/* Compromisos que no están en el saldo de las cuentas: cuotas aún sin cobrar y deudas de la sección Deudas.
   Una compra a plazos ligada a una deuda no se cuenta aparte (ya está en la deuda). */
function getNwExtrasOn(){ try{ return localStorage.getItem('libro_nw_extras')==='1'; }catch(e){ return false; } }
function networthExtras(){
  const items = [];
  state.installments.forEach(it=>{
    if(it.active===false || it.debtId || it.paidInstallments>=it.totalInstallments) return;
    const acc = getAccount(it.accountId), cur = acc ? acc.currency : state.baseCurrency;
    const rem = installmentTotals(it).remaining;
    if(rem>0.004) items.push({kind:'inst', label:it.name, value:-toBase(rem, cur), detail:`${it.totalInstallments-it.paidInstallments} de ${it.totalInstallments} cuotas por pagar`});
  });
  state.debts.forEach(d=>{
    if(d.settled || !(d.amount>0.004)) return;
    items.push({kind: d.direction==='debo' ? 'owe' : 'owed', label:d.person, value: d.direction==='debo' ? -d.amount : d.amount, detail:d.note||''});
  });
  const sum = k => items.filter(i=>i.kind===k).reduce((a,i)=>a+i.value, 0);
  const inst = sum('inst'), owe = sum('owe'), owed = sum('owed');
  return {items, inst, owe, owed, total: inst+owe+owed};
}
function renderNetWorth(){
  renderBarsChart();
  renderNetChart();
  const totalEl = document.getElementById('networth-total');
  const el = document.getElementById('networth-breakdown');
  if(!totalEl || !el) return;
  const accountsTotal = totalBalanceBase(true);
  const ex = networthExtras();
  const exRow = document.getElementById('nw-extras-row'), exToggle = document.getElementById('nw-extras-toggle'), noteEl = document.getElementById('networth-note');
  const useExtras = ex.items.length>0 && getNwExtrasOn();
  if(exRow) exRow.style.display = ex.items.length>0 ? '' : 'none';
  if(exToggle) exToggle.checked = useExtras;
  if(noteEl){
    noteEl.style.display = useExtras ? '' : 'none';
    noteEl.textContent = useExtras ? 'Incluye cuotas y deudas pendientes. El gráfico muestra solo tus cuentas.' : '';
  }
  const total = accountsTotal + (useExtras ? ex.total : 0);
  totalEl.textContent = fmtMoney(total);
  totalEl.style.color = total < 0 ? 'var(--over)' : 'var(--text)';
  const byType = {};
  state.accounts.forEach(a=>{
    const val = toBase(accountBalance(a.id), a.currency);
    byType[a.type] = (byType[a.type]||0) + val;
  });
  const typeLabels = {efectivo:'Efectivo', banco:'Banco', ahorros:'Ahorros', otro:'Otro'};
  const entries = Object.entries(byType).filter(([,v])=>v!==0);
  if(entries.length===0 && !useExtras){ el.innerHTML = '<div class="empty-note">Sin cuentas todavía.</div>'; return; }
  const extraRows = useExtras ? [['🧾 Cuotas pendientes', ex.inst], ['🤝 Yo debo', ex.owe], ['🤝 Me deben', ex.owed]].filter(([,v])=>Math.abs(v)>0.004) : [];
  const maxAbs = Math.max(1, ...entries.map(([,v])=>Math.abs(v)), ...extraRows.map(([,v])=>Math.abs(v)));
  const row = (label, val, attrs)=>{
    const pct = Math.min(100, Math.abs(val)/maxAbs*100);
    return `
      <div class="budget-row" ${attrs} style="cursor:pointer;">
        <div class="budget-top"><div class="budget-cat">${label}</div><div class="budget-nums">${fmtMoney(val)}</div></div>
        <div class="budget-track"><div class="budget-fill" style="width:${pct}%; background:${val<0?'var(--over)':'var(--teal)'};"></div></div>
      </div>
    `;
  };
  el.innerHTML = entries.map(([type,val])=> row(typeLabels[type]||cap(type), val, `data-detail="type" data-detail-type="${type}"`)).join('')
    + extraRows.map(([label,val])=> row(label, val, 'data-detail="nwx"')).join('');
}
document.addEventListener('change', (e)=>{
  if(!e.target || e.target.id!=='nw-extras-toggle') return;
  try{ localStorage.setItem('libro_nw_extras', e.target.checked ? '1' : '0'); }catch(err){}
  renderNetWorth();
});

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
  // Margen de hoy según lo que realmente queda del mes (no el reparto parejo desde el día 1),
  // así es coherente con el "diario libre" cuando ya te pasaste del límite.
  const spentBeforeToday = Math.max(0, variableTotal - todaySpent);
  const todayAllowance = (freeForVariables - spentBeforeToday) / daysRemaining;
  const noMarginToday = todayAllowance <= 0;
  const todayLeft = todayAllowance - todaySpent;

  el.innerHTML = `
    <div${elId ? ' style="padding-bottom:14px; border-bottom:1px solid var(--rule);"' : ''}>
      <div class="budget-top" data-detail="all" style="cursor:pointer;" title="Ver movimientos"><div class="budget-cat">${elId ? 'Presupuesto general' : 'Gastado este mes'}</div><div class="budget-nums">${fmtMoney(total)} / ${fmtMoney(limit)}</div></div>
      <div class="budget-track"><div class="budget-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
      <div class="stat-sub" style="margin-top:8px; color:${remaining<0?'var(--over)':'var(--text-soft)'};">${remaining<0 ? 'Te pasaste por '+fmtMoney(Math.abs(remaining)) : 'Te queda '+fmtMoney(remaining)}</div>
      <div style="display:flex; gap:20px; margin-top:12px;">
        <div class="stat-sub" data-detail="fixed" style="cursor:pointer; text-decoration:underline dotted var(--rule-strong); text-underline-offset:4px;">🔁 Fijos: <strong style="color:var(--text);">${fmtMoney(fixedTotal)}</strong>${pending>0.004 ? ` <span class="muted">(incluye ${fmtMoney(pending)} aún no facturados)</span>` : ''}</div>
        <div class="stat-sub" data-detail="variable" style="cursor:pointer; text-decoration:underline dotted var(--rule-strong); text-underline-offset:4px;">✏️ Variables: <strong style="color:var(--text);">${fmtMoney(variableTotal)}</strong></div>
      </div>
      <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--rule);">
        <div class="stat-label">Presupuesto diario libre <span class="muted" style="text-transform:none; font-weight:500;">(descontando fijos)</span></div>
        <div class="balance-num" style="font-size:26px; margin:6px 0 2px; color:${dailyRemaining<0?'var(--over)':'var(--text)'};">${fmtMoney(dailyRemaining)}<span style="font-size:14px; color:var(--text-soft); font-weight:500;"> /día</span></div>
        <div class="stat-sub">Para ${daysRemaining===1?'el último día':'los '+daysRemaining+' días'} que ${daysRemaining===1?'queda':'quedan'} del mes · si lo repartes parejo desde el día 1: ${fmtMoney(dailyBaseline)}/día</div>
      </div>
      <div style="margin-top:12px; padding:10px 14px; background:var(--paper); border:1px solid var(--rule); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <div class="stat-sub">Hoy: gastaste <strong style="color:var(--text);">${fmtMoney(todaySpent)}</strong>${noMarginToday ? '' : ' de '+fmtMoney(todayAllowance)}</div>
        <div class="stat-sub" style="color:${(noMarginToday||todayLeft<0)?'var(--over)':'var(--teal)'}; font-weight:600;">${noMarginToday ? 'Sin margen hoy' : (todayLeft<0 ? 'Te pasaste '+fmtMoney(Math.abs(todayLeft)) : 'Te quedan '+fmtMoney(todayLeft))}</div>
      </div>
    </div>
  `;
}

function budgetRowEl(name, spent, limit, categoryId, cardLater){
  const div = document.createElement('div');
  div.className = 'budget-row';
  const pct = limit>0 ? Math.min(100,(spent/limit)*100) : 0;
  const over = spent>limit;
  const warn = !over && pct>80;
  div.innerHTML = `
    <div class="budget-top"><div class="budget-cat">${escapeHtml(name)}</div><div class="budget-nums">${fmtMoney(spent)} / ${fmtMoney(limit)}</div></div>
    <div class="budget-track"><div class="budget-fill ${over?'over':(warn?'warn':'')}" style="width:${pct}%"></div></div>
    ${cardLater>0.004 ? `<div class="stat-sub card-later-note">💳 ${fmtMoney(cardLater)} con tarjeta se paga después del corte</div>` : ''}
  `;
  if(categoryId){
    div.style.cursor = 'pointer';
    div.title = 'Ver movimientos de la categoría';
    div.dataset.detail = 'cat';
    div.dataset.detailCat = categoryId;
  }
  return div;
}

/* ================= Ventana de detalle (al tocar totales/grupos) ================= */
let detailRequest = null;
function monthExpensesNow(){
  const now = new Date();
  const mStart = toISO(startOfMonth(now)), mEnd = toISO(endOfMonth(now));
  return {mStart, mEnd, items: txInRange(state.transactions, mStart, mEnd).filter(t=>t.kind==='expense')};
}
function sumBase(list){
  let total = 0;
  list.forEach(t=>{ const acc=getAccount(t.accountId); total += toBase(t.amount, acc?acc.currency:state.baseCurrency); });
  return total;
}
function sortLedgerDesc(list){
  return list.slice().sort((a,b)=> b.date.localeCompare(a.date) || (b.id||0)-(a.id||0));
}
function periodLabelText(range){
  return range.start===range.end ? fmtDate(range.start) : fmtDate(range.start)+' – '+fmtDate(range.end);
}
/* ===== Constructores de la ventana de detalle: uno por tipo. Devuelven true si ya no hay que añadir el botón Volver ===== */
const countText = n => `${n} ${n===1?'movimiento':'movimientos'}`;
const sumLine = (list, extra) => `${countText(list.length)} · Total: <strong style="color:var(--text);">${fmtMoney(sumBase(list))}</strong>${extra||''}`;
const typeLabels = {efectivo:'Efectivo', banco:'Banco', ahorros:'Ahorros', tarjeta_credito:'Tarjeta de crédito', otro:'Otro'};

function detail_monthExpenses(req, d){
  const {mStart, mEnd, items} = monthExpensesNow();
  const isFixed = t => t.source==='recurring' || t.source==='installment';
  let list = items, extra = '';
  d.title = 'Gastos del mes';
  if(req.type==='fixed'){
    list = items.filter(isFixed); d.title = '🔁 Gastos fijos del mes';
    const pending = computeMonthFixedProjection(mStart, mEnd);
    if(pending > 0.004) extra = ` · Aún sin facturar este mes: ${fmtMoney(pending)}`;
  } else if(req.type==='variable'){
    list = items.filter(t=>!isFixed(t)); d.title = '✏️ Gastos variables del mes';
  } else if(req.type==='cat'){
    const cat = getCategory(Number(req.catId));
    list = items.filter(t=>t.categoryId===Number(req.catId));
    d.title = cat ? catIcon(cat)+' '+escapeHtml(cat.name) : 'Categoría';
    d.actions = `<button type="button" class="btn-secondary" data-detail-edit-budget="${req.catId}">Editar límite de presupuesto</button>`;
  }
  d.list = sortLedgerDesc(list); d.summary = sumLine(list, extra);
}

function detail_periodTx(req, d){
  const range = periodRange(state.resumenPeriod);
  const periodTx = txInRange(state.transactions, range.start, range.end);
  let list;
  if(req.type==='pinc'){ list = periodTx.filter(t=>t.kind==='income'); d.title = 'Ingresos del período'; }
  else if(req.type==='pexp'){ list = periodTx.filter(t=>t.kind==='expense'); d.title = 'Gastos del período'; }
  else if(req.type==='pfixed'){ list = periodTx.filter(t=>t.kind==='expense' && isFixedTx(t)); d.title = '🔁 Prioritarios (fijos) del período'; }
  else if(req.type==='pvar'){ list = periodTx.filter(t=>t.kind==='expense' && !isFixedTx(t)); d.title = '✏️ Gastos variables del período'; }
  else {
    const cat = getCategory(Number(req.catId));
    list = periodTx.filter(t=>t.kind==='expense' && String(t.categoryId)===String(req.catId));
    d.title = cat ? catIcon(cat)+' '+escapeHtml(cat.name) : 'Categoría';
  }
  d.list = sortLedgerDesc(list);
  d.summary = sumLine(list, ' · '+periodLabelText(range));
}

function detail_account(req, d){
  const acct = getAccount(Number(req.id));
  if(!acct){ d.title = 'Cuenta'; d.summary = 'La cuenta ya no existe.'; return true; }
  const id = acct.id;
  const all = [
    ...state.transactions.filter(t=>t.accountId===id).map(t=>({...t, itemType:'tx'})),
    ...state.transfers.filter(t=>t.fromAccountId===id || t.toAccountId===id).map(t=>({...t, itemType:'transfer'}))
  ];
  const sorted = sortLedgerDesc(all);
  const CAP = 100;
  d.list = sorted.slice(0, CAP);
  d.title = escapeHtml(acct.name);
  d.summary = `Saldo actual: <strong style="color:var(--text);">${fmtMoney(accountBalance(id), acct.currency)}</strong> · ${countText(sorted.length)}${sorted.length>CAP ? ' (mostrando los '+CAP+' más recientes)' : ''}`;
  if(acct.type==='tarjeta_credito' && acct.paymentDay && cutoffDayFor(acct)){
    d.cardId = id;
    d.summary += `<div class="card-cycle-line" style="margin-top:8px; line-height:1.55;">${cardCycleLine(acct)}</div>`;
  }
}

function detail_accountType(req, d){
  const accts = sortedAccounts().filter(a=>a.type===req.acctType);
  d.title = typeLabels[req.acctType] || cap(req.acctType);
  let total = 0;
  accts.forEach(a=>{ total += toBase(accountBalance(a.id), a.currency); });
  d.summary = `${accts.length} ${accts.length===1?'cuenta':'cuentas'} · Total: <strong style="color:var(--text);">${fmtMoney(total)}</strong> <span class="muted">(toca una cuenta para ver sus movimientos)</span>`;
  d.html = accts.length===0 ? '<div class="empty-note">Sin cuentas de este tipo.</div>' : accts.map(a=>
    `<div class="acct-mini-row" data-detail="acct" data-detail-id="${a.id}" style="cursor:pointer;"><span class="name">${escapeHtml(a.name)}${a.visible===false?' <span style="color:var(--text-faint); font-weight:400;">(oculta)</span>':''}</span><span class="amt">${fmtMoney(accountBalance(a.id), a.currency)}</span></div>`
  ).join('');
}

function detail_goal(req, d){
  const g = state.goals.find(x=>x.id===Number(req.id));
  if(!g){ d.title='Meta'; d.summary='La meta ya no existe.'; return true; }
  const saved = g.savedAmount||0, target = g.targetAmount||0;
  const remaining = Math.max(0, target-saved);
  const pct = target>0 ? Math.min(100, saved/target*100) : 0;
  d.title = '🌱 '+escapeHtml(g.name);
  d.summary = `<strong style="color:var(--text);">${fmtMoney(saved)}</strong> de ${fmtMoney(target)} · ${pct.toFixed(0)}%`;
  const rows = [];
  rows.push(['Falta por ahorrar', remaining>0.004 ? fmtMoney(remaining) : '¡Meta cumplida! 🎉']);
  const today = new Date(todayISO()+'T00:00:00');
  if(g.targetDate && remaining>0.004){
    const end = new Date(g.targetDate+'T00:00:00');
    const days = Math.round((end-today)/86400000);
    if(days<0) rows.push(['Fecha límite', fmtDate(g.targetDate)+' <span class="muted">· vencida</span>']);
    else {
      const monthsLeft = Math.max(1, days/30.44);
      rows.push(['Fecha límite', fmtDate(g.targetDate)+` <span class="muted">· faltan ${days} ${days===1?'día':'días'}</span>`]);
      rows.push(['Aporte mensual necesario', fmtMoney(remaining/monthsLeft)+'/mes']);
    }
  } else if(g.targetDate){
    rows.push(['Fecha límite', fmtDate(g.targetDate)]);
  }
  const monthly = g.monthlyTargetMode==='percent' ? (g.monthlyTargetValue/100)*state.monthlyIncome : (g.monthlyTargetMode==='fixed' ? g.monthlyTargetValue : 0);
  if(monthly>0){
    rows.push(['Aporte mensual objetivo', fmtMoney(monthly)+'/mes'+(g.monthlyTargetMode==='percent'?` <span class="muted">· ${g.monthlyTargetValue}% de tu sueldo</span>`:'')]);
    if(remaining>0.004){
      const n = Math.ceil(remaining/monthly);
      const est = new Date(today.getFullYear(), today.getMonth()+n, today.getDate());
      rows.push(['Al ritmo objetivo la completas', cap(est.toLocaleDateString('es-ES',{month:'long', year:'numeric'}))+` <span class="muted">· ${n} ${n===1?'mes':'meses'}</span>`]);
    }
  }
  d.html = `<div class="detail-kv">${rows.map(([k,v])=>`<div class="detail-kv-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
  d.actions = `<button type="button" class="btn-secondary" data-goal-add="${g.id}">+ Añadir aporte</button>`;
}

function detail_debt(req, d){
  const db = state.debts.find(x=>x.id===Number(req.id));
  if(!db){ d.title='Deuda'; d.summary='La deuda ya no existe.'; return true; }
  const original = db.originalAmount || db.amount;
  const paid = Math.max(0, original-db.amount);
  const list = state.transactions.filter(t=>t.debtId===db.id);
  d.title = '🤝 '+escapeHtml(db.person);
  d.summary = `${db.direction==='debo'?'Yo debo':'Me deben'} · Pendiente: <strong style="color:var(--text);">${fmtMoney(db.amount)}</strong>${db.settled?' · Liquidada':''}`
    + (original>0 && paid>0.004 ? `<div style="margin-top:4px;">Pagado ${fmtMoney(paid)} de ${fmtMoney(original)}</div>` : '')
    + (db.note ? `<div style="margin-top:4px;">${escapeHtml(db.note)}</div>` : '');
  d.list = sortLedgerDesc(list);
  if(list.length===0) d.html = '<div class="empty-note">Aún no hay movimientos ligados a esta deuda. Al registrar un gasto o ingreso con "Deuda relacionada" aparecerá aquí.</div>';
}

function detail_nwx(req, d){
  const ex = networthExtras();
  d.title = '🧾 Cuotas y deudas pendientes';
  d.summary = `Efecto total en tu patrimonio: <strong style="color:var(--text);">${fmtMoney(ex.total)}</strong>`;
  const group = (title, kind)=>{
    const its = ex.items.filter(i=>i.kind===kind);
    if(!its.length) return '';
    return `<div class="cmp-sep">${title}</div><div class="detail-kv">${its.map(i=>`<div class="detail-kv-row"><span>${escapeHtml(i.label)}${i.detail?` <span class="muted">· ${escapeHtml(i.detail)}</span>`:''}</span><span>${fmtMoney(i.value)}</span></div>`).join('')}</div>`;
  };
  d.html = (group('Compras a plazos por pagar','inst') + group('Yo debo','owe') + group('Me deben','owed')) || '<div class="empty-note">Sin cuotas ni deudas pendientes.</div>';
}

function detail_compare(req, d){
  const ref = new Date(state.resumenPeriod.ref+'T00:00:00');
  const prevRef = new Date(ref.getFullYear(), ref.getMonth()-1, 1);
  const tot = (r)=>{
    const items = txInRange(state.transactions, toISO(startOfMonth(r)), toISO(endOfMonth(r)));
    const byCat = {}; let inc=0, exp=0;
    items.forEach(t=>{
      const v = sumBase([t]);
      if(t.kind==='income') inc += v;
      else if(t.kind==='expense'){ exp += v; byCat[t.categoryId] = (byCat[t.categoryId]||0)+v; }
    });
    return {inc, exp, byCat};
  };
  const A = tot(ref), B = tot(prevRef);
  const nameOf = r => cap(r.toLocaleDateString('es-ES',{month:'long', year:'numeric'}));
  d.title = '📊 Mes vs mes anterior';
  d.summary = `${nameOf(ref)} <span class="muted">frente a</span> ${nameOf(prevRef)}`;
  const delta = (a,b,goodWhenLower)=>{
    const diff = a-b;
    if(Math.abs(diff)<0.005) return '<span class="muted">·</span>';
    const bad = goodWhenLower ? diff>0 : diff<0;
    return `<span style="color:${bad?'var(--over)':'var(--teal)'};">${diff>0?'▲':'▼'} ${fmtMoney(Math.abs(diff))}</span>`;
  };
  const row = (label, a, b, lower, bold)=>`<div class="cmp-row${bold?' cmp-bold':''}"><span class="cmp-name">${label}</span><span class="cmp-val">${fmtMoney(a)}</span><span class="cmp-val muted">${fmtMoney(b)}</span><span class="cmp-delta">${delta(a,b,lower)}</span></div>`;
  const ids = [...new Set([...Object.keys(A.byCat), ...Object.keys(B.byCat)])]
    .sort((x,y)=> Math.max(B.byCat[y]||0, A.byCat[y]||0) - Math.max(B.byCat[x]||0, A.byCat[x]||0));
  d.html = `<div class="cmp-table">
    <div class="cmp-row cmp-head"><span class="cmp-name"></span><span class="cmp-val">${cap(ref.toLocaleDateString('es-ES',{month:'short'}))}</span><span class="cmp-val">${cap(prevRef.toLocaleDateString('es-ES',{month:'short'}))}</span><span class="cmp-delta">Dif.</span></div>
    ${row('Ingresos', A.inc, B.inc, false, true)}
    ${row('Gastos', A.exp, B.exp, true, true)}
    ${row('Neto', A.inc-A.exp, B.inc-B.exp, false, true)}
    <div class="cmp-sep">Gastos por categoría</div>
    ${ids.length ? ids.map(id=>{ const c=getCategory(Number(id)); return row(c ? catIcon(c)+' '+escapeHtml(c.name) : 'Sin categoría', A.byCat[id]||0, B.byCat[id]||0, true); }).join('') : '<div class="empty-note">Sin gastos en estos dos meses.</div>'}
  </div>`;
}

const DETAIL_BUILDERS = {
  all: detail_monthExpenses,
  fixed: detail_monthExpenses,
  variable: detail_monthExpenses,
  cat: detail_monthExpenses,
  pcat: detail_periodTx,
  pexp: detail_periodTx,
  pinc: detail_periodTx,
  pfixed: detail_periodTx,
  pvar: detail_periodTx,
  acct: detail_account,
  type: detail_accountType,
  goal: detail_goal,
  debt: detail_debt,
  nwx: detail_nwx,
  cmp: detail_compare,
  cardcash: detail_cardcash
};

function buildDetail(req){
  let d = {title:'', summary:'', list:[], html:null, actions:''};
  const build = DETAIL_BUILDERS[req.type];
  if(build && build(req, d) === true) return d;
  if(req.prev) d.actions = `<button type="button" class="btn-secondary" data-detail-back="1">← Volver</button> ` + d.actions;
  return d;
}
function renderDetailModal(){
  if(!detailRequest) return;
  const d = buildDetail(detailRequest);
  document.getElementById('detail-title').innerHTML = d.title;
  document.getElementById('detail-summary').innerHTML = d.summary;
  const listEl = document.getElementById('detail-list');
  if(d.html !== null && d.html !== undefined) listEl.innerHTML = d.html;
  else if(d.list.length===0) listEl.innerHTML = '<div class="empty-note">Sin movimientos en este grupo.</div>';
  else if(d.cardId) renderCardCycleList(listEl, d.list, getAccount(d.cardId));
  else renderLedgerList(listEl, d.list);
  document.getElementById('detail-actions').innerHTML = d.actions;
}
function openDetailModal(req){
  detailRequest = req;
  renderDetailModal();
  document.getElementById('detail-overlay').style.display = 'flex';
  document.querySelector('#detail-overlay .modal-panel').scrollTop = 0;
  pushOverlayState();
}
function hideDetailModal(){
  detailRequest = null;
  document.getElementById('detail-overlay').style.display = 'none';
}
function refreshDetailModal(){
  const ov = document.getElementById('detail-overlay');
  if(detailRequest && ov && ov.style.display!=='none') renderDetailModal();
}
function reqFromTrigger(el){
  return {type: el.dataset.detail, catId: el.dataset.detailCat, id: el.dataset.detailId, acctType: el.dataset.detailType, start: el.dataset.detailStart, end: el.dataset.detailEnd};
}
function setupDetailModal(){
  document.getElementById('detail-close').addEventListener('click', ()=> history.back());
  document.getElementById('detail-overlay').addEventListener('click', (e)=>{
    if(e.target.id==='detail-overlay'){ history.back(); return; }
    const editBudget = e.target.closest('[data-detail-edit-budget]');
    if(editBudget){
      const catId = Number(editBudget.dataset.detailEditBudget);
      hideDetailModal();
      goToBudgetEdit(catId);
      return;
    }
    const back = e.target.closest('[data-detail-back]');
    if(back && detailRequest && detailRequest.prev){
      e.stopPropagation();  // el contenido se vuelve a pintar: evita que el handler global lo trate como un toque externo
      detailRequest = detailRequest.prev;
      renderDetailModal();
      return;
    }
    const nested = e.target.closest('[data-detail]');
    if(nested && detailRequest){
      e.stopPropagation();
      detailRequest = {...reqFromTrigger(nested), prev: detailRequest};
      renderDetailModal();
      document.querySelector('#detail-overlay .modal-panel').scrollTop = 0;
    }
  });
  document.addEventListener('click', (e)=>{
    if(e.target.closest('#detail-overlay')) return;
    const trigger = e.target.closest('[data-detail]');
    if(!trigger) return;
    openDetailModal(reqFromTrigger(trigger));
  });
}

function goToBudgetEdit(categoryId){
  document.querySelectorAll('.nav-btn[data-view="presupuestos"]')[0].click();
  const input = document.querySelector(`[data-budget-value="${categoryId}"]`);
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
  if(!el) return;
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
      <div class="legend-item" data-detail="pcat" data-detail-cat="${li.catId}" style="cursor:pointer;">
        <span class="legend-swatch" style="background:${li.color}"></span><span class="legend-name">${escapeHtml(li.name)}</span><span class="legend-amt">${fmtMoney(li.amt)}</span>
      </div>
    `).join('')}</div>
  `;
}

function mergedLedger(){
  const txItems = state.transactions.map(t=>({...t, itemType:'tx'}));
  const trItems = state.transfers.map(t=>({...t, itemType:'transfer'}));
  return [...txItems, ...trItems].sort((a,b)=> b.date.localeCompare(a.date) || (b.id-a.id));
}

function itemKey(it){ return (it.itemType==='transfer' ? 'tr:' : 'tx:') + it.id; }
function ledgerRowEl(item, selectable){
  const wrap = document.createElement('div');
  wrap.className = 'ledger-row-wrap';
  const row = document.createElement('div');
  row.className = 'ledger-row';
  if(item.itemType==='transfer'){
    const from = getAccount(item.fromAccountId), to = getAccount(item.toAccountId);
    const trCat = item.categoryId ? getCategory(item.categoryId) : null;
    wrap.innerHTML = `<div class="ledger-row-actions"><button type="button" class="swipe-action edit" data-edit-transfer="${item.id}">Editar</button><button type="button" class="swipe-action delete" data-del-transfer="${item.id}">Eliminar</button></div>`;
    row.innerHTML = `
      <div class="ledger-desc"><div class="ledger-note">${trCat ? catIcon(trCat)+' '+escapeHtml(trCat.name) : (item.note || 'Transferencia')}</div><div class="ledger-cat">${from?escapeHtml(from.name):'?'} → ${to?escapeHtml(to.name):'?'}${trCat && item.note ? ' · '+escapeHtml(item.note) : ''}</div></div>
      <div><span class="tag transfer">Transferencia</span></div>
      <div class="ledger-amount transfer">${fmtMoney(item.fromAmount, from?from.currency:state.baseCurrency)}</div>
    `;
  } else {
    const acc = getAccount(item.accountId);
    const cat = getCategory(item.categoryId);
    const catLabel = cat ? (catIcon(cat)+' '+cat.name) : 'Sin categoría';
    const secondaryLabel = [item.subcategory ? escapeHtml(item.subcategory) : null, item.note ? escapeHtml(item.note) : null, acc?escapeHtml(acc.name):null].filter(Boolean).join(' · ');
    wrap.innerHTML = `<div class="ledger-row-actions"><button type="button" class="swipe-action edit" data-edit-tx="${item.id}">Editar</button><button type="button" class="swipe-action delete" data-del-tx="${item.id}">Eliminar</button></div>`;
    row.innerHTML = `
      <div class="ledger-desc"><div class="ledger-note">${escapeHtml(catLabel)}</div><div class="ledger-cat">${secondaryLabel}</div></div>
      <div><span class="tag ${item.kind}">${item.kind==='income'?'Ingreso':'Gasto'}</span></div>
      <div class="ledger-amount ${item.kind}">${item.kind==='income'?'+':'-'}${fmtMoney(item.amount, acc?acc.currency:state.baseCurrency).replace('-','')}</div>
    `;
  }
  wrap.appendChild(row);
  if(selectable && state.selMode){
    const key = itemKey(item);
    wrap.dataset.sel = key;
    wrap.classList.add('sel-on');
    if(state.sel.has(key)) wrap.classList.add('selected');
    const box = document.createElement('span'); box.className = 'sel-box'; box.textContent = '✓';
    wrap.appendChild(box);
  }
  return wrap;
}

// Deslizar una fila de movimiento hacia la izquierda revela Editar/Eliminar (patrón swipe-to-reveal),
// en vez de los botones pequeños fijos. Delegado a nivel de documento porque las filas se regeneran
// en cada render (ver renderLedgerList) y así no hay que re-enlazar listeners por fila.
let ledgerSwipe = null;
function closeLedgerSwipe(wrap){
  const row = wrap.querySelector('.ledger-row');
  row.style.transition = 'transform .18s ease';
  row.style.transform = 'translateX(0)';
  wrap.classList.remove('swiped');
  setTimeout(()=>{ row.style.transition=''; }, 200);
}
function setupLedgerSwipe(){
  document.addEventListener('pointerdown', (e)=>{
    if(e.pointerType==='mouse' && e.button!==0) return;
    const wrap = e.target.closest('.ledger-row-wrap');
    document.querySelectorAll('.ledger-row-wrap.swiped').forEach(w=>{ if(w!==wrap) closeLedgerSwipe(w); });
    if(!wrap) return;
    if(state.selMode && wrap.dataset.sel) return;
    ledgerSwipe = {wrap, startX:e.clientX, startY:e.clientY, dx:0, dragging:false, wasSwiped: wrap.classList.contains('swiped')};
  });
  document.addEventListener('pointermove', (e)=>{
    if(!ledgerSwipe) return;
    const dx = e.clientX - ledgerSwipe.startX;
    const dy = e.clientY - ledgerSwipe.startY;
    if(!ledgerSwipe.dragging){
      if(Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)){ ledgerSwipe.dragging = true; }
      else if(Math.abs(dy) > 8){ ledgerSwipe = null; return; }
      else return;
    }
    const actionsW = ledgerSwipe.wrap.querySelector('.ledger-row-actions').getBoundingClientRect().width || 132;
    const base = ledgerSwipe.wasSwiped ? -actionsW : 0;
    const clamped = Math.min(0, Math.max(-actionsW*1.1, base + dx));
    ledgerSwipe.dx = clamped;
    ledgerSwipe.wrap.querySelector('.ledger-row').style.transform = `translateX(${clamped}px)`;
  });
  const endSwipe = ()=>{
    if(!ledgerSwipe) return;
    if(ledgerSwipe.dragging){
      const wrap = ledgerSwipe.wrap;
      const actionsW = wrap.querySelector('.ledger-row-actions').getBoundingClientRect().width || 132;
      const row = wrap.querySelector('.ledger-row');
      row.style.transition = 'transform .18s ease';
      if(ledgerSwipe.dx < -actionsW*0.5){
        row.style.transform = `translateX(-${actionsW}px)`;
        wrap.classList.add('swiped');
      } else {
        row.style.transform = 'translateX(0)';
        wrap.classList.remove('swiped');
      }
      setTimeout(()=>{ row.style.transition=''; }, 200);
    }
    ledgerSwipe = null;
  };
  document.addEventListener('pointerup', endSwipe);
  document.addEventListener('pointercancel', endSwipe);
}


// Agrupa una lista de movimientos (ya ordenada) bajo encabezados de fecha, ej. "1 de agosto de 2026 (sáb)",
// en vez de repetir la fecha en cada fila — pensado para ahorrar espacio horizontal en el celular.
/* Lista de una tarjeta agrupada por ciclo, con separador de corte y ajuste manual de ciclo por movimiento */
function renderCardCycleList(container, items, acct){
  container.innerHTML = '';
  const today = todayISO();
  const cutOf = it => it.itemType==='tx' ? cardTxCutoff(acct, it) : cardNaturalCutoff(acct, it.date);
  const groups = [];
  items.forEach(it=>{
    const c = cutOf(it);
    let g = groups[groups.length-1];
    if(!g || g.cutoff!==c){ g = {cutoff:c, items:[]}; groups.push(g); }
    g.items.push(it);
  });
  groups.sort((x,y)=> y.cutoff.localeCompare(x.cutoff));
  groups.forEach(g=>{
    const pay = paymentDateForCutoff(g.cutoff, acct.paymentDay);
    const net = g.items.reduce((s,it)=> it.itemType==='tx' ? s + (it.kind==='income' ? it.amount : -it.amount) : s, 0);
    const closed = g.cutoff <= today;
    const head = document.createElement('div');
    head.className = 'cycle-sep' + (closed ? ' closed' : ' open');
    head.innerHTML = `<span>${closed ? '✂ Corte del '+fmtDate(g.cutoff) : '● En curso · corte el '+fmtDate(g.cutoff)} · pago ${fmtDate(pay)}</span><span class="cycle-sep-amt">${fmtMoney(net, acct.currency)}</span>`;
    container.appendChild(head);
    let lastDate = null;
    g.items.forEach(it=>{
      if(it.date !== lastDate){
        const dh = document.createElement('div'); dh.className = 'ledger-date-header'; dh.textContent = fmtDateHeader(it.date);
        container.appendChild(dh); lastDate = it.date;
      }
      container.appendChild(ledgerRowEl(it));
      if(it.itemType==='tx'){
        const sh = it.cycleShift || 0;
        const line = document.createElement('div');
        line.className = 'cycle-line';
        line.innerHTML = `<button type="button" class="cycle-pill${sh?' set':''}" data-cycle-menu="${it.id}">${sh>0 ? '📌 Pasó al ciclo siguiente' : (sh<0 ? '📌 Cuenta en el ciclo anterior' : '⇅ Ciclo')}</button>
          <div class="cycle-menu" id="cycle-menu-${it.id}" style="display:none;">
            <button type="button" class="date-chip${sh<0?' active':''}" data-cycle-set="-1" data-tx="${it.id}">← Ciclo anterior</button>
            <button type="button" class="date-chip${sh===0?' active':''}" data-cycle-set="0" data-tx="${it.id}">Automático</button>
            <button type="button" class="date-chip${sh>0?' active':''}" data-cycle-set="1" data-tx="${it.id}">Ciclo siguiente →</button>
          </div>`;
        container.appendChild(line);
      }
    });
  });
}
function setupCycleShift(){
  document.addEventListener('click', async (e)=>{
    const m = e.target.closest('[data-cycle-menu]');
    if(m){
      const menu = document.getElementById('cycle-menu-'+m.dataset.cycleMenu);
      if(menu) menu.style.display = menu.style.display==='none' ? 'flex' : 'none';
      return;
    }
    const b = e.target.closest('[data-cycle-set]');
    if(!b) return;
    e.stopPropagation();
    const t = state.transactions.find(x=>x.id===Number(b.dataset.tx));
    if(!t) return;
    const nt = {...t}; const v = Number(b.dataset.cycleSet);
    if(v===0) delete nt.cycleShift; else nt.cycleShift = v;
    await idb.put('transactions', nt);
    await loadAll(); renderAll(); refreshDetailModal();
    toast(v>0 ? 'Pasó al ciclo siguiente' : (v<0 ? 'Cuenta en el ciclo anterior' : 'Ciclo automático (por fecha)'));
  });
}
setupCycleShift();
function renderLedgerList(container, items, selectable){
  container.innerHTML = '';
  let lastDate = null;
  items.forEach(it=>{
    if(it.date !== lastDate){
      const header = document.createElement('div');
      header.className = 'ledger-date-header';
      header.textContent = fmtDateHeader(it.date);
      container.appendChild(header);
      lastDate = it.date;
    }
    container.appendChild(ledgerRowEl(it, selectable));
  });
}
/* Agrupado por categoría: cada grupo se puede plegar; dentro, los movimientos siguen ordenados por fecha */
function itemBase(it){
  if(it.itemType==='transfer'){ const a = getAccount(it.fromAccountId); return toBase(it.fromAmount, a?a.currency:state.baseCurrency); }
  const a = getAccount(it.accountId); return toBase(it.amount, a?a.currency:state.baseCurrency);
}
function renderLedgerGrouped(container, items, selectable){
  container.innerHTML = '';
  const groups = new Map();
  items.forEach(it=>{
    const isTr = it.itemType==='transfer';
    const key = isTr ? 'transfer' : 'c'+it.categoryId;
    let g = groups.get(key);
    if(!g){
      const cat = isTr ? null : getCategory(it.categoryId);
      g = {key, label: isTr ? '↔ Transferencias' : (cat ? catIcon(cat)+' '+escapeHtml(cat.name) : 'Sin categoría'), items:[], net:0};
      groups.set(key, g);
    }
    g.items.push(it);
    if(!isTr) g.net += it.kind==='income' ? itemBase(it) : -itemBase(it);
  });
  [...groups.values()].sort((a,b)=> Math.abs(b.net)-Math.abs(a.net) || b.items.length-a.items.length).forEach(g=>{
    const collapsed = state.collapsedCats.has(g.key);
    const head = document.createElement('div');
    head.className = 'cat-group-head';
    head.dataset.catGroup = g.key;
    head.innerHTML = `<span>${collapsed?'▸':'▾'} ${g.label} <span class="muted">· ${g.items.length}</span></span><span class="cat-group-amt${g.key==='transfer'?'':(g.net<0?' neg':' pos')}">${g.key==='transfer'?'':fmtMoney(g.net)}</span>`;
    container.appendChild(head);
    if(collapsed) return;
    let lastDate = null;
    g.items.forEach(it=>{
      if(it.date !== lastDate){
        const dh = document.createElement('div'); dh.className = 'ledger-date-header'; dh.textContent = fmtDateHeader(it.date);
        container.appendChild(dh); lastDate = it.date;
      }
      container.appendChild(ledgerRowEl(it, selectable));
    });
  });
}

/* ================= Rendering: Movimientos ================= */
function renderMovimientos(){
  populateAccountSelects();
  populateCategorySelect(document.getElementById('tx-category'), state.txType);
  populateSubcategorySelect();
  populateDebtUnified('tx', state.txType, true);
  populateTransferCategorySelects();

  document.getElementById('filter-account').innerHTML = '<option value="all">Todas las cuentas</option>' + sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const allCats = state.categories.map(c=>`<option value="${c.id}">${catIcon(c)} ${escapeHtml(c.name)} (${c.kind==='expense'?'gasto':'ingreso'})</option>`).join('');
  document.getElementById('filter-category').innerHTML = '<option value="all">Todas las categorías</option>' + allCats;

  renderPeriodBar('mov-period', 'movPeriod', renderMovimientos);
  renderMovQuick();
  filterAndRenderTx();
  updateSplitHint('tx');
}

function preferredAccountId(){
  if(state.lastAccountId && getAccount(state.lastAccountId)) return state.lastAccountId;
  return getDefaultAccountId();
}
function rememberAccount(id){
  if(!id) return;
  state.lastAccountId = id;
  ['tx-account','qk-account'].forEach(sid=>{ const el=document.getElementById(sid); if(el) el.value = String(id); });
  idb.put('settings', {key:'lastAccountId', value:id}).catch(()=>{});
}
function populateAccountSelects(){
  const opts = sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)} — ${fmtMoney(accountBalance(a.id), a.currency)}</option>`).join('');
  const defaultId = preferredAccountId();
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
function populateTransferCategorySelects(){
  const cats = sortedCategories('transfer');
  const opts = '<option value="">Sin categoría</option>' + cats.map(c=>`<option value="${c.id}">${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('');
  ['tr-category','qk-tr-category'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = opts;
    if(prev) sel.value = prev;
  });
}
function populateSubcategorySelect(){
  const catId = Number(document.getElementById('tx-category').value);
  const cat = getCategory(catId);
  const sel = document.getElementById('tx-subcategory');
  const subs = (cat && cat.subcategories) ? cat.subcategories : [];
  sel.innerHTML = '<option value="">Ninguna</option>' + subs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sel.value = '';
  document.getElementById('tx-subcategory-field').style.display = subs.length ? 'block' : 'none';
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

  const minV = parseFloat(document.getElementById('filter-min').value);
  const maxV = parseFloat(document.getElementById('filter-max').value);
  if(!isNaN(minV)) list = list.filter(it => itemBase(it) >= minV - 0.005);
  if(!isNaN(maxV)) list = list.filter(it => itemBase(it) <= maxV + 0.005);

  const listEl = document.getElementById('tx-list');
  listEl.classList.toggle('sel-mode', state.selMode);
  if(list.length===0){
    listEl.innerHTML = '<div class="empty-note">No hay movimientos que coincidan con estos filtros.</div>';
  } else if(state.movGroup==='category'){
    renderLedgerGrouped(listEl, list, true);
  } else {
    renderLedgerList(listEl, list, true);
  }
  state.visibleKeys = list.map(itemKey);
  // la selección solo conserva lo que sigue visible
  [...state.sel].forEach(k=>{ if(!state.visibleKeys.includes(k)) state.sel.delete(k); });

  const sumEl = document.getElementById('mov-summary');
  if(sumEl){
    let inc = 0, exp = 0;
    list.forEach(it=>{ if(it.itemType==='transfer') return; if(it.kind==='income') inc += itemBase(it); else exp += itemBase(it); });
    sumEl.innerHTML = list.length ? `${list.length} movimiento${list.length===1?'':'s'} · Ingresos <strong class="pos">${fmtMoney(inc)}</strong> · Gastos <strong class="neg">${fmtMoney(exp)}</strong> · Neto <strong>${fmtMoney(inc-exp)}</strong>` : '';
  }
  renderSelBar();
  renderSearchExtras(searchVal);
}

/* ===== Atajos de periodo (siempre con "Mes actual" junto a "30 días") ===== */
const MOV_QUICK = [{key:'month', label:'Mes actual'}, {key:'30', label:'30 días'}, {key:'90', label:'90 días'}, {key:'year', label:'Este año'}, {key:'all', label:'Todo'}];
function movQuickPeriod(key){
  const t = todayISO();
  if(key==='month') return {mode:'month', ref:t};
  if(key==='year') return {mode:'year', ref:t};
  if(key==='30' || key==='90'){
    const d = new Date(t+'T00:00:00'); d.setDate(d.getDate() - (Number(key)-1));
    return {mode:'range', start:toISO(d), end:t};
  }
  return {mode:'range', start:firstActivityDate(), end:t};
}
function renderMovQuick(){
  const el = document.getElementById('mov-quick'); if(!el) return;
  const cur = periodRange(state.movPeriod);
  el.innerHTML = MOV_QUICK.map(o=>{
    const r = periodRange(movQuickPeriod(o.key));
    const active = r.start===cur.start && r.end===cur.end;
    return `<button type="button" class="date-chip${active?' active':''}" data-mov-quick="${o.key}">${o.label}</button>`;
  }).join('');
}

/* ===== Selección múltiple: cambiar categoría o cuenta, o eliminar varios a la vez ===== */
function selectedItems(){
  const txs = [], trs = [];
  state.sel.forEach(k=>{
    const [kind, id] = k.split(':');
    if(kind==='tx'){ const t = state.transactions.find(x=>x.id===Number(id)); if(t) txs.push(t); }
    else { const t = state.transfers.find(x=>x.id===Number(id)); if(t) trs.push(t); }
  });
  return {txs, trs};
}
function renderSelBar(){
  const bar = document.getElementById('sel-bar'); if(!bar) return;
  const btn = document.getElementById('sel-toggle');
  if(btn){ btn.textContent = state.selMode ? 'Terminar selección' : 'Seleccionar'; btn.classList.toggle('active', state.selMode); }
  bar.style.display = state.selMode ? '' : 'none';
  if(!state.selMode) return;
  const {txs, trs} = selectedItems();
  const n = txs.length + trs.length;
  document.getElementById('sel-count').textContent = n ? `${n} seleccionado${n===1?'':'s'}` : 'Toca los movimientos para seleccionarlos';
  const kinds = [...new Set(txs.map(t=>t.kind))];
  const catSel = document.getElementById('sel-cat'), accSel = document.getElementById('sel-acc');
  if(txs.length===0){
    catSel.innerHTML = '<option value="">Cambiar categoría…</option>'; catSel.disabled = true;
  } else if(kinds.length>1){
    catSel.innerHTML = '<option value="">Elige solo gastos o solo ingresos</option>'; catSel.disabled = true;
  } else {
    catSel.disabled = false;
    catSel.innerHTML = '<option value="">Cambiar categoría…</option>' + sortedCategories(kinds[0]).map(c=>`<option value="${c.id}">${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('');
  }
  accSel.disabled = txs.length===0;
  accSel.innerHTML = '<option value="">Mover a cuenta…</option>' + sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  document.getElementById('sel-del').disabled = n===0;
}
async function applyBatchTxUpdate(newTxs, olds, message){
  for(const t of newTxs) await idb.put('transactions', t);
  state.sel.clear();
  await loadAll(); renderAll();
  toast(message, 'Deshacer', async ()=>{
    for(const o of olds) await idb.put('transactions', o);
    await loadAll(); renderAll();
    toast('Cambios deshechos');
  }, 7000);
}
function setupSelection(){
  ['filter-min','filter-max'].forEach(id=> document.getElementById(id).addEventListener('input', filterAndRenderTx));
  document.getElementById('filter-group').addEventListener('change', (e)=>{ state.movGroup = e.target.value; filterAndRenderTx(); });
  document.getElementById('sel-toggle').addEventListener('click', ()=>{
    state.selMode = !state.selMode; state.sel.clear(); filterAndRenderTx();
  });
  document.getElementById('sel-all').addEventListener('click', ()=>{
    const all = state.visibleKeys || [];
    if(state.sel.size === all.length) state.sel.clear(); else all.forEach(k=>state.sel.add(k));
    filterAndRenderTx();
  });
  document.addEventListener('click', async (e)=>{
    const q = e.target.closest('[data-mov-quick]');
    if(q){ state.movPeriod = movQuickPeriod(q.dataset.movQuick); renderMovimientos(); return; }
    const g = e.target.closest('[data-cat-group]');
    if(g){
      const k = g.dataset.catGroup;
      if(state.collapsedCats.has(k)) state.collapsedCats.delete(k); else state.collapsedCats.add(k);
      filterAndRenderTx(); return;
    }
    const w = e.target.closest('[data-sel]');
    if(w && state.selMode){
      const k = w.dataset.sel;
      if(state.sel.has(k)) state.sel.delete(k); else state.sel.add(k);
      w.classList.toggle('selected', state.sel.has(k));
      renderSelBar();
    }
  });
  document.getElementById('sel-cat').addEventListener('change', async (e)=>{
    const catId = Number(e.target.value); if(!catId) return;
    const {txs} = selectedItems(); const cat = getCategory(catId);
    if(!txs.length || !cat) return;
    if(!confirm(`¿Cambiar la categoría de ${txs.length} movimiento${txs.length===1?'':'s'} a "${cat.name}"? (la subcategoría se quita)`)){ renderSelBar(); return; }
    await applyBatchTxUpdate(txs.map(t=>({...t, categoryId:catId, subcategory:''})), txs.map(t=>({...t})), `${txs.length} movimiento${txs.length===1?'':'s'} pasaron a ${cat.name}`);
  });
  document.getElementById('sel-acc').addEventListener('change', async (e)=>{
    const accId = Number(e.target.value); if(!accId) return;
    const {txs} = selectedItems(); const acc = getAccount(accId);
    const movable = txs.filter(t=>t.source!=='installment' && t.accountId!==accId);
    const skipped = txs.length - movable.length;
    if(!movable.length){ toast('Nada que mover: ya están en esa cuenta o son cuotas de una compra a plazos'); renderSelBar(); return; }
    const mixed = movable.some(t=>{ const a=getAccount(t.accountId); return a && a.currency!==acc.currency; });
    if(!confirm(`¿Mover ${movable.length} movimiento${movable.length===1?'':'s'} a "${acc.name}"?` + (mixed ? '\n\nOjo: alguna cuenta tiene otra moneda; el importe no se convierte.' : '') + (skipped ? `\n\n${skipped} se dejan donde están (cuotas o ya en esa cuenta).` : ''))){ renderSelBar(); return; }
    await applyBatchTxUpdate(movable.map(t=>({...t, accountId:accId})), movable.map(t=>({...t})), `${movable.length} movimiento${movable.length===1?'':'s'} movidos a ${acc.name}`);
  });
  document.getElementById('sel-del').addEventListener('click', ()=>{
    const {txs, trs} = selectedItems(); const n = txs.length + trs.length;
    if(!n) return;
    const txIds = new Set(txs.map(t=>t.id)), trIds = new Set(trs.map(t=>t.id));
    state.transactions = state.transactions.filter(t=>!txIds.has(t.id));
    state.transfers = state.transfers.filter(t=>!trIds.has(t.id));
    state.sel.clear();
    renderAll();
    scheduleDelete(`${n} movimiento${n===1?'':'s'} eliminado${n===1?'':'s'}`,
      async ()=>{
        for(const t of txs){ await idb.delete('transactions', t.id); if(t.debtId) await revertDebtEffect(t.debtId, t.debtEffect, t.amount); }
        for(const t of trs) await idb.delete('transfers', t.id);
        await loadAll(); renderAll();
      },
      async ()=>{ await loadAll(); renderAll(); }
    );
  });
}

/* ================= Búsqueda: resultados extra en Más ================= */
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
    el.innerHTML = emptyState('🏦','Sin cuentas todavía','Crea tu primera cuenta (efectivo, banco, tarjeta…) con el formulario de abajo.','Crear cuenta','focus-account');
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
          <div data-detail="acct" data-detail-id="${a.id}" style="cursor:pointer;">
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
        ${isCard && a.paymentDay ? `<div class="stat-sub card-cycle-line" style="margin-top:6px; line-height:1.5;">${cardCycleLine(a)}</div>` : ''}
        ${isCard ? `
          <div class="stat-sub" style="margin-top:4px;">${a.paymentDay ? (cutoffDayFor(a)!==a.paymentDay ? `Corte el día ${cutoffDayFor(a)}, pago el día ${a.paymentDay}` : `Pago el día ${a.paymentDay} de cada mes`) : 'Sin día de pago configurado'}${a.paymentDay ? (a.autopayAccountId ? ' · Débito automático desde '+escapeHtml(getAccount(a.autopayAccountId)?.name||'cuenta eliminada') : ' · Sin débito automático') : ''}</div>
        ` : ''}
        <div class="acct-edit-row" id="acct-edit-${a.id}" style="display:none; flex-direction:column; gap:10px;">
          <div class="form-grid">
            <div class="field"><label>Corregir saldo</label><input type="number" step="0.01" data-acct-edit-input="${a.id}" value="${accountBalance(a.id).toFixed(2)}"></div>
            ${isCard ? `
              <div class="field"><label>Día de corte <span class="muted">opcional</span></label><input type="number" min="1" max="31" data-acct-edit-cutoff="${a.id}" value="${a.cutoffDay||''}" placeholder="Ej. 15"></div>
              <div class="field"><label>Día de pago mensual</label><input type="number" min="1" max="31" data-acct-edit-payday="${a.id}" value="${a.paymentDay||''}" placeholder="Ej. 15"></div>
              <div class="field"><label>Débito automático desde</label><select data-acct-edit-autopay="${a.id}"><option value="">Sin débito automático</option>${sortedAccounts().filter(x=>x.id!==a.id && x.type!=='tarjeta_credito').map(x=>`<option value="${x.id}" ${x.id===a.autopayAccountId?'selected':''}>${escapeHtml(x.name)} (${x.currency})</option>`).join('')}</select></div>
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
    autopaySel.innerHTML = '<option value="">Sin débito automático</option>' + sortedAccounts().filter(x=>x.type!=='tarjeta_credito').map(x=>`<option value="${x.id}">${escapeHtml(x.name)} (${x.currency})</option>`).join('');
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
  renderCardCashLine('presupuestos-card-cash', mStart, mEnd);
  const cardLater = cardCashView(mStart, mEnd).laterByCat;

  const incomeInput = document.getElementById('monthly-income-input');
  if(incomeInput && document.activeElement !== incomeInput) incomeInput.value = state.monthlyIncome || '';

  const expenseCats = sortedCategories('expense');

  const progEl = document.getElementById('presupuestos-progress');
  progEl.innerHTML = '';
  const active = expenseCats.filter(c => (state.budgets[c.id]>0) || spendByCat[c.id]);
  if(active.length===0){
    progEl.innerHTML = '<div class="empty-note">Fija límites abajo para ver tu progreso mensual aquí.</div>';
  } else {
    active.forEach(c => progEl.appendChild(budgetRowEl(catIcon(c)+' '+c.name, spendByCat[c.id]||0, state.budgets[c.id]||0, c.id, cardLater[c.id]||0)));
  }

  const editEl = document.getElementById('presupuestos-edit');
  editEl.innerHTML = expenseCats.map(c=>{
    const cfg = state.budgetConfig[c.id] || {mode:'fixed', value:0};
    const resolved = state.budgets[c.id] || 0;
    return budgetEditRowHtml(c, cfg, resolved);
  }).join('');

  // Ahorro / Inversión: transferencias categorizadas, tracked por separado de los gastos
  const transferCats = sortedCategories('transfer');
  const monthTransfers = txInRange(state.transfers, mStart, mEnd);
  const transferByCat = {};
  monthTransfers.forEach(t=>{
    if(!t.categoryId) return;
    const fromAcc = getAccount(t.fromAccountId);
    const amt = toBase(t.fromAmount, fromAcc?fromAcc.currency:state.baseCurrency);
    transferByCat[t.categoryId] = (transferByCat[t.categoryId]||0) + amt;
  });
  const trProgEl = document.getElementById('transfer-budget-progress');
  const trEditEl = document.getElementById('transfer-budget-edit');
  if(trProgEl && trEditEl){
    if(transferCats.length===0){
      trProgEl.innerHTML = '<div class="empty-note">Crea una categoría de transferencia abajo (ej. "Ahorro") para empezar.</div>';
      trEditEl.innerHTML = '';
    } else {
      const activeTr = transferCats.filter(c => (state.budgets[c.id]>0) || transferByCat[c.id]);
      trProgEl.innerHTML = activeTr.length===0 ? '<div class="empty-note">Fija objetivos abajo para ver tu progreso mensual aquí.</div>' : '';
      activeTr.forEach(c => trProgEl.appendChild(budgetRowEl(catIcon(c)+' '+c.name, transferByCat[c.id]||0, state.budgets[c.id]||0)));
      trEditEl.innerHTML = transferCats.map(c=>{
        const cfg = state.budgetConfig[c.id] || {mode:'fixed', value:0};
        const resolved = state.budgets[c.id] || 0;
        return budgetEditRowHtml(c, cfg, resolved);
      }).join('');
    }
  }

  renderCategoriesEditor('cats-expense', 'expense');
  renderCategoriesEditor('cats-income', 'income');
  renderCategoriesEditor('cats-transfer', 'transfer');
}
function budgetEditRowHtml(c, cfg, resolved){
  return `
    <div class="rate-row" style="flex-wrap:wrap; row-gap:6px;">
      <label style="flex:1 1 140px;">${catIcon(c)} ${escapeHtml(c.name)}</label>
      <div style="display:flex; align-items:center; gap:6px;">
        <input type="number" min="0" step="0.1" data-budget-value="${c.id}" value="${cfg.value||''}" placeholder="0" style="width:76px;">
        <select data-budget-mode="${c.id}" style="font-family:var(--font-body); font-size:12.5px; font-weight:500; border:1px solid var(--rule-strong); border-radius:7px; padding:5px 6px; background:var(--paper);">
          <option value="fixed" ${cfg.mode==='fixed'?'selected':''}>€</option>
          <option value="percent" ${cfg.mode==='percent'?'selected':''}>% sueldo</option>
        </select>
        ${cfg.mode==='percent' ? `<span class="muted" style="font-size:11px; white-space:nowrap;">≈ ${fmtMoney(resolved)}</span>` : ''}
      </div>
    </div>
  `;
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

/* ================= Informe: tendencias por periodo y categoría ================= */
const REPORT_OPTIONS = [{key:'month',label:'Mes actual'},{key:'30',label:'30 días'},{key:'90',label:'90 días'},{key:'12m',label:'12 meses'},{key:'year',label:'Este año'},{key:'lastyear',label:'Año pasado'},{key:'all',label:'Todo'}];
function mondayOfISO(iso){ const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return toISO(d); }
function getReportKey(){
  let k = 'year';
  try{ k = localStorage.getItem('libro_report_key') || 'year'; }catch(e){}
  return REPORT_OPTIONS.some(o=>o.key===k) ? k : 'year';
}
function reportRange(key){
  const t = todayISO(), T = new Date(t+'T00:00:00'), y = T.getFullYear(), m = T.getMonth();
  if(key==='month'){
    const prevLast = new Date(y, m, 0).getDate();
    return {start:toISO(new Date(y,m,1)), end:t, prevStart:toISO(new Date(y,m-1,1)), prevEnd:toISO(new Date(y,m-1,Math.min(T.getDate(),prevLast))), gran:'day', phrase:'el mes anterior'};
  }
  if(key==='30' || key==='90'){
    const n = Number(key), s = addDaysISO(t, -(n-1));
    return {start:s, end:t, prevStart:addDaysISO(s,-n), prevEnd:addDaysISO(s,-1), gran: key==='30' ? 'day' : 'week', phrase:`los ${n} días anteriores`};
  }
  if(key==='12m'){
    const s = toISO(new Date(y,m-11,1));
    return {start:s, end:t, prevStart:toISO(new Date(y,m-23,1)), prevEnd:addDaysISO(s,-1), gran:'month', phrase:'los 12 meses anteriores'};
  }
  if(key==='year') return {start:toISO(new Date(y,0,1)), end:t, prevStart:toISO(new Date(y-1,0,1)), prevEnd:toISO(new Date(y-1,m,T.getDate())), gran:'month', phrase:'el mismo periodo del año pasado'};
  if(key==='lastyear') return {start:toISO(new Date(y-1,0,1)), end:toISO(new Date(y-1,11,31)), prevStart:toISO(new Date(y-2,0,1)), prevEnd:toISO(new Date(y-2,11,31)), gran:'month', phrase:'el año anterior'};
  const s = firstActivityDate(), span = Math.round((T-new Date(s+'T00:00:00'))/86400000)+1;
  return {start:s, end:t, prevStart:null, prevEnd:null, gran: span>200 ? 'month' : (span>45 ? 'week' : 'day'), phrase:''};
}
function reportBucketOf(gran, date){ return gran==='day' ? date : (gran==='week' ? mondayOfISO(date) : date.slice(0,7)); }
function reportBuckets(r){
  const out = [], idx = new Map();
  const add = (id,label)=>{ idx.set(id, out.length); out.push({id,label,v:0}); };
  if(r.gran==='day'){
    for(let d=r.start; d<=r.end; d=addDaysISO(d,1)) add(d, String(Number(d.slice(8,10))));
  } else if(r.gran==='week'){
    for(let d=mondayOfISO(r.start); d<=r.end; d=addDaysISO(d,7)) add(d, new Date(d+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'}));
  } else {
    const c = new Date(r.start.slice(0,7)+'-01T00:00:00');
    while(toISO(c) <= r.end){
      add(toISO(c).slice(0,7), cap(c.toLocaleDateString('es-ES',{month:'short'})) + (r.gran==='month' && (c.getMonth()===0 || out.length===0) ? ' '+String(c.getFullYear()).slice(2) : ''));
      c.setMonth(c.getMonth()+1);
    }
  }
  return {list:out, idx};
}
function pctChange(a, b){ return b>0.004 ? (a-b)/b*100 : null; }
function computeReport(key, type, catId){
  const r = reportRange(key);
  const sums = (from, to)=>{
    const o = {inc:0, exp:0, byCat:{}};
    state.transactions.forEach(t=>{
      if(t.date<from || t.date>to) return;
      if(t.kind!=='income' && t.kind!=='expense') return;
      const v = sumBase([t]);
      if(t.kind==='income') o.inc += v; else o.exp += v;
      if(t.kind===type) o.byCat[t.categoryId] = (o.byCat[t.categoryId]||0) + v;
    });
    return o;
  };
  const cur = sums(r.start, r.end);
  const prev = r.prevStart ? sums(r.prevStart, r.prevEnd) : null;
  const B = reportBuckets(r);
  const catSeries = {};
  state.transactions.forEach(t=>{
    if(t.date<r.start || t.date>r.end || t.kind!==type) return;
    const i = B.idx.get(reportBucketOf(r.gran, t.date)); if(i==null) return;
    const v = sumBase([t]);
    if(!catSeries[t.categoryId]) catSeries[t.categoryId] = B.list.map(()=>0);
    catSeries[t.categoryId][i] += v;
    if(!catId || t.categoryId===catId) B.list[i].v += v;
  });
  return {r, cur, prev, buckets:B.list, catSeries, key, type, catId};
}
let reportModel = null;
function reportUnit(gran){ return gran==='day' ? 'día' : (gran==='week' ? 'semana' : 'mes'); }
function deltaHtml(a, b, lowerIsGood, phrase){
  const pc = pctChange(a, b);
  if(pc===null) return '';
  const bad = lowerIsGood ? pc>0 : pc<0;
  return `<span style="color:${Math.abs(pc)<0.5?'var(--text-faint)':(bad?'var(--over)':'var(--teal)')};">${pc>=0?'▲':'▼'} ${Math.abs(pc).toFixed(0)}%</span> <span class="muted">vs ${phrase}</span>`;
}
function renderReport(){
  const card = document.getElementById('report-card'); if(!card) return;
  const key = getReportKey();
  const type = state.rpType || 'expense';
  if(state.rpCat && !getCategory(state.rpCat)) state.rpCat = null;
  const m = computeReport(key, type, state.rpCat);
  reportModel = m; state.rpSel = null;
  const {r, cur, prev, buckets} = m;
  document.getElementById('rp-chips').innerHTML = REPORT_OPTIONS.map(o=>`<button type="button" class="date-chip${o.key===key?' active':''}" data-rp-key="${o.key}">${o.label}</button>`).join('');
  document.getElementById('rp-type').innerHTML = [['expense','Gastos'],['income','Ingresos']].map(([k,l])=>`<button type="button" class="date-chip${k===type?' active':''}" data-rp-type="${k}">${l}</button>`).join('')
    + (state.rpCat ? `<button type="button" class="date-chip active" data-rp-cat-clear="1">${catIcon(getCategory(state.rpCat))} ${escapeHtml(getCategory(state.rpCat).name)} ✕</button>` : '');
  const net = cur.inc - cur.exp, pnet = prev ? prev.inc - prev.exp : null;
  const phrase = r.phrase;
  document.getElementById('rp-totals').innerHTML = `
    <div><div class="stat-label">Ingresos</div><div class="stat-num income">${fmtMoney(cur.inc)}</div><div class="stat-sub">${prev ? deltaHtml(cur.inc, prev.inc, false, phrase) : ''}</div></div>
    <div><div class="stat-label">Gastos</div><div class="stat-num expense">${fmtMoney(cur.exp)}</div><div class="stat-sub">${prev ? deltaHtml(cur.exp, prev.exp, true, phrase) : ''}</div></div>
    <div><div class="stat-label">Balance</div><div class="stat-num">${fmtMoney(net)}</div><div class="stat-sub">${cur.inc>0 ? 'Ahorras el '+Math.round(net/cur.inc*100)+' % de tus ingresos' : ''}</div></div>`;
  const total = buckets.reduce((a,b)=>a+b.v,0);
  const unit = reportUnit(r.gran);
  const nonEmpty = buckets.filter(b=>b.v>0);
  const avg = buckets.length ? total/buckets.length : 0;
  const maxB = buckets.reduce((a,b)=> b.v>a.v ? b : a, {v:0});
  const catName = state.rpCat ? getCategory(state.rpCat).name : (type==='expense' ? 'Gastos' : 'Ingresos');
  document.getElementById('rp-sub').innerHTML = nonEmpty.length
    ? `<strong>${escapeHtml(catName)}</strong>: promedio ${fmtMoney(avg)} por ${unit} · el más alto: ${escapeHtml(maxB.label)} (${fmtMoney(maxB.v)})`
    : `Sin ${type==='expense'?'gastos':'ingresos'} en este periodo.`;
  reportChartHead();
  renderReportChart();
  // tendencia: 2ª mitad frente a 1ª
  const trEl = document.getElementById('rp-trend');
  if(buckets.length>=4 && total>0){
    const h = Math.floor(buckets.length/2);
    const a1 = buckets.slice(0,h).reduce((a,b)=>a+b.v,0)/h, a2 = buckets.slice(h).reduce((a,b)=>a+b.v,0)/(buckets.length-h);
    const pc = pctChange(a2, a1);
    if(pc===null) trEl.innerHTML = '';
    else {
      const bad = type==='expense' ? pc>0 : pc<0;
      const flat = Math.abs(pc)<5;
      trEl.innerHTML = `Tendencia: <span style="color:${flat?'var(--text-soft)':(bad?'var(--over)':'var(--teal)')}; font-weight:600;">${flat?'estable':(pc>0?'▲ subiendo':'▼ bajando')} (${pc>=0?'+':'−'}${Math.abs(pc).toFixed(0)} %)</span> <span class="muted">la 2ª mitad del periodo frente a la 1ª, por ${unit}</span>`;
    }
  } else trEl.innerHTML = '';
  // categorías
  const rows = Object.keys(cur.byCat).map(id=>({id:Number(id), total:cur.byCat[id], prevTotal: prev ? (prev.byCat[id]||0) : null, series:m.catSeries[id]||[]})).filter(x=>x.total>0.004).sort((a,b)=>b.total-a.total);
  const sumCats = rows.reduce((a,b)=>a+b.total,0) || 1;
  const col = type==='expense' ? 'var(--over)' : 'var(--teal)';
  const spark = (arr)=>{
    const mx = Math.max(...arr, 0.0001), n = arr.length;
    if(n<2) return '';
    const pts = arr.map((v,i)=> (i/(n-1)*54+1).toFixed(1)+','+(15-(v/mx)*13).toFixed(1)).join(' ');
    return `<svg class="rp-spark" viewBox="0 0 56 16" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  };
  document.getElementById('rp-cats').innerHTML = rows.length ? rows.map(x=>{
    const c = getCategory(x.id);
    const share = x.total/sumCats*100;
    return `<div class="rp-cat${state.rpCat===x.id?' sel':''}" data-rp-cat="${x.id}">
      <div class="rp-cat-top"><div class="rp-cat-name">${c ? catIcon(c)+' '+escapeHtml(c.name) : 'Sin categoría'}</div>${spark(x.series)}<div class="rp-cat-amt">${fmtMoney(x.total)}</div></div>
      <div class="budget-track"><div class="budget-fill" style="width:${share.toFixed(1)}%; background:${col};"></div></div>
      <div class="stat-sub">${share.toFixed(0)} % del total${x.prevTotal!==null ? ' · '+(deltaHtml(x.total, x.prevTotal, type==='expense', phrase) || '<span class="muted">sin datos antes</span>') : ''}</div>
    </div>`;
  }).join('') : '<div class="empty-note">Nada que mostrar en este periodo.</div>';
}
function reportChartHead(idx){
  const m = reportModel; if(!m) return;
  const el = document.getElementById('rp-head');
  const total = m.buckets.reduce((a,b)=>a+b.v,0);
  if(idx!=null && m.buckets[idx]){
    el.innerHTML = `<span class="trend-hover">${fmtMoney(m.buckets[idx].v)}</span> <span class="trend-period">${escapeHtml(m.buckets[idx].label)}</span>`;
  } else {
    const per = REPORT_OPTIONS.find(o=>o.key===m.key).label.toLowerCase();
    el.innerHTML = `<span class="${m.type==='expense'?'down':'up'}">${fmtMoney(total)}</span> <span class="trend-period">en ${per}</span>`;
  }
}
function renderReportChart(){
  const svg = document.getElementById('rp-chart'); const m = reportModel;
  if(!svg || !m) return;
  const W = Math.max(220, Math.round(svg.getBoundingClientRect().width) || 320), H = 150, padL = 4, padB = 18, padT = 8;
  const n = m.buckets.length, max = Math.max(...m.buckets.map(b=>b.v), 0.0001);
  const slot = (W-padL*2)/Math.max(1,n), bw = Math.max(2, Math.min(28, slot*0.7));
  const col = m.type==='expense' ? 'var(--over)' : 'var(--teal)';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const yOf = v => H-padB - (v/max)*(H-padB-padT);
  const total = m.buckets.reduce((a,b)=>a+b.v,0), avg = n ? total/n : 0;
  const every = Math.max(1, Math.ceil(n/ Math.floor((W-8)/34)));
  let html = '';
  m.buckets.forEach((b,i)=>{
    const x = padL + i*slot + (slot-bw)/2, y = yOf(b.v), h = Math.max(b.v>0?1.5:0, H-padB-y);
    html += `<rect class="rp-hit" data-rb="${i}" x="${(padL+i*slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H-padB}" fill="transparent"/>`;
    html += `<rect class="rp-bar" data-rbar="${i}" x="${x.toFixed(1)}" y="${(H-padB-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}" opacity="0.85"/>`;
    if(i%every===0 || i===n-1) html += `<text x="${(x+bw/2).toFixed(1)}" y="${H-4}" text-anchor="middle" class="rp-lbl">${escapeHtml(b.label)}</text>`;
  });
  if(avg>0) html += `<line x1="${padL}" x2="${W-padL}" y1="${yOf(avg).toFixed(1)}" y2="${yOf(avg).toFixed(1)}" stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="4 3"/>`;
  svg.innerHTML = html;
}
function setupReport(){
  document.addEventListener('click', (e)=>{
    const k = e.target.closest('[data-rp-key]');
    if(k){ try{ localStorage.setItem('libro_report_key', k.dataset.rpKey); }catch(err){} renderReport(); return; }
    const t = e.target.closest('[data-rp-type]');
    if(t){ state.rpType = t.dataset.rpType; state.rpCat = null; renderReport(); return; }
    if(e.target.closest('[data-rp-cat-clear]')){ state.rpCat = null; renderReport(); return; }
    const c = e.target.closest('[data-rp-cat]');
    if(c){ const id = Number(c.dataset.rpCat); state.rpCat = state.rpCat===id ? null : id; renderReport(); return; }
    const b = e.target.closest('[data-rb]');
    if(b && b.closest('#rp-chart')){
      const i = Number(b.dataset.rb);
      state.rpSel = state.rpSel===i ? null : i;
      document.querySelectorAll('#rp-chart .rp-bar').forEach(r=> r.setAttribute('opacity', state.rpSel==null || Number(r.dataset.rbar)===state.rpSel ? '0.85' : '0.3'));
      reportChartHead(state.rpSel);
      return;
    }
    if(e.target.closest('#rp-print')) printReport();
  });
  let rt; window.addEventListener('resize', ()=>{ clearTimeout(rt); rt = setTimeout(renderReportChart, 150); });
}
function printReport(){
  const m = reportModel; if(!m) return;
  const {r, cur, buckets} = m;
  const label = REPORT_OPTIONS.find(o=>o.key===m.key).label;
  const cats = Object.keys(cur.byCat).map(id=>({c:getCategory(Number(id)), v:cur.byCat[id]})).filter(x=>x.v>0.004).sort((a,b)=>b.v-a.v);
  const sum = cats.reduce((a,b)=>a+b.v,0) || 1;
  const win = window.open('', '_blank');
  if(!win){ toast('El navegador bloqueó la ventana del informe'); return; }
  win.document.write(`<html><head><title>Informe Libro</title><style>
    body{font-family:Arial,sans-serif; padding:30px; color:#222;} h1{font-size:20px;} h2{font-size:15px; margin-top:26px;} p{color:#666; font-size:13px;}
    table{width:100%; border-collapse:collapse; margin-top:10px;} th,td{border-bottom:1px solid #ddd; padding:7px; text-align:left; font-size:13px;} th{background:#f4f4f4;} td.r,th.r{text-align:right;}
  </style></head><body>
  <h1>Informe — Libro</h1><p>${label}: ${r.start} a ${r.end}</p>
  <table><tbody><tr><th>Ingresos</th><td class="r">${fmtMoney(cur.inc)}</td></tr><tr><th>Gastos</th><td class="r">${fmtMoney(cur.exp)}</td></tr><tr><th>Balance</th><td class="r">${fmtMoney(cur.inc-cur.exp)}</td></tr></tbody></table>
  <h2>${m.type==='expense'?'Gastos':'Ingresos'} por categoría</h2>
  <table><thead><tr><th>Categoría</th><th class="r">Total</th><th class="r">%</th></tr></thead><tbody>${cats.map(x=>`<tr><td>${escapeHtml(x.c?x.c.name:'Sin categoría')}</td><td class="r">${fmtMoney(x.v)}</td><td class="r">${(x.v/sum*100).toFixed(0)} %</td></tr>`).join('') || '<tr><td colspan="3">Sin datos.</td></tr>'}</tbody></table>
  <h2>Evolución por ${reportUnit(r.gran)}${state.rpCat ? ' — '+escapeHtml(getCategory(state.rpCat).name) : ''}</h2>
  <table><thead><tr><th>${reportUnit(r.gran)==='mes'?'Mes':(reportUnit(r.gran)==='semana'?'Semana desde':'Día')}</th><th class="r">${m.type==='expense'?'Gastos':'Ingresos'}</th></tr></thead><tbody>${buckets.map(b=>`<tr><td>${escapeHtml(b.label)}</td><td class="r">${fmtMoney(b.v)}</td></tr>`).join('')}</tbody></table>
  </body></html>`);
  win.document.close(); win.focus(); win.print();
}
setupReport();

/* ================= Rendering: Más (metas, recurrentes, recordatorios, deudas, compras a plazos) ================= */
function renderMas(){
  renderReport();
  renderGoals();
  renderRecurringList();
  renderReminders();
  renderDebts();
  renderInstallments();
  renderPersonSummary();
}

function renderGoals(){
  const goalsEl = document.getElementById('goals-list');
  goalsEl.innerHTML = '';
  if(state.goals.length===0){
    goalsEl.innerHTML = emptyState('🌱','Sin metas de ahorro','Define algo por lo que quieras ahorrar y sigue tu avance.','Crear meta','goal');
  } else {
    state.goals.forEach(g=>{
      const pct = g.targetAmount>0 ? Math.min(100, (g.savedAmount||0)/g.targetAmount*100) : 0;
      const monthlyResolved = g.monthlyTargetMode==='percent' ? (g.monthlyTargetValue/100)*state.monthlyIncome : (g.monthlyTargetMode==='fixed' ? g.monthlyTargetValue : 0);
      const monthlyLabel = g.monthlyTargetMode==='percent'
        ? `Aporte mensual objetivo: ${g.monthlyTargetValue}% de tu sueldo (≈ ${fmtMoney(monthlyResolved||0)}/mes)`
        : (g.monthlyTargetMode==='fixed' ? `Aporte mensual objetivo: ${fmtMoney(g.monthlyTargetValue)}/mes` : '');
      const div = document.createElement('div');
      div.className = 'budget-row';
      div.innerHTML = `
        <div class="budget-top" data-detail="goal" data-detail-id="${g.id}" style="cursor:pointer;" title="Ver detalle de la meta">
          <div class="budget-cat">${escapeHtml(g.name)} ${g.targetDate?`<span style="color:var(--text-faint); font-weight:400; font-size:12px;">· ${fmtDate(g.targetDate)}</span>`:''}</div>
          <div class="budget-nums">${fmtMoney(g.savedAmount||0)} / ${fmtMoney(g.targetAmount)}</div>
        </div>
        <div class="budget-track"><div class="budget-fill" style="width:${pct}%"></div></div>
        ${monthlyLabel ? `<div class="stat-sub" style="margin-top:6px;">${monthlyLabel}</div>` : ''}
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
            <div class="field">
              <label>Aporte mensual objetivo <span class="muted">opcional</span></label>
              <div style="display:flex; gap:6px;">
                <input type="number" step="0.01" min="0" data-goal-edit-monthly-value="${g.id}" value="${g.monthlyTargetValue||''}" placeholder="0" style="flex:1;">
                <select data-goal-edit-monthly-mode="${g.id}" style="font-family:var(--font-body); font-size:13px; border:1px solid var(--rule-strong); border-radius:8px; padding:0 8px; background:var(--paper);">
                  <option value="fixed" ${(g.monthlyTargetMode||'fixed')==='fixed'?'selected':''}>€</option>
                  <option value="percent" ${g.monthlyTargetMode==='percent'?'selected':''}>% sueldo</option>
                </select>
              </div>
            </div>
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
}

function renderRecurringList(){
  const recTypeNow = (document.querySelector('#rec-type-toggle .type-btn.active')||{}).dataset?.type || 'expense';
  populateCategorySelect(document.getElementById('rec-category'), recTypeNow);
  populateDebtSelect(document.getElementById('rec-debt'), recTypeNow);
  const recAccSel = document.getElementById('rec-account');
  const prevRecAcc = recAccSel.value;
  const accOptsWithBalance = sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)} — ${fmtMoney(accountBalance(a.id), a.currency)}</option>`).join('');
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
    recEl.innerHTML = emptyState('🔁','Sin recurrentes','Alquiler, suscripciones, sueldo… se registran solos en su fecha.','Añadir recurrente','recurring');
  } else {
    state.recurring.forEach(r=>{
      const freqLabel = r.frequency==='cycle' ? `Cada ${r.cycleDays} días${r.autoCharge?' · automático':''}` : ({weekly:'Semanal', monthly:'Mensual', yearly:'Anual'}[r.frequency] || r.frequency);
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
              <div class="field"><label>Cuenta origen</label><select data-rec-edit-tr-from="${r.id}">${sortedAccounts().map(a=>`<option value="${a.id}" ${a.id===r.fromAccountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
              <div class="field"><label>Cuenta destino</label><select data-rec-edit-tr-to="${r.id}">${sortedAccounts().map(a=>`<option value="${a.id}" ${a.id===r.toAccountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
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
          ${r.frequency==='cycle' && r.active!==false ? `<div class="acct-meta" style="margin-top:6px;">${r.autoCharge?'Próximo cobro automático':'Próximo'}: <strong>${fmtDate(cycleNextDue(r))}</strong></div><div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${cycleActionsHtml(r)}</div>` : ''}
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
            <div class="field"><label>Cuenta</label><select data-rec-edit-account="${r.id}">${sortedAccounts().map(a=>`<option value="${a.id}" ${a.id===r.accountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
            <div class="field"><label>Importe</label><input type="number" step="0.01" min="0" data-rec-edit-amount="${r.id}" value="${r.amount}"></div>
            <div class="field"><label>Categoría</label><select data-rec-edit-category="${r.id}">${sortedCategories(r.kind).map(c=>`<option value="${c.id}" ${c.id===r.categoryId?'selected':''}>${catIcon(c)} ${escapeHtml(c.name)}</option>`).join('')}</select></div>
            ${r.frequency==='cycle'
              ? `<div class="field"><label>Cada cuántos días</label><input type="number" min="1" step="1" data-rec-edit-cycledays="${r.id}" value="${r.cycleDays}"></div>
              <div class="field" style="grid-column:1/-1;"><label class="check-row"><input type="checkbox" data-rec-edit-auto="${r.id}" ${r.autoCharge?'checked':''}> Se cobra solo (débito automático)</label><span class="muted" style="font-size:12px;">Si la activas, se registran todos los cobros desde la fecha “Próximo” hasta hoy.</span></div>`
              : `<div class="field"><label>Frecuencia</label><select data-rec-edit-frequency="${r.id}">${['weekly','monthly','yearly'].map(f=>`<option value="${f}" ${f===r.frequency?'selected':''}>${({weekly:'Semanal',monthly:'Mensual',yearly:'Anual'})[f]}</option>`).join('')}</select></div>`}
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
}

function renderReminders(){
  const remEl = document.getElementById('reminders-list');
  remEl.innerHTML = '';
  if(state.reminders.length===0){
    remEl.innerHTML = emptyState('🔔','Sin recordatorios','Anota pagos o tareas para no olvidarlos.','Añadir recordatorio','reminder');
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
}

function renderDebts(){
  const debtsEl = document.getElementById('debts-list');
  debtsEl.innerHTML = '';
  if(state.debts.length===0){
    debtsEl.innerHTML = emptyState('🤝','Sin deudas ni préstamos','Registra lo que debes o te deben y ve los abonos.','Añadir deuda','debt');
  } else {
    state.debts.forEach(d=>{
      const original = d.originalAmount || d.amount;
      const paid = Math.max(0, original - d.amount);
      const pct = original>0 ? Math.min(100, paid/original*100) : 0;
      const div = document.createElement('div');
      div.className = 'account-card' + (d.settled ? ' hidden-acct' : '');
      div.innerHTML = `
        <div class="acct-main-row">
        <div data-detail="debt" data-detail-id="${d.id}" style="cursor:pointer;" title="Ver detalle de la deuda">
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
}

function renderInstallments(){
  const instAccSel = document.getElementById('inst-account');
  const prevInstAcc = instAccSel.value;
  instAccSel.innerHTML = sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join('');
  if(prevInstAcc) instAccSel.value = prevInstAcc;
  populateCategorySelect(document.getElementById('inst-category'), 'expense');
  populateDebtSelect(document.getElementById('inst-debt'), 'expense');

  const instEl = document.getElementById('installments-list');
  instEl.innerHTML = '';
  if(state.installments.length===0){
    instEl.innerHTML = emptyState('🧾','Sin compras a plazos','Registra compras en cuotas para verlas en tu flujo de caja.','Añadir compra a plazos','installment');
  } else {
    state.installments.forEach(it=>{
      const acc = getAccount(it.accountId);
      const pct = it.totalInstallments>0 ? Math.min(100, it.paidInstallments/it.totalInstallments*100) : 0;
      const nextDate = it.paidInstallments < it.totalInstallments ? installmentUpcomingDate(it) : null;
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
        <div class="stat-sub" style="margin-top:6px;">${it.payDay ? `${it.initialCount>1?it.initialCount+' al inicio · ':''}luego el día ${it.payDay} · ` : ''}Pagado ${fmtMoney(totals.paid, curr)} de ${fmtMoney(totals.total, curr)} · Adeudado ${fmtMoney(totals.remaining, curr)}</div>
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
            <div class="field"><label>Cuenta</label><select data-inst-edit-account="${it.id}">${sortedAccounts().map(a=>`<option value="${a.id}" ${a.id===it.accountId?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select></div>
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
    accSel.innerHTML = sortedAccounts().map(a=>`<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join('');
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
    const monthlyValue = parseFloat(document.getElementById('goal-monthly-value').value) || 0;
    const monthlyMode = document.getElementById('goal-monthly-mode').value;
    await idb.put('goals', {
      name, targetAmount, savedAmount:0,
      targetDate: document.getElementById('goal-date').value || null,
      monthlyTargetMode: monthlyValue>0 ? monthlyMode : null,
      monthlyTargetValue: monthlyValue>0 ? monthlyValue : null
    });
    await loadAll(); renderAll();
    document.getElementById('goal-name').value=''; document.getElementById('goal-target').value=''; document.getElementById('goal-date').value='';
    document.getElementById('goal-monthly-value').value=''; document.getElementById('goal-monthly-mode').value='fixed';
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
      const monthlyValue = parseFloat(document.querySelector(`[data-goal-edit-monthly-value="${id}"]`).value) || 0;
      const monthlyMode = document.querySelector(`[data-goal-edit-monthly-mode="${id}"]`).value;
      if(!name || !targetAmount || targetAmount<=0){ toast('Revisa los datos'); return; }
      await idb.put('goals', {...goal, name, targetAmount, savedAmount, targetDate,
        monthlyTargetMode: monthlyValue>0 ? monthlyMode : null,
        monthlyTargetValue: monthlyValue>0 ? monthlyValue : null
      });
      await loadAll(); renderAll();
      toast('Meta actualizada');
      return;
    }
  });
}

/* ===== Fraccionar un gasto de tarjeta en cuotas (p = 'qk' Añadir rápido, 'tx' Movimientos) ===== */
function splitAccount(p){
  const sel = document.getElementById(p+'-account');
  return sel ? getAccount(Number(sel.value)) : null;
}
function splitAvailable(p){
  const kind = p==='qk' ? state.qkType : state.txType;
  if(kind!=='expense') return false;
  if(p==='tx' && state.editingTxId) return false;
  const a = splitAccount(p);
  return !!a && a.type==='tarjeta_credito';
}
function splitActive(p){
  const t = document.getElementById(p+'-split-toggle');
  return !!t && t.checked && splitAvailable(p);
}
function splitValues(p){
  const total = parseFloat(document.getElementById(p+'-amount').value);
  const n = parseInt(document.getElementById(p+'-split-n').value, 10);
  const real = parseFloat(document.getElementById(p+'-split-real').value);
  const k = parseInt(document.getElementById(p+'-split-initial').value, 10);
  const day = parseInt(document.getElementById(p+'-split-day').value, 10);
  return {total, n, real: real>0 ? real : null, k: k>0 ? k : null, day: day>0 ? day : null};
}
/* Opciones de calendario: null si no se pidió nada especial (modo de siempre), o {initialCount, payDay} */
function splitCalendar(n, k, day, dateISO){
  if(!k && !day) return {opts:null};
  if(k && k>n-1) return {error:'Las cuotas al inicio deben ser menos que el total ('+(n-1)+' como máximo)'};
  if(day && day>31) return {error:'El día debe estar entre 1 y 31'};
  const initialCount = k || 1;
  if(initialCount===1 && !day) return {opts:null};
  return {opts:{initialCount, payDay: day || Number(dateISO.slice(8,10))}};
}
function splitSchedule(total, n, real){
  return real ? new Array(n).fill(Math.round(real*100)/100) : buildEqualSchedule(total, n);
}
/* Corte al que entra una compra hecha en dateISO: el primer corte igual o posterior a esa fecha */
function cutoffForPurchase(a, dateISO){
  const cd = cutoffDayFor(a);
  if(!cd) return null;
  const d = new Date(dateISO+'T00:00:00');
  let cutoff = localISO(dateForDayInMonth(d.getFullYear(), d.getMonth(), cd));
  if(cutoff < dateISO) cutoff = nextMonthlyOnDay(cutoff, cd);
  const pay = a.paymentDay ? paymentDateForCutoff(cutoff, a.paymentDay) : null;
  return {cutoff, pay};
}
function updateSplitHint(p){
  const field = document.getElementById(p+'-split-field');
  if(!field) return;
  const avail = splitAvailable(p);
  const toggle = document.getElementById(p+'-split-toggle');
  if(!avail) toggle.checked = false;
  field.style.display = avail ? '' : 'none';
  const on = avail && toggle.checked;
  document.getElementById(p+'-split-body').style.display = on ? 'block' : 'none';
  // una compra fraccionada no se liga a una deuda
  const debtSel = document.getElementById(p+'-debt');
  if(on){ debtSel.value = ''; updateDebtUI(p); }
  const debtField = debtSel.closest('.field');
  if(debtField) debtField.style.display = on ? 'none' : '';
  const hint = document.getElementById(p+'-split-hint');
  if(!on){ hint.textContent = ''; return; }
  const nInput = document.getElementById(p+'-split-n').value;
  document.querySelectorAll('[data-split-target="'+p+'"]').forEach(b=> b.classList.toggle('active', b.dataset.splitN===String(nInput)));
  const {total, n, real, k, day} = splitValues(p);
  if(!total || total<=0 || !n || n<2){ hint.textContent = 'Indica el importe y 2 cuotas o más.'; return; }
  const acc = splitAccount(p), cur = acc.currency;
  const sched = splitSchedule(total, n, real);
  const sum = Math.round(sched.reduce((s,v)=>s+v,0)*100)/100;
  let line;
  if(real){
    line = `${n} cuotas de ${fmtMoney(real, cur)} · total a pagar ${fmtMoney(sum, cur)}`;
    const interest = Math.round((sum-total)*100)/100;
    if(interest>0.004) line += ` · intereses ${fmtMoney(interest, cur)}`;
    else if(interest<-0.004) line += ' · ojo: suma menos que el importe';
  } else {
    line = `${n} cuotas de ${fmtMoney(sched[0], cur)}` + (Math.abs(sched[n-1]-sched[0])>0.004 ? ' (la última ajusta el redondeo)' : '');
  }
  const date = document.getElementById(p+'-date').value || todayISO();
  const c = cutoffForPurchase(acc, date);
  const cal = splitCalendar(n, k, day, date);
  if(cal.error){ hint.innerHTML = line + '<br><span style="color:var(--over);">'+cal.error+'</span>'; return; }
  if(cal.opts){
    const fake = {startDate:date, initialCount:cal.opts.initialCount, payDay:cal.opts.payDay};
    const ini = cal.opts.initialCount;
    line += '<br>' + (ini===1 ? 'Cuota 1' : 'Cuotas 1 a '+ini) + ' el ' + fmtDate(date) + (c ? ', entra en el corte del ' + fmtDate(c.cutoff) + (c.pay ? ' (se paga el ' + fmtDate(c.pay) + ')' : '') : '')
      + '.<br>Cuota ' + (ini+1) + ' el ' + fmtDate(installmentDateAt(fake, ini)) + (n>ini+1 ? ', y luego el día ' + cal.opts.payDay + ' de cada mes hasta el ' + fmtDate(installmentDateAt(fake, n-1)) : '') + '.';
  } else {
    line += '<br>Primera cuota el ' + fmtDate(date) + (c ? ', entra en el corte del ' + fmtDate(c.cutoff) + (c.pay ? ' (se paga el ' + fmtDate(c.pay) + ')' : '') : '') + '. Luego, el mismo día de cada mes.';
  }
  hint.innerHTML = line;
}
function resetSplit(p){
  document.getElementById(p+'-split-toggle').checked = false;
  document.getElementById(p+'-split-n').value = '';
  document.getElementById(p+'-split-real').value = '';
  document.getElementById(p+'-split-initial').value = '';
  document.getElementById(p+'-split-day').value = '';
  updateSplitHint(p);
}
/* Crea la compra a plazos en lugar del gasto único (así no se cuenta dos veces) */
async function createSplitPlan(p, accountId, categoryId, subcategory, dateISO, note){
  const {total, n, real, k, day} = splitValues(p);
  if(!total || total<=0){ toast('Introduce un importe válido'); return null; }
  if(!n || n<2){ toast('Indica 2 cuotas o más'); return null; }
  const cal = splitCalendar(n, k, day, dateISO);
  if(cal.error){ toast(cal.error); return null; }
  const cat = getCategory(categoryId);
  const schedule = splitSchedule(total, n, real);
  const sum = Math.round(schedule.reduce((s,v)=>s+v,0)*100)/100;
  await idb.put('installments', {
    name: note || (cat ? cat.name : 'Compra a plazos'),
    accountId, amount: schedule[0], totalAmount: sum, schedule, totalInstallments: n, paidInstallments: 0,
    categoryId, subcategory: subcategory || '', startDate: dateISO, lastGenerated: null,
    note: '', person: '', debtId: null, active: true,
    ...(cal.opts ? {initialCount: cal.opts.initialCount, payDay: cal.opts.payDay} : {})
  });
  await loadAll();
  await generateDueInstallments();
  await loadAll(); renderAll();
  const acc = getAccount(accountId);
  const interest = Math.round((sum-total)*100)/100;
  toast(`Fraccionado en ${n} cuotas de ${fmtMoney(schedule[0], acc?acc.currency:state.baseCurrency)}` + (interest>0.004 ? ` · intereses ${fmtMoney(interest, acc?acc.currency:state.baseCurrency)}` : ''));
  return {schedule, sum, interest};
}
document.addEventListener('click', (e)=>{
  const b = e.target.closest('[data-trend-days]');
  if(!b) return;
  try{ localStorage.setItem('libro_trend_days', b.dataset.trendDays); }catch(err){}
  renderBalanceTrend();
});
setupTrendScrub();
function setupSplit(){
  ['qk','tx'].forEach(p=>{
    const refresh = ()=> updateSplitHint(p);
    document.getElementById(p+'-account').addEventListener('change', refresh);
    document.getElementById(p+'-split-toggle').addEventListener('change', refresh);
    [p+'-amount', p+'-split-n', p+'-split-real', p+'-split-initial', p+'-split-day'].forEach(id=> document.getElementById(id).addEventListener('input', refresh));
    document.getElementById(p+'-date').addEventListener('change', refresh);
    document.querySelectorAll('#'+p+'-type-toggle .type-btn').forEach(b=> b.addEventListener('click', refresh));
  });
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('[data-split-n]');
    if(!b) return;
    const p = b.dataset.splitTarget;
    document.getElementById(p+'-split-n').value = b.dataset.splitN;
    updateSplitHint(p);
  });
}

let cycleRegisterId = null;
/* ================= Events: ciclos, recurrentes, recordatorios, deudas y compras a plazos ================= */
function cycleNextHint(dateISO){
  const r = state.recurring.find(x=>x.id===cycleRegisterId);
  if(!r) return;
  const days = Math.max(1, Number(r.cycleDays)||30);
  document.getElementById('cycle-next').textContent = 'El siguiente vencimiento será el ' + fmtDate(addDaysISO(dateISO, days)) + ' (' + days + ' días desde esa fecha).';
}
function openCycleRegister(id){
  const r = state.recurring.find(x=>x.id===id);
  if(!r) return;
  cycleRegisterId = id;
  const acc = getAccount(r.accountId), cat = getCategory(r.categoryId);
  document.getElementById('cycle-summary').innerHTML = '<strong style="color:var(--text);">' + escapeHtml(r.note || (cat?cat.name:'Renovación')) + '</strong> · ' + fmtMoney(r.amount, acc?acc.currency:state.baseCurrency) + ' · cada ' + r.cycleDays + ' días';
  document.getElementById('cy-date').max = todayISO();
  setDateValue('cy', todayISO());
  cycleNextHint(todayISO());
  document.getElementById('cycle-overlay').style.display = 'flex';
  pushOverlayState();
}
function setupCycleActions(){
  document.getElementById('cycle-close').addEventListener('click', ()=> history.back());
  document.getElementById('cycle-overlay').addEventListener('click', (e)=>{ if(e.target.id==='cycle-overlay') history.back(); });
  document.getElementById('cy-date').addEventListener('change', (e)=>{
    renderDateChips('cy');
    if(e.target.value) cycleNextHint(e.target.value);
  });
  document.getElementById('cycle-confirm').addEventListener('click', async ()=>{
    const id = cycleRegisterId;
    const date = document.getElementById('cy-date').value || todayISO();
    if(date > todayISO()){ toast('La fecha no puede ser futura; usa Posponer'); return; }
    history.back();   // cierra la ventana
    await registerCycle(id, date);
  });
  document.addEventListener('click', (e)=>{
    // los chips se repintan al elegir, así que no se busca por ancestro (#cycle-overlay), sino por su destino
    const pick = e.target.closest('[data-date-pick]');
    if(pick && pick.dataset.dateTarget==='cy'){ cycleNextHint(pick.dataset.datePick); return; }
    const pay = e.target.closest('[data-cycle-pay]');
    if(pay){ e.preventDefault(); openCycleRegister(Number(pay.dataset.cyclePay)); }
  });
  document.addEventListener('change', (e)=>{
    const pp = e.target.closest && e.target.closest('[data-cycle-postpone]');
    if(pp && pp.value){ postponeCycle(Number(pp.dataset.cyclePostpone), pp.value); }
  });
}
function setupRecurring(){
  let recType = 'expense';
  const syncCycleField = ()=>{
    const isCycle = document.getElementById('rec-frequency').value==='cycle';
    document.getElementById('rec-cycle-field').style.display = isCycle ? 'block' : 'none';
    document.getElementById('rec-auto-field').style.display = isCycle ? 'block' : 'none';
  };
  document.getElementById('rec-frequency').addEventListener('change', syncCycleField);
  syncCycleField();
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
      const freqVal = document.getElementById('rec-frequency').value;
      const cycleDays = Math.round(Number(document.getElementById('rec-cycle-days').value));
      if(freqVal==='cycle' && (!cycleDays || cycleDays<1)){ toast('Indica cada cuántos días se renueva'); return; }
      await idb.put('recurring', {
        accountId: Number(document.getElementById('rec-account').value),
        kind: recType,
        amount,
        categoryId: Number(document.getElementById('rec-category').value),
        subcategory: '',
        frequency: freqVal,
        ...(freqVal==='cycle' ? {cycleDays, nextDue: startDate, autoCharge: document.getElementById('rec-auto').checked} : {}),
        startDate,
        lastGenerated: null,
        note: document.getElementById('rec-note').value.trim(),
        person: document.getElementById('rec-person').value.trim(),
        debtId: resolvedDebtId,
        debtEffect: resolvedDebtId ? state.recDebtMode : null,
        active: true
      });
      document.getElementById('rec-auto').checked=false; document.getElementById('rec-amount').value=''; document.getElementById('rec-note').value=''; document.getElementById('rec-person').value='';
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
      const freqEl = document.querySelector(`[data-rec-edit-frequency="${id}"]`);
      const cycleEl = document.querySelector(`[data-rec-edit-cycledays="${id}"]`);
      const frequency = freqEl ? freqEl.value : 'cycle';
      const cycleDays = cycleEl ? Math.round(Number(cycleEl.value)) : null;
      const autoEl = document.querySelector(`[data-rec-edit-auto="${id}"]`);
      if(cycleEl && (!cycleDays || cycleDays<1)){ toast('Indica los días del ciclo'); return; }
      const note = document.querySelector(`[data-rec-edit-note="${id}"]`).value.trim();
      const person = document.querySelector(`[data-rec-edit-person="${id}"]`).value.trim();
      const debtIdVal = document.querySelector(`[data-rec-edit-debt="${id}"]`).value;
      const debtEffect = document.querySelector(`[data-rec-edit-debtmode="${id}"]`).value;
      if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
      await idb.put('recurring', {...r, accountId, amount, categoryId, frequency, ...(cycleEl ? {cycleDays, autoCharge: !!(autoEl && autoEl.checked)} : {}), note, person, debtId: debtIdVal ? Number(debtIdVal) : null, debtEffect: debtIdVal ? debtEffect : null});
      await loadAll();
      if(cycleEl && autoEl && autoEl.checked){ await generateDueRecurring(); await loadAll(); }
      renderAll();
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

/* ================= Rendering: Ajustes ================= */
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

  refreshAutoBackupUI();
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
  renderResumenLayoutSettings();
}

/* ================= Global render ================= */
function renderAll(){
  renderResumen();
  renderMovimientos();
  renderCuentas();
  renderPresupuestos();
  renderMas();
  renderAjustes();
  refreshDetailModal();
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
  detailRequest = null;
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
      if(!isTransfer){ populateCategorySelect(document.getElementById('tx-category'), state.txType); populateSubcategorySelect(); populateDebtUnified('tx', state.txType, false); }
    });
  });

  document.getElementById('tx-debt').addEventListener('change', ()=> updateDebtUI('tx'));

  document.getElementById('tx-category').addEventListener('change', populateSubcategorySelect);
  setDateValue('tx', todayISO());
  setDateValue('tr', todayISO());
  ['tx','tr'].forEach(p=> document.getElementById(p+'-date').addEventListener('change', ()=> renderDateChips(p)));

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
      const catVal = document.getElementById('tr-category').value;
      const trData = {fromAccountId:fromId, toAccountId:toId, fromAmount, toAmount, date:document.getElementById('tr-date').value, note:document.getElementById('tr-note').value.trim(), categoryId: catVal ? Number(catVal) : null};
      if(state.editingTransferId){
        trData.id = state.editingTransferId;
        await idb.put('transfers', trData);
        await loadAll(); renderAll();
        exitEditMode();
        toast('Transferencia actualizada');
      } else {
        await idb.put('transfers', trData);
        await loadAll(); renderAll();
        document.getElementById('tr-amount-from').value=''; document.getElementById('tr-amount-to').value=''; document.getElementById('tr-note').value=''; document.getElementById('tr-category').value='';
        toast('Transferencia guardada');
      }
    } else {
      const amount = parseFloat(document.getElementById('tx-amount').value);
      if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
      if(splitActive('tx')){
        const accId = Number(document.getElementById('tx-account').value);
        const res = await createSplitPlan('tx', accId, Number(document.getElementById('tx-category').value), document.getElementById('tx-subcategory').value, document.getElementById('tx-date').value || todayISO(), document.getElementById('tx-note').value.trim());
        if(!res) return;
        document.getElementById('tx-amount').value=''; document.getElementById('tx-note').value='';
        resetSplit('tx');
        rememberAccount(accId);
        return;
      }
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
        document.getElementById('tx-amount').value=''; document.getElementById('tx-note').value=''; document.getElementById('tx-debt').value=''; updateDebtUI('tx'); rememberAccount(t.accountId);
        toast((t.kind==='expense' && budgetAlertMessage(t.categoryId)) || 'Movimiento guardado');
      }
    }
  });

  document.getElementById('tx-cancel-edit').addEventListener('click', exitEditMode);
}

function enterEditMode(tx){
  state.editingTxId = tx.id;
  updateSplitHint('tx');
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
  populateDebtUnified('tx', tx.kind, false);
  document.getElementById('tx-debt').value = tx.debtId ? String(tx.debtId) : '';
  updateDebtUI('tx');
  setDateValue('tx', tx.date);
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
  setDateValue('tr', tr.date);
  populateTransferCategorySelects();
  document.getElementById('tr-category').value = tr.categoryId || '';
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
  updateSplitHint('tx');
  document.getElementById('tx-form-title').textContent = 'Añadir movimiento';
  document.getElementById('tx-submit-btn').textContent = 'Guardar movimiento';
  document.getElementById('tx-cancel-edit').style.display = 'none';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  setDateValue('tx', todayISO());
  document.getElementById('tr-amount-from').value = '';
  document.getElementById('tr-amount-to').value = '';
  document.getElementById('tr-note').value = '';
  setDateValue('tr', todayISO());
  populateDebtUnified('tx', state.txType, false);
}

/* ===== Pantallas vacías con acción ===== */
function emptyState(icon, title, text, btnLabel, action){
  return `<div class="empty-state"><div class="empty-ico">${icon}</div><div class="empty-title">${title}</div><div class="empty-text">${text}</div>${btnLabel?`<button type="button" class="btn-secondary btn-sm" data-empty-action="${action}">${btnLabel}</button>`:''}</div>`;
}
const EMPTY_ACTIONS = {
  'add-tx': ()=> openQuickAdd(),
  'goal': ()=> document.getElementById('open-goal-modal').click(),
  'recurring': ()=> document.getElementById('open-recurring-modal').click(),
  'reminder': ()=> document.getElementById('open-reminder-modal').click(),
  'debt': ()=> document.getElementById('open-debt-modal').click(),
  'installment': ()=> document.getElementById('open-installment-modal').click(),
  'goto-cuentas': ()=> document.querySelectorAll('.nav-btn[data-view="cuentas"]')[0].click(),
  'goto-presupuestos': ()=> document.querySelectorAll('.nav-btn[data-view="presupuestos"]')[0].click(),
  'focus-account': ()=>{ const i=document.getElementById('acc-name'); if(i){ i.scrollIntoView({behavior:'smooth',block:'center'}); i.focus(); } },
};
document.addEventListener('click', (e)=>{
  const b = e.target.closest('[data-empty-action]');
  if(!b) return;
  const fn = EMPTY_ACTIONS[b.dataset.emptyAction];
  if(fn) fn();
});

/* ================= Quick add (Resumen) ================= */
function renderQuickAdd(){
  const isTransfer = state.qkType === 'transfer';
  document.getElementById('qk-category-field').style.display = isTransfer ? 'none' : 'block';
  document.getElementById('qk-fields-normal').style.display = isTransfer ? 'none' : 'grid';
  document.getElementById('qk-extra-normal').style.display = isTransfer ? 'none' : 'grid';
  document.getElementById('qk-fields-transfer').style.display = isTransfer ? 'grid' : 'none';
  if(isTransfer){
    populateAccountSelects();
    populateTransferCategorySelects();
  } else {
    populateCategorySelect(document.getElementById('qk-category'), state.qkType);
    populateQkSubcategory();
    populateQkDebtSelect();
    renderQkCategoryGrid();
  }
  setDateValue('qk', document.getElementById('qk-date').value || todayISO());
  updateSplitHint('qk');
  renderQkRepeat();
}
/* ===== Repetir último gasto ===== */
function lastManualExpense(){
  let best = null;
  state.transactions.forEach(t=>{
    if(t.kind!=='expense' || t.source) return;          // solo gastos escritos a mano
    if(!getCategory(t.categoryId) || !getAccount(t.accountId)) return;
    if(!best || t.id > best.id) best = t;
  });
  return best;
}
function renderQkRepeat(){
  const el = document.getElementById('qk-repeat');
  if(!el) return;
  const t = state.qkType==='expense' ? lastManualExpense() : null;
  if(!t){ el.style.display='none'; el.innerHTML=''; return; }
  const cat = getCategory(t.categoryId), acc = getAccount(t.accountId);
  const label = (t.note || cat.name);
  el.style.display = 'block';
  el.innerHTML = `<button type="button" class="qk-repeat-btn" data-qk-repeat="${t.id}">
    <span class="qk-repeat-ico">↻</span>
    <span class="qk-repeat-txt"><strong>Repetir último gasto</strong><span>${escapeHtml(label)} · ${fmtMoney(t.amount, acc.currency)}</span></span>
  </button>`;
}
function applyQkRepeat(id){
  const t = state.transactions.find(x=>x.id===Number(id));
  if(!t) return;
  const allCats = sortedCategories('expense');
  const idx = allCats.findIndex(c=>c.id===t.categoryId);
  if(idx >= QK_CATEGORY_LIMIT) state.qkCategoryExpanded = true;
  document.getElementById('qk-amount').value = t.amount;
  document.getElementById('qk-account').value = String(t.accountId);
  document.getElementById('qk-category').value = String(t.categoryId);
  populateQkSubcategory();
  const sub = document.getElementById('qk-subcategory');
  if([...sub.options].some(o=>o.value===(t.subcategory||''))) sub.value = t.subcategory||'';
  renderQkCategoryGrid();
  document.getElementById('qk-note').value = t.note || '';
  setDateValue('qk', todayISO());
  toast('Datos copiados · revisa y pulsa Listo');
}
/* ================= Quick add (Resumen): categorías, subcategorías y formulario ================= */
const QK_CATEGORY_LIMIT = 7;
function renderQkCategoryGrid(){
  const allCats = sortedCategories(state.qkType);
  const expanded = state.qkCategoryExpanded || allCats.length <= QK_CATEGORY_LIMIT;
  const cats = expanded ? allCats : allCats.slice(0, QK_CATEGORY_LIMIT);
  const currentVal = document.getElementById('qk-category').value;
  const grid = document.getElementById('qk-category-grid');
  let html = cats.map((c,i)=>{
    const color = PALETTE[i % PALETTE.length];
    const selected = String(c.id)===String(currentVal);
    return `
      <button type="button" class="cat-grid-item ${selected?'selected':''}" data-qk-cat-pick="${c.id}">
        <span class="cat-grid-circle" style="background:${color}26; border-color:${selected?color:'transparent'};">${catIcon(c)}</span>
        <span class="cat-grid-label">${escapeHtml(c.name)}</span>
      </button>
    `;
  }).join('');
  if(!expanded){
    html += `
      <button type="button" class="cat-grid-item" data-qk-cat-more="1">
        <span class="cat-grid-circle" style="background:var(--paper-raised); border-color:var(--rule-strong); color:var(--text-soft);">+${allCats.length-QK_CATEGORY_LIMIT}</span>
        <span class="cat-grid-label">Ver más</span>
      </button>
    `;
  }
  grid.innerHTML = html;
}
function renderDateChips(p){
  const input = document.getElementById(p+'-date');
  if(!input) return;
  const today = todayISO();
  const y = new Date(today+"T00:00:00"); y.setDate(y.getDate()-1);
  const d2 = new Date(today+"T00:00:00"); d2.setDate(d2.getDate()-2);
  const chips = [[today,'Hoy'],[toISO(y),'Ayer'],[toISO(d2),'Hace 2 días']];
  const current = input.value || today;
  document.getElementById(p+'-date-chips').innerHTML = chips.map(([d,label])=>
    `<button type="button" class="date-chip ${current===d?'active':''}" data-date-pick="${d}" data-date-target="${p}">${label}</button>`
  ).join('');
  // El calendario muestra la fecha elegida cuando no es ninguna de las tres rápidas
  const custom = !chips.some(([d])=>d===current);
  document.getElementById(p+'-date-cal').classList.toggle('active', custom);
  document.getElementById(p+'-date-cal-label').textContent = custom ? '📅 '+fmtDate(current) : '📅';
}
function renderQkDateChips(){ renderDateChips('qk'); }
function setDateValue(p, v){
  document.getElementById(p+'-date').value = v;
  renderDateChips(p);
  if(p==='qk' || p==='tx') updateSplitHint(p);
}
/* Deuda relacionada: una sola lista con dos grupos; el tipo de movimiento se deduce de la opción elegida.
   p = 'qk' (Añadir rápido) o 'tx' (formulario de Movimientos) */
function populateDebtUnified(p, kind, keep){
  const sel = document.getElementById(p+'-debt');
  const prevVal = sel.value;
  const optHtml = (d, mode)=> `<option value="${d.id}" data-mode="${mode}">${escapeHtml(d.person)} — ${fmtMoney(d.amount)}${d.note?' ('+escapeHtml(d.note)+')':''}</option>`;
  const pay = debtsForKind(kind), loan = debtsForLoanKind(kind);
  let html = '<option value="">Ninguna</option>';
  if(pay.length) html += `<optgroup label="Pago / abono">${pay.map(d=>optHtml(d,'payment')).join('')}</optgroup>`;
  html += `<optgroup label="Préstamo nuevo (suma)">${loan.map(d=>optHtml(d,'loan')).join('')}<option value="__new__" data-mode="loan">+ Nueva persona…</option></optgroup>`;
  sel.innerHTML = html;
  sel.value = '';
  if(keep && prevVal && [...sel.options].some(o=>o.value===prevVal)) sel.value = prevVal;
  updateDebtUI(p);
}
function updateDebtUI(p){
  const sel = document.getElementById(p+'-debt');
  const val = sel.value;
  const field = document.getElementById(p+'-debt-mode-field');
  const modeKey = p+'DebtMode';
  if(!val){
    state[modeKey] = 'payment';
    field.style.display = 'none';
    document.getElementById(p+'-debt-newperson-field').style.display = 'none';
    document.getElementById(p+'-debt-newperson').value = '';
    return;
  }
  const mode = sel.options[sel.selectedIndex].dataset.mode === 'loan' ? 'loan' : 'payment';
  state[modeKey] = mode;
  field.style.display = 'block';
  document.querySelectorAll('#'+p+'-debt-mode-toggle .type-btn').forEach(b=> b.classList.toggle('active', b.dataset.debtmode===mode));
  document.getElementById(p+'-debt-newperson-field').style.display = val==='__new__' ? 'block' : 'none';
}
function populateQkDebtSelect(){ populateDebtUnified('qk', state.qkType, false); }
function updateQkDebtUI(){ updateDebtUI('qk'); }
function populateQkSubcategory(){
  const catId = Number(document.getElementById('qk-category').value);
  const cat = getCategory(catId);
  const sel = document.getElementById('qk-subcategory');
  const subs = (cat && cat.subcategories) ? cat.subcategories : [];
  sel.innerHTML = '<option value="">Ninguna</option>' + subs.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sel.value = '';
  document.getElementById('qk-subcategory-field').style.display = subs.length ? 'block' : 'none';
}
function setupQuickAdd(){
  document.getElementById('qk-type-toggle').querySelectorAll('.type-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#qk-type-toggle .type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.qkType = btn.dataset.type;
      state.qkCategoryExpanded = false;
      const isTransfer = state.qkType === 'transfer';
      document.getElementById('qk-category-field').style.display = isTransfer ? 'none' : 'block';
      document.getElementById('qk-fields-normal').style.display = isTransfer ? 'none' : 'grid';
      document.getElementById('qk-extra-normal').style.display = isTransfer ? 'none' : 'grid';
      document.getElementById('qk-fields-transfer').style.display = isTransfer ? 'grid' : 'none';
      if(!isTransfer){
        populateCategorySelect(document.getElementById('qk-category'), state.qkType);
        populateQkSubcategory();
        populateQkDebtSelect();
        renderQkCategoryGrid();
      } else {
        populateAccountSelects();
        populateTransferCategorySelects();
      }
      renderQkRepeat();
    });
  });
  document.getElementById('qk-debt').addEventListener('change', updateQkDebtUI);
  document.getElementById('qk-category').addEventListener('change', populateQkSubcategory);
  setDateValue('qk', todayISO());
  document.getElementById('qk-date').addEventListener('change', ()=> renderDateChips('qk'));

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
    const rep = e.target.closest('[data-qk-repeat]');
    if(rep){ applyQkRepeat(rep.dataset.qkRepeat); return; }
    const catMore = e.target.closest('[data-qk-cat-more]');
    if(catMore){
      state.qkCategoryExpanded = true;
      renderQkCategoryGrid();
      return;
    }
    const datePick = e.target.closest('[data-date-pick]');
    if(datePick){
      setDateValue(datePick.dataset.dateTarget, datePick.dataset.datePick);
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
      const catVal = document.getElementById('qk-tr-category').value;
      await idb.put('transfers', {fromAccountId:fromId, toAccountId:toId, fromAmount, toAmount, date:qkDate, note:document.getElementById('qk-note').value.trim(), categoryId: catVal ? Number(catVal) : null});
      await loadAll(); renderAll();
      document.getElementById('qk-tr-amount-from').value=''; document.getElementById('qk-tr-amount-to').value=''; document.getElementById('qk-note').value=''; document.getElementById('qk-tr-category').value='';
      closeQuickAdd();
      toast('Transferencia guardada');
      return;
    }
    const amount = parseFloat(document.getElementById('qk-amount').value);
    if(!amount || amount<=0){ toast('Introduce un importe válido'); return; }
    if(splitActive('qk')){
      const accId = Number(document.getElementById('qk-account').value);
      const res = await createSplitPlan('qk', accId, Number(document.getElementById('qk-category').value), document.getElementById('qk-subcategory').value, qkDate, document.getElementById('qk-note').value.trim());
      if(!res) return;
      document.getElementById('qk-amount').value=''; document.getElementById('qk-note').value='';
      setDateValue('qk', todayISO());
      resetSplit('qk');
      rememberAccount(accId);
      closeQuickAdd();
      return;
    }
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
    setDateValue('qk', todayISO());
    document.getElementById('qk-debt').value=''; updateQkDebtUI();
    rememberAccount(t.accountId);
    closeQuickAdd();
    toast((t.kind==='expense' && budgetAlertMessage(t.categoryId)) || 'Movimiento guardado');
  });
}

function openQuickAdd(){
  state.qkCategoryExpanded = false;
  renderQuickAdd();
  document.getElementById('quick-add-overlay').style.display = 'flex';
  document.getElementById('qk-form').scrollTop = 0;
  pushOverlayState();
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
      if(tx){ hideDetailModal(); enterEditMode(tx); }
      return;
    }
    const editTr = e.target.closest('[data-edit-transfer]');
    if(editTr){
      const tr = state.transfers.find(t=>t.id===Number(editTr.dataset.editTransfer));
      if(tr){ hideDetailModal(); enterTransferEditMode(tr); }
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

  document.getElementById('save-monthly-income').addEventListener('click', async ()=>{
    const val = parseFloat(document.getElementById('monthly-income-input').value) || 0;
    await idb.put('settings', {key:'monthlyIncome', value:val});
    await loadAll(); renderAll();
    toast('Ingreso mensual guardado');
  });

  async function saveAllBudgetInputs(){
    const valueInputs = document.querySelectorAll('[data-budget-value]');
    for(const inp of valueInputs){
      const catId = Number(inp.dataset.budgetValue);
      const value = parseFloat(inp.value) || 0;
      const modeSel = document.querySelector(`[data-budget-mode="${catId}"]`);
      const mode = modeSel ? modeSel.value : 'fixed';
      await idb.put('budgets', {categoryId: catId, mode, value});
    }
    await loadAll(); renderAll();
  }
  document.getElementById('save-budgets').addEventListener('click', async ()=>{
    await saveAllBudgetInputs();
    toast('Límites guardados');
  });
  const saveTransferBtn = document.getElementById('save-transfer-budgets');
  if(saveTransferBtn) saveTransferBtn.addEventListener('click', async ()=>{
    await saveAllBudgetInputs();
    toast('Objetivos guardados');
  });

  document.getElementById('add-cat-expense').addEventListener('click', ()=> addCategory('expense'));
  document.getElementById('add-cat-income').addEventListener('click', ()=> addCategory('income'));
  const addCatTransferBtn = document.getElementById('add-cat-transfer');
  if(addCatTransferBtn) addCatTransferBtn.addEventListener('click', ()=> addCategory('transfer'));

  async function addCategory(kind){
    const kindLabel = kind==='expense' ? 'gasto' : (kind==='income' ? 'ingreso' : 'transferencia');
    const name = prompt('Nombre de la nueva categoría de ' + kindLabel + ':');
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

  document.getElementById('export-btn').addEventListener('click', ()=> exportBackupNow());

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
  setupAutoBackup();
  setupSelection();
  setupResumenLayoutSettings();
}

/* Copia de un toque: comparte el JSON (menú de compartir del móvil) o lo descarga */
async function exportBackupNow(){
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

/* ================= Respaldo automático a carpeta (Chrome/Edge en laptop) ================= */
// El navegador no deja escribir en disco sin permiso: se elige la carpeta una vez; al abrir la app (o 30 s
// después de cambiar datos) se guarda libro-respaldo-AAAA-MM-DD.json y se conservan los últimos 10 días.
// Si el navegador pide confirmar el permiso en una nueva sesión, aparece un aviso de un toque.
const AUTO_BACKUP_KEEP = 10;
const AUTO_BACKUP_RE = /^libro-respaldo-\d{4}-\d{2}-\d{2}\.json$/;
const autoBackupSupported = ()=> 'showDirectoryPicker' in window;
let autoBackupTimer = null, autoBackupArmed = false, autoBackupBusy = false;
function noteDataChanged(store){
  if(!autoBackupArmed || store==='settings' || store==='fileHandles') return;
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(()=>{ maybeAutoBackup({force:true}); }, 30000);
}
async function getAutoBackupDir(){
  const rec = (await idb.getAll('fileHandles')).find(r=>r.key==='autoBackupDir');
  return rec ? rec.handle : null;
}
async function getAutoBackupMeta(){
  return (await idb.getAll('fileHandles')).find(r=>r.key==='autoBackupMeta') || null;
}
async function autoBackupPermission(handle, ask){
  const opts = {mode:'readwrite'};
  try{
    if((await handle.queryPermission(opts)) === 'granted') return true;
    if(ask) return (await handle.requestPermission(opts)) === 'granted';
  }catch(e){}
  return false;
}
async function writeAutoBackup(dir){
  const name = 'libro-respaldo-' + todayISO() + '.json';
  const fh = await dir.getFileHandle(name, {create:true});
  const w = await fh.createWritable();
  await w.write(JSON.stringify(await buildBackupData(), null, 2));
  await w.close();
  const names = [];
  for await (const [n] of dir.entries()) if(AUTO_BACKUP_RE.test(n)) names.push(n);
  names.sort().reverse();
  for(const n of names.slice(AUTO_BACKUP_KEEP)){ try{ await dir.removeEntry(n); }catch(e){} }
  const at = new Date().toISOString();
  await idb.put('fileHandles', {key:'autoBackupMeta', day:todayISO(), at});
  await idb.put('settings', {key:'lastBackupDate', value: todayISO()});
  state.lastBackupDate = todayISO();
  return name;
}
/* Devuelve: 'none' | 'empty' | 'done' | 'needs-permission' | 'ok' | 'error' */
async function maybeAutoBackup(opts){
  opts = opts || {};
  if(!autoBackupSupported() || autoBackupBusy) return 'none';
  const dir = await getAutoBackupDir();
  if(!dir) return 'none';
  if(state.transactions.length===0 && state.transfers.length===0) return 'empty';
  const meta = await getAutoBackupMeta();
  if(!opts.force && meta && meta.day===todayISO()) return 'done';
  autoBackupBusy = true;
  try{
    if(!(await autoBackupPermission(dir, !!opts.ask))) return 'needs-permission';
    await writeAutoBackup(dir);
    document.getElementById('backup-reminder-banner')?.remove();
    refreshAutoBackupUI();
    return 'ok';
  }catch(err){
    return 'error';
  }finally{
    autoBackupBusy = false;
  }
}
async function refreshAutoBackupUI(){
  const supported = autoBackupSupported();
  const sel = document.getElementById('backup-reminder-days');
  if(sel) sel.value = String(state.backupReminderDays);
  const unsup = document.getElementById('autobackup-unsupported');
  const ctl = document.getElementById('autobackup-controls');
  if(unsup) unsup.style.display = supported ? 'none' : '';
  if(ctl) ctl.style.display = supported ? '' : 'none';
  if(!supported) return;
  const dir = await getAutoBackupDir();
  const st = document.getElementById('autobackup-status');
  document.getElementById('autobackup-choose-btn').textContent = dir ? 'Cambiar carpeta' : 'Elegir carpeta';
  document.getElementById('autobackup-now-btn').style.display = dir ? '' : 'none';
  document.getElementById('autobackup-stop-btn').style.display = dir ? '' : 'none';
  if(!dir){ st.textContent = 'Sin carpeta elegida. Elige una (mejor dentro de OneDrive, Google Drive o similar) y se respaldará sola.'; return; }
  const meta = await getAutoBackupMeta();
  const perm = await autoBackupPermission(dir, false);
  const last = meta ? new Date(meta.at).toLocaleString('es-ES') : 'todavía ninguno';
  st.textContent = `Carpeta: ${dir.name} · último respaldo: ${last} · se guardan los últimos ${AUTO_BACKUP_KEEP} días.` + (perm ? '' : ' Falta reactivar el permiso: pulsa "Respaldar ahora".');
}
function showBackupBanner(text, btnLabel, onClick){
  const pageHead = document.querySelector('#view-resumen .page-head');
  if(!pageHead || document.getElementById('backup-reminder-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'backup-reminder-banner';
  banner.style.cssText = 'background:var(--gold-soft); border:1px solid var(--gold); color:var(--gold); border-radius:10px; padding:14px 16px; margin-bottom:20px; font-size:13.5px; line-height:1.5; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;';
  banner.innerHTML = `<span>${text}</span><span style="display:flex; gap:8px; flex-shrink:0;"><button class="btn-secondary btn-sm" id="backup-banner-go">${btnLabel}</button><button class="btn-secondary btn-sm" id="backup-reminder-dismiss">Ahora no</button></span>`;
  pageHead.after(banner);
  document.getElementById('backup-banner-go').addEventListener('click', async ()=>{ await onClick(); });
  document.getElementById('backup-reminder-dismiss').addEventListener('click', dismissBackupReminder);
}
function setupAutoBackup(){
  refreshAutoBackupUI();
  getAutoBackupDir().then(d=>{ autoBackupArmed = !!d; });
  document.getElementById('autobackup-choose-btn')?.addEventListener('click', async ()=>{
    try{
      const dir = await window.showDirectoryPicker({mode:'readwrite'});
      if(!(await autoBackupPermission(dir, true))){ toast('Permiso denegado para esa carpeta'); return; }
      await idb.put('fileHandles', {key:'autoBackupDir', handle:dir});
      autoBackupArmed = true;
      const r = await maybeAutoBackup({force:true, ask:true});
      await refreshAutoBackupUI();
      toast(r==='ok' ? 'Respaldo automático activado' : 'Carpeta guardada');
    }catch(err){
      if(err.name !== 'AbortError') toast('No se pudo elegir la carpeta');
    }
  });
  document.getElementById('autobackup-now-btn')?.addEventListener('click', async ()=>{
    const r = await maybeAutoBackup({force:true, ask:true});
    await refreshAutoBackupUI();
    toast(r==='ok' ? 'Respaldo guardado' : r==='needs-permission' ? 'Permiso denegado' : r==='empty' ? 'Aún no hay datos que respaldar' : 'No se pudo respaldar');
  });
  document.getElementById('autobackup-stop-btn')?.addEventListener('click', async ()=>{
    if(!confirm('¿Dejar de respaldar en esa carpeta? Los archivos ya guardados se quedan allí.')) return;
    await idb.delete('fileHandles', 'autoBackupDir');
    autoBackupArmed = false;
    await refreshAutoBackupUI();
    toast('Respaldo automático desactivado');
  });
  document.getElementById('backup-reminder-days')?.addEventListener('change', async (e)=>{
    const v = Number(e.target.value);
    state.backupReminderDays = v;
    await idb.put('settings', {key:'backupReminderDays', value:v});
    toast('Te avisaré tras '+v+' días sin copia');
  });
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

async function checkBackupReminder(){
  if(state.backupReminderShown) return;
  if(state.transactions.length===0 && state.transfers.length===0) return;
  const auto = await maybeAutoBackup();
  if(auto==='needs-permission'){
    state.backupReminderShown = true;
    showBackupBanner('El respaldo automático necesita que confirmes el permiso de la carpeta (un toque).', 'Reactivar', async ()=>{
      const r = await maybeAutoBackup({force:true, ask:true});
      if(r==='ok'){ toast('Respaldo guardado'); } else toast('No se pudo respaldar');
    });
    return;
  }
  const limit = state.backupReminderDays || 7;
  const overdue = !state.lastBackupDate || daysSince(state.lastBackupDate) >= limit;
  if(!overdue) return;
  state.backupReminderShown = true;
  const days = state.lastBackupDate ? daysSince(state.lastBackupDate) : null;
  showBackupBanner(days===null ? 'Todavía no has hecho una copia de seguridad de tus datos.' : `Llevas ${days} día${days===1?'':'s'} sin copia de seguridad.`,
    'Copiar ahora', async ()=>{ await exportBackupNow(); });
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
    setupLedgerSwipe();
    setupDetailModal();
    setupCycleActions();
    setupSplit();
    document.addEventListener('change', (e)=>{
      if(e.target && e.target.id==='cashflow-range'){
        state.cashflowRange = e.target.value || '30';
        renderCashflow();
      }
    });
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
