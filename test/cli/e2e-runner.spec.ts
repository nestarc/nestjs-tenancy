const {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  applyDefaultEnv,
} = require('../../scripts/test-e2e');

describe('e2e runner env defaults', () => {
  it('exports deterministic default database URLs', () => {
    expect(DEFAULT_DATABASE_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:5433/tenancy_test',
    );
    expect(DEFAULT_APP_DATABASE_URL).toBe(
      'postgresql://app_user:app_user@localhost:5433/tenancy_test',
    );
  });

  it('sets database defaults when values are missing', () => {
    const env: Record<string, string | undefined> = {};

    const result = applyDefaultEnv(env);

    expect(result).toBe(env);
    expect(env.DATABASE_URL).toBe(DEFAULT_DATABASE_URL);
    expect(env.APP_DATABASE_URL).toBe(DEFAULT_APP_DATABASE_URL);
  });

  it('preserves caller-provided database values', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://custom-owner/database',
      APP_DATABASE_URL: 'postgresql://custom-app/database',
    };

    applyDefaultEnv(env);

    expect(env.DATABASE_URL).toBe('postgresql://custom-owner/database');
    expect(env.APP_DATABASE_URL).toBe('postgresql://custom-app/database');
  });
});
