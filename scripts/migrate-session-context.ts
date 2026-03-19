import { db } from '../src/lib/db';
import { migrateSessionContextToMessages } from '../src/lib/services/session-context-migration';

const result = await migrateSessionContextToMessages(db, console);
console.log(JSON.stringify(result, null, 2));
await db.$disconnect();
