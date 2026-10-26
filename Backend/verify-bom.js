#!/usr/bin/env node
// ==========================================================================
// verify-bom.js  —  run the parser against a BOM PDF and diff it against the
// hand-transcribed golden fixture. Exit code 0 = 100%, 1 = mismatches.
//
//   node verify-bom.js path/to/FN2798...pdf
//
// Add a fixture per format you support; this is your regression suite. Never
// change a fixture to make a test pass — change it only when the SOURCE
// DOCUMENT changes, and say so in the commit.
// ==========================================================================

const fs = require("fs");
const { extractRows } = require("./techpack-extract");
const { parseNikeBom, isNikeBom } = require("./nike-bom-parser");
const golden = require("./FN2798.golden");

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GRN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log(RED("FAIL"), label, "\n      want:", JSON.stringify(want), "\n       got:", JSON.stringify(got)); }
};

(async () => {
  const file = process.argv[2];
  if (!file) { console.error("usage: node verify-bom.js pack.pdf"); process.exit(2); }

  const pages = await extractRows(fs.readFileSync(file));
  if (!isNikeBom(pages)) { console.error(RED("Not recognised as a Nike BOM report.")); process.exit(2); }

  const out = parseNikeBom(pages);
  const inv = golden.invariants;

  // ---- structural invariants ---------------------------------------------
  check("page count", pages.length, inv.pageCount);
  check("colorway count", out.colorways.length, inv.colorwayCount);
  check("material line count", out.materials.length, inv.materialLineCount);
  check("fabric lines", out.fabrics.map((m) => m.lineNo).sort((a, b) => a - b), inv.fabricLines);
  check("garment trim lines", out.garmentTrims.map((m) => m.lineNo).sort((a, b) => a - b), inv.garmentTrimLines);
  check("packing trim lines", out.packingTrims.map((m) => m.lineNo).sort((a, b) => a - b), inv.packingTrimLines);
  check("statement lines", out.statements.map((m) => m.lineNo).sort((a, b) => a - b), inv.statementLines);

  // duplicate IM#s survive as separate lines
  for (const [im, lines] of Object.entries(inv.duplicateIms)) {
    check(`IM#${im} kept on both lines`,
      out.materials.filter((m) => m.im === im).map((m) => m.lineNo).sort((a, b) => a - b), lines);
  }

  // ---- header -------------------------------------------------------------
  for (const [k, v] of Object.entries(golden.header)) check(`header.${k}`, out.header[k], v);

  // ---- colorway header block ---------------------------------------------
  check("colorway order", out.colorways.map((c) => c.code), golden.CW);
  for (const want of golden.colorways) {
    const got = out.colorways.find((c) => c.code === want.code);
    if (!got) { fail++; console.log(RED("FAIL"), `colorway ${want.code} missing`); continue; }
    if (want.unverified) { console.log(DIM(`  skip  colorway ${want.code} — fixture unverified, confirm against the page`)); continue; }
    for (const k of ["flag", "prmry", "scndy", "prodId", "prodOfrgId", "plugCwCd"]) {
      if (want[k] !== undefined) check(`cw ${want.code}.${k}`, got[k] || null, want[k]);
    }
  }

  // ---- the matrix: every material x every colorway ------------------------
  const line = (n) => out.materials.find((m) => m.lineNo === n);
  let cells = 0;
  for (const g of golden.materials) {
    const m = line(g.lineNo);
    if (!m) { fail++; console.log(RED("FAIL"), `line ${g.lineNo} missing`); continue; }
    check(`line ${g.lineNo} IM#`, m.im, g.im);
    check(`line ${g.lineNo} bucket`, m.bucket, g.bucket);
    if (g.use !== undefined) check(`line ${g.lineNo} use`, m.use, g.use);
    if (g.uom !== undefined) check(`line ${g.lineNo} uom`, m.uom, g.uom);
    if (g.qty !== undefined) check(`line ${g.lineNo} qty`, m.qty, g.qty);
    for (const k of ["weightGsm", "widthCm", "heightMm", "widthMm", "colors", "content"]) {
      if (g[k] !== undefined) check(`line ${g.lineNo} ${k}`, m.attrs[k], g[k]);
    }

    let want = g.byColorway;
    if (want === "SAME_AS_LINE_2") want = golden.materials.find((x) => x.lineNo === 2).byColorway;
    if (want === "SAME_AS_LINE_3") want = golden.materials.find((x) => x.lineNo === 3).byColorway;
    for (const cw of golden.CW) {
      cells++;
      const cell = m.byColorway[cw];
      check(`line ${g.lineNo} x cw${cw}`, cell ? cell.raw : null, want[cw]);
    }
  }

  // ---- business rules -----------------------------------------------------
  const bodyFabrics = out.fabrics.filter((f) => /BODY/i.test(f.use));
  for (const cw of inv.oneBodyFabricPerColorway) {
    check(`cw${cw} has exactly 1 body fabric`,
      bodyFabrics.filter((f) => f.byColorway[cw]).length, 1);
  }
  if (inv.fabricQtyAlwaysBlank) {
    check("no fabric carries a consumption figure", out.fabrics.every((f) => !f.qty), true);
  }

  console.log(`\n${cells} matrix cells checked`);
  console.log(fail === 0 ? GRN(`ALL ${pass} ASSERTIONS PASS`) : RED(`${fail} FAILED, ${pass} passed`));
  if (out.warnings.length) {
    console.log(DIM("\nwarnings:"));
    out.warnings.forEach((w) => console.log(DIM("  - " + w)));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });