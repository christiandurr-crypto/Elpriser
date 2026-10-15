// Vagthund: holder oeje med aendringer i prisdata, som beregningen ikke selv kan tage stilling til.
// Opretter et GitHub-issue (= mail til dig) naar:
//   1. Et netselskab eller Energinet laegger en kWh-post ud med et navn, vi ikke har set foer.
//   2. Nettarif eller Energinet-post mangler for en af de kommende dage (inden for HORISONT).
//   3. En netselskabsrabat ophoerer inden for HORISONT.
// Kendte postnavne gemmes i data/vagthund.json. Foerste koersel registrerer alt stille.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HORISONT = 14; // dage frem

function postLinje(r) {
  const priser = [];
  for (let h = 1; h <= 24; h++) if (r["Price" + h] != null) priser.push(r["Price" + h]);
  const trin = [...new Set(priser)].sort((a, b) => a - b).map((p) => (p * 100).toFixed(2).replace(".", ","));
  return `- **${r.Note}** (kode ${r.ChargeTypeCode})\n  - ${r.Description || "ingen beskrivelse"}\n  - Gyldig ${r.ValidFrom.slice(0, 10)} til ${r.ValidTo ? r.ValidTo.slice(0, 10) : "ingen slutdato"}\n  - Pris: ${trin.join(" / ")} øre/kWh ekskl. moms`;
}

export async function vagthund({ B, config, records, iDag, dataDir }) {
  const fil = path.join(dataDir, "vagthund.json");
  let tilstand = null;
  try { tilstand = JSON.parse(await readFile(fil, "utf8")); } catch {}
  const foersteGang = !tilstand;
  tilstand ||= { kendte: {}, rapporteret: {} };

  // Hvem ejer hvilket GLN (151 og 245 hos Konstant regnes som samme selskab)
  const ejer = { [config.energinet.gln]: "Energinet" };
  config.adresser.forEach((a) => a.gln.forEach((g) => (ejer[g] = a.net)));

  const fund = []; // { noegle, titel, tekst }

  // 1) Nye postnavne, der gaelder nu eller i fremtiden
  const nye = {};
  for (const r of records) {
    if (r.ChargeType && r.ChargeType !== "D03") continue;
    if (!ejer[r.GLN_Number]) continue;
    if (r.ValidTo && r.ValidTo.slice(0, 10) <= iDag) continue;
    const k = ejer[r.GLN_Number] + "|" + r.Note;
    if (tilstand.kendte[k]) continue;
    (nye[ejer[r.GLN_Number]] ||= new Map()).set(r.Note, r);
  }
  const registrer = (selskab, noter) => noter.forEach((n) => (tilstand.kendte[selskab + "|" + n] = iDag));
  if (foersteGang) {
    for (const [selskab, m] of Object.entries(nye)) registrer(selskab, [...m.keys()]);
  } else {
    for (const [selskab, m] of Object.entries(nye)) {
      const poster = [...m.values()];
      fund.push({
        noegle: `ny|${selskab}|${poster.map((p) => p.Note).join("|")}`,
        efter: () => registrer(selskab, poster.map((p) => p.Note)),
        titel: `[Vagthund] ${poster.length === 1 ? "Ny prispost" : poster.length + " nye prisposter"} hos ${selskab}`,
        tekst:
          `Der er dukket ${poster.length === 1 ? "en kWh-post" : "kWh-poster"} op hos **${selskab}**, som ikke er set før:\n\n` +
          poster.map(postLinje).join("\n") +
          `\n\n**Gælder den jer?** De fleste poster er for erhverv, solcelle-producenter eller andre tarifgrupper. ` +
          `Den er kun relevant, hvis den gælder almindelige husstande (C-kunder, 0,4 kV). ` +
          `Er den relevant, skal den med i \`config.json\`. Sammenlign evt. med prisen i Altid Energis app.\n\n` +
          `Luk issuet, når du har taget stilling.`
      });
    }
  }

  // 2) og 3) Kig frem
  const nu = B.tarifStatus(records, config, iDag);
  const mangler = {}, rabatStop = {};
  for (let i = 1; i <= HORISONT; i++) {
    const d = B.plusDage(iDag, i);
    const st = B.tarifStatus(records, config, d);
    st.mangler.forEach((m) => { if (!mangler[m]) mangler[m] = d; });
    config.adresser.forEach((a) => { if (nu.rabat[a.id] && !st.rabat[a.id] && !rabatStop[a.id]) rabatStop[a.id] = d; });
  }
  for (const [hvad, d] of Object.entries(mangler)) {
    fund.push({
      noegle: `mangler|${hvad}|${d}`,
      titel: `[Vagthund] ${hvad} mangler fra ${d}`,
      tekst: `Der er ikke offentliggjort nogen **${hvad}** for ${d}. Fra den dato kan siden ikke regne prisen ud og viser "Mangler prisdata".\n\n` +
        `Ofte bliver den nye sats bare lagt ud sent. Hvis den stadig mangler et par dage før, har posten sandsynligvis skiftet navn, og så skal \`config.json\` rettes.`
    });
  }
  for (const [id, d] of Object.entries(rabatStop)) {
    const a = config.adresser.find((x) => x.id === id);
    fund.push({
      noegle: `rabatstop|${id}|${d}`,
      titel: `[Vagthund] Rabat fra ${a.net} (${a.navn}) ophører ${d}`,
      tekst: `Der er ingen rabat fra **${a.net}** fra ${d}, som matcher mønsteret \`${a.rabat.moenster}\` i \`config.json\`.\n\n` +
        `Det kan være rigtigt (rabatten stopper) eller fordi den har fået et nyt navn. Hvis der samtidig er et issue om en ny prispost hos ${a.net}, er det sandsynligvis det sidste.`
    });
  }

  // Opret issues for nye fund
  const nyeFund = fund.filter((f) => !tilstand.rapporteret[f.noegle]);
  for (const f of nyeFund) {
    const ok = await opretIssue(f);
    if (ok) { tilstand.rapporteret[f.noegle] = iDag; if (f.efter) f.efter(); }
  }
  // Glem gamle rapporter efter et aar
  const graense = B.plusDage(iDag, -366);
  for (const [k, d] of Object.entries(tilstand.rapporteret)) if (d < graense) delete tilstand.rapporteret[k];

  await writeFile(fil, JSON.stringify(tilstand, null, 1) + "\n");
  console.log(foersteGang
    ? `Vagthund: første kørsel - registrerede ${Object.keys(tilstand.kendte).length} kendte postnavne.`
    : `Vagthund: ${fund.length} fund, ${nyeFund.length} nye.`);
}

async function opretIssue(f) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.log(`Vagthund (intet GitHub-token, issue oprettes ikke):\n  ${f.titel}\n  ${f.tekst.split("\n").join("\n  ")}`);
    return !!process.env.FIXTURE_DIR;   // i test regnes det som sendt
  }
  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "elpris-vagthund" },
    body: JSON.stringify({ title: f.titel, body: f.tekst })
  });
  if (!r.ok) { console.log(`Vagthund: kunne ikke oprette issue (${r.status}): ${await r.text()}`); return false; }
  console.log(`Vagthund: oprettede issue "${f.titel}"`);
  return true;
}
