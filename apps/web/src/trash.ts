// Shared by the Trash view, the page delete confirm and Space settings.

export const trashKey = (spaceKey: string) => ['trash', spaceKey] as const;
export const trashedSpacesKey = ['trash', 'spaces'] as const;

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * How long the trash keeps things, as a sentence: "They are kept there for 30
 * days, then deleted for good." `one` = said of a single page or space ("It is").
 * Retention 0 means until a space admin deletes them by hand.
 */
export function keptFor(retentionDays: number | undefined, one = false): string {
  const [they, are, stay] = one ? ['It', 'is', 'stays'] : ['They', 'are', 'stay'];
  if (retentionDays === undefined) return `${they} can be restored from the trash.`;
  if (retentionDays === 0) return `${they} ${stay} there until a space admin deletes ${one ? 'it' : 'them'} for good.`;
  return `${they} ${are} kept there for ${plural(retentionDays, 'day')}, then deleted for good.`;
}
