export function isOlderThanMinutes(
  date: Date | string | number,
  minutes: number,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError(`minutes must be a non-negative finite number, got ${minutes}`);
  }

  const then = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(then.getTime())) {
    throw new TypeError(`Invalid date passed to isOlderThanMinutes: ${String(date)}`);
  }

  const diffMs = now.getTime() - then.getTime();
  return diffMs > minutes * 60_000;
}