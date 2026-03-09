from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class RawProfileRow:
    probeset_id: str
    source_symbol: str
    canonical_symbol: str
    aliases: list[str]
    timepoints: list[float]
    expression_values: list[float]
    jtk_p_value: float
    jtk_q_value: float
    jtk_period: float
    jtk_phase: float
    tissue: str


@dataclass(slots=True)
class GeneOverride:
    symbol: str
    name: str
    aliases: list[str] = field(default_factory=list)
    entrez_id: str | None = None
    refseq_rna: str | None = None
