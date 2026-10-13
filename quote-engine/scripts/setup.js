// 로컬 데이터 저장소 준비: 운영·스테이징 저장소에 가상 데이터 적재 + 사업부별 기본 양식 v1 생성·테스트·활성화.
// 서버와 데모도 시작할 때 같은 일을 하므로(이미 있으면 건너뜀) 따로 실행하지 않아도 된다.
// 사용: npm run setup            (이미 있으면 그대로)
//       npm run setup -- --reset (data/store를 지우고 다시 만듦)
import fs from 'node:fs/promises';
import { createContext } from '../src/context.js';
import { STORE_DIR } from '../src/core/paths.js';

if (process.argv.includes('--reset')) {
  await fs.rm(STORE_DIR, { recursive: true, force: true });
  console.log('data/store를 지웠습니다.');
}
for (const target of ['production', 'staging']) {
  const ctx = await createContext({ target, quiet: true, llm: null });
  const counts = {};
  for (const table of ['customers', 'buildings', 'quotes', 'contracts', 'pricing', 'templateVersions', 'divisions']) {
    counts[table] = (await ctx.store.list(table)).length;
  }
  console.log(`[${target}] ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}${target === 'staging' ? ` · 매핑 ID ${ctx.idMap.size()}개` : ''}`);
}
