import pg from 'pg';
import mysql from 'mysql2/promise';

export function createDatabase(env = process.env) {
  if (!env.DATABASE_URL) return null;

  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL is invalid');
  }
  const backend = env.QRV_DATA_BACKEND || 'postgresql';
  const limit = Number(env.DATABASE_POOL_MAX || 20);
  if (backend !== 'mariadb') {
    if (!['postgres', 'postgresql', 'supabase-postgres'].includes(backend) ||
        !['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('A supported PostgreSQL backend requires a postgresql:// DATABASE_URL');
    }
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: limit,
      connectionTimeoutMillis: Number(env.PG_CONNECTION_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(env.PG_IDLE_TIMEOUT_MS || 10000)
    });
    pool.on('error', error => console.error('PostgreSQL pool error:', error.code || error.name));
    return pool;
  }

  if (!['mysql:', 'mariadb:'].includes(url.protocol) || url.pathname.length < 2) {
    throw new Error('The MariaDB backend requires a mysql:// DATABASE_URL with a database name');
  }
  const host = url.hostname === '[::1]' ? '::1' : url.hostname;
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const pool = mysql.createPool({
    host,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: limit,
    connectTimeout: Number(env.MARIADB_CONNECT_TIMEOUT_MS || 5000),
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: ['DATE'],
    ...(local ? {} : { ssl: { rejectUnauthorized: true } })
  });

  // Only repository-owned SQL is passed here. Preserve positional binding order.
  const query = async (connection, sql, parameters = []) => {
    const values = [];
    const statement = sql.replace(/\$(\d+)/g, (_, index) => {
      values.push(parameters[Number(index) - 1]);
      return '?';
    });
    const [result] = await connection.execute(statement, values);
    return { rows: Array.isArray(result) ? result : [] };
  };

  async function connect() {
    const connection = await pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'");
    } catch (error) {
      connection.destroy();
      throw error;
    }
    return {
      query: (sql, values) => query(connection, sql, values),
      release: () => connection.release()
    };
  }

  return {
    connect,
    async query(sql, values) {
      const connection = await connect();
      try {
        return await connection.query(sql, values);
      } finally {
        connection.release();
      }
    },
    end: () => pool.end()
  };
}
