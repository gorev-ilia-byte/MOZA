import Database from 'better-sqlite3';
const db = new Database('messenger.db');
const schema = db.prepare("PRAGMA table_info(messages)").all();
console.log(JSON.stringify(schema, null, 2));
