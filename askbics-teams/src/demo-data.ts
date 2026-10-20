import { Answer, demoModel, planQuestion } from './model.js';
const records = [
  { Team: 'Customer support', Year: 2024, value: 820 }, { Team: 'Customer support', Year: 2025, value: 1040 },
  { Team: 'Operations', Year: 2024, value: 610 }, { Team: 'Operations', Year: 2025, value: 760 },
  { Team: 'Technology', Year: 2024, value: 430 }, { Team: 'Technology', Year: 2025, value: 620 }
];
export function demoAnswer(question: string): Answer {
  const plan = planQuestion(question, demoModel);
  const selected = records.filter(r => plan.year === undefined || r.Year === plan.year);
  const groups = new Map<string, number>();
  for (const row of selected) {
    const key = plan.dimension?.name === 'Year' ? String(row.Year) : plan.dimension ? row.Team : 'Total';
    groups.set(key, (groups.get(key) || 0) + row.value);
  }
  const pairs = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, plan.top || 10);
  return {
    title: plan.dimension ? `${plan.measure.name} by ${plan.dimension.name}` : `Total ${plan.measure.name}`,
    model: demoModel.name, columns: plan.dimension ? [plan.dimension.name, plan.measure.name] : [plan.measure.name],
    rows: plan.dimension ? pairs : [[pairs[0]?.[1] ?? null]],
    context: `${plan.year ? `Year: ${plan.year}` : 'All demo periods (2024–2025)'} · Fictional sample data`,
    demo: true, generatedAt: new Date().toISOString()
  };
}
