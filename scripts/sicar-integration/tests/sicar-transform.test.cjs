const assert = require('node:assert/strict');

const {
    buildFixedOperationProfile,
    createReferenceContext,
    mapCreditState,
    normalizeCurrency,
    resolveExpenseAccount,
    resolveBranch
} = require('../transformers.cjs');

const accounts = [
    { id: 'sales', code: '410101', name: 'VENTAS', type: 'INGRESO' },
    { id: 'cost', code: '510101', name: 'COSTO VENTAS', type: 'COSTO' },
    { id: 'expense', code: '610399', name: 'OTROS GASTOS DIVERSOS', type: 'GASTO' },
    { id: 'expenseMayor', code: '610304', name: 'ALCALDIA - 1% SOBRE VENTAS', type: 'GASTO' },
    { id: 'clients', code: '110301', name: 'CLIENTES', type: 'ACTIVO' },
    { id: 'suppliers', code: '210101', name: 'PROVEEDORES', type: 'PASIVO' }
];

const operationProfile = buildFixedOperationProfile();
assert.equal(operationProfile.branchId, 'granada');
assert.equal(operationProfile.branchName, 'CARNES SAN MARTIN GRANADA');

const context = createReferenceContext({
    accounts,
    integrationConfig: {
        operationProfile
    }
});

const resolvedOperation = resolveBranch(context, { caj_id: 2, caja_nombre: 'CAJA 2' });
assert.equal(resolvedOperation.branchId, 'granada');
assert.equal(resolvedOperation.branchName, 'CARNES SAN MARTIN GRANADA');
assert.equal(resolvedOperation.needsReview, false);

const expenseResolution = resolveExpenseAccount(context, [
    { clave: '610304', descripcion: 'Alcaldia' }
]);
assert.equal(expenseResolution.account.code, '610304');
assert.equal(expenseResolution.source, 'skuExact');

const mappedExpenseContext = createReferenceContext({
    accounts,
    integrationConfig: {
        operationProfile,
        expenseSkuAccountMap: {
            GASTOADMIN: '610399'
        }
    }
});
const mappedExpenseResolution = resolveExpenseAccount(mappedExpenseContext, [
    { clave: 'GASTOADMIN', descripcion: 'Gasto general' }
]);
assert.equal(mappedExpenseResolution.account.code, '610399');
assert.equal(mappedExpenseResolution.source, 'expenseSkuAccountMap');

assert.equal(mapCreditState(1, 10), 'pendiente');
assert.equal(mapCreditState(2, 0), 'pagada');
assert.equal(mapCreditState(-1, 10), 'anulado');

assert.equal(normalizeCurrency('mxn'), 'NIO');
assert.equal(normalizeCurrency('usd'), 'USD');

console.log('sicar-transform.test: ok');
