import Plotly from "plotly.js-basic-dist-min";

import { ALGORITHM_META, ALGORITHM_ORDER } from "./algorithms";
import { formatNumber, formatPValue, labelFromIdentifier, publicDataHref, withBase } from "./site";
import type {
  DatasetRecord,
  GeneRecord,
  ProfileRecord,
  SupportedAlgorithmId,
} from "./types";

interface GenePageOptions {
  symbolSlug: string;
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function getMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function setText(root: ParentNode, selector: string, value: string): void {
  const node = root.querySelector<HTMLElement>(selector);
  if (node) {
    node.textContent = value;
  }
}

function clearChildren(element: Element | null): void {
  if (element) {
    element.innerHTML = "";
  }
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json() as Promise<T>;
}

function getSelectedDataset(gene: GeneRecord): string {
  const url = new URL(window.location.href);
  const requestedDataset = url.searchParams.get("dataset");
  const available = new Set(gene.available_datasets.map((dataset) => dataset.slug));
  return requestedDataset && available.has(requestedDataset)
    ? requestedDataset
    : gene.available_datasets[0]?.slug;
}

function updateDatasetQueryParam(datasetSlug: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("dataset", datasetSlug);
  window.history.replaceState({}, "", url);
}

function sortSeries(x: number[], y: number[]): { x: number[]; y: number[] } {
  const pairs = x
    .map((value, index) => ({ x: value, y: y[index] }))
    .sort((left, right) => left.x - right.x);
  return {
    x: pairs.map((point) => point.x),
    y: pairs.map((point) => point.y),
  };
}

function getFitSeries(profile: ProfileRecord): { x: number[]; y: number[] } | null {
  const fitValues = profile.fit_values ?? [];
  const fitTimepoints = profile.fit_timepoints ?? [];
  if (!fitValues.length) {
    return null;
  }

  if (fitTimepoints.length === fitValues.length) {
    return sortSeries(fitTimepoints, fitValues);
  }

  if (profile.timepoints.length === fitValues.length) {
    return sortSeries(profile.timepoints, fitValues);
  }

  return null;
}

function getTimeAxisLabel(profile: ProfileRecord, dataset: DatasetRecord): string {
  return (
    getMetadataString(profile.metadata, "time_axis_label") ??
    getMetadataString(dataset.metadata, "time_axis_label") ??
    "Time (hours)"
  );
}

function buildCycleGuideShapes(profile: ProfileRecord, dataset: DatasetRecord): any[] {
  const cycleLengthHours =
    getMetadataNumber(profile.metadata, "cycle_length_hours") ??
    getMetadataNumber(dataset.metadata, "cycle_length_hours") ??
    24;

  if (cycleLengthHours <= 0 || !profile.timepoints.length) {
    return [];
  }

  const minTime = Math.min(...profile.timepoints);
  const maxTime = Math.max(...profile.timepoints);
  const firstGuide = Math.ceil(minTime / cycleLengthHours) * cycleLengthHours;
  const guides: any[] = [];

  for (let time = firstGuide; time < maxTime; time += cycleLengthHours) {
    guides.push({
      type: "line",
      x0: time,
      x1: time,
      y0: 0,
      y1: 1,
      xref: "x",
      yref: "paper",
      line: {
        color: "rgba(17, 32, 49, 0.12)",
        width: 1,
      },
    });
  }

  return guides;
}

async function renderPlot(
  root: HTMLElement,
  profile: ProfileRecord,
  dataset: DatasetRecord
): Promise<void> {
  const plot = root.querySelector<HTMLElement>("[data-plot]");
  if (!plot) {
    return;
  }
  const observedSeries = sortSeries(profile.timepoints, profile.expression_values);
  const fitSeries = getFitSeries(profile);

  const traces: any[] = [
    {
      x: observedSeries.x,
      y: observedSeries.y,
      type: "scatter",
      mode: "lines+markers",
      line: {
        color: "#6b8790",
        width: 1.3,
      },
      marker: {
        color: "#0f766e",
        size: 5,
      },
      name: "Observed",
    },
  ];

  if (fitSeries) {
    traces.push({
      x: fitSeries.x,
      y: fitSeries.y,
      type: "scatter",
      mode: "lines",
      line: {
        color: "#134e4a",
        width: 3,
      },
      name: profile.fit_method === "lowess" ? "LOWESS smooth" : "Smoothed fit",
    });
  }

  await Plotly.react(
    plot,
    traces,
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 56, r: 24, t: 24, b: 48 },
      font: {
        family: "IBM Plex Sans, Helvetica Neue, Arial, sans-serif",
        color: "#112031",
      },
      xaxis: {
        title: getTimeAxisLabel(profile, dataset),
        gridcolor: "rgba(17, 32, 49, 0.08)",
        zeroline: false,
        range: [Math.min(...profile.timepoints), Math.max(...profile.timepoints)],
      },
      yaxis: {
        title: profile.units,
        gridcolor: "rgba(17, 32, 49, 0.08)",
        zeroline: false,
      },
      shapes: buildCycleGuideShapes(profile, dataset),
      showlegend: true,
      legend: {
        orientation: "h",
        x: 0,
        y: 1.12,
      },
      autosize: true,
    },
    {
      displayModeBar: false,
      responsive: true,
    }
  );
}

function renderIdentifiers(root: HTMLElement, gene: GeneRecord): void {
  const list = root.querySelector<HTMLElement>("[data-identifiers]");
  clearChildren(list);
  if (!list) {
    return;
  }

  const entries = Object.entries(gene.external_ids);
  if (!entries.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">No external identifiers loaded.</p>';
    return;
  }

  for (const [key, value] of entries) {
    const item = document.createElement("div");
    item.className = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3";
    item.innerHTML = `
      <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">${labelFromIdentifier(
        key
      )}</div>
      <div class="mt-1 font-mono text-sm text-ink">${value}</div>
    `;
    list.append(item);
  }
}

function renderDatasetOptions(root: HTMLElement, gene: GeneRecord, selectedDataset: string): void {
  const select = root.querySelector<HTMLSelectElement>("[data-dataset-select]");
  if (!select) {
    return;
  }

  select.innerHTML = "";
  for (const dataset of gene.available_datasets) {
    const option = document.createElement("option");
    option.value = dataset.slug;
    option.selected = dataset.slug === selectedDataset;
    option.textContent = dataset.title;
    select.append(option);
  }
}

function renderAlgorithmOptions(root: HTMLElement, profile: ProfileRecord): SupportedAlgorithmId {
  const select = root.querySelector<HTMLSelectElement>("[data-algorithm-select]");
  if (!select) {
    return "jtk_cycle";
  }

  select.innerHTML = "";
  let firstAvailable: SupportedAlgorithmId = "jtk_cycle";
  for (const algorithmId of ALGORITHM_ORDER) {
    const result = profile.algorithms[algorithmId];
    if (result?.available) {
      firstAvailable = algorithmId;
      break;
    }
  }

  for (const algorithmId of ALGORITHM_ORDER) {
    const result = profile.algorithms[algorithmId];
    const option = document.createElement("option");
    option.value = algorithmId;
    option.textContent = result?.available
      ? ALGORITHM_META[algorithmId].label
      : `${ALGORITHM_META[algorithmId].label} (not loaded)`;
    option.selected = algorithmId === firstAvailable;
    select.append(option);
  }

  return firstAvailable;
}

function renderMetrics(root: HTMLElement, profile: ProfileRecord, algorithmId: SupportedAlgorithmId): void {
  const result = profile.algorithms[algorithmId];
  setText(root, "[data-metric='phase']", formatNumber(result.phase));
  setText(root, "[data-metric='amplitude']", formatNumber(result.amplitude));
  setText(root, "[data-metric='period']", formatNumber(result.period));
  setText(root, "[data-metric='p_value']", formatPValue(result.p_value));
  setText(root, "[data-metric='q_value']", formatPValue(result.q_value));
  setText(
    root,
    "[data-metric='rhythmic']",
    result.rhythmic === null ? "Not loaded" : result.rhythmic ? "Yes" : "No"
  );

  const note = root.querySelector<HTMLElement>("[data-algorithm-note]");
  if (note) {
    note.textContent = result.available
      ? `${ALGORITHM_META[algorithmId].label} is loaded for this profile.`
      : `${ALGORITHM_META[algorithmId].label} is supported by the schema but not loaded for this seed dataset yet.`;
  }
}

function renderDatasetMetadata(root: HTMLElement, dataset: DatasetRecord): void {
  const metadata = root.querySelector<HTMLElement>("[data-dataset-metadata]");
  clearChildren(metadata);
  if (!metadata) {
    return;
  }

  const items: Array<[string, string | number]> = [
    ["Species", dataset.species],
    ["Tissue", dataset.tissue],
    ["Platform", dataset.platform],
    ["Sampling interval", `${dataset.sampling_interval_hours} h`],
    ["Timepoints", dataset.number_of_timepoints],
    ["Genes", dataset.number_of_genes],
  ];
  const timeAxisLabel = getMetadataString(dataset.metadata, "time_axis_label");
  if (timeAxisLabel) {
    items.splice(4, 0, ["Time axis", timeAxisLabel]);
  }

  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.className = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3";
    item.innerHTML = `
      <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">${label}</div>
      <div class="mt-1 text-sm text-ink">${value}</div>
    `;
    metadata.append(item);
  }
}

function renderDownloads(root: HTMLElement, dataset: DatasetRecord, profilePath: string): void {
  const list = root.querySelector<HTMLElement>("[data-downloads]");
  clearChildren(list);
  if (!list) {
    return;
  }

  const downloads = [
    { label: "Profile JSON", href: profilePath },
    ...dataset.downloads,
  ];

  for (const download of downloads) {
    const item = document.createElement("li");
    item.innerHTML = `
      <a class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink hover:border-sea/50 hover:text-sea" href="${withBase(download.href)}">
        ${download.label}
      </a>
    `;
    list.append(item);
  }
}

export async function mountGenePage(options: GenePageOptions): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-gene-page]");
  if (!root) {
    return;
  }

  const gene = await loadJson<GeneRecord>(
    publicDataHref(`genes/${options.symbolSlug}.json`)
  );
  const selectedDataset = getSelectedDataset(gene);
  const datasetRef =
    gene.available_datasets.find((dataset) => dataset.slug === selectedDataset) ??
    gene.available_datasets[0];

  if (!datasetRef) {
    throw new Error(`No dataset available for ${gene.symbol}`);
  }

  updateDatasetQueryParam(datasetRef.slug);
  renderDatasetOptions(root, gene, datasetRef.slug);
  setText(root, "[data-gene-symbol]", gene.symbol);
  setText(root, "[data-gene-name]", gene.name);
  setText(root, "[data-gene-species]", gene.species);
  setText(
    root,
    "[data-gene-aliases]",
    gene.aliases.length ? gene.aliases.join(", ") : "No aliases loaded"
  );
  renderIdentifiers(root, gene);

  const [dataset, profile] = await Promise.all([
    loadJson<DatasetRecord>(publicDataHref(`datasets/${datasetRef.slug}.json`)),
    loadJson<ProfileRecord>(withBase(datasetRef.profile_path)),
  ]);

  document.title = `${gene.symbol} | CircaDB 2.0`;
  setText(root, "[data-selected-dataset-title]", dataset.title);
  setText(root, "[data-dataset-description]", dataset.description);
  setText(root, "[data-dataset-citation]", dataset.citation);
  setText(root, "[data-profile-units]", profile.units);

  const defaultAlgorithm = renderAlgorithmOptions(root, profile);
  renderMetrics(root, profile, defaultAlgorithm);
  renderDatasetMetadata(root, dataset);
  renderDownloads(root, dataset, datasetRef.profile_path);
  await renderPlot(root, profile, dataset);

  const algorithmSelect = root.querySelector<HTMLSelectElement>("[data-algorithm-select]");
  algorithmSelect?.addEventListener("change", () => {
    renderMetrics(root, profile, algorithmSelect.value as SupportedAlgorithmId);
  });

  const datasetSelect = root.querySelector<HTMLSelectElement>("[data-dataset-select]");
  datasetSelect?.addEventListener("change", () => {
    updateDatasetQueryParam(datasetSelect.value);
    window.location.reload();
  });
}
