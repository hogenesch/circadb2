from __future__ import annotations

SUPPORTED_ALGORITHMS = {
    "jtk_cycle": {
        "label": "JTK_CYCLE",
        "description": "Loaded from the Hughes 2009 CircaDB export.",
    },
    "ejtk": {
        "label": "eJTK",
        "description": "Schema supported; not populated by the seed export.",
    },
    "lomb_scargle": {
        "label": "Lomb-Scargle",
        "description": "Schema supported; not populated by the seed export.",
    },
    "arser": {
        "label": "ARSER",
        "description": "Schema supported; not populated by the seed export.",
    },
    "rain": {
        "label": "RAIN",
        "description": "Schema supported; not populated by the seed export.",
    },
    "metacycle": {
        "label": "MetaCycle",
        "description": "Schema supported; not populated by the seed export.",
    },
}

DEFAULT_ALGORITHM_ID = "jtk_cycle"
