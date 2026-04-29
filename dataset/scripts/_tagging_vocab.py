"""
Closed vocabularies for 3-axis labeling (metaphor / operation / motif) + VAD.

Imported by lit chunk labelers, choice taggers, and narrative log analyzers
to keep label space identical across streams (lit_rag, items_rag, choices,
narrative_logs). LLMs pick labels from these lists only — anything else is
captured under a `novel_*` field for periodic vocab review.
"""
from typing import Iterable


# --- 28 defenses (mirrors twr/data/defenses.ts) ----------------------------
DEFENSES: tuple[str, ...] = (
    'Acting Out', 'Affiliation', 'Altruism', 'Anticipation', 'Apathetic Withdrawal',
    'Autistic Fantasy', 'Denial', 'Devaluation', 'Displacement', 'Dissociation',
    'Help-Rejecting Complaining', 'Humor', 'Idealization', 'Intellectualization',
    'Isolation of Affect', 'Omnipotence', 'Passive Aggression', 'Projection',
    'Projective Identification', 'Rationalization', 'Reaction Formation', 'Repression',
    'Self-Assertion', 'Self-Observation', 'Splitting', 'Sublimation', 'Suppression', 'Undoing',
)

VAILLANT_LEVEL: dict[str, str] = {
    'Acting Out': 'immature', 'Affiliation': 'mature', 'Altruism': 'mature',
    'Anticipation': 'mature', 'Apathetic Withdrawal': 'immature',
    'Autistic Fantasy': 'immature', 'Denial': 'psychotic', 'Devaluation': 'neurotic',
    'Displacement': 'neurotic', 'Dissociation': 'neurotic',
    'Help-Rejecting Complaining': 'immature', 'Humor': 'mature',
    'Idealization': 'neurotic', 'Intellectualization': 'neurotic',
    'Isolation of Affect': 'neurotic', 'Omnipotence': 'psychotic',
    'Passive Aggression': 'immature', 'Projection': 'immature',
    'Projective Identification': 'neurotic', 'Rationalization': 'neurotic',
    'Reaction Formation': 'neurotic', 'Repression': 'neurotic',
    'Self-Assertion': 'mature', 'Self-Observation': 'mature',
    'Splitting': 'psychotic', 'Sublimation': 'mature', 'Suppression': 'mature',
    'Undoing': 'neurotic',
}


# --- Axis A: METAPHOR (structural form, 10) --------------------------------
METAPHORS: tuple[str, ...] = (
    'spatial-distance',        # near/far, proximity vs remoteness
    'temporal-rupture',        # broken, jumped, suspended, looped time
    'embodied-displacement',   # body relocates / leaves / depersonalizes
    'containment',             # enclosing, holding inside, sealed
    'absence-void',            # missing, hollow, blank, erased
    'mirror-fragmentation',    # split, multiple, reflected, doubled self
    'displaced-agency',        # action attributed to other / impulse / fate
    'theatrical-mask',         # performance, face, surface vs interior
    'repetition-loop',         # recurrence without resolution
    'threshold-liminality',    # door, edge, between-state, almost
)

# --- Axis B: OPERATION (directional action, 10) ----------------------------
OPERATIONS: tuple[str, ...] = (
    'approach', 'avoid', 'conceal', 'split', 'repeat',
    'transfer', 'freeze', 'reverse', 'merge', 'negate',
)

# --- Axis C: MOTIF (concrete imagery, 41) ----------------------------------
# Grouped here for readability; the flat tuple is the canonical interface.
MOTIFS: tuple[str, ...] = (
    # architectural
    'door', 'window', 'wall', 'threshold', 'corridor', 'stairs', 'basement', 'attic',
    'room', 'bed',
    # surfaces / objects
    'mirror', 'photograph', 'letter', 'screen', 'book', 'key', 'lock', 'box',
    'phone', 'clock',
    # body / sense
    'face', 'hand', 'eye', 'mouth', 'voice', 'skin', 'wound',
    # figures
    'mother', 'father', 'child', 'stranger', 'crowd', 'absent-figure', 'double',
    # elements
    'water', 'fire', 'light', 'darkness', 'fog',
    # symbolic
    'mask', 'shadow',
)

MOTIF_GROUPS: dict[str, tuple[str, ...]] = {
    'architectural': ('door', 'window', 'wall', 'threshold', 'corridor', 'stairs',
                      'basement', 'attic', 'room', 'bed'),
    'surface_object': ('mirror', 'photograph', 'letter', 'screen', 'book', 'key',
                       'lock', 'box', 'phone', 'clock'),
    'body_sense':     ('face', 'hand', 'eye', 'mouth', 'voice', 'skin', 'wound'),
    'figure':         ('mother', 'father', 'child', 'stranger', 'crowd',
                       'absent-figure', 'double'),
    'element':        ('water', 'fire', 'light', 'darkness', 'fog'),
    'symbolic':       ('mask', 'shadow'),
}


# --- VAD (NRC-VAD convention; all axes in [0, 1]) --------------------------
VAD_FIELDS: tuple[str, ...] = ('valence', 'arousal', 'dominance')
VAD_MIN: float = 0.0
VAD_MAX: float = 1.0


# --- Empath (Fast et al., CHI 2016) defense hints --------------------------
# Soft prior only — used to enrich LLM reasoning context and as ranking
# tiebreaker, NOT as hard rule. Each empath category points to candidate
# defenses ordered by typical strength of association.
# Empath package version 0.89 ships 194 categories; we map the subset that
# carries reliable defense-relevant signal.
EMPATH_DEFENSE_HINTS: dict[str, tuple[str, ...]] = {
    # impulse / discharge
    'violence':              ('Acting Out', 'Passive Aggression'),
    'rage':                  ('Acting Out', 'Displacement'),
    'aggression':            ('Acting Out', 'Passive Aggression'),
    'fight':                 ('Acting Out', 'Self-Assertion'),
    'kill':                  ('Acting Out',),
    'weapon':                ('Acting Out',),
    'crime':                 ('Acting Out',),
    'breaking':              ('Acting Out',),
    'swearing_terms':        ('Acting Out', 'Devaluation'),
    'anger':                 ('Acting Out', 'Passive Aggression', 'Displacement'),
    # withdrawal / shutdown
    'neglect':               ('Apathetic Withdrawal', 'Repression'),
    'cold':                  ('Apathetic Withdrawal', 'Isolation of Affect'),
    'sadness':               ('Apathetic Withdrawal', 'Repression'),
    'sleep':                 ('Apathetic Withdrawal',),
    'timidity':              ('Apathetic Withdrawal', 'Repression'),
    'fear':                  ('Repression', 'Apathetic Withdrawal'),
    # self-devaluation / complaint
    'shame':                 ('Devaluation',),
    'disappointment':        ('Devaluation', 'Help-Rejecting Complaining'),
    'weakness':              ('Devaluation',),
    'ugliness':              ('Devaluation',),
    'suffering':             ('Help-Rejecting Complaining', 'Devaluation'),
    'pain':                  ('Help-Rejecting Complaining',),
    'irritability':          ('Passive Aggression', 'Help-Rejecting Complaining'),
    'exasperation':          ('Passive Aggression',),
    # grandiosity / power
    'pride':                 ('Omnipotence', 'Idealization'),
    'dominant_personality':  ('Omnipotence',),
    'dominant_heirarchical': ('Omnipotence',),
    'power':                 ('Omnipotence',),
    'leader':                ('Omnipotence', 'Idealization'),
    'heroic':                ('Idealization', 'Omnipotence'),
    'superhero':             ('Omnipotence', 'Autistic Fantasy'),
    # mature / adaptive
    'optimism':              ('Anticipation', 'Humor'),
    'sympathy':              ('Altruism', 'Affiliation'),
    'help':                  ('Altruism', 'Affiliation'),
    'giving':                ('Altruism',),
    'trust':                 ('Affiliation',),
    'friends':               ('Affiliation',),
    'affection':             ('Affiliation',),
    'love':                  ('Affiliation', 'Idealization'),
    'joy':                   ('Humor', 'Affiliation'),
    'contentment':           ('Suppression', 'Humor'),
    # neurotic / cognitive
    'philosophy':            ('Intellectualization',),
    'science':               ('Intellectualization',),
    'order':                 ('Undoing', 'Intellectualization'),
    'cleaning':              ('Undoing',),
    'hygiene':               ('Undoing', 'Reaction Formation'),
    'politeness':            ('Reaction Formation',),
    # fantasy / dissociation / split
    'horror':                ('Dissociation', 'Splitting'),
    'monster':               ('Splitting', 'Projection'),
    'legend':                ('Autistic Fantasy', 'Idealization'),
    'magic':                 ('Omnipotence', 'Autistic Fantasy'),
    'confusion':             ('Dissociation', 'Repression'),
    # affect / interpersonal
    'hate':                  ('Devaluation', 'Splitting', 'Projection'),
    'envy':                  ('Devaluation', 'Projection'),
    'deception':             ('Denial', 'Rationalization'),
    'ridicule':              ('Devaluation', 'Humor'),
    'nervousness':           ('Anticipation', 'Repression'),
    # sublimation channels
    'sexual':                ('Sublimation', 'Repression'),
    'lust':                  ('Sublimation',),
    'art':                   ('Sublimation',),
    'music':                 ('Sublimation',),
    'writing':               ('Sublimation', 'Self-Observation'),
    'dance':                 ('Sublimation',),
}

# Categories whose presence flips polarity of mature signal (suppress hints).
EMPATH_NEGATIVE_VALENCE: frozenset[str] = frozenset({
    'violence', 'rage', 'aggression', 'kill', 'weapon', 'crime', 'breaking',
    'swearing_terms', 'anger', 'hate', 'envy', 'shame', 'disappointment',
    'weakness', 'ugliness', 'suffering', 'pain', 'irritability',
    'exasperation', 'fear', 'sadness', 'horror', 'monster', 'neglect',
    'nervousness', 'confusion', 'deception', 'cold',
})

EMPATH_POSITIVE_VALENCE: frozenset[str] = frozenset({
    'optimism', 'sympathy', 'help', 'giving', 'trust', 'friends', 'affection',
    'love', 'joy', 'contentment', 'politeness',
})


# --- helpers ---------------------------------------------------------------
def render_vocab_block() -> str:
    """Compact prompt block for LLM labelers. Deterministic ordering."""
    return (
        f'METAPHORS ({len(METAPHORS)}): {", ".join(METAPHORS)}\n'
        f'OPERATIONS ({len(OPERATIONS)}): {", ".join(OPERATIONS)}\n'
        f'MOTIFS ({len(MOTIFS)}): {", ".join(MOTIFS)}\n'
        f'VAD: each of {", ".join(VAD_FIELDS)} in [{VAD_MIN}, {VAD_MAX}]'
    )


def validate_labels(
    metaphors: Iterable[str] = (),
    operations: Iterable[str] = (),
    motifs: Iterable[str] = (),
) -> dict[str, list[str]]:
    """Return out-of-vocabulary labels per axis. Inputs are assumed normalized
    (lower-case kebab for axes A/C, lower-case for B)."""
    m_set, o_set, c_set = set(METAPHORS), set(OPERATIONS), set(MOTIFS)
    return {
        'metaphors_novel':  [x for x in metaphors  if x not in m_set],
        'operations_novel': [x for x in operations if x not in o_set],
        'motifs_novel':     [x for x in motifs     if x not in c_set],
    }


def clamp_vad(v: dict[str, float]) -> dict[str, float]:
    """Clip VAD dict to [VAD_MIN, VAD_MAX]; missing fields default to 0.5 (neutral)."""
    return {
        f: max(VAD_MIN, min(VAD_MAX, float(v.get(f, 0.5))))
        for f in VAD_FIELDS
    }


def empath_top_categories(
    scores: dict[str, float], k: int = 5, min_score: float = 0.0,
) -> list[str]:
    """Return top-k empath category names with score > min_score, sorted desc."""
    ranked = sorted(
        ((c, s) for c, s in scores.items() if s > min_score),
        key=lambda x: -x[1],
    )
    return [c for c, _ in ranked[:k]]


def empath_defense_priors(scores: dict[str, float]) -> dict[str, float]:
    """Map empath category scores to a sparse soft prior over the 28 defenses.
    Sums weighted contributions from EMPATH_DEFENSE_HINTS; renormalized to [0,1]."""
    raw: dict[str, float] = {d: 0.0 for d in DEFENSES}
    for cat, defs in EMPATH_DEFENSE_HINTS.items():
        s = scores.get(cat, 0.0)
        if s <= 0.0:
            continue
        for rank, d in enumerate(defs):
            raw[d] += s / (rank + 1)  # primary weight 1, secondary 1/2, ...
    mx = max(raw.values()) or 1.0
    return {d: v / mx for d, v in raw.items() if v > 0.0}


__all__ = [
    'DEFENSES', 'VAILLANT_LEVEL',
    'METAPHORS', 'OPERATIONS', 'MOTIFS', 'MOTIF_GROUPS',
    'VAD_FIELDS', 'VAD_MIN', 'VAD_MAX',
    'EMPATH_DEFENSE_HINTS', 'EMPATH_NEGATIVE_VALENCE', 'EMPATH_POSITIVE_VALENCE',
    'render_vocab_block', 'validate_labels', 'clamp_vad',
    'empath_top_categories', 'empath_defense_priors',
]
