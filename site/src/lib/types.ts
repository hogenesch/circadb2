export type SupportedAlgorithmId =
  | "jtk_cycle"
  | "ejtk"
  | "lomb_scargle"
  | "arser"
  | "rain"
  | "metacycle";

export interface AlgorithmResult {
  available: boolean;
  phase: number | null;
  amplitude: number | null;
  period: number | null;
  power: number | null;
  p_value: number | null;
  q_value: number | null;
  rhythmic: boolean | null;
}

export interface GeneDatasetRef {
  id: string;
  slug: string;
  title: string;
  profile_path: string;
}

export interface GeneRecord {
  id: string;
  symbol: string;
  name: string;
  aliases: string[];
  species: string;
  external_ids: Record<string, string>;
  available_datasets: GeneDatasetRef[];
}

export interface DatasetDownload {
  label: string;
  href: string;
}

export interface DatasetExampleGene {
  symbol: string;
  name: string;
  profile_path: string;
  gene_path: string;
}

export interface DatasetRecord {
  id: string;
  slug: string;
  title: string;
  citation: string;
  species: string;
  tissue: string;
  platform: string;
  sampling_interval_hours: number;
  number_of_timepoints: number;
  description: string;
  source_files: string[];
  downloads: DatasetDownload[];
  featured_genes: string[];
  number_of_genes: number;
  supported_algorithms: SupportedAlgorithmId[];
  loaded_algorithms: SupportedAlgorithmId[];
  metadata: Record<string, unknown>;
  example_genes: DatasetExampleGene[];
}

export interface ProfileRecord {
  gene_id: string;
  dataset_id: string;
  symbol: string;
  algorithms: Record<SupportedAlgorithmId, AlgorithmResult>;
  timepoints: number[];
  expression_values: number[];
  display_variants?: Record<string, DisplayVariant>;
  fit_method?: string | null;
  fit_timepoints?: number[];
  fit_values?: number[];
  units: string;
  metadata: Record<string, unknown>;
}

export interface DisplayVariant {
  fit_method?: string;
  timepoints?: number[];
  values?: number[];
  fit_timepoints?: number[];
  fit_values?: number[];
}

export interface GeneIndexEntry {
  symbol: string;
  slug: string;
  name: string;
  aliases: string[];
  probe_ids?: string[];
  species: string;
  available_datasets: string[];
}

export interface DatasetIndexEntry {
  id: string;
  slug: string;
  title: string;
  species: string;
  tissue: string;
  platform: string;
}

export interface CriteriaIndexEntry {
  symbol: string;
  name: string;
  aliases: string[];
  dataset_id: string;
  algorithm: SupportedAlgorithmId;
  phase: number | null;
  amplitude: number | null;
  period: number | null;
  p_value: number | null;
  q_value: number | null;
  rhythmic: boolean | null;
}
