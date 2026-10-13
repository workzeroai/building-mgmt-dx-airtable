"""README 이미지 다시 만들기: 견적 화면 단계별 캡처·데모 GIF·관리자 화면·PDF 미리보기·터미널 캡처.

모든 화면은 가상 데이터로 띄운 로컬 서버(scripts/readme-assets/server.mjs)에서 찍는다.
서버는 임시 폴더에 새 저장소를 만들므로 data/store·out은 건드리지 않는다.

  pip install playwright pillow pymupdf pyyaml && python -m playwright install chromium
  python scripts/make_readme_assets.py --kit ../_design

산출물
  docs/demo.gif                      견적 흐름 GIF(사업부 → 건물 → 조건 → 결과)
  docs/shots/01-quote.png            견적 화면 전체(결과까지)
  docs/shots/02-legacy-code.png      행정구역 개편 → 구 코드 재조회
  docs/shots/03-admin.png            관리자: 단가·양식 버전(테스트 실패 양식은 활성화 불가)
  docs/shots/04-quote-demo.png       npm run quote:demo 터미널
  docs/shots/05-quote-pdf.png        생성된 PDF 견적서 첫 쪽
  docs/shots/06-tests.png            테스트·커버리지 요약 터미널
  docs/shots/steps/quote-step1~4.png 견적 화면 단계별(GIF 프레임과 같은 화면, 현재 단계 강조)
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "shots"
PORT = 3199
BASE = f"http://localhost:{PORT}"
NPM = "npm.cmd" if os.name == "nt" else "npm"

# 견적 흐름: 통신설비 점검(사업부 2) — quote:demo·PDF와 같은 조건
DIVISION = "telecom"
ADDRESS = "경기도 성남시 분당구 샘플로 45"
CONDITIONS = {"lines": "180", "switches": "8", "terminalBoxes": "4"}
CUSTOMER = "cus_0007"

STEP_CAPTIONS = [
    ("1", "사업부 선택", "공통 엔진 하나 + 사업부 설정 파일 3개"),
    ("2", "건물 확인", "도로명주소 → 건축물대장 표제부(가짜 응답)"),
    ("3", "조건 입력", "입력 칸은 사업부 설정의 inputs로 만든다 · 금액은 바로 계산"),
    ("4", "견적서 생성", "엑셀 양식 채움 → PDF(직렬 큐) → 기록"),
]
HIGHLIGHT = ["section.stack .card:nth-of-type(1)", "section.stack .card:nth-of-type(2)",
             "section.stack .card:nth-of-type(3)", "#summary-card"]


def start_server(tmp: Path) -> subprocess.Popen:
    proc = subprocess.Popen(["node", "scripts/readme-assets/server.mjs", "--dir", str(tmp), "--port", str(PORT)],
                            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    deadline = time.time() + 60
    while time.time() < deadline:
        line = proc.stdout.readline()
        if line.startswith("READY"):
            print("  서버:", line.strip())
            return proc
        if proc.poll() is not None:
            break
    proc.kill()
    raise SystemExit(f"서버를 시작하지 못했습니다: {proc.stdout.read() if proc.stdout else ''}")


def mark_step(page, i: int | None) -> None:
    """GIF 프레임용: 현재 단계 카드에 테두리, 화면 아래에 단계 설명 띠."""
    page.evaluate("""([sel, cap]) => {
      document.querySelectorAll('.__hl').forEach((el) => el.classList.remove('__hl'));
      document.getElementById('__cap')?.remove();
      if (!document.getElementById('__st')) {
        const st = document.createElement('style'); st.id = '__st';
        st.textContent = `.__hl{outline:4px solid #f59e0b;outline-offset:4px;transition:none}
          #__cap{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f172a;color:#f8fafc;
          padding:12px 22px;border-radius:999px;font:600 18px Pretendard,'Malgun Gothic',sans-serif;
          box-shadow:0 8px 24px rgba(15,23,42,.3);display:flex;gap:12px;align-items:center;white-space:nowrap}
          #__cap b{background:#f59e0b;color:#0f172a;border-radius:999px;width:28px;height:28px;display:inline-flex;
          align-items:center;justify-content:center}
          #__cap span{color:#cbd5e1;font-weight:400}`;
        document.head.appendChild(st);
      }
      if (!sel) return;
      document.querySelector(sel)?.classList.add('__hl');
      const c = document.createElement('div'); c.id = '__cap';
      c.innerHTML = `<b>${cap[0]}</b>${cap[1]}<span>${cap[2]}</span>`;
      document.body.appendChild(c);
    }""", [HIGHLIGHT[i] if i is not None else None, list(STEP_CAPTIONS[i]) if i is not None else None])


def settle(page, ms: int = 500) -> None:
    page.wait_for_load_state("networkidle")
    page.evaluate("async () => { await document.fonts.ready; }")
    page.wait_for_timeout(ms)


def capture_frames(browser, tmp: Path) -> list[Path]:
    frames: list[Path] = []
    (SHOTS / "steps").mkdir(parents=True, exist_ok=True)

    # 단계별 프레임(화면 크기 고정, 1.5배): docs/shots/steps/에 PNG로 남기고 GIF로도 묶는다
    page = browser.new_page(viewport={"width": 1280, "height": 1110}, device_scale_factor=1.5)
    page.goto(f"{BASE}/?division={DIVISION}")
    settle(page)
    page.click(f".division[data-id='{DIVISION}']")
    settle(page)
    mark_step(page, 0)
    frames.append(_shot(page, tmp / "f1.png"))
    mark_step(page, None)

    page.click(f".chip[data-address='{ADDRESS}']")
    page.wait_for_selector("#building .building")
    settle(page)
    mark_step(page, 1)
    frames.append(_shot(page, tmp / "f2.png"))
    mark_step(page, None)

    for key, value in CONDITIONS.items():
        page.fill(f"#in-{key}", value)
    page.click(".segmented button[data-value='연간']")
    settle(page, 700)
    mark_step(page, 2)
    frames.append(_shot(page, tmp / "f3.png"))
    mark_step(page, None)

    page.select_option("#customer", CUSTOMER)
    page.click("#create")
    page.wait_for_selector("#result .steps", timeout=120_000)
    settle(page, 700)
    mark_step(page, 3)
    frames.append(_shot(page, tmp / "f4.png"))
    page.close()
    return frames


def capture_stills(browser) -> None:
    # 견적 화면 전체(2배, 결과까지)
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    page.goto(f"{BASE}/?division={DIVISION}&address={ADDRESS}")
    page.wait_for_selector("#building .building")
    for key, value in CONDITIONS.items():
        page.fill(f"#in-{key}", value)
    page.click(".segmented button[data-value='연간']")
    settle(page, 700)
    page.select_option("#customer", CUSTOMER)
    page.click("#create")
    page.wait_for_selector("#result .steps", timeout=120_000)
    settle(page, 700)
    page.screenshot(path=str(SHOTS / "01-quote.png"), full_page=True)
    page.close()

    # 행정구역 개편: 기계설비 + 군위군 주소
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    page.goto(f"{BASE}/?division=mechanical&address=" + "대구광역시 군위군 군위읍 가상길 7")
    page.wait_for_selector("#building .notice.warn")
    settle(page, 700)
    page.screenshot(path=str(SHOTS / "02-legacy-code.png"), full_page=True)
    page.close()

    # 관리자 화면: 기계설비 양식 v1(활성)·v2(테스트 통과)·v3(테스트 실패)
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    page.goto(f"{BASE}/admin.html?division=mechanical")
    page.wait_for_selector("#versions tr")
    settle(page, 500)
    page.screenshot(path=str(SHOTS / "03-admin.png"), full_page=True)
    page.close()


def _shot(page, path: Path) -> Path:
    page.wait_for_timeout(150)
    page.screenshot(path=str(path))
    step = len(list(path.parent.glob("f*.png")))
    shutil.copyfile(path, SHOTS / "steps" / f"quote-step{step}.png")
    return path


def make_gif(frames: list[Path], out: Path, durations: list[int], width: int = 900) -> None:
    from PIL import Image

    imgs = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        imgs.append(im)
    # 프레임마다 팔레트를 따로 잡는다(작은 빨간 글자·강조 테두리 색이 서로 섞이지 않게)
    q = [im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE) for im in imgs]
    out.parent.mkdir(parents=True, exist_ok=True)
    q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)


def render_pdf(tmp: Path) -> None:
    import fitz  # PyMuPDF

    pdfs = sorted((tmp / "out").rglob("GW-TEL-*.pdf"))
    if not pdfs:
        print("  PDF 없음(LibreOffice 미설치?) → 05-quote-pdf.png 건너뜀")
        return
    doc = fitz.open(pdfs[-1])
    page = doc[0]
    # 내용이 있는 부분만(아래 빈 여백 제외)
    boxes = [fitz.Rect(b[:4]) for b in page.get_text("blocks")] + [d["rect"] for d in page.get_drawings()]
    area = fitz.Rect()
    for r in boxes:
        area |= r
    clip = fitz.Rect(0, 0, page.rect.width, min(page.rect.height, area.y1 + 40))
    page.get_pixmap(dpi=200, clip=clip).save(SHOTS / "05-quote-pdf.png")


def run_text(cmd: list[str], env: dict | None = None) -> str:
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, env={**os.environ, **(env or {})})
    raw = res.stdout + res.stderr
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp949", errors="replace")


def terminal_demo(kit) -> None:
    shutil.rmtree(ROOT / "out" / "demo", ignore_errors=True)
    text = run_text([NPM, "run", "quote:demo"], {"DEMO_MODE": "fake", "NO_COLOR": "1"})
    lines = [ln for ln in text.splitlines() if not ln.startswith(">")]
    while lines and not lines[0].strip():
        lines.pop(0)
    kit.render_terminal("\n".join(lines), SHOTS / "04-quote-demo.png", title="quote:demo",
                        command="npm run quote:demo", width=1000)


KEEP_TESTS = [
    "직렬 큐", "타임아웃", "서킷브레이커: 연속", "폴백하고", "테스트 렌더 실패", "되돌리기로",
    "행정구역 개편", "3번째 사업부", "core는 사업부 이름", "스테이징 가드(로컬)", "급감",
    "같은 시나리오", "하네스", "상태 전이", "데이터 계약 검사",
]


def terminal_tests(kit) -> None:
    # npm run coverage와 같은 명령에 사람이 읽는 spec 출력만 더한다(파이프로 받으면 기본값이 TAP)
    text = run_text(["node", "node_modules/c8/bin/c8.js", "--check-coverage", "--lines", "80", "--functions", "80",
                     "--branches", "70", "--reporter=text-summary", "node", "--test", "--test-reporter=spec",
                     "quote-engine/test/**/*.test.js", "airtable/test/**/*.test.js", "n8n/test/**/*.test.js"],
                    {"NO_COLOR": "1", "FORCE_COLOR": "0"})
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    passed = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("✔")]
    picked, seen = [], set()
    for key in KEEP_TESTS:
        for ln in passed:
            if key in ln and ln not in seen:
                picked.append(re.sub(r"\s*\([\d.]+ms\)$", "", ln))
                seen.add(ln)
                break
    summary = [ln.strip() for ln in text.splitlines() if re.match(r"^\s*ℹ (tests|pass|fail)\b", ln)]
    cov = [ln.rstrip() for ln in text.splitlines() if re.match(r"^(Statements|Branches|Functions|Lines)\s*:", ln)]
    body = [f"(전체 {len(passed)}개 중 안전장치 관련 {len(picked)}개만 표시)", *picked, "", *summary, "", *cov]
    kit.render_terminal("\n".join(body), SHOTS / "06-tests.png", title="npm run coverage",
                        command="npm run coverage", width=1000)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kit", type=Path, default=ROOT.parent / "_design", help="디자인 키트 폴더(shots.py)")
    ap.add_argument("--only", choices=["web", "terminal"], help="일부만 다시 만들기")
    args = ap.parse_args()
    sys.path.insert(0, str(args.kit.resolve()))
    import shots as kit  # noqa: E402
    from kit_common import launch_browser  # noqa: E402
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    if args.only != "terminal":
        # 세션마다 새 저장소: GIF와 정지 화면의 견적번호가 모두 -001로 같게
        for session in ("gif", "stills"):
            tmp = Path(tempfile.mkdtemp(prefix=f"gw-readme-{session}-"))
            server = start_server(tmp)
            try:
                with sync_playwright() as p:
                    browser = launch_browser(p)
                    if session == "gif":
                        frames = capture_frames(browser, tmp)
                        make_gif(frames, ROOT / "docs" / "demo.gif", durations=[1800, 1800, 1800, 3200])
                    else:
                        capture_stills(browser)
                    browser.close()
                if session == "stills":
                    render_pdf(tmp)
            finally:
                server.terminate()
                server.wait(timeout=10)
                shutil.rmtree(tmp, ignore_errors=True)
    if args.only != "web":
        terminal_demo(kit)
        terminal_tests(kit)
    for f in sorted([ROOT / "docs" / "demo.gif", *SHOTS.rglob("*.png")]):
        print(f"  {f.relative_to(ROOT).as_posix():40s} {f.stat().st_size / 1024:8.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
