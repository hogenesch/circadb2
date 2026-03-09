import type {
  CriteriaIndexEntry,
  GeneIndexEntry,
  SupportedAlgorithmId,
} from "./types";
import { formatNumber, formatPValue, publicDataHref } from "./site";
import {
  geneHref,
  loadGenes,
  matchGenes,
  resolveDirectGeneMatch,
  symbolToSlug,
} from "./search";

const RESULTS_PER_PAGE = 10;
const DEFAULT_DATASET_ID = "hughes-2009";
const DEFAULT_ALGORITHM_ID: SupportedAlgorithmId = "jtk_cycle";
const DEFAULT_Q_VALUE = 0.001;
const DEFAULT_RHYTHMIC = "yes";

interface SearchState {
  gene: string;
  dataset: string;
  algorithm: SupportedAlgorithmId;
  qValueCutoff: number;
  phaseMin: string;
  phaseMax: string;
  rhythmic: "yes" | "no";
  page: number;
}

let criteriaPromise: Promise<CriteriaIndexEntry[]> | null = null;

function parseNumericInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStateFromUrl(): SearchState {
  const url = new URL(window.location.href);
  const algorithmParam = url.searchParams.get("algorithm");
  const qValueParam = parseNumericInput(url.searchParams.get("q") ?? "");
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);

  return {
    gene: url.searchParams.get("gene")?.trim() ?? "",
    dataset: url.searchParams.get("dataset")?.trim() || DEFAULT_DATASET_ID,
    algorithm:
      algorithmParam === DEFAULT_ALGORITHM_ID
        ? DEFAULT_ALGORITHM_ID
        : DEFAULT_ALGORITHM_ID,
    qValueCutoff: qValueParam ?? DEFAULT_Q_VALUE,
    phaseMin: url.searchParams.get("phase_min")?.trim() ?? "",
    phaseMax: url.searchParams.get("phase_max")?.trim() ?? "",
    rhythmic:
      url.searchParams.get("rhythmic") === "no" ? "no" : DEFAULT_RHYTHMIC,
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  };
}

function writeStateToUrl(state: SearchState): void {
  const url = new URL(window.location.href);

  if (state.gene) {
    url.searchParams.set("gene", state.gene);
  } else {
    url.searchParams.delete("gene");
  }

  url.searchParams.set("dataset", state.dataset);
  url.searchParams.set("algorithm", state.algorithm);
  url.searchParams.set("q", String(state.qValueCutoff));

  if (state.phaseMin) {
    url.searchParams.set("phase_min", state.phaseMin);
  } else {
    url.searchParams.delete("phase_min");
  }

  if (state.phaseMax) {
    url.searchParams.set("phase_max", state.phaseMax);
  } else {
    url.searchParams.delete("phase_max");
  }

  url.searchParams.set("rhythmic", state.rhythmic);

  if (state.page > 1) {
    url.searchParams.set("page", String(state.page));
  } else {
    url.searchParams.delete("page");
  }

  window.history.replaceState({}, "", url);
}

function buildCriteriaStateFromForm(root: HTMLElement): SearchState {
  const dataset =
    root.querySelector<HTMLSelectElement>("[data-criteria-dataset]")?.value ??
    DEFAULT_DATASET_ID;
  const algorithm =
    (root.querySelector<HTMLSelectElement>("[data-criteria-algorithm]")?.value as SupportedAlgorithmId) ??
    DEFAULT_ALGORITHM_ID;
  const qValueCutoff =
    parseNumericInput(
      root.querySelector<HTMLInputElement>("[data-criteria-q]")?.value ?? ""
    ) ?? DEFAULT_Q_VALUE;

  return {
    gene:
      root.querySelector<HTMLInputElement>("[data-gene-lookup-input]")?.value.trim() ??
      "",
    dataset,
    algorithm,
    qValueCutoff,
    phaseMin:
      root.querySelector<HTMLInputElement>("[data-criteria-phase-min]")?.value.trim() ??
      "",
    phaseMax:
      root.querySelector<HTMLInputElement>("[data-criteria-phase-max]")?.value.trim() ??
      "",
    rhythmic:
      root.querySelector<HTMLSelectElement>("[data-criteria-rhythmic]")?.value === "no"
        ? "no"
        : "yes",
    page: 1,
  };
}

function applyStateToForm(root: HTMLElement, state: SearchState): void {
  const geneInput = root.querySelector<HTMLInputElement>("[data-gene-lookup-input]");
  const datasetSelect = root.querySelector<HTMLSelectElement>("[data-criteria-dataset]");
  const algorithmSelect = root.querySelector<HTMLSelectElement>("[data-criteria-algorithm]");
  const qInput = root.querySelector<HTMLInputElement>("[data-criteria-q]");
  const phaseMinInput = root.querySelector<HTMLInputElement>("[data-criteria-phase-min]");
  const phaseMaxInput = root.querySelector<HTMLInputElement>("[data-criteria-phase-max]");
  const rhythmicSelect = root.querySelector<HTMLSelectElement>("[data-criteria-rhythmic]");

  if (geneInput) {
    geneInput.value = state.gene;
  }
  if (datasetSelect) {
    datasetSelect.value = state.dataset;
  }
  if (algorithmSelect) {
    algorithmSelect.value = state.algorithm;
  }
  if (qInput) {
    qInput.value = String(state.qValueCutoff);
  }
  if (phaseMinInput) {
    phaseMinInput.value = state.phaseMin;
  }
  if (phaseMaxInput) {
    phaseMaxInput.value = state.phaseMax;
  }
  if (rhythmicSelect) {
    rhythmicSelect.value = state.rhythmic;
  }
}

function loadCriteriaIndex(): Promise<CriteriaIndexEntry[]> {
  if (!criteriaPromise) {
    criteriaPromise = fetch(publicDataHref("index/hughes-2009-jtk.json")).then(
      (response) => {
        if (!response.ok) {
          throw new Error("Failed to load Hughes JTK filter index.");
        }
        return response.json() as Promise<CriteriaIndexEntry[]>;
      }
    );
  }

  return criteriaPromise;
}

function renderGeneMatches(
  root: HTMLElement,
  matches: GeneIndexEntry[],
  query: string
): void {
  const results = root.querySelector<HTMLUListElement>("[data-gene-lookup-results]");
  if (!results) {
    return;
  }

  results.innerHTML = "";
  if (!query) {
    return;
  }

  if (!matches.length) {
    const item = document.createElement("li");
    item.className =
      "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500";
    item.textContent = "No exact or prefix matches.";
    results.append(item);
    return;
  }

  for (const gene of matches) {
    const item = document.createElement("li");
    item.className = "rounded-2xl border border-slate-200 bg-white px-4 py-3";
    item.innerHTML = `
      <a class="flex items-center justify-between text-sm hover:text-sea" href="${geneHref(gene.slug)}">
        <span>
          <strong class="font-semibold text-ink">${gene.symbol}</strong>
          <span class="ml-2 text-slate-500">${gene.name}</span>
        </span>
        <span class="text-xs uppercase tracking-[0.18em] text-sea">Gene</span>
      </a>
    `;
    results.append(item);
  }
}

function filterCriteriaRows(
  rows: CriteriaIndexEntry[],
  state: SearchState
): CriteriaIndexEntry[] {
  const phaseMin = parseNumericInput(state.phaseMin);
  const phaseMax = parseNumericInput(state.phaseMax);

  return rows.filter((row) => {
    if (row.dataset_id !== state.dataset) {
      return false;
    }
    if (row.algorithm !== state.algorithm) {
      return false;
    }
    if (row.q_value === null || row.q_value > state.qValueCutoff) {
      return false;
    }
    if (state.rhythmic === "yes" && row.rhythmic !== true) {
      return false;
    }
    if (state.rhythmic === "no" && row.rhythmic !== false) {
      return false;
    }
    if (phaseMin !== null && (row.phase === null || row.phase < phaseMin)) {
      return false;
    }
    if (phaseMax !== null && (row.phase === null || row.phase > phaseMax)) {
      return false;
    }
    return true;
  });
}

function renderCriteriaResults(
  root: HTMLElement,
  rows: CriteriaIndexEntry[],
  state: SearchState
): void {
  const summary = root.querySelector<HTMLElement>("[data-criteria-summary]");
  const body = root.querySelector<HTMLTableSectionElement>("[data-criteria-rows]");
  const empty = root.querySelector<HTMLElement>("[data-criteria-empty]");
  const previousButton = root.querySelector<HTMLButtonElement>("[data-prev-page]");
  const nextButton = root.querySelector<HTMLButtonElement>("[data-next-page]");
  const pageLabel = root.querySelector<HTMLElement>("[data-page-label]");

  if (!summary || !body || !empty || !previousButton || !nextButton || !pageLabel) {
    return;
  }

  const totalHits = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalHits / RESULTS_PER_PAGE));
  const page = Math.min(state.page, totalPages);
  const startIndex = (page - 1) * RESULTS_PER_PAGE;
  const pageRows = rows.slice(startIndex, startIndex + RESULTS_PER_PAGE);

  summary.textContent = `${totalHits.toLocaleString()} hits`;
  pageLabel.textContent = `Page ${page} of ${totalPages}`;
  previousButton.disabled = page <= 1;
  nextButton.disabled = page >= totalPages;

  body.innerHTML = "";
  empty.classList.toggle("hidden", totalHits !== 0);

  for (const row of pageRows) {
    const tableRow = document.createElement("tr");
    tableRow.className = "border-b border-slate-100";
    tableRow.innerHTML = `
      <td class="px-4 py-3 font-semibold text-ink">${row.symbol}</td>
      <td class="px-4 py-3 text-slate-600">${row.name}</td>
      <td class="px-4 py-3 text-slate-600">${formatNumber(row.phase)}</td>
      <td class="px-4 py-3 text-slate-600">${formatNumber(row.amplitude)}</td>
      <td class="px-4 py-3 text-slate-600">${formatPValue(row.q_value)}</td>
      <td class="px-4 py-3 text-slate-600">${row.rhythmic ? "Yes" : "No"}</td>
      <td class="px-4 py-3">
        <a class="text-sea hover:text-ink" href="${geneHref(symbolToSlug(row.symbol), state.dataset)}">Open</a>
      </td>
    `;
    body.append(tableRow);
  }
}

async function syncGeneLookup(root: HTMLElement, state: SearchState): Promise<void> {
  const genes = await loadGenes();
  renderGeneMatches(root, matchGenes(genes, state.gene), state.gene);
}

async function syncCriteriaSearch(root: HTMLElement, state: SearchState): Promise<void> {
  const rows = filterCriteriaRows(await loadCriteriaIndex(), state);
  renderCriteriaResults(root, rows, state);
}

export async function mountSearchPage(root: HTMLElement): Promise<void> {
  let state = readStateFromUrl();
  applyStateToForm(root, state);
  await Promise.all([syncGeneLookup(root, state), syncCriteriaSearch(root, state)]);

  const geneForm = root.querySelector<HTMLFormElement>("[data-gene-lookup-form]");
  const geneInput = root.querySelector<HTMLInputElement>("[data-gene-lookup-input]");
  const criteriaForm = root.querySelector<HTMLFormElement>("[data-criteria-form]");
  const resetButton = root.querySelector<HTMLButtonElement>("[data-criteria-reset]");
  const previousButton = root.querySelector<HTMLButtonElement>("[data-prev-page]");
  const nextButton = root.querySelector<HTMLButtonElement>("[data-next-page]");

  geneInput?.addEventListener("input", async () => {
    state = {
      ...state,
      gene: geneInput.value.trim(),
      page: 1,
    };
    writeStateToUrl(state);
    await syncGeneLookup(root, state);
  });

  geneForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = geneInput?.value.trim() ?? "";
    const genes = await loadGenes();
    const directMatch = resolveDirectGeneMatch(genes, query);

    if (directMatch) {
      window.location.href = geneHref(directMatch.slug);
      return;
    }

    state = {
      ...state,
      gene: query,
      page: 1,
    };
    writeStateToUrl(state);
    renderGeneMatches(root, matchGenes(genes, query), query);
  });

  criteriaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state = buildCriteriaStateFromForm(root);
    writeStateToUrl(state);
    await syncCriteriaSearch(root, state);
  });

  resetButton?.addEventListener("click", async () => {
    state = {
      ...state,
      dataset: DEFAULT_DATASET_ID,
      algorithm: DEFAULT_ALGORITHM_ID,
      qValueCutoff: DEFAULT_Q_VALUE,
      phaseMin: "",
      phaseMax: "",
      rhythmic: DEFAULT_RHYTHMIC,
      page: 1,
    };
    applyStateToForm(root, state);
    writeStateToUrl(state);
    await syncCriteriaSearch(root, state);
  });

  previousButton?.addEventListener("click", async () => {
    if (state.page <= 1) {
      return;
    }
    state = {
      ...state,
      page: state.page - 1,
    };
    writeStateToUrl(state);
    await syncCriteriaSearch(root, state);
  });

  nextButton?.addEventListener("click", async () => {
    state = {
      ...state,
      page: state.page + 1,
    };
    writeStateToUrl(state);
    await syncCriteriaSearch(root, state);
  });
}
