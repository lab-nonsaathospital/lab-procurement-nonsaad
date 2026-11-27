// ============================================================================
// LAB INVENTORY & PROCUREMENT WEB APP (ISO 15189 / LA / HA / Poka-Yoke)
// - All displayed/printed dates in Thai Buddhist Era (พ.ศ.)
// - Per-delivery F-LAB-91 evaluation (ประเมินทุกรอบที่ส่งของตาม Invoice)
// - Role/PIN switching for Head vs Staff Audit Trail
// ============================================================================

const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function toThaiShort(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`;
}

function toThaiLong(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} พ.ศ. ${d.getFullYear()+543}`;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

const FLAB91_CRITERIA = [
  { cat: 'คุณภาพสินค้า', items: [
    '1. พัสดุหรืองานจ้างในการส่งมอบตรงตามลักษณะที่กำหนดไว้',
    '2. การบรรจุหีบห่อเรียบร้อย',
    '3. พัสดุไม่ชำรุดเสียหาย',
    '4. การขนส่งอยู่ในสภาวะเหมาะสม',
    '5. กรณีที่เป็นวัสดุทางการแพทย์ต้องมีอายุการใช้งานอย่างน้อย 6 เดือน',
    '6. กรณีน้ำยาตรวจ ซึ่งมีอายุสั้นตั้งแต่วันที่ผลิตไม่เกิน 1 ปี และอายุการใช้งานที่เหลือไม่น้อยกว่า 6 เดือน',
    '7. กรณี Cell control ต้องส่งของที่มีอายุการใช้งานที่เหลือไม่น้อยกว่า 1.5 เดือน'
  ]},
  { cat: 'การส่งมอบ', items: [
    '1. ส่งพัสดุ ภายในระยะเวลาที่กำหนด (ไม่เกิน 14 วัน)',
    '2. พัสดุมีความถูกต้อง ครบถ้วน ตามใบสั่งซื้อ/ สั่งจ้าง',
    '3. ใบกำกับสินค้าถูกต้อง ครบถ้วน',
    '4. มีใบเสนอราคาส่งแนบมาด้วยทุกครั้ง'
  ]},
  { cat: 'บริการหลังขาย', items: [
    '1. มีการประกันคุณภาพหรือข้อกำหนดการบริการหลังการส่งมอบ กรณีเช่น ครุภัณฑ์ อุปกรณ์',
    '2. การสนับสนุนด้านวิชาการ เช่น การอบรมทางวิชาการ/ สนับสนุนเอกสาร',
    '3. สนับสนุนงานคุณภาพ เช่น EQA หรือ Inter lab comparison'
  ]}
];

const STORE_KEY = 'lab_proc_v3_state';
let STATE = loadState();
let CURRENT_TAB = 'stock';

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  let st = null;
  if (raw) { try { st = JSON.parse(raw); } catch (e) {} }
  if (!st) {
    st = {
      apiUrl: '',
      currentUser: { name: 'ศิริพร', role: 'staff' },
      headPin: '1234',
      items: (window.SEED_ITEMS || []).map(x => ({ ...x })),
      vendors: (window.SEED_VENDORS || []).map(x => ({ ...x })),
      prs: [], pos: [], receives: [], evals: [],
      logs: [{ id: 'LOG-001', ts: new Date().toISOString(), user: 'System', action: 'INIT', detail: 'เริ่มต้นระบบ Web App พร้อมข้อมูล 207 รายการ' }]
    };
  }
  if (!st.currentUser) st.currentUser = { name: 'ศิริพร', role: 'staff' };
  if (!st.headPin) st.headPin = '1234';
  return st;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(STATE));
  updateBadges();
}

function addLog(action, detail) {
  const id = 'LOG-' + String(STATE.logs.length + 1).padStart(3, '0');
  const actor = `${STATE.currentUser.name} (${STATE.currentUser.role === 'head' ? 'หัวหน้า' : 'ผู้รับผิดชอบ'})`;
  STATE.logs.unshift({ id, ts: new Date().toISOString(), user: actor, action, detail });
}

function getOnOrderQty(itemId) {
  return STATE.pos
    .filter(p => p.itemId === itemId && p.status !== 'ปิดยอดแล้ว')
    .reduce((sum, p) => sum + Math.max(0, p.ordered - p.received), 0);
}

function getItemStatus(it) {
  const onOrder = getOnOrderQty(it.itemId);
  const net = it.stock + onOrder;
  if (it.stock <= 0) return onOrder > 0 ? 'รอของจาก PO' : 'หมด';
  if (net <= it.min) return 'ควรเติมทันที';
  return 'OK';
}

// Group receives by delivery round (poId + recDate + invoiceNo) for per-delivery F-LAB-91!
function getPendingEvaluations() {
  const evalKeys = new Set(STATE.evals.map(e => e.deliveryKey));
  const groups = {};
  STATE.receives.forEach(r => {
    if (r.releaseStatus === 'ปฏิเสธรับ') return;
    const key = `${r.poId}__${r.recDate}__${r.invoiceNo}`;
    if (evalKeys.has(key)) return;
    if (!groups[key]) {
      const po = STATE.pos.find(p => p.poId === r.poId) || {};
      groups[key] = {
        deliveryKey: key,
        poId: r.poId,
        vendor: po.vendor || '-',
        orderDate: po.orderDate || '',
        recDate: r.recDate,
        invoiceNo: r.invoiceNo,
        items: []
      };
    }
    groups[key].items.push(`${r.name} (x${r.qty})`);
  });
  return Object.values(groups);
}

function updateBadges() {
  const pendingPr = new Set(STATE.prs.filter(p => p.status === 'รออนุมัติ').map(p => p.prId)).size;
  const openPo = STATE.pos.filter(p => p.ordered > p.received).length;
  const pendingEval = getPendingEvaluations().length;

  document.getElementById('cntPr').innerHTML = pendingPr ? `<span class="badge b-warn">${pendingPr}</span>` : '';
  document.getElementById('cntPo').innerHTML = openPo ? `<span class="badge b-blue">${openPo}</span>` : '';
  document.getElementById('cntEval').innerHTML = pendingEval ? `<span class="badge b-red">${pendingEval}</span>` : '';
  document.getElementById('connStatus').innerText = STATE.apiUrl ? 'เชื่อม Google Sheets แล้ว' : 'โหมดทดลอง (Local)';

  const ub = document.getElementById('userBadge');
  ub.innerText = STATE.currentUser.role === 'head'
    ? `หัวหน้า: ${STATE.currentUser.name}`
    : `ผู้รับผิดชอบ: ${STATE.currentUser.name}`;
  ub.className = STATE.currentUser.role === 'head' ? 'badge b-ok' : 'badge b-warn';
}

function switchTab(tab, btn) {
  CURRENT_TAB = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  render();
}

function render() {
  updateBadges();
  if (CURRENT_TAB === 'stock') renderStockTab();
  else if (CURRENT_TAB === 'approve') renderApproveTab();
  else if (CURRENT_TAB === 'receive') renderReceiveTab();
  else if (CURRENT_TAB === 'eval') renderEvalTab();
  else if (CURRENT_TAB === 'audit') renderAuditTab();
}

// ============================================================================
// TAB 1: STOCK REPORT & CREATE PR
// ============================================================================
let filterGroup = 'ทั้งหมด', filterStatus = 'ทั้งหมด', filterSearch = '';

function renderStockTab() {
  const groups = ['ทั้งหมด', ...new Set(STATE.items.map(i => i.group))];
  const filtered = STATE.items.filter(it => {
    const st = getItemStatus(it);
    if (filterGroup !== 'ทั้งหมด' && it.group !== filterGroup) return false;
    if (filterStatus === 'ต้องซื้อ (หมด/ควรเติม)' && st !== 'หมด' && st !== 'ควรเติมทันที') return false;
    if (filterStatus === 'OK' && st !== 'OK') return false;
    if (filterSearch && !it.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  });

  const needCount = filtered.filter(i => ['หมด','ควรเติมทันที'].includes(getItemStatus(i))).length;
  const okCount = filtered.filter(i => getItemStatus(i) === 'OK').length;

  let grouped = {};
  filtered.forEach(i => { (grouped[i.group] = grouped[i.group] || []).push(i); });

  let tablesHtml = '';
  Object.keys(grouped).forEach(g => {
    const rows = grouped[g].map((it, idx) => {
      const onOrder = getOnOrderQty(it.itemId);
      const net = it.stock + onOrder;
      const st = getItemStatus(it);
      const suggested = net <= it.min ? Math.max(0, it.max - net) : 0;
      const badgeCls = st === 'OK' ? 'b-ok' : (st === 'หมด' ? 'b-red' : (st === 'รอของจาก PO' ? 'b-blue' : 'b-warn'));
      return `<tr>
        <td class="center">${idx + 1}</td>
        <td>${it.name}<br><small style="color:#64748b">${it.spec || ''}</small></td>
        <td class="center"><b>${it.stock}</b></td>
        <td class="center">${onOrder}</td>
        <td class="center">${it.min}</td>
        <td class="center">${it.max}</td>
        <td class="center"><span class="badge ${badgeCls}">${st}</span></td>
        <td class="center"><input type="number" class="pr-qty" data-id="${it.itemId}" value="${suggested > 0 ? suggested : ''}" min="0" placeholder="........." style="width:75px;text-align:center"></td>
      </tr>`;
    }).join('');
    tablesHtml += `<div style="background:#e2e8f0;padding:6px 10px;font-weight:700;border:1px solid #94a3b8;margin-top:10px">กลุ่มงาน: ${g} (${grouped[g].length} รายการ)</div>
      <table><tr><th>ลำดับ</th><th>ชื่อน้ำยา / วัสดุ</th><th>คงเหลือ</th><th>ค้างรับ PO</th><th>Min</th><th>MAX</th><th>สถานะ</th><th>จำนวนเสนอซื้อ</th></tr>${rows}</table>`;
  });

  document.getElementById('mainContent').innerHTML = `
    <div class="card no-print">
      <div class="toolbar">
        <div class="field"><label>กลุ่มงาน</label>
          <select onchange="filterGroup=this.value;renderStockTab()">${groups.map(g=>`<option ${g===filterGroup?'selected':''}>${g}</option>`).join('')}</select>
        </div>
        <div class="field"><label>สถานะ</label>
          <select onchange="filterStatus=this.value;renderStockTab()">
            <option ${filterStatus==='ทั้งหมด'?'selected':''}>ทั้งหมด</option>
            <option ${filterStatus==='ต้องซื้อ (หมด/ควรเติม)'?'selected':''}>ต้องซื้อ (หมด/ควรเติม)</option>
            <option ${filterStatus==='OK'?'selected':''}>OK</option>
          </select>
        </div>
        <div class="field"><label>ค้นหาชื่อน้ำยา</label>
          <input value="${filterSearch}" oninput="filterSearch=this.value;renderStockTab()" placeholder="พิมพ์ชื่อน้ำยา...">
        </div>
        <button class="btn" onclick="window.print()">🖨️ พิมพ์รายงานคงคลัง (พ.ศ. / A4)</button>
        <button class="btn btn-green" onclick="createPRFromTable()">ส่งใบขอซื้อ (PR) ให้หัวหน้า</button>
      </div>
    </div>

    <div class="card">
      <div class="center">
        <h2 style="margin:0">กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลโนนสะอาด</h2>
        <div>รายงานสรุปยอดคงคลังวัสดุวิทยาศาสตร์ทางการแพทย์ และแผนเสนอจัดซื้อ</div>
        <small>เงื่อนไข: กลุ่มงาน ${filterGroup} | สถานะ ${filterStatus} | พิมพ์เมื่อ: วันที่ ${toThaiLong()}</small>
      </div>
      <div class="kpi-grid" style="margin-top:12px">
        <div class="kpi-box"><small>รายการที่แสดงทั้งหมด</small><div class="num">${filtered.length}</div></div>
        <div class="kpi-box" style="background:#fef2f2"><small>ต้องดำเนินการสั่งซื้อเพิ่ม</small><div class="num" style="color:#dc2626">${needCount}</div></div>
        <div class="kpi-box" style="background:#f0fdf4"><small>สถานะปกติ (OK)</small><div class="num" style="color:#059669">${okCount}</div></div>
      </div>
      ${tablesHtml}
    </div>`;
}

function createPRFromTable() {
  const chosen = [];
  document.querySelectorAll('.pr-qty').forEach(inp => {
    const q = Number(inp.value);
    if (q > 0) chosen.push({ itemId: inp.dataset.id, qty: q });
  });
  if (!chosen.length) return alert('กรุณากรอกจำนวนเสนอซื้ออย่างน้อย 1 รายการครับ');

  const prNum = new Set(STATE.prs.map(p => p.prId)).size + 1;
  const prId = 'PR-2570-' + String(prNum).padStart(3, '0');
  const dt = todayIso();

  chosen.forEach(c => {
    const it = STATE.items.find(x => x.itemId === c.itemId);
    STATE.prs.push({
      prId, date: dt, requester: STATE.currentUser.name, itemId: it.itemId, name: it.name, group: it.group,
      vendor: it.vendor, unitPrice: it.unitPrice, reqQty: c.qty, appQty: c.qty, status: 'รออนุมัติ'
    });
  });
  addLog('CREATE_PR', `สร้าง ${prId} (${chosen.length} รายการ)`);
  saveState();
  syncToApi('createPR', { prId, date: dt, requester: STATE.currentUser.name, items: chosen });
  alert(`✅ ส่งใบขอซื้อ ${prId} จำนวน ${chosen.length} รายการ ให้หัวหน้าอนุมัติแล้ว`);
  renderStockTab();
}

// ============================================================================
// TAB 2: HEAD APPROVE PR (with คงเหลือ / Min / MAX) & CLEAN PO TABLE (Image 1)
// ============================================================================
function renderApproveTab() {
  const pendingIds = [...new Set(STATE.prs.filter(p => p.status === 'รออนุมัติ').map(p => p.prId))];
  let pendingHtml = pendingIds.length ? pendingIds.map(prId => {
    const lines = STATE.prs.filter(p => p.prId === prId && p.status === 'รออนุมัติ');
    const rows = lines.map(l => {
      const it = STATE.items.find(x => x.itemId === l.itemId) || { stock: 0, min: 0, max: 0 };
      const onOrder = getOnOrderQty(l.itemId);
      return `<tr>
        <td><b>${l.name}</b><br><small style="color:#64748b">${l.vendor}</small></td>
        <td class="center"><b>${it.stock}</b></td>
        <td class="center">${onOrder}</td>
        <td class="center">${it.min}</td>
        <td class="center">${it.max}</td>
        <td class="center">${l.reqQty}</td>
        <td class="center"><input type="number" class="app-qty-${prId}" data-item="${l.itemId}" value="${l.reqQty}" min="0" style="width:70px;text-align:center"></td>
        <td class="center">${(l.reqQty * l.unitPrice).toLocaleString()}</td>
      </tr>`;
    }).join('');
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div><b>${prId}</b> | วันที่ขอ: ${toThaiShort(lines[0].date)} | ผู้ขอ: ${lines[0].requester} (${lines.length} รายการ)</div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="min-width:130px"><label>กำหนดส่งมอบ (Due)</label>
            <input id="due_${prId}" type="date" value="${new Date(Date.now()+14*86400000).toISOString().slice(0,10)}">
          </div>
          <button class="btn btn-green" onclick="approvePR('${prId}')">อนุมัติ & แยก PO ตามบริษัท</button>
          <button class="btn btn-red" onclick="rejectPR('${prId}')">ไม่อนุมัติ</button>
        </div>
      </div>
      <table>
        <tr><th>ชื่อน้ำยา / บริษัท</th><th>คงเหลือ</th><th>ค้างรับ PO</th><th>Min</th><th>MAX</th><th>เสนอซื้อ</th><th>จำนวนอนุมัติ (แก้ได้)</th><th>มูลค่าประมาณ (บ.)</th></tr>
        ${rows}
      </table>
    </div>`;
  }).join('') : '<div class="card">✅ ไม่มีใบขอซื้อ (PR) รออนุมัติในขณะนี้</div>';

  // CLEAN STRUCTURED TABLE FOR PO BY VENDOR & DATE (Replaces messy bullets!)
  let byVendorDate = {};
  STATE.pos.forEach(p => {
    const key = `${toThaiShort(p.orderDate)}__${p.vendor}`;
    (byVendorDate[key] = byVendorDate[key] || { dateBE: toThaiShort(p.orderDate), vendor: p.vendor, items: [] }).items.push(p);
  });

  let poPrintHtml = Object.keys(byVendorDate).length ? Object.values(byVendorDate).map(grp => {
    const rows = grp.items.map((p, idx) => {
      const rem = p.ordered - p.received;
      const stBadge = rem <= 0 ? '<span class="badge b-ok">รับครบ ✔</span>' : (p.received > 0 ? `<span class="badge b-warn">ค้าง ${rem}</span>` : `<span class="badge b-red">รอรับ ${rem}</span>`);
      return `<tr>
        <td class="center">${idx + 1}</td>
        <td>${p.group}</td>
        <td><b>${p.name}</b></td>
        <td class="center">${p.poId}</td>
        <td class="center"><b>${p.ordered}</b></td>
        <td class="center">${p.received}</td>
        <td class="center"><b>${rem}</b></td>
        <td class="center">${stBadge}</td>
      </tr>`;
    }).join('');
    return `<div style="margin-top:14px">
      <div style="background:#1b365d;color:#fff;padding:7px 12px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;font-weight:700">
        <span>บริษัท: ${grp.vendor}</span>
        <span>วันที่สั่ง: ${grp.dateBE} (${grp.items.length} รายการ)</span>
      </div>
      <table style="margin-top:0">
        <tr><th style="width:45px;background:#334155">ลำดับ</th><th style="background:#334155">กลุ่มงาน</th><th style="background:#334155">รายการน้ำยา / วัสดุ</th><th style="background:#334155">เลข PO</th><th style="background:#334155">สั่งซื้อ</th><th style="background:#334155">รับแล้ว</th><th style="background:#334155">ค้างรับ</th><th style="background:#334155">สถานะ</th></tr>
        ${rows}
      </table>
    </div>`;
  }).join('') : '<p style="color:#64748b">ยังไม่มีรายการสั่งซื้อ (PO) — เมื่อหัวหน้าอนุมัติ PR รายการจะแสดงที่นี่</p>';

  document.getElementById('mainContent').innerHTML = `
    <div class="no-print"><h3 style="margin-top:0">รายการรออนุมัติ (สำหรับหัวหน้า)</h3>${pendingHtml}</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" class="no-print">
        <h3 style="margin:0">ใบสั่งน้ำยาแยกตามบริษัทผู้ขาย (สำหรับติดตามการรับเข้า)</h3>
        <button class="btn" onclick="window.print()">🖨️ พิมพ์ใบสั่งน้ำยา (พ.ศ. / A4)</button>
      </div>
      <div class="center">
        <h3 style="margin:0">กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลโนนสะอาด</h3>
        <div>ทะเบียนสั่งซื้อน้ำยาและติดตามการรับเข้า (แยกตามบริษัทผู้ขาย) • พิมพ์วันที่ ${toThaiLong()}</div>
      </div>
      ${poPrintHtml}
    </div>`;
}

function approvePR(prId) {
  if (STATE.currentUser.role !== 'head') {
    if (!confirm('⚠️ คุณกำลังใช้งานในบทบาท "ผู้รับผิดชอบ" ต้องการสลับเป็น "หัวหน้า" เพื่ออนุมัติหรือไม่?')) return;
    openUserModal();
    return;
  }
  const due = document.getElementById('due_' + prId).value;
  const qtyMap = {};
  document.querySelectorAll('.app-qty-' + prId).forEach(i => { qtyMap[i.dataset.item] = Number(i.value); });

  const lines = STATE.prs.filter(p => p.prId === prId && p.status === 'รออนุมัติ');
  const byVendor = {};
  lines.forEach(l => {
    const q = qtyMap[l.itemId] ?? l.reqQty;
    l.appQty = q;
    l.status = q > 0 ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (q > 0) (byVendor[l.vendor] = byVendor[l.vendor] || []).push(l);
  });

  const dt = todayIso();
  const createdPOs = [];
  Object.keys(byVendor).forEach(v => {
    const poNum = new Set(STATE.pos.map(p => p.poId)).size + 1;
    const poId = 'PO-2570-' + String(poNum).padStart(3, '0');
    createdPOs.push(poId);
    byVendor[v].forEach(l => {
      STATE.pos.push({
        poId, prId, orderDate: dt, dueDate: due, vendor: v,
        itemId: l.itemId, name: l.name, group: l.group,
        ordered: l.appQty, received: 0, unitPrice: l.unitPrice, status: 'รอรับของ'
      });
    });
  });

  addLog('APPROVE_PR', `อนุมัติ ${prId} -> ออกเลข ${createdPOs.join(', ')}`);
  saveState();
  alert(`✅ อนุมัติ ${prId} เรียบร้อย ออกใบสั่งซื้อ: ${createdPOs.join(', ')}`);
  renderApproveTab();
}

function rejectPR(prId) {
  if (STATE.currentUser.role !== 'head') { alert('⚠️ เฉพาะบทบาท "หัวหน้า" เท่านั้นที่ไม่อนุมัติได้'); return openUserModal(); }
  STATE.prs.filter(p => p.prId === prId && p.status === 'รออนุมัติ').forEach(p => { p.status = 'ไม่อนุมัติ'; });
  addLog('REJECT_PR', `ไม่อนุมัติ ${prId}`);
  saveState();
  renderApproveTab();
}

// ============================================================================
// TAB 3: PO TRACKING, PARTIAL RECEIVING & QC QUARANTINE
// ============================================================================
function renderReceiveTab() {
  const poRows = STATE.pos.map((p, idx) => {
    const rem = p.ordered - p.received;
    const isOverdue = rem > 0 && p.dueDate && todayIso() > p.dueDate;
    const st = rem <= 0 ? 'รับครบแล้ว ✔' : (p.received > 0 ? 'รับบางส่วน (Partial)' : (isOverdue ? 'เลยกำหนดส่ง' : 'รอรับของ'));
    const cls = rem <= 0 ? 'b-ok' : (isOverdue ? 'b-red' : 'b-warn');
    return `<tr>
      <td><b>${p.poId}</b><br><small>สั่ง ${toThaiShort(p.orderDate)}</small></td>
      <td>${p.vendor}</td>
      <td>${p.name}</td>
      <td class="center">${p.ordered}</td>
      <td class="center">${p.received}</td>
      <td class="center"><b>${rem}</b></td>
      <td class="center">${toThaiShort(p.dueDate)}</td>
      <td class="center"><span class="badge ${cls}">${st}</span></td>
      <td class="center">${rem > 0 ? `<button class="btn btn-green" onclick="openReceiveModal(${idx})">ตรวจรับ</button>` : '-'}</td>
    </tr>`;
  }).join('');

  const qList = STATE.receives.map((r, i) => ({ ...r, idx: i })).filter(r => r.releaseStatus === 'Quarantine (รอผล QC)');
  const qRows = qList.map(r => `<tr>
    <td>${r.rcvId} (${r.poId})</td><td>${toThaiShort(r.recDate)}</td><td>${r.name}</td><td>${r.lot}</td>
    <td class="center">${toThaiShort(r.expDate)}</td><td class="center">${r.qty}</td>
    <td class="center">
      <button class="btn btn-green" onclick="releaseQC(${r.idx}, true)">✅ ผ่าน QC -> ขึ้นคลัง</button>
      <button class="btn btn-red" onclick="releaseQC(${r.idx}, false)">❌ ไม่ผ่าน</button>
    </td>
  </tr>`).join('');

  document.getElementById('mainContent').innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">ติดตามใบสั่งซื้อ (PO) & บันทึกตรวจรับ (รองรับแบ่งส่ง Partial)</h3>
      <table>
        <tr><th>เลข PO</th><th>บริษัท</th><th>รายการ</th><th>สั่งซื้อ</th><th>รับแล้ว</th><th>ค้างรับ</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ดำเนินการ</th></tr>
        ${poRows || '<tr><td colspan="9" class="center">ยังไม่มีรายการ PO</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h3 style="margin-top:0">สินค้ากักกันรอทวนสอบ Lot ใหม่ (Quarantine / QC Verification)</h3>
      <table>
        <tr><th>เลขรับเข้า</th><th>วันที่รับ</th><th>รายการ</th><th>Lot No.</th><th>วันหมดอายุ</th><th>จำนวน</th><th>ผลทวนสอบ QC</th></tr>
        ${qRows || '<tr><td colspan="7" class="center">ไม่มีสินค้าค้างรอผล QC</td></tr>'}
      </table>
    </div>`;
}

function openReceiveModal(poIdx) {
  const p = STATE.pos[poIdx];
  const rem = p.ordered - p.received;
  document.getElementById('modalBody').innerHTML = `
    <h3 style="margin-top:0">📦 บันทึกตรวจรับสินค้า: ${p.poId}</h3>
    <p><b>${p.name}</b> | บริษัท: ${p.vendor} | ค้างรับ: <b style="color:#dc2626">${rem}</b></p>
    <div class="toolbar">
      <div class="field"><label>จำนวนรับรอบนี้ (ห้ามเกิน ${rem})</label><input id="mQty" type="number" value="${rem}" max="${rem}" min="1"></div>
      <div class="field"><label>วันที่รับจริง</label><input id="mDate" type="date" value="${todayIso()}"></div>
      <div class="field"><label>เลขที่ใบส่งของ / Invoice</label><input id="mInv" placeholder="เช่น IV-69110041"></div>
    </div>
    <div class="toolbar">
      <div class="field"><label>Lot No.</label><input id="mLot"></div>
      <div class="field"><label>วันหมดอายุ</label><input id="mExp" type="date"></div>
      <div class="field"><label>อุณหภูมิขณะรับ (°C)</label><input id="mTemp" placeholder="เช่น 2-8 °C หรือ RT"></div>
    </div>
    <div class="toolbar">
      <div class="field"><label>สภาพบรรจุภัณฑ์</label><select id="mPack"><option>ผ่าน</option><option>ไม่ผ่าน (ชำรุด)</option></select></div>
      <div class="field"><label>เอกสาร CoA</label><select id="mCoa"><option>ครบ</option><option>ไม่ครบ</option><option>ไม่ต้องมี</option></select></div>
      <div class="field"><label>สถานะปล่อยคลัง</label><select id="mRel"><option>พร้อมใช้</option><option>Quarantine (รอผล QC)</option><option>ปฏิเสธรับ</option></select></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-green" onclick="submitReceive(${poIdx})">บันทึกตรวจรับ</button>
    </div>`;
  document.getElementById('modalBackdrop').style.display = 'flex';
}

function submitReceive(poIdx) {
  const p = STATE.pos[poIdx];
  const rem = p.ordered - p.received;
  const qty = Number(document.getElementById('mQty').value);
  if (qty <= 0 || qty > rem) return alert(`❌ Poka-Yoke: จำนวนรับ (${qty}) ต้องอยู่ระหว่าง 1 ถึง ${rem}`);

  const rel = document.getElementById('mRel').value;
  const rcvId = 'RCV-2570-' + String(STATE.receives.length + 1).padStart(3, '0');
  const recDate = document.getElementById('mDate').value;
  const expDate = document.getElementById('mExp').value;
  const inv = document.getElementById('mInv').value.trim() || '-';
  const lot = document.getElementById('mLot').value.trim() || '-';

  STATE.receives.push({ rcvId, poId: p.poId, itemId: p.itemId, name: p.name, recDate, invoiceNo: inv, lot, expDate, qty, releaseStatus: rel });
  if (rel !== 'ปฏิเสธรับ') p.received += qty;
  if (rel === 'พร้อมใช้') {
    const it = STATE.items.find(x => x.itemId === p.itemId);
    if (it) it.stock += qty;
  }
  addLog('RECEIVE', `${rcvId} (${p.poId}) รับ ${qty} | บิล:${inv} | Lot:${lot} | ${rel}`);
  saveState();
  closeModal();
  renderReceiveTab();
  if (rel !== 'ปฏิเสธรับ') {
    alert(`✅ บันทึกตรวจรับ ${rcvId} เรียบร้อย! (รายการนี้ไปรอให้ประเมินผู้ขาย F-LAB-91 ในแท็บที่ 4 แล้วครับ)`);
  }
}

function releaseQC(rcvIdx, pass) {
  const r = STATE.receives[rcvIdx];
  r.releaseStatus = pass ? 'พร้อมใช้' : 'ปฏิเสธรับ';
  if (pass) {
    const it = STATE.items.find(x => x.itemId === r.itemId);
    if (it) it.stock += r.qty;
  } else {
    const po = STATE.pos.find(p => p.poId === r.poId && p.itemId === r.itemId);
    if (po) po.received = Math.max(0, po.received - r.qty);
  }
  addLog('QC_RELEASE', `${r.rcvId} ผล QC = ${pass ? 'ผ่าน (ขึ้นคลัง)' : 'ไม่ผ่าน'}`);
  saveState();
  renderReceiveTab();
}

// ============================================================================
// TAB 4: PER-DELIVERY F-LAB-91 EVALUATION (ประเมินทุกรอบที่ส่งของ!)
// ============================================================================
function renderEvalTab() {
  const pendingDeliveries = getPendingEvaluations();
  window._pendingDeliveries = pendingDeliveries;

  const readyHtml = pendingDeliveries.map((d, idx) => `
    <tr>
      <td><b>${d.poId}</b></td>
      <td>${d.vendor}</td>
      <td class="center">${toThaiShort(d.recDate)}</td>
      <td class="center"><b>${d.invoiceNo}</b></td>
      <td>${d.items.join(', ')}</td>
      <td class="center"><button class="btn btn-amber" onclick="openEvalModal(${idx})">ประเมินรอบนี้ (F-LAB-91)</button></td>
    </tr>`).join('');

  const evalRows = STATE.evals.map((e, i) => `
    <tr><td>${e.evalId}</td><td>${e.poId}</td><td>${e.vendorName}</td><td>${toThaiShort(e.recDate)}</td><td>${e.invoiceNo}</td>
    <td class="center"><b>${e.pct}%</b></td>
    <td class="center"><span class="badge ${e.result==='ผ่าน'?'b-ok':'b-red'}">${e.result}</span></td>
    <td class="center"><button class="btn" onclick="printFLab91(${i})">🖨️ พิมพ์ F-LAB-91 (A4)</button></td></tr>`).join('');

  document.getElementById('mainContent').innerHTML = `
    <div class="info-banner no-print">
      <b>คำแนะนำการใช้งาน:</b> หน้านี้ใช้ประเมินผู้ขาย <b>ทุกรอบที่มีการส่งของเข้าแล็บ (อ้างอิงตามวันที่รับและเลขที่บิล Invoice)</b> แม้ว่าจะส่งมาแค่บางส่วนก็ตาม — ทันทีที่บันทึกตรวจรับในแท็บ 3 รายการจะมาปรากฏที่นี่โดยอัตโนมัติ
    </div>
    <div class="card no-print">
      <h3 style="margin-top:0">รอบส่งของที่รอประเมินผู้ขาย (F-LAB-91)</h3>
      <table><tr><th>เลข PO</th><th>บริษัทผู้ขาย</th><th>วันที่รับของ</th><th>เลขที่บิล (Invoice)</th><th>รายการที่มาส่งรอบนี้</th><th>ประเมิน</th></tr>
        ${readyHtml || '<tr><td colspan="6" class="center">ประเมินครบทุกรอบที่ส่งของแล้ว (หรือยังไม่มีการตรวจรับในแท็บ 3)</td></tr>'}
      </table>
    </div>
    <div class="card no-print">
      <h3 style="margin-top:0">ประวัติการประเมินผู้ขาย (F-LAB-91)</h3>
      <table><tr><th>เลขประเมิน</th><th>เลข PO</th><th>บริษัท</th><th>วันที่รับ</th><th>เลขที่บิล</th><th>ร้อยละ</th><th>ผล</th><th>พิมพ์</th></tr>
        ${evalRows || '<tr><td colspan="8" class="center">ยังไม่มีประวัติการประเมิน</td></tr>'}
      </table>
    </div>
    <div id="flabPrintArea" class="card" style="display:none"></div>`;
}

function openEvalModal(delivIdx) {
  const d = window._pendingDeliveries[delivIdx];
  const diffDays = (d.orderDate && d.recDate) ? (new Date(d.recDate) - new Date(d.orderDate)) / 86400000 : 0;
  const onTime = diffDays <= 14;

  let qIdx = 0, rows = '';
  FLAB91_CRITERIA.forEach(grp => {
    grp.items.forEach((txt, i) => {
      rows += `<tr>${i===0?`<td rowspan="${grp.items.length}"><b>${grp.cat}</b></td>`:''}
        <td>${txt}</td>
        <td class="center"><select class="f91-sel" data-idx="${qIdx}">
          <option value="ผ่าน" ${(qIdx===7 && !onTime)?'':'selected'}>✔ ผ่าน</option>
          <option value="ไม่ผ่าน" ${(qIdx===7 && !onTime)?'selected':''}>✗ ไม่ผ่าน</option>
          <option value="N/A">- ไม่เกี่ยวข้อง</option>
        </select></td></tr>`;
      qIdx++;
    });
  });

  document.getElementById('modalBody').innerHTML = `
    <h3 style="margin-top:0">⭐ ประเมินผู้ขายรายเก่า (F-LAB-91): ${d.vendor}</h3>
    <p>รอบส่งวันที่ <b>${toThaiShort(d.recDate)}</b> | บิล: <b>${d.invoiceNo}</b> | รายการ: ${d.items.join(', ')}</p>
    <div class="toolbar">
      <div class="field"><label>เลขที่บิล (Invoice)</label><input id="fInv" value="${d.invoiceNo}"></div>
      <div class="field"><label>ผู้ประเมิน</label><input id="fUser" value="${STATE.currentUser.name}"></div>
    </div>
    <table><tr><th>หมวด</th><th>รายการตรวจสอบ</th><th>ผลประเมิน</th></tr>${rows}</table><br>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-green" onclick="saveEval(${delivIdx})">บันทึกผลประเมิน F-LAB-91</button>
    </div>`;
  document.getElementById('modalBackdrop').style.display = 'flex';
}

function saveEval(delivIdx) {
  const d = window._pendingDeliveries[delivIdx];
  const v = STATE.vendors.find(x => x.name === d.vendor) || {};
  const crit = Array.from(document.querySelectorAll('.f91-sel')).map(s => s.value);
  const passCount = crit.filter(x => x === 'ผ่าน').length;
  const failCount = crit.filter(x => x === 'ไม่ผ่าน').length;
  const pct = (passCount + failCount) > 0 ? ((passCount / (passCount + failCount)) * 100).toFixed(2) : '0.00';
  const result = Number(pct) > 80 ? 'ผ่าน' : 'ไม่ผ่าน';
  const evalId = 'EV-2570-' + String(STATE.evals.length + 1).padStart(3, '0');

  STATE.evals.push({
    evalId, deliveryKey: d.deliveryKey, poId: d.poId, vendorName: d.vendor,
    vendorAddr: v.addr || '-', vendorTel: v.tel || '-', vendorRep: v.rep || '-',
    vendorRepTel: v.repTel || '-', vendorType: v.type || 'ตัวแทนจำหน่าย',
    invoiceNo: document.getElementById('fInv').value, orderDate: d.orderDate, recDate: d.recDate,
    criteria: crit, passCount, failCount, pct, result,
    evaluator: document.getElementById('fUser').value, evalDate: todayIso()
  });
  addLog('EVAL_FLAB91', `${evalId} (${d.vendor} / บิล ${d.invoiceNo}) ได้ ${pct}% -> ${result}`);
  saveState();
  closeModal();
  renderEvalTab();
}

function printFLab91(idx) {
  const e = STATE.evals[idx];
  const box = (checked) => `<span style="display:inline-block;width:14px;height:14px;border:1.5px solid #000;text-align:center;line-height:13px;font-size:12px;vertical-align:middle;margin-right:4px;font-weight:bold">${checked ? '✔' : '&nbsp;'}</span>`;

  let i = 0, rows = '';
  FLAB91_CRITERIA.forEach(grp => {
    grp.items.forEach((txt, j) => {
      const val = e.criteria[i++];
      rows += `<tr>
        ${j === 0 ? `<td rowspan="${grp.items.length}" style="border:1px solid #000;padding:6px;vertical-align:top;width:110px"><b>${grp.cat}</b></td>` : ''}
        <td style="border:1px solid #000;padding:4px 8px">${txt}</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;width:48px">${box(val === 'ผ่าน')}</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;width:54px">${box(val === 'ไม่ผ่าน')}</td>
      </tr>`;
    });
  });

  const vTypes = ['ผู้ผลิตและจัดจำหน่าย', 'ตัวแทนจำหน่าย', 'ตัวแทนจำหน่ายแต่ผู้เดียว', 'ผู้รับจ้าง'];
  const typeBoxes = vTypes.map(t => `<div style="margin-bottom:3px">${box(e.vendorType === t)} ${t}</div>`).join('');

  const area = document.getElementById('flabPrintArea');
  area.style.display = 'block';
  area.innerHTML = `
    <div style="font-family:'Sarabun',sans-serif;color:#000;font-size:13.5px;line-height:1.45;padding:10px 14px">
      <div style="text-align:right;font-size:12px;line-height:1.2">F-LAB-91<br>00/01/10/2566</div>
      <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:10px">
        แบบฟอร์มประเมินผู้ขายรายเก่า<br>โรงพยาบาลโนนสะอาด จังหวัดอุดรธานี
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:6px">
        <div style="flex:1">
          <div><b>บริษัทผู้ขาย :</b> &nbsp; ${e.vendorName}</div>
          <div><b>ที่อยู่ :</b> &nbsp; ${e.vendorAddr || '-'}</div>
          <div><b>โทรศัพท์ :</b> &nbsp; ${e.vendorTel || '-'} &nbsp;&nbsp; <b>ผู้แทนจำหน่าย :</b> &nbsp; ${e.vendorRep || '-'} &nbsp;&nbsp; <b>โทรศัพท์ :</b> &nbsp; ${e.vendorRepTel || '-'}</div>
          <div><b>ประเภทสินค้า/ บริการ :</b> &nbsp; วัสดุวิทยาศาสตร์</div>
        </div>
        <div style="min-width:180px;font-size:13px">${typeBoxes}</div>
      </div>

      <div style="display:flex;justify-content:space-between;margin:6px 0 6px 0">
        <span><b>วันที่สั่งสินค้า</b> &nbsp; ${toThaiShort(e.orderDate)}</span>
        <span><b>วันที่รับสินค้า</b> &nbsp; ${toThaiShort(e.recDate)}</span>
        <span><b>เลขที่บิล</b> &nbsp; ${e.invoiceNo}</span>
      </div>

      <table style="width:100%;border-collapse:collapse;border:1.5px solid #000;font-size:13px">
        <thead>
          <tr>
            <th rowspan="2" style="border:1px solid #000;background:#fff;color:#000;padding:6px;text-align:center">หมวด</th>
            <th rowspan="2" style="border:1px solid #000;background:#fff;color:#000;padding:6px;text-align:center">รายการตรวจสอบ</th>
            <th colspan="2" style="border:1px solid #000;background:#fff;color:#000;padding:4px;text-align:center">ผลการประเมิน</th>
          </tr>
          <tr>
            <th style="border:1px solid #000;background:#fff;color:#000;padding:3px;text-align:center">ผ่าน</th>
            <th style="border:1px solid #000;background:#fff;color:#000;padding:3px;text-align:center">ไม่ผ่าน</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:8px"><b>บันทึกเพิ่มเติม</b> ...............................................................................................................................................................</div>
      <div style="border-top:1px dotted #000;margin:8px 0"></div>

      <table style="width:100%;border:none;border-collapse:collapse;font-size:13.5px">
        <tr>
          <td style="border:none;padding:2px 0;width:160px"><b>เกณฑ์การประเมิน :</b></td>
          <td style="border:none;padding:2px 0">ได้รับคะแนนการประเมินมากกว่าร้อยละ 80</td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 0"><b>ผลการประเมิน :</b></td>
          <td style="border:none;padding:2px 0">ผ่าน &nbsp;&nbsp; <b>${e.passCount}</b> &nbsp;&nbsp; ข้อ &nbsp;&nbsp;&nbsp;&nbsp; ไม่ผ่าน &nbsp;&nbsp; <b>${e.failCount}</b> &nbsp;&nbsp; ข้อ</td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 0"></td>
          <td style="border:none;padding:2px 0">ร้อยละผลการประเมิน &nbsp;&nbsp;&nbsp; <b>${e.pct}%</b></td>
        </tr>
        <tr>
          <td style="border:none;padding:2px 0"></td>
          <td style="border:none;padding:2px 0">* สรุปผลการประเมิน &nbsp;&nbsp;&nbsp; ${box(e.result === 'ผ่าน')} ผ่าน &nbsp;&nbsp;&nbsp;&nbsp; ${box(e.result === 'ไม่ผ่าน')} ไม่ผ่าน</td>
        </tr>
      </table>

      <div style="margin-top:18px;text-align:center">
        <div>ผู้ประเมิน ................................................................. (หัวหน้าห้องปฏิบัติการ)</div>
        <div style="margin-top:4px">( ${e.evaluator} )</div>
        <div style="margin-top:4px">วันที่ &nbsp; ${toThaiLong(e.evalDate)}</div>
      </div>
    </div>
    <div class="no-print" style="margin-top:12px;text-align:right"><button class="btn" onclick="window.print()">🖨️ สั่งพิมพ์หน้านี้ (A4)</button></div>`;
  area.scrollIntoView({ behavior: 'smooth' });
}

// ============================================================================
// TAB 5: AUDIT LOG, ROLE/PIN MODAL & SETTINGS
// ============================================================================
function renderAuditTab() {
  const rows = STATE.logs.map(l => `<tr>
    <td>${l.id}</td><td>${toThaiShort(l.ts)} ${new Date(l.ts).toLocaleTimeString('th-TH')}</td>
    <td>${l.user}</td><td><span class="badge b-blue">${l.action}</span></td><td>${l.detail}</td>
  </tr>`).join('');
  document.getElementById('mainContent').innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">ประวัติการทำงานย้อนหลัง (Immutable Audit Log)</h3>
      <table><tr><th>Log ID</th><th>วันเวลา (พ.ศ.)</th><th>ผู้ทำรายการ</th><th>การกระทำ</th><th>รายละเอียด</th></tr>${rows}</table>
    </div>`;
}

function openUserModal() {
  document.getElementById('modalBody').innerHTML = `
    <h3 style="margin-top:0">สลับผู้ใช้งาน (แยกสิทธิ์ผู้รับผิดชอบ vs หัวหน้า)</h3>
    <div class="toolbar">
      <div class="field"><label>ชื่อผู้ใช้งาน</label><input id="uName" value="${STATE.currentUser.name}"></div>
      <div class="field"><label>บทบาท</label>
        <select id="uRole" onchange="document.getElementById('pinWrap').style.display=this.value==='head'?'flex':'none'">
          <option value="staff" ${STATE.currentUser.role==='staff'?'selected':''}>ผู้รับผิดชอบคลัง</option>
          <option value="head" ${STATE.currentUser.role==='head'?'selected':''}>หัวหน้ากลุ่มงาน (ใช้ PIN)</option>
        </select>
      </div>
      <div class="field" id="pinWrap" style="display:${STATE.currentUser.role==='head'?'flex':'none'}">
        <label>รหัส PIN หัวหน้า (ค่าเริ่มต้น: 1234)</label><input id="uPin" type="password" placeholder="PIN 4 หลัก">
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-green" onclick="switchUser()">ตกลง</button>
    </div>`;
  document.getElementById('modalBackdrop').style.display = 'flex';
}

function switchUser() {
  const role = document.getElementById('uRole').value;
  const name = document.getElementById('uName').value.trim() || 'ผู้ใช้งาน';
  if (role === 'head') {
    const pin = document.getElementById('uPin').value;
    if (pin !== STATE.headPin) return alert('❌ รหัส PIN หัวหน้าไม่ถูกต้อง (ค่าเริ่มต้นคือ 1234)');
  }
  STATE.currentUser = { name, role };
  saveState();
  closeModal();
  render();
}

function openSettings() {
  document.getElementById('modalBody').innerHTML = `
    <h3 style="margin-top:0">ตั้งค่าเชื่อมต่อ Google Sheets & รหัส PIN หัวหน้า</h3>
    <div class="field"><label>Apps Script Web App URL (เว้นว่าง = โหมดทดลอง Local)</label>
      <input id="sApi" value="${STATE.apiUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
    </div><br>
    <div class="field"><label>เปลี่ยนรหัส PIN หัวหน้า (ปัจจุบัน: ${STATE.headPin})</label>
      <input id="sPin" value="${STATE.headPin}">
    </div><br>
    <div style="display:flex;gap:8px;justify-content:space-between">
      <button class="btn btn-red" onclick="if(confirm('รีเซ็ตข้อมูลทดลองทั้งหมด?')){localStorage.removeItem('${STORE_KEY}');location.reload();}">🗑️ รีเซ็ตข้อมูลทดลอง</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="closeModal()">ปิด</button>
        <button class="btn btn-green" onclick="STATE.apiUrl=document.getElementById('sApi').value.trim();STATE.headPin=document.getElementById('sPin').value.trim()||'1234';saveState();closeModal();render();">บันทึก</button>
      </div>
    </div>`;
  document.getElementById('modalBackdrop').style.display = 'flex';
}

function closeModal() { document.getElementById('modalBackdrop').style.display = 'none'; }

async function syncToApi(action, payload) {
  if (!STATE.apiUrl) return;
  try {
    await fetch(STATE.apiUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
  } catch (e) { console.warn('API sync:', e); }
}

render();
