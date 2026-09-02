# Prio Rekrytering - agentinstruktioner

Detta är en statisk Jekyll-webbplats publicerad med GitHub Pages på `priorekrytering.se`.

## Innan varje ändring

Pages CMS kan ha ändrat innehållet direkt på GitHub. Synka därför alltid först med den dedikerade SSH-nyckeln:

```bash
git -c core.sshCommand="ssh -i /workspace/secrets/priorekrytering_github_ed25519 -o IdentitiesOnly=yes" pull --rebase origin main
```

Skriv aldrig över eller återställ ändringar från Pages CMS.

## Struktur

- Sidmallar: `index.html`, `om.html`, `kontakt.html`, `lediga-jobb.html`
- Redigerbart innehåll: `_data/*.yml`
- Pages CMS-konfiguration: `.pages.yml`
- Gemensam design: `styles.css`
- Webbskript: `script.js`
- Bilder: `assets/uploads/`
- Formulär: inbäddade från Tally

Innehåll som vännen ska kunna ändra ska normalt ligga i `_data/*.yml` och registreras i `.pages.yml`, inte hårdkodas i sidmallen.

## Säkerhet och publicering

- Lägg aldrig filer från `/workspace/secrets` eller autentiseringsuppgifter i repot.
- Jenniefers mejl och telefon är avsiktligt kodade i HTML och avkodas i `script.js`.
- Kontrollera YAML, `git diff --check` och relevanta sidor före commit.
- Pusha färdiga ändringar till `main`; GitHub Pages publicerar automatiskt.
