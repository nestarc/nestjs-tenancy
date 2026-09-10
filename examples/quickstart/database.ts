// These defaults are public credentials for the disposable local Docker demo.
export const ADMIN_DATABASE_URL = process.env.QUICKSTART_ADMIN_DATABASE_URL
  ?? 'postgresql://quickstart_admin:quickstart_admin@127.0.0.1:5434/tenancy_quickstart';
export const APP_DATABASE_URL = process.env.QUICKSTART_APP_DATABASE_URL
  ?? 'postgresql://quickstart_app:quickstart_app@127.0.0.1:5434/tenancy_quickstart';
