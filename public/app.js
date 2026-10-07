const state = {
  caseId: 'truck-wreck-demo',
  cases: [],
  analysis: null,
  documentFilter: '',
  prompts: [
    'What are the main risks and missing records in this case?',
    'Summarize liability in two paragraphs.',
    'What supports future medical treatment?',
    'Which providers matter the most for settlement posture?'
  ]
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toSlug(value) {
  return value.toLowerCase().replace(/\s+/g, '-');
}

function badgeClass(severity) {
  return {
    high: 'badge badge-high',
    medium: 'badge badge-medium',
    low: 'badge badge-low'
  }[severity] || 'badge';
}

function toneClass(status) {
  return {
    Strong: 'tone-strong',
    Developing: 'tone-developing',
    'Needs support': 'tone-weak'
  }[status] || 'tone-developing';
}

function coverageRow(analysis, label) {
  return analysis.coverage.find((row) => row.label === label) || null;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));

  if (!filtered.length) {
    return 0;
  }

  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function deriveScoreModel(analysis) {
  const liability = coverageRow(analysis, 'Liability')?.score ?? 60;
  const recordIntegrity = clamp(
    average([
      coverageRow(analysis, 'Causation')?.score ?? 60,
      coverageRow(analysis, 'Objective injury support')?.score ?? 60,
      84 - analysis.missingEvidence.length * 6 - analysis.issues.filter((issue) => issue.severity === 'high').length * 5 + analysis.strengths.length * 2
    ]),
    38,
    96
  );
  const damagesReadiness = clamp(
    average([
      coverageRow(analysis, 'Past medical damages')?.score ?? 50,
      coverageRow(analysis, 'Future care support')?.score ?? 50,
      coverageRow(analysis, 'Lost wage support')?.score || 70
    ]),
    34,
    95
  );
  const overall = Math.round(average([liability, recordIntegrity, damagesReadiness]));

  return {
    overall,
    metrics: [
      {
        label: 'Liability strength',
        value: liability,
        detail: coverageRow(analysis, 'Liability')?.summary ?? 'Liability support is still developing.'
      },
      {
        label: 'Record integrity',
        value: Math.round(recordIntegrity),
        detail: analysis.issues.length
          ? `${analysis.issues.length} issue${analysis.issues.length > 1 ? 's still need' : ' still needs'} to be neutralized or documented.`
          : 'The file currently reads cleanly with few structural risks.'
      },
      {
        label: 'Damages readiness',
        value: Math.round(damagesReadiness),
        detail: `Current specials ${analysis.billing.totalDisplay}; projected exposure ${analysis.billing.projectedTotalDisplay}.`
      }
    ]
  };
}

function scoreCaption(score) {
  if (score >= 86) {
    return 'High-quality demand file with only minor cleanup left';
  }

  if (score >= 74) {
    return 'Strong plaintiff posture with targeted support still needed';
  }

  if (score >= 62) {
    return 'Viable case with meaningful pre-demand cleanup remaining';
  }

  return 'Early-stage file that needs more development before demand';
}

function buildHeroSignals(analysis) {
  const items = [];

  if (analysis.strengths[0]) {
    items.push({
      label: 'Best fact',
      text: analysis.strengths[0].title
    });
  }

  if (analysis.billing.futureTotal > 0) {
    items.push({
      label: 'Future care',
      text: `Modeled additional treatment exposure ${analysis.billing.futureTotalDisplay}.`
    });
  }

  if (analysis.issues[0]) {
    items.push({
      label: 'Main exposure',
      text: analysis.issues[0].title
    });
  }

  return items.slice(0, 3);
}

function buildInsightCards(analysis) {
  return [
    {
      title: 'Case edge',
      value: analysis.strengths[0]?.title || 'Developing file',
      body: analysis.strengths[0]?.detail || 'The record is still maturing.'
    },
    {
      title: 'Projected exposure',
      value: analysis.billing.projectedTotalDisplay,
      body: `Current specials ${analysis.billing.totalDisplay}${analysis.wageLoss ? ` plus wage loss ${analysis.wageLoss.amountDisplay}` : ''}.`
    },
    {
      title: 'Immediate fix',
      value: analysis.missingEvidence[0]?.title || 'No critical record request',
      body: analysis.missingEvidence[0]?.detail || 'The file does not currently show a major missing-support item.'
    }
  ];
}

function renderPromptPills() {
  el('prompt-pills').innerHTML = state.prompts
    .map((prompt) => `<button type="button" class="prompt-pill" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`)
    .join('');
}

function renderCasePicker() {
  const select = el('case-select');

  select.innerHTML = state.cases
    .map(
      (item) => `
        <option value="${escapeHtml(item.id)}" ${item.id === state.caseId ? 'selected' : ''}>
          ${escapeHtml(item.title)} • ${escapeHtml(item.matterType)}
        </option>
      `
    )
    .join('');
}

function renderScore(analysis) {
  const model = deriveScoreModel(analysis);

  el('score-ring').style.setProperty('--score-angle', `${model.overall * 3.6}deg`);
  el('score-number').textContent = model.overall;
  el('score-caption').textContent = scoreCaption(model.overall);
  el('score-breakdown').innerHTML = model.metrics
    .map(
      (metric) => `
        <article class="score-metric">
          <div class="score-metric-head">
            <span>${escapeHtml(metric.label)}</span>
            <strong>${metric.value}</strong>
          </div>
          <div class="meter">
            <span style="width:${metric.value}%"></span>
          </div>
          <p>${escapeHtml(metric.detail)}</p>
        </article>
      `
    )
    .join('');
}

function renderStats(analysis) {
  const stats = [
    {
      label: 'Documents',
      value: analysis.overview.documentCount,
      detail: 'Source records stitched into one matter view.'
    },
    {
      label: 'Coverage Areas',
      value: analysis.coverage.length,
      detail: 'Liability, causation, injuries, damages, and future care scored.'
    },
    {
      label: 'Missing Evidence',
      value: analysis.missingEvidence.length,
      detail: 'Targeted requests needed before a stronger package goes out.'
    },
    {
      label: 'Projected Exposure',
      value: analysis.overview.projectedExposure,
      detail: 'Current specials plus modeled future care.'
    }
  ];

  el('stats-grid').innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <p class="stat-label">${escapeHtml(stat.label)}</p>
          <p class="stat-value">${escapeHtml(stat.value)}</p>
          <p class="stat-detail">${escapeHtml(stat.detail)}</p>
        </article>
      `
    )
    .join('');
}

function renderHeroSignals(analysis) {
  el('hero-signals').innerHTML = buildHeroSignals(analysis)
    .map(
      (signal) => `
        <article class="signal-pill">
          <span>${escapeHtml(signal.label)}</span>
          <p>${escapeHtml(signal.text)}</p>
        </article>
      `
    )
    .join('');
}

function renderInsightCards(analysis) {
  el('signal-grid').innerHTML = buildInsightCards(analysis)
    .map(
      (card) => `
        <article class="insight-card">
          <p class="section-label">${escapeHtml(card.title)}</p>
          <h3>${escapeHtml(card.value)}</h3>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `
    )
    .join('');
}

function renderMatter(analysis) {
  el('case-title').textContent = analysis.overview.title;
  el('matter-stage').textContent = analysis.overview.stage;
  el('matter-summary').textContent = analysis.caseRecord.summary;
  el('matter-type').textContent = analysis.overview.matterType;
  el('matter-venue').textContent = analysis.overview.venue;
  el('medical-specials').textContent = analysis.overview.medicalSpecials;
  el('projected-exposure').textContent = analysis.overview.projectedExposure;
}

function renderMemo(analysis) {
  el('memo-headline').innerHTML = `<p>${escapeHtml(analysis.executiveMemo.headline)}</p>`;
  el('memo-sections').innerHTML = analysis.executiveMemo.sections
    .map(
      (section) => `
        <article class="memo-section">
          <p class="section-label">${escapeHtml(section.title)}</p>
          <p>${escapeHtml(section.body)}</p>
        </article>
      `
    )
    .join('');

  el('memo-plaintiff-themes').innerHTML = analysis.executiveMemo.plaintiffThemes
    .map((item) => `<span class="theme-pill theme-pill-positive">${escapeHtml(item)}</span>`)
    .join('');

  el('memo-defense-themes').innerHTML = analysis.executiveMemo.defenseThemes.length
    ? analysis.executiveMemo.defenseThemes
      .map((item) => `<span class="theme-pill theme-pill-risk">${escapeHtml(item)}</span>`)
      .join('')
    : '<span class="theme-pill">No major defense theme surfaced yet</span>';
}

function renderCoverage(analysis) {
  el('coverage-rows').innerHTML = analysis.coverage
    .map(
      (row) => `
        <article class="coverage-row">
          <div class="coverage-head">
            <div>
              <h4>${escapeHtml(row.label)}</h4>
              <p>${escapeHtml(row.summary)}</p>
            </div>
            <div class="coverage-status ${toneClass(row.status)}">
              <strong>${row.score}</strong>
              <span>${escapeHtml(row.status)}</span>
            </div>
          </div>
          <div class="meter coverage-meter">
            <span style="width:${row.score}%"></span>
          </div>
          <p class="citation-row">${row.citations.length ? row.citations.map(escapeHtml).join(' • ') : 'No direct citation'}</p>
        </article>
      `
    )
    .join('');
}

function renderTimeline(analysis) {
  el('timeline').innerHTML = analysis.timeline
    .map(
      (item, index) => `
        <article class="timeline-item">
          <div class="timeline-index">${String(index + 1).padStart(2, '0')}</div>
          <div class="timeline-track"></div>
          <div class="timeline-body">
            <div class="timeline-head">
              <div>
                <p class="timeline-date">${escapeHtml(item.displayDate)}</p>
                <h4>${escapeHtml(item.title)}</h4>
              </div>
              <div class="timeline-badges">
                <span class="doc-type-pill">${escapeHtml(item.categoryLabel)}</span>
                <span class="doc-citation">${escapeHtml(item.citation)}</span>
              </div>
            </div>
            <p>${escapeHtml(item.detail)}</p>
            <div class="timeline-meta-line">
              <span>${escapeHtml(item.phase)}</span>
              <span>${escapeHtml(item.source)}</span>
            </div>
          </div>
        </article>
      `
    )
    .join('');
}

function renderIssues(analysis) {
  el('issues').innerHTML = analysis.issues.length
    ? analysis.issues
      .map(
        (issue) => `
          <article class="issue-card">
            <div class="issue-heading">
              <h4>${escapeHtml(issue.title)}</h4>
              <span class="${badgeClass(issue.severity)}">${escapeHtml(issue.severity)}</span>
            </div>
            <p>${escapeHtml(issue.explanation)}</p>
            <p class="citation-row">${issue.citations.map(escapeHtml).join(' • ')}</p>
          </article>
        `
      )
      .join('')
    : '<article class="issue-card"><p>No major file risk surfaced from the current record set.</p></article>';
}

function renderMissingEvidence(analysis) {
  el('missing-evidence').innerHTML = analysis.missingEvidence.length
    ? analysis.missingEvidence
      .map(
        (item) => `
          <article class="issue-card">
            <div class="issue-heading">
              <h4>${escapeHtml(item.title)}</h4>
              <span class="${item.priority === 'high' ? 'badge badge-high' : 'badge badge-medium'}">${escapeHtml(item.priority)}</span>
            </div>
            <p>${escapeHtml(item.detail)}</p>
            <p class="citation-row">${item.citations.map(escapeHtml).join(' • ')}</p>
          </article>
        `
      )
      .join('')
    : '<article class="issue-card"><p>The current matter does not show a major missing-evidence request.</p></article>';
}

function renderActions(analysis) {
  el('actions').innerHTML = analysis.nextActions
    .map((action, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><p>${escapeHtml(action)}</p></li>`)
    .join('');
}

function renderDamages(analysis) {
  const maxCharge = Math.max(...analysis.billing.items.map((item) => item.amount), 1);

  el('damages-current-total').textContent = analysis.billing.totalDisplay;
  el('damages-future-total').textContent = analysis.billing.futureTotalDisplay;
  el('damages-projected-total').textContent = analysis.billing.projectedTotalDisplay;

  el('damages-bars').innerHTML = analysis.billing.items
    .map(
      (item) => `
        <article class="bar-row">
          <div class="bar-head">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.amountDisplay)}</strong>
          </div>
          <div class="meter bar-meter">
            <span style="width:${(item.amount / maxCharge) * 100}%"></span>
          </div>
        </article>
      `
    )
    .join('');

  el('future-care-list').innerHTML = `
    <article class="future-card">
      <p class="section-label">Narrative</p>
      <p>${escapeHtml(analysis.damagesNarrative.current)}</p>
      <p>${escapeHtml(analysis.damagesNarrative.future)}</p>
    </article>
    ${analysis.billing.futureItems.length
      ? analysis.billing.futureItems
        .map(
          (item) => `
            <article class="future-card">
              <div class="issue-heading">
                <h4>${escapeHtml(item.label)}</h4>
                <span class="badge badge-medium">${escapeHtml(item.amountDisplay)}</span>
              </div>
              <p class="citation-row">${escapeHtml(item.citation)}</p>
            </article>
          `
        )
        .join('')
      : '<article class="future-card"><p>No future-care reserve is modeled from the current file.</p></article>'}
  `;

  el('wage-loss-card').innerHTML = analysis.wageLoss
    ? `
      <article class="future-card wage-card">
        <p class="section-label">Wage Loss</p>
        <div class="wage-grid">
          <div>
            <span>Hours missed</span>
            <strong>${analysis.wageLoss.hoursMissed}</strong>
          </div>
          <div>
            <span>Hourly rate</span>
            <strong>$${analysis.wageLoss.hourlyRate.toFixed(2)}</strong>
          </div>
          <div>
            <span>Current wage loss</span>
            <strong>${analysis.wageLoss.amountDisplay}</strong>
          </div>
        </div>
        <p class="citation-row">${escapeHtml(analysis.wageLoss.citation)}</p>
      </article>
    `
    : `
      <article class="future-card wage-card">
        <p class="section-label">Wage Loss</p>
        <p>${escapeHtml(analysis.damagesNarrative.wageLoss)}</p>
      </article>
    `;
}

function renderProviders(analysis) {
  el('providers').innerHTML = analysis.providerJourney
    .map(
      (provider) => `
        <article class="provider-card">
          <div class="provider-head">
            <div>
              <p class="section-label">${escapeHtml(provider.role)}</p>
              <h4>${escapeHtml(provider.name)}</h4>
            </div>
            <span class="provider-range">${escapeHtml(provider.dateRange)}</span>
          </div>
          <p class="provider-doc-count">${provider.documentCount} document${provider.documentCount > 1 ? 's' : ''}</p>
          <div class="provider-tags">
            ${provider.highlights.length
              ? provider.highlights.map((item) => `<span class="theme-pill">${escapeHtml(item)}</span>`).join('')
              : '<span class="theme-pill">No extracted highlights</span>'}
          </div>
          <p class="citation-row">${provider.citations.map(escapeHtml).join(' • ')}</p>
        </article>
      `
    )
    .join('');
}

function renderDraft(analysis) {
  el('draft').innerHTML = analysis.drafts.demandLetter
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
}

function renderDepoOutline(analysis) {
  el('depo-outline').innerHTML = analysis.drafts.depositionOutline
    .map(
      (section) => `
        <article class="outline-card">
          <p class="section-label">Deposition Block</p>
          <h4>${escapeHtml(section.section)}</h4>
          <ul>
            ${section.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}
          </ul>
        </article>
      `
    )
    .join('');
}

function filteredDocuments() {
  const query = state.documentFilter.trim().toLowerCase();

  if (!query) {
    return state.analysis.documents;
  }

  return state.analysis.documents.filter((document) => {
    const haystack = `${document.title} ${document.source} ${document.typeLabel} ${document.excerpt}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderDocuments() {
  const documents = filteredDocuments();
  el('document-count-label').textContent = `${documents.length} of ${state.analysis.documents.length} documents shown`;
  el('documents').innerHTML = documents.length
    ? documents
      .map(
        (document) => `
          <article class="document-card">
            <div class="document-head">
              <div>
                <p class="section-label">${escapeHtml(document.typeLabel)}</p>
                <h4>${escapeHtml(document.title)}</h4>
                <p class="document-source">${escapeHtml(document.source)}</p>
              </div>
              <div class="document-meta">
                <span>${escapeHtml(document.citation)}</span>
                <span>${escapeHtml(document.date)}</span>
              </div>
            </div>
            <p>${escapeHtml(document.excerpt)}</p>
          </article>
        `
      )
      .join('')
    : '<article class="document-card"><p>No documents match the current filter.</p></article>';
}

function renderChatAnswer(answer, citations) {
  el('chat-answer').classList.remove('empty-state');
  const lines = String(answer).split('\n').filter(Boolean);
  const [lead, ...rest] = lines;
  // Multi-part answers arrive newline-separated: show the first line as the lead, the rest as items.
  const body = rest.length && lead.endsWith(':')
    ? `<p>${escapeHtml(lead)}</p><ul class="answer-list">${rest.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : lines.length > 1
      ? `<ul class="answer-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : `<p>${escapeHtml(answer)}</p>`;
  el('chat-answer').innerHTML = `
    ${body}
    <p class="citation-row">${citations.length ? citations.map(escapeHtml).join(' • ') : 'No citations'}</p>
  `;
}

function clearChatAnswer() {
  el('chat-answer').classList.add('empty-state');
  el('chat-answer').textContent = 'No question asked yet.';
}

function renderAll(analysis) {
  state.analysis = analysis;
  renderPromptPills();
  renderMatter(analysis);
  renderScore(analysis);
  renderHeroSignals(analysis);
  renderStats(analysis);
  renderInsightCards(analysis);
  renderMemo(analysis);
  renderCoverage(analysis);
  renderTimeline(analysis);
  renderIssues(analysis);
  renderMissingEvidence(analysis);
  renderActions(analysis);
  renderDamages(analysis);
  renderProviders(analysis);
  renderDraft(analysis);
  renderDepoOutline(analysis);
  renderDocuments();
  clearChatAnswer();
}

async function loadCases() {
  const response = await fetch('/api/cases');
  state.cases = await response.json();

  if (!state.cases.some((item) => item.id === state.caseId) && state.cases[0]) {
    state.caseId = state.cases[0].id;
  }

  renderCasePicker();
}

async function loadAnalysis(caseId = state.caseId) {
  state.caseId = caseId;
  const response = await fetch(`/api/cases/${caseId}/analysis`);
  const analysis = await response.json();
  renderCasePicker();
  renderAll(analysis);
}

async function askQuestion(question) {
  const response = await fetch(`/api/cases/${state.caseId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ question })
  });
  const data = await response.json();
  renderChatAnswer(data.answer, data.citations);
}

async function downloadReport() {
  const response = await fetch(`/api/cases/${state.caseId}/export.md`);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `casepilot-${state.caseId}-report.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

el('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = el('chat-question').value.trim();
  await askQuestion(question);
});

el('prompt-pills').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-prompt]');

  if (!button) {
    return;
  }

  const prompt = button.dataset.prompt;
  el('chat-question').value = prompt;
  await askQuestion(prompt);
});

el('refresh-analysis').addEventListener('click', () => loadAnalysis());

el('insert-sample-question').addEventListener('click', async () => {
  const sample = 'What are the main risks and missing records in this case?';
  el('chat-question').value = sample;
  await askQuestion(sample);
});

el('case-select').addEventListener('change', async (event) => {
  await loadAnalysis(event.target.value);
});

el('download-report').addEventListener('click', downloadReport);

el('document-filter').addEventListener('input', (event) => {
  state.documentFilter = event.target.value;
  if (state.analysis) {
    renderDocuments();
  }
});

async function initialize() {
  await loadCases();
  await loadAnalysis(state.caseId);
}

initialize().catch((error) => {
  renderChatAnswer(`Failed to load analysis: ${error.message}`, []);
});

// Sticky section nav: highlight the section in view and keep its pill visible.
(function initSectionNav() {
  const nav = document.getElementById("section-nav");
  if (!nav || !("IntersectionObserver" in window)) return;
  const links = new Map([...nav.querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a]));
  const visible = new Set();
  let lockedUntil = 0;
  const activate = (id) => {
    links.forEach((a, key) => a.classList.toggle("active", key === id));
    const active = links.get(id);
    if (active) nav.scrollTo({ left: active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2, behavior: "smooth" });
  };
  const setActive = () => {
    if (Date.now() < lockedUntil || !visible.size) return;
    // Nearest section top to the nav wins; side-by-side panels share a top, so DOM order breaks the tie.
    const ordered = [...links.keys()].filter((id) => visible.has(id));
    let best = ordered[0], bestDistance = Infinity;
    for (const id of ordered) {
      const distance = Math.abs(document.getElementById(id).getBoundingClientRect().top - 90);
      if (distance < bestDistance - 4) { best = id; bestDistance = distance; }
    }
    activate(best);
  };
  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    activate(link.getAttribute("href").slice(1));
    lockedUntil = Date.now() + 900;
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id)));
    setActive();
  }, { rootMargin: "-90px 0px -45% 0px", threshold: [0, 0.15, 0.4, 0.7] });
  window.addEventListener("scroll", () => window.requestAnimationFrame(setActive), { passive: true });
  links.forEach((_, id) => { const el = document.getElementById(id); if (el) observer.observe(el); });

  const top = document.getElementById("back-to-top");
  const onScroll = () => top && top.classList.toggle("visible", window.scrollY > 900);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
