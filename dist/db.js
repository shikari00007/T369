"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.withTransaction = withTransaction;
exports.closePool = closePool;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'postgres',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 't369',
    user: process.env.POSTGRES_USER || 't369',
    password: process.env.POSTGRES_PASSWORD || 'change_me_securely',
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
async function query(text, params = []) {
    return pool.query(text, params);
}
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function closePool() {
    await pool.end();
}
