/*
  One colour per kind of connection, shared by every view that draws one.

  This lives here rather than next to the plat because the Connection Map and
  the plat are two drawings of the same relationships, and a purple thread has
  to mean "member of" in both. When they each had their own idea of that, one
  view drew every connection in the same grey and the other drew them in type
  colour, so a reader moving between the two had nothing to carry across.

  Tokens only, never a generated scale: these are the same variables the type
  badges use, so a thread and the badge on the card it lands on agree.
*/
export const RELATION_COLORS: Record<string, string> = {
  owns: 'var(--type-property)',
  resides_at: 'var(--type-person)',
  member_of: 'var(--type-association)',
  vendor_for: 'var(--type-business)',
  employed_by: 'var(--type-business)',
  manages: 'var(--type-asset)',
  governs: 'var(--type-association)',
  adjacent_to: 'var(--rule-strong)',
  related_to: 'var(--type-record)',
  references: 'var(--type-document)',
}

export function relationColor(key: string): string {
  return RELATION_COLORS[key] ?? 'var(--rule-strong)'
}
