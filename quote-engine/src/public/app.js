// 견적 화면: 사업부 선택 → 주소 조회 → 조건 입력(실시간 계산) → 엑셀·PDF 생성
const $ = (sel) => document.querySelector(sel);
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SOURCE = { store: ['저장소 단가', 'ok'], cache: ['캐시 단가(5분)', 'info'], fallback: ['기본값 폴백', 'warn'] };
const BREAKER = { closed: ['PDF 정상', 'ok'], 'half-open': ['PDF 시험 중', 'warn'], open: ['PDF 일시 중지', 'danger'] };

const state = { divisions: [], division: null, lookup: null, conditions: {}, preview: null };

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${res.status}`), { body: body.error });
  return body;
}

function renderDivisions() {
  $('#divisions').innerHTML = state.divisions.map((d) => `
    <button type="button" class="division ${state.division?.id === d.id ? 'selected' : ''}" data-id="${d.id}">
      <span class="check"></span>
      <span class="order">사업부 ${d.order} · ${esc(d.code)}</span>
      <span class="name">${esc(d.name)}</span>
      <span class="desc">${esc(d.description)}</span>
    </button>`).join('');
}

function renderInputs() {
  const d = state.division;
  $('#inputs-hint').textContent = d ? `${d.name} 설정의 inputs ${d.inputs.length}개` : '';
  if (!d) return;
  $('#inputs').innerHTML = d.inputs.map((input) => {
    const value = state.conditions[input.key] ?? input.default;
    if (input.type === 'select') {
      return `<div class="field"><label>${esc(input.label)}</label><div class="segmented" data-key="${input.key}">${input.options.map((o) =>
        `<button type="button" class="${o === value ? 'on' : ''}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
    }
    return `<div class="field"><label for="in-${input.key}">${esc(input.label)}</label><div class="input-unit">
      <input class="input" type="number" id="in-${input.key}" data-key="${input.key}" min="${input.min ?? ''}" max="${input.max ?? ''}" value="${esc(value)}">
      <span class="unit">${esc(input.unit ?? '')}</span></div></div>`;
  }).join('');
}

function renderBuilding() {
  const l = state.lookup;
  if (!l) return;
  const b = l.building;
  const fallback = l.adminCodeFallback
    ? `<div class="notice warn">⟲ 행정구역 코드 재조회: 새 코드 ${esc(l.adminCodeFallback.from)}로 대장이 비어 있어 구 코드 ${esc(l.adminCodeFallback.to)}로 다시 조회했습니다 (${esc(l.adminCodeFallback.reason)}).</div>` : '';
  $('#building').innerHTML = `
    <div class="building">
      <div class="kv wide"><div class="k">도로명주소</div><div class="v">${esc(l.address.road)}</div></div>
      <div class="kv wide"><div class="k">건물명</div><div class="v">${esc(b.name)}${b.dongCount > 1 ? ` <span class="pill primary">${b.dongCount}개 동 합산</span>` : ''}</div></div>
      <div class="kv"><div class="k">주용도</div><div class="v">${esc(b.mainPurpose)}</div></div>
      <div class="kv"><div class="k">연면적</div><div class="v">${b.totalArea.toLocaleString('ko-KR')}㎡</div></div>
      <div class="kv"><div class="k">층수</div><div class="v">지상 ${b.groundFloors} · 지하 ${b.undergroundFloors}</div></div>
      <div class="kv"><div class="k">법정동코드</div><div class="v">${esc(l.address.admCd)}</div></div>
    </div>${fallback}`;
}

function renderSummary() {
  const p = state.preview;
  $('#summary-division').textContent = state.division?.name ?? '';
  $('#create').disabled = !p;
  if (!p) return;
  const [label, tone] = SOURCE[p.pricingSource] ?? [p.pricingSource, ''];
  $('#summary').innerHTML = `
    <table class="lines">${p.items.map((it) => `
      <tr><td>${esc(it.name)}<span class="basis">${esc(it.basis)}</span></td><td class="amt ${it.amount < 0 ? 'neg' : ''}">${won(it.amount)}</td></tr>`).join('')}
    </table>
    <div class="totals">
      <div class="row"><span class="muted">공급가액</span><span>${won(p.subtotal)}</span></div>
      <div class="row"><span class="muted">부가세 10%</span><span>${won(p.vat)}</span></div>
    </div>
    <div class="grand"><span class="label">합계</span><span class="value">${won(p.total)}</span></div>
    <div class="meta"><span class="pill ${tone}"><span class="dot"></span>${label}</span><span class="pill">단가 버전 ${esc(p.pricingVersion)}</span></div>
    ${p.pricingWarning ? `<div class="notice warn">저장소 단가를 읽지 못해 번들 기본값으로 계산했습니다: ${esc(p.pricingWarning)}</div>` : ''}`;
}

let timer;
function schedulePreview() {
  clearTimeout(timer);
  timer = setTimeout(runPreview, 150);
}

async function runPreview() {
  if (!state.division || !state.lookup) return;
  try {
    state.preview = await api('/api/quotes/preview', {
      method: 'POST',
      body: JSON.stringify({ divisionId: state.division.id, building: state.lookup.building, conditions: state.conditions }),
    });
  } catch (err) {
    state.preview = null;
    $('#summary').innerHTML = `<div class="notice danger">${esc(err.message)}</div>`;
  }
  renderSummary();
}

function selectDivision(id) {
  state.division = state.divisions.find((d) => d.id === id);
  state.conditions = Object.fromEntries(state.division.inputs.map((i) => [i.key, i.default]));
  $('#result').innerHTML = '';
  renderDivisions();
  renderInputs();
  schedulePreview();
}

async function lookup(address) {
  $('#address').value = address;
  $('#building').innerHTML = '<div class="empty" style="margin-top:16px">조회 중…</div>';
  try {
    state.lookup = await api(`/api/building?address=${encodeURIComponent(address)}`);
    renderBuilding();
    schedulePreview();
  } catch (err) {
    state.lookup = null;
    state.preview = null;
    renderSummary();
    $('#building').innerHTML = `<div class="notice danger" style="margin-top:16px">${esc(err.message)}</div>`;
  }
}

async function createQuote() {
  const btn = $('#create');
  btn.disabled = true;
  btn.textContent = '만드는 중… (PDF 변환 큐)';
  try {
    const r = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ divisionId: state.division.id, address: state.lookup.address.road, conditions: state.conditions, customerId: $('#customer').value || null }),
    });
    const pdfNote = r.pdf.status === 'ok' ? '' : `<div class="notice warn">${esc(r.pdf.reason)}</div>`;
    $('#result').innerHTML = `<div class="result">
      <div class="notice ok">✓ ${esc(r.quote.quoteNo)} 저장 · 양식 v${r.template.version}</div>
      <div class="downloads">
        <a class="dl" href="${r.downloads.xlsx}"><span class="ext xlsx">XLSX</span>엑셀 받기</a>
        <a class="dl ${r.downloads.pdf ? '' : 'disabled'}" href="${r.downloads.pdf ?? '#'}"><span class="ext pdf">PDF</span>${r.downloads.pdf ? 'PDF 받기' : 'PDF 없음'}</a>
      </div>${pdfNote}
      <ul class="steps">${r.steps.map((s) => `<li><span>${esc(s.name)}</span><span>${s.ms}ms</span></li>`).join('')}</ul></div>`;
    refreshStatus();
  } catch (err) {
    $('#result').innerHTML = `<div class="result"><div class="notice danger">${esc(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '견적서 만들기 (엑셀 · PDF)';
  }
}

async function refreshStatus() {
  const s = await api('/api/status');
  const [label, tone] = s.pdf.converter === 'none' ? ['PDF 없음 · xlsx만', 'warn'] : BREAKER[s.pdf.breaker.state];
  $('#pdf-pill').className = `pill ${tone}`;
  $('#pdf-pill').innerHTML = `<span class="dot"></span>${label} · 큐 ${s.pdf.queued}`;
  const live = s.buildingApi.address === 'live';
  $('#api-pill').className = `pill ${live ? 'ok' : 'info'}`;
  $('#api-pill').innerHTML = `<span class="dot"></span>공공 API ${live ? '실제 호출' : '가짜 응답'}`;
}

async function init() {
  state.divisions = await api('/api/divisions');
  renderDivisions();
  const [examples, customers] = await Promise.all([api('/api/examples'), api('/api/customers')]);
  $('#examples').innerHTML = examples.map((a) => `<button type="button" class="chip" data-address="${esc(a)}">${esc(a)}</button>`).join('');
  $('#customer').innerHTML = `<option value="">(고객 미지정)</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.type)}</option>`).join('')}`;
  refreshStatus();

  $('#divisions').addEventListener('click', (e) => {
    const tile = e.target.closest('.division');
    if (tile) selectDivision(tile.dataset.id);
  });
  $('#examples').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) lookup(chip.dataset.address);
  });
  $('#address-form').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup($('#address').value);
  });
  $('#inputs').addEventListener('input', (e) => {
    if (e.target.dataset.key) {
      state.conditions[e.target.dataset.key] = e.target.value;
      schedulePreview();
    }
  });
  $('#inputs').addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented button');
    if (!btn) return;
    state.conditions[btn.parentElement.dataset.key] = btn.dataset.value;
    renderInputs();
    schedulePreview();
  });
  $('#create').addEventListener('click', createQuote);

  // 주소창 URL로 바로 열기(?division=fire&address=...) — 화면 캡처·시연용
  const params = new URLSearchParams(location.search);
  selectDivision(params.get('division') ?? state.divisions[0].id);
  if (params.get('customer')) $('#customer').value = params.get('customer');
  if (params.get('address')) await lookup(params.get('address'));
  if (params.get('create') === '1' && state.lookup) {
    await runPreview();
    await createQuote();
  }
}

init();
