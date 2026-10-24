import type { ReportsOverview } from './teacher-reports';

export function scoreDistribution(data: ReportsOverview) {
  const counts = [0,0,0,0,0];
  let observed = 0;
  for (const row of data.results) {
    if (!data.completed_statuses.includes(row.status) || row.percentage == null || row.percentage === '') continue;
    const percentage = Number(row.percentage);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) continue;
    counts[Math.min(4,Math.floor(percentage / 20))]++;
    observed++;
  }
  const labels = ['0–<20%','20–<40%','40–<60%','60–<80%','80–100%'];
  return { observed, items: counts.map((value,index) => ({ label: labels[index], value })) };
}
