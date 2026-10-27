# Engineering rules

Rules in this directory define deterministic comparisons, not engineering design checks. Each rule must have a stable code, version, explicit preconditions, evidence requirements, severity, and tests for positive, negative, and ambiguous cases.

## Initial rule

### `BEAM_SHAPE_MISMATCH` (version 1)

- **Inputs:** one accepted engineer beam row and one accepted shop beam row with the same normalized member mark.
- **Preconditions:** each source has exactly one accepted row for the mark; both shape designations are non-empty and parseable by the approved conservative canonicalizer.
- **Check:** compare canonical AISC shape designations; do not infer structural equivalence.
- **Finding:** emit one `warning` when values differ, retaining both raw values and source page references.
- **No finding:** equal canonical identifiers.
- **Ambiguity:** duplicate mark, missing shape designation, or notation the canonicalizer does not support produces a review warning/error state, not a guessed mismatch decision.
- **Limit:** identifies a schedule discrepancy only; it does not determine whether a substitution is acceptable or structurally adequate.

Rule behavior is described in [Data model and matching](../docs/DATA_MODEL.md#6-matching-and-normalization). Implement executable rules under the backend rule-engine module and version each ruleset used by a comparison.
