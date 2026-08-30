/** 로컬 기준 오늘 YYYY-MM-DD — 레거시 toISO(new Date())와 동일 */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
