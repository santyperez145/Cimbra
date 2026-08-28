export type PageCursor = { createdAt: string; id: string };

export function pageLimit(value: string | null, fallback = 25, maximum = 100) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

export function encodePageCursor(cursor: PageCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodePageCursor(value: string | null): PageCursor | null | undefined {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PageCursor>;
    if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt)) ||
        typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.id)) return undefined;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

export function paginatedResponse<T extends PageCursor>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return { data, hasMore, nextCursor: hasMore && last ? encodePageCursor(last) : null };
}
