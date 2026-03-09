from __future__ import annotations

from pathlib import Path


def require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Required input file is missing: {path}")


def require_columns(path: Path, rows: list[dict[str, str]], required_columns: list[str]) -> None:
    if not rows:
        raise ValueError(f"{path} is empty.")

    available = set(rows[0].keys())
    missing = [column for column in required_columns if column not in available]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"{path} is missing required columns: {joined}")


def require_equal_length(symbol: str, timepoints: list[float], values: list[float]) -> None:
    if len(timepoints) != len(values):
        raise ValueError(
            f"{symbol} has {len(timepoints)} timepoints but {len(values)} expression values."
        )
