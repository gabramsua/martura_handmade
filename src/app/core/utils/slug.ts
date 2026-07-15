export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export function buildUniqueSlug(
  value: string,
  usedSlugs: Iterable<string>,
  fallback = 'item',
): string {
  const baseSlug = slugify(value) || fallback;
  const reservedSlugs = new Set(
    Array.from(usedSlugs)
      .map((slug) => slug.trim())
      .filter(Boolean),
  );

  if (!reservedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  let nextSlug = `${baseSlug}-${suffix}`;

  while (reservedSlugs.has(nextSlug)) {
    suffix += 1;
    nextSlug = `${baseSlug}-${suffix}`;
  }

  return nextSlug;
}
