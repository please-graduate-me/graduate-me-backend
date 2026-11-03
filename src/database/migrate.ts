import dataSource from './data-source.js';

try {
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
