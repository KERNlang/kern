import { resolveRemoteRepoTarget } from '../src/remote-repo.js';

describe('remote repo target resolution', () => {
  test('normalizes a plain GitHub repo URL into a clone URL', () => {
    expect(resolveRemoteRepoTarget('https://github.com/acme/widgets')).toEqual({
      cloneUrl: 'https://github.com/acme/widgets.git',
      ref: undefined,
    });
  });

  test('accepts github.com URLs without an explicit scheme', () => {
    expect(resolveRemoteRepoTarget('github.com/acme/widgets/tree/main/packages/cli')).toEqual({
      cloneUrl: 'https://github.com/acme/widgets.git',
      ref: 'main',
      rootSubPath: 'packages/cli',
    });
  });

  test('extracts ref and file path from GitHub blob URLs', () => {
    expect(resolveRemoteRepoTarget('https://github.com/acme/widgets/blob/dev/src/index.ts')).toEqual({
      cloneUrl: 'https://github.com/acme/widgets.git',
      ref: 'dev',
      rootSubPath: 'src',
      defaultInput: 'src/index.ts',
    });
  });

  test('lets an explicit --ref override the ref embedded in a GitHub URL', () => {
    expect(resolveRemoteRepoTarget('https://github.com/acme/widgets/tree/main/packages/cli', 'release/v1')).toEqual({
      cloneUrl: 'https://github.com/acme/widgets.git',
      ref: 'release/v1',
      rootSubPath: 'packages/cli',
    });
  });
});
