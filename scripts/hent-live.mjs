// Henter strømmixet "lige nu" for DK1 og gemmer det i data/live.json.
// Koeres af GitHub Actions ca. hvert 15. minut (se .github/workflows/hent-live.yml),
// saa telefonerne ikke selv skal kalde Energi Data Service.
// FIXTURE_DIR (kun test): laes mix.json herfra i stedet for API'et.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(path.join(ROD, "beregn.js"));
const B = globalThis.ElprisBeregn;
const config = JSON.parse(await readFile(path.join(ROD, "config.json"), "utf8"));
const u = B.urls(config, B.isoIDag(), B.isoIDag());

let j;
if (process.env.FIXTURE_DIR) {
  j = JSON.parse(await readFile(path.join(process.env.FIXTURE_DIR, "mix.json"), "utf8"));
} else {
  const r = await fetch(u.mixNu);
  if (!r.ok) { console.error(`Energi Data Service svarede ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1); }
  j = await r.json();
}
const rec = j.records && j.records[0];
if (!rec) { console.error("Ingen strømmix-data i svaret."); process.exit(1); }

await mkdir(path.join(ROD, "data"), { recursive: true });
await writeFile(path.join(ROD, "data", "live.json"), JSON.stringify({ hentet: new Date().toISOString(), mix: rec }) + "\n");
console.log(`Strømmix fra ${rec.Minutes5DK} gemt.`);
