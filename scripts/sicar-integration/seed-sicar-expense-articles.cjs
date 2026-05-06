#!/usr/bin/env node

const path = require('node:path');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const { loadRuntimeConfig } = require('./config.cjs');
const { cleanString, nowIso } = require('./helpers.cjs');
const { createFirestoreClient } = require('./firestore-client.cjs');
const { createMySqlClient } = require('./mysql-client.cjs');

const EXPENSE_GROUP_CODES = new Set(['6101', '6102', '6103']);

const EXPENSE_CATEGORY_NAME = 'GASTOS';
const UNIT_ID = 1;

const normalizeCode = (value) => cleanString(value).replace(/\./g, '').toUpperCase();

const getExpenseAccounts = async (firestore) => {
    const docs = await firestore.listCollection('planCuentas');
    const rows = docs.map(({ id, data }) => ({ id, ...data }));
    const groups = rows.filter((row) => String(row.type || '').toUpperCase() === 'GASTO' && row.isGroup);
    const groupsById = new Map(groups.map((row) => [row.id, row]));

    return rows
        .filter((row) => String(row.type || '').toUpperCase() === 'GASTO' && !row.isGroup)
        .map((row) => {
            const parent = groupsById.get(row.parentId) || null;
            return {
                code: cleanString(row.code),
                normalizedCode: normalizeCode(row.code),
                name: cleanString(row.name),
                comment: cleanString(row.description) || cleanString(row.name),
                departmentName: cleanString(parent?.name),
                parentCode: cleanString(parent?.code)
            };
        })
        .filter((row) => row.code && row.name && EXPENSE_GROUP_CODES.has(row.parentCode))
        .sort((a, b) => a.code.localeCompare(b.code));
};

const ensureDepartment = async (connection, departmentName) => {
    const [existing] = await connection.query(
        'SELECT dep_id, nombre, status FROM departamento WHERE nombre = ? AND system = 0 LIMIT 1',
        [departmentName]
    );

    if (existing.length) {
        if (Number(existing[0].status) !== 1) {
            await connection.query('UPDATE departamento SET status = 1 WHERE dep_id = ?', [existing[0].dep_id]);
        }
        return { dep_id: existing[0].dep_id, action: 'existing' };
    }

    const [insertResult] = await connection.query(
        `INSERT INTO departamento (nombre, restringido, porcentaje, system, status, imagen, comision)
         VALUES (?, 0, 0.00, 0, 1, NULL, NULL)`,
        [departmentName]
    );

    return { dep_id: insertResult.insertId, action: 'created' };
};

const ensureCategory = async (connection, departmentId) => {
    const [existing] = await connection.query(
        'SELECT cat_id, nombre, status FROM categoria WHERE dep_id = ? AND nombre = ? AND system = 0 LIMIT 1',
        [departmentId, EXPENSE_CATEGORY_NAME]
    );

    if (existing.length) {
        if (Number(existing[0].status) !== 1) {
            await connection.query('UPDATE categoria SET status = 1 WHERE cat_id = ?', [existing[0].cat_id]);
        }
        return { cat_id: existing[0].cat_id, action: 'existing' };
    }

    const [insertResult] = await connection.query(
        `INSERT INTO categoria (nombre, system, status, dep_id, imagen, comision)
         VALUES (?, 0, 1, ?, NULL, NULL)`,
        [EXPENSE_CATEGORY_NAME, departmentId]
    );

    return { cat_id: insertResult.insertId, action: 'created' };
};

const buildInsertPayload = (account, categoryId) => ({
    clave: account.code,
    claveAlterna: account.code,
    descripcion: account.name,
    servicio: 0,
    localizacion: '',
    invMin: 0,
    invMax: 0,
    factor: 1,
    precioCompra: 0,
    preCompraProm: 0,
    margen1: 0,
    margen2: 0,
    margen3: 0,
    margen4: 0,
    precio1: 0,
    precio2: 0,
    precio3: 0,
    precio4: 0,
    mayoreo1: 0,
    mayoreo2: 0,
    mayoreo3: 0,
    mayoreo4: 0,
    existencia: 0,
    aislado: 0,
    disponible: 0,
    caracteristicas: account.comment,
    cuentaPredial: '',
    granel: 0,
    status: 1,
    unidadCompra: UNIT_ID,
    unidadVenta: UNIT_ID,
    cat_id: categoryId,
    diasVigencia: 0,
    existenciaActivo: 0,
    preCompraPromGas: 0,
    showEco: 1,
    presentacionPrecio: 1,
    etiquetaVenta: 0
});

const insertArticle = async (connection, payload) => {
    const sql = `
        INSERT INTO articulo (
            clave, claveAlterna, descripcion, servicio, localizacion, invMin, invMax, factor,
            precioCompra, preCompraProm, margen1, margen2, margen3, margen4,
            precio1, precio2, precio3, precio4,
            mayoreo1, mayoreo2, mayoreo3, mayoreo4,
            existencia, aislado, disponible, caracteristicas, cuentaPredial,
            granel, status, unidadCompra, unidadVenta, cat_id, diasVigencia,
            existenciaActivo, preCompraPromGas, showEco, presentacionPrecio, etiquetaVenta
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    `;

    const params = [
        payload.clave,
        payload.claveAlterna,
        payload.descripcion,
        payload.servicio,
        payload.localizacion,
        payload.invMin,
        payload.invMax,
        payload.factor,
        payload.precioCompra,
        payload.preCompraProm,
        payload.margen1,
        payload.margen2,
        payload.margen3,
        payload.margen4,
        payload.precio1,
        payload.precio2,
        payload.precio3,
        payload.precio4,
        payload.mayoreo1,
        payload.mayoreo2,
        payload.mayoreo3,
        payload.mayoreo4,
        payload.existencia,
        payload.aislado,
        payload.disponible,
        payload.caracteristicas,
        payload.cuentaPredial,
        payload.granel,
        payload.status,
        payload.unidadCompra,
        payload.unidadVenta,
        payload.cat_id,
        payload.diasVigencia,
        payload.existenciaActivo,
        payload.preCompraPromGas,
        payload.showEco,
        payload.presentacionPrecio,
        payload.etiquetaVenta
    ];

    const [result] = await connection.query(sql, params);
    return result.insertId;
};

const updateArticle = async (connection, articleId, payload) => {
    await connection.query(
        `UPDATE articulo
         SET claveAlterna = ?,
             descripcion = ?,
             caracteristicas = ?,
             cat_id = ?,
             status = 1,
             unidadCompra = ?,
             unidadVenta = ?,
             servicio = 0,
             factor = 1,
             presentacionPrecio = 1,
             granel = 0,
             localizacion = ''
         WHERE art_id = ?`,
        [
            payload.claveAlterna,
            payload.descripcion,
            payload.caracteristicas,
            payload.cat_id,
            payload.unidadCompra,
            payload.unidadVenta,
            articleId
        ]
    );
};

const main = async () => {
    const runtimeConfig = loadRuntimeConfig({ repoRoot: process.cwd(), argv: process.argv.slice(2) });
    const firestore = await createFirestoreClient(runtimeConfig.firebase);
    const db = await createMySqlClient(runtimeConfig.mysql);
    const connection = await db.pool.getConnection();

    const report = {
        startedAt: nowIso(),
        firebaseMode: firestore.mode,
        mysql: {
            host: runtimeConfig.mysql.host,
            port: runtimeConfig.mysql.port,
            database: runtimeConfig.mysql.database,
            user: runtimeConfig.mysql.user
        },
        expenseAccounts: 0,
        departments: {
            created: [],
            reused: []
        },
        categories: {
            created: [],
            reused: []
        },
        articles: {
            inserted: [],
            updated: [],
            unchanged: []
        }
    };

    try {
        const accounts = await getExpenseAccounts(firestore);
        report.expenseAccounts = accounts.length;

        await connection.beginTransaction();

        const categoriesByDepartment = new Map();

        for (const departmentName of [...new Set(accounts.map((item) => item.departmentName))]) {
            const department = await ensureDepartment(connection, departmentName);
            report.departments[department.action === 'created' ? 'created' : 'reused'].push({
                departmentName,
                dep_id: department.dep_id
            });

            const category = await ensureCategory(connection, department.dep_id);
            categoriesByDepartment.set(departmentName, category.cat_id);
            report.categories[category.action === 'created' ? 'created' : 'reused'].push({
                departmentName,
                cat_id: category.cat_id,
                categoryName: EXPENSE_CATEGORY_NAME
            });
        }

        const [existingArticles] = await connection.query(
            `SELECT art_id, clave, descripcion, caracteristicas, cat_id, status
             FROM articulo
             WHERE clave IN (?)`,
            [accounts.map((item) => item.code)]
        );
        const existingByCode = new Map(existingArticles.map((item) => [cleanString(item.clave), item]));

        for (const account of accounts) {
            const categoryId = categoriesByDepartment.get(account.departmentName);
            const payload = buildInsertPayload(account, categoryId);
            const existing = existingByCode.get(account.code);

            if (!existing) {
                const insertId = await insertArticle(connection, payload);
                report.articles.inserted.push({
                    art_id: insertId,
                    clave: account.code,
                    descripcion: account.name,
                    departmentName: account.departmentName,
                    cat_id: categoryId
                });
                continue;
            }

            const requiresUpdate =
                cleanString(existing.descripcion) !== payload.descripcion ||
                cleanString(existing.caracteristicas) !== payload.caracteristicas ||
                Number(existing.cat_id) !== Number(payload.cat_id) ||
                Number(existing.status) !== 1;

            if (requiresUpdate) {
                await updateArticle(connection, existing.art_id, payload);
                report.articles.updated.push({
                    art_id: existing.art_id,
                    clave: account.code,
                    descripcion: account.name,
                    departmentName: account.departmentName,
                    cat_id: categoryId
                });
                continue;
            }

            report.articles.unchanged.push({
                art_id: existing.art_id,
                clave: account.code,
                descripcion: cleanString(existing.descripcion)
            });
        }

        await connection.commit();
        report.finishedAt = nowIso();
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        console.error(error);
        process.exitCode = 1;
    } finally {
        connection.release();
        await db.close();
    }
};

main();
