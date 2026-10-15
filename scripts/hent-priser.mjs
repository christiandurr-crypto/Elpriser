// Henter spotpriser og tariffer fra Energi Data Service og gemmer dem i data/.
// Koeres af GitHub Actions (se .github/workflows/hent-priser.yml). Ingen afhaengigheder - kraever Node 20+.
//
// Miljoevariabler:
//   BACKFILL_DAYS  hent saa mange dage bagud (standard 1). Brug fx 366 foerste gang.
//   FIXTURE_DIR    (kun test) laes spot.json og pricelist.json herfra i stedet for API'et
//   TODAY          (kun test) lad som om i dag er denne dato (YYYY-MM-DD)

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vagthund } from "./vagthund.mjs";

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(path.join(ROD, "beregn.js"));          // saetter globalThis.ElprisBeregn
const B = globalThis.ElprisBeregn;

const config = JSON.parse(await readFile(path.join(ROD, "config.json"), "utf8"));
const DATA = path.join(ROD, "data");
const HIST = path.join(DATA, "history");
await mkdir(HIST, { recursive: true });

const iDag = process.env.TODAY || B.isoIDag();
const bagud = Math.max(1, parseInt(process.env.BACKFILL_DAYS || "1", 10) || 1);
const start = B.plusDage(iDag, -bagud);
const slut = B.plusDage(iDag, 2);

async function hentJSON(url, navn) {
  if (process.env.FIXTURE_DIR) return JSON.parse(await readFile(path.join(process.env.FIXTURE_DIR, navn), "utf8"));
  for (let forsoeg = 1; ; forsoeg++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (forsoeg >= 5 || (r.status !== 429 && r.status < 500)) throw new Error(`${navn}: HTTP ${r.status}`);
    console.log(`${navn}: HTTP ${r.status}, venter og proever igen (${forsoeg}/5)`);
    await new Promise((ok) => setTimeout(ok, 15000 * forsoeg));
  }
}

const u = B.urls(config, start, slut);
console.log(`Henter ${start} til ${slut} (i dag: ${iDag})`);
const spot = await hentJSON(u.spot, "spot.json");
const priser = await hentJSON(u.priser, "pricelist.json");
// Alle netselskabs-tariffer i perioden, saa rabatter med nye navne ogsaa kommer med
const bred = await hentJSON(u.netBred(B.plusDage(start, -200)), "netbred.json").catch((e) => {
  console.log("Advarsel: kunne ikke hente alle nettariffer (" + e.message + ") - bruger kun kendte rabatnavne.");
  return { records: [] };
});
const kendte = new Set(config.adresser.flatMap((a) => (a.rabat && a.rabat.kendteNavne) || []));
const nyeRabatter = [...new Set(bred.records.filter((r) => config.adresser.some((a) => a.rabat && new RegExp(a.rabat.moenster, "i").test(r.Note)) && !kendte.has(r.Note)).map((r) => r.Note))];
if (nyeRabatter.length) console.log("Bemaerk: rabatnavne der ikke staar i config.json (bruges alligevel her, men ikke i sidens reserve-hentning): " + nyeRabatter.join(" | "));
const { dage, mangler } = B.byggDage(spot.records, priser.records.concat(bred.records), config);
if (mangler.length) console.log("Dage uden komplette tariffer (springes over):\n  " + mangler.join("\n  "));
console.log(`Byggede ${Object.keys(dage).length} doegn`);

// ---------- historik: én fil pr. maaned ----------
async function laesJSON(fil, standard) {
  try { return JSON.parse(await readFile(fil, "utf8")); } catch { return standard; }
}
async function skrivHvisAendret(fil, obj) {
  const ny = JSON.stringify(obj) + "\n";
  const gammel = existsSync(fil) ? await readFile(fil, "utf8") : null;
  if (gammel === ny) return false;
  await writeFile(fil, ny);
  return true;
}

const pr = {};
for (const iso of Object.keys(dage)) (pr[iso.slice(0, 7)] ||= []).push(iso);
let aendret = 0;
for (const [mdr, liste] of Object.entries(pr)) {
  const fil = path.join(HIST, `${mdr}.json`);
  const m = await laesJSON(fil, { maaned: mdr, dage: {} });
  for (const iso of liste) m.dage[iso] = dage[iso];
  m.dage = Object.fromEntries(Object.entries(m.dage).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (await skrivHvisAendret(fil, m)) aendret++;
}

// Ryd op: behold de seneste N maaneder
const graense = (() => { const d = new Date(iDag + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - (config.historikMaaneder - 1)); return d.toISOString().slice(0, 7); })();
const filer = (await readdir(HIST)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort();
for (const f of filer) {
  if (f.slice(0, 7) < graense) { await unlink(path.join(HIST, f)); console.log(`Slettede ${f} (aeldre end ${config.historikMaaneder} maaneder)`); aendret++; }
}

// Resume til historik-visningen paa siden (lille fil)
const alleDage = {};
for (const f of (await readdir(HIST)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort()) {
  Object.assign(alleDage, (await laesJSON(path.join(HIST, f), { dage: {} })).dage);
}
const resume = Object.keys(alleDage).sort().map((iso) => B.doegnResume(iso, alleDage[iso], config));
if (await skrivHvisAendret(path.join(HIST, "resume.json"), { config: { adresser: config.adresser.map(({ id, navn }) => ({ id, navn })) }, dage: resume })) aendret++;

// ---------- latest.json: det siden henter ved hver aabning ----------
const igaar = B.plusDage(iDag, -1);
const seneste = Object.fromEntries(Object.entries(alleDage).filter(([iso]) => iso >= igaar));
const latestFil = path.join(DATA, "latest.json");
const forrige = await laesJSON(latestFil, null);
const samme = forrige && JSON.stringify(forrige.dage) === JSON.stringify(seneste) && JSON.stringify(forrige.config) === JSON.stringify(config);
if (!samme) {
  await writeFile(latestFil, JSON.stringify({ genereret: new Date().toISOString(), config, dage: seneste }) + "\n");
  aendret++;
}
console.log(`${aendret} fil(er) opdateret. latest.json indeholder: ${Object.keys(seneste).join(", ")}`);

// ---------- vagthund ----------
try {
  const enBred = await hentJSON(u.energinetBred, "energinetbred.json").catch(() => ({ records: [] }));
  await vagthund({ B, config, records: priser.records.concat(bred.records, enBred.records), iDag, dataDir: DATA });
} catch (e) {
  console.log("Vagthund fejlede (priserne er gemt alligevel): " + (e.stack || e));
}

if (!seneste[iDag]) {
  console.error(`FEJL: ingen komplette priser for i dag (${iDag}).`);
  process.exit(1);
}
