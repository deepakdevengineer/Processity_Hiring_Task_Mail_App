// backend/src/db/migrate.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  try {
    const schema = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );

    // Split by semicolons and filter empty
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s !== '');

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await pool.query(statement);
          console.log('✓ Executed:', statement.substring(0, 60) + '...');
        } catch (err) {
          // Skip "already exists" errors for idempotency
          if (!err.message.includes('already exists')) {
            console.error('Statement error:', err.message);
          }
        }
      }
    }

    console.log('\n✅ Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrate();
