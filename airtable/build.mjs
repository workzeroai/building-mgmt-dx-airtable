// 스키마 YAML 하나에서 파생 산출물을 모두 만든다.
//   node airtable/build.mjs          갱신(npm run airtable:build)
//   node airtable/build.mjs --check  최신이 아니면 종료 코드 1(npm run airtable:check, CI)
// 만드는 것: docs/schema.md · docs/diagrams/erd-*.yaml · data/seed/ops/*.json · data/seed/csv/** ·
//           airtable/automations/scripts/*.js(생성 구간) · airtable/automations/catalog.md · n8n/sync-safety.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAll } from './lib/build.js';
import { rel } from './lib/paths.js';

export async function main(argv = process.argv.slice(2), log = console.log) {
  const check = argv.includes('--check');
  const { outputs, problems, summary } = await buildAll();
  if (problems.length) {
    log('스키마 검사 실패:');
    for (const p of problems) log(`  - ${p}`);
    return 1;
  }
  const stale = [];
  for (const [file, content] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/gu, '\n') : null;
    if (current === content) continue;
    stale.push(file);
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
  }
  if (check) {
    if (stale.length) {
      log(`최신이 아닌 파일 ${stale.length}개 — npm run airtable:build 로 다시 만드세요:`);
      for (const f of stale) log(`  - ${rel(f)}`);
      return 1;
    }
    log(`스키마 파생 산출물 ${outputs.size}개 모두 최신 (${summary})`);
    return 0;
  }
  log(`스키마 파생 산출물 ${outputs.size}개 중 ${stale.length}개 갱신 (${summary})`);
  for (const f of stale) log(`  · ${rel(f)}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
