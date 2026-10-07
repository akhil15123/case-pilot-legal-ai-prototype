import fs from 'node:fs/promises';
import path from 'node:path';

const TYPE_META = {
  intake: {
    label: 'Intake',
    detail: 'Initial plaintiff narrative captured mechanism, symptoms, and immediate damages framing.',
    phase: 'Intake',
    providerRole: 'Case intake'
  },
  police_report: {
    label: 'Police Report',
    detail: 'Official crash reporting supports liability framing and contemporaneous complaints.',
    phase: 'Liability',
    providerRole: 'Investigating agency'
  },
  incident_report: {
    label: 'Incident Report',
    detail: 'Premises report supports notice and dangerous-condition theories.',
    phase: 'Liability',
    providerRole: 'Incident reporting entity'
  },
  er_record: {
    label: 'ER Record',
    detail: 'Same-day medical treatment anchors causation and documents acute injury presentation.',
    phase: 'Acute care',
    providerRole: 'Acute care provider'
  },
  orthopedic_consult: {
    label: 'Orthopedic Consult',
    detail: 'Specialist follow-up adds work restrictions, persistent complaints, and targeted recommendations.',
    phase: 'Specialty care',
    providerRole: 'Orthopedic specialist'
  },
  mri_report: {
    label: 'MRI Report',
    detail: 'Objective imaging sharpens the injury narrative beyond subjective complaints.',
    phase: 'Diagnostics',
    providerRole: 'Imaging center'
  },
  physical_therapy_eval: {
    label: 'PT Evaluation',
    detail: 'Therapy intake documents functional loss, disability scoring, and treatment plan design.',
    phase: 'Rehabilitation',
    providerRole: 'Physical therapy'
  },
  physical_therapy_progress: {
    label: 'PT Progress',
    detail: 'Progress note tracks symptom persistence, compliance, and treatment interruption risk.',
    phase: 'Rehabilitation',
    providerRole: 'Physical therapy'
  },
  wage_verification: {
    label: 'Wage Verification',
    detail: 'Employer support ties missed work to the injury window and quantifies wage loss.',
    phase: 'Damages',
    providerRole: 'Employer'
  },
  billing_ledger: {
    label: 'Billing Ledger',
    detail: 'Billing file quantifies current medical specials and outstanding exposure.',
    phase: 'Damages',
    providerRole: 'Case file'
  }
};

function toDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function daysBetween(start, end) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((toDate(end) - toDate(start)) / msPerDay);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(toDate(value));
}

function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

function sentence(value) {
  return value.endsWith('.') ? value : `${value}.`;
}

function unique(items) {
  return [...new Set(items)];
}

function tokenize(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function titleize(value) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function limitList(items, count = 3) {
  return unique(items).slice(0, count);
}

function statusFromScore(score) {
  if (score >= 84) {
    return 'Strong';
  }

  if (score >= 68) {
    return 'Developing';
  }

  return 'Needs support';
}

function getMeta(type) {
  return TYPE_META[type] ?? {
    label: titleize(type),
    detail: 'Case event captured from the supporting record.',
    phase: 'General',
    providerRole: 'Supporting source'
  };
}

function getDocument(documents, type) {
  return documents.find((document) => document.type === type);
}

function getDocuments(documents, types) {
  return documents.filter((document) => types.includes(document.type));
}

function inferLiabilityDocument(documents) {
  return documents.find((document) => ['police_report', 'incident_report'].includes(document.type));
}

function buildTimeline(documents) {
  return [...documents]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((document) => {
      const meta = getMeta(document.type);

      return {
        date: document.date,
        displayDate: formatDate(document.date),
        title: document.title,
        category: document.type,
        categoryLabel: meta.label,
        citation: document.citation,
        source: document.source,
        phase: meta.phase,
        detail: meta.detail
      };
    });
}

function collectInjuries(documents) {
  return unique(
    documents
      .flatMap((document) => document.injuries ?? [])
      .map((item) => item.trim())
  );
}

function humanizeChargeKey(key) {
  const labels = {
    emergency_department: 'Emergency Department',
    urgent_care: 'Urgent Care',
    orthopedic_consult: 'Orthopedic Consult',
    mri_imaging: 'MRI Imaging',
    physical_therapy: 'Physical Therapy',
    pharmacy: 'Pharmacy'
  };

  return labels[key] ?? titleize(key);
}

function parseWageLoss(documents) {
  const wageDoc = getDocument(documents, 'wage_verification');

  if (!wageDoc) {
    return null;
  }

  const hoursMissed = Number(wageDoc.hoursMissed ?? 0);
  const hourlyRate = Number(wageDoc.hourlyRate ?? 0);
  const amount = hoursMissed && hourlyRate ? hoursMissed * hourlyRate : 0;

  return {
    citation: wageDoc.citation,
    hoursMissed,
    hourlyRate,
    amount,
    amountDisplay: formatMoney(amount)
  };
}

function recommendationCovered(recommendation, laterDocuments) {
  const normalized = recommendation.toLowerCase();

  return laterDocuments.some((document) => {
    const haystack = [
      document.title,
      document.source,
      ...(document.recommendations ?? [])
    ].join(' ').toLowerCase();

    if (normalized.includes('physical therapy')) {
      return document.type.startsWith('physical_therapy');
    }

    if (normalized.includes('pain management')) {
      return document.type === 'pain_management_record' || /pain management/.test(haystack);
    }

    if (normalized.includes('mri')) {
      return document.type === 'mri_report';
    }

    if (normalized.includes('orthopedic surgical')) {
      return document.type === 'surgical_consult' || /surgical consult|surgeon|surgery|orthopedic surgical/.test(haystack);
    }

    if (normalized.includes('orthopedic follow')) {
      return document.type === 'orthopedic_consult';
    }

    return tokenize(recommendation).every((token) => haystack.includes(token));
  });
}

function computeBilling(documents) {
  const billingDoc = getDocument(documents, 'billing_ledger');
  const charges = billingDoc?.charges ?? {};
  const items = Object.entries(charges)
    .map(([key, amount]) => ({
      key,
      label: humanizeChargeKey(key),
      amount,
      amountDisplay: formatMoney(amount)
    }))
    .sort((left, right) => right.amount - left.amount);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const ptEval = getDocument(documents, 'physical_therapy_eval');
  const ptProgress = getDocument(documents, 'physical_therapy_progress');
  const mri = getDocument(documents, 'mri_report');
  const futureItems = [];

  if (ptEval?.recommendedVisits && charges.physical_therapy) {
    const completedVisits = ptProgress?.completedVisits ?? 0;
    const remainingVisits = Math.max((ptEval.recommendedVisits ?? 0) - completedVisits, 0);
    const perVisit = completedVisits > 0
      ? charges.physical_therapy / completedVisits
      : charges.physical_therapy / Math.max(Math.ceil((ptEval.recommendedVisits ?? 1) / 2), 1);

    if (remainingVisits > 0) {
      const amount = Math.round(remainingVisits * perVisit);
      futureItems.push({
        label: 'Remaining physical therapy',
        amount,
        amountDisplay: formatMoney(amount),
        citation: ptEval.citation
      });
    }
  }

  if (mri?.recommendations?.some((item) => /pain management/i.test(item))) {
    futureItems.push({
      label: 'Pain management consultation reserve',
      amount: 1800,
      amountDisplay: formatMoney(1800),
      citation: mri.citation
    });
  }

  if (mri?.recommendations?.some((item) => /surgical consultation/i.test(item))) {
    futureItems.push({
      label: 'Orthopedic surgical consult reserve',
      amount: 1250,
      amountDisplay: formatMoney(1250),
      citation: mri.citation
    });
  }

  const futureTotal = futureItems.reduce((sum, item) => sum + item.amount, 0);
  const projectedTotal = total + futureTotal;

  return {
    charges,
    items,
    total,
    totalDisplay: formatMoney(total),
    futureItems,
    futureTotal,
    futureTotalDisplay: formatMoney(futureTotal),
    projectedTotal,
    projectedTotalDisplay: formatMoney(projectedTotal),
    citation: billingDoc?.citation ?? null
  };
}

function buildIssues(caseRecord, documents, timeline) {
  const issues = [];
  const intake = getDocument(documents, 'intake');
  const er = getDocument(documents, 'er_record');
  const ptEval = getDocument(documents, 'physical_therapy_eval');
  const ptProgress = getDocument(documents, 'physical_therapy_progress');
  const hasWageProof = documents.some((document) => document.type === 'wage_verification');

  if (intake && er) {
    const intakeDenial = /denies any prior neck or back treatment|denies any prior right knee treatment/i.test(intake.text);
    const erHistory = /occasional mild neck stiffness|prior right knee soreness/i.test(er.text);

    if (intakeDenial && erHistory) {
      issues.push({
        title: 'Prior-history inconsistency',
        severity: 'high',
        explanation: 'The intake denies prior relevant complaints, but a same-day treatment note references prior symptoms. Defense counsel could use that difference to argue a pre-existing component.',
        citations: [intake.citation, er.citation]
      });
    }
  }

  if (ptEval && ptProgress) {
    const gapDays = daysBetween(ptEval.date, ptProgress.date);

    if (gapDays >= 30) {
      issues.push({
        title: 'Documented treatment gap',
        severity: 'high',
        explanation: `The therapy file shows a ${gapDays}-day span between the initial evaluation and the progress note, with an express lapse in active treatment. That gap will need a clean explanation before demand or mediation.`,
        citations: [ptEval.citation, ptProgress.citation]
      });
    }
  }

  for (const [index, document] of documents.entries()) {
    const laterDocuments = documents.slice(index + 1);

    for (const recommendation of document.recommendations ?? []) {
      if (!recommendationCovered(recommendation, laterDocuments)) {
        issues.push({
          title: 'Recommended follow-up missing from file',
          severity: 'medium',
          explanation: `${titleize(recommendation)} was recommended in ${document.title}, but no later record appears to document that follow-up.`,
          citations: [document.citation]
        });
      }
    }
  }

  if (caseRecord.claims.includes('lost wages') && !hasWageProof) {
    issues.push({
      title: 'Lost wage support not yet documented',
      severity: 'medium',
      explanation: 'The case includes a lost wage claim, but the current file does not contain employer verification, wage statements, or another concrete earnings record.',
      citations: [intake?.citation ?? timeline.at(0)?.citation].filter(Boolean)
    });
  }

  if (timeline.length < 5) {
    issues.push({
      title: 'Thin treatment record',
      severity: 'low',
      explanation: 'The current record set is light for a full pre-suit damages package and may benefit from additional provider material.',
      citations: timeline.map((item) => item.citation).slice(0, 2)
    });
  }

  return unique(issues.map((issue) => JSON.stringify(issue))).map((item) => JSON.parse(item));
}

function buildStrengths(documents, billing) {
  const strengths = [];
  const liabilityDoc = inferLiabilityDocument(documents);
  const er = getDocument(documents, 'er_record');
  const ortho = getDocument(documents, 'orthopedic_consult');
  const mri = getDocument(documents, 'mri_report');
  const ptEval = getDocument(documents, 'physical_therapy_eval');
  const wageDoc = getDocument(documents, 'wage_verification');

  if (liabilityDoc) {
    strengths.push({
      title: 'Liability is supported by a contemporaneous official report',
      detail: `${liabilityDoc.title} helps anchor the liability story early in the file.`,
      citations: [liabilityDoc.citation]
    });
  }

  if (er) {
    strengths.push({
      title: 'Same-day treatment supports causation',
      detail: 'Immediate medical attention reduces the defense argument that symptoms developed later from another event.',
      citations: [er.citation]
    });
  }

  if (mri) {
    strengths.push({
      title: 'Objective imaging strengthens the damages presentation',
      detail: 'MRI findings move the file beyond subjective pain complaints and support a more durable injury narrative.',
      citations: [mri.citation]
    });
  }

  if (ortho) {
    strengths.push({
      title: 'Specialist care and work restrictions support seriousness',
      detail: 'Orthopedic follow-up and work limitations help frame the case as functionally disruptive rather than minor.',
      citations: [ortho.citation]
    });
  }

  if (ptEval) {
    strengths.push({
      title: 'Functional limits are documented in rehabilitation records',
      detail: 'Therapy intake provides measurable limits that can be reused in settlement or mediation framing.',
      citations: [ptEval.citation]
    });
  }

  if (wageDoc) {
    strengths.push({
      title: 'Lost wages are supported by employer documentation',
      detail: 'The damages file includes direct wage verification rather than relying on plaintiff estimate alone.',
      citations: [wageDoc.citation]
    });
  }

  if (billing.total > 0) {
    strengths.push({
      title: 'Current specials are already quantifiable',
      detail: `The file documents ${billing.totalDisplay} in current medical specials.`,
      citations: [billing.citation].filter(Boolean)
    });
  }

  return strengths.slice(0, 5);
}

function buildProviderJourney(documents) {
  const groups = new Map();

  for (const document of documents) {
    const groupKey = document.source;
    const existing = groups.get(groupKey) ?? [];
    existing.push(document);
    groups.set(groupKey, existing);
  }

  return [...groups.entries()]
    .map(([source, docs]) => {
      const sorted = [...docs].sort((left, right) => left.date.localeCompare(right.date));
      const first = sorted[0];
      const last = sorted.at(-1);
      const meta = getMeta(first.type);
      const highlights = limitList(sorted.flatMap((document) => document.injuries ?? document.recommendations ?? []), 3);

      return {
        name: source,
        role: meta.providerRole,
        documentCount: sorted.length,
        rawFirstDate: first.date,
        firstDate: formatDate(first.date),
        lastDate: formatDate(last.date),
        dateRange: first.date === last.date
          ? formatDate(first.date)
          : `${formatDate(first.date)} → ${formatDate(last.date)}`,
        highlights,
        citations: sorted.map((document) => document.citation)
      };
    })
    .sort((left, right) => left.rawFirstDate.localeCompare(right.rawFirstDate))
    .map(({ rawFirstDate, ...provider }) => provider);
}

function buildCoverage(caseRecord, documents, issues, billing, wageLoss) {
  const liabilityDoc = inferLiabilityDocument(documents);
  const er = getDocument(documents, 'er_record');
  const mri = getDocument(documents, 'mri_report');
  const ortho = getDocument(documents, 'orthopedic_consult');
  const pt = getDocuments(documents, ['physical_therapy_eval', 'physical_therapy_progress']);
  const rows = [
    {
      label: 'Liability',
      score: liabilityDoc ? 92 : 56,
      summary: liabilityDoc
        ? 'An official report supports a direct liability narrative.'
        : 'Liability still depends heavily on plaintiff narrative and informal file support.',
      citations: liabilityDoc ? [liabilityDoc.citation] : []
    },
    {
      label: 'Causation',
      score: er ? 90 : 62,
      summary: er
        ? 'Same-day medical treatment tightly links the event to the injury complaints.'
        : 'No same-day treatment record appears, so timing will need closer explanation.',
      citations: er ? [er.citation] : []
    },
    {
      label: 'Objective injury support',
      score: mri ? 88 : ortho ? 70 : 54,
      summary: mri
        ? 'Objective imaging supports the injury story.'
        : ortho
          ? 'Specialist findings help, but imaging or equivalent objective support would strengthen the file.'
          : 'The file is still mostly symptom-driven.',
      citations: unique([mri?.citation, ortho?.citation].filter(Boolean))
    },
    {
      label: 'Past medical damages',
      score: billing.total >= 5000 ? 84 : billing.total >= 2000 ? 72 : 55,
      summary: `Current medical specials total ${billing.totalDisplay}.`,
      citations: [billing.citation].filter(Boolean)
    },
    {
      label: 'Future care support',
      score: billing.futureTotal > 0 ? 76 : 58,
      summary: billing.futureTotal > 0
        ? `The file supports future-care exposure of about ${billing.futureTotalDisplay}, but some recommended follow-up is still absent from the record.`
        : 'Future medical exposure is not strongly documented yet.',
      citations: unique(billing.futureItems.map((item) => item.citation).filter(Boolean))
    },
    {
      label: 'Lost wage support',
      score: caseRecord.claims.includes('lost wages')
        ? (wageLoss ? 86 : 42)
        : 0,
      summary: caseRecord.claims.includes('lost wages')
        ? (wageLoss
          ? `Employer verification supports ${wageLoss.amountDisplay} in current lost wages.`
          : 'A wage claim is asserted, but no employer or pay data is in the file yet.')
        : 'Lost wages are not a core damages theory in this file.',
      citations: wageLoss ? [wageLoss.citation] : []
    }
  ];

  return rows.map((row) => ({
    ...row,
    status: statusFromScore(row.score)
  }));
}

function buildMissingEvidence(issues) {
  const items = [];

  for (const issue of issues) {
    if (issue.title === 'Prior-history inconsistency') {
      items.push({
        title: 'Clarify or neutralize prior-symptom history',
        detail: 'Prepare a clean explanation showing any prior complaint was minor, non-treated, or unlike the post-incident presentation.',
        priority: 'high',
        citations: issue.citations
      });
    }

    if (issue.title === 'Documented treatment gap') {
      items.push({
        title: 'Gap explanation statement',
        detail: 'Add a plaintiff explanation or supporting note addressing transportation, childcare, scheduling, or other non-medical causes of the lapse.',
        priority: 'high',
        citations: issue.citations
      });
    }

    if (issue.title === 'Recommended follow-up missing from file') {
      items.push({
        title: 'Recommended follow-up record or scheduling confirmation',
        detail: 'Collect the recommended next-step consult record or confirm it has not yet occurred and explain why.',
        priority: 'medium',
        citations: issue.citations
      });
    }

    if (issue.title === 'Lost wage support not yet documented') {
      items.push({
        title: 'Employer wage verification',
        detail: 'Request missed-work confirmation, average pay documentation, and return-to-work timing support.',
        priority: 'medium',
        citations: issue.citations
      });
    }
  }

  return items;
}

function buildExecutiveMemo(caseRecord, documents, issues, strengths, billing, wageLoss) {
  const liabilityDoc = inferLiabilityDocument(documents);
  const er = getDocument(documents, 'er_record');
  const mri = getDocument(documents, 'mri_report');
  const primaryIssue = issues[0];
  const objectiveNarrative = mri
    ? `Objective imaging appears in ${mri.title}, which helps move the injury story beyond subjective complaint language [${mri.citation}].`
    : 'The medical narrative is still driven mostly by treatment notes and symptom descriptions rather than imaging.';
  const wageSentence = wageLoss
    ? `The damages file also includes employer-backed wage loss of ${wageLoss.amountDisplay} [${wageLoss.citation}].`
    : 'Lost wages remain a weaker component because employer-backed earnings support is not yet in the record.';

  const headline = sentence(
    [
      liabilityDoc ? 'Clear liability posture' : 'Liability is still developing',
      er ? 'with immediate treatment support' : 'without same-day medical anchoring',
      mri ? 'and objective injury findings' : 'and still-limited objective support'
    ].join(' ')
  );

  return {
    headline,
    sections: [
      {
        title: 'Case posture',
        body: `${caseRecord.title} is positioned as a ${caseRecord.matterType.toLowerCase()} matter with a plaintiff-friendly liability opening and a damages file that is materially underway but not yet fully buttoned up. ${primaryIssue ? `The main risk to neutralize is ${primaryIssue.title.toLowerCase()}.` : 'No major structural file risk appears yet.'}`
      },
      {
        title: 'Liability narrative',
        body: liabilityDoc
          ? `${liabilityDoc.title} provides a concrete event narrative that can be used early in demand framing [${liabilityDoc.citation}]. ${er ? `The same-day treatment record then links the event to immediate complaints [${er.citation}].` : ''}`
          : 'Liability will need to rely more on witness development, client narrative, and any informal incident materials until a stronger external record is obtained.'
      },
      {
        title: 'Medical narrative',
        body: `${objectiveNarrative} The strongest treatment story should emphasize the progression from acute presentation to specialty follow-up, continuing functional limits, and any work restrictions already in the file.`
      },
      {
        title: 'Damages posture',
        body: `Current medical specials total ${billing.totalDisplay}${billing.futureTotal ? ` with roughly ${billing.futureTotalDisplay} in modeled additional treatment exposure` : ''} [${billing.citation ?? ''}]. ${wageSentence}`
      }
    ],
    plaintiffThemes: strengths.slice(0, 3).map((item) => item.title),
    defenseThemes: issues.slice(0, 3).map((item) => item.title)
  };
}

function buildNextActions(issues, missingEvidence, billing) {
  const actions = missingEvidence.map((item) => item.detail);

  if (!actions.length) {
    actions.push('The file is relatively well-developed; next work should focus on packaging the demand and tightening presentation.');
  }

  actions.push(`Refresh the medical specials ledger before issuing any demand package; current documented specials are ${billing.totalDisplay}.`);

  return actions;
}

function buildDamagesNarrative(billing, wageLoss) {
  const currentItems = billing.items
    .map((item) => `${item.label} ${item.amountDisplay}`)
    .join(', ');
  const futureItems = billing.futureItems.length
    ? billing.futureItems.map((item) => `${item.label} ${item.amountDisplay}`).join(', ')
    : 'No modeled future-care reserve yet.';

  return {
    current: `Current specials consist of ${currentItems}.`,
    future: `Modeled future exposure: ${futureItems}`,
    wageLoss: wageLoss
      ? `Current lost wages are modeled at ${wageLoss.amountDisplay} from ${wageLoss.hoursMissed} missed hours.`
      : 'Lost wages are not yet supported with employer-backed documentation.'
  };
}

function buildDemandLetter(caseRecord, documents, timeline, issues, billing, injuries, wageLoss) {
  const police = inferLiabilityDocument(documents);
  const er = getDocument(documents, 'er_record');
  const ortho = getDocument(documents, 'orthopedic_consult');
  const mri = getDocument(documents, 'mri_report');
  const latestTreatment = timeline.at(-1);
  const riskLine = issues.find((issue) => issue.title === 'Documented treatment gap')
    ? 'The demand package should directly address the interruption in treatment so the defense cannot frame it as symptom resolution or non-compliance.'
    : 'The treatment history is relatively clean for a pre-suit presentation and can be framed as a consistent recovery arc.';
  const wageLine = wageLoss
    ? `The current damages picture also includes documented lost wages of ${wageLoss.amountDisplay} [${wageLoss.citation}].`
    : 'Lost wages should be handled conservatively until employer-backed earnings support is collected.';

  return [
    `This matter arises from an incident on ${formatDate(caseRecord.accidentDate)} in which ${caseRecord.plaintiff} sustained injury in connection with ${caseRecord.defendant}. ${police ? `${police.title} supports an early liability narrative that can be stated cleanly in demand framing [${police.citation}].` : 'The liability narrative should be supported carefully with the available file materials.'}`,
    `${caseRecord.plaintiff} sought immediate medical attention for ${limitList(injuries, 4).join(', ')}, supporting a direct causation story from the event to treatment [${er?.citation ?? timeline[0]?.citation}]. Follow-up care progressed into specialty treatment and functional limitation documentation${ortho ? ` [${ortho.citation}]` : ''}.`,
    `${mri ? `Objective imaging later identified ${limitList(mri.injuries ?? [], 2).join(' and ')}, which materially strengthens the injury narrative [${mri.citation}].` : 'The current medical story still depends more heavily on treatment observations than imaging.'} The latest documented treatment status appears in ${latestTreatment?.title ?? 'the current record set'} [${latestTreatment?.citation ?? billing.citation}].`,
    `Current documented medical specials total ${billing.totalDisplay}${billing.futureTotal ? `, with additional modeled treatment exposure of ${billing.futureTotalDisplay}` : ''} [${billing.citation ?? 'BILL-1'}]. ${wageLine} ${riskLine}`
  ].map(sentence);
}

function buildDepositionOutline(documents) {
  const liabilityDoc = inferLiabilityDocument(documents);

  return [
    {
      section: 'Incident mechanics and notice',
      questions: [
        `${liabilityDoc ? `Walk through the facts reflected in ${liabilityDoc.title} and confirm how the event occurred [${liabilityDoc.citation}].` : 'Walk through the event sequence and identify all facts showing how the incident occurred.'}`,
        'Identify the hazard condition, the amount of time it existed, and what employees knew before the event.',
        'Explain what photographs, video, witness statements, or internal communications were preserved immediately after the event.'
      ]
    },
    {
      section: 'Safety systems and compliance',
      questions: [
        'Describe all relevant safety, inspection, cleanup, or driver-control policies that should have prevented this incident.',
        'Identify the people responsible for inspection, hazard response, supervision, and post-incident investigation.',
        'Explain whether the defendant concluded internally that the incident was preventable and what corrective action followed.'
      ]
    },
    {
      section: 'Document preservation and corporate knowledge',
      questions: [
        'Identify the custodian for logs, telematics, surveillance, incident reporting, maintenance, or training materials tied to this event.',
        'State what records no longer exist and explain when and why they were lost or overwritten.',
        'Describe the scope of any litigation hold or evidence-preservation effort after notice of the claim.'
      ]
    }
  ];
}

function documentMatches(questionTokens, document) {
  const haystack = tokenize(
    [document.title, document.source, document.text, ...(document.injuries ?? []), ...(document.tags ?? []), ...(document.recommendations ?? [])].join(' ')
  );
  const tokenSet = new Set(haystack);

  return questionTokens.reduce((score, token) => score + (tokenSet.has(token) ? 1 : 0), 0);
}

function searchDocuments(question, documents) {
  const questionTokens = tokenize(question);

  return [...documents]
    .map((document) => ({
      ...document,
      score: documentMatches(questionTokens, document)
    }))
    .filter((document) => document.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

export async function loadCaseBundle(rootDir, caseId) {
  const caseDir = path.join(rootDir, 'data', 'cases', caseId);
  const [caseText, documentsText] = await Promise.all([
    fs.readFile(path.join(caseDir, 'case.json'), 'utf8'),
    fs.readFile(path.join(caseDir, 'documents.json'), 'utf8')
  ]);

  return {
    caseRecord: JSON.parse(caseText),
    documents: JSON.parse(documentsText)
  };
}

export async function listCaseBundles(rootDir) {
  const casesDir = path.join(rootDir, 'data', 'cases');
  const entries = await fs.readdir(casesDir, { withFileTypes: true });
  const caseIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases = await Promise.all(caseIds.map(async (caseId) => {
    const { caseRecord, documents } = await loadCaseBundle(rootDir, caseId);

    return {
      id: caseRecord.id,
      title: caseRecord.title,
      matterType: caseRecord.matterType,
      stage: caseRecord.stage,
      summary: caseRecord.summary,
      prototypeDate: caseRecord.prototypeDate,
      documentCount: documents.length
    };
  }));

  return cases.sort((left, right) => right.prototypeDate.localeCompare(left.prototypeDate));
}

export function buildCaseAnalysis(caseRecord, documents) {
  const timeline = buildTimeline(documents);
  const injuries = collectInjuries(documents);
  const billing = computeBilling(documents);
  const wageLoss = parseWageLoss(documents);
  const issues = buildIssues(caseRecord, documents, timeline);
  const strengths = buildStrengths(documents, billing);
  const providerJourney = buildProviderJourney(documents);
  const coverage = buildCoverage(caseRecord, documents, issues, billing, wageLoss);
  const missingEvidence = buildMissingEvidence(issues);
  const executiveMemo = buildExecutiveMemo(caseRecord, documents, issues, strengths, billing, wageLoss);
  const nextActions = buildNextActions(issues, missingEvidence, billing);
  const damagesNarrative = buildDamagesNarrative(billing, wageLoss);

  return {
    caseRecord,
    overview: {
      title: caseRecord.title,
      matterType: caseRecord.matterType,
      stage: caseRecord.stage,
      accidentDate: formatDate(caseRecord.accidentDate),
      plaintiff: caseRecord.plaintiff,
      defendant: caseRecord.defendant,
      venue: caseRecord.venue,
      documentCount: documents.length,
      timelineEvents: timeline.length,
      injuriesTracked: injuries.length,
      medicalSpecials: billing.totalDisplay,
      projectedExposure: billing.projectedTotalDisplay
    },
    injuries,
    wageLoss,
    billing,
    timeline,
    issues,
    strengths,
    coverage,
    providerJourney,
    missingEvidence,
    executiveMemo,
    damagesNarrative,
    nextActions,
    drafts: {
      demandLetter: buildDemandLetter(caseRecord, documents, timeline, issues, billing, injuries, wageLoss),
      depositionOutline: buildDepositionOutline(documents)
    },
    documents: documents.map((document) => ({
      id: document.id,
      citation: document.citation,
      title: document.title,
      type: document.type,
      typeLabel: getMeta(document.type).label,
      source: document.source,
      date: formatDate(document.date),
      rawDate: document.date,
      excerpt: document.text
    }))
  };
}

export function buildCaseReportMarkdown(analysis) {
  const lines = [
    `# ${analysis.overview.title}`,
    '',
    `- Matter type: ${analysis.overview.matterType}`,
    `- Stage: ${analysis.overview.stage}`,
    `- Venue: ${analysis.overview.venue}`,
    `- Current medical specials: ${analysis.billing.totalDisplay}`,
    `- Projected exposure: ${analysis.billing.projectedTotalDisplay}`,
    '',
    '## Executive Memo',
    '',
    analysis.executiveMemo.headline,
    ''
  ];

  for (const section of analysis.executiveMemo.sections) {
    lines.push(`### ${section.title}`);
    lines.push('');
    lines.push(section.body);
    lines.push('');
  }

  lines.push('## Strengths');
  lines.push('');
  for (const strength of analysis.strengths) {
    lines.push(`- ${strength.title} (${strength.citations.join(', ')})`);
  }
  lines.push('');
  lines.push('## Risks');
  lines.push('');
  for (const issue of analysis.issues) {
    lines.push(`- ${issue.title}: ${issue.explanation} (${issue.citations.join(', ')})`);
  }
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  for (const row of analysis.coverage) {
    lines.push(`- ${row.label}: ${row.status} (${row.score}) — ${row.summary}`);
  }
  lines.push('');
  lines.push('## Damages');
  lines.push('');
  lines.push(`- Current specials: ${analysis.billing.totalDisplay}`);
  lines.push(`- Future modeled exposure: ${analysis.billing.futureTotalDisplay}`);
  if (analysis.wageLoss) {
    lines.push(`- Lost wages: ${analysis.wageLoss.amountDisplay}`);
  }
  lines.push('');
  lines.push('## Next Actions');
  lines.push('');
  for (const action of analysis.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  for (const item of analysis.timeline) {
    lines.push(`- ${item.displayDate}: ${item.title} (${item.citation})`);
  }

  return lines.join('\n');
}

export function answerQuestion(question, analysis, rawDocuments) {
  const normalized = question.toLowerCase().trim();

  if (!normalized) {
    return {
      answer: 'Ask about liability, damages, future care, providers, risks, missing records, or the executive memo.',
      citations: []
    };
  }

  if (normalized.includes('memo') || normalized.includes('strategy') || normalized.includes('posture')) {
    return {
      answer: [analysis.executiveMemo.headline, ...analysis.executiveMemo.sections.slice(0, 2).map((section) => section.body)].join(' '),
      citations: unique([
        ...analysis.strengths.flatMap((item) => item.citations),
        ...analysis.issues.flatMap((item) => item.citations)
      ]).slice(0, 5)
    };
  }

  if (normalized.includes('bill') || normalized.includes('medical special') || normalized.includes('damages')) {
    const wageLine = analysis.wageLoss
      ? ` Lost wages are currently supported at ${analysis.wageLoss.amountDisplay}.`
      : '';

    return {
      answer: `Current documented medical specials are ${analysis.billing.totalDisplay}. The modeled future-care reserve is ${analysis.billing.futureTotalDisplay}, for a projected exposure of ${analysis.billing.projectedTotalDisplay}.${wageLine}`,
      citations: unique([
        analysis.billing.citation,
        ...analysis.billing.futureItems.map((item) => item.citation),
        analysis.wageLoss?.citation
      ].filter(Boolean))
    };
  }

  if (normalized.includes('future') || normalized.includes('follow-up')) {
    return {
      answer: analysis.billing.futureItems.length
        ? [
            `The file supports ${analysis.billing.futureItems.length} future-care item${analysis.billing.futureItems.length > 1 ? 's' : ''} totaling ${analysis.billing.futureTotalDisplay}:`,
            ...analysis.billing.futureItems.map((item) => `${item.label}: ${item.amountDisplay}`)
          ].join('\n')
        : 'The current file does not strongly support a separate future-care reserve yet.',
      citations: analysis.billing.futureItems.map((item) => item.citation)
    };
  }

  if (normalized.includes('provider') || normalized.includes('treat')) {
    return {
      answer: analysis.providerJourney
        .map((provider) => `${provider.name} (${provider.role}) handled ${provider.documentCount} record${provider.documentCount > 1 ? 's' : ''} across ${provider.dateRange}.`)
        .join('\n'),
      citations: unique(analysis.providerJourney.flatMap((provider) => provider.citations)).slice(0, 6)
    };
  }

  if (normalized.includes('missing') || normalized.includes('gap') || normalized.includes('risk')) {
    return {
      answer: analysis.issues
        .map((issue) => `${issue.title}: ${issue.explanation}`)
        .join('\n'),
      citations: unique(analysis.issues.flatMap((issue) => issue.citations))
    };
  }

  if (normalized.includes('injur') || normalized.includes('diagnos')) {
    return {
      answer: `The main tracked injuries are ${analysis.injuries.slice(0, 6).join(', ')}. The strongest objective support appears in the specialist and MRI records when available.`,
      citations: unique(analysis.documents
        .filter((document) => ['Orthopedic Consult', 'MRI Report'].includes(document.typeLabel))
        .map((document) => document.citation))
    };
  }

  if (normalized.includes('liability') || normalized.includes('fault') || normalized.includes('notice')) {
    const row = analysis.coverage.find((item) => item.label === 'Liability');

    return {
      answer: row?.summary ?? 'Liability support is still developing from the current file.',
      citations: row?.citations ?? []
    };
  }

  const matches = searchDocuments(question, rawDocuments);

  if (matches.length === 0) {
    return {
      answer: 'No strong document match was found in the sample file. Try asking about damages, future care, providers, missing support, or liability.',
      citations: []
    };
  }

  const snippets = matches
    .map((match) => `${match.title}: ${match.text}`)
    .join(' ');

  return {
    answer: snippets,
    citations: matches.map((match) => match.citation)
  };
}
