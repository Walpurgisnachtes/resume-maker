import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InputError, companyFolder, renderResume, saveResume, templateStyleSources } from './resume.mjs';
import { renderPdf } from './pdf.mjs';

const resumeRoot = fileURLToPath(new URL('../Resumes/', import.meta.url));
const assets = new Map(await Promise.all([
  ['/', 'index.html', 'text/html'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/app.css', 'app.css', 'text/css'],
].map(async ([route, file, type]) => [route, [type, await readFile(new URL(file, import.meta.url))]])));
const port = Number(process.env.RESUME_PORT || 4317);
const host = `127.0.0.1:${port}`;
let generating = false;

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > 8_000_000) {
      request.resume();
      throw new InputError('The form is too large. Use a smaller photo.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new InputError('The form must be valid JSON.');
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  // The sandboxed blob preview inherits the app's policy.
  response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' ${templateStyleSources}; img-src data:; connect-src 'self'; frame-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  if (request.headers.host !== host) return json(response, 403, { error: 'Open the app using its loopback address.' });
  if (request.method === 'GET' && assets.has(request.url)) {
    const [type, buffer] = assets.get(request.url);
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    return response.end(buffer);
  }
  if (request.method !== 'POST' || !['/preview', '/generate'].includes(request.url)) {
    return json(response, 404, { error: 'Not found.' });
  }
  if ((request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return json(response, 403, { error: 'Only local JSON submissions are accepted.' });
  }
  try {
    const data = await body(request);
    const html = renderResume(data);
    if (request.url === '/preview') return json(response, 200, { html });
    companyFolder(data.company);
    if (generating) return json(response, 409, { error: 'Another PDF is being generated. Try again when it finishes.' });
    generating = true;
    try {
      const pdf = await renderPdf(html);
      const path = await saveResume(resumeRoot, data.company, data.name, pdf);
      return json(response, 201, { path: `Resumes\\${path}` });
    } finally {
      generating = false;
    }
  } catch (error) {
    if (error instanceof InputError) return json(response, 400, { error: error.message });
    console.error('Resume request failed:', error);
    return json(response, 500, { error: `Could not process the resume: ${error.message}` });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Resume Maker: http://${host}`));
