const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../scripts/LM studio/analyse-courriers-weda-LMstudio-avec-ATCD.user.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const end = source.indexOf('\n  }', match.index);
  assert.ok(end > match.index, name);
  return source.slice(match.index, end + 4);
}

function load(names, globals = {}) {
  return vm.runInNewContext(`${names.map(fn).join('\n')}\n({${names.join(',')}})`, globals);
}

test('un PDF avec titre mémorisé est reconnu uniquement pour la bonne ligne et la bonne URL', () => {
  const url = 'https://secure.weda.fr/BinaryData?document=1';
  const urlKey = 'pdfurl-test';
  const row = { key: 'ligne-1', stableKey: 'stable-1', identityLabel: 'courrier 1', row: {} };
  const entry = {
    title: 'Compte rendu de consultation', rowKey: row.key, rowStableKey: row.stableKey,
    rowIdentity: row.identityLabel, urlKey, pdfUrlHash: 'hash-pdf', sourceType: 'pdf',
  };
  let stored = entry;
  const api = load([
    'isStrongWedaDocumentMemoryKey', 'isRememberedEntryMatchedByStrongDocumentKey',
    'isRememberedDocumentEntryCompatibleWithRow', 'getReusableRememberedTitleForDisplayedPdf',
  ], {
    UNUSABLE_PDF_TITLE: 'PDF sans texte exploitable - analyse manuelle/OCR nécessaire.',
    getPdfUrlKey: () => urlKey,
    hashString: () => 'hash-pdf',
    normalizeForCompare: value => String(value || '').toLowerCase(),
    getRememberedTitleForKeys: keys => ({ key: keys[0], keys, title: stored && stored.title || '', entry: stored }),
  });
  const displayed = { pdfUrl: url, urlKey, selectedOk: true };

  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, displayed)?.title, entry.title);
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, { ...displayed, selectedOk: false }), null);
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf({ ...row, stableKey: 'autre' }, displayed), null);
  stored = { ...entry, patientSelectionAutoRestoreBlocked: true };
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, displayed), null);
  stored = { ...entry, sourceType: 'pdf-unusable-text' };
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, displayed), null);
  stored = { ...entry, pdfUrlHash: 'autre-pdf' };
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, displayed), null);
  stored = { ...entry, rowKey: '', rowStableKey: '', rowIdentity: '' };
  assert.equal(api.getReusableRememberedTitleForDisplayedPdf(row, displayed), null);
});

test('le titre mémorisé interrompt la lecture du PDF avant extraction du texte', async () => {
  const remembered = { title: 'Compte rendu', entry: { contentKey: 'pdftext-1' } };
  const api = load(['waitForDisplayedBiology'], {
    PDF_PERFORMANCE_FALLBACK_SETTLE_MS: 1800,
    PDF_DISPLAY_WAIT_MS: 15000,
    getCurrentPerformanceTime: () => 1000,
    getElapsedPerformanceMs: () => 0,
    abortIfWorkflowStopped: () => {},
    waitFor: async predicate => predicate(),
    getDisplayedPdfUrl: () => 'https://secure.weda.fr/BinaryData?document=1',
    hashString: () => 'test',
    getSelectedBiologyIndex: () => 0,
    getReusableRememberedTitleForDisplayedPdf: () => remembered,
    extractDisplayedPdfTextWithRetry: () => assert.fail('PDF extrait malgré le titre mémorisé'),
    setPanelStatus: () => assert.fail('extraction lancée'),
  });
  const result = await api.waitForDisplayedBiology({ index: 0, row: { classList: { contains: () => true } } }, '', {
    skipRememberedTitle: true,
  });
  assert.equal(result.rememberedTitleEntry, remembered);
  assert.equal(result.displayed.urlKey, 'pdfurl-test');
});

test('un PDF mémorisé passe à la pièce jointe ou au courrier suivant sans lancer LM Studio', () => {
  const row = { index: 2, key: 'ligne-2', stableKey: 'stable-2' };
  const displayed = { pdfUrl: 'https://secure.weda.fr/BinaryData?document=2', urlKey: 'pdfurl-2' };
  const remembered = { key: displayed.urlKey, keys: [displayed.urlKey], title: 'Titre connu', entry: { contentKey: 'pdftext-2' } };
  let state = {};
  let advancedJob = '';
  const api = load(['advancePastRememberedPdf'], {
    isCurrentRowWorkflowActive: () => true,
    createId: () => 'courrier-memorise-test',
    getPdfUrlKey: () => displayed.urlKey,
    touchRememberedTitleKeys: () => {},
    appendDebugLog: () => {},
    setState: patch => { state = { ...state, ...patch }; },
    goToNextBiology: jobId => { advancedJob = jobId; },
  });
  assert.equal(api.advancePastRememberedPdf(row, displayed, remembered), true);
  assert.equal(state.phase, 'savingTitle');
  assert.equal(state.currentUrlKey, displayed.urlKey);
  assert.equal(advancedJob, state.currentJobId);
});

test('une autre pièce jointe non mémorisée reste à analyser', () => {
  let state = {
    running: true, mode: 'manual', phase: 'savingTitle', currentJobId: 'memo-1',
    currentIndex: 0, currentRowKey: 'ligne-0', currentStableKey: 'stable-0',
    currentUrlKey: 'pdfurl-1', currentContentKey: 'pdftext-1',
    currentAttachmentProcessedUrlKeys: [],
  };
  let queued = false;
  const api = load(['goToNextBiology'], {
    getState: () => state,
    appendProcessedAttachmentUrlKey: (keys, key) => [...keys, key],
    getCurrentAttachmentProcessedUrlKeys: () => state.currentAttachmentProcessedUrlKeys,
    findNextDisplayedPdfAttachment: () => ({ pdfUrl: 'https://secure.weda.fr/BinaryData?document=2', urlKey: 'pdfurl-2', remainingCount: 1 }),
    appendDebugLog: () => {},
    setState: patch => { state = { ...state, ...patch }; },
    scheduleBackgroundTask: callback => { queued = typeof callback === 'function'; },
    markRowSeen: () => assert.fail('courrier marqué traité avant la seconde pièce jointe'),
  });
  api.goToNextBiology('memo-1');
  assert.equal(state.phase, 'clickedRow');
  assert.equal(state.currentUrlKey, 'pdfurl-2');
  assert.deepEqual(Array.from(state.currentAttachmentProcessedUrlKeys), ['pdfurl-1']);
  assert.equal(queued, true);
});

test('si le PDF déjà affiché a un titre en mémoire, le script évite aussi la préparation de l’import', async () => {
  const row = { index: 0, key: 'ligne-0', stableKey: 'stable-0', row: { classList: { contains: () => true } } };
  const state = { running: true, phase: 'clickedRow', currentIndex: 0, currentStableKey: row.stableKey, previousContentKey: '' };
  let skipped = false;
  const api = load(['extractAndSendCurrentBiology'], {
    getState: () => state,
    getBiologyRows: () => [row],
    getCurrentWorkflowRow: () => row,
    appendDebugLog: () => {},
    isWorkflowStopped: () => false,
    setPanelStatus: () => {},
    isCurrentRowWorkflowActive: () => true,
    getCurrentAttachmentProcessedUrlKeys: () => [],
    getDisplayedPdfUrl: () => 'https://secure.weda.fr/BinaryData?document=1',
    getPdfUrlKey: () => 'pdfurl-1',
    getReusableRememberedTitleForDisplayedPdf: () => ({ title: 'Titre connu' }),
    advancePastRememberedPdf: () => { skipped = true; return true; },
    prepareImportBeforePdfWait: () => assert.fail('import préparé pour un PDF déjà analysé'),
    waitForDisplayedBiology: () => assert.fail('PDF relu'),
  });
  await api.extractAndSendCurrentBiology();
  assert.equal(skipped, true);
});
