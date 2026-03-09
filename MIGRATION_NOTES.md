# Migration Notes

## Baseline migration

This repository was first converted into a minimal static site for GitHub Pages using a small
set of Markdown pages, generated HTML files, one shared stylesheet, and a narrow
`assets/images/` directory.

## Important constraint

No actual WordPress tree or clear legacy website mirror was present in the current checkout.
Searches of the working directory did not find `wp-content`, `wp-admin`, `wp-includes`,
`wp-config.php`, exported XML, or other recognizable WordPress artifacts. The site therefore
remains a reconstruction from local Hogenesch-related source materials rather than a literal
page-for-page conversion.

## V2 refinement summary

The V2 pass focused on structure, clarity, navigation, and academic presentation rather than
adding complexity.

- Rewrote the homepage so the first screen clearly states who the lab is, what it studies,
  and why it matters.
- Simplified the top navigation to durable pages only: `Home`, `Research`, `People`,
  `Collaborations`, `Publications`, `Resources`, and `Join`.
- Reorganized the homepage around landmark contributions, research themes, a CircaDB feature,
  a people preview, and a recruiting block.
- Rewrote the research page into a clearer narrative organized by molecular clock biology,
  systems circadian biology, computational methods, and circadian medicine.
- Reworked the publications page into grouped landmark papers with links to Google Scholar
  and PubMed rather than a full on-site bibliography.
- Reorganized the people page into durable sections with placeholders where current roster
  information is missing.
- Added a structured alumni data file and replaced the earlier name-only alumni list with
  verified current or subsequent affiliations where publicly confirmable.
- Refined the resources page around key public tools and datasets: JTK_CYCLE, PSEA,
  MetaCycle, CYCLOPS, CircaDB, and related atlases.
- Replaced the earlier color system with a restrained white, near-black, deep-blue palette
  and updated the typography stacks for a more modern academic presentation.
- Added a dedicated collaborations page and promoted it into the primary navigation after
  `People`.
- Added a dedicated `Scientific Lineage` page and linked it from the homepage and primary navigation.
- Added simple query-string cache busting for the shared stylesheet and core image assets to reduce stale browser renders after deploy.
- Standardized CircaDB links to the canonical external URL `http://circadb.hogeneschlab.org/` and removed the redundant local CircaDB page.

## Content policy enforced in V2

- Only established, published work is referenced.
- Nonpublic or speculative work is excluded.
- Where current roster information is missing, placeholders are used instead of invented text.
- Collaboration summaries are limited to established published work and public resources.
- Alumni entries are limited to former lab members whose current or subsequent public
  professional pages could be reasonably confirmed.

## Local sources used

- `cv_letter_seed/John_Hogenesch_Self_Letter_v1.txt`
- `cv_letter_seed/Hogenesch_seed_letter_clean.txt`
- `cv_letter_seed/style_memory_me_letters.json`
- `cv_letter_seed/style_memory_people_letters_only.json`
- `hogenesch_cchmc_scripps_template/make_hogenesch_cchmc_scripps_template.py`
- `hogenesch_cchmc_scripps_template/assets/cchmc_logo.png`
- `hogenesch_cchmc_scripps_template/assets/scripps_logo.png`
- `Oslops_ref/README.md`
- `preOslops/README.md`
- Open-access published figures from PMC for Hughes et al. 2009 and Pizarro et al. 2013

## Manual review items

- Confirm whether `john.hogenesch@cchmc.org` is still the desired public contact address.
- Replace the placeholders on `people.md` with a current roster when available.
- Decide whether the homepage should keep both institutional logos in the hero area.
- If a true legacy site export is found later, compare it against this reconstruction and
  pull over any missing public-facing historical content.
