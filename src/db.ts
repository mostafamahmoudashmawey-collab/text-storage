import { createClient } from '@libsql/client/web';

export const db = createClient({
  url: 'libsql://t-text-mostafamhmoud123564.aws-eu-west-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzczMTQyNDgsImlkIjoiMDE5ZGQwMmQtZTgwMS03NzlmLTk1YzktMjhjNmNkZmY0MWM2IiwicmlkIjoiY2JjZWY4N2EtZDE1Mi00OTE3LWExNzAtZTVkNzA5YTA5ODQ2In0.0vv2QFu_HQkxKD7KHrsxbuw3M6xkC1AoUrC4PbMLQQsZ3y74eVyoaKNJyF2-7N0wKyqwlXIepbJqE-770BWyDw',
});

export const initDB = async () => {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        password TEXT NOT NULL
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS texts (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        image_title TEXT NOT NULL,
        telegram_file_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  } catch (e) {
    console.error("Failed to init db", e);
  }
};

initDB();
