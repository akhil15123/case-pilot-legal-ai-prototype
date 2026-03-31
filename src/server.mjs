import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerQuestion,
  buildCaseAnalysis,
  buildCaseReportMarkdown,
  listCaseBundles,
  loadCaseBundle
} from './lib/case-engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const port = Number(process.env.PORT || 4173);

async function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(payload);
}

async function sendFile(response, filePath) {
  const extension = path.extname(filePath);
  const contentTypeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypeMap[extension] ?? 'application/octet-stream'
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

async function loadAnalysis(caseId) {
  const bundle = await loadCaseBundle(projectRoot, caseId);
  const analysis = buildCaseAnalysis(bundle.caseRecord, bundle.documents);

  return {
    analysis,
    rawDocuments: bundle.documents
  };
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const { pathname } = requestUrl;

  try {
    if (pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === '/api/cases' && request.method === 'GET') {
      const cases = await listCaseBundles(projectRoot);
      sendJson(response, 200, cases);
      return;
    }

    const analysisMatch = pathname.match(/^\/api\/cases\/([^/]+)\/analysis$/);
    if (analysisMatch && request.method === 'GET') {
      const [, caseId] = analysisMatch;
      const { analysis } = await loadAnalysis(caseId);
      sendJson(response, 200, analysis);
      return;
    }

    const chatMatch = pathname.match(/^\/api\/cases\/([^/]+)\/chat$/);
    if (chatMatch && request.method === 'POST') {
      const [, caseId] = chatMatch;
      const { question = '' } = await readRequestBody(request);
      const { analysis, rawDocuments } = await loadAnalysis(caseId);
      const result = answerQuestion(question, analysis, rawDocuments);
      sendJson(response, 200, result);
      return;
    }

    const exportMatch = pathname.match(/^\/api\/cases\/([^/]+)\/export\.md$/);
    if (exportMatch && request.method === 'GET') {
      const [, caseId] = exportMatch;
      const { analysis } = await loadAnalysis(caseId);
      const markdown = buildCaseReportMarkdown(analysis);
      const fileName = `casepilot-${analysis.caseRecord.id}-report.md`;
      sendText(response, 200, markdown, {
        'Content-Disposition': `attachment; filename="${fileName}"`
      });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      await sendFile(response, path.join(publicDir, 'index.html'));
      return;
    }

    if (pathname.startsWith('/public/')) {
      await sendFile(response, path.join(projectRoot, pathname));
      return;
    }

    if (pathname === '/app.js' || pathname === '/styles.css') {
      await sendFile(response, path.join(publicDir, pathname.slice(1)));
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  } catch (error) {
    sendJson(response, 500, {
      error: 'server_error',
      detail: error.message
    });
  }
});

server.listen(port, () => {
  console.log(`CasePilot running at http://localhost:${port}`);
});
