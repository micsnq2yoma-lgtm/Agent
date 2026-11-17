# Bundled UI Fonts

Paperclip bundles Inter for the board UI so screenshots and packaged installs use
the same sans-serif text stack without relying on host font packages.

## Inter

- Upstream project: https://github.com/rsms/inter
- Version: v4.1
- Source files:
  - https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2
  - https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable-Italic.woff2
- License: SIL Open Font License 1.1
- License text: https://github.com/rsms/inter/blob/v4.1/LICENSE.txt

Redistribution note: Inter is redistributed under the SIL Open Font License 1.1.
The bundled WOFF2 files are included unmodified from the upstream v4.1 release.

## Paper Mono

- Upstream project: https://github.com/paper-design/paper-mono
- Version: v1.000
- Release archive: https://github.com/paper-design/paper-mono/releases/download/v1.000/paper-mono-v1.000.zip
- Archive SHA-256: `8642652985dc87bf4cfd07c89942899e611c3c774fc25284c0dd4fe86a993a13`
- Source file: `fonts/webfonts/PaperMono[wght].woff2`, bundled without modification as `PaperMono-Variable.woff2`
- License: SIL Open Font License 1.1; included in `PaperMono-OFL.txt`

The refreshed task-row specimen uses this variable webfont for task identifiers.
It supports upright weights 100–800. Existing uses of the system monospace stack
remain unchanged until their design is reviewed.

## Cormorant Garamond (AgenTeam SETO skin, display serif)

- Upstream project: https://github.com/CatharsisFonts/Cormorant
- Taken from the npm package `@fontsource-variable/cormorant-garamond` 5.3.0 (`files/cormorant-garamond-latin-wght-normal.woff2`, `files/cormorant-garamond-latin-ext-wght-normal.woff2`), bundled without modification as `CormorantGaramond-Variable-latin.woff2` and `CormorantGaramond-Variable-latin-ext.woff2`
- Weights 300–700
- License: SIL Open Font License 1.1; included in `CormorantGaramond-OFL.txt`

Used for headings, the wordmark and stat numbers when the commercial Tiempos Headline is not installed locally (docs/handoff/design/DESIGN.md §9.11).

## JetBrains Mono (AgenTeam SETO skin, monospace)

- Upstream project: https://github.com/JetBrains/JetBrainsMono
- Taken from the npm package `@fontsource-variable/jetbrains-mono` 5.3.0 (`files/jetbrains-mono-latin-wght-normal.woff2`), bundled without modification as `JetBrainsMono-Variable-latin.woff2`
- Weights 100–800
- License: SIL Open Font License 1.1; included in `JetBrainsMono-OFL.txt`

## Noto Serif SC (AgenTeam)

- Upstream project: https://github.com/notofonts/noto-cjk (packaged by Fontsource: `@fontsource/noto-serif-sc` 5.3.1)
- Files: `noto-serif-sc/noto-serif-sc-*-500-normal.woff2` (weight 500 only, split by unicode-range; `src/agenteam/fonts-cjk.css` declares them)
- License: SIL Open Font License 1.1 (`noto-serif-sc/OFL.txt`)

Redistribution note: the WOFF2 slices are included unmodified from the Fontsource package. Used for
Chinese headings in the AgenTeam views so they do not fall back to SimSun on Windows; the browser
downloads only the slices a page actually uses.
