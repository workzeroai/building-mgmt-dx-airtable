// 데모 웹 서버: 견적 화면(/) + 관리자 화면(/admin.html) + JSON API.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { createContext } from './context.js';
import { ValidationError } from './core/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 화면에 보낼 사업부 정보(계산 함수 제외). */
function publicDivision(d) {
  return { id: d.id, code: d.code, name: d.name, order: d.order, description: d.description, inputs: d.inputs, items: d.items };
}

export function createApp(ctx) {
  const app = express();
  const { engine, registry, pricing, templates, store, notifier, buildingClient } = ctx;
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(here, 'public')));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/divisions', (req, res) => res.json(registry.list().map(publicDivision)));
  app.get('/api/examples', wrap(async (req, res) => res.json(await buildingClient.exampleAddresses())));
  app.get('/api/customers', wrap(async (req, res) => {
    const rows = await store.list('customers');
    res.json(rows.map((c) => ({ id: c.id, name: c.name, type: c.type })));
  }));
  app.get('/api/status', (req, res) => res.json({
    target: ctx.target, store: store.kind, buildingApi: buildingClient.mode, notifier: notifier.status(), ...engine.status(),
  }));

  app.get('/api/building', wrap(async (req, res) => {
    res.json(await engine.lookupBuilding(String(req.query.address ?? '')));
  }));
  app.post('/api/quotes/preview', wrap(async (req, res) => res.json(await engine.preview(req.body ?? {}))));
  app.post('/api/quotes', wrap(async (req, res) => {
    const out = await engine.createQuote(req.body ?? {});
    const name = (p) => (p ? `/files/${path.basename(p)}` : null);
    res.status(201).json({ ...out, downloads: { xlsx: name(out.files.xlsx), pdf: name(out.files.pdf) } });
  }));
  app.get('/api/quotes', wrap(async (req, res) => {
    const rows = await store.list('quotes', req.query.divisionId ? { divisionId: String(req.query.divisionId) } : {});
    res.json(rows.slice(-20).reverse());
  }));

  app.get('/files/:name', (req, res, next) => {
    const name = req.params.name;
    if (!/^[\w.-]+\.(xlsx|pdf)$/u.test(name)) return next(new ValidationError('잘못된 파일 이름입니다.'));
    return res.download(path.join(ctx.outDir, name), name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일이 없습니다.' } });
    });
  });

  // ---- 관리자: 단가 ----
  app.get('/api/admin/pricing/:divisionId', wrap(async (req, res) => {
    const [record] = await store.list('pricing', { divisionId: req.params.divisionId });
    res.json({ record: record ?? null, active: await pricing.get(req.params.divisionId), keys: registry.get(req.params.divisionId).pricingKeys });
  }));
  app.put('/api/admin/pricing/:divisionId', wrap(async (req, res) => {
    res.json(await pricing.update(req.params.divisionId, req.body?.data, { updatedBy: req.body?.updatedBy ?? '관리자 화면', version: req.body?.version }));
  }));

  // ---- 관리자: 양식 버전 ----
  app.get('/api/admin/templates/:divisionId', wrap(async (req, res) => {
    registry.get(req.params.divisionId);
    res.json((await templates.versions(req.params.divisionId)).reverse());
  }));
  app.post('/api/admin/templates/:divisionId', express.raw({ type: () => true, limit: '5mb' }), wrap(async (req, res) => {
    const uploaded = await templates.upload(req.params.divisionId, req.body, { uploadedBy: '관리자 화면', note: req.query.note ? String(req.query.note) : null });
    res.status(201).json(await templates.testRender(uploaded.id));
  }));
  app.post('/api/admin/template-versions/:id/test', wrap(async (req, res) => res.json(await templates.testRender(req.params.id))));
  app.post('/api/admin/template-versions/:id/activate', wrap(async (req, res) => res.json(await templates.activate(req.params.id))));
  app.post('/api/admin/templates/:divisionId/rollback', wrap(async (req, res) => res.json(await templates.rollback(req.params.divisionId))));
  app.get('/api/admin/template-versions/:id/file', wrap(async (req, res) => {
    const record = await store.get('templateVersions', req.params.id);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '양식 버전이 없습니다.' } });
    res.attachment(`${record.divisionId}-template-v${record.version}.xlsx`);
    return res.send(await templates.readFile(record));
  }));

  // ---- 오류 처리: 4xx는 그대로 안내, 5xx는 요약 알림 ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) {
      notifier.notifyError(err, { method: req.method, path: req.path }).catch(() => {});
    }
    res.status(status).json({ error: { code: err.code ?? 'INTERNAL', message: status >= 500 && !err.code ? '서버 오류가 발생했습니다.' : err.message, details: err.details } });
  });
  return app;
}

export async function main() {
  const ctx = await createContext();
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp(ctx);
  app.listen(port, () => {
    const pdf = ctx.pdfQueue.status();
    console.log(`견적 엔진 데모 서버: http://localhost:${port}  (관리자 화면 /admin.html)`);
    console.log(`저장소 ${ctx.store.kind}/${ctx.target} · 공공 API ${ctx.buildingClient.mode.address}/${ctx.buildingClient.mode.register} · PDF ${pdf.converter}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
