import assert from 'node:assert/strict';
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

const cases = await listCaseBundles(projectRoot);
const { caseRecord, documents } = await loadCaseBundle(projectRoot, 'truck-wreck-demo');
const analysis = buildCaseAnalysis(caseRecord, documents);
const riskAnswer = answerQuestion('What are the main risks in the case?', analysis, documents);
const markdown = buildCaseReportMarkdown(analysis);
const secondBundle = await loadCaseBundle(projectRoot, 'premises-fall-demo');
const secondAnalysis = buildCaseAnalysis(secondBundle.caseRecord, secondBundle.documents);

assert.equal(cases.length >= 2, true);
assert.equal(caseRecord.id, 'truck-wreck-demo');
assert.equal(analysis.timeline.length, 8);
assert.equal(analysis.billing.total, 8990);
assert.ok(analysis.issues.length >= 3);
assert.ok(analysis.coverage.length >= 5);
assert.ok(analysis.providerJourney.length >= 4);
assert.ok(analysis.executiveMemo.sections.length >= 3);
assert.ok(analysis.drafts.demandLetter.length >= 3);
assert.ok(riskAnswer.citations.length >= 2);
assert.ok(markdown.includes('# Garcia v. NorthPeak Logistics'));
assert.equal(secondAnalysis.caseRecord.id, 'premises-fall-demo');
assert.equal(secondAnalysis.wageLoss.amount, 1372);
assert.ok(secondAnalysis.billing.projectedTotal > secondAnalysis.billing.total);

console.log('Smoke test passed');
