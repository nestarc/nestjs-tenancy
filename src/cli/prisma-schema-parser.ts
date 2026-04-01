export interface ParsedModel {
  modelName: string;
  tableName: string;
  schemaName?: string;
}

/**
 * Parse Prisma schema content to extract model names and table mappings.
 * Ignores enums, types, and views.
 */
export function parseModels(schemaContent: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const modelRegex = /^model\s+(\w+)\s*\{([^}]*)}/gm;

  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;
    const schemaMatch = body.match(/@@schema\("([^"]+)"\)/);
    const schemaName = schemaMatch ? schemaMatch[1] : undefined;
    models.push({ modelName, tableName, schemaName });
  }

  return models;
}
