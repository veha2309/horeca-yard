import 'dotenv/config';
import { Database } from './db.js';
const db = await new Database().init();
await db.close();
console.log('Database migrations applied.');
