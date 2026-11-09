const unsupported = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  'minProperties',
  'maxProperties',
]);

const formats = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** 전송 스키마만 Claude 제약에 맞추고 업무 계층의 원본 Zod 검증은 유지한다. */
export function anthropicSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const hints: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === '$id') continue;

    if (
      unsupported.has(key) ||
      (key === 'minItems' && value !== 0 && value !== 1) ||
      (key === 'format' && typeof value === 'string' && !formats.has(value))
    ) {
      hints[key] = value;
      continue;
    }

    if (
      ['properties', '$defs', 'definitions'].includes(key) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    )
      output[key] = Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          anthropicSchema(item as Record<string, unknown>),
        ])
      );
    else if (
      Array.isArray(value) &&
      ['anyOf', 'allOf', 'oneOf', 'prefixItems'].includes(key)
    )
      output[key] = value.map((item) =>
        anthropicSchema(item as Record<string, unknown>)
      );
    else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      ['items', 'not', 'if', 'then', 'else', 'additionalProperties'].includes(
        key
      )
    )
      output[key] = anthropicSchema(value as Record<string, unknown>);
    else output[key] = value;
  }

  if (schema.type === 'object' || schema.properties)
    output.additionalProperties = false;
  if (Object.keys(hints).length)
    output.description = `${typeof schema.description === 'string' ? schema.description + ' ' : ''}서버 검증 제약: ${JSON.stringify(hints)}`;

  return output;
}
