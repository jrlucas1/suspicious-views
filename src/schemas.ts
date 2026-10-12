export const MIN_HOURS = 24;
export const MAX_HOURS = 2160;
export const MAX_VIEWS_PER_HOUR = 1_000_000_000;

export const STRICT_VALIDATION = { coerceTypes: false, removeAdditional: false };

export interface ClassifyBody {
  views: number[];
}

export const classifyBody = {
  type: 'object',
  required: ['views'],
  additionalProperties: false,
  properties: {
    views: {
      type: 'array',
      minItems: MIN_HOURS,
      maxItems: MAX_HOURS,
      items: { type: 'integer', minimum: 0, maximum: MAX_VIEWS_PER_HOUR },
    },
  },
};
