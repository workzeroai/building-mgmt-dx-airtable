// README 이미지용 서버: 임시 폴더에 새 저장소를 만들어(가상 시드) 견적 엔진 서버를 띄운다.
// 저장소의 data/store·out은 건드리지 않는다. scripts/make_readme_assets.py가 실행한다.
//
//   node scripts/readme-assets/server.mjs --dir <임시 폴더> --port 3199
//
// 관리자 화면 캡처용으로 기계설비 사업부에 양식 v2(머리글 변경, 테스트 통과)와
// v3(합계 값 자리를 수식으로 바꿈, 테스트 실패)를 미리 올려 둔다.
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createContext } from '../../quote-engine/src/context.js';
import { createApp } from '../../quote-engine/src/server.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** 양식 xlsx를 열어 첫 시트를 고친 뒤 버퍼로 돌려준다. */
async function editTemplate(buffer, edit) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  edit(wb.worksheets[0]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 시트에서 값이 `{{key}}`인 셀 주소를 찾는다. */
function findPlaceholder(ws, key) {
  let found = null;
  ws.eachRow((row) => row.eachCell((cell) => {
    if (cell.value === `{{${key}}}`) found = cell.address;
  }));
  return found;
}

const dir = path.resolve(arg('dir', 'out/readme-assets'));
const port = Number(arg('port', 3199));
const ctx = await createContext({
  storeDir: path.join(dir, 'store'),
  outDir: path.join(dir, 'out'),
  env: { DEMO_MODE: 'fake', PATH: process.env.PATH ?? '', SOFFICE_PATH: process.env.SOFFICE_PATH ?? '' },
  llm: null,
  quiet: true,
});

const division = 'mechanical';
const { buffer } = await ctx.templates.getActive(division);
const v2 = await editTemplate(buffer, (ws) => {
  ws.getCell('A1').value = '그리드웰 빌딩서비스 · 기계설비 유지관리';
});
const up2 = await ctx.templates.upload(division, v2, { uploadedBy: '관리자 화면', note: '머리글 변경' });
await ctx.templates.testRender(up2.id);

const v3 = await editTemplate(buffer, (ws) => {
  const total = findPlaceholder(ws, 'total');
  const subtotal = findPlaceholder(ws, 'subtotal');
  const vat = findPlaceholder(ws, 'vat');
  ws.getCell(total).value = { formula: `${subtotal}+${vat}` };
});
const up3 = await ctx.templates.upload(division, v3, { uploadedBy: '관리자 화면', note: '합계 칸 수정' });
await ctx.templates.testRender(up3.id);

createApp(ctx).listen(port, () => {
  console.log(`READY http://localhost:${port} · PDF ${ctx.pdfQueue.status().converter}`);
});
