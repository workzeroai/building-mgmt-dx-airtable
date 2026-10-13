// 엑셀 양식 만들기·검사·채우기 (ExcelJS).
//
// 양식 규칙(현업이 엑셀에서 직접 고칠 수 있는 수준으로 단순하게):
// - 값 자리: 셀에 {{키}}  예) {{quoteNo}}, {{total}}. 셀 전체가 {{키}}면 숫자는 숫자로 들어간다.
// - 항목 표: 첫 항목 행에 {{item.name}} {{item.basis}} {{item.amount}}처럼 열마다 항목 필드를 적고,
//   마지막 항목 행 바로 아래 행의 A열에 {{/items}}를 둔다. 두 행 사이 행 수가 항목 최대 개수다.
import ExcelJS from 'exceljs';
import { TemplateError } from './errors.js';

const PLACEHOLDER = /\{\{\s*([\w.#/]+)\s*\}\}/gu;
const FONT = 'Malgun Gothic';
const COLOR = { primary: 'FF3730A3', primaryFill: 'FFE0E7FF', line: 'FFCBD5E1', muted: 'FF64748B', zone: 'FFF8FAFC' };

/** 모든 양식에 반드시 있어야 하는 값 자리. */
export const REQUIRED_PLACEHOLDERS = ['quoteNo', 'quoteDate', 'customerName', 'address', 'subtotal', 'vat', 'total'];

/** 병합 셀의 나머지 칸(master가 아닌 칸)은 master 값을 그대로 돌려주므로 건너뛴다. */
const isMergedSlave = (cell) => cell.isMerged && cell.master && cell.master.address !== cell.address;

function cellText(cell) {
  if (isMergedSlave(cell)) return null;
  const v = cell.value;
  if (typeof v === 'string') return v;
  if (v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  return null;
}

/** 사업부 config.template 사양 → 표준 레이아웃의 양식 워크북. */
export function buildTemplateWorkbook(division) {
  const spec = division.template;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'quote-engine (가상 데모)';
  wb.created = new Date(Date.UTC(2026, 9, 1));
  const ws = wb.addWorksheet(division.outputSheet, {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 24 }, { width: 30 }, { width: 16 }, { width: 22 }];
  const base = { name: FONT, size: 10, color: { argb: 'FF1E293B' } };
  const thin = { style: 'thin', color: { argb: COLOR.line } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  const set = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { ...base, ...(style.font ?? {}) };
    if (style.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    if (style.numFmt) c.numFmt = style.numFmt;
    c.alignment = { vertical: 'middle', wrapText: true, ...(style.alignment ?? {}) };
    if (style.border) c.border = style.border;
    return c;
  };

  set('A1', '그리드웰 빌딩서비스', { font: { bold: true, size: 11, color: { argb: COLOR.primary } } });
  set('D1', '가상 회사 · 데모 양식', { font: { size: 9, color: { argb: COLOR.muted } }, alignment: { horizontal: 'right' } });
  ws.mergeCells('A2:D2');
  set('A2', spec.title, { font: { bold: true, size: 18, color: { argb: 'FF0F172A' } }, alignment: { horizontal: 'center' } });
  ws.getRow(2).height = 34;

  const label = { font: { bold: true, color: { argb: 'FF334155' } }, fill: COLOR.zone, border: box };
  const value = { border: box };
  const infoRows = [
    ['견적번호', '{{quoteNo}}', '견적일', '{{quoteDate}}'],
    ['고객', '{{customerName}}', '유효기간', '{{validUntil}}'],
    ['주소', '{{address}}', null, null],
    ['건물명', '{{buildingName}}', '주용도', '{{mainPurpose}}'],
    ['연면적(㎡)', '{{totalArea}}', '층수', '{{floors}}'],
  ];
  const extra = spec.fields ?? [];
  for (let i = 0; i < extra.length; i += 2) {
    const a = extra[i];
    const b = extra[i + 1];
    infoRows.push([a.label, `{{${a.key}}}`, b?.label ?? null, b ? `{{${b.key}}}` : null]);
  }
  let row = 4;
  for (const [l1, v1, l2, v2] of infoRows) {
    set(`A${row}`, l1, label);
    set(`B${row}`, v1, { ...value, numFmt: v1 === '{{totalArea}}' ? '#,##0.00' : undefined, alignment: { horizontal: 'left' } });
    if (l2 === null && v2 === null && l1 === '주소') {
      ws.mergeCells(`B${row}:D${row}`);
    } else {
      set(`C${row}`, l2 ?? '', l2 ? label : value);
      set(`D${row}`, v2 ?? '', value);
    }
    ws.getRow(row).height = 22;
    row += 1;
  }

  row += 1;
  const header = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: COLOR.primary, border: box, alignment: { horizontal: 'center' } };
  set(`A${row}`, '항목', header);
  ws.mergeCells(`B${row}:C${row}`);
  set(`B${row}`, '산출 근거', header);
  set(`D${row}`, '금액(원)', header);
  ws.getRow(row).height = 22;
  row += 1;

  const capacity = spec.itemRows ?? 10;
  const itemStart = row;
  for (let i = 0; i < capacity; i += 1) {
    const r = itemStart + i;
    set(`A${r}`, i === 0 ? '{{item.name}}' : null, value);
    ws.mergeCells(`B${r}:C${r}`);
    set(`B${r}`, i === 0 ? '{{item.basis}}' : null, { ...value, font: { size: 9, color: { argb: 'FF475569' } } });
    set(`D${r}`, i === 0 ? '{{item.amount}}' : null, { ...value, numFmt: '#,##0', alignment: { horizontal: 'right' } });
    ws.getRow(r).height = 20;
  }
  row = itemStart + capacity;
  set(`A${row}`, '{{/items}}', { font: { size: 6, color: { argb: 'FFFFFFFF' } } });
  row += 1;

  const totals = [['공급가액', '{{subtotal}}', false], ['부가세(10%)', '{{vat}}', false], ['합계(VAT 포함)', '{{total}}', true]];
  for (const [l, v, strong] of totals) {
    set(`C${row}`, l, { ...label, fill: strong ? COLOR.primaryFill : COLOR.zone });
    set(`D${row}`, v, {
      border: box, numFmt: '#,##0', alignment: { horizontal: 'right' },
      font: strong ? { bold: true, size: 12, color: { argb: COLOR.primary } } : {},
      fill: strong ? COLOR.primaryFill : undefined,
    });
    ws.getRow(row).height = strong ? 26 : 20;
    row += 1;
  }

  row += 1;
  ws.mergeCells(`A${row}:D${row}`);
  set(`A${row}`, '※ 가상 회사·가상 단가로 만든 데모 견적서입니다. 단가 출처 {{pricingSource}} · 단가 버전 {{pricingVersion}} · 양식 v{{templateVersion}}',
    { font: { size: 8, color: { argb: COLOR.muted } } });
  if (spec.footnote) {
    row += 1;
    ws.mergeCells(`A${row}:D${row}`);
    set(`A${row}`, `※ ${spec.footnote}`, { font: { size: 8, color: { argb: COLOR.muted } } });
  }
  ws.pageSetup.printArea = `A1:D${row}`;
  return wb;
}

export async function buildTemplateBuffer(division) {
  return Buffer.from(await buildTemplateWorkbook(division).xlsx.writeBuffer());
}

async function loadSheet(buffer, sheetName) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw new TemplateError(`엑셀 파일을 읽지 못했습니다: ${err.message}`);
  }
  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    throw new TemplateError(`양식에 "${sheetName}" 시트가 없습니다.`, { sheets: wb.worksheets.map((w) => w.name) });
  }
  return { wb, ws };
}

function scan(ws) {
  const placeholders = new Set();
  const itemColumns = {};
  let itemStart = null;
  let itemEnd = null;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const text = cellText(cell);
      if (!text) return;
      for (const [, key] of text.matchAll(PLACEHOLDER)) {
        if (key === '/items') itemEnd ??= rowNumber;
        else if (key.startsWith('item.')) {
          itemStart ??= rowNumber;
          if (rowNumber === itemStart) itemColumns[col] = key.slice(5);
        } else placeholders.add(key);
      }
    });
  });
  return { placeholders, itemColumns, itemStart, itemEnd };
}

/** 양식 구조 검사(값을 채우지 않고 자리만 본다). */
export async function inspectTemplate(buffer, sheetName) {
  const { ws } = await loadSheet(buffer, sheetName);
  const s = scan(ws);
  const errors = [];
  for (const key of REQUIRED_PLACEHOLDERS) if (!s.placeholders.has(key)) errors.push(`필수 값 자리 {{${key}}} 없음`);
  if (s.itemStart === null) errors.push('항목 표 시작({{item.…}}) 없음');
  if (s.itemEnd === null) errors.push('항목 표 끝({{/items}}) 없음');
  if (s.itemStart !== null && s.itemEnd !== null && s.itemEnd <= s.itemStart) errors.push('{{/items}}가 항목 시작 행보다 위에 있음');
  return {
    errors,
    placeholders: [...s.placeholders].sort(),
    itemColumns: Object.values(s.itemColumns),
    capacity: s.itemStart !== null && s.itemEnd !== null ? s.itemEnd - s.itemStart : 0,
  };
}

/**
 * 양식에 값을 채운다.
 * @param {Buffer} buffer 양식 xlsx
 * @param {{ sheetName: string, values: Record<string, unknown>, items: object[], strict?: boolean }} data
 * @returns {Promise<{ buffer: Buffer, unresolved: string[] }>}
 */
export async function renderTemplate(buffer, { sheetName, values, items, strict = false }) {
  const { wb, ws } = await loadSheet(buffer, sheetName);
  const s = scan(ws);
  if (s.itemStart === null || s.itemEnd === null || s.itemEnd <= s.itemStart) {
    throw new TemplateError('양식에 항목 표 영역({{item.…}} ~ {{/items}})이 없습니다.');
  }
  const capacity = s.itemEnd - s.itemStart;
  if (items.length > capacity) {
    throw new TemplateError(`항목이 ${items.length}개인데 양식 항목 칸은 ${capacity}개입니다.`, { capacity, items: items.length });
  }

  for (let i = 0; i < capacity; i += 1) {
    const row = ws.getRow(s.itemStart + i);
    for (const [col, field] of Object.entries(s.itemColumns)) {
      row.getCell(Number(col)).value = items[i]?.[field] ?? null;
    }
  }
  ws.getRow(s.itemEnd).eachCell((cell) => {
    if (cellText(cell)?.includes('{{/items}}')) cell.value = null;
  });

  const unresolved = new Set();
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell);
      if (!text || !text.includes('{{')) return;
      const whole = /^\{\{\s*([\w.]+)\s*\}\}$/u.exec(text.trim());
      if (whole && Object.hasOwn(values, whole[1])) {
        cell.value = values[whole[1]] ?? null;
        return;
      }
      cell.value = text.replace(PLACEHOLDER, (m, key) => {
        if (Object.hasOwn(values, key)) return String(values[key] ?? '');
        unresolved.add(key);
        return m;
      });
    });
  });

  if (strict && unresolved.size > 0) {
    throw new TemplateError(`채우지 못한 값 자리: ${[...unresolved].map((k) => `{{${k}}}`).join(', ')}`, { unresolved: [...unresolved] });
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), unresolved: [...unresolved] };
}
