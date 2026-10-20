import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import less from 'less';
// Canonical shared code lives in the main Power BI project. Only the host adapter is generated.
const reference = await readFile('../src/fieldParameterTrial.ts', 'utf8');
const method = (start, end) => { const a = reference.indexOf(start), b = reference.indexOf(end, a + start.length); if (a < 0 || b < 0) throw new Error('Shared query adapter boundary changed: update build-visual.mjs before releasing either host.'); return reference.slice(a, b); };
const imports = `import { revenueQuestion, revenueRequest } from './revenue';
import type powerbi from 'powerbi-visuals-api';
import type { IFilter, IFilterColumnTarget } from 'powerbi-models';
import { indexGroupRows } from './queryPerformance';
import { monthlyPeriod } from './monthlyPeriods';
import { compareTimeLabels, timeFieldOrder } from './qna/timeLayout';
import { normalizeMonthPeriods, recognizedTimeTerms, calendarMonths, monthIndexLabel } from './timeSetup';
import { modelHierarchy } from './modelFeatures';
import { readModelMatrix } from './modelMatrix';
import { pivotModelTable } from './modelPivot';
import { categoricalAsTable, formatPowerBiValue } from './dataAdapter';
import { ModelSelection, QnaResponse, QnaChartType } from './qna/types';
import { resolveFilterTarget } from './selectionFilter';
import { ParameterConfig, ParameterPlan, planParameterQuestion, sameGrouping } from './parameterQuery';`;
const head = `
export class VisualQueryEngine {
 private questionRevision = 0;
 private hasParameterContext = true;
 private requestConfig: ParameterConfig;
 constructor(private config: ParameterConfig, private measures: string[], private transport: (plan: ParameterPlan, config: ParameterConfig) => Promise<powerbi.DataView>, public preferMatrix?: (counts: number[]) => boolean) { this.requestConfig = config; }
 private automaticEnabled() { return true; }
 private cancel() {}
 private readConfig() { return this.config; }
 private groupAliases() { return this.config.groupAliases || {}; }
 async run(question: string) { return this.executeQuestion(question, true); }
 private async request(plan: ParameterPlan, config: ParameterConfig, refresh = false): Promise<QnaResponse> {
  this.requestConfig = config;
  if (config.revenuePercentage && plan.measures.length && !plan.listOnly) return revenueRequest(plan, config, async p => this.answer(await this.transport(p, config), p), (view, p) => this.answer(view, p));
  return this.answer(await this.transport(plan, config), plan);
 }
`;
await mkdir('generated', { recursive: true });
await writeFile('generated/visualQueryEngine.ts', imports.replaceAll("from './", "from '../../src/") + head + method('    private async executeQuestion(', '    private request(') + method('    private selectionWithContext(', '    fail(message:') + '\n}\n');
await mkdir('dist', { recursive: true });
await Promise.all([
 build({ entryPoints: ['app/visual-client.ts'], outfile: 'tab/visual.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife', minify: true, metafile: true }).then(async result => { if (!Object.keys(result.metafile.inputs).some(p => p.endsWith('../src/qna/ui.ts'))) throw new Error('Shared UI missing from Teams bundle'); await writeFile('dist/shared-inputs.json', JSON.stringify(Object.keys(result.metafile.inputs), null, 2)); }),
 build({ entryPoints: ['app/model-service.ts'], outfile: 'dist/visual-server.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', packages: 'external' }),
 less.render(await readFile('../style/visual.less', 'utf8'), { filename: '../style/visual.less' }).then(result => writeFile('tab/visual.css', result.css))
]);
