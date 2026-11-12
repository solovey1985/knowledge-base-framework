export const MAX_SPENT_MINUTES = 52_560_000;
const minutesPerDay = 24 * 60;

export function formatDuration(total: number): string {
  const days = Math.floor(total / minutesPerDay);
  const hours = Math.floor((total % minutesPerDay) / 60);
  const minutes = total % 60;
  const parts = [];
  if (days) parts.push(`${days} дн`);
  if (hours) parts.push(`${hours} год`);
  if (minutes || !parts.length) parts.push(`${minutes} хв`);
  return parts.join(' ');
}

export function manualMinutes(days: string, hours: string, minutes: string): number {
  const values = [days, hours, minutes];
  if (values.some(value => !/^\d*$/.test(value))) return NaN;
  const total = Number(days) * minutesPerDay + Number(hours) * 60 + Number(minutes);
  return Number.isSafeInteger(total) && total <= MAX_SPENT_MINUTES ? total : NaN;
}
