const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "LM studio",
  "analyse-courriers-weda-LMstudio-avec-ATCD.user.js"
);
const source = fs.readFileSync(scriptPath, "utf8");

function getFunctionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `fonction ${name} introuvable`);
  assert.notEqual(end, -1, `borne ${nextName} introuvable`);
  return source.slice(start, end);
}

test("utilise le onchange WEDA avant le postback direct de secours", () => {
  const body = getFunctionSource(
    "triggerWedaFindPatientModePostBack",
    "waitForWedaFindPatientPostBackIdle"
  );

  assert.ok(body.indexOf('new Event("change"') < body.indexOf("callWedaPostBack"));
  assert.match(body, /return "change-event"/);
  assert.match(body, /return "direct-postback-fallback"/);
});

test("attend un tableau patient rafraîchi avant de scorer les résultats", () => {
  const body = getFunctionSource(
    "waitForWedaFindPatientSearchSelection",
    "pruneWedaFindPatientRescueAttemptKeys"
  );

  assert.match(body, /previousGrid/);
  assert.match(body, /grid !== previousGrid/);
  assert.match(body, /WEDA_FIND_PATIENT_STALE_RESULT_GUARD_MS/);
  assert.match(body, /WEDA_FIND_PATIENT_RESULT_COUNT_SELECTOR/);
  assert.match(body, /explicitZero/);
});

test("n'utilise pas le champ prénom lorsque WEDA affiche encore l'ancien mode", () => {
  const body = getFunctionSource(
    "findWedaFindPatientSearchUiReadyForMode",
    "isWedaAsyncPostBackActive"
  );
  const nameInput = { id: "name" };
  const select = { value: "Nom", options: [{ value: "Nom" }] };
  let buttonTitle = "Recherche par prénom et prénoms de naissance";
  const ready = new Function("select", "nameInput", "getTitle", `
    const WEDA_FIND_PATIENT_BIRTH_DATE_MODE_VALUE = "Naissance";
    const findWedaFindPatientModeSelect = () => select;
    const findWedaFindPatientModeOption = (current, mode) => current.options.find(option => option.value === mode);
    const findWedaFindPatientSearchButton = () => ({ getAttribute: key => key === "title" ? getTitle() : "" });
    const normalizeForCompare = value => String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
    const document = { querySelector: selector => selector.endsWith("TextBoxRecherche") ? nameInput : null };
    const isElementVisible = () => true;
    ${body}
    return findWedaFindPatientSearchUiReadyForMode;
  `)(select, nameInput, () => buttonTitle);

  assert.equal(ready("Nom"), null);
  buttonTitle = "Recherche par noms, prénoms, nom de naissance";
  assert.equal(ready("Nom"), nameInput);
  select.value = "Prenom";
  assert.equal(ready("Nom"), null);
});

test("reconnaît rapidement zéro résultat explicite sans tableau patient", async () => {
  const body = getFunctionSource(
    "waitForWedaFindPatientSearchSelection",
    "pruneWedaFindPatientRescueAttemptKeys"
  );
  const previousCount = { textContent: "8" };
  const newCount = { textContent: "0" };
  let polls = 0;
  const waitForSelection = new Function("previousCount", "newCount", "onPoll", `
    const WEDA_FIND_PATIENT_SEARCH_SETTLE_MS = 0;
    const WEDA_FIND_PATIENT_STALE_RESULT_GUARD_MS = 3500;
    const WEDA_FIND_PATIENT_RESULT_WAIT_MS = 9000;
    const WEDA_FIND_PATIENT_GRID_SELECTOR = "grid";
    const WEDA_FIND_PATIENT_RESULT_COUNT_SELECTOR = "count";
    const document = { querySelector: selector => selector === "count" ? newCount : null };
    const normalizeText = value => String(value || "").trim();
    const isWedaAsyncPostBackActive = () => false;
    const collectWedaFindPatientGridCandidates = () => [];
    const resolveWedaFindPatientGridSelection = () => ({ reason: "missing-results", candidateCount: 0, link: null });
    const waitFor = async predicate => { onPoll(); const result = predicate(); if (!result) throw new Error("attente inutile"); return result; };
    ${body.replace(/^function/, "async function")}
    return waitForWedaFindPatientSearchSelection;
  `)(previousCount, newCount, () => { polls += 1; });

  const result = await waitForSelection({}, {}, null, previousCount, "8");
  assert.equal(result.reason, "missing-results");
  assert.equal(polls, 1);
});

test("n'accepte pas un ancien compteur zéro avant le rafraîchissement WEDA", async () => {
  const body = getFunctionSource(
    "waitForWedaFindPatientSearchSelection",
    "pruneWedaFindPatientRescueAttemptKeys"
  );
  const count = { textContent: "0" };
  const waitForSelection = new Function("count", `
    let now = 1000;
    const Date = { now: () => now };
    const WEDA_FIND_PATIENT_SEARCH_SETTLE_MS = 0;
    const WEDA_FIND_PATIENT_STALE_RESULT_GUARD_MS = 3500;
    const WEDA_FIND_PATIENT_RESULT_WAIT_MS = 9000;
    const WEDA_FIND_PATIENT_GRID_SELECTOR = "grid";
    const WEDA_FIND_PATIENT_RESULT_COUNT_SELECTOR = "count";
    const document = { querySelector: selector => selector === "count" ? count : null };
    const normalizeText = value => String(value || "").trim();
    const isWedaAsyncPostBackActive = () => false;
    const collectWedaFindPatientGridCandidates = () => [];
    const resolveWedaFindPatientGridSelection = () => ({ reason: "missing-results", link: null });
    const waitFor = async predicate => {
      if (predicate() !== null) throw new Error("résultat ancien accepté trop tôt");
      now += 3600;
      return predicate();
    };
    ${body.replace(/^function/, "async function")}
    return waitForWedaFindPatientSearchSelection;
  `)(count);

  const result = await waitForSelection({}, {}, null, count, "0");
  assert.equal(result.reason, "missing-results");
});

test("reconnaît l'identifiant actuel du lien patient WEDA", () => {
  const body = getFunctionSource(
    "buildWedaFindPatientGridCandidate",
    "resolveWedaFindPatientGridSelection"
  );

  assert.match(body, /LinkButtonPatientGetNomPrenom/);
});

test("accepte un prénom composé raccourci seulement avec nom et naissance concordants", () => {
  const body = getFunctionSource(
    "scoreWedaFindPatientGridCandidate",
    "buildWedaFindPatientIssue"
  );

  const scoreCandidate = new Function(`
    const uniqueStrings = (values) => Array.from(new Set((values || []).filter(Boolean)));
    const normalizePatientCompareText = (value) => {
      const text = String(value || "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
      return text ? \` \${text} \` : " ";
    };
    const parsePatientImportName = () => ({ familyName: "", givenName: "" });
    ${body}
    return scoreWedaFindPatientGridCandidate;
  `)();

  const result = scoreCandidate({
    patientLabel: "DUPONT JEAN",
    birthDate: "01/02/1950",
    nameParts: { familyName: "DUPONT JEAN", givenName: "" },
  }, {
    familyName: "DUPONT",
    givenName: "JEAN-LUC",
    searchLabel: "DUPONT JEAN-LUC",
    birthDate: "01/02/1950",
  });

  assert.equal(result.birthDateMatch, true);
  assert.equal(result.strongNameMatch, true);
  assert.ok(result.value >= 1820);
});

test("recherche d'abord par nom de famille puis essaie le nom alternatif avant la naissance", () => {
  const body = getFunctionSource(
    "rescueWedaFindPatientPanelWithDocumentIdentity",
    "searchWedaFindPatientByAlternateFamilyNames"
  );

  assert.match(body, /getWedaFindPatientFamilySearchLabels\(identity\)/);
  assert.match(body, /initialSearchLabel = familySearchLabels\[0\]/);
  assert.ok(
    body.indexOf("searchWedaFindPatientByAlternateFamilyNames") <
      body.indexOf("searchWedaFindPatientByBirthDate")
  );
});

test("conserve les noms d'usage et de naissance comme recherches possibles", () => {
  const normalizeBody = getFunctionSource(
    "normalizeWedaFindPatientIdentity",
    "cleanWedaFindPatientNamePart"
  );
  const cleanBody = getFunctionSource(
    "cleanWedaFindPatientNamePart",
    "hasUsableWedaFindPatientIdentity"
  );
  const labelsBody = getFunctionSource(
    "getWedaFindPatientFamilySearchLabels",
    "hasExplicitWedaFindPatientIdentitySource"
  );
  const normalizeIdentity = new Function(`
    const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const uniqueStrings = (values) => Array.from(new Set((values || []).map(normalizeText).filter(Boolean)));
    const parsePatientImportName = () => ({ familyName: "", givenName: "" });
    const normalizePatientBirthDate = (value) => String(value || "");
    ${cleanBody}
    ${normalizeBody}
    return normalizeWedaFindPatientIdentity;
  `)();
  const getLabels = new Function(`
    const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const uniqueStrings = (values) => Array.from(new Set((values || []).map(normalizeText).filter(Boolean)));
    ${cleanBody}
    ${labelsBody}
    return getWedaFindPatientFamilySearchLabels;
  `)();

  const identity = normalizeIdentity({
    familyName: "DUPONT",
    usageName: "DUPONT",
    birthName: "MARTIN",
    givenName: "Alice",
  });

  assert.deepEqual(identity.familyNames, ["DUPONT", "MARTIN"]);
  assert.deepEqual(getLabels(identity), ["DUPONT", "MARTIN"]);
});

test("extrait séparément nom d'usage et nom de naissance dans un en-tête en colonnes", () => {
  const body = getFunctionSource(
    "extractWedaFindPatientIdentityHeuristically",
    "requestLmStudioPatientIdentity"
  ).replace(/\s+async\s*$/, "");
  const extractIdentity = new Function(`
    const normalizeMultilineText = (value) => String(value || "");
    const extractLikelyPatientIdentitySourceText = (value) => value;
    const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const extractPatientBirthDateHints = () => ["01/02/1950"];
    const normalizeWedaFindPatientIdentity = (identity) => identity;
    const hasUsableWedaFindPatientIdentity = (identity) => Boolean(identity.familyName && identity.givenName);
    const parsePatientImportName = () => ({ familyName: "", givenName: "" });
    ${body}
    return extractWedaFindPatientIdentityHeuristically;
  `)();

  const identity = extractIdentity(
    "Nom d'usage : DUPONT  Prénom : Alice  Nom de naissance : MARTIN  N° de dossier : 42  Date de naissance : 01/02/1950"
  );

  assert.equal(identity.familyName, "DUPONT");
  assert.equal(identity.usageName, "DUPONT");
  assert.equal(identity.birthName, "MARTIN");
  assert.equal(identity.givenName, "Alice");
});

test("score aussi un patient avec le nom de naissance alternatif", () => {
  const body = getFunctionSource(
    "scoreWedaFindPatientGridCandidate",
    "buildWedaFindPatientIssue"
  );
  const scoreCandidate = new Function(`
    const uniqueStrings = (values) => Array.from(new Set((values || []).filter(Boolean)));
    const normalizePatientCompareText = (value) => {
      const text = String(value || "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
      return text ? \` \${text} \` : " ";
    };
    const parsePatientImportName = () => ({ familyName: "MARTIN", givenName: "ALICE" });
    ${body}
    return scoreWedaFindPatientGridCandidate;
  `)();

  const result = scoreCandidate({
    patientLabel: "MARTIN ALICE",
    birthDate: "",
    nameParts: { familyName: "MARTIN", givenName: "ALICE" },
  }, {
    familyName: "DUPONT",
    familyNames: ["DUPONT", "MARTIN"],
    givenName: "ALICE",
    searchLabel: "DUPONT ALICE",
    birthDate: "",
  });

  assert.equal(result.strongNameMatch, true);
  assert.ok(result.value >= 650);
});

test("gère aussi la grille patient WEDA actuelle et attend la fin du postback", () => {
  assert.match(source, /FindPatientUcForm1_PatientsGrid\"/);
  assert.match(source, /LinkButtonPatienDateNaissance/);
  assert.match(source, /LinkButtonPatientNomJeuneFille/);

  const body = getFunctionSource(
    "waitForWedaFindPatientSelectionApplied",
    "waitForOptionalTitleInput"
  );
  assert.match(body, /waitForWedaFindPatientPostBackIdle\(12000\)/);
  assert.match(body, /weda:find-patient-title-missing-after-selection/);
});

test("n'émet qu'un seul clic sur les contrôles WEDA", () => {
  const body = getFunctionSource(
    "clickButtonLikeUser",
    "extractHeidiAnswerFromAskContent"
  );

  assert.doesNotMatch(body, /\["mousedown", "mouseup", "click"\]/);
  assert.equal((body.match(/button\.click\(\)/g) || []).length, 1);
});

test("remet les échecs de recherche patient en attente automatique", () => {
  const body = getFunctionSource(
    "skipOrFailCurrentDocument",
    "isStructuredHprimTableText"
  );

  assert.match(body, /isRetryableWedaDocumentFailure\(message\)/);
  assert.match(body, /unmarkRowSeen\(currentRowKey\)/);
  assert.match(body, /Courrier conservé pour un nouvel essai au prochain cycle/);
  assert.match(body, /remainingAutoTargetKeys/);
});

test("retente aussi une sélection patient sans apparition du titre", () => {
  const body = getFunctionSource(
    "isRetryableWedaDocumentFailure",
    "releaseRetryablePatientFailuresFromSeenRows"
  );

  assert.match(body, /champ titre indisponible apres ouverture un patient/);
});

test("libère aussi les anciens échecs encore présents dans le journal", () => {
  const body = getFunctionSource(
    "releaseRetryablePatientFailuresFromSeenRows",
    "saveSeenRowMap"
  );

  assert.match(body, /DEBUG_LOG_KEY/);
  assert.match(body, /weda:skip-\(\?:auto\|manual\)-document/);
  assert.match(body, /unmarkRowSeen\(rowKey\)/);
});
