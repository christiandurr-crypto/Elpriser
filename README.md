# Elpris: Hadsten og Ebeltoft

En lille web-app, der viser elprisen time for time på begge adresser. Den finder det billigste tidspunkt til vask, opvask og opladning af bil og gemmer priserne i et år.

## Sådan virker det

- **GitHub Actions** henter priser fra Energi Data Service fem gange om dagen og gemmer dem i `data/` i repoet.
  - `data/latest.json`: i går, i dag og i morgen. Telefonen henter denne fil.
  - `data/history/ÅÅÅÅ-MM.json`: én fil pr. måned med timepriser, kvarterpriser og tariffer. De seneste 13 måneder gemmes.
  - `data/history/resume.json`: et lille dagsresumé til historik-visningen.
- **Telefonen** viser de senest gemte priser med det samme, også uden net, og henter nye i baggrunden.
- **Reserve:** Mangler dagens priser, eller er morgendagens ikke kommet kl. 14.30, henter siden selv direkte fra Energi Data Service.

## Opsætning (ca. 10 min)

1. Opret et nyt **public** repo på github.com, fx `elpris`. Gratis Pages kræver et public repo på en gratis konto.
2. Upload filerne: vælg **Add file → Upload files** og træk alt fra denne mappe ind.
   - **Pas på med `.github`-mappen.** Den er skjult på Mac, så den kommer ikke med, hvis du markerer filerne i Finder. Tryk **Cmd + Shift + .** i Finder for at vise skjulte filer, før du trækker.
   - Du kan også oprette den bagefter: vælg **Add file → Create new file**, skriv navnet `.github/workflows/hent-priser.yml` og indsæt indholdet af filen.
3. Gå til **Settings → Pages**. Vælg **Source: Deploy from a branch**, **Branch: main / (root)** og tryk **Save**.
4. Gå til **Actions → Hent elpriser → Run workflow**. Skriv `366` i feltet og tryk **Run workflow**. Det henter et års historik med det samme. Data fra Energi Data Service går kun tilbage til 1. okt. 2025 i det nuværende format.
5. Efter et par minutter ligger siden på `https://<dit-brugernavn>.github.io/elpris/`.

Fejler en automatisk hentning, sender GitHub som standard en mail til dig.

## På iPhone som en app

1. Åbn adressen i **Safari**.
2. Tryk på Del-knappen og vælg **Føj til hjemmeskærm**.

Valgt adresse, tillæg og moms gemmes på hver telefon for sig. Tillægget kommer fra `config.json` (Altid Energi: 0 øre), så der skal ikke indtastes noget.

## Strømmix og CO2

- **Bedste tidspunkt** viser den billigste og den grønneste start for den valgte varighed. Begge blokke er markeret i prisgrafen (blå = billigst, grøn = grønnest).
- CO2 pr. time kommer fra Energinet (målt, og ellers prognose) og gemmes af den automatiske hentning i `co2` for hvert døgn.
- **Strømmix lige nu** (vind, sol, værker, import og eksport i Vestdanmark) hentes af workflowet **Hent strømmix** (`.github/workflows/hent-live.yml`) ca. hvert 15. minut og gemmes i `data/live.json`. Telefonen henter kun den fil, så tallene er typisk 15-30 minutter gamle. "CO2 denne time" kommer fra de gemte timedata. Linjen "Tal fra kl. … · om tallene" nederst i kortet folder en forklaring ud.
- Lav/Middel/Høj for CO2 er relativt til de kommende timer, ligesom prisfarverne.

## Hvad prisen indeholder

- Spotpris DK1 (gennemsnit af timens fire kvarterer) plus elselskabets tillæg
- Nettarif C: N1 A/S (Hadsten) eller Konstant Net A/S (Ebeltoft), med netselskabets eventuelle rabat trukket fra. Konstant giver i øjeblikket rabat, N1 gør ikke. Rabatten findes via et navnemønster i `config.json`, fordi navnet skifter over tid
- Energinet: transmissions nettarif og systemtarif
- Elafgift
- Moms 25 % (kan slås fra)

Faste månedlige abonnementer er ikke med.

## Rette noget

Alt om adresser, netselskaber, elselskab og hvor længe der gemmes står i `config.json`. Siden og den automatiske hentning bruger den samme beregning (`beregn.js`).

Teste hentningen lokalt (kræver Node 20+): `BACKFILL_DAYS=3 node scripts/hent-priser.mjs`

## Vagthund

Den automatiske hentning holder også øje med ændringer, som beregningen ikke selv kan tage stilling til. Den opretter et issue på GitHub, og så får du en mail, når:

- et netselskab eller Energinet lægger en kWh-post ud med et navn, der ikke er set før
- nettarif eller Energinet-post mangler for en af de kommende 14 dage
- en netselskabsrabat ophører inden for 14 dage

Kendte postnavne gemmes i `data/vagthund.json`. Første kørsel registrerer alt, der findes, uden at melde noget. Luk et issue, når du har taget stilling til det. Det samme fund meldes ikke igen.

Vagthunden kan ikke se ændringer hos Altid Energi (tillæg og gebyrer), fordi de ikke findes i en åben datakilde.

## Bemærk

- Repoet er public, så `config.json` og prisdata kan ses af alle. Der står kun bynavne og netselskaber, ingen vejnavne.
- GitHub slår planlagte workflows fra i public repos efter 60 dage uden aktivitet. De daglige data-commits burde tælle som aktivitet. Står siden stille, så tjek fanen **Actions**.
