export type {
  InstantiateInput,
  RoleAssignment,
  Template,
  TemplateDocument,
  TemplateField,
  TemplateOverrides,
  TemplateRole,
} from './types';

export { assertValidTemplate, validateTemplate } from './validate';

export { assertWritable, instantiate, METADATA_KEYS, readOnlyFieldIds } from './instantiate';
export type { InstantiateDeps } from './instantiate';

export { canonicalJson, normalizeTemplate, templateVersion } from './version';

export { parseCsv } from './csv';
export type { CsvParseResult, CsvRecord } from './csv';

export { parseBulkCsv, planBulkSend } from './bulk';
export type {
  BulkColumn,
  BulkError,
  BulkParseResult,
  BulkPlan,
  BulkPlanOptions,
  BulkRow,
} from './bulk';
