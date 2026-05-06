#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const { loadRuntimeConfig } = require('./config.cjs');
const { createFirestoreClient } = require('./firestore-client.cjs');
const { buildMirrorDocId, cleanString, nowIso, toIsoDate, toNumber, uniqueValues } = require('./helpers.cjs');
const { createMySqlClient } = require('./mysql-client.cjs');
const {
    PAYMENT_METHODS,
    buildApCreditDocs,
    buildApPaymentDocs,
    buildArCreditDocs,
    buildArPaymentDocs,
    buildCustomerDocs,
    buildExpenseDocs,
    buildFixedOperationProfile,
    buildInventoryDocs,
    buildPurchaseDocs,
    buildSalesDocs,
    buildSupplierDocs,
    createReferenceContext
} = require('./transformers.cjs');

const MAX_SQL_IN_IDS = 500;

const dedupeBy = (rows = [], key) => {
    const map = new Map();
    for (const row of rows) {
        map.set(String(row[key]), row);
    }
    return [...map.values()];
};

const mapBy = (rows = [], key) =>
    rows.reduce((accumulator, row) => {
        accumulator.set(String(row[key]), row);
        return accumulator;
    }, new Map());

const groupBy = (rows = [], key) =>
    rows.reduce((accumulator, row) => {
        const mapKey = String(row[key]);
        const existing = accumulator.get(mapKey) || [];
        existing.push(row);
        accumulator.set(mapKey, existing);
        return accumulator;
    }, new Map());

const sqlLimit = (limit) => limit > 0 ? ` LIMIT ${Number(limit)}` : '';

const fetchCustomers = async (db) =>
    db.query('SELECT * FROM cliente ORDER BY cli_id ASC');

const fetchSuppliers = async (db) =>
    db.query('SELECT * FROM proveedor ORDER BY pro_id ASC');

const fetchSalesSince = async (db, sinceDate, limit = 0) =>
    db.query(
        `SELECT v.*, c.nombre AS caja_nombre
         FROM venta v
         LEFT JOIN caja c ON c.caj_id = v.caj_id
         WHERE v.fecha >= ?
         ORDER BY v.fecha ASC, v.ven_id ASC${sqlLimit(limit)}`,
        [sinceDate]
    );

const fetchSalesByIds = async (db, saleIds = []) =>
    db.queryInChunks(
        saleIds,
        (chunk) => `
            SELECT v.*, c.nombre AS caja_nombre
            FROM venta v
            LEFT JOIN caja c ON c.caj_id = v.caj_id
            WHERE v.ven_id IN (?)
            ORDER BY v.fecha ASC, v.ven_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchSaleDetails = async (db, saleIds = []) =>
    db.queryInChunks(
        saleIds,
        () => `
            SELECT *
            FROM detallev
            WHERE ven_id IN (?)
            ORDER BY ven_id ASC, orden ASC, art_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchSalePayments = async (db, saleIds = []) =>
    db.queryInChunks(
        saleIds,
        () => `
            SELECT vtp.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
            FROM ventatipopago vtp
            LEFT JOIN tipopago tp ON tp.tpa_id = vtp.tpa_id
            WHERE vtp.ven_id IN (?)
            ORDER BY vtp.ven_id ASC, vtp.tpa_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchPurchasesSince = async (db, sinceDate, limit = 0) =>
    db.query(
        `SELECT c.*, p.nombre AS proveedorNombre, p.alias AS proveedorAlias, ca.nombre AS caja_nombre
         FROM compra c
         LEFT JOIN proveedor p ON p.pro_id = c.pro_id
         LEFT JOIN caja ca ON ca.caj_id = c.caj_id
         WHERE c.fecha >= ?
         ORDER BY c.fecha ASC, c.com_id ASC${sqlLimit(limit)}`,
        [sinceDate]
    );

const fetchPurchasesByIds = async (db, purchaseIds = []) =>
    db.queryInChunks(
        purchaseIds,
        () => `
            SELECT c.*, p.nombre AS proveedorNombre, p.alias AS proveedorAlias, ca.nombre AS caja_nombre
            FROM compra c
            LEFT JOIN proveedor p ON p.pro_id = c.pro_id
            LEFT JOIN caja ca ON ca.caj_id = c.caj_id
            WHERE c.com_id IN (?)
            ORDER BY c.fecha ASC, c.com_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchPurchaseDetails = async (db, purchaseIds = []) =>
    db.queryInChunks(
        purchaseIds,
        () => `
            SELECT dc.*, art.caracteristicas AS articuloComentario
            FROM detallec dc
            LEFT JOIN articulo art ON art.art_id = dc.art_id
            WHERE dc.com_id IN (?)
            ORDER BY com_id ASC, orden ASC, art_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchPurchasePayments = async (db, purchaseIds = []) =>
    db.queryInChunks(
        purchaseIds,
        () => `
            SELECT ctp.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
            FROM compratipopago ctp
            LEFT JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
            WHERE ctp.com_id IN (?)
            ORDER BY ctp.com_id ASC, ctp.tpa_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchArCreditsSince = async (db, sinceDate, limit = 0) =>
    db.query(
        `SELECT ccl.*, cli.nombre AS clienteNombre, cli.clave AS clienteClave, v.fecha AS venta_fecha, v.caj_id, ca.nombre AS caja_nombre
         FROM creditocliente ccl
         LEFT JOIN cliente cli ON cli.cli_id = ccl.cli_id
         LEFT JOIN venta v ON v.ven_id = ccl.ven_id
         LEFT JOIN caja ca ON ca.caj_id = v.caj_id
         WHERE (v.fecha >= ? OR ccl.fechaLimite >= ?)
         ORDER BY ccl.ccl_id ASC${sqlLimit(limit)}`,
        [sinceDate, sinceDate]
    );

const fetchArCreditsByIds = async (db, creditIds = []) =>
    db.queryInChunks(
        creditIds,
        () => `
            SELECT ccl.*, cli.nombre AS clienteNombre, cli.clave AS clienteClave, v.fecha AS venta_fecha, v.caj_id, ca.nombre AS caja_nombre
            FROM creditocliente ccl
            LEFT JOIN cliente cli ON cli.cli_id = ccl.cli_id
            LEFT JOIN venta v ON v.ven_id = ccl.ven_id
            LEFT JOIN caja ca ON ca.caj_id = v.caj_id
            WHERE ccl.ccl_id IN (?)
            ORDER BY ccl.ccl_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchArPaymentsSince = async (db, sinceDate) =>
    db.query(
        `SELECT acl.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
         FROM abonocliente acl
         LEFT JOIN tipopago tp ON tp.tpa_id = acl.tpa_id
         WHERE acl.fecha >= ?
         ORDER BY acl.fecha ASC, acl.acl_id ASC`,
        [sinceDate]
    );

const fetchArPaymentsByCreditIds = async (db, creditIds = []) =>
    db.queryInChunks(
        creditIds,
        () => `
            SELECT acl.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
            FROM abonocliente acl
            LEFT JOIN tipopago tp ON tp.tpa_id = acl.tpa_id
            WHERE acl.ccl_id IN (?)
            ORDER BY acl.ccl_id ASC, acl.fecha ASC, acl.acl_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchApCreditsSince = async (db, sinceDate, limit = 0) =>
    db.query(
        `SELECT cpr.*, p.nombre AS proveedorNombre, p.alias AS proveedorAlias, c.fecha AS compra_fecha, c.caj_id, ca.nombre AS caja_nombre, c.gasto
         FROM creditoproveedor cpr
         LEFT JOIN proveedor p ON p.pro_id = cpr.pro_id
         LEFT JOIN compra c ON c.com_id = cpr.com_id
         LEFT JOIN caja ca ON ca.caj_id = c.caj_id
         WHERE (c.fecha >= ? OR cpr.fechaLimite >= ?)
         ORDER BY cpr.cpr_id ASC${sqlLimit(limit)}`,
        [sinceDate, sinceDate]
    );

const fetchApCreditsByIds = async (db, creditIds = []) =>
    db.queryInChunks(
        creditIds,
        () => `
            SELECT cpr.*, p.nombre AS proveedorNombre, p.alias AS proveedorAlias, c.fecha AS compra_fecha, c.caj_id, ca.nombre AS caja_nombre, c.gasto
            FROM creditoproveedor cpr
            LEFT JOIN proveedor p ON p.pro_id = cpr.pro_id
            LEFT JOIN compra c ON c.com_id = cpr.com_id
            LEFT JOIN caja ca ON ca.caj_id = c.caj_id
            WHERE cpr.cpr_id IN (?)
            ORDER BY cpr.cpr_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchApPaymentsSince = async (db, sinceDate) =>
    db.query(
        `SELECT apr.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
         FROM abonoproveedor apr
         LEFT JOIN tipopago tp ON tp.tpa_id = apr.tpa_id
         WHERE apr.fecha >= ?
         ORDER BY apr.fecha ASC, apr.apr_id ASC`,
        [sinceDate]
    );

const fetchApPaymentsByCreditIds = async (db, creditIds = []) =>
    db.queryInChunks(
        creditIds,
        () => `
            SELECT apr.*, tp.nombre AS tipo_pago_nombre, tp.abr AS tipo_pago_abr
            FROM abonoproveedor apr
            LEFT JOIN tipopago tp ON tp.tpa_id = apr.tpa_id
            WHERE apr.cpr_id IN (?)
            ORDER BY apr.cpr_id ASC, apr.fecha ASC, apr.apr_id ASC
        `,
        MAX_SQL_IN_IDS
    );

const fetchInventoryBalances = async (db) =>
    db.query('SELECT * FROM articulo ORDER BY art_id ASC');

const buildSeedConfigDocument = ({ runtimeConfig, syncedAt, integrationConfig = {} }) => ({
    version: 1,
    updatedAt: syncedAt,
    updatedBy: 'scripts/sicar-integration/run-sicar-sync.cjs',
    notes: 'Configuracion semillada automaticamente para el espejo SICAR -> Firebase en Granada.',
    operationProfile: buildFixedOperationProfile(integrationConfig),
    paymentTypeMap: PAYMENT_METHODS,
    expenseSkuAccountMap: integrationConfig.expenseSkuAccountMap || {},
    syncPolicies: {
        softCancel: true,
        markZeroAmountAbonos: true,
        writeInventoryCache: Boolean(runtimeConfig.cli.writeInventoryCache),
        defaultLookbackDays: runtimeConfig.cli.lookbackDays
    },
    mysqlDiscovery: runtimeConfig.mysql.discovery,
    firebaseMode: runtimeConfig.firebase.admin.enabled ? 'admin' : 'rest'
});

const attachPurchaseItems = (purchases = [], purchaseDetailsById = new Map()) =>
    purchases.map((purchase) => ({
        ...purchase,
        items: purchaseDetailsById.get(String(purchase.com_id)) || []
    }));

const writeLocalReport = ({ report, logDirectory }) => {
    const fileName = `sicar-sync-${report.startedAt.replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(logDirectory, fileName);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
};

const run = async () => {
    const startedAt = nowIso();
    const runtimeConfig = loadRuntimeConfig({ repoRoot: process.cwd() });
    const firestore = createFirestoreClient(runtimeConfig.firebase);
    const mysql = await createMySqlClient(runtimeConfig.mysql);

    const report = {
        startedAt,
        finishedAt: null,
        mode: runtimeConfig.cli.mode,
        sinceDate: runtimeConfig.cli.sinceDate,
        lookbackDays: runtimeConfig.cli.lookbackDays,
        modules: runtimeConfig.cli.modules,
        firebaseMode: firestore.mode,
        mysql: {
            host: runtimeConfig.mysql.host,
            port: runtimeConfig.mysql.port,
            database: runtimeConfig.mysql.database,
            user: runtimeConfig.mysql.user,
            passwordSource: runtimeConfig.mysql.discovery.passwordSource
        },
        writtenCollections: {},
        extracted: {},
        warnings: [],
        recommendedActions: []
    };

    try {
        const [accountDocs, integrationConfigDoc] = await Promise.all([
            firestore.listCollection('planCuentas'),
            firestore.getDocument('configuracion/sicarIntegration')
        ]);

        const accounts = accountDocs.map((item) => ({
            id: item.id,
            ...item.data
        }));
        const integrationConfig = {
            ...(integrationConfigDoc?.data || {})
        };
        integrationConfig.operationProfile = buildFixedOperationProfile(integrationConfig);

        const reference = createReferenceContext({
            accounts,
            integrationConfig
        });

        if (runtimeConfig.cli.seedConfig) {
            const configPayload = buildSeedConfigDocument({
                runtimeConfig,
                syncedAt: startedAt,
                integrationConfig
            });

            await firestore.setDocument('configuracion/sicarIntegration', configPayload);
            report.writtenCollections.configuracion = 1;
            report.recommendedActions.push('La integracion queda fija para CARNES SAN MARTIN GRANADA; cualquier cambio futuro de sede debe hacerse de forma explicita.');
            report.finishedAt = nowIso();
            report.logFile = writeLocalReport({
                report,
                logDirectory: runtimeConfig.logDirectory
            });

            console.log(JSON.stringify(report, null, 2));
            return;
        }

        const customersPromise = runtimeConfig.cli.modules.includes('masters')
            ? fetchCustomers(mysql)
            : Promise.resolve([]);
        const suppliersPromise = runtimeConfig.cli.modules.includes('masters')
            ? fetchSuppliers(mysql)
            : Promise.resolve([]);
        const inventoryPromise = runtimeConfig.cli.modules.includes('inventory')
            ? fetchInventoryBalances(mysql)
            : Promise.resolve([]);
        const recentSalesPromise = runtimeConfig.cli.modules.includes('sales')
            ? fetchSalesSince(mysql, runtimeConfig.cli.sinceDate, runtimeConfig.cli.limit)
            : Promise.resolve([]);
        const recentPurchasesPromise = (runtimeConfig.cli.modules.includes('purchases') || runtimeConfig.cli.modules.includes('expenses'))
            ? fetchPurchasesSince(mysql, runtimeConfig.cli.sinceDate, runtimeConfig.cli.limit)
            : Promise.resolve([]);
        const arCreditsPromise = runtimeConfig.cli.modules.includes('ar')
            ? fetchArCreditsSince(mysql, runtimeConfig.cli.sinceDate, runtimeConfig.cli.limit)
            : Promise.resolve([]);
        const arPaymentsPromise = runtimeConfig.cli.modules.includes('ar')
            ? fetchArPaymentsSince(mysql, runtimeConfig.cli.sinceDate)
            : Promise.resolve([]);
        const apCreditsPromise = runtimeConfig.cli.modules.includes('ap')
            ? fetchApCreditsSince(mysql, runtimeConfig.cli.sinceDate, runtimeConfig.cli.limit)
            : Promise.resolve([]);
        const apPaymentsPromise = runtimeConfig.cli.modules.includes('ap')
            ? fetchApPaymentsSince(mysql, runtimeConfig.cli.sinceDate)
            : Promise.resolve([]);

        const [
            customers,
            suppliers,
            inventoryItems,
            recentSales,
            recentPurchases,
            recentArCredits,
            recentArPayments,
            recentApCredits,
            recentApPayments
        ] = await Promise.all([
            customersPromise,
            suppliersPromise,
            inventoryPromise,
            recentSalesPromise,
            recentPurchasesPromise,
            arCreditsPromise,
            arPaymentsPromise,
            apCreditsPromise,
            apPaymentsPromise
        ]);

        const extraArCreditIds = uniqueValues(recentArPayments.map((item) => item.ccl_id))
            .filter((id) => !recentArCredits.some((credit) => String(credit.ccl_id) === String(id)));
        const extraApCreditIds = uniqueValues(recentApPayments.map((item) => item.cpr_id))
            .filter((id) => !recentApCredits.some((credit) => String(credit.cpr_id) === String(id)));

        const [extraArCredits, extraApCredits] = await Promise.all([
            extraArCreditIds.length ? fetchArCreditsByIds(mysql, extraArCreditIds) : Promise.resolve([]),
            extraApCreditIds.length ? fetchApCreditsByIds(mysql, extraApCreditIds) : Promise.resolve([])
        ]);

        const arCredits = dedupeBy([...recentArCredits, ...extraArCredits], 'ccl_id');
        const apCredits = dedupeBy([...recentApCredits, ...extraApCredits], 'cpr_id');

        const [allArPayments, allApPayments] = await Promise.all([
            arCredits.length ? fetchArPaymentsByCreditIds(mysql, arCredits.map((item) => item.ccl_id)) : Promise.resolve([]),
            apCredits.length ? fetchApPaymentsByCreditIds(mysql, apCredits.map((item) => item.cpr_id)) : Promise.resolve([])
        ]);

        const supplementalSaleIds = uniqueValues(arCredits.map((credit) => credit.ven_id))
            .filter((id) => !recentSales.some((sale) => String(sale.ven_id) === String(id)));
        const supplementalPurchaseIds = uniqueValues(apCredits.map((credit) => credit.com_id))
            .filter((id) => !recentPurchases.some((purchase) => String(purchase.com_id) === String(id)));

        const [extraSales, extraPurchases] = await Promise.all([
            supplementalSaleIds.length ? fetchSalesByIds(mysql, supplementalSaleIds) : Promise.resolve([]),
            supplementalPurchaseIds.length ? fetchPurchasesByIds(mysql, supplementalPurchaseIds) : Promise.resolve([])
        ]);

        const sales = dedupeBy([...recentSales, ...extraSales], 'ven_id');
        const purchases = dedupeBy([...recentPurchases, ...extraPurchases], 'com_id');

        const [saleDetails, salePayments, purchaseDetails, purchasePayments] = await Promise.all([
            sales.length ? fetchSaleDetails(mysql, sales.map((item) => item.ven_id)) : Promise.resolve([]),
            sales.length ? fetchSalePayments(mysql, sales.map((item) => item.ven_id)) : Promise.resolve([]),
            purchases.length ? fetchPurchaseDetails(mysql, purchases.map((item) => item.com_id)) : Promise.resolve([]),
            purchases.length ? fetchPurchasePayments(mysql, purchases.map((item) => item.com_id)) : Promise.resolve([])
        ]);

        const customersById = mapBy(customers, 'cli_id');
        const suppliersById = mapBy(suppliers, 'pro_id');
        const saleDetailsById = groupBy(saleDetails, 'ven_id');
        const salePaymentsById = groupBy(salePayments, 'ven_id');
        const purchaseDetailsById = groupBy(purchaseDetails, 'com_id');
        const purchasePaymentsById = groupBy(purchasePayments, 'com_id');
        const purchasesWithItems = attachPurchaseItems(purchases, purchaseDetailsById);
        const purchasesById = mapBy(purchasesWithItems, 'com_id');
        const salesById = mapBy(sales, 'ven_id');
        const arCreditsBySaleId = groupBy(arCredits, 'ven_id');
        const arCreditsById = mapBy(arCredits, 'ccl_id');
        const arPaymentsByCreditId = groupBy(allArPayments, 'ccl_id');
        const apCreditsByPurchaseId = groupBy(apCredits, 'com_id');
        const apCreditsById = mapBy(apCredits, 'cpr_id');
        const apPaymentsByCreditId = groupBy(allApPayments, 'cpr_id');

        const customerBalances = new Map();
        for (const credit of arCredits) {
            const creditPayments = arPaymentsByCreditId.get(String(credit.ccl_id)) || [];
            const totalAbonos = creditPayments
                .filter((item) => Number(item.status) === 1)
                .reduce((sum, item) => sum + toNumber(item.total), 0);
            const saldoPendiente = Math.max(0, toNumber(credit.total) - totalAbonos);
            const key = String(credit.cli_id);
            const current = customerBalances.get(key) || {
                saldoPendiente: 0,
                totalCreditos: 0,
                totalAbonos: 0
            };
            current.saldoPendiente += saldoPendiente;
            current.totalCreditos += toNumber(credit.total);
            current.totalAbonos += totalAbonos;
            customerBalances.set(key, current);
        }

        const supplierBalances = new Map();
        for (const credit of apCredits) {
            const creditPayments = apPaymentsByCreditId.get(String(credit.cpr_id)) || [];
            const totalAbonos = creditPayments
                .filter((item) => Number(item.status) === 1)
                .reduce((sum, item) => sum + toNumber(item.total), 0);
            const saldoPendiente = Math.max(0, toNumber(credit.total) - totalAbonos);
            const key = String(credit.pro_id);
            const current = supplierBalances.get(key) || {
                saldoPendiente: 0,
                totalCompras: 0,
                totalPagos: 0
            };
            current.saldoPendiente += saldoPendiente;
            current.totalCompras += toNumber(credit.total);
            current.totalPagos += totalAbonos;
            supplierBalances.set(key, current);
        }

        const collections = [];

        if (runtimeConfig.cli.modules.includes('masters')) {
            collections.push({
                collectionName: 'clientes',
                docs: buildCustomerDocs({
                    customers,
                    customerBalances,
                    reference,
                    syncedAt: startedAt
                })
            });
            collections.push({
                collectionName: 'proveedores',
                docs: buildSupplierDocs({
                    suppliers,
                    supplierBalances,
                    reference,
                    syncedAt: startedAt
                })
            });
        }

        if (runtimeConfig.cli.modules.includes('sales')) {
            collections.push({
                collectionName: 'ventasDirectas',
                docs: buildSalesDocs({
                    sales,
                    saleDetailsById,
                    salePaymentsById,
                    creditsBySaleId: arCreditsBySaleId,
                    customersById,
                    reference,
                    syncedAt: startedAt
                })
            });
        }

        if (runtimeConfig.cli.modules.includes('ar')) {
            collections.push({
                collectionName: 'cuentasPorCobrar',
                docs: buildArCreditDocs({
                    credits: arCredits,
                    abonosByCreditId: arPaymentsByCreditId,
                    customersById,
                    salesById,
                    reference,
                    syncedAt: startedAt
                })
            });
            collections.push({
                collectionName: 'abonosClientes',
                docs: buildArPaymentDocs({
                    abonos: allArPayments,
                    creditsById: arCreditsById,
                    customersById,
                    salesById,
                    reference,
                    syncedAt: startedAt
                })
            });
        }

        if (runtimeConfig.cli.modules.includes('purchases')) {
            collections.push({
                collectionName: 'compras',
                docs: buildPurchaseDocs({
                    purchases: purchasesWithItems,
                    purchaseDetailsById,
                    purchasePaymentsById,
                    creditsByPurchaseId: apCreditsByPurchaseId,
                    suppliersById,
                    reference,
                    syncedAt: startedAt
                })
            });
        }

        if (runtimeConfig.cli.modules.includes('expenses')) {
            collections.push({
                collectionName: 'gastosDirectos',
                docs: buildExpenseDocs({
                    purchases: purchasesWithItems,
                    purchaseDetailsById,
                    purchasePaymentsById,
                    creditsByPurchaseId: apCreditsByPurchaseId,
                    suppliersById,
                    reference,
                    syncedAt: startedAt
                })
            });
        }

        if (runtimeConfig.cli.modules.includes('ap')) {
            collections.push({
                collectionName: 'facturasProveedor',
                docs: buildApCreditDocs({
                    credits: apCredits,
                    abonosByCreditId: apPaymentsByCreditId,
                    purchasesById,
                    suppliersById,
                    reference,
                    syncedAt: startedAt
                })
            });

            const apPaymentBundle = buildApPaymentDocs({
                abonos: allApPayments,
                creditsById: apCreditsById,
                purchasesById,
                suppliersById,
                reference,
                syncedAt: startedAt
            });

            collections.push({
                collectionName: 'abonosProveedor',
                docs: apPaymentBundle.payments
            });
            collections.push({
                collectionName: 'abonosFacturaDetalle',
                docs: apPaymentBundle.paymentDetails
            });
        }

        if (runtimeConfig.cli.modules.includes('inventory') && runtimeConfig.cli.writeInventoryCache) {
            collections.push({
                collectionName: 'inventarioSaldosCache',
                docs: buildInventoryDocs({
                    items: inventoryItems,
                    syncedAt: startedAt
                })
            });
        }

        report.extracted = {
            customers: customers.length,
            suppliers: suppliers.length,
            inventoryItems: inventoryItems.length,
            sales: sales.length,
            saleDetails: saleDetails.length,
            salePayments: salePayments.length,
            arCredits: arCredits.length,
            arPayments: allArPayments.length,
            purchases: purchases.length,
            purchaseDetails: purchaseDetails.length,
            purchasePayments: purchasePayments.length,
            apCredits: apCredits.length,
            apPayments: allApPayments.length
        };

        report.preview = Object.fromEntries(
            collections.map((collection) => [
                collection.collectionName,
                collection.docs.slice(0, 2).map((item) => ({
                    id: item.id,
                    fecha: item.data.fecha || item.data.fechaEmision || '',
                    descripcion: item.data.descripcion || item.data.concepto || item.data.nombre || item.data.proveedorNombre || '',
                    monto: toNumber(item.data.monto || item.data.montoTotal || item.data.saldoPendiente || 0),
                    sucursalName: item.data.sucursalName || item.data.sourceCajaName || '',
                    estado: item.data.estado || item.data.statusLabel || ''
                }))
            ])
        );

        if (runtimeConfig.cli.mode === 'live') {
            for (const collection of collections) {
                if (!collection.docs.length) {
                    report.writtenCollections[collection.collectionName] = 0;
                    continue;
                }

                report.writtenCollections[collection.collectionName] = await firestore.setDocuments(
                    collection.collectionName,
                    collection.docs
                );
            }

            await firestore.setDocument(
                'configuracion/sicarIntegration',
                buildSeedConfigDocument({
                    runtimeConfig,
                    syncedAt: startedAt,
                    integrationConfig
                })
            );

            await firestore.setDocument(
                `integracionLogs/sicarSync_${startedAt.replace(/[:.]/g, '_')}`,
                {
                    startedAt,
                    finishedAt: nowIso(),
                    mode: runtimeConfig.cli.mode,
                    sinceDate: runtimeConfig.cli.sinceDate,
                    lookbackDays: runtimeConfig.cli.lookbackDays,
                    modules: runtimeConfig.cli.modules,
                    writtenCollections: report.writtenCollections,
                    extracted: report.extracted,
                    warnings: report.warnings,
                    sourceSystem: 'sicar'
                }
            );
        } else {
            for (const collection of collections) {
                report.writtenCollections[collection.collectionName] = 0;
            }
        }

        report.recommendedActions.push('Validar que todos los documentos espejo se registren con sucursal fija CARNES SAN MARTIN GRANADA.');
        report.recommendedActions.push('Ejecutar un primer sync live con ventana de 45-90 dias y luego programar corridas incrementales cada 10-15 minutos.');
        report.finishedAt = nowIso();
        report.logFile = writeLocalReport({
            report,
            logDirectory: runtimeConfig.logDirectory
        });

        console.log(JSON.stringify(report, null, 2));
    } finally {
        await mysql.close();
    }
};

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
