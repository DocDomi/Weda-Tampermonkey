const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptsDirectory = path.join(__dirname, "..", "scripts", "LM studio");
const courrierSource = fs.readFileSync(path.join(scriptsDirectory, "analyse-courriers-weda-LMstudio-avec-ATCD.user.js"), "utf8");
const colorizerSource = fs.readFileSync(path.join(scriptsDirectory, "antecedents-cim10-weda-LMstudio-avec-colorisation.user.js"), "utf8");

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `fonction ${name} introuvable`);
  assert.notEqual(end, -1, `borne ${nextName} introuvable`);
  return source.slice(start, end);
}

test("le worker courrier demande la couleur avant la validation humaine", () => {
  const worker = functionSource(courrierSource, "runWedaAtcdWorker", "ensureWedaAtcdWorkerPatientResolved");
  const fillIndex = worker.indexOf("fillWedaAntecedentPopupForUser");
  const colorIndex = worker.indexOf("requestWedaAntecedentColorization");
  const updateIndex = worker.indexOf("updateWedaAtcdWorkerJob", colorIndex);
  assert.ok(fillIndex >= 0 && colorIndex > fillIndex && updateIndex > colorIndex);
  assert.match(worker, /colorization,/);
  assert.match(worker, /formatWedaAntecedentColorizationStatus\(colorization\)/);
  assert.doesNotMatch(worker, /validButton\.click\(/);
});

test("la colorisation du courrier est autonome et ne modifie pas le script dédié", () => {
  assert.doesNotMatch(courrierSource, /weda-helper:atcd-color-(?:request|response)/);
  assert.doesNotMatch(colorizerSource, /weda-helper:atcd-color-(?:request|response)/);
  assert.match(colorizerSource, /@version\s+6\.2\.7/);
  assert.match(colorizerSource, /VERSION_AUTO_ATCD_CIM10_LMSTUDIO = '6\.2\.7-LMstudio-avec-colorisation'/);
});

test("reprend les priorités CIM-10 rouge, violet, orange, jaune et blanc", () => {
  const decisionSource = functionSource(courrierSource, "decideWedaAntecedentColor", "applyWedaAntecedentColor").replace(/\s+async\s*$/, "");
  const context = {
    WEDA_ATCD_COLOR_TARGETS: {
      PRIO_ROUGE: { label: "Rouge", hex: "#ffcccc" },
      PRIO_VIOLET: { label: "Violet", hex: "#cc66ff" },
      PRIO_ORANGE: { label: "Orange", hex: "#ffe0b2" },
      PRIO_JAUNE: { label: "Jaune", hex: "#ffff99" },
      NO_COLOR: { label: "Blanc", hex: "#ffffff" },
    },
    normalizeCim10Code: (value) => String(value || "").toUpperCase(),
    normalizeForCompare: (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  };
  vm.createContext(context);
  vm.runInContext(`${decisionSource}\nthis.decide = decideWedaAntecedentColor;`, context);
  assert.equal(context.decide({ code: "C50.9" }).priority, "PRIO_ROUGE");
  assert.equal(context.decide({ code: "T78.2" }).priority, "PRIO_VIOLET");
  assert.equal(context.decide({ code: "E11.9" }).priority, "PRIO_ORANGE");
  assert.equal(context.decide({ code: "N40" }).priority, "PRIO_JAUNE");
  assert.equal(context.decide({ code: "J00" }).priority, "NO_COLOR");
  assert.equal(context.decide({ code: "C50.9", section: "familial", label: "Cancer du sein maternel" }).priority, "PRIO_ORANGE");
});

test("sélectionne la teinte dans la palette WEDA sans valider l'antécédent", () => {
  const application = functionSource(courrierSource, "applyWedaAntecedentColor", "parseWedaAtcdColor");
  assert.match(application, /SELECTOR_WEDA_COLOR_GRID/);
  assert.match(application, /WEDA_ATCD_COLOR_TARGETS\[priority\]/);
  assert.match(application, /wedaAtcdColorDistance/);
  assert.match(application, /clickButtonLikeUser\(chosen\.element\)/);
  assert.doesNotMatch(application, /SELECTOR_WEDA_VALID/);
});
