import { createApp } from './app';

async function main(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(3000, '127.0.0.1');
  console.log('Quick Start: http://127.0.0.1:3000/projects');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
