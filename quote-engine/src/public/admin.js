// 관리자 화면: 단가 보기·수정, 양식 업로드 → 테스트 → 활성화 → 되돌리기
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS = { active: ['활성', 'ok'], tested: ['테스트 통과', 'info'], failed: ['테스트 실패', 'danger'], uploaded: ['업로드됨', ''], inactive: ['비활성', ''] };
const SOURCE = { store: ['저장소', 'ok'], cache: ['캐시', 'info'], fallback: ['기본값 폴백', 'warn'] };
const when = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
let divisions = [];
let current = null;

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${res.status}`), { details: body.error?.details });
  return body;
}

const notice = (el, tone, html) => { $(el).innerHTML = `<div class="notice ${tone}" style="margin-bottom:12px">${html}</div>`; };

function renderTabs() {
  $('#tabs').innerHTML = divisions.map((d) => `<button type="button" class="${d.id === current ? 'on' : ''}" data-id="${d.id}">${d.order}. ${esc(d.name)}</button>`).join('');
}

async function loadPricing() {
  const p = await api(`/api/admin/pricing/${current}`);
  const [label, tone] = SOURCE[p.active.source] ?? [p.active.source, ''];
  $('#pricing-meta').innerHTML = `
    <span class="pill ${tone}"><span class="dot"></span>현재 계산 단가: ${label}</span>
    <span class="pill">버전 ${esc(p.record?.version ?? p.active.version)}</span>
    <span class="pill">수정 ${esc(p.record?.updatedBy ?? '-')}</span>
    <span class="pill primary">출처: 가상</span>`;
  $('#pricing-json').value = JSON.stringify(p.record?.data ?? p.active.data, null, 2);
  $('#pricing-msg').innerHTML = '';
}

async function loadVersions() {
  const rows = await api(`/api/admin/templates/${current}`);
  $('#versions').innerHTML = rows.map((v) => {
    const [label, tone] = STATUS[v.status] ?? [v.status, ''];
    const report = v.testReport
      ? (v.testReport.ok ? `<span class="pill ok">통과 · 항목 칸 ${v.testReport.capacity}</span>` : `<span class="pill danger">실패</span><div class="errors">${v.testReport.errors.map(esc).join('<br>')}</div>`)
      : '<span class="muted small">미실행</span>';
    const canActivate = v.status !== 'active' && v.testReport?.ok;
    return `<tr>
      <td class="ver"><b>v${v.version}</b><div class="small muted">${esc(v.note ?? '')}</div></td>
      <td><span class="pill ${tone}"><span class="dot"></span>${label}</span></td>
      <td>${report}</td>
      <td class="small when">${esc(v.uploadedBy)}<br><span class="muted">${esc(when(v.uploadedAt))}</span></td>
      <td><div class="actions">
        <button class="btn sm ghost" data-act="test" data-id="${v.id}">테스트</button>
        <button class="btn sm ${canActivate ? 'primary' : ''}" data-act="activate" data-id="${v.id}" ${v.status === 'active' ? 'disabled' : ''}>활성화</button>
        <a class="btn sm ghost" href="/api/admin/template-versions/${v.id}/file">받기</a>
      </div></td></tr>`;
  }).join('');
}

async function select(id) {
  current = id;
  renderTabs();
  $('#template-msg').innerHTML = '';
  await Promise.all([loadPricing(), loadVersions()]);
}

async function init() {
  divisions = await api('/api/divisions');
  const status = await api('/api/status');
  $('#target-pill').className = `pill ${status.target === 'staging' ? 'warn' : 'primary'}`;
  $('#target-pill').innerHTML = `<span class="dot"></span>저장소 ${esc(status.store)} · ${status.target === 'staging' ? '스테이징(ID 가드 켜짐)' : '운영'}`;

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) select(b.dataset.id);
  });
  $('#save-pricing').addEventListener('click', async () => {
    try {
      const data = JSON.parse($('#pricing-json').value);
      const saved = await api(`/api/admin/pricing/${current}`, { method: 'PUT', body: JSON.stringify({ data }) });
      await loadPricing();
      notice('#pricing-msg', 'ok', `저장했습니다(버전 ${esc(saved.version)}). 캐시를 비웠습니다.`);
    } catch (err) {
      notice('#pricing-msg', 'danger', esc(err.message));
    }
  });
  $('#upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await fetch(`/api/admin/templates/${current}?note=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message);
      notice('#template-msg', body.testReport.ok ? 'ok' : 'danger',
        body.testReport.ok ? `v${body.version} 업로드·테스트 통과. 활성화하면 다음 견적부터 이 양식을 씁니다.` : `v${body.version} 테스트 실패: ${body.testReport.errors.map(esc).join(', ')}`);
    } catch (err) {
      notice('#template-msg', 'danger', esc(err.message));
    }
    e.target.value = '';
    loadVersions();
  });
  $('#rollback').addEventListener('click', async () => {
    try {
      const r = await api(`/api/admin/templates/${current}/rollback`, { method: 'POST' });
      notice('#template-msg', 'ok', `v${r.from} → v${r.to}로 되돌렸습니다.`);
    } catch (err) {
      notice('#template-msg', 'danger', esc(err.message));
    }
    loadVersions();
  });
  $('#versions').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    try {
      const r = await api(`/api/admin/template-versions/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' });
      notice('#template-msg', 'ok', b.dataset.act === 'activate' ? `v${r.version}을 활성화했습니다.` : `v${r.version} 테스트 렌더: ${r.testReport.ok ? '통과' : '실패'}`);
    } catch (err) {
      notice('#template-msg', 'danger', `${esc(err.message)}${err.details?.errors ? `<br>${err.details.errors.map(esc).join('<br>')}` : ''}`);
    }
    loadVersions();
  });

  await select(new URLSearchParams(location.search).get('division') ?? divisions[0].id);
}

init();
