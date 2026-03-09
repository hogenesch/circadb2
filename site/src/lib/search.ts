import type { GeneIndexEntry } from "./types";
import { publicDataHref, withBase } from "./site";

let genesPromise: Promise<GeneIndexEntry[]> | null = null;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesExact(gene: GeneIndexEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return false;
  }

  return (
    gene.symbol.toLowerCase() === normalizedQuery ||
    gene.name.toLowerCase() === normalizedQuery ||
    gene.aliases.some((alias) => alias.toLowerCase() === normalizedQuery) ||
    gene.probe_ids?.some((probeId) => probeId.toLowerCase() === normalizedQuery) === true
  );
}

function matchesPrefix(gene: GeneIndexEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return false;
  }

  return (
    gene.symbol.toLowerCase().startsWith(normalizedQuery) ||
    gene.name.toLowerCase().startsWith(normalizedQuery) ||
    gene.aliases.some((alias) => alias.toLowerCase().startsWith(normalizedQuery))
  );
}

export function geneHref(slug: string, datasetSlug = "hughes-2009"): string {
  return withBase(`gene/${slug}?dataset=${datasetSlug}`);
}

export function symbolToSlug(symbol: string): string {
  return symbol.toUpperCase().replace(/\//g, "-").replace(/ /g, "-");
}

export function getExactGeneMatches(
  genes: GeneIndexEntry[],
  query: string
): GeneIndexEntry[] {
  const normalizedQuery = normalizeQuery(query);
  return genes.filter((gene) => matchesExact(gene, normalizedQuery));
}

export function matchGenes(
  genes: GeneIndexEntry[],
  query: string,
  limit = 10
): GeneIndexEntry[] {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const exactMatches = getExactGeneMatches(genes, query);
  const prefixMatches = genes.filter((gene) => {
    if (exactMatches.includes(gene)) {
      return false;
    }
    return matchesPrefix(gene, normalizedQuery);
  });

  return [...exactMatches, ...prefixMatches].slice(0, limit);
}

export function resolveDirectGeneMatch(
  genes: GeneIndexEntry[],
  query: string
): GeneIndexEntry | null {
  const exactMatches = getExactGeneMatches(genes, query);
  return exactMatches.length === 1 ? exactMatches[0] : null;
}

export function loadGenes(): Promise<GeneIndexEntry[]> {
  if (!genesPromise) {
    genesPromise = fetch(publicDataHref("index/genes.json")).then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load gene index.");
      }
      return response.json() as Promise<GeneIndexEntry[]>;
    });
  }

  return genesPromise;
}

export function mountSearchBox(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-search-form]");
  const input = root.querySelector<HTMLInputElement>("[data-search-input]");
  const results = root.querySelector<HTMLUListElement>("[data-search-results]");

  if (!form || !input || !results) {
    return;
  }

  const renderResults = async () => {
    const matches = matchGenes(await loadGenes(), input.value, 8);
    results.innerHTML = "";

    if (!matches.length && input.value.trim()) {
      const item = document.createElement("li");
      item.className =
        "rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500";
      item.textContent = "No exact or prefix matches.";
      results.append(item);
      return;
    }

    for (const gene of matches) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = geneHref(gene.slug);
      link.className =
        "flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-sea/50 hover:bg-mist";
      link.innerHTML = `
        <span>
          <strong class="font-semibold text-ink">${gene.symbol}</strong>
          <span class="ml-2 text-slate-500">${gene.name}</span>
        </span>
        <span class="text-xs uppercase tracking-[0.2em] text-sea">Gene</span>
      `;
      item.append(link);
      results.append(item);
    }
  };

  input.addEventListener("input", () => {
    void renderResults();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      return;
    }

    const genes = await loadGenes();
    const directMatch = resolveDirectGeneMatch(genes, query);
    if (directMatch) {
      window.location.href = geneHref(directMatch.slug);
      return;
    }

    window.location.href = withBase(`search?gene=${encodeURIComponent(query)}`);
  });
}
