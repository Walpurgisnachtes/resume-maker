import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { InputError } from './resume.mjs';

async function browserPath() {
  if (process.env.RESUME_BROWSER) return process.env.RESUME_BROWSER;
  for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
    if (!root) continue;
    for (const path of [['Google', 'Chrome', 'Application', 'chrome.exe'], ['Microsoft', 'Edge', 'Application', 'msedge.exe']]) {
      const candidate = join(root, ...path);
      try {
        await access(candidate);
        return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
  }
  throw new Error('Chrome or Edge was not found. Set RESUME_BROWSER to the browser executable.');
}

async function waitFor(probe, message, signal) {
  while (!signal.aborted) {
    const result = await probe();
    if (result) return result;
    await delay(75);
  }
  throw new Error(message);
}

async function connect(url, signal) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Cannot connect to the PDF browser.')), { once: true });
    signal.addEventListener('abort', () => {
      socket.close();
      reject(new Error('PDF generation timed out.'));
    }, { once: true });
  });
  let id = 0;
  let pending;
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (!pending || response.id !== id) return;
    const { resolve, reject } = pending;
    pending = undefined;
    if (response.error) reject(new Error(response.error.message));
    else resolve(response.result);
  });
  socket.addEventListener('close', () => pending?.reject(new Error('The PDF browser connection closed.')));
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) return reject(new Error('The PDF browser is not connected.'));
        pending = { resolve, reject };
        socket.send(JSON.stringify({ id: ++id, method, params }));
      });
    },
  };
}

export async function renderPdf(html) {
  const executable = await browserPath();
  const temporary = await mkdtemp(join(tmpdir(), 'resume-maker-'));
  let child;
  let exited;
  let session;
  try {
    const document = join(temporary, 'resume.html');
    await writeFile(document, html);
    const url = pathToFileURL(document).href;
    const profile = join(temporary, 'profile');
    const signal = AbortSignal.timeout(30_000);
    child = spawn(executable, [
      '--headless', '--no-first-run', '--disable-background-networking', '--no-default-browser-check',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    let browserFailure;
    exited = new Promise(resolve => {
      child.once('error', error => { browserFailure = error; });
      child.once('close', code => {
        browserFailure ??= new Error(`The PDF browser exited (code ${code}).`);
        resolve();
      });
    });
    const port = await waitFor(async () => {
      if (browserFailure) throw browserFailure;
      try {
        const contents = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
        return /^(\d+)\r?\n\/devtools\/browser\//.exec(contents)?.[1];
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
      }
    }, 'The PDF browser did not start in time.', signal);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
    if (!response.ok) throw new Error('The PDF browser did not expose a page.');
    const target = (await response.json()).find(page => page.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('The PDF browser has no open page.');
    session = await connect(target.webSocketDebuggerUrl, signal);
    await session.send('Emulation.setEmulatedMedia', { media: 'print' });
    const navigation = await session.send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`Could not open the resume: ${navigation.errorText}`);
    const layout = await waitFor(async () => {
      const evaluation = await session.send('Runtime.evaluate', {
        expression: `(async () => {
          const paper = document.querySelector('.resume');
          if (!paper || document.readyState !== 'complete') return null;
          await document.fonts.ready;
          const photo = document.querySelector('.photo');
          const page = document.createElement('div');
          page.style.height = 'var(--paper-height)';
          document.body.append(page);
          const fits = paper.getBoundingClientRect().height <= page.getBoundingClientRect().height;
          page.remove();
          return { fits, validPhoto: !photo || photo.naturalWidth > 0 };
        })()`, awaitPromise: true, returnByValue: true,
      });
      if (evaluation.exceptionDetails) throw new Error('The PDF browser could not measure the resume.');
      return evaluation.result.value;
    }, 'The resume did not load in time.', signal);
    if (!layout.validPhoto) throw new InputError('The selected photo could not be decoded.');
    if (!layout.fits) throw new InputError('The resume exceeds one template page. Shorten the profile, lists, or entries and try again.');
    const { data } = await session.send('Page.printToPDF', {
      preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false,
    });
    return Buffer.from(data, 'base64');
  } finally {
    session?.close();
    if (child) {
      if (child.exitCode === null) child.kill();
      await exited;
    }
    await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
