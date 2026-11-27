/**
 * Google Apps Script Web App API สำหรับเชื่อมต่อ Web App (GitHub Pages) กับ Google Sheets (V3)
 * วิธี Deploy: ส่วนขยาย > Apps Script > วางโค้ดนี้ > ทำให้ใช้งานได้ (Deploy) > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป (ผู้มีสิทธิ์เข้าถึง: ทุกคนในองค์กร / ทุกคน)
 */

function doGet(e) {
  const ss = SpreadsheetApp.getActive();
  const syncData = ss.getSheetByName('06_ฐานข้อมูลวัสดุ_Sync').getDataRange().getValues();
  const items = [];
  for (let i = 1; i < syncData.length; i++) {
    const r = syncData[i];
    if (!r[0]) continue;
    items.push({
      itemId: r[0], group: r[1], name: r[2], spec: r[3],
      stock: Number(r[4] || 0), min: Number(r[5] || 0), max: Number(r[6] || 0),
      unitPrice: Number(r[11] || 0), vendor: r[12] || ''
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, items }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActive();
    const wsAudit = ss.getSheetByName('05_Audit_Log');
    const rAudit = wsAudit.getLastRow() + 1;
    wsAudit.getRange(rAudit, 1, 1, 7).setValues([[
      'LOG-' + String(rAudit).padStart(4, '0'),
      new Date(),
      'WebApp',
      body.action || 'WEB_EVENT',
      'WebApp',
      (body.payload && (body.payload.prId || body.payload.poId || body.payload.rcvId)) || '-',
      JSON.stringify(body.payload || {})
    ]]);

    if (body.action === 'createPR' && body.payload && body.payload.items) {
      const wsPr = ss.getSheetByName('01_เสนอซื้อ_PR');
      const now = new Date();
      body.payload.items.forEach(it => {
        const r = wsPr.getLastRow() + 1;
        wsPr.getRange(r, 1, 1, 4).setValues([[body.payload.prId, now, body.payload.requester, it.itemId]]);
        wsPr.getRange(r, 10).setValue(Number(it.qty));
        wsPr.getRange(r, 15).setValue('รออนุมัติ');
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
