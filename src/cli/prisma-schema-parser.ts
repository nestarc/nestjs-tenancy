export interface ParsedModel {
  modelName: string;
  tableName: string;
  schemaName?: string;
}

/**
 * Parse Prisma schema content to extract model names and table mappings.
 * Ignores enums, types, and views.
 *
 * Uses line-by-line parsing with brace balancing to correctly handle
 * field defaults containing braces (e.g., `@default("{}")`).
 */
export function parseModels(schemaContent: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const lines = schemaContent.split('\n');

  let currentModel: string | null = null;
  let body = '';
  let depth = 0;

  for (const line of lines) {
    if (currentModel === null) {
      const modelStart = line.match(/^model\s+(\w+)\s*\{/);
      if (modelStart) {
        currentModel = modelStart[1];
        body = '';
        depth = 1;
      }
      continue;
    }

    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }

    if (depth <= 0) {
      const mapMatch = body.match(/@@map\("([^"]+)"\)/);
      const tableName = mapMatch ? mapMatch[1] : currentModel;
      const schemaMatch = body.match(/@@schema\("([^"]+)"\)/);
      const schemaName = schemaMatch ? schemaMatch[1] : undefined;
      models.push({ modelName: currentModel, tableName, schemaName });
      currentModel = null;
    } else {
      body += line + '\n';
    }
  }

  return models;
}
