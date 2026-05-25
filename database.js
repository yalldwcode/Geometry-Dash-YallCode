const mysql = require('mysql2/promise');

// Railway automatically injects MYSQL_URL when you add the MySQL plugin.
// All values come from environment variables — nothing hardcoded.
const pool = mysql.createPool({
  host:               process.env.MYSQLHOST     || 'localhost',
  user:               process.env.MYSQLUSER     || 'root',
  password:           process.env.MYSQLPASSWORD || '',
  database:           process.env.MYSQLDATABASE || 'yalldash',
  port:               process.env.MYSQLPORT     || 3306,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  ssl: process.env.MYSQLHOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

// Create all tables if they don't exist yet.
// This runs once on server start — safe to leave in forever.
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        username   VARCHAR(64)  NOT NULL UNIQUE,
        email      VARCHAR(128) NOT NULL UNIQUE,
        password   VARCHAR(256) NOT NULL,
        banned     TINYINT(1)   NOT NULL DEFAULT 0,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS levels (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT          NOT NULL,
        name        VARCHAR(128) NOT NULL,
        description TEXT,
        data        LONGTEXT,
        downloads   INT          NOT NULL DEFAULT 0,
        likes       INT          NOT NULL DEFAULT 0,
        difficulty  INT          NOT NULL DEFAULT 0,
        created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS broadcast (
        id      INT AUTO_INCREMENT PRIMARY KEY,
        message TEXT        NOT NULL,
        type    VARCHAR(32) NOT NULL DEFAULT 'info',
        sent_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS config (
        k VARCHAR(64)  NOT NULL PRIMARY KEY,
        v VARCHAR(256) NOT NULL DEFAULT ''
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id      INT AUTO_INCREMENT PRIMARY KEY,
        time    VARCHAR(16)  NOT NULL,
        level   VARCHAR(16)  NOT NULL DEFAULT 'info',
        message TEXT         NOT NULL
      )
    `);

    console.log('✅ Database tables ready.');
  } finally {
    conn.release();
  }
}

// Run table setup immediately when this module loads
initDB().catch(err => {
  console.error('❌ DB init failed:', err.message);
  process.exit(1); // Crash loudly so Railway restarts with a clear error
});

module.exports = pool;