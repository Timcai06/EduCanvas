import { getDb } from '../client';

export type Database = ReturnType<typeof getDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;
