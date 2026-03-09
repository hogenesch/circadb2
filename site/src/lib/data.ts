import { readFile } from "node:fs/promises";

import type {
  DatasetIndexEntry,
  DatasetRecord,
  GeneIndexEntry,
} from "./types";

const PROJECT_ROOT = new URL("../../../", import.meta.url);

async function readJson<T>(relativePath: string): Promise<T> {
  const path = new URL(relativePath, PROJECT_ROOT);
  const text = await readFile(path, "utf-8");
  return JSON.parse(text) as T;
}

export async function getGenesIndex(): Promise<GeneIndexEntry[]> {
  return readJson<GeneIndexEntry[]>("public_data/index/genes.json");
}

export async function getDatasetsIndex(): Promise<DatasetIndexEntry[]> {
  return readJson<DatasetIndexEntry[]>("public_data/index/datasets.json");
}

export async function getDataset(slug: string): Promise<DatasetRecord> {
  return readJson<DatasetRecord>(`public_data/datasets/${slug}.json`);
}
