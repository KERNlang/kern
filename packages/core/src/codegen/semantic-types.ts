/**
 * Semantic Type Map — cross-target type mappings for KERN's semantic types.
 *
 * Maps KERN column/field types to target-specific output types:
 * Prisma schema, SQLAlchemy/SQLModel, Pydantic, TypeScript.
 */

export interface SemanticTypeMapping {
  prisma: string;
  sqlalchemy: string;
  pydantic: string;
  typescript: string;
}

export const SEMANTIC_TYPE_MAP: Record<string, SemanticTypeMapping> = {
  uuid: { prisma: 'String @db.Uuid', sqlalchemy: 'UUID', pydantic: 'UUID', typescript: 'string' },
  string: { prisma: 'String', sqlalchemy: 'String', pydantic: 'str', typescript: 'string' },
  text: { prisma: 'String', sqlalchemy: 'Text', pydantic: 'str', typescript: 'string' },
  Email: { prisma: 'String', sqlalchemy: 'String(254)', pydantic: 'EmailStr', typescript: 'string' },
  URL: { prisma: 'String', sqlalchemy: 'String(2048)', pydantic: 'AnyHttpUrl', typescript: 'string' },
  PhoneNumber: { prisma: 'String', sqlalchemy: 'String(20)', pydantic: 'str', typescript: 'string' },
  PersonName: { prisma: 'String', sqlalchemy: 'String(255)', pydantic: 'str', typescript: 'string' },
  int: { prisma: 'Int', sqlalchemy: 'Integer', pydantic: 'int', typescript: 'number' },
  integer: { prisma: 'Int', sqlalchemy: 'Integer', pydantic: 'int', typescript: 'number' },
  float: { prisma: 'Float', sqlalchemy: 'Float', pydantic: 'float', typescript: 'number' },
  decimal: { prisma: 'Decimal', sqlalchemy: 'Numeric(19, 4)', pydantic: 'Decimal', typescript: 'number' },
  Money: { prisma: 'Decimal', sqlalchemy: 'Numeric(19, 4)', pydantic: 'Decimal', typescript: 'number' },
  boolean: { prisma: 'Boolean', sqlalchemy: 'Boolean', pydantic: 'bool', typescript: 'boolean' },
  bool: { prisma: 'Boolean', sqlalchemy: 'Boolean', pydantic: 'bool', typescript: 'boolean' },
  date: { prisma: 'DateTime', sqlalchemy: 'Date', pydantic: 'date', typescript: 'Date' },
  datetime: { prisma: 'DateTime', sqlalchemy: 'DateTime', pydantic: 'datetime', typescript: 'Date' },
  timestamp: { prisma: 'DateTime', sqlalchemy: 'DateTime', pydantic: 'datetime', typescript: 'Date' },
  Timestamp: { prisma: 'DateTime', sqlalchemy: 'DateTime', pydantic: 'datetime', typescript: 'Date' },
  json: { prisma: 'Json', sqlalchemy: 'JSON', pydantic: 'dict[str, Any]', typescript: 'Record<string, unknown>' },
};

export function mapSemanticType(kernType: string, target: keyof SemanticTypeMapping): string {
  return SEMANTIC_TYPE_MAP[kernType]?.[target] ?? kernType;
}
