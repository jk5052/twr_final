// 28 defense mechanisms — codebook (dataset/processed/defense_codebook.json) 키와 1:1 일치.
// items_rag.primary_defense / secondary_defense 컬럼과 동일 표기.
export type Defense =
  | 'Acting Out'
  | 'Affiliation'
  | 'Altruism'
  | 'Anticipation'
  | 'Apathetic Withdrawal'
  | 'Autistic Fantasy'
  | 'Denial'
  | 'Devaluation'
  | 'Displacement'
  | 'Dissociation'
  | 'Help-Rejecting Complaining'
  | 'Humor'
  | 'Idealization'
  | 'Intellectualization'
  | 'Isolation of Affect'
  | 'Omnipotence'
  | 'Passive Aggression'
  | 'Projection'
  | 'Projective Identification'
  | 'Rationalization'
  | 'Reaction Formation'
  | 'Repression'
  | 'Self-Assertion'
  | 'Self-Observation'
  | 'Splitting'
  | 'Sublimation'
  | 'Suppression'
  | 'Undoing'

export const ALL_DEFENSES: readonly Defense[] = [
  'Acting Out', 'Affiliation', 'Altruism', 'Anticipation', 'Apathetic Withdrawal',
  'Autistic Fantasy', 'Denial', 'Devaluation', 'Displacement', 'Dissociation',
  'Help-Rejecting Complaining', 'Humor', 'Idealization', 'Intellectualization',
  'Isolation of Affect', 'Omnipotence', 'Passive Aggression', 'Projection',
  'Projective Identification', 'Rationalization', 'Reaction Formation', 'Repression',
  'Self-Assertion', 'Self-Observation', 'Splitting', 'Sublimation', 'Suppression', 'Undoing',
] as const
