// LibreOffice(soffice --headless) 호출. 건당 타임아웃이 지나면 프로세스 트리를 강제로 정리한다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PdfConvertError, PdfTimeoutError } from './errors.js';

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ],
  darwin: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
  linux: ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'],
};

/** SOFFICE_PATH → 플랫폼 기본 설치 경로 순서로 찾는다. 없으면 null. */
export function findSoffice({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (env.SOFFICE_PATH) return exists(env.SOFFICE_PATH) ? env.SOFFICE_PATH : null;
  for (const candidate of CANDIDATES[platform] ?? CANDIDATES.linux) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** 자식 프로세스와 그 하위 프로세스까지 강제 종료(soffice.exe는 soffice.bin을 따로 띄운다). */
export function killTree(child, platform = process.platform) {
  if (!child.pid || child.exitCode !== null) return;
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL'); // detached로 띄웠으므로 프로세스 그룹 전체
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/**
 * 명령을 실행하고 timeoutMs 안에 끝나지 않으면 강제 종료 후 PdfTimeoutError.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, pid: number }>}
 */
export function runWithTimeout(command, args, { timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new PdfConvertError(`변환 프로세스를 시작하지 못했습니다: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PdfTimeoutError(`PDF 변환이 ${timeoutMs}ms 안에 끝나지 않아 프로세스를 정리했습니다.`, {
          pid: child.pid, timeoutMs,
        }));
        return;
      }
      resolve({ code, stdout, stderr, pid: child.pid });
    });
  });
}

/**
 * LibreOffice 변환기. 전용 사용자 프로필을 써서 사용자가 열어 둔 LibreOffice 창과 충돌하지 않게 한다.
 */
export function createSofficeConverter({ sofficePath = findSoffice(), profileDir } = {}) {
  const profile = profileDir ?? path.join(os.tmpdir(), 'quote-engine-lo-profile');
  return {
    name: 'libreoffice',
    available: Boolean(sofficePath),
    path: sofficePath,
    async convert(xlsxPath, outDir, { timeoutMs }) {
      if (!sofficePath) throw new PdfConvertError('LibreOffice를 찾지 못했습니다.');
      const args = [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless', '--norestore', '--nologo',
        '--convert-to', 'pdf', '--outdir', outDir, xlsxPath,
      ];
      const result = await runWithTimeout(sofficePath, args, { timeoutMs });
      const pdfPath = path.join(outDir, `${path.parse(xlsxPath).name}.pdf`);
      if (result.code !== 0 || !fs.existsSync(pdfPath)) {
        throw new PdfConvertError(`PDF 변환 실패(종료 코드 ${result.code}): ${result.stderr.trim().slice(0, 200)}`);
      }
      return pdfPath;
    },
  };
}

/** 테스트·데모용: 임의 명령으로 변환을 흉내 내는 변환기(같은 타임아웃·정리 경로를 탄다). */
export function createCommandConverter({ command, args = [], name = 'command' }) {
  return {
    name,
    available: true,
    path: command,
    async convert(xlsxPath, outDir, { timeoutMs }) {
      const pdfPath = path.join(outDir, `${path.parse(xlsxPath).name}.pdf`);
      const result = await runWithTimeout(command, [...args, xlsxPath, pdfPath], { timeoutMs });
      if (result.code !== 0 || !fs.existsSync(pdfPath)) {
        throw new PdfConvertError(`변환 실패(종료 코드 ${result.code})`);
      }
      return pdfPath;
    },
  };
}
