import { Project } from 'ts-morph';
import { detectors } from '../src/detectors/structural.js';
import type { DetectionResult, DetectorPack } from '../src/types.js';

function detect(detector: DetectorPack, source: string): DetectionResult[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile('test.ts', source, { overwrite: true });
  return detector.detect(sourceFile, source);
}

function getDetector(id: string): DetectorPack {
  const d = detectors.find((d) => d.id === id);
  if (!d) throw new Error(`Detector ${id} not found`);
  return d;
}

describe('Structural Detectors', () => {
  describe('structural-model', () => {
    it('detects TypeORM entity', () => {
      const results = detect(
        getDetector('structural-model'),
        `
        @Entity()
        export class User {
          @Column() id: string;
          @Column() email: string;
        }
      `,
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].extractedParams[0].value).toBe('User');
    });

    it('detects Drizzle table', () => {
      const results = detect(
        getDetector('structural-model'),
        `
        export const users = pgTable('users', {
          id: uuid('id').primaryKey(),
          email: text('email'),
        });
      `,
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].extractedParams[0].value).toBe('users');
    });

    it('detects Prisma client usage', () => {
      const results = detect(
        getDetector('structural-model'),
        `
        const users = await prisma.user.findMany({ where: { active: true } });
      `,
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('structural-repository', () => {
    it('detects repository class', () => {
      const results = detect(
        getDetector('structural-repository'),
        `
        export class UserRepository extends BaseRepository {
          async findByEmail(email: string) {
            return this.findOne({ email });
          }
        }
      `,
      );
      expect(results.length).toBe(1);
      expect(results[0].extractedParams[0].value).toBe('UserRepository');
    });

    it('detects DAO class', () => {
      const results = detect(
        getDetector('structural-repository'),
        `
        class OrderDAO {
          getAll() { return []; }
        }
      `,
      );
      expect(results.length).toBe(1);
    });
  });

  describe('structural-dependency', () => {
    it('detects constructor injection', () => {
      const results = detect(
        getDetector('structural-dependency'),
        `
        class AuthService {
          constructor(private readonly userRepo: UserRepository, private readonly cache: CacheService) {}
        }
      `,
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it('detects @Injectable decorator', () => {
      const results = detect(
        getDetector('structural-dependency'),
        `
        @Injectable()
        class UserService {
          constructor(private repo: UserRepo) {}
        }
      `,
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('structural-cache', () => {
    it('detects Redis operations', () => {
      const results = detect(
        getDetector('structural-cache'),
        `
        async function getUser(id: string) {
          const cached = await redis.get(\`user:\${id}\`);
          if (cached) return JSON.parse(cached);
          const user = await db.findUser(id);
          await redis.set(\`user:\${id}\`, JSON.stringify(user));
          return user;
        }
      `,
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it('detects Cache decorator', () => {
      const results = detect(
        getDetector('structural-cache'),
        `
        @Cacheable({ ttl: 3600 })
        async getProfile(id: string) {
          return this.repo.findById(id);
        }
      `,
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('structural-conditional', () => {
    it('detects feature flag usage', () => {
      const results = detect(
        getDetector('structural-conditional'),
        `
        const showBeta = useFeatureFlag('beta-dashboard');
      `,
      );
      expect(results.length).toBe(1);
      expect(results[0].extractedParams[0].value).toBe('beta-dashboard');
    });

    it('detects JSX conditional rendering', () => {
      const results = detect(
        getDetector('structural-conditional'),
        `
        return <div>{isAdmin && <AdminPanel />}</div>;
      `,
      );
      expect(results.length).toBe(1);
    });
  });

  describe('structural-select', () => {
    it('detects HTML select', () => {
      const results = detect(
        getDetector('structural-select'),
        `
        <select name="status" value={current}>
          <option value="active">Active</option>
        </select>
      `,
      );
      expect(results.length).toBe(1);
      expect(results[0].extractedParams[0].value).toBe('status');
    });
  });

  describe('all detectors', () => {
    it('exports 6 structural detectors', () => {
      expect(detectors).toHaveLength(6);
    });

    it('all have empty packageNames (import-agnostic)', () => {
      for (const d of detectors) {
        expect(d.packageNames).toEqual([]);
      }
    });

    it('all have patternKind=structural', () => {
      for (const d of detectors) {
        expect(d.patternKind).toBe('structural');
      }
    });
  });
});
