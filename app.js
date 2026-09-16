/* =========================================================================
   تحليل تكاليف الرواتب - العجيمي الصناعية
   يعمل بالكامل داخل المتصفح (SheetJS لقراءة الإكسل، Chart.js للرسوم)
   لا يتم إرسال أي بيانات لأي خادم.
   ========================================================================= */

/* ---------- إعداد أسماء الأعمدة المتوقعة في تقرير "Employees Detailed Payroll Report" ---------- */
const HEADER_MAP = {
  'personnel number': 'personnelNumber',
  'name': 'name',
  'national / iqama id': 'nationalId',
  'national/iqama id': 'nationalId',
  'department': 'department',
  'working days': 'workingDays',
  'basic salary': 'basicSalary',
  'housing allowance': 'housingAllowance',
  'transportation allow': 'transportationAllow',
  'transportation allowance': 'transportationAllow',
  'own car allowance': 'ownCarAllowance',
  'fixed overtime': 'fixedOvertime',
  'overtime': 'overtime',
  'food allowance': 'foodAllowance',
  'incentives': 'incentives',
  'mobile allowance': 'mobileAllowance',
  'operator allowance': 'operatorAllowance',
  'leave': 'leave',
  'adjustment increment': 'adjustmentIncrement',
  'gosi allowance': 'gosiAllowance',
  'total additions': 'totalAdditions',
  'loans deductions': 'loansDeductions',
  'absence deduction': 'absenceDeduction',
  'food deduction': 'foodDeduction',
  'social insurance': 'socialInsurance',
  'penalties': 'penalties',
  'leave absence': 'leaveAbsence',
  'adjustment deduction': 'adjustmentDeduction',
  'total deductions': 'totalDeductions',
  'total salary': 'totalSalary',
  'branch': 'branch',
  'all overtime': 'allOvertime',
};

const ADDITION_FIELDS = [
  ['basicSalary', 'الأساسي'], ['housingAllowance', 'بدل سكن'], ['transportationAllow', 'بدل نقل'],
  ['ownCarAllowance', 'بدل سيارة'], ['fixedOvertime', 'إضافي ثابت'], ['overtime', 'إضافي'],
  ['foodAllowance', 'بدل طعام'], ['incentives', 'حوافز'], ['mobileAllowance', 'بدل جوال'],
  ['operatorAllowance', 'بدل تشغيل'], ['leave', 'إجازة'], ['adjustmentIncrement', 'تعديل بالزيادة'],
  ['gosiAllowance', 'بدل تأمينات'],
];
const DEDUCTION_FIELDS = [
  ['loansDeductions', 'سلف'], ['absenceDeduction', 'خصم غياب'], ['foodDeduction', 'خصم طعام'],
  ['socialInsurance', 'تأمينات اجتماعية'], ['penalties', 'جزاءات'], ['leaveAbsence', 'غياب إجازة'],
  ['adjustmentDeduction', 'تعديل بالخصم'],
];

const MONTH_AR = {
  january:'يناير', february:'فبراير', march:'مارس', april:'أبريل', may:'مايو', june:'يونيو',
  july:'يوليو', august:'أغسطس', september:'سبتمبر', october:'أكتوبر', november:'نوفمبر', december:'ديسمبر',
};
const MONTH_ORDER = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/* ---------- الحالة العامة ---------- */
const state = {
  files: [],        // { id, fileName, month, monthKey, year, entity, employees:[], totalsRow, matches, error }
  activeTab: null,   // entity name or '__group__'
  selectedMonths: {}, // entity -> Set(monthKey)
  metricMode: {},     // entity -> 'gross' | 'net'
  deptSearch: {},
  empSearch: {},
  empSort: {},
  empPage: {},
  expandedEmp: {},
  charts: {},
};

const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');

/* ---------- تخزين دائم داخل المتصفح (IndexedDB) — لتبقى الملفات محفوظة بعد تحديث الصفحة ----------
   يُخزَّن هنا الملف بعد تحليله فقط (بيانات الموظفين المستخرجة)، وليس الملف الخام.
   كل شيء يبقى داخل متصفحك فقط ولا يُرسل لأي خادم. ---------- */
const DB_NAME = 'PayrollAnalyticsDB';
const DB_STORE = 'files';
let dbPromise = null;

let storageAvailable = null; // null = لم يُختبر بعد، true/false بعد الاختبار

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!('indexedDB' in window) || !window.indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // تجاهل بهدوء إن كان التخزين غير متاح (مثل وضع التصفح الخاص)
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null); // بعض المتصفحات/السياقات ترمي استثناءً مباشرة عند استدعاء indexedDB.open
    }
  });
  return dbPromise;
}

async function dbPutFile(entry) {
  try {
    const db = await openDB();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (e) { return false; }
}

async function dbDeleteFile(id) {
  try {
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* تجاهل بهدوء */ }
}

async function dbGetAllFiles() {
  try {
    const db = await openDB();
    if (!db) return [];
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return []; }
}

async function dbClearAll() {
  try {
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* تجاهل بهدوء */ }
}

/* اختبار فعلي (كتابة ثم قراءة ثم حذف) للتأكد أن الحفظ الدائم يعمل فعلًا في هذا المتصفح/السياق الحالي،
   بدل افتراض نجاحه. يُستدعى مرة واحدة عند تحميل الصفحة. */
async function testStorageAvailability() {
  const testId = '__storage_test__';
  const ok = await dbPutFile({ id: testId, __test: true });
  if (ok) {
    await dbDeleteFile(testId);
  }
  storageAvailable = ok;
  if (!ok) {
    showAlert('warn',
      'تعذّر تفعيل الحفظ الدائم للملفات في هذا المتصفح، لذا لن تبقى الملفات محفوظة بعد تحديث الصفحة (سيتوجب رفعها من جديد كل مرة). ' +
      'الأسباب الشائعة: (1) فتح الأداة مباشرة من داخل الملف المضغوط (ZIP) دون فك الضغط أولًا — تأكد من فك الضغط الكامل ثم افتح index.html من المجلد الناتج. ' +
      '(2) استخدام وضع التصفح الخاص/incognito. (3) إعداد في المتصفح يمسح بيانات المواقع تلقائيًا عند الإغلاق.',
      true
    );
  }
  return ok;
}

/* مفتاح ثابت لكل (جهة + شهر) بحيث يستبدل رفع نفس الشهر لنفس الجهة الملف القديم بدل تكراره */
function fileKey(entity, monthKey, fileName) {
  return `${entity}||${monthKey || fileName}`;
}

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ---------- قراءة ملف إكسل واحد ---------- */
function parseWorkbookRows(rows, fileName) {
  let entity = null, monthLabel = null, year = null, headerRowIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (headerRowIdx === -1) {
      const idxPG = r.findIndex(c => normHeader(c) === 'pay group');
      if (idxPG >= 0) {
        for (let k = idxPG + 1; k < r.length; k++) {
          if (r[k] !== null && r[k] !== undefined && String(r[k]).trim() !== '') { entity = String(r[k]).trim(); break; }
        }
      }
      const idxMonth = r.findIndex(c => normHeader(c) === 'month');
      if (idxMonth >= 0) {
        for (let k = idxMonth + 1; k < r.length; k++) {
          if (r[k] !== null && r[k] !== undefined && String(r[k]).trim() !== '') { monthLabel = String(r[k]).trim(); break; }
        }
      }
      const idxFrom = r.findIndex(c => normHeader(c) === 'from date');
      if (idxFrom >= 0) {
        for (let k = idxFrom + 1; k < r.length; k++) {
          const v = r[k];
          if (v instanceof Date) { year = v.getFullYear(); break; }
          if (typeof v === 'number' && v > 20000) { // excel serial date fallback
            const d = XLSX.SSF.parse_date_code(v);
            if (d) { year = d.y; break; }
          }
        }
      }
    }
    const firstCell = normHeader(r[0]);
    if (firstCell === 'personnel number') { headerRowIdx = i; if (entity) break; }
  }

  if (headerRowIdx === -1) {
    return { error: 'لم يتم التعرف على صيغة الملف — تأكد أنه تقرير "Employees Detailed Payroll Report" الأصلي بدون تعديل على رؤوس الأعمدة.' };
  }

  const headerRow = rows[headerRowIdx];
  const colIndex = {};
  headerRow.forEach((h, idx) => {
    const key = HEADER_MAP[normHeader(h)];
    if (key) colIndex[key] = idx;
  });
  if (colIndex.personnelNumber === undefined || colIndex.totalSalary === undefined) {
    return { error: 'تعذّرت قراءة أعمدة أساسية (رقم الموظف / إجمالي الراتب) من الملف. تحقق من تطابق رؤوس الأعمدة مع تقرير الرواتب الأصلي.' };
  }

  const employees = [];
  let totalsRow = null;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const pn = r[colIndex.personnelNumber];
    const nm = colIndex.name !== undefined ? r[colIndex.name] : null;
    if (pn === null || pn === undefined || String(pn).trim() === '') {
      const val = colIndex.totalSalary !== undefined ? r[colIndex.totalSalary] : null;
      if ((val || val === 0) && !nm) totalsRow = r;
      continue;
    }
    const deptRaw = colIndex.department !== undefined ? (r[colIndex.department] || '') : '';
    const parts = String(deptRaw).split('|');
    const deptMain = (parts[0] || '').trim();
    const deptCat = (parts[1] || '').trim();
    const emp = {
      personnelNumber: String(pn).trim(),
      name: nm ? String(nm).trim() : '(بدون اسم)',
      nationalId: colIndex.nationalId !== undefined ? String(r[colIndex.nationalId] || '') : '',
      department: deptMain || 'غير مصنف',
      category: deptCat || '—',
    };
    let sumAdd = 0, sumDed = 0;
    for (const [key] of ADDITION_FIELDS) {
      const v = colIndex[key] !== undefined ? Number(r[colIndex[key]]) || 0 : 0;
      emp[key] = v; sumAdd += v;
    }
    for (const [key] of DEDUCTION_FIELDS) {
      const v = colIndex[key] !== undefined ? Number(r[colIndex[key]]) || 0 : 0;
      emp[key] = v; sumDed += v;
    }
    emp.totalAdditions = colIndex.totalAdditions !== undefined ? (Number(r[colIndex.totalAdditions]) || 0) : sumAdd;
    emp.totalDeductions = colIndex.totalDeductions !== undefined ? (Number(r[colIndex.totalDeductions]) || 0) : sumDed;
    emp.totalSalary = colIndex.totalSalary !== undefined ? (Number(r[colIndex.totalSalary]) || 0) : (emp.totalAdditions - emp.totalDeductions);
    emp.workingDays = colIndex.workingDays !== undefined ? (Number(r[colIndex.workingDays]) || 0) : null;
    employees.push(emp);
  }

  let matches = null;
  if (totalsRow && colIndex.totalAdditions !== undefined) {
    const compAdd = employees.reduce((s, e) => s + e.totalAdditions, 0);
    const compNet = employees.reduce((s, e) => s + e.totalSalary, 0);
    const fileAdd = Number(totalsRow[colIndex.totalAdditions]) || 0;
    const fileNet = Number(totalsRow[colIndex.totalSalary]) || 0;
    matches = Math.abs(compAdd - fileAdd) < 1 && Math.abs(compNet - fileNet) < 1;
  }

  let monthKey = null;
  if (monthLabel) {
    const ml = monthLabel.toLowerCase();
    monthKey = MONTH_ORDER.find(m => ml.includes(m)) || null;
  }
  if (!monthKey) {
    const fl = fileName.toLowerCase();
    monthKey = MONTH_ORDER.find(m => fl.includes(m)) || null;
  }

  return {
    entity: entity || 'غير معروف',
    monthLabel: monthLabel || fileName,
    monthKey,
    year,
    employees,
    totalsRow: !!totalsRow,
    matches,
  };
}

function readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('read error'));
    reader.readAsArrayBuffer(file);
  });
}

/* ---------- التعامل مع رفع الملفات ---------- */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const alertsBox = document.getElementById('alertsBox');
const fileList = document.getElementById('fileList');
const fileCountLabel = document.getElementById('fileCountLabel');
const appContent = document.getElementById('appContent');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault(); dropzone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

async function handleFiles(fileListObj) {
  const arr = Array.from(fileListObj || []);
  const rejected = arr.filter(f => !/\.(xlsx|xls)$/i.test(f.name));
  const valid = arr.filter(f => /\.(xlsx|xls)$/i.test(f.name));
  if (rejected.length) {
    showAlert('danger', `تم تجاهل ${rejected.length} ملف لأن صيغته غير مدعومة (يجب أن يكون xlsx أو xls): ${rejected.map(f=>f.name).join('، ')}`);
  }
  for (const file of valid) {
    const tempId = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const entry = { id: tempId, fileName: file.name, status: 'loading' };
    state.files.push(entry);
    renderFileList();
    try {
      const rows = await readFileAsRows(file);
      const parsed = parseWorkbookRows(rows, file.name);
      Object.assign(entry, parsed, { status: parsed.error ? 'error' : 'ok' });
      if (!parsed.error) {
        const key = fileKey(parsed.entity, parsed.monthKey, file.name);
        // إن كان هناك ملف سابق بنفس (الجهة + الشهر) يُستبدل بدل تكراره
        const dupIndex = state.files.findIndex(f => f.id !== tempId && f.dbKey === key);
        if (dupIndex !== -1) {
          const dup = state.files[dupIndex];
          showAlert('info', `تم استبدال ملف "${dup.fileName}" (نفس الجهة والشهر) بالملف الجديد "${file.name}".`);
          state.files.splice(dupIndex, 1);
          await dbDeleteFile(key);
        }
        entry.id = key;
        entry.dbKey = key;
        await dbPutFile(entry);
      }
    } catch (err) {
      entry.status = 'error';
      entry.error = 'تعذّر فتح الملف — تأكد أن الملف غير تالف وأنه بصيغة إكسل صحيحة.';
    }
    renderFileList();
    rebuildApp();
  }
  fileInput.value = '';
}

function removeFile(id) {
  const entry = state.files.find(f => f.id === id);
  state.files = state.files.filter(f => f.id !== id);
  if (entry && entry.dbKey) dbDeleteFile(entry.dbKey);
  renderFileList();
  rebuildApp();
}

async function clearAllSavedData() {
  if (!confirm('سيتم حذف كل الملفات المحفوظة داخل هذا المتصفح نهائيًا. هل تريد المتابعة؟')) return;
  state.files = [];
  await dbClearAll();
  renderFileList();
  rebuildApp();
}

async function restoreSavedFiles() {
  const saved = (await dbGetAllFiles()).filter(f => !f.__test);
  if (!saved.length) return;
  state.files = saved.map(f => ({ ...f, status: 'ok' }));
  renderFileList();
  rebuildApp();
  showAlert('info', `تم استرجاع ${saved.length} ملف محفوظ من الجلسة السابقة داخل هذا المتصفح.`);
}

(async () => {
  await testStorageAvailability();
  await restoreSavedFiles();
})();

function showAlert(type, msg, persistent) {
  const div = document.createElement('div');
  div.className = `alert ${type}`;
  div.innerHTML = `<span>${type === 'danger' ? '⛔' : type === 'warn' ? '⚠️' : 'ℹ️'}</span><span>${msg}</span>`;
  alertsBox.appendChild(div);
  if (!persistent) setTimeout(() => div.remove(), 9000);
}

function renderFileList() {
  fileCountLabel.textContent = state.files.length ? `(${state.files.length} ملف)` : '';
  fileList.innerHTML = state.files.map(f => {
    let tag = '';
    if (f.status === 'loading') tag = `<span class="tag">⏳ جارٍ التحميل...</span>`;
    else if (f.status === 'error') tag = `<span class="tag warn">⚠️ ${f.error}</span>`;
    else {
      const monthTxt = f.monthKey ? MONTH_AR[f.monthKey] : (f.monthLabel || '—');
      tag = `<span class="tag">${f.entity}</span><span class="tag">${monthTxt}${f.year ? ' ' + f.year : ''}</span><span class="tag">${f.employees.length} موظف</span>` +
        (f.matches === false ? `<span class="tag warn">⚠️ الإجمالي المحسوب لا يطابق إجمالي الملف</span>` : (f.matches === true ? `<span class="tag ok">✅ مطابق</span>` : ''));
    }
    return `<div class="filerow"><div class="meta"><strong>${f.fileName}</strong>${tag}</div><button class="removeFile" onclick="removeFile('${f.id}')">إزالة ✕</button></div>`;
  }).join('');
}

/* ---------- بناء التبويبات والعرض الرئيسي ---------- */
function rebuildApp() {
  const okFiles = state.files.filter(f => f.status === 'ok');
  if (!okFiles.length) {
    appContent.innerHTML = '';
    return;
  }
  const entities = [...new Set(okFiles.map(f => f.entity))];
  entities.forEach(e => {
    if (!state.selectedMonths[e]) state.selectedMonths[e] = new Set();
    if (!state.metricMode[e]) state.metricMode[e] = 'gross';
    const monthsForEntity = new Set(okFiles.filter(f => f.entity === e).map(f => f.monthKey || f.fileName));
    // auto-select any newly seen months
    monthsForEntity.forEach(m => state.selectedMonths[e].add(m));
  });
  if (!state.metricMode['__group__']) state.metricMode['__group__'] = 'gross';

  if (!state.activeTab || (state.activeTab !== '__group__' && !entities.includes(state.activeTab))) {
    state.activeTab = entities[0];
  }

  const tabsHtml = `<div class="tabs">${entities.map(e =>
    `<div class="tab ${state.activeTab === e ? 'active' : ''}" onclick="setTab('${escapeAttr(e)}')">${escapeHtml(e)}</div>`
  ).join('')}${entities.length > 1 ? `<div class="tab ${state.activeTab === '__group__' ? 'active' : ''}" onclick="setTab('__group__')">🏢 المجموعة (الكل)</div>` : ''}</div>`;

  let bodyHtml = '';
  if (state.activeTab === '__group__') {
    bodyHtml = renderGroupView(okFiles, entities);
  } else {
    bodyHtml = renderEntityView(okFiles, state.activeTab);
  }

  appContent.innerHTML = tabsHtml + `<div id="tabBody">${bodyHtml}</div>`;
  drawChartsForActiveTab(okFiles, entities);
}

function setTab(t) { state.activeTab = t; rebuildApp(); }

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/'/g,'&#39;'); }

/* ---------- عرض تبويب كيان (مصنع/جهة) واحد ---------- */
function renderEntityView(okFiles, entity) {
  const entityFiles = okFiles.filter(f => f.entity === entity);
  const allMonths = [...new Set(entityFiles.map(f => f.monthKey || f.fileName))]
    .sort((a,b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
  const selected = state.selectedMonths[entity];
  const activeFiles = entityFiles.filter(f => selected.has(f.monthKey || f.fileName));
  const metric = state.metricMode[entity];

  if (!activeFiles.length) {
    return renderMonthFilter(entity, allMonths, entityFiles) + `<div class="empty-state">اختر شهرًا واحدًا على الأقل لعرض التحليل</div>`;
  }

  const allEmp = activeFiles.flatMap(f => f.employees.map(e => ({...e, __month: f.monthKey || f.fileName, __monthLabel: f.monthKey ? MONTH_AR[f.monthKey] : f.monthLabel})));
  const kpis = computeKpis(allEmp, activeFiles.length);
  const byDept = groupByDept(allEmp, metric);
  const byEmp = groupByEmployee(allEmp);

  return renderMonthFilter(entity, allMonths, entityFiles)
    + renderKpis(kpis)
    + renderMetricToggle(entity)
    + `<div class="grid2">`
      + renderDeptCard(entity, byDept, metric, false)
      + renderTrendCard(entity)
    + `</div>`
    + renderEmployeeCard(entity, byEmp, activeFiles.length, false);
}

/* ---------- عرض تبويب المجموعة (كل الجهات) ---------- */
function renderGroupView(okFiles, entities) {
  const metric = state.metricMode['__group__'];
  // بالنسبة للمجموعة: نأخذ الأشهر المختارة لكل جهة على حدة
  const activeFiles = okFiles.filter(f => (state.selectedMonths[f.entity] || new Set()).has(f.monthKey || f.fileName));
  if (!activeFiles.length) {
    return `<div class="empty-state">لا توجد بيانات محددة — تحقق من تحديد الأشهر داخل تبويبات الجهات</div>`;
  }
  const allEmp = activeFiles.flatMap(f => f.employees.map(e => ({...e, __entity: f.entity, __month: f.monthKey || f.fileName})));
  const kpis = computeKpis(allEmp, activeFiles.length);

  // تكلفة حسب الجهة (المصنع)
  const byEntity = {};
  for (const e of allEmp) {
    byEntity[e.__entity] = byEntity[e.__entity] || { count: new Set(), cost: 0 };
    byEntity[e.__entity].count.add(e.personnelNumber);
    byEntity[e.__entity].cost += metric === 'net' ? e.totalSalary : e.totalAdditions;
  }
  const entityRows = Object.entries(byEntity).sort((a,b) => b[1].cost - a[1].cost);
  const totalCost = entityRows.reduce((s,[,v]) => s + v.cost, 0);

  const byDept = groupByDept(allEmp, metric);

  return renderKpis(kpis)
    + renderMetricToggle('__group__')
    + `<div class="grid2">
        <div class="card">
          <h2>💼 التكلفة حسب الجهة/المصنع</h2>
          <div class="table-scroll"><table><thead><tr><th>الجهة</th><th>عدد الموظفين</th><th>${metric==='net'?'صافي الرواتب':'إجمالي التكلفة'}</th><th>النسبة</th></tr></thead><tbody>
          ${entityRows.map(([name,v]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${fmt(v.count.size)}</td><td class="num">${fmt(v.cost)}</td>
            <td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:${totalCost? (v.cost/totalCost*100):0}%"></div></div><span class="num">${totalCost? (v.cost/totalCost*100).toFixed(1):0}%</span></td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <div class="card">
          <h2>📈 اتجاه التكلفة الإجمالية عبر الأشهر</h2>
          <div class="chart-wrap"><canvas id="chart-trend-__group__"></canvas></div>
        </div>
      </div>`
    + renderDeptCard('__group__', byDept, metric, true);
}

/* ---------- عناصر واجهة مساعدة ---------- */
function renderMonthFilter(entity, allMonths, entityFiles) {
  const selected = state.selectedMonths[entity];
  return `<div class="card"><h2>📅 الأشهر المحمّلة لهذه الجهة <span class="count">(${entityFiles.length} ملف)</span></h2>
    <div class="filters"><div class="group">
    ${allMonths.map(m => {
      const label = MONTH_AR[m] || m;
      const checked = selected.has(m) ? 'checked' : '';
      return `<label class="mchk"><input type="checkbox" ${checked} onchange="toggleMonth('${escapeAttr(entity)}','${escapeAttr(m)}')"> ${escapeHtml(label)}</label>`;
    }).join('')}
    </div></div></div>`;
}
function toggleMonth(entity, month) {
  const set = state.selectedMonths[entity];
  if (set.has(month)) set.delete(month); else set.add(month);
  rebuildApp();
}

function renderMetricToggle(entity) {
  const metric = state.metricMode[entity];
  return `<div class="filters"><span style="font-size:13px;color:var(--muted);font-weight:700;">مقياس التكلفة:</span>
    <div class="toggle-metric">
      <button class="${metric==='gross'?'active':''}" onclick="setMetric('${escapeAttr(entity)}','gross')">إجمالي التكلفة (قبل الخصومات)</button>
      <button class="${metric==='net'?'active':''}" onclick="setMetric('${escapeAttr(entity)}','net')">صافي الرواتب (بعد الخصومات)</button>
    </div></div>`;
}
function setMetric(entity, mode) { state.metricMode[entity] = mode; rebuildApp(); }

function computeKpis(allEmp, monthsCount) {
  const uniqueEmp = new Set(allEmp.map(e => e.personnelNumber));
  const gross = allEmp.reduce((s,e) => s + e.totalAdditions, 0);
  const ded = allEmp.reduce((s,e) => s + e.totalDeductions, 0);
  const net = allEmp.reduce((s,e) => s + e.totalSalary, 0);
  const avgPerEmpPerMonth = uniqueEmp.size && monthsCount ? gross / uniqueEmp.size / monthsCount : 0;
  return { headcount: uniqueEmp.size, gross, ded, net, avgPerEmpPerMonth, monthsCount };
}

function renderKpis(k) {
  return `<div class="kpis">
    <div class="kpi"><div class="label">عدد الموظفين (فريد)</div><div class="value">${fmt(k.headcount)}</div><div class="sub">عبر ${k.monthsCount} شهر</div></div>
    <div class="kpi"><div class="label">إجمالي التكلفة (قبل الخصومات)</div><div class="value">${fmt(k.gross)}</div><div class="sub">ريال سعودي</div></div>
    <div class="kpi"><div class="label">إجمالي الخصومات</div><div class="value gold">${fmt(k.ded)}</div><div class="sub">ريال سعودي</div></div>
    <div class="kpi"><div class="label">صافي الرواتب المدفوعة</div><div class="value">${fmt(k.net)}</div><div class="sub">ريال سعودي</div></div>
    <div class="kpi"><div class="label">متوسط التكلفة/موظف/شهر</div><div class="value">${fmt(k.avgPerEmpPerMonth)}</div><div class="sub">ريال سعودي</div></div>
  </div>`;
}

function groupByDept(allEmp, metric) {
  const map = {};
  for (const e of allEmp) {
    const key = e.department;
    map[key] = map[key] || { headcountSet: new Set(), cost: 0, net: 0, ded: 0 };
    map[key].headcountSet.add(e.personnelNumber);
    map[key].cost += e.totalAdditions;
    map[key].net += e.totalSalary;
    map[key].ded += e.totalDeductions;
  }
  return Object.entries(map).map(([dept, v]) => ({
    dept, headcount: v.headcountSet.size,
    cost: metric === 'net' ? v.net : v.cost,
    avgPerEmp: v.headcountSet.size ? (metric === 'net' ? v.net : v.cost) / v.headcountSet.size : 0,
  })).sort((a,b) => b.cost - a.cost);
}

function renderDeptCard(entity, byDept, metric, isGroup) {
  const total = byDept.reduce((s,d) => s + d.cost, 0);
  const search = (isGroup ? state.deptSearch['__group__'] : state.deptSearch[entity]) || '';
  const filtered = byDept.filter(d => d.dept.toLowerCase().includes(search.toLowerCase()));
  return `<div class="card" id="deptCard">
    <h2>🏭 التكلفة حسب الإدارة <span class="count">(${byDept.length} إدارة)</span></h2>
    ${!isGroup ? `<div class="chart-wrap"><canvas id="chart-dept-${entity}"></canvas></div>` : ''}
    <div class="filters"><div class="search-box"><input type="text" placeholder="بحث عن إدارة..." value="${escapeAttr(search)}" oninput="setDeptSearch('${escapeAttr(entity)}',this.value)"></div></div>
    <div class="table-scroll"><table><thead><tr><th>الإدارة</th><th>عدد الموظفين</th><th>${metric==='net'?'صافي الرواتب':'إجمالي التكلفة'}</th><th>متوسط/موظف</th><th>النسبة من الإجمالي</th></tr></thead><tbody>
    ${filtered.map(d => `<tr><td>${escapeHtml(d.dept)}</td><td class="num">${fmt(d.headcount)}</td><td class="num">${fmt(d.cost)}</td><td class="num">${fmt(d.avgPerEmp)}</td>
      <td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:${total? (d.cost/total*100):0}%"></div></div><span class="num">${total? (d.cost/total*100).toFixed(1):0}%</span></td></tr>`).join('')}
    </tbody></table></div>
    <div class="export-row"><button class="btn secondary" onclick="exportDeptTable('${escapeAttr(entity)}')">⬇️ تصدير جدول الإدارات (Excel)</button></div>
  </div>`;
}
function setDeptSearch(entity, val) { state.deptSearch[entity] = val; rebuildApp(); }

function renderTrendCard(entity) {
  return `<div class="card"><h2>📈 اتجاه التكلفة الشهرية</h2><div class="chart-wrap"><canvas id="chart-trend-${entity}"></canvas></div>
    <div class="legend-note">يعرض إجمالي تكلفة كل شهر ضمن الأشهر المحددة أعلاه</div></div>`;
}

function groupByEmployee(allEmp) {
  const map = {};
  for (const e of allEmp) {
    const key = e.personnelNumber;
    if (!map[key]) {
      map[key] = { personnelNumber: e.personnelNumber, name: e.name, department: e.department, category: e.category,
        months: [], totalGross: 0, totalNet: 0, totalDed: 0 };
    }
    const rec = map[key];
    rec.department = e.department; rec.name = e.name; // آخر قيمة معروفة
    rec.totalGross += e.totalAdditions;
    rec.totalNet += e.totalSalary;
    rec.totalDed += e.totalDeductions;
    rec.months.push({ month: e.__month, label: e.__monthLabel || e.__month, gross: e.totalAdditions, net: e.totalSalary, ded: e.totalDeductions, raw: e });
  }
  return Object.values(map).map(r => ({...r, monthsCount: r.months.length, avgGross: r.totalGross / r.months.length}));
}

function renderEmployeeCard(entity, byEmp, monthsCount, isGroup) {
  const key = isGroup ? '__group__' : entity;
  const search = (state.empSearch[key] || '').toLowerCase();
  const sort = state.empSort[key] || { col: 'totalGross', dir: -1 };
  const page = state.empPage[key] || 0;
  const pageSize = 50;

  let rows = byEmp.filter(e =>
    !search || e.name.toLowerCase().includes(search) || e.personnelNumber.includes(search) || e.department.toLowerCase().includes(search)
  );
  rows.sort((a,b) => {
    const va = a[sort.col], vb = b[sort.col];
    if (typeof va === 'string') return sort.dir * va.localeCompare(vb, 'ar');
    return sort.dir * ((va||0) - (vb||0));
  });
  const totalRows = rows.length;
  const pageRows = rows.slice(page*pageSize, page*pageSize + pageSize);

  const cols = [
    ['personnelNumber','الرقم الوظيفي'], ['name','الاسم'], ['department','الإدارة'], ['category','الفئة'],
    ['monthsCount','عدد الأشهر'], ['totalGross','إجمالي التكلفة'], ['totalDed','إجمالي الخصومات'],
    ['totalNet','صافي المدفوع'], ['avgGross','متوسط شهري'],
  ];

  return `<div class="card" id="empCard">
    <h2>👤 التكلفة حسب الموظف <span class="count">(${totalRows} موظف)</span></h2>
    <div class="filters">
      <div class="search-box"><input type="text" placeholder="بحث بالاسم / الرقم الوظيفي / الإدارة..." value="${escapeAttr(state.empSearch[key]||'')}" oninput="setEmpSearch('${escapeAttr(key)}',this.value)"></div>
    </div>
    <div class="table-scroll"><table><thead><tr>
      ${cols.map(([c,label]) => `<th class="${sort.col===c?'sorted':''}" onclick="setEmpSort('${escapeAttr(key)}','${c}')">${label}</th>`).join('')}
    </tr></thead><tbody>
    ${pageRows.map(e => {
      const expanded = state.expandedEmp[key] === e.personnelNumber;
      let detail = '';
      if (expanded) {
        detail = `<tr class="detail-row"><td colspan="${cols.length}">
          <table class="detail-table"><thead><tr><th>الشهر</th><th>إجمالي التكلفة</th><th>الخصومات</th><th>الصافي</th></tr></thead><tbody>
          ${e.months.map(m => `<tr><td>${escapeHtml(m.label)}</td><td class="num">${fmt(m.gross)}</td><td class="num">${fmt(m.ded)}</td><td class="num">${fmt(m.net)}</td></tr>`).join('')}
          </tbody></table></td></tr>`;
      }
      return `<tr class="expandable" onclick="toggleEmpExpand('${escapeAttr(key)}','${escapeAttr(e.personnelNumber)}')">
        <td>${escapeHtml(e.personnelNumber)}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.department)}</td><td>${escapeHtml(e.category)}</td>
        <td class="num">${e.monthsCount}</td><td class="num">${fmt(e.totalGross)}</td><td class="num">${fmt(e.totalDed)}</td><td class="num">${fmt(e.totalNet)}</td><td class="num">${fmt(e.avgGross)}</td>
      </tr>${detail}`;
    }).join('')}
    </tbody></table></div>
    <div class="pager">
      <button class="btn secondary" ${page===0?'disabled':''} onclick="setEmpPage('${escapeAttr(key)}',${page-1})">السابق</button>
      <span>صفحة ${page+1} من ${Math.max(1, Math.ceil(totalRows/pageSize))}</span>
      <button class="btn secondary" ${(page+1)*pageSize>=totalRows?'disabled':''} onclick="setEmpPage('${escapeAttr(key)}',${page+1})">التالي</button>
    </div>
    <div class="export-row"><button class="btn secondary" onclick="exportEmpTable('${escapeAttr(key)}')">⬇️ تصدير جدول الموظفين (Excel)</button></div>
  </div>`;
}
function setEmpSearch(key, val) { state.empSearch[key] = val; state.empPage[key] = 0; rebuildApp(); }
function setEmpSort(key, col) {
  const cur = state.empSort[key] || { col: 'totalGross', dir: -1 };
  state.empSort[key] = { col, dir: cur.col === col ? -cur.dir : -1 };
  rebuildApp();
}
function setEmpPage(key, page) { state.empPage[key] = page; rebuildApp(); }
function toggleEmpExpand(key, pn) {
  state.expandedEmp[key] = state.expandedEmp[key] === pn ? null : pn;
  rebuildApp();
}

/* ---------- الرسوم البيانية ---------- */
function drawChartsForActiveTab(okFiles, entities) {
  Object.values(state.charts).forEach(c => c && c.destroy());
  state.charts = {};
  const palette = ['#4EA72E','#123A1B','#C9A227','#3B7DDB','#B3261E','#8A6D00','#5E9CA0','#9B59B6','#E67E22','#2C3E50'];

  if (state.activeTab === '__group__') {
    const metric = state.metricMode['__group__'];
    const activeFiles = okFiles.filter(f => (state.selectedMonths[f.entity]||new Set()).has(f.monthKey || f.fileName));
    const months = [...new Set(activeFiles.map(f => f.monthKey || f.fileName))].sort((a,b) => MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
    const byMonth = months.map(m => {
      const emps = activeFiles.filter(f => (f.monthKey||f.fileName)===m).flatMap(f=>f.employees);
      return emps.reduce((s,e) => s + (metric==='net'?e.totalSalary:e.totalAdditions), 0);
    });
    const el = document.getElementById('chart-trend-__group__');
    if (el) state.charts.trend = new Chart(el, { type:'line', data:{ labels: months.map(m=>MONTH_AR[m]||m), datasets:[{ label: metric==='net'?'صافي الرواتب':'إجمالي التكلفة', data: byMonth, borderColor:'#4EA72E', backgroundColor:'rgba(78,167,46,.15)', fill:true, tension:.3 }] },
      options: chartBaseOptions() });
    return;
  }

  const entity = state.activeTab;
  const entityFiles = okFiles.filter(f => f.entity === entity);
  const selected = state.selectedMonths[entity] || new Set();
  const activeFiles = entityFiles.filter(f => selected.has(f.monthKey || f.fileName));
  if (!activeFiles.length) return;
  const metric = state.metricMode[entity];
  const allEmp = activeFiles.flatMap(f => f.employees);

  const deptEl = document.getElementById(`chart-dept-${entity}`);
  if (deptEl) {
    const byDept = groupByDept(allEmp, metric).slice(0, 12);
    state.charts.dept = new Chart(deptEl, { type:'bar',
      data:{ labels: byDept.map(d=>d.dept), datasets:[{ label: metric==='net'?'صافي الرواتب':'إجمالي التكلفة', data: byDept.map(d=>d.cost), backgroundColor: palette[1] }] },
      options: { ...chartBaseOptions(), indexAxis:'y' } });
  }

  const months = [...new Set(entityFiles.map(f => f.monthKey || f.fileName))].sort((a,b) => MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
  const trendEl = document.getElementById(`chart-trend-${entity}`);
  if (trendEl) {
    const byMonth = months.map(m => {
      const f = entityFiles.find(f => (f.monthKey||f.fileName) === m);
      if (!f || !selected.has(m)) return null;
      return f.employees.reduce((s,e) => s + (metric==='net'?e.totalSalary:e.totalAdditions), 0);
    });
    state.charts.trend = new Chart(trendEl, { type:'line',
      data:{ labels: months.map(m=>MONTH_AR[m]||m), datasets:[{ label: metric==='net'?'صافي الرواتب':'إجمالي التكلفة', data: byMonth, borderColor:'#4EA72E', backgroundColor:'rgba(78,167,46,.15)', fill:true, tension:.3, spanGaps:true }] },
      options: chartBaseOptions() });
  }
}

function chartBaseOptions() {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ font:{ family:'Cairo' } } }, tooltip:{ callbacks:{ label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? ctx.parsed.x)}` } } },
    scales:{ x:{ ticks:{ font:{ family:'Cairo' } } }, y:{ ticks:{ font:{ family:'Cairo', callback: (v)=>fmt(v) } } } },
  };
}

/* ---------- التصدير إلى إكسل ---------- */
function exportDeptTable(entity) {
  const okFiles = state.files.filter(f => f.status === 'ok');
  const isGroup = entity === '__group__';
  const metric = state.metricMode[entity];
  let allEmp;
  if (isGroup) {
    allEmp = okFiles.filter(f => (state.selectedMonths[f.entity]||new Set()).has(f.monthKey||f.fileName)).flatMap(f=>f.employees);
  } else {
    const selected = state.selectedMonths[entity] || new Set();
    allEmp = okFiles.filter(f => f.entity===entity && selected.has(f.monthKey||f.fileName)).flatMap(f=>f.employees);
  }
  const byDept = groupByDept(allEmp, metric);
  const aoa = [['الإدارة','عدد الموظفين', metric==='net'?'صافي الرواتب':'إجمالي التكلفة','متوسط/موظف']]
    .concat(byDept.map(d => [d.dept, d.headcount, Math.round(d.cost), Math.round(d.avgPerEmp)]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تكلفة الإدارات');
  XLSX.writeFile(wb, `تكلفة_الادارات_${entity}.xlsx`);
}

function exportEmpTable(key) {
  const okFiles = state.files.filter(f => f.status === 'ok');
  const isGroup = key === '__group__';
  let allEmp;
  if (isGroup) {
    allEmp = okFiles.filter(f => (state.selectedMonths[f.entity]||new Set()).has(f.monthKey||f.fileName))
      .flatMap(f => f.employees.map(e => ({...e, __month: f.monthKey||f.fileName, __monthLabel: f.monthKey?MONTH_AR[f.monthKey]:f.monthLabel})));
  } else {
    const selected = state.selectedMonths[key] || new Set();
    allEmp = okFiles.filter(f => f.entity===key && selected.has(f.monthKey||f.fileName))
      .flatMap(f => f.employees.map(e => ({...e, __month: f.monthKey||f.fileName, __monthLabel: f.monthKey?MONTH_AR[f.monthKey]:f.monthLabel})));
  }
  const byEmp = groupByEmployee(allEmp);
  const aoa = [['الرقم الوظيفي','الاسم','الإدارة','الفئة','عدد الأشهر','إجمالي التكلفة','إجمالي الخصومات','صافي المدفوع','متوسط شهري']]
    .concat(byEmp.map(e => [e.personnelNumber, e.name, e.department, e.category, e.monthsCount, Math.round(e.totalGross), Math.round(e.totalDed), Math.round(e.totalNet), Math.round(e.avgGross)]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'تكلفة الموظفين');
  XLSX.writeFile(wb, `تكلفة_الموظفين_${key}.xlsx`);
}
