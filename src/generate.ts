import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateDataset, serializeDataset } from './dataset.ts';
import { measure, renderReport, replaceReport } from './evaluation.ts';

const datasetPath = new URL('../data/dataset.jsonl', import.meta.url);
const readmePath = new URL('../README.md', import.meta.url);

const dataset = generateDataset();
mkdirSync(new URL('.', datasetPath), { recursive: true });
writeFileSync(datasetPath, serializeDataset(dataset));

const report = renderReport(measure(dataset));
const readme = readFileSync(readmePath, 'utf8').replaceAll('\r\n', '\n');
writeFileSync(readmePath, replaceReport(readme, report));

console.log(report);
