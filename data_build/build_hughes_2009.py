from __future__ import annotations

import csv
import math
import re
import shutil
from pathlib import Path

from utils.algorithms import DEFAULT_ALGORITHM_ID, SUPPORTED_ALGORITHMS
from utils.io import read_csv, write_json, write_json_compact
from utils.models import GeneOverride
from utils.validation import require_columns, require_equal_length, require_file

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data_raw" / "hughes_2009"
PUBLIC_DATA_DIR = ROOT / "public_data"
GENES_DIR = PUBLIC_DATA_DIR / "genes"
DATASETS_DIR = PUBLIC_DATA_DIR / "datasets"
PROFILES_DIR = PUBLIC_DATA_DIR / "profiles" / "hughes-2009"
INDEX_DIR = PUBLIC_DATA_DIR / "index"
DOWNLOADS_DIR = PUBLIC_DATA_DIR / "downloads" / "hughes-2009"

RAW_JTK_PATH = RAW_DIR / "hughes2009_liver48_jtk_gene_best_probe_ranked.csv"
RAW_EXPR_PATH = RAW_DIR / "gse11923_expr_probe_x_sample.csv"
RAW_PHENO_PATH = RAW_DIR / "gse11923_pheno_data.csv"
RAW_GENE_METADATA_PATH = RAW_DIR / "gene_metadata_overrides.csv"

DATASET_ID = "hughes-2009"
DATASET_SLUG = "hughes-2009"
DATASET_TITLE = "Hughes et al. 2009 Mouse Liver 48h"
DATASET_CITATION = (
    "Hughes ME, DiTacchio L, Hayes KR, Vollmers C, Pulivarthy S, Baggs JE, Panda S, "
    "Hogenesch JB. Harmonics of circadian gene transcription in mammals. "
    "PLoS Genetics. 2009;5(4):e1000442."
)
DATASET_DESCRIPTION = (
    "Seed CircaDB 2.0 dataset built from the Hughes et al. 2009 mouse liver 48-hour "
    "microarray time-course (GSE11923). The proof of concept uses the same general "
    "Gene / Dataset / GeneDatasetProfile model that future datasets will plug into."
)
FEATURED_GENE_ORDER = ["Per2", "Arntl", "Dbp"]
JTK_REQUIRED_COLUMNS = [
    "gene_symbol_mouse",
    "probe_id",
    "JTK_pvalue",
    "JTK_BH.Q",
    "JTK_period",
    "JTK_adjphase",
    "JTK_amplitude",
]
PHENO_REQUIRED_COLUMNS = ["geo_accession", "title"]
TIMEPOINT_PATTERN = re.compile(r"Circadian time (\d+)")
INVALID_SYMBOL_TOKENS = {"---", "NA", "N/A", "NULL"}
FIT_PERIOD_HOURS = 24.0
FIT_STEP_HOURS = 0.25
TIME_AXIS_LABEL = "Circadian time (CT, hours)"


def symbol_to_slug(symbol: str) -> str:
    return symbol.upper().replace("/", "-").replace(" ", "-")


def split_symbol(raw_symbol: str) -> tuple[str, list[str]]:
    tokens = [token.strip() for token in raw_symbol.split("///") if token.strip()]
    if not tokens:
        raise ValueError(f"Malformed symbol value: {raw_symbol!r}")
    return tokens[0], tokens[1:]


def is_canonical_gene_symbol(symbol: str) -> bool:
    if not symbol:
        return False
    if symbol.upper() in INVALID_SYMBOL_TOKENS:
        return False
    return any(character.isalnum() for character in symbol)


def load_gene_overrides(path: Path) -> dict[str, GeneOverride]:
    require_file(path)
    rows = read_csv(path)
    require_columns(path, rows, ["symbol", "name", "aliases", "entrez_id", "refseq_rna"])
    overrides: dict[str, GeneOverride] = {}
    for row in rows:
        symbol = row["symbol"].strip()
        aliases = [item.strip() for item in row["aliases"].split(";") if item.strip()]
        overrides[symbol] = GeneOverride(
            symbol=symbol,
            name=row["name"].strip(),
            aliases=aliases,
            entrez_id=row["entrez_id"].strip() or None,
            refseq_rna=row["refseq_rna"].strip() or None,
        )
    return overrides


def parse_timepoint(title: str) -> float:
    match = TIMEPOINT_PATTERN.search(title)
    if not match:
        raise ValueError(f"Could not parse circadian time from sample title: {title}")
    return float(match.group(1))


def load_sample_timepoints(path: Path) -> dict[str, float]:
    require_file(path)
    rows = read_csv(path)
    require_columns(path, rows, PHENO_REQUIRED_COLUMNS)
    return {
        row["geo_accession"].strip(): parse_timepoint(row["title"].strip())
        for row in rows
        if row["geo_accession"].strip()
    }


def empty_algorithm_payload() -> dict[str, object]:
    return {
        "available": False,
        "phase": None,
        "amplitude": None,
        "period": None,
        "power": None,
        "p_value": None,
        "q_value": None,
        "rhythmic": None,
    }


def solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float]:
    augmented = [row[:] + [value] for row, value in zip(matrix, vector)]
    size = len(augmented)

    for pivot_index in range(size):
        pivot_row = max(
            range(pivot_index, size),
            key=lambda row_index: abs(augmented[row_index][pivot_index]),
        )
        pivot_value = augmented[pivot_row][pivot_index]
        if abs(pivot_value) < 1e-12:
            raise ValueError("Could not solve cosinor fit because the design matrix is singular.")

        augmented[pivot_index], augmented[pivot_row] = (
            augmented[pivot_row],
            augmented[pivot_index],
        )
        pivot_value = augmented[pivot_index][pivot_index]

        for column_index in range(pivot_index, size + 1):
            augmented[pivot_index][column_index] /= pivot_value

        for row_index in range(size):
            if row_index == pivot_index:
                continue

            factor = augmented[row_index][pivot_index]
            if factor == 0:
                continue

            for column_index in range(pivot_index, size + 1):
                augmented[row_index][column_index] -= (
                    factor * augmented[pivot_index][column_index]
                )

    return [augmented[row_index][size] for row_index in range(size)]


def build_fit_timepoints(
    start_time: float,
    end_time: float,
    step_hours: float,
) -> list[float]:
    if start_time >= end_time:
        return [round(start_time, 4)]

    fit_timepoints: list[float] = []
    step_index = 0
    while True:
        value = start_time + step_index * step_hours
        if value >= end_time - 1e-9:
            break
        fit_timepoints.append(round(value, 4))
        step_index += 1

    fit_timepoints.append(round(end_time, 4))
    return fit_timepoints


def compute_cosinor_fit(
    timepoints: list[float],
    expression_values: list[float],
    period_hours: float = FIT_PERIOD_HOURS,
    step_hours: float = FIT_STEP_HOURS,
) -> dict[str, object]:
    omega = (2.0 * math.pi) / period_hours
    cosine_terms = [math.cos(omega * timepoint) for timepoint in timepoints]
    sine_terms = [math.sin(omega * timepoint) for timepoint in timepoints]
    cosine_sum = sum(cosine_terms)
    sine_sum = sum(sine_terms)
    cosine_sine_sum = sum(
        cosine * sine for cosine, sine in zip(cosine_terms, sine_terms)
    )

    matrix = [
        [float(len(timepoints)), cosine_sum, sine_sum],
        [
            cosine_sum,
            sum(cosine * cosine for cosine in cosine_terms),
            cosine_sine_sum,
        ],
        [
            sine_sum,
            cosine_sine_sum,
            sum(sine * sine for sine in sine_terms),
        ],
    ]
    vector = [
        sum(expression_values),
        sum(value * cosine for value, cosine in zip(expression_values, cosine_terms)),
        sum(value * sine for value, sine in zip(expression_values, sine_terms)),
    ]
    baseline, cosine_beta, sine_beta = solve_linear_system(matrix, vector)

    fit_timepoints = build_fit_timepoints(
        start_time=min(timepoints),
        end_time=max(timepoints),
        step_hours=step_hours,
    )
    fit_values = [
        round(
            baseline
            + cosine_beta * math.cos(omega * timepoint)
            + sine_beta * math.sin(omega * timepoint),
            6,
        )
        for timepoint in fit_timepoints
    ]
    phase_radians = math.atan2(sine_beta, cosine_beta)
    phase_hours = (phase_radians / omega) % period_hours

    return {
        "fit_timepoints": fit_timepoints,
        "fit_values": fit_values,
        "baseline": round(baseline, 6),
        "amplitude": round(math.hypot(cosine_beta, sine_beta), 6),
        "phase_hours": round(phase_hours, 6),
        "period_hours": period_hours,
    }


def load_jtk_rows(path: Path) -> list[dict[str, object]]:
    require_file(path)
    rows = read_csv(path)
    require_columns(path, rows, JTK_REQUIRED_COLUMNS)
    parsed_rows: list[dict[str, object]] = []
    for row in rows:
        canonical_symbol, aliases = split_symbol(row["gene_symbol_mouse"].strip())
        if not is_canonical_gene_symbol(canonical_symbol):
            continue
        parsed_rows.append(
            {
                "symbol": canonical_symbol,
                "raw_symbol": row["gene_symbol_mouse"].strip(),
                "aliases": aliases,
                "probe_id": row["probe_id"].strip(),
                "jtk_p_value": float(row["JTK_pvalue"]),
                "jtk_q_value": float(row["JTK_BH.Q"]),
                "jtk_period": float(row["JTK_period"]),
                "jtk_phase": float(row["JTK_adjphase"]) if row["JTK_adjphase"] else None,
                "jtk_amplitude": float(row["JTK_amplitude"]),
            }
        )
    return parsed_rows


def load_expression_rows(path: Path, target_probe_ids: set[str], sample_timepoints: dict[str, float]) -> tuple[list[str], list[float], dict[str, list[float]]]:
    require_file(path)
    probe_to_values: dict[str, list[float]] = {}
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        sample_ids = [sample.strip().strip('"') for sample in header[1:]]
        timepoints = [sample_timepoints[sample_id] for sample_id in sample_ids]
        for row in reader:
            probe_id = row[0].strip().strip('"')
            if probe_id not in target_probe_ids:
                continue
            values = [float(value) for value in row[1:]]
            require_equal_length(probe_id, timepoints, values)
            probe_to_values[probe_id] = values
    missing = target_probe_ids - probe_to_values.keys()
    if missing:
        preview = ", ".join(sorted(missing)[:5])
        raise ValueError(f"Expression matrix is missing expected probes: {preview}")
    return sample_ids, timepoints, probe_to_values


def build_dataset_record(genes: list[dict[str, object]], sample_ids: list[str], timepoints: list[float]) -> dict[str, object]:
    available_slugs = {gene["slug"] for gene in genes}
    featured_genes = [symbol_to_slug(symbol) for symbol in FEATURED_GENE_ORDER if symbol_to_slug(symbol) in available_slugs]
    return {
        "id": DATASET_ID,
        "slug": DATASET_SLUG,
        "title": DATASET_TITLE,
        "citation": DATASET_CITATION,
        "species": "Mus musculus",
        "tissue": "Liver",
        "platform": "Affymetrix Mouse Genome 430 2.0 Array (GPL1261)",
        "sampling_interval_hours": 1,
        "number_of_timepoints": len(timepoints),
        "description": DATASET_DESCRIPTION,
        "source_files": [
            "data_raw/hughes_2009/hughes2009_liver48_jtk_gene_best_probe_ranked.csv",
            "data_raw/hughes_2009/gse11923_expr_probe_x_sample.csv",
            "data_raw/hughes_2009/gse11923_pheno_data.csv",
            "data_raw/hughes_2009/gene_metadata_overrides.csv",
        ],
        "downloads": [
            {
                "label": "Best-probe rhythmic metrics (CSV)",
                "href": "/public_data/downloads/hughes-2009/hughes2009_liver48_jtk_gene_best_probe_ranked.csv",
            },
            {
                "label": "Expression matrix (CSV)",
                "href": "/public_data/downloads/hughes-2009/gse11923_expr_probe_x_sample.csv",
            },
            {
                "label": "Sample metadata (CSV)",
                "href": "/public_data/downloads/hughes-2009/gse11923_pheno_data.csv",
            },
            {
                "label": "Dataset record (JSON)",
                "href": "/public_data/datasets/hughes-2009.json",
            },
        ],
        "featured_genes": featured_genes,
        "number_of_genes": len(genes),
        "supported_algorithms": list(SUPPORTED_ALGORITHMS.keys()),
        "loaded_algorithms": [DEFAULT_ALGORITHM_ID],
        "metadata": {
            "paper_year": 2009,
            "paper_journal": "PLoS Genetics",
            "geo_accession": "GSE11923",
            "dataset_scope": "Single proof-of-concept dataset loaded into a general CircaDB engine.",
            "sample_ids": sample_ids,
            "time_axis_label": TIME_AXIS_LABEL,
            "time_axis_kind": "circadian_time",
            "cycle_length_hours": FIT_PERIOD_HOURS,
        },
    }


def clean_public_data_dir() -> None:
    for path in [GENES_DIR, DATASETS_DIR, PROFILES_DIR, INDEX_DIR, DOWNLOADS_DIR]:
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)


def build() -> None:
    require_file(RAW_JTK_PATH)
    require_file(RAW_EXPR_PATH)
    require_file(RAW_PHENO_PATH)
    require_file(RAW_GENE_METADATA_PATH)

    overrides = load_gene_overrides(RAW_GENE_METADATA_PATH)
    jtk_rows = load_jtk_rows(RAW_JTK_PATH)
    sample_timepoints = load_sample_timepoints(RAW_PHENO_PATH)
    probe_ids = {row["probe_id"] for row in jtk_rows}
    sample_ids, timepoints, probe_to_values = load_expression_rows(
        RAW_EXPR_PATH,
        probe_ids,
        sample_timepoints,
    )

    genes: list[dict[str, object]] = []
    dataset_gene_samples: list[dict[str, object]] = []
    criteria_index_rows: list[dict[str, object]] = []
    for row in jtk_rows:
        symbol = str(row["symbol"])
        slug = symbol_to_slug(symbol)
        override = overrides.get(symbol)
        aliases = sorted(set(row["aliases"]) | set(override.aliases if override else []))
        external_ids: dict[str, str] = {}
        if override and override.entrez_id:
            external_ids["entrez_gene"] = override.entrez_id
        if override and override.refseq_rna:
            external_ids["refseq_rna"] = override.refseq_rna

        algorithms = {
            algorithm_id: empty_algorithm_payload()
            for algorithm_id in SUPPORTED_ALGORITHMS
        }
        algorithms["jtk_cycle"] = {
            "available": True,
            "phase": row["jtk_phase"],
            "amplitude": row["jtk_amplitude"],
            "period": row["jtk_period"],
            "power": None,
            "p_value": row["jtk_p_value"],
            "q_value": row["jtk_q_value"],
            "rhythmic": row["jtk_q_value"] <= 0.05,
        }
        expression_values = probe_to_values[str(row["probe_id"])]
        cosinor_fit = compute_cosinor_fit(timepoints, expression_values)

        profile_record = {
            "gene_id": f"mmu:{slug.lower()}",
            "dataset_id": DATASET_ID,
            "symbol": symbol,
            "algorithms": algorithms,
            "timepoints": timepoints,
            "expression_values": expression_values,
            "fit_timepoints": cosinor_fit["fit_timepoints"],
            "fit_values": cosinor_fit["fit_values"],
            "units": "MAS5 expression intensity",
            "metadata": {
                "species": "Mus musculus",
                "tissue": "Liver",
                "platform": "Affymetrix Mouse Genome 430 2.0 Array (GPL1261)",
                "selected_probeset_id": row["probe_id"],
                "source_symbol": row["raw_symbol"],
                "available_algorithm_ids": [DEFAULT_ALGORITHM_ID],
                "supported_algorithm_ids": list(SUPPORTED_ALGORITHMS.keys()),
                "sample_ids": sample_ids,
                "time_axis_label": TIME_AXIS_LABEL,
                "time_axis_kind": "circadian_time",
                "cycle_length_hours": FIT_PERIOD_HOURS,
                "fit_method": "24 h cosinor least-squares fit",
                "fit_period_hours": cosinor_fit["period_hours"],
                "fit_baseline": cosinor_fit["baseline"],
                "fit_amplitude": cosinor_fit["amplitude"],
                "fit_phase_hours": cosinor_fit["phase_hours"],
                "source_files": [
                    RAW_JTK_PATH.name,
                    RAW_EXPR_PATH.name,
                    RAW_PHENO_PATH.name,
                ],
            },
        }

        gene_record = {
            "id": f"mmu:{slug.lower()}",
            "symbol": symbol,
            "name": override.name if override else symbol,
            "aliases": aliases,
            "species": "Mus musculus",
            "external_ids": external_ids,
            "available_datasets": [
                {
                    "id": DATASET_ID,
                    "slug": DATASET_SLUG,
                    "title": DATASET_TITLE,
                    "profile_path": f"/public_data/profiles/{DATASET_SLUG}/{slug}.json",
                }
            ],
        }

        genes.append({"slug": slug, "gene": gene_record, "profile": profile_record})
        dataset_gene_samples.append(
            {
                "symbol": symbol,
                "name": gene_record["name"],
                "profile_path": f"/public_data/profiles/{DATASET_SLUG}/{slug}.json",
                "gene_path": f"/gene/{slug}?dataset={DATASET_SLUG}",
            }
        )
        criteria_index_rows.append(
            {
                "symbol": symbol,
                "name": gene_record["name"],
                "aliases": aliases,
                "dataset_id": DATASET_ID,
                "algorithm": DEFAULT_ALGORITHM_ID,
                "phase": row["jtk_phase"],
                "amplitude": row["jtk_amplitude"],
                "period": row["jtk_period"],
                "p_value": row["jtk_p_value"],
                "q_value": row["jtk_q_value"],
                "rhythmic": row["jtk_q_value"] <= 0.05,
            }
        )

    clean_public_data_dir()
    for raw_path in [RAW_JTK_PATH, RAW_EXPR_PATH, RAW_PHENO_PATH]:
        shutil.copy2(raw_path, DOWNLOADS_DIR / raw_path.name)

    dataset_record = build_dataset_record(genes, sample_ids, timepoints)
    dataset_record["example_genes"] = [
        sample for sample in dataset_gene_samples if sample["symbol"] in FEATURED_GENE_ORDER
    ] or dataset_gene_samples[:3]

    for gene_payload in genes:
        slug = gene_payload["slug"]
        write_json(GENES_DIR / f"{slug}.json", gene_payload["gene"])
        write_json(PROFILES_DIR / f"{slug}.json", gene_payload["profile"])

    write_json(DATASETS_DIR / f"{DATASET_SLUG}.json", dataset_record)
    write_json_compact(
        INDEX_DIR / "genes.json",
        [
            {
                "symbol": gene_payload["gene"]["symbol"],
                "slug": gene_payload["slug"],
                "name": gene_payload["gene"]["name"],
                "aliases": gene_payload["gene"]["aliases"],
                "probe_ids": [
                    gene_payload["profile"]["metadata"]["selected_probeset_id"]
                ],
                "species": gene_payload["gene"]["species"],
                "available_datasets": [DATASET_ID],
            }
            for gene_payload in genes
        ],
    )
    write_json_compact(
        INDEX_DIR / "datasets.json",
        [
            {
                "id": dataset_record["id"],
                "slug": dataset_record["slug"],
                "title": dataset_record["title"],
                "species": dataset_record["species"],
                "tissue": dataset_record["tissue"],
                "platform": dataset_record["platform"],
            }
        ],
    )
    write_json_compact(
        INDEX_DIR / "hughes-2009-jtk.json",
        sorted(
            criteria_index_rows,
            key=lambda row: (row["q_value"], row["p_value"], row["symbol"]),
        ),
    )
    print(f"Built {len(genes)} genes into {PUBLIC_DATA_DIR}")


if __name__ == "__main__":
    build()
