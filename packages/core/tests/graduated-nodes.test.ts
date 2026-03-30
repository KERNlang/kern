import { parse } from '../src/parser.js';
import {
  generateCoreNode, isCoreNode,
  generateConditional, generateSelect,
  generateModel, generateRepository, generateDependency, generateCache,
} from '../src/codegen-core.js';

function gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

function makeNode(type: string, props: Record<string, unknown> = {}, children: any[] = []) {
  return { type, props, children, loc: { line: 1, col: 1 } };
}

describe('Graduated Nodes', () => {
  // ── conditional ──

  describe('conditional', () => {
    it('generates conditional rendering with single child', () => {
      const code = gen([
        'conditional if=isPro',
        '  text value="Pro features unlocked"',
      ].join('\n'));
      expect(code).toContain('isPro');
      expect(code).toContain('&&');
    });

    it('generates conditional rendering with core node children', () => {
      const code = gen([
        'conditional if=isAdmin',
        '  type name=AdminState values="active|disabled"',
        '  config name=adminConfig',
      ].join('\n'));
      expect(code).toContain('isAdmin');
      expect(code).toContain('<>');
    });

    it('throws on missing if prop', () => {
      expect(() => gen('conditional')).toThrow("conditional node requires an 'if' prop");
    });
  });

  // ── select ──

  describe('select', () => {
    it('generates select with options', () => {
      const code = gen([
        'select name=status value=current placeholder="Choose"',
        '  option value=active label="Active"',
        '  option value=pending label="Pending"',
      ].join('\n'));
      expect(code).toContain('<select');
      expect(code).toContain('name="status"');
      expect(code).toContain('<option value="" disabled>Choose</option>');
      expect(code).toContain('<option value="active">Active</option>');
      expect(code).toContain('<option value="pending">Pending</option>');
      expect(code).toContain('</select>');
    });

    it('generates select without placeholder', () => {
      const code = gen([
        'select name=role',
        '  option value=admin label="Admin"',
        '  option value=user label="User"',
      ].join('\n'));
      expect(code).toContain('<select');
      expect(code).not.toContain('disabled');
    });
  });

  // ── model ──

  describe('model', () => {
    it('generates interface from model with columns', () => {
      const code = gen([
        'model name=User table=users',
        '  column name=id type=uuid primary=true',
        '  column name=email type=string unique=true',
      ].join('\n'));
      expect(code).toContain('export interface User {');
      expect(code).toContain('id: string;');
      expect(code).toContain('email: string;');
      expect(code).toContain('@@map("users")');
    });

    it('generates relations', () => {
      const code = gen([
        'model name=User',
        '  column name=id type=uuid',
        '  relation name=posts target=Post kind=one-to-many',
      ].join('\n'));
      expect(code).toContain('posts?: Post[];');
    });

    it('maps column types correctly', () => {
      const code = gen([
        'model name=Record',
        '  column name=count type=int',
        '  column name=active type=boolean',
        '  column name=created type=datetime',
        '  column name=data type=json',
      ].join('\n'));
      expect(code).toContain('count: number;');
      expect(code).toContain('active: boolean;');
      expect(code).toContain('created: Date;');
      expect(code).toContain('data: Record<string, unknown>;');
    });
  });

  // ── repository ──

  describe('repository', () => {
    it('generates repository class with model', () => {
      const code = gen([
        'repository name=UserRepo model=User',
        '  method name=findByEmail params="email:string" returns="User|null"',
        '    handler <<<return this.findOne({ email });>>>',
      ].join('\n'));
      expect(code).toContain('export class UserRepo {');
      expect(code).toContain("readonly modelType = 'User';");
      expect(code).toContain('findByEmail(email: string): User|null {');
      expect(code).toContain('return this.findOne({ email });');
    });

    it('generates repository without model', () => {
      const code = gen([
        'repository name=BaseRepo',
        '  method name=getAll returns="any[]"',
        '    handler <<<return [];>>>',
      ].join('\n'));
      expect(code).toContain('export class BaseRepo {');
      expect(code).not.toContain('constructor');
    });
  });

  // ── dependency ──

  describe('dependency', () => {
    it('generates singleton factory', () => {
      const code = gen([
        'dependency name=authService scope=singleton',
        '  inject name=db from=database',
        '  inject name=repo type=UserRepository with=db',
        '  returns name=AuthService with=repo',
      ].join('\n'));
      expect(code).toContain('let _authServiceInstance: AuthService | null = null;');
      expect(code).toContain('function createAuthService(): AuthService {');
      expect(code).toContain('if (_authServiceInstance) return _authServiceInstance;');
      expect(code).toContain('const db = database;');
      expect(code).toContain('const repo = new UserRepository(db);');
      expect(code).toContain('const instance = new AuthService(repo);');
      expect(code).toContain('_authServiceInstance = instance;');
    });

    it('generates transient factory', () => {
      const code = gen([
        'dependency name=logger',
        '  inject name=config type=LogConfig',
        '  returns name=Logger with=config',
      ].join('\n'));
      expect(code).not.toContain('Instance');
      expect(code).toContain('function createLogger(): Logger {');
      expect(code).toContain('const config = new LogConfig();');
    });
  });

  // ── cache ──

  describe('cache', () => {
    it('generates cache object with entries and invalidation', () => {
      const code = gen([
        'cache name=userCache backend=redis prefix="user:" ttl=3600',
        '  entry name=profile key="user:{id}"',
        '    strategy read-through',
        '  invalidate on=userUpdate tags="user:{id}"',
      ].join('\n'));
      expect(code).toContain('export const userCache = {');
      expect(code).toContain("prefix: 'user:'");
      expect(code).toContain('ttl: 3600');
      expect(code).toContain("backend: 'redis'");
      expect(code).toContain('getProfile');
      expect(code).toContain('read-through');
      expect(code).toContain('invalidateOnUserUpdate');
      expect(code).toContain('redis.del');
      expect(code).toContain("import Redis from 'ioredis'");
      expect(code).toContain('const redis = new Redis');
    });

    it('generates memory cache', () => {
      const code = gen([
        'cache name=appCache',
        '  entry name=settings key="settings"',
      ].join('\n'));
      expect(code).toContain("backend: 'memory'");
      expect(code).toContain('cache.get(key)');
      expect(code).toContain('const cache = new Map<string, unknown>()');
    });
  });

  // ── child node consumption ──

  describe('child node consumption', () => {
    it('column returns empty when called directly', () => {
      const code = gen('column name=id type=uuid');
      expect(code).toBe('');
    });

    it('relation returns empty when called directly', () => {
      const code = gen('relation name=posts target=Post');
      expect(code).toBe('');
    });

    it('option returns empty when called directly', () => {
      const code = gen('option value=x label="X"');
      expect(code).toBe('');
    });

    it('inject returns empty when called directly', () => {
      const code = gen('inject name=db from=database');
      expect(code).toBe('');
    });

    it('entry returns empty when called directly', () => {
      const code = gen('entry name=x key="x"');
      expect(code).toBe('');
    });

    it('invalidate returns empty when called directly', () => {
      const code = gen('invalidate on=update');
      expect(code).toBe('');
    });
  });

  // ── isCoreNode ──

  describe('isCoreNode includes graduated nodes', () => {
    for (const type of ['model', 'column', 'relation', 'repository', 'dependency', 'inject', 'cache', 'entry', 'invalidate', 'conditional', 'select', 'option']) {
      it(`recognizes '${type}' as core`, () => {
        expect(isCoreNode(type)).toBe(true);
      });
    }
  });
});
