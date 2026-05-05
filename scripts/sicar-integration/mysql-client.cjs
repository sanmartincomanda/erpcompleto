const mysql = require('mysql2/promise');

const createMySqlClient = async (config) => {
    const pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 6,
        queueLimit: 0,
        timezone: 'Z',
        decimalNumbers: true
    });

    const query = async (sql, params = []) => {
        const [rows] = await pool.query(sql, params);
        return rows;
    };

    const queryInChunks = async (ids = [], sqlFactory, chunkSize = 500) => {
        const uniqueIds = [...new Set(ids.filter((item) => item !== undefined && item !== null))];
        if (!uniqueIds.length) return [];

        const results = [];
        for (let index = 0; index < uniqueIds.length; index += chunkSize) {
            const chunk = uniqueIds.slice(index, index + chunkSize);
            const rows = await query(sqlFactory(chunk), [chunk]);
            results.push(...rows);
        }

        return results;
    };

    const close = async () => {
        await pool.end();
    };

    return {
        pool,
        query,
        queryInChunks,
        close
    };
};

module.exports = {
    createMySqlClient
};
