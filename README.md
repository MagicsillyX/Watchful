# WATCHFUL Content Radar, gratis versie

Draait volledig op GitHub (gratis): GitHub Pages toont het dashboard, GitHub Actions haalt elk uur het nieuws op.
Zonder API-key beoordeelt het nieuws met eenvoudige regels (gratis). Met een Anthropic API-key (betaald, per gebruik) beoordeelt Claude het slimmer.

## Instellen (ca. 15 minuten, alles in de browser)
1. Maak een gratis account op github.com.
2. New repository: kies **Public** (gratis Pages voor een privé-repo bestaat niet). Upload alle bestanden uit deze map.
   Het mapje `.github` is verborgen: maak het bestand via **Add file, Create new file** met de naam `.github/workflows/scan.yml` en plak de inhoud.
3. Settings, Pages: Source = *Deploy from a branch*, branch `main`, map `/docs`. Na een minuut staat je dashboard op `https://JOUWNAAM.github.io/REPONAAM/`.
4. Settings, Actions, General: zet *Workflow permissions* op **Read and write permissions**.
5. Tab Actions, kies *scan*, **Run workflow** om direct de eerste scan te draaien.
6. Je Instagram-cijfers: open `docs/data/stats.json` op GitHub, klik het potlood en pas de cijfers aan (wekelijks een regel bij `history` toevoegen voor grafieken).

## Optioneel: slimmere beoordeling met Claude (niet gratis)
Settings, Secrets and variables, Actions, New secret: naam `ANTHROPIC_API_KEY`. Kosten zijn klein (alleen nieuwe artikelen), maar volg je verbruik op console.anthropic.com.

## Beperkingen
- Alles in een publieke repo is openbaar, dus ook je cijfers in `stats.json` en het dashboard zelf.
- GitHub kan geplande taken enkele minuten vertragen en pauzeert ze na lange inactiviteit; zet ze dan aan via de Actions-tab.
- Controleer de RSS-adressen in `feeds.json`. In de Actions-log zie je bij "Feed mislukt" welke niet werken.
- Zonder AI zijn titels Engels en de teksten algemener.
