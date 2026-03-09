from __future__ import annotations

import csv
import re
import shutil
from pathlib import Path

import numpy as np
from scipy.interpolate import PchipInterpolator
from statsmodels.nonparametric.smoothers_lowess import lowess

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
CYCLE_LENGTH_HOURS = 24.0
FIT_POINT_COUNT = 160
LOWESS_FRAC = 0.5
LOWESS_ROBUST_ITERS = 3
PILOT_GENES = {"NR1D1", "ARNTL", "PER2", "DBP"}
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


def build_fit_timepoints(
    start_time: float,
    end_time: float,
    point_count: int,
) -> list[float]:
    if start_time >= end_time or point_count <= 1:
        return [round(start_time, 4)]

    step = (end_time - start_time) / float(point_count - 1)
    return [
        round(start_time + point_index * step, 4)
        for point_index in range(point_count)
    ]


def compute_lowess_fit(
    timepoints: list[float],
    expression_values: list[float],
    dense_point_count: int = FIT_POINT_COUNT,
    cycle_length_hours: float = CYCLE_LENGTH_HOURS,
    frac: float = LOWESS_FRAC,
    robust_iterations: int = LOWESS_ROBUST_ITERS,
) -> dict[str, object] | None:
    if len(timepoints) < 3 or len(expression_values) < 3:
        return None

    observed_pairs = sorted(
        zip(timepoints, expression_values),
        key=lambda pair: pair[0],
    )
    sorted_timepoints = [float(timepoint) for timepoint, _ in observed_pairs]
    sorted_values = [float(value) for _, value in observed_pairs]
    fit_timepoints = build_fit_timepoints(
        start_time=sorted_timepoints[0],
        end_time=sorted_timepoints[-1],
        point_count=dense_point_count,
    )
    phase_to_values: dict[float, list[float]] = {}
    for timepoint, value in observed_pairs:
        phase = round(timepoint % cycle_length_hours, 6)
        phase_to_values.setdefault(phase, []).append(value)

    phase_points = sorted(phase_to_values)
    if len(phase_points) < 4:
        return None

    phase_values = [
        sum(phase_to_values[phase]) / len(phase_to_values[phase])
        for phase in phase_points
    ]
    extended_phase_points = (
        [phase - cycle_length_hours for phase in phase_points]
        + phase_points
        + [phase + cycle_length_hours for phase in phase_points]
    )
    extended_phase_values = phase_values * 3

    try:
        smoothed_pairs = lowess(
            endog=extended_phase_values,
            exog=extended_phase_points,
            frac=frac,
            it=robust_iterations,
            return_sorted=True,
        )
    except Exception:
        return None

    central_phase_points: list[float] = []
    central_phase_values: list[float] = []
    for x_value, y_value in smoothed_pairs.tolist():
        x_number = float(x_value)
        if 0.0 <= x_number <= cycle_length_hours:
            central_phase_points.append(x_number)
            central_phase_values.append(float(y_value))

    if not central_phase_points or not central_phase_values:
        return None

    interpolation_x = central_phase_points[:]
    interpolation_y = central_phase_values[:]
    if interpolation_x[-1] < cycle_length_hours:
        interpolation_x.append(cycle_length_hours)
        interpolation_y.append(central_phase_values[0])
    elif interpolation_x[-1] == cycle_length_hours:
        interpolation_y[-1] = central_phase_values[0]

    fit_phases = [timepoint % cycle_length_hours for timepoint in fit_timepoints]
    dense_values = np.interp(fit_phases, interpolation_x, interpolation_y)
    return {
        "fit_method": "lowess",
        "fit_timepoints": fit_timepoints,
        "fit_values": [round(float(value), 6) for value in dense_values.tolist()],
    }


def compute_unwrapped_lowess_fit(
    timepoints: list[float],
    expression_values: list[float],
    dense_point_count: int = FIT_POINT_COUNT,
    frac: float = LOWESS_FRAC,
    robust_iterations: int = LOWESS_ROBUST_ITERS,
) -> dict[str, object] | None:
    if len(timepoints) < 3 or len(expression_values) < 3:
        return None

    observed_pairs = sorted(
        zip(timepoints, expression_values),
        key=lambda pair: pair[0],
    )
    sorted_timepoints = np.array([float(timepoint) for timepoint, _ in observed_pairs])
    sorted_values = np.array([float(value) for _, value in observed_pairs])
    fit_timepoints = np.linspace(
        sorted_timepoints[0],
        sorted_timepoints[-1],
        dense_point_count,
    )

    try:
        fit_values = lowess(
            endog=sorted_values,
            exog=sorted_timepoints,
            xvals=fit_timepoints,
            frac=frac,
            it=robust_iterations,
            return_sorted=False,
        )
    except Exception:
        return None

    return {
        "fit_method": "lowess",
        "fit_timepoints": [round(float(value), 4) for value in fit_timepoints.tolist()],
        "fit_values": [round(float(value), 6) for value in fit_values.tolist()],
    }


def compute_pchip_fit(
    timepoints: list[float],
    expression_values: list[float],
    dense_point_count: int = FIT_POINT_COUNT,
) -> dict[str, object] | None:
    if len(timepoints) < 2 or len(expression_values) < 2:
        return None

    observed_pairs = sorted(
        zip(timepoints, expression_values),
        key=lambda pair: pair[0],
    )
    sorted_timepoints = np.array([float(timepoint) for timepoint, _ in observed_pairs])
    sorted_values = np.array([float(value) for _, value in observed_pairs])
    fit_timepoints = np.linspace(
        sorted_timepoints[0],
        sorted_timepoints[-1],
        dense_point_count,
    )

    try:
        interpolator = PchipInterpolator(sorted_timepoints, sorted_values)
        fit_values = interpolator(fit_timepoints)
    except Exception:
        return None

    return {
        "fit_method": "pchip",
        "fit_timepoints": [round(float(value), 4) for value in fit_timepoints.tolist()],
        "fit_values": [round(float(value), 6) for value in fit_values.tolist()],
    }
    

def build_display_variants(
    timepoints: list[float],
    expression_values: list[float],
) -> dict[str, object]:
    variants: dict[str, object] = {
        "observed_only": {
            "timepoints": [round(float(value), 4) for value in timepoints],
            "values": [round(float(value), 6) for value in expression_values],
        }
    }

    lowess_fit = compute_unwrapped_lowess_fit(timepoints, expression_values)
    if lowess_fit:
        variants["lowess"] = lowess_fit

    pchip_fit = compute_pchip_fit(timepoints, expression_values)
    if pchip_fit:
        variants["pchip"] = pchip_fit

    return variants


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
            "cycle_length_hours": CYCLE_LENGTH_HOURS,
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

    jtk_rows = load_jtk_rows(RAW_JTK_PATH)
    sample_timepoints = load_sample_timepoints(RAW_PHENO_PATH)
    probe_ids = {row["probe_id"] for row in jtk_rows}
    sample_ids, timepoints, probe_to_values = load_expression_rows(
        RAW_EXPR_PATH,
        probe_ids,
        sample_timepoints,
    )

    pilot_rows = [
        row for row in jtk_rows if str(row["symbol"]).upper() in PILOT_GENES
    ]
    matched_symbols = {str(row["symbol"]).upper() for row in pilot_rows}
    missing_pilot_genes = sorted(PILOT_GENES - matched_symbols)
    if missing_pilot_genes:
        missing = ", ".join(missing_pilot_genes)
        raise ValueError(f"Could not find pilot genes in Hughes 2009 input: {missing}")

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    regenerated_paths: list[Path] = []
    for row in pilot_rows:
        symbol = str(row["symbol"])
        slug = symbol_to_slug(symbol)

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
        display_variants = build_display_variants(timepoints, expression_values)
        lowess_fit = compute_lowess_fit(timepoints, expression_values)

        profile_record = {
            "gene_id": f"mmu:{slug.lower()}",
            "dataset_id": DATASET_ID,
            "symbol": symbol,
            "algorithms": algorithms,
            "timepoints": timepoints,
            "expression_values": expression_values,
            "display_variants": display_variants,
            "fit_method": lowess_fit["fit_method"] if lowess_fit else None,
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
                "cycle_length_hours": CYCLE_LENGTH_HOURS,
                "fit_display_method": "LOWESS visual smoothing",
                "fit_display_frac": LOWESS_FRAC,
                "fit_display_robust_iterations": LOWESS_ROBUST_ITERS,
                "display_variant_methods": [
                    "observed_only",
                    "lowess",
                    "pchip",
                ],
                "source_files": [
                    RAW_JTK_PATH.name,
                    RAW_EXPR_PATH.name,
                    RAW_PHENO_PATH.name,
                ],
            },
        }
        if lowess_fit:
            profile_record["fit_timepoints"] = lowess_fit["fit_timepoints"]
            profile_record["fit_values"] = lowess_fit["fit_values"]

        output_path = PROFILES_DIR / f"{slug}.json"
        write_json(output_path, profile_record)
        regenerated_paths.append(output_path)

    print("Regenerated pilot gene profiles:")
    for path in regenerated_paths:
        print(path)


if __name__ == "__main__":
    build()
