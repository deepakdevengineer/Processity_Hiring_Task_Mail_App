/*
  SQL Schema for Mail App
  Run this file to initialize the database
  psql -U postgres -d mail_app -f schema.sql
*/

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Emails table
CREATE TABLE IF NOT EXISTS emails (
  id VARCHAR(255) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_address VARCHAR(255),
  to_addresses TEXT[],
  subject VARCHAR(500),
  body TEXT,
  thread_id VARCHAR(255),
  is_read BOOLEAN DEFAULT FALSE,
  is_sent BOOLEAN DEFAULT FALSE,
  date TIMESTAMP,
  gmail_message_id VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_user_date ON emails(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_user_read ON emails(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);

-- Sync state for incremental updates
CREATE TABLE IF NOT EXISTS sync_state (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  history_id VARCHAR(255),
  last_sync TIMESTAMP DEFAULT NOW()
);

-- Labels for organizing emails
CREATE TABLE IF NOT EXISTS labels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  gmail_label_id VARCHAR(255),
  color VARCHAR(7),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labels_user ON labels(user_id);

-- Scheduled Emails table
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_address VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  body TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status ON scheduled_emails(status, scheduled_at);
