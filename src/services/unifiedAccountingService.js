// src/services/unifiedAccountingService.js
// Servicio unificado de contabilidad con códigos DGI Nicaragua

import { db } from '../firebase';
import { 
    collection, 
    addDoc, 
    doc, 
    deleteDoc,
    updateDoc, 
    getDoc, 
    getDocs, 
    query, 
    setDoc,
    where, 
    Timestamp,
    orderBy,
    limit,
    writeBatch
} from 'firebase/firestore';
import {
    calculateArqueoTotals,
    calculateCierreCajaTotals,
    getTipoCambio,
    toNumber
} from '../utils/cierreCajaCalculations';

// Tipos de documentos para asientos contables
export const DOCUMENT_TYPES = {
    CIERRE_CAJA: 'cierreCaja',
    DEPOSITO: 'deposito',
    CONFIRMACION_DEPOSITO: 'confirmacionDeposito',
    FACTURA_PROVEEDOR: 'facturaProveedor',
    PAGO_PROVEEDOR: 'pagoProveedor',
    ACTIVO_FIJO: 'activoFijo',
    DEPRECIACION_ACTIVO_FIJO: 'depreciacionActivoFijo',
    GASTO: 'gasto',
    INGRESO: 'ingreso',
    DIFERENCIA_CAJA: 'diferenciaCaja',
    AJUSTE: 'ajuste'
};

// ============================================
// FUNCIONES AUXILIARES PARA BUSCAR CUENTAS
// ============================================

/**
 * Busca una cuenta por su código exacto
 */
const getCuentaByCode = async (code) => {
    if (!code) return null;
    const accountsRef = collection(db, 'planCuentas');
    const q = query(accountsRef, where('code', '==', code));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

const getCuentaById = async (id) => {
    if (!id) return null;
    const accountSnap = await getDoc(doc(db, 'planCuentas', id));
    return accountSnap.exists() ? { id: accountSnap.id, ...accountSnap.data() } : null;
};

/**
 * Busca una cuenta por nombre (búsqueda parcial)
 */
const getCuentaByName = async (searchTerm) => {
    if (!searchTerm) return null;
    const accountsRef = collection(db, 'planCuentas');
    const snap = await getDocs(accountsRef);
    const accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return accounts.find(a => 
        a.name?.toLowerCase().includes(searchTerm.toLowerCase()) && !a.isGroup
    ) || null;
};

/**
 * Obtiene la primera cuenta que coincida con el tipo y subtipo
 */
const getCuentaByType = async (type, subType) => {
    const accountsRef = collection(db, 'planCuentas');
    let q = query(accountsRef, where('type', '==', type));
    if (subType) {
        q = query(q, where('subType', '==', subType));
    }
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// ============================================
// CUENTAS DGI NICARAGUA - MAPEO
// ============================================

const CUENTAS_DGI = {
    // ACTIVOS
    CAJA_GENERAL: '110101',
    CAJA_CHICA: '110102',
    BANCO_BAC_NIO: '11010301',
    BANCO_BAC_USD: '11010302',
    BANCO_BANPRO_NIO: '11010303',
    BANCO_BANPRO_USD: '11010304',
    BANCO_LAFISE_NIO: '11010305',
    BANCO_LAFISE_USD: '11010306',
    DINERO_TRANSITO: '110104',
    CLIENTES: '110301',
    DEUDORES_VARIOS: '110303',
    INVENTARIO_MERCADERIA: '110401',
    IR_ANTICIPADO: '110505',
    
    // PASIVOS
    PROVEEDORES: '210101',
    IVA_POR_PAGAR: '210301',
    IR_POR_PAGAR: '210302',
    ALCALDIA_POR_PAGAR: '210303',
    
    // INGRESOS
    VENTAS_MERCADERIA: '410101',
    VENTAS_PRODUCTOS: '410102',
    VENTAS_SERVICIOS: '410103',
    OTROS_INGRESOS_DIVERSOS: '410205',
    
    // COSTOS
    COSTO_VENTAS: '510101',
    
    // GASTOS
    GASTOS_ADMIN: '6101',
    GASTOS_VENTAS: '6102',
    GASTO_ALCALDIA_VENTAS: '610304',
    GASTOS_EXTRAORDINARIOS: '610302',
    OTROS_GASTOS_DIVERSOS: '610399'
};

const TIPOS_DEUDORA = new Set(['ACTIVO', 'COSTO', 'GASTO']);

const normalizeNature = (nature) => {
    const value = String(nature || '').toUpperCase();

    if (value.includes('DEUD')) return 'DEUDORA';
    if (value.includes('ACRE')) return 'ACREEDORA';

    return '';
};

const inferAccountNature = (account = {}) => {
    const normalized = normalizeNature(account.nature);
    if (normalized) return normalized;
    return TIPOS_DEUDORA.has(account.type) ? 'DEUDORA' : 'ACREEDORA';
};

const hasArqueoData = (arqueo = {}) =>
    [
        'billetes100',
        'billetes50',
        'billetes20',
        'billetes10',
        'billetes5',
        'billetes1',
        'monedas',
        'efectivoUSDFisico'
    ].some((field) => toNumber(arqueo?.[field]) > 0);

const DESGLOSE_METODOS_PAGO_CONFIG = {
    posBAC: 'NIO',
    posBANPRO: 'NIO',
    posLAFISE: 'NIO',
    transferenciaBAC: 'NIO',
    transferenciaBANPRO: 'NIO',
    transferenciaLAFISE: 'NIO',
    transferenciaBAC_USD: 'USD',
    transferenciaLAFISE_USD: 'USD'
};

const normalizeDesgloseMetodosPago = (desgloseMontos = {}) =>
    Object.entries(DESGLOSE_METODOS_PAGO_CONFIG).reduce((accumulator, [field, moneda]) => {
        const items = Array.isArray(desgloseMontos?.[field]) ? desgloseMontos[field] : [];

        accumulator[field] = items
            .map((item, index) => ({
                id: item?.id || `${field}-${index + 1}`,
                descripcion: String(item?.descripcion || '').trim(),
                monto: roundToTwo(toNumber(item?.monto)),
                moneda: item?.moneda || moneda
            }))
            .filter((item) => item.monto > 0);

        return accumulator;
    }, {});

const getDesgloseMetodoPagoTotal = (desgloseMontos = {}, field) =>
    (desgloseMontos?.[field] || []).reduce(
        (total, item) => total + toNumber(item?.monto),
        0
    );

const FIRESTORE_BATCH_LIMIT = 400;

const chunkItems = (items = [], chunkSize = FIRESTORE_BATCH_LIMIT) => {
    const chunks = [];

    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }

    return chunks;
};

const getNextSequentialNumber = async (collectionName, fieldName = 'numero') => {
    const collectionRef = collection(db, collectionName);
    const sequentialQuery = query(collectionRef, orderBy(fieldName, 'desc'), limit(1));
    const snapshot = await getDocs(sequentialQuery);

    return snapshot.empty ? 1 : Number(snapshot.docs[0].data()?.[fieldName] || 0) + 1;
};

const buildCierreCodigo = (numeroCierre) => `CC-${String(Number(numeroCierre) || 0).padStart(6, '0')}`;

const roundToTwo = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizePeriod = (value) => {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}-${match[2]}` : '';
};

const getPeriodFromDate = (dateValue) => {
    if (!dateValue) return '';
    const stringValue = String(dateValue);
    if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
        return stringValue.slice(0, 7);
    }

    const parsed = new Date(stringValue);
    if (Number.isNaN(parsed.getTime())) return '';

    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${parsed.getFullYear()}-${month}`;
};

const getLastDayOfPeriod = (period) => {
    const normalized = normalizePeriod(period);
    if (!normalized) return '';

    const [yearString, monthString] = normalized.split('-');
    const year = Number(yearString);
    const monthIndex = Number(monthString) - 1;
    const lastDay = new Date(year, monthIndex + 1, 0);

    return [
        lastDay.getFullYear(),
        String(lastDay.getMonth() + 1).padStart(2, '0'),
        String(lastDay.getDate()).padStart(2, '0')
    ].join('-');
};

const isProveedorLiabilityAccount = (account = {}) => {
    const normalizedCode = normalizeCode(account.code);
    const normalizedName = String(account.name || '').toLowerCase();

    return (
        account.subType === 'proveedores' ||
        normalizedCode === '210101' ||
        normalizedName.includes('proveedor')
    );
};

const deleteCollectionDocuments = async (collectionName) => {
    const snapshot = await getDocs(collection(db, collectionName));
    let deleted = 0;

    for (const chunk of chunkItems(snapshot.docs)) {
        const batch = writeBatch(db);
        chunk.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
        await batch.commit();
        deleted += chunk.length;
    }

    return deleted;
};

const resetPlanCuentasBalances = async () => {
    const snapshot = await getDocs(collection(db, 'planCuentas'));
    let updated = 0;

    for (const chunk of chunkItems(snapshot.docs)) {
        const batch = writeBatch(db);
        chunk.forEach((docSnapshot) => {
            batch.update(docSnapshot.ref, {
                balance: 0,
                balanceUSD: 0,
                updatedAt: Timestamp.now()
            });
        });
        await batch.commit();
        updated += chunk.length;
    }

    return updated;
};

// [... file unchanged except reset list update ...]
