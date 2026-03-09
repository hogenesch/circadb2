import Plotly from "plotly.js-basic-dist-min";

import { publicDataHref, withBase } from "./site";
import type { DatasetRecord, DisplayVariant, ProfileRecord } from "./types";

interface GeneCompareOptions {
  symbolSlug: string;
}

type ComparisonVariantId = "observed_only" | "lowess" | "pchip";

const VARIANT_META: Record<
  ComparisonVariantId,
  { label: string; description: string; lineColor?: string; overlayName?: string }
> = {
  observed_only: {
    label: "Observed only",
    description: "Observed points with a thin connecting line only.",
  },
  lowess: {
    label: "LOWESS",
    description: "LOWESS overlay on the unwrapped 48 h experimental time axis.",
    lineColor: "#0f766e",
    overlayName: "LOWESS overlay",
  },
  pchip: {
    label: "PCHIP",
    description: "PCHIP shape-preserving overlay on the unwrapped 48 h experimental time axis.",
    lineColor: "#b45309",
    overlayName: "PCHIP overlay",
  },
};

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function getMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json() as Promise<T>;
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

function getOverlaySeries(
  variant: DisplayVariant | undefined,
): { x: number[]; y: number[] } | null {
  if (!variant?.fit_timepoints?.length || !variant.fit_values?.length) {
    return null;
  }

  if (variant.fit_timepoints.length !== variant.fit_values.length) {
    return null;
  }

  return sortSeries(variant.fit_timepoints, variant.fit_values);
}

function getYRange(values: number[]): [number, number] | undefined {
  if (!values.length) {
    return undefined;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const padding = span === 0 ? Math.max(1, Math.abs(maxValue) * 0.05) : span * 0.08;
  return [minValue - padding, maxValue + padding];
}

async function renderVariantPlot(
  plot: HTMLElement,
  panel: HTMLElement,
  profile: ProfileRecord,
  dataset: DatasetRecord,
  variantId: ComparisonVariantId,
  yRange: [number, number] | undefined,
): Promise<void> {
  const observedSeries = sortSeries(profile.timepoints, profile.expression_values);
  const variant = profile.display_variants?.[variantId];
  const overlaySeries = getOverlaySeries(variant);
  const meta = VARIANT_META[variantId];
  const traces: any[] = [
    {
      x: observedSeries.x,
      y: observedSeries.y,
      type: "scatter",
      mode: "lines+markers",
      line: {
        color: "#6b8790",
        width: 1.25,
      },
      marker: {
        color: "#0f172a",
        size: 5,
      },
      name: "Observed",
    },
  ];

  if (overlaySeries && meta.lineColor && meta.overlayName) {
    traces.push({
      x: overlaySeries.x,
      y: overlaySeries.y,
      type: "scatter",
      mode: "lines",
      line: {
        color: meta.lineColor,
        width: 3,
      },
      name: meta.overlayName,
    });
  }

  const note = panel.querySelector<HTMLElement>("[data-variant-note]");
  if (note) {
    note.textContent = overlaySeries ? meta.description : `${meta.description} Overlay unavailable for this profile.`;
  }

  await Plotly.react(
    plot,
    traces,
    {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 56, r: 20, t: 20, b: 48 },
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
        range: yRange,
      },
      shapes: buildCycleGuideShapes(profile, dataset),
      showlegend: true,
      legend: {
        orientation: "h",
        x: 0,
        y: 1.14,
      },
      autosize: true,
    },
    {
      displayModeBar: false,
      responsive: true,
    },
  );
}

export async function mountGeneComparePage({
  symbolSlug,
}: GeneCompareOptions): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-gene-compare-page]");
  if (!root) {
    return;
  }

  const profilePath = publicDataHref(`profiles/hughes-2009/${symbolSlug}.json`);
  const datasetPath = publicDataHref("datasets/hughes-2009.json");
  const [profile, dataset] = await Promise.all([
    loadJson<ProfileRecord>(profilePath),
    loadJson<DatasetRecord>(datasetPath),
  ]);

  const datasetLink = root.querySelector<HTMLAnchorElement>("[data-dataset-link]");
  if (datasetLink) {
    datasetLink.textContent = dataset.title;
    datasetLink.href = withBase(`datasets/${dataset.slug}`);
  }

  const probe = root.querySelector<HTMLElement>("[data-probe-id]");
  if (probe) {
    probe.textContent = getMetadataString(profile.metadata, "selected_probeset_id") ?? "—";
  }

  const compareLink = root.querySelector<HTMLAnchorElement>("[data-main-gene-link]");
  if (compareLink) {
    compareLink.href = withBase(`gene/${symbolSlug}`);
  }

  const yRange = getYRange(profile.expression_values);
  const variantIds: ComparisonVariantId[] = ["observed_only", "lowess", "pchip"];

  await Promise.all(
    variantIds.map(async (variantId) => {
      const panel = root.querySelector<HTMLElement>(`[data-variant-panel="${variantId}"]`);
      const plot = panel?.querySelector<HTMLElement>("[data-plot]");
      if (!panel || !plot) {
        return;
      }
      await renderVariantPlot(plot, panel, profile, dataset, variantId, yRange);
    }),
  );
}
