# CircaDB 2.0 Proof of Concept

Minimal static proof of concept for CircaDB 2.0. The current seed dataset is the Hughes et al. 2009 mouse liver 48-hour time-course, but the project architecture is intentionally broader than that one dataset.

## Architecture

The project is modeled around three canonical layers:

- `Gene`: canonical biological entity metadata
- `Dataset`: canonical dataset metadata and provenance
- `GeneDatasetProfile`: one gene observed in one dataset, with time series and multi-algorithm rhythmicity slots

The data model is schema-first and algorithm-agnostic. The seed dataset only populates `jtk_cycle`, but every profile reserves slots for:

- `jtk_cycle`
- `ejtk`
- `lomb_scargle`
- `arser`
- `rain`
- `metacycle`

Each profile can carry a precomputed smooth fit series for plotting. The current Hughes liver build generates a build-time LOWESS smoother and stores `fit_method`, `fit_timepoints`, and `fit_values` in the profile JSON. Rhythmicity statistics still come from JTK or other supported algorithms; the smooth curve is a display aid, not the rhythm-calling model.

For the four pilot genes `NR1D1`, `PER2`, `ARNTL`, and `DBP`, the builder also emits `display_variants` for direct visual comparison pages. Those pages compare observed-only, unwrapped LOWESS, and unwrapped PCHIP overlays on the same axes. These overlays are display-only and are not used for rhythm calling.

## Project layout

```text
circadb2/
  data_raw/
    hughes_2009/
  data_build/
    build_hughes_2009.py
    schemas/
    utils/
  public_data/
  site/
    src/
    public/
    astro.config.mjs
    package.json
    tsconfig.json
    tailwind.config.mjs
  .github/
    workflows/
      deploy.yml
  README.md
```

## Data inputs

The current builder reads these flat files from `data_raw/hughes_2009/`:

- `hughes2009_liver48_jtk_gene_best_probe_ranked.csv`
- `gse11923_expr_probe_x_sample.csv`
- `gse11923_pheno_data.csv`
- `gene_metadata_overrides.csv`

The first three are local Hughes liver source files. `gene_metadata_overrides.csv` is a small optional override table for better canonical display metadata on selected genes.

## Generated artifacts

Run the Python builder to generate:

- `public_data/index/genes.json`
- `public_data/index/datasets.json`
- `public_data/index/hughes-2009-jtk.json`
- `public_data/genes/<GENE_SYMBOL>.json`
- `public_data/datasets/hughes-2009.json`
- `public_data/profiles/hughes-2009/<GENE_SYMBOL>.json`
- `public_data/downloads/hughes-2009/*`

## Search

- Direct gene search supports exact symbol, alias, and probe-ID lookup, with prefix matching for broader gene discovery.
- Criteria search uses the compact `public_data/index/hughes-2009-jtk.json` index for static client-side filtering by JTK q-value cutoff, phase range, and rhythmic yes/no.
- Criteria results are paginated at 10 genes per page and link into the canonical gene pages with Hughes 2009 selected by default.

## Comparison pages

The following pilot-only routes compare three visualization methods for the same Hughes 2009 profile:

- `/gene/NR1D1/compare`
- `/gene/PER2/compare`
- `/gene/ARNTL/compare`
- `/gene/DBP/compare`

Each comparison page keeps the observed data fixed and shows:

- observed only
- LOWESS on the unwrapped 48 h data
- PCHIP on the unwrapped 48 h data

## Local development

### 1. Build the JSON artifacts

From `circadb2/`:

```bash
python3 -m pip install -r data_build/requirements.txt
python3 data_build/build_hughes_2009.py
```

### 2. Install site dependencies

From `circadb2/site/`:

```bash
npm ci
```

### 3. Start the Astro dev server

From `circadb2/site/`:

```bash
npm run dev
```

The `dev` script copies `../public_data` into `site/public/public_data` before launching Astro.

### 4. Build the static site locally

From `circadb2/site/`:

```bash
npm run build
```

### 5. Preview the built site

From `circadb2/site/`:

```bash
npm run preview
```

## GitHub Pages deployment

This project is configured for static deployment via GitHub Pages.

The workflow:

1. builds `public_data` with Python
2. installs site dependencies
3. sets `SITE_BASE` dynamically from the repository name
4. runs the Astro static build
5. uploads `site/dist`
6. deploys to GitHub Pages

The base path is derived from the repository name:

- repo `circadb2` -> base `/circadb2/`
- repo `circadb` -> base `/circadb/`

For local builds, the default base path is `/`.

## Assumptions

- The local Hughes liver files under `analysis/hughes_liver/source/` are the canonical seed inputs for this proof of concept.
- The JTK-ranked file supplies the best probe per gene and is the only loaded rhythmicity algorithm in the seed dataset.
- Rows with placeholder non-gene symbols such as `---` are excluded from canonical gene/profile generation.
- Additional algorithms will be added later by extending the Python build step and populating the existing algorithm slots rather than redesigning the frontend or JSON schema.
