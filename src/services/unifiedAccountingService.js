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

// ============================================
// REGISTRO DE ASIENTOS CONTABLES
// ============================================

/**
 * Registra un asiento contable completo con partida doble
 */
export const registerAccountingEntry = async (entryData) => {
    const { 
        fecha, 
        descripcion, 
        referencia, 
        documentoId, 
        documentoTipo, 
        moduloOrigen,
        userId,
        userEmail,
        movimientos,
        metadata = {} 
    } = entryData;
    const sucursalId = entryData.sucursalId || metadata.sucursalId || metadata.branchId || null;
    const sucursalName =
        entryData.sucursalName ||
        metadata.sucursalName ||
        metadata.branchName ||
        metadata.tienda ||
        null;

    if (!Array.isArray(movimientos) || movimientos.length === 0) {
        throw new Error('El asiento contable debe incluir al menos un movimiento');
    }

    const normalizedMovimientos = movimientos
        .map((mov) => ({
            ...mov,
            monto: Number(mov.monto || 0),
            montoUSD: Number(mov.montoUSD || 0)
        }))
        .filter((mov) => mov.monto > 0);

    if (normalizedMovimientos.length === 0) {
        throw new Error('El asiento contable no contiene movimientos con monto válido');
    }

    const invalidMovimiento = normalizedMovimientos.find((mov) =>
        !mov.cuentaId ||
        !mov.cuentaCode ||
        !mov.cuentaName ||
        !['DEBITO', 'CREDITO'].includes(mov.tipo)
    );

    if (invalidMovimiento) {
        throw new Error('Todos los movimientos contables deben tener cuenta y tipo válidos');
    }

    // Validar que suma de débitos = suma de créditos
    const totalDebitos = normalizedMovimientos
        .filter(m => m.tipo === 'DEBITO')
        .reduce((sum, m) => sum + Number(m.monto || 0), 0);
    
    const totalCreditos = normalizedMovimientos
        .filter(m => m.tipo === 'CREDITO')
        .reduce((sum, m) => sum + Number(m.monto || 0), 0);

    if (Math.abs(totalDebitos - totalCreditos) > 0.01) {
        throw new Error(`Partida descuadrada: Débitos C$${totalDebitos.toFixed(2)} ≠ Créditos C$${totalCreditos.toFixed(2)}`);
    }

    const timestamp = Timestamp.now();

    // Crear el asiento contable
    const asientoRef = await addDoc(collection(db, 'asientosContables'), {
        fecha,
        descripcion,
        referencia,
        documentoId,
        documentoTipo,
        moduloOrigen,
        sucursalId,
        sucursalName,
        userId,
        userEmail,
        totalDebitos,
        totalCreditos,
        movimientos: normalizedMovimientos.map(m => ({
            cuentaId: m.cuentaId,
            cuentaCode: m.cuentaCode,
            cuentaName: m.cuentaName,
            tipo: m.tipo,
            monto: m.monto,
            montoUSD: m.montoUSD || 0,
            descripcion: m.descripcion
        })),
        metadata,
        createdAt: timestamp
    });

    // Crear movimientos individuales para consultas
    const movimientosCreados = [];
    for (const mov of normalizedMovimientos) {
        const movRef = await addDoc(collection(db, 'movimientosContables'), {
            fecha,
            descripcion: mov.descripcion || descripcion,
            referencia,
            accountId: mov.cuentaId,
            accountCode: mov.cuentaCode,
            accountName: mov.cuentaName,
            type: mov.tipo,
            tipo: mov.tipo,
            monto: mov.monto,
            montoUSD: mov.montoUSD || 0,
            asientoId: asientoRef.id,
            documentoId,
            documentoTipo,
            moduloOrigen,
            sucursalId,
            sucursalName,
            userId,
            userEmail,
            timestamp
        });
        movimientosCreados.push({
            id: movRef.id,
            asientoId: asientoRef.id,
            accountId: mov.cuentaId,
            accountCode: mov.cuentaCode,
            accountName: mov.cuentaName,
            type: mov.tipo,
            tipo: mov.tipo,
            ...mov
        });
        
        // Actualizar saldo de la cuenta
        await updateAccountBalance(mov.cuentaId, mov.tipo, mov.monto, mov.montoUSD || 0);
    }

    return { 
        asientoId: asientoRef.id, 
        movimientos: movimientosCreados,
        totalDebitos,
        totalCreditos
    };
};

/**
 * Actualiza el saldo de una cuenta contable
 */
const updateAccountBalance = async (accountId, tipo, monto, montoUSD) => {
    try {
        const accountRef = doc(db, 'planCuentas', accountId);
        const accountSnap = await getDoc(accountRef);
        
        if (!accountSnap.exists()) return;
        
        const account = accountSnap.data();
        const nature = inferAccountNature(account);
        const isDeudora = nature === 'DEUDORA';
        const movimientosSnap = await getDocs(
            query(collection(db, 'movimientosContables'), where('accountId', '==', accountId))
        );

        let newBalance = 0;
        let newBalanceUSD = 0;

        movimientosSnap.docs.forEach((movDoc) => {
            const mov = movDoc.data();
            const tipoMovimiento = mov.tipo || mov.type;
            const multiplier =
                (tipoMovimiento === 'DEBITO' && isDeudora) ||
                (tipoMovimiento === 'CREDITO' && !isDeudora)
                    ? 1
                    : -1;

            newBalance += toNumber(mov.monto) * multiplier;
            newBalanceUSD += toNumber(mov.montoUSD) * multiplier;
        });
        
        await updateDoc(accountRef, {
            balance: newBalance,
            balanceUSD: newBalanceUSD,
            nature,
            updatedAt: Timestamp.now()
        });
    } catch (err) {
        console.error('Error actualizando saldo:', err);
    }
};

// ============================================
// CIERRE DE CAJA ERP
// ============================================

/**
 * Crea un nuevo cierre de caja ERP
 */
export const createCierreCajaERP = async (cierreData) => {
    const {
        fecha,
        sucursalId,
        sucursalName,
        tienda,
        caja,
        cajero,
        horaApertura,
        horaCierre,
        observaciones,
        totalIngreso,
        tipoCambio,
        
        // Efectivo
        efectivoCS,
        efectivoUSD,
        
        // POS
        posBAC,
        posBANPRO,
        posLAFISE,
        
        // Transferencias NIO
        transferenciaBAC,
        transferenciaBANPRO,
        transferenciaLAFISE,
        
        // Transferencias USD
        transferenciaBAC_USD,
        transferenciaLAFISE_USD,
        
        // Créditos y abonos
        totalFacturasCreditoBrutas,
        totalFacturasCreditoCanceladas,
        totalFacturasCredito,
        facturasCredito,
        totalAbonosRecibidos,
        abonosRecibidos,
        
        // Retenciones
        retenciones,
        totalRetenciones,
        
        // Gastos de caja
        gastosCaja,
        totalGastosCaja,
        
        // Arqueo
        arqueoRealizado,
        arqueo,
        
        // Configuración
        fotos,
        ajusteDiferenciaCaja,
        
        userId,
        userEmail
    } = cierreData;

    const cierreTotals = calculateCierreCajaTotals(cierreData);
    const numeroCierre = await getNextSequentialNumber('cierresCajaERP', 'numeroCierre');
    const codigoCierre = buildCierreCodigo(numeroCierre);
    const shouldPersistArqueo = Boolean(arqueoRealizado) || hasArqueoData(arqueo);
    const arqueoTotals = shouldPersistArqueo ? calculateArqueoTotals(cierreData) : null;
    const dineroTransitoAccount = await getCuentaByCode(CUENTAS_DGI.DINERO_TRANSITO);

    if (cierreTotals.totalEfectivo > 0 && !dineroTransitoAccount) {
        throw new Error('No se encontro la cuenta Dinero en Transito (110104). Cargue el plan DGI antes de procesar cierres con efectivo.');
    }

    const arqueoCalculado = shouldPersistArqueo ? {
        ...arqueo,
        totalArqueoCS: arqueoTotals.totalArqueoCS,
        efectivoUSDFisico: arqueoTotals.efectivoUSDFisico,
        totalArqueo: arqueoTotals.totalArqueo,
        diferenciaCS: arqueoTotals.diferenciaCaja,
        diferenciaNIO: arqueoTotals.diferenciaNIO,
        diferenciaUSD: arqueoTotals.diferenciaUSD
    } : null;
    const cuentaStandbyEfectivo = dineroTransitoAccount
        ? {
            id: dineroTransitoAccount.id,
            code: dineroTransitoAccount.code,
            name: dineroTransitoAccount.name
        }
        : null;
    const ajusteDiferenciaCajaNormalizado = {
        aplicado: Boolean(ajusteDiferenciaCaja?.aplicado),
        tipo: String(ajusteDiferenciaCaja?.tipo || '').toLowerCase(),
        montoNIO: roundToTwo(ajusteDiferenciaCaja?.montoNIO ?? Math.abs(arqueoTotals?.diferenciaNIO || 0)),
        montoUSD: roundToTwo(ajusteDiferenciaCaja?.montoUSD ?? Math.abs(arqueoTotals?.diferenciaUSD || 0)),
        montoTotal: roundToTwo(ajusteDiferenciaCaja?.montoTotal ?? Math.abs(arqueoTotals?.diferenciaCaja || 0)),
        requiereClave: Boolean(ajusteDiferenciaCaja?.requiereClave),
        autorizadoConClave: Boolean(ajusteDiferenciaCaja?.autorizadoConClave),
        autorizadoBy: ajusteDiferenciaCaja?.autorizadoBy || userEmail || '',
        autorizadoAt: ajusteDiferenciaCaja?.autorizadoAt || null
    };

    const cierre = {
        numeroCierre,
        codigoCierre,
        fecha,
        sucursalId: sucursalId || null,
        sucursalName: sucursalName || tienda || '',
        tienda: sucursalName || tienda || '',
        caja,
        cajero,
        horaApertura: horaApertura || null,
        horaCierre: horaCierre || null,
        observaciones: observaciones || '',
        totalIngreso: Number(totalIngreso || cierreTotals.totalIngresoRegistrado || 0),
        
        efectivoCS: Number(efectivoCS || 0),
        efectivoUSD: Number(efectivoUSD || 0),
        tipoCambio: cierreTotals.tipoCambio,
        
        posBAC: Number(posBAC || 0),
        posBANPRO: Number(posBANPRO || 0),
        posLAFISE: Number(posLAFISE || 0),
        
        transferenciaBAC: Number(transferenciaBAC || 0),
        transferenciaBANPRO: Number(transferenciaBANPRO || 0),
        transferenciaLAFISE: Number(transferenciaLAFISE || 0),
        transferenciaBAC_USD: Number(transferenciaBAC_USD || 0),
        transferenciaLAFISE_USD: Number(transferenciaLAFISE_USD || 0),
        
        totalFacturasCreditoBrutas: Number(
            totalFacturasCreditoBrutas ??
            totalFacturasCredito ??
            cierreTotals.totalFacturasCreditoBrutas
        ),
        totalFacturasCreditoCanceladas: Number(
            totalFacturasCreditoCanceladas ??
            cierreTotals.totalFacturasCreditoCanceladas
        ),
        totalFacturasCredito: cierreTotals.totalFacturasCredito,
        facturasCredito: facturasCredito || [],
        totalAbonosRecibidos: Number(totalAbonosRecibidos || 0),
        abonosRecibidos: abonosRecibidos || [],
        
        retenciones: retenciones || [],
        totalRetenciones: cierreTotals.totalRetenciones,
        
        gastosCaja: gastosCaja || [],
        totalGastosCaja: cierreTotals.totalGastosCaja,
        
        arqueoRealizado: shouldPersistArqueo,
        arqueo: arqueoCalculado,
        
        cuadre: {
            totalIngreso: cierreTotals.totalIngresoRegistrado,
            totalMediosPago: cierreTotals.totalMediosPago,
            totalFacturasCreditoBrutas: cierreTotals.totalFacturasCreditoBrutas,
            totalFacturasCreditoCanceladas: cierreTotals.totalFacturasCreditoCanceladas,
            totalFacturasCredito: cierreTotals.totalFacturasCredito,
            totalAbonosRecibidos: cierreTotals.totalAbonosRecibidos,
            totalVentasContado: cierreTotals.totalVentasContado,
            totalVentasDelDia: cierreTotals.totalVentasDelDia,
            totalRetenciones: cierreTotals.totalRetenciones,
            totalGastosCaja: cierreTotals.totalGastosCaja,
            totalEsperado: cierreTotals.totalEsperado,
            diferencia: cierreTotals.diferencia,
            estaCuadrado: cierreTotals.estaCuadrado
        },

        cuentaStandbyEfectivo,
        cuentaEfectivo: cuentaStandbyEfectivo,
        depositoPendiente: {
            nio: {
                moneda: 'NIO',
                monto: 0,
                montoNIO: 0,
                montoUSD: 0,
                estado: 'sin_monto',
                depositoId: null,
                depositoNumero: null,
                reservadoAt: null,
                confirmadoAt: null,
                cuentaOrigenId: cuentaStandbyEfectivo?.id || null,
                cuentaOrigenCode: cuentaStandbyEfectivo?.code || null,
                cuentaOrigenName: cuentaStandbyEfectivo?.name || null
            },
            usd: {
                moneda: 'USD',
                monto: 0,
                montoNIO: 0,
                montoUSD: 0,
                estado: 'sin_monto',
                depositoId: null,
                depositoNumero: null,
                reservadoAt: null,
                confirmadoAt: null,
                cuentaOrigenId: cuentaStandbyEfectivo?.id || null,
                cuentaOrigenCode: cuentaStandbyEfectivo?.code || null,
                cuentaOrigenName: cuentaStandbyEfectivo?.name || null
            }
        },
        
        estado: 'borrador',
        ajusteDiferenciaCaja: ajusteDiferenciaCajaNormalizado,
        fotos: fotos || [],
        movimientosContablesIds: [],
        
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail,
        updatedAt: Timestamp.now()
    };

    const docRef = await addDoc(collection(db, 'cierresCajaERP'), cierre);
    return { id: docRef.id, ...cierre };
};

/**
 * Actualiza el estado de un cierre de caja
 */
export const updateCierreCajaERPStatus = async (cierreId, nuevoEstado, userId) => {
    const cierreRef = doc(db, 'cierresCajaERP', cierreId);
    const cierreSnap = await getDoc(cierreRef);
    
    if (!cierreSnap.exists()) {
        throw new Error('Cierre de caja no encontrado');
    }
    
    const cierre = cierreSnap.data();
    
    if (nuevoEstado === 'cerrado' && !cierre.cuadre.estaCuadrado) {
        throw new Error('No se puede cerrar: El cierre no está cuadrado. Diferencia: ' + 
            cierre.cuadre.diferencia);
    }
    
    const updates = {
        estado: nuevoEstado,
        updatedAt: Timestamp.now(),
        updatedBy: userId
    };
    
    if (nuevoEstado === 'cerrado') {
        updates.cerradoAt = Timestamp.now();
        updates.cerradoBy = userId;
    }
    
    if (nuevoEstado === 'completado') {
        updates.completadoAt = Timestamp.now();
        updates.completadoBy = userId;
    }
    
    await updateDoc(cierreRef, updates);
    return { success: true };
};

/**
 * Procesa un cierre de caja cerrado - Genera todos los movimientos contables
 */
export const procesarCierreCajaERP = async (cierreId, userId, userEmail) => {
    const cierreRef = doc(db, 'cierresCajaERP', cierreId);
    const cierreSnap = await getDoc(cierreRef);

    if (!cierreSnap.exists()) {
        throw new Error('Cierre de caja no encontrado');
    }

    const cierre = cierreSnap.data();

    if (cierre.procesado) {
        throw new Error('Este cierre ya fue procesado anteriormente');
    }

    const movimientosGenerados = [];
    const fecha = cierre.fecha;
    const referencia = cierre.codigoCierre || `CIERRE-${cierreId}`;
    const cierreTotals = calculateCierreCajaTotals(cierre);
    const arqueoTotals = cierre.arqueoRealizado ? calculateArqueoTotals(cierre) : null;
    const tipoCambio = getTipoCambio(cierre.tipoCambio);
    const sucursalId = cierre.sucursalId || null;
    const sucursalName = cierre.sucursalName || cierre.tienda || null;
    const totalVentasContado = cierreTotals.totalVentasContado;
    const metadataBase = {
        sucursalId,
        sucursalName,
        tienda: sucursalName,
        caja: cierre.caja,
        tipoCambio
    };

    const ventasAccount = await getCuentaByCode(CUENTAS_DGI.VENTAS_MERCADERIA);
    let dineroTransitoAccount = null;
    let clientesAccount = null;

    if (!ventasAccount) {
        throw new Error('No se encontro la cuenta de ventas (410101). Cargue el Plan DGI primero.');
    }

    if (cierre.cuentaStandbyEfectivo?.id || cierre.cuentaEfectivo?.id) {
        const cuentaSnap = await getDoc(
            doc(db, 'planCuentas', cierre.cuentaStandbyEfectivo?.id || cierre.cuentaEfectivo?.id)
        );
        if (cuentaSnap.exists()) {
            dineroTransitoAccount = { id: cuentaSnap.id, ...cuentaSnap.data() };
        }
    }

    if (!dineroTransitoAccount) {
        dineroTransitoAccount = await getCuentaByCode(CUENTAS_DGI.DINERO_TRANSITO);
    }

    if (cierreTotals.totalAbonosRecibidos > 0 || cierreTotals.totalFacturasCredito > 0) {
        clientesAccount = await getCuentaByCode(CUENTAS_DGI.CLIENTES);
        if (!clientesAccount) {
            throw new Error('No se encontro la cuenta de Clientes (110301). Cargue el Plan DGI primero.');
        }
    }

    if (totalVentasContado < -0.01) {
        throw new Error('Los abonos no pueden ser mayores al Ingreso total SICAR.');
    }

    const movimientosCierre = [];
    const retencionesProcesadas = [];
    const agregarMovimiento = (movimiento) => {
        if (toNumber(movimiento?.monto) <= 0) return;

        movimientosCierre.push({
            ...movimiento,
            monto: toNumber(movimiento.monto),
            montoUSD: toNumber(movimiento.montoUSD)
        });
    };

    if (dineroTransitoAccount && cierreTotals.totalEfectivo > 0) {
        agregarMovimiento({
            cuentaId: dineroTransitoAccount.id,
            cuentaCode: dineroTransitoAccount.code,
            cuentaName: dineroTransitoAccount.name,
            tipo: 'DEBITO',
            monto: cierreTotals.totalEfectivo,
            montoUSD: cierreTotals.efectivoUSD,
            descripcion: `Efectivo en standby del cierre ${cierre.caja}`
        });
    }

    const posBancos = [
        { field: 'posBAC', code: CUENTAS_DGI.BANCO_BAC_NIO, name: 'BAC' },
        { field: 'posBANPRO', code: CUENTAS_DGI.BANCO_BANPRO_NIO, name: 'BANPRO' },
        { field: 'posLAFISE', code: CUENTAS_DGI.BANCO_LAFISE_NIO, name: 'LAFISE' }
    ];

    for (const pos of posBancos) {
        const monto = toNumber(cierre[pos.field]);
        if (monto <= 0) continue;

        const posAccount = await getCuentaByCode(pos.code);
        if (!posAccount) continue;

        agregarMovimiento({
            cuentaId: posAccount.id,
            cuentaCode: posAccount.code,
            cuentaName: posAccount.name,
            tipo: 'DEBITO',
            monto,
            montoUSD: 0,
            descripcion: `POS ${pos.name}`
        });
    }
    const transferencias = [
        { field: 'transferenciaBAC', code: CUENTAS_DGI.BANCO_BAC_NIO, name: 'BAC' },
        { field: 'transferenciaBANPRO', code: CUENTAS_DGI.BANCO_BANPRO_NIO, name: 'BANPRO' },
        { field: 'transferenciaLAFISE', code: CUENTAS_DGI.BANCO_LAFISE_NIO, name: 'LAFISE' }
    ];

    for (const trans of transferencias) {
        const monto = toNumber(cierre[trans.field]);
        if (monto <= 0) continue;

        const transAccount = await getCuentaByCode(trans.code);
        if (!transAccount) continue;

        agregarMovimiento({
            cuentaId: transAccount.id,
            cuentaCode: transAccount.code,
            cuentaName: transAccount.name,
            tipo: 'DEBITO',
            monto,
            montoUSD: 0,
            descripcion: `Transferencia ${trans.name}`
        });
    }

    const transferenciasUSD = [
        { field: 'transferenciaBAC_USD', code: CUENTAS_DGI.BANCO_BAC_USD, name: 'BAC USD' },
        { field: 'transferenciaLAFISE_USD', code: CUENTAS_DGI.BANCO_LAFISE_USD, name: 'LAFISE USD' }
    ];

    for (const trans of transferenciasUSD) {
        const montoUSD = toNumber(cierre[trans.field]);
        if (montoUSD <= 0) continue;

        const transAccount = await getCuentaByCode(trans.code);
        if (!transAccount) continue;

        agregarMovimiento({
            cuentaId: transAccount.id,
            cuentaCode: transAccount.code,
            cuentaName: transAccount.name,
            tipo: 'DEBITO',
            monto: montoUSD * tipoCambio,
            montoUSD,
            descripcion: `Transferencia ${trans.name}`
        });
    }

    for (const gasto of cierre.gastosCaja || []) {
        const monto = toNumber(gasto?.monto);
        if (monto <= 0) continue;

        let gastoAccount = null;
        if (gasto.cuentaContableId) {
            const cuentaSnap = await getDoc(doc(db, 'planCuentas', gasto.cuentaContableId));
            if (cuentaSnap.exists()) {
                gastoAccount = { id: cuentaSnap.id, ...cuentaSnap.data() };
            }
        }

        if (!gastoAccount) {
            gastoAccount = await getCuentaByCode(CUENTAS_DGI.GASTOS_ADMIN);
        }

        if (!gastoAccount) continue;

        agregarMovimiento({
            cuentaId: gastoAccount.id,
            cuentaCode: gastoAccount.code,
            cuentaName: gastoAccount.name,
            tipo: 'DEBITO',
            monto,
            montoUSD: 0,
            descripcion: gasto.concepto || 'Gasto de caja'
        });
    }

    for (const retencion of cierre.retenciones || []) {
        const monto = toNumber(retencion?.monto);
        if (monto <= 0) continue;

        const tipoRetencion = String(retencion?.tipo || '').toUpperCase();
        let cuentaPasivo = null;

        if (retencion?.cuentaPasivoId) {
            const cuentaSnap = await getDoc(doc(db, 'planCuentas', retencion.cuentaPasivoId));
            if (cuentaSnap.exists()) {
                cuentaPasivo = { id: cuentaSnap.id, ...cuentaSnap.data() };
            }
        }

        if (!cuentaPasivo) {
            cuentaPasivo =
                tipoRetencion === 'IR'
                    ? await getCuentaByCode(CUENTAS_DGI.IR_POR_PAGAR)
                    : await getCuentaByCode(CUENTAS_DGI.ALCALDIA_POR_PAGAR) ||
                      await getCuentaByCode('210304');
        }

        if (!cuentaPasivo) continue;

        const cuentaPasivoCode = String(cuentaPasivo.code || '').replace(/\./g, '');
        let cuentaCargo = null;

        if (cuentaPasivoCode === CUENTAS_DGI.IR_POR_PAGAR) {
            cuentaCargo =
                await getCuentaByCode(CUENTAS_DGI.IR_ANTICIPADO) ||
                await getCuentaByCode(CUENTAS_DGI.DEUDORES_VARIOS);
        } else if (cuentaPasivoCode === CUENTAS_DGI.ALCALDIA_POR_PAGAR) {
            cuentaCargo =
                await getCuentaByCode(CUENTAS_DGI.GASTO_ALCALDIA_VENTAS) ||
                await getCuentaByCode(CUENTAS_DGI.DEUDORES_VARIOS);
        } else {
            cuentaCargo =
                await getCuentaByCode(CUENTAS_DGI.DEUDORES_VARIOS) ||
                await getCuentaByCode(CUENTAS_DGI.GASTOS_ADMIN);
        }

        if (!cuentaCargo) continue;

        retencionesProcesadas.push({
            monto,
            tipoRetencion,
            cuentaCargo,
            cuentaPasivo,
            cliente: retencion?.cliente || '',
            facturaRelacionada: retencion?.facturaRelacionada || ''
        });
    }

    const totalRetencionesProcesadas = retencionesProcesadas.reduce(
        (sum, retencion) => sum + toNumber(retencion.monto),
        0
    );
    const totalVentasReconocidas = totalVentasContado - totalRetencionesProcesadas;

    if (totalVentasReconocidas < -0.01) {
        throw new Error('Las retenciones no pueden exceder las ventas del dia registradas en el cierre.');
    }

    for (const retencion of retencionesProcesadas) {
        const descripcionBase = retencion.facturaRelacionada
            ? `${retencion.cuentaPasivo.name} factura ${retencion.facturaRelacionada}`
            : `${retencion.cuentaPasivo.name} registrada en cierre`;

        agregarMovimiento({
            cuentaId: retencion.cuentaCargo.id,
            cuentaCode: retencion.cuentaCargo.code,
            cuentaName: retencion.cuentaCargo.name,
            tipo: 'DEBITO',
            monto: retencion.monto,
            montoUSD: 0,
            descripcion: descripcionBase
        });

        agregarMovimiento({
            cuentaId: retencion.cuentaPasivo.id,
            cuentaCode: retencion.cuentaPasivo.code,
            cuentaName: retencion.cuentaPasivo.name,
            tipo: 'CREDITO',
            monto: retencion.monto,
            montoUSD: 0,
            descripcion: `Saldo pendiente con entidad - ${retencion.cliente || 'Cierre de caja'}`
        });
    }

    if (totalVentasReconocidas > 0) {
        agregarMovimiento({
            cuentaId: ventasAccount.id,
            cuentaCode: ventasAccount.code,
            cuentaName: ventasAccount.name,
            tipo: 'CREDITO',
            monto: totalVentasReconocidas,
            montoUSD: 0,
            descripcion: 'Ventas del dia registradas en cierre'
        });
    }

    if (cierreTotals.totalAbonosRecibidos > 0 && clientesAccount) {
        agregarMovimiento({
            cuentaId: clientesAccount.id,
            cuentaCode: clientesAccount.code,
            cuentaName: clientesAccount.name,
            tipo: 'CREDITO',
            monto: cierreTotals.totalAbonosRecibidos,
            montoUSD: 0,
            descripcion: 'Abonos aplicados a cuentas por cobrar'
        });
    }

    if (movimientosCierre.length > 0) {
        const totalDebitos = movimientosCierre
            .filter((mov) => mov.tipo === 'DEBITO')
            .reduce((sum, mov) => sum + toNumber(mov.monto), 0);
        const totalCreditos = movimientosCierre
            .filter((mov) => mov.tipo === 'CREDITO')
            .reduce((sum, mov) => sum + toNumber(mov.monto), 0);

        if (Math.abs(totalDebitos - totalCreditos) > 0.01) {
            throw new Error(
                `El asiento del cierre no cuadra. Debitos: ${totalDebitos.toFixed(2)}, Creditos: ${totalCreditos.toFixed(2)}.`
            );
        }

        const entry = await registerAccountingEntry({
            fecha,
            descripcion: `Cierre de caja ${cierre.caja} ${fecha}`,
            referencia,
            documentoId: cierreId,
            documentoTipo: DOCUMENT_TYPES.CIERRE_CAJA,
            moduloOrigen: 'cierreCaja',
            sucursalId,
            sucursalName,
            userId,
            userEmail,
            movimientos: movimientosCierre,
            metadata: {
                ...metadataBase,
                tipo: 'cierreConsolidado',
                totalIngresoSicar: cierreTotals.totalIngresoRegistrado,
                totalVentasContado: totalVentasContado,
                totalVentasBrutasCierre: totalVentasContado,
                totalVentasDelDia: totalVentasReconocidas,
                totalAbonosRecibidos: cierreTotals.totalAbonosRecibidos,
                totalFacturasCreditoBrutas: cierreTotals.totalFacturasCreditoBrutas,
                totalFacturasCreditoCanceladas: cierreTotals.totalFacturasCreditoCanceladas,
                totalFacturasCreditoNetas: cierreTotals.totalFacturasCredito,
                totalRetenciones: cierreTotals.totalRetenciones,
                totalRetencionesProcesadas,
                totalGastosCaja: cierreTotals.totalGastosCaja,
                totalMediosPago: cierreTotals.totalMediosPago
            }
        });
        movimientosGenerados.push(...entry.movimientos);
    }

    if (cierreTotals.totalFacturasCredito > 0 && clientesAccount) {
        const entry = await registerAccountingEntry({
            fecha,
            descripcion: `Facturas de credito - Cierre ${cierre.caja}`,
            referencia,
            documentoId: cierreId,
            documentoTipo: DOCUMENT_TYPES.CIERRE_CAJA,
            moduloOrigen: 'cierreCaja',
            sucursalId,
            sucursalName,
            userId,
            userEmail,
            movimientos: [
                {
                    cuentaId: clientesAccount.id,
                    cuentaCode: clientesAccount.code,
                    cuentaName: clientesAccount.name,
                    tipo: 'DEBITO',
                    monto: cierreTotals.totalFacturasCredito,
                    montoUSD: 0,
                    descripcion: 'Creditos del dia'
                },
                {
                    cuentaId: ventasAccount.id,
                    cuentaCode: ventasAccount.code,
                    cuentaName: ventasAccount.name,
                    tipo: 'CREDITO',
                    monto: cierreTotals.totalFacturasCredito,
                    montoUSD: 0,
                    descripcion: 'Ventas al credito del dia'
                }
            ],
            metadata: {
                ...metadataBase,
                tipo: 'credito',
                montoTotal: cierreTotals.totalFacturasCredito
            }
        });
        movimientosGenerados.push(...entry.movimientos);
    }

    if (cierre.arqueoRealizado && Math.abs(arqueoTotals?.diferenciaCaja || 0) > 0.01) {
        if (!cierre.ajusteDiferenciaCaja?.aplicado) {
            throw new Error('Debe enviar la diferencia a faltante o sobrante de caja antes de procesar este cierre.');
        }

        const otrosGastosDiversosAccount =
            await getCuentaByCode(CUENTAS_DGI.OTROS_GASTOS_DIVERSOS) ||
            await getCuentaByCode(CUENTAS_DGI.GASTOS_EXTRAORDINARIOS);
        const otrosIngresosDiversosAccount = await getCuentaByCode(CUENTAS_DGI.OTROS_INGRESOS_DIVERSOS);
        const movimientosDiferencia = [];
        const pushDiferencia = (movimiento) => {
            if (toNumber(movimiento?.monto) <= 0) return;
            movimientosDiferencia.push({
                ...movimiento,
                monto: roundToTwo(movimiento.monto),
                montoUSD: roundToTwo(movimiento.montoUSD)
            });
        };
        const diferenciaNIO = roundToTwo(toNumber(arqueoTotals?.diferenciaNIO));
        const diferenciaUSD = roundToTwo(toNumber(arqueoTotals?.diferenciaUSD));

        if (diferenciaNIO < -0.01 && otrosGastosDiversosAccount && dineroTransitoAccount) {
            const monto = Math.abs(diferenciaNIO);
            pushDiferencia({
                cuentaId: otrosGastosDiversosAccount.id,
                cuentaCode: otrosGastosDiversosAccount.code,
                cuentaName: otrosGastosDiversosAccount.name,
                tipo: 'DEBITO',
                monto,
                montoUSD: 0,
                descripcion: `Faltante de caja C$ - ${cierre.cajero}`
            });
            pushDiferencia({
                cuentaId: dineroTransitoAccount.id,
                cuentaCode: dineroTransitoAccount.code,
                cuentaName: dineroTransitoAccount.name,
                tipo: 'CREDITO',
                monto,
                montoUSD: 0,
                descripcion: 'Ajuste de standby por faltante en cordobas'
            });
        }

        if (diferenciaNIO > 0.01 && otrosIngresosDiversosAccount && dineroTransitoAccount) {
            pushDiferencia({
                cuentaId: dineroTransitoAccount.id,
                cuentaCode: dineroTransitoAccount.code,
                cuentaName: dineroTransitoAccount.name,
                tipo: 'DEBITO',
                monto: diferenciaNIO,
                montoUSD: 0,
                descripcion: 'Ajuste de standby por sobrante en cordobas'
            });
            pushDiferencia({
                cuentaId: otrosIngresosDiversosAccount.id,
                cuentaCode: otrosIngresosDiversosAccount.code,
                cuentaName: otrosIngresosDiversosAccount.name,
                tipo: 'CREDITO',
                monto: diferenciaNIO,
                montoUSD: 0,
                descripcion: `Sobrante de caja C$ - ${cierre.cajero}`
            });
        }

        if (diferenciaUSD < -0.01 && otrosGastosDiversosAccount && dineroTransitoAccount) {
            const montoUSD = Math.abs(diferenciaUSD);
            const monto = roundToTwo(montoUSD * tipoCambio);
            pushDiferencia({
                cuentaId: otrosGastosDiversosAccount.id,
                cuentaCode: otrosGastosDiversosAccount.code,
                cuentaName: otrosGastosDiversosAccount.name,
                tipo: 'DEBITO',
                monto,
                montoUSD,
                descripcion: `Faltante de caja USD - ${cierre.cajero}`
            });
            pushDiferencia({
                cuentaId: dineroTransitoAccount.id,
                cuentaCode: dineroTransitoAccount.code,
                cuentaName: dineroTransitoAccount.name,
                tipo: 'CREDITO',
                monto,
                montoUSD,
                descripcion: 'Ajuste de standby por faltante en dolares'
            });
        }

        if (diferenciaUSD > 0.01 && otrosIngresosDiversosAccount && dineroTransitoAccount) {
            const montoUSD = diferenciaUSD;
            const monto = roundToTwo(montoUSD * tipoCambio);
            pushDiferencia({
                cuentaId: dineroTransitoAccount.id,
                cuentaCode: dineroTransitoAccount.code,
                cuentaName: dineroTransitoAccount.name,
                tipo: 'DEBITO',
                monto,
                montoUSD,
                descripcion: 'Ajuste de standby por sobrante en dolares'
            });
            pushDiferencia({
                cuentaId: otrosIngresosDiversosAccount.id,
                cuentaCode: otrosIngresosDiversosAccount.code,
                cuentaName: otrosIngresosDiversosAccount.name,
                tipo: 'CREDITO',
                monto,
                montoUSD,
                descripcion: `Sobrante de caja USD - ${cierre.cajero}`
            });
        }

        if (movimientosDiferencia.length > 0) {
            const entry = await registerAccountingEntry({
                fecha,
                descripcion: `${(arqueoTotals?.diferenciaCaja || 0) < 0 ? 'Faltante' : 'Sobrante'} de caja - ${cierre.cajero}`,
                referencia,
                documentoId: cierreId,
                documentoTipo: DOCUMENT_TYPES.DIFERENCIA_CAJA,
                moduloOrigen: 'cierreCaja',
                sucursalId,
                sucursalName,
                userId,
                userEmail,
                movimientos: movimientosDiferencia,
                metadata: {
                    ...metadataBase,
                    tipo: (arqueoTotals?.diferenciaCaja || 0) < 0 ? 'faltante' : 'sobrante',
                    monto: roundToTwo(Math.abs(arqueoTotals?.diferenciaCaja || 0)),
                    montoNIO: roundToTwo(Math.abs(diferenciaNIO)),
                    montoUSD: roundToTwo(Math.abs(diferenciaUSD)),
                    cajero: cierre.cajero
                }
            });
            movimientosGenerados.push(...entry.movimientos);
        }
    }

    const montoDepositoPendienteNIO = cierre.arqueoRealizado
        ? roundToTwo(arqueoTotals?.totalArqueoCS)
        : toNumber(cierre.efectivoCS);
    const montoDepositoPendienteUSD = cierre.arqueoRealizado
        ? roundToTwo(arqueoTotals?.efectivoUSDFisico)
        : toNumber(cierre.efectivoUSD);
    const cuentaOrigenDeposito = dineroTransitoAccount || cierre.cuentaStandbyEfectivo || cierre.cuentaEfectivo || null;

    await updateDoc(cierreRef, {
        procesado: true,
        procesadoAt: Timestamp.now(),
        movimientosContablesIds: movimientosGenerados.map((mov) => mov.id),
        totalMovimientos: movimientosGenerados.length,
        depositoPendiente: {
            nio: {
                moneda: 'NIO',
                monto: montoDepositoPendienteNIO,
                montoNIO: montoDepositoPendienteNIO,
                montoUSD: 0,
                estado: montoDepositoPendienteNIO > 0 ? 'disponible' : 'sin_monto',
                depositoId: null,
                depositoNumero: null,
                reservadoAt: null,
                confirmadoAt: null,
                cuentaOrigenId: cuentaOrigenDeposito?.id || cierre.cuentaStandbyEfectivo?.id || cierre.cuentaEfectivo?.id || null,
                cuentaOrigenCode: cuentaOrigenDeposito?.code || cierre.cuentaStandbyEfectivo?.code || cierre.cuentaEfectivo?.code || null,
                cuentaOrigenName: cuentaOrigenDeposito?.name || cierre.cuentaStandbyEfectivo?.name || cierre.cuentaEfectivo?.name || null
            },
            usd: {
                moneda: 'USD',
                monto: montoDepositoPendienteUSD,
                montoNIO: roundToTwo(montoDepositoPendienteUSD * tipoCambio),
                montoUSD: montoDepositoPendienteUSD,
                estado: montoDepositoPendienteUSD > 0 ? 'disponible' : 'sin_monto',
                depositoId: null,
                depositoNumero: null,
                reservadoAt: null,
                confirmadoAt: null,
                cuentaOrigenId: cuentaOrigenDeposito?.id || cierre.cuentaStandbyEfectivo?.id || cierre.cuentaEfectivo?.id || null,
                cuentaOrigenCode: cuentaOrigenDeposito?.code || cierre.cuentaStandbyEfectivo?.code || cierre.cuentaEfectivo?.code || null,
                cuentaOrigenName: cuentaOrigenDeposito?.name || cierre.cuentaStandbyEfectivo?.name || cierre.cuentaEfectivo?.name || null
            }
        }
    });

    return {
        success: true,
        movimientosGenerados: movimientosGenerados.length
    };
};

// ============================================
// DEPÓSITOS EN TRÁNSITO
// ============================================

/**
 * Crea un depósito en tránsito
 */
export const createDepositoTransitoERP = async (depositoData) => {
    const {
        fecha,
        responsable,
        moneda,
        bancoDestinoId,
        bancoDestinoCode,
        bancoDestinoName,
        cierresOrigen = [],
        observaciones,
        userId,
        userEmail
    } = depositoData;

    if (!Array.isArray(cierresOrigen) || cierresOrigen.length === 0) {
        throw new Error('Debe seleccionar al menos un monto pendiente de cierre para crear el depósito.');
    }

    if (!bancoDestinoId) {
        throw new Error('Debe seleccionar la cuenta bancaria destino del depósito.');
    }

    const monedaDeposito = String(moneda || cierresOrigen[0]?.moneda || 'NIO').toUpperCase();
    const bancoDestinoSnap = await getDoc(doc(db, 'planCuentas', bancoDestinoId));

    if (!bancoDestinoSnap.exists()) {
        throw new Error('Cuenta bancaria destino no encontrada');
    }

    const bancoData = {
        id: bancoDestinoSnap.id,
        ...bancoDestinoSnap.data(),
        code: bancoDestinoCode || bancoDestinoSnap.data()?.code,
        name: bancoDestinoName || bancoDestinoSnap.data()?.name
    };

    const numero = await getNextSequentialNumber('depositosTransito', 'numero');
    const depositoRef = doc(collection(db, 'depositosTransito'));
    const timestamp = Timestamp.now();
    const batch = writeBatch(db);
    const cierresNormalizados = [];
    const cuentasOrigen = [];
    let totalMoneda = 0;
    let totalNIO = 0;
    let totalUSD = 0;

    for (const cierreOrigen of cierresOrigen) {
        const cierreId = cierreOrigen.cierreId || cierreOrigen.id;
        if (!cierreId) {
            throw new Error('Uno de los montos seleccionados no está vinculado a un cierre válido.');
        }

        const cierreRef = doc(db, 'cierresCajaERP', cierreId);
        const cierreSnap = await getDoc(cierreRef);

        if (!cierreSnap.exists()) {
            throw new Error('Uno de los cierres seleccionados ya no existe.');
        }

        const cierre = { id: cierreSnap.id, ...cierreSnap.data() };
        const monedaItem = String(cierreOrigen.moneda || monedaDeposito).toUpperCase();
        const currencyKey = monedaItem === 'USD' ? 'usd' : 'nio';

        if (monedaItem !== monedaDeposito) {
            throw new Error('No se pueden mezclar córdobas y dólares en un mismo depósito.');
        }

        const pendienteActual = cierre.depositoPendiente?.[currencyKey];
        const montoMoneda = monedaItem === 'USD'
            ? toNumber(
                cierreOrigen.monto ??
                cierreOrigen.montoUSD ??
                pendienteActual?.monto ??
                pendienteActual?.montoUSD ??
                cierre.efectivoUSD
            )
            : toNumber(
                cierreOrigen.monto ??
                cierreOrigen.montoNIO ??
                pendienteActual?.monto ??
                pendienteActual?.montoNIO ??
                cierre.efectivoCS
            );

        const montoItemNIO = monedaItem === 'USD'
            ? roundToTwo(
                cierreOrigen.montoNIO ??
                pendienteActual?.montoNIO ??
                (montoMoneda * getTipoCambio(cierreOrigen.tipoCambio || cierre.tipoCambio))
            )
            : roundToTwo(
                cierreOrigen.montoNIO ??
                pendienteActual?.montoNIO ??
                montoMoneda
            );
        const montoItemUSD = monedaItem === 'USD'
            ? roundToTwo(
                cierreOrigen.montoUSD ??
                pendienteActual?.montoUSD ??
                montoMoneda
            )
            : 0;

        if (montoMoneda <= 0) {
            throw new Error(`El cierre ${cierre.codigoCierre || cierre.id} no tiene monto pendiente válido para depósito.`);
        }

        if (pendienteActual?.estado === 'depositado') {
            throw new Error(`El cierre ${cierre.codigoCierre || cierre.id} ya fue depositado en ${monedaItem}.`);
        }

        if (
            pendienteActual?.estado === 'en_transito' &&
            pendienteActual?.depositoId &&
            pendienteActual?.depositoId !== depositoRef.id
        ) {
            throw new Error(`El cierre ${cierre.codigoCierre || cierre.id} ya está incluido en otro depósito pendiente.`);
        }

        const cuentaOrigenId =
            cierreOrigen.cuentaOrigenId ||
            pendienteActual?.cuentaOrigenId ||
            cierre.cuentaStandbyEfectivo?.id ||
            cierre.cuentaEfectivo?.id ||
            null;
        const cuentaOrigenCode =
            cierreOrigen.cuentaOrigenCode ||
            pendienteActual?.cuentaOrigenCode ||
            cierre.cuentaStandbyEfectivo?.code ||
            cierre.cuentaEfectivo?.code ||
            '';
        const cuentaOrigenName =
            cierreOrigen.cuentaOrigenName ||
            pendienteActual?.cuentaOrigenName ||
            cierre.cuentaStandbyEfectivo?.name ||
            cierre.cuentaEfectivo?.name ||
            '';

        if (!cuentaOrigenId || !cuentaOrigenCode || !cuentaOrigenName) {
            throw new Error(`El cierre ${cierre.codigoCierre || cierre.id} no tiene una cuenta standby configurada para depÃ³sito.`);
        }

        const itemNormalizado = {
            cierreId: cierre.id,
            cierreNumero: cierre.numeroCierre || null,
            cierreCodigo: cierre.codigoCierre || `CIERRE-${cierre.id.slice(0, 8).toUpperCase()}`,
            fechaCierre: cierre.fecha || '',
            sucursalId: cierre.sucursalId || null,
            sucursalName: cierre.sucursalName || cierre.tienda || '',
            caja: cierre.caja || '',
            cajero: cierre.cajero || '',
            moneda: monedaItem,
            monto: roundToTwo(montoMoneda),
            montoNIO: montoItemNIO,
            montoUSD: montoItemUSD,
            tipoCambio: getTipoCambio(cierreOrigen.tipoCambio || cierre.tipoCambio),
            cuentaOrigenId,
            cuentaOrigenCode,
            cuentaOrigenName
        };

        cierresNormalizados.push(itemNormalizado);
        cuentasOrigen.push({
            accountId: cuentaOrigenId,
            accountCode: cuentaOrigenCode,
            accountName: cuentaOrigenName,
            monto: itemNormalizado.monto,
            montoNIO: montoItemNIO,
            montoUSD: montoItemUSD,
            cierreId: cierre.id,
            cierreCodigo: itemNormalizado.cierreCodigo
        });
        totalMoneda += itemNormalizado.monto;
        totalNIO += montoItemNIO;
        totalUSD += montoItemUSD;

        batch.update(cierreRef, {
            [`depositoPendiente.${currencyKey}.estado`]: 'en_transito',
            [`depositoPendiente.${currencyKey}.depositoId`]: depositoRef.id,
            [`depositoPendiente.${currencyKey}.depositoNumero`]: numero,
            [`depositoPendiente.${currencyKey}.reservadoAt`]: timestamp,
            [`depositoPendiente.${currencyKey}.bancoDestinoId`]: bancoData.id,
            [`depositoPendiente.${currencyKey}.bancoDestinoCode`]: bancoData.code,
            [`depositoPendiente.${currencyKey}.bancoDestinoName`]: bancoData.name,
            updatedAt: timestamp
        });
    }

    const uniqueBranchIds = [...new Set(cierresNormalizados.map((item) => item.sucursalId).filter(Boolean))];
    const uniqueBranchNames = [...new Set(cierresNormalizados.map((item) => item.sucursalName).filter(Boolean))];

    const deposito = {
        documentoId: depositoRef.id,
        numero,
        fecha,
        responsable,
        moneda: monedaDeposito,
        total: roundToTwo(totalMoneda),
        totalNIO: roundToTwo(totalNIO),
        totalUSD: roundToTwo(totalUSD),
        bancoDestinoId: bancoData.id,
        bancoDestinoCode: bancoData.code,
        bancoDestinoName: bancoData.name,
        sucursalId: uniqueBranchIds.length === 1 ? uniqueBranchIds[0] : null,
        sucursalName: uniqueBranchNames.length === 1 ? uniqueBranchNames[0] : uniqueBranchNames.join(', '),
        cierresOrigen: cierresNormalizados,
        cuentasOrigen,
        observaciones,
        estado: 'pendiente',
        etapa: 'standby',
        movimientosContablesIds: [],
        asientoId: null,
        createdAt: timestamp,
        createdBy: userId,
        createdByEmail: userEmail
    };

    batch.set(depositoRef, deposito);
    await batch.commit();
    return { id: depositoRef.id, ...deposito };
};

/**
 * Confirma un depósito bancario
 */
export const confirmarDepositoBancarioERP = async (depositoId, confirmacionData) => {
    const {
        bancoDestinoId,
        bancoDestinoCode,
        bancoDestinoName,
        fechaDeposito,
        horaDeposito,
        referenciaBancaria,
        comprobanteURL,
        comprobanteAdjuntoId,
        comprobanteAdjuntoName,
        comentarios,
        userId,
        userEmail
    } = confirmacionData;

    // Obtener el depósito
    const depositoRef = doc(db, 'depositosTransito', depositoId);
    const depositoSnap = await getDoc(depositoRef);
    
    if (!depositoSnap.exists()) {
        throw new Error('Depósito no encontrado');
    }
    
    const deposito = depositoSnap.data();
    
    if (deposito.estado === 'confirmado') {
        throw new Error('Este depósito ya fue confirmado');
    }

    const bancoIdFinal = bancoDestinoId || deposito.bancoDestinoId;
    if (!bancoIdFinal) {
        throw new Error('Debe indicar la cuenta bancaria destino para confirmar el depósito.');
    }

    const bancoAccount = await getDoc(doc(db, 'planCuentas', bancoIdFinal));
    if (!bancoAccount.exists()) {
        throw new Error('Cuenta bancaria destino no encontrada');
    }
    
    const bancoData = {
        id: bancoAccount.id,
        ...bancoAccount.data(),
        code: bancoDestinoCode || deposito.bancoDestinoCode || bancoAccount.data()?.code,
        name: bancoDestinoName || deposito.bancoDestinoName || bancoAccount.data()?.name
    };

    const sourceItems = Array.isArray(deposito.cierresOrigen) && deposito.cierresOrigen.length > 0
        ? deposito.cierresOrigen
        : (deposito.cuentasOrigen || []).map((cuenta) => ({
            cierreId: cuenta.cierreId || null,
            cierreCodigo: cuenta.cierreCodigo || null,
            moneda: deposito.moneda || 'NIO',
            monto: toNumber(cuenta.monto),
            montoNIO: deposito.moneda === 'USD'
                ? roundToTwo(toNumber(cuenta.monto) * getTipoCambio(deposito.tipoCambio))
                : toNumber(cuenta.monto),
            montoUSD: deposito.moneda === 'USD' ? toNumber(cuenta.monto) : 0,
            cuentaOrigenId: cuenta.accountId,
            cuentaOrigenCode: cuenta.accountCode,
            cuentaOrigenName: cuenta.accountName
        }));

    if (sourceItems.length === 0) {
        throw new Error('Este depósito no tiene montos origen para confirmar.');
    }

    const totalDebitoNIO = sourceItems.reduce((sum, item) => sum + toNumber(item.montoNIO), 0);
    const totalDebitoUSD = sourceItems.reduce((sum, item) => sum + toNumber(item.montoUSD), 0);
    const movimientos = [
        {
            cuentaId: bancoData.id,
            cuentaCode: bancoData.code,
            cuentaName: bancoData.name,
            tipo: 'DEBITO',
            monto: roundToTwo(totalDebitoNIO),
            montoUSD: roundToTwo(totalDebitoUSD),
            descripcion: `Depósito bancario confirmado #${deposito.numero}`
        }
    ];

    for (const item of sourceItems) {
        const montoNIO = toNumber(item.montoNIO);
        const montoUSD = toNumber(item.montoUSD);
        if (montoNIO <= 0 && montoUSD <= 0) continue;

        movimientos.push({
            cuentaId: item.cuentaOrigenId,
            cuentaCode: item.cuentaOrigenCode,
            cuentaName: item.cuentaOrigenName,
            tipo: 'CREDITO',
            monto: roundToTwo(montoNIO),
            montoUSD: roundToTwo(montoUSD),
            descripcion: item.cierreCodigo
                ? `Salida de caja por depósito del cierre ${item.cierreCodigo}`
                : `Salida de caja por depósito confirmado #${deposito.numero}`
        });
    }

    const entry = await registerAccountingEntry({
        fecha: fechaDeposito,
        descripcion: `Confirmación Depósito #${deposito.numero} - ${bancoData.name}`,
        referencia: referenciaBancaria,
        documentoId: depositoId,
        documentoTipo: DOCUMENT_TYPES.CONFIRMACION_DEPOSITO,
        moduloOrigen: 'confirmacionDeposito',
        sucursalId: deposito.sucursalId || null,
        sucursalName: deposito.sucursalName || null,
        userId,
        userEmail,
        movimientos,
        metadata: { 
            depositoNumero: deposito.numero,
            bancoDestino: bancoData.name,
            referenciaBancaria,
            fechaDeposito,
            horaDeposito,
            tipoProceso: 'confirmacionDepositoBancario',
            sucursalId: deposito.sucursalId || null,
            sucursalName: deposito.sucursalName || null
        }
    });

    const confirmationTimestamp = Timestamp.now();
    const batch = writeBatch(db);
    const updateData = {
        estado: 'confirmado',
        etapa: 'depositado',
        confirmadoAt: confirmationTimestamp,
        confirmadoBy: userId,
        confirmadoByEmail: userEmail,
        bancoDestinoId: bancoData.id,
        bancoDestinoCode: bancoData.code,
        bancoDestinoName: bancoData.name,
        fechaDeposito,
        horaDeposito,
        referenciaBancaria,
        comentarios,
        movimientosConfirmacionIds: entry.movimientos.map(m => m.id),
        asientoConfirmacionId: entry.asientoId
    };
    
    // Solo incluir comprobanteURL si tiene valor
    if (comprobanteURL) {
        updateData.comprobanteURL = comprobanteURL;
    }

    if (comprobanteAdjuntoId) {
        updateData.comprobanteAdjuntoId = comprobanteAdjuntoId;
        updateData.comprobanteAdjuntoName = comprobanteAdjuntoName || 'Comprobante depósito';
    }
    
    batch.update(depositoRef, updateData);

    for (const item of sourceItems) {
        if (!item.cierreId) continue;

        const cierreRef = doc(db, 'cierresCajaERP', item.cierreId);
        const currencyKey = String(item.moneda || deposito.moneda || 'NIO').toUpperCase() === 'USD' ? 'usd' : 'nio';

        batch.update(cierreRef, {
            [`depositoPendiente.${currencyKey}.estado`]: 'depositado',
            [`depositoPendiente.${currencyKey}.depositoId`]: depositoId,
            [`depositoPendiente.${currencyKey}.depositoNumero`]: deposito.numero,
            [`depositoPendiente.${currencyKey}.monto`]: 0,
            [`depositoPendiente.${currencyKey}.montoNIO`]: 0,
            [`depositoPendiente.${currencyKey}.montoUSD`]: 0,
            [`depositoPendiente.${currencyKey}.confirmadoAt`]: confirmationTimestamp,
            [`depositoPendiente.${currencyKey}.referenciaBancaria`]: referenciaBancaria,
            [`depositoPendiente.${currencyKey}.bancoDestinoId`]: bancoData.id,
            [`depositoPendiente.${currencyKey}.bancoDestinoCode`]: bancoData.code,
            [`depositoPendiente.${currencyKey}.bancoDestinoName`]: bancoData.name,
            updatedAt: confirmationTimestamp
        });
    }

    await batch.commit();

    return { success: true };
};

// ============================================
// CUENTAS POR PAGAR
// ============================================

/**
 * Crea una factura de proveedor (cuenta por pagar)
 */
export const createFacturaProveedor = async (facturaData) => {
    const {
        fecha,
        sucursalId,
        sucursalName,
        proveedor,
        numeroFactura,
        descripcion,
        monto,
        moneda,
        cuentaGastoId,
        cuentaGastoCode,
        cuentaGastoName,
        fechaVencimiento,
        userId,
        userEmail
    } = facturaData;

    // Buscar cuenta de proveedores
    const proveedoresAccount = await getCuentaByCode(CUENTAS_DGI.PROVEEDORES);
    const facturaRef = doc(collection(db, 'facturasProveedor'));
    
    if (!proveedoresAccount) {
        throw new Error('No se encontró la cuenta de Proveedores (210101). Cargue el Plan DGI primero.');
    }

    // Buscar cuenta de gasto
    const gastoAccount = cuentaGastoId ? 
        await getDoc(doc(db, 'planCuentas', cuentaGastoId)) : null;
    
    const gastoData = gastoAccount?.exists() ? 
        { id: gastoAccount.id, ...gastoAccount.data() } : null;

    if (!gastoData) {
        throw new Error('No se encontro la cuenta de gasto para la factura del proveedor');
    }

    // Crear movimientos
    const movimientos = [];
    
    if (gastoData) {
        // Débito al gasto
        movimientos.push({
            cuentaId: gastoData.id,
            cuentaCode: gastoData.code,
            cuentaName: gastoData.name,
            tipo: 'DEBITO',
            monto,
            montoUSD: moneda === 'USD' ? monto : 0,
            descripcion: `Compra a crédito: ${descripcion}`
        });
    }
    
    // Crédito a proveedores
    movimientos.push({
        cuentaId: proveedoresAccount.id,
        cuentaCode: proveedoresAccount.code,
        cuentaName: proveedoresAccount.name,
        tipo: 'CREDITO',
        monto,
        montoUSD: moneda === 'USD' ? monto : 0,
        descripcion: `Por pagar a ${proveedor} - Factura ${numeroFactura}`
    });

    // Registrar asiento
    const entry = await registerAccountingEntry({
        fecha,
        descripcion: `Factura ${numeroFactura} - ${proveedor}`,
        referencia: numeroFactura,
        documentoId: facturaRef.id,
        documentoTipo: DOCUMENT_TYPES.FACTURA_PROVEEDOR,
        moduloOrigen: 'cuentas-pagar',
        userId,
        userEmail,
        movimientos,
        metadata: { proveedor, numeroFactura, fechaVencimiento }
    });

    // Crear la factura
    const factura = {
        documentoId: facturaRef.id,
        fecha,
        sucursalId,
        sucursalName,
        proveedor,
        numeroFactura,
        descripcion,
        monto,
        moneda,
        saldoPendiente: monto,
        cuentaGastoId,
        cuentaGastoCode,
        cuentaGastoName,
        fechaVencimiento,
        estado: 'pendiente',
        pagos: [],
        movimientosContablesIds: entry.movimientos.map(m => m.id),
        asientoId: entry.asientoId,
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail
    };

    await setDoc(facturaRef, factura);
    return { id: facturaRef.id, ...factura };
};

/**
 * Registra un pago a proveedor
 */
export const registrarPagoProveedor = async (facturaId, pagoData) => {
    const {
        fecha,
        monto,
        metodoPago,
        bancoId,
        bancoCode,
        bancoName,
        referencia,
        comentarios,
        userId,
        userEmail
    } = pagoData;

    // Obtener la factura
    const facturaRef = doc(db, 'facturasProveedor', facturaId);
    const facturaSnap = await getDoc(facturaRef);
    
    if (!facturaSnap.exists()) {
        throw new Error('Factura no encontrada');
    }
    
    const factura = facturaSnap.data();
    const pagoRef = doc(collection(db, 'pagosProveedor'));

    // Buscar cuentas
    const proveedoresAccount = await getCuentaByCode(CUENTAS_DGI.PROVEEDORES);
    
    let cuentaPago = null;
    if (metodoPago === 'efectivo') {
        cuentaPago = await getCuentaByCode(CUENTAS_DGI.CAJA_GENERAL);
    } else if (bancoId) {
        const bancoSnap = await getDoc(doc(db, 'planCuentas', bancoId));
        if (bancoSnap.exists()) {
            cuentaPago = { id: bancoSnap.id, ...bancoSnap.data() };
        }
    }

    if (!proveedoresAccount) {
        throw new Error('No se encontró la cuenta de Proveedores');
    }
    
    if (!cuentaPago) {
        throw new Error('No se encontró la cuenta de pago');
    }

    // Crear movimientos
    const movimientos = [
        {
            cuentaId: proveedoresAccount.id,
            cuentaCode: proveedoresAccount.code,
            cuentaName: proveedoresAccount.name,
            tipo: 'DEBITO',
            monto,
            montoUSD: factura.moneda === 'USD' ? monto : 0,
            descripcion: `Pago a ${factura.proveedor} - Factura ${factura.numeroFactura}`
        },
        {
            cuentaId: cuentaPago.id,
            cuentaCode: cuentaPago.code,
            cuentaName: cuentaPago.name,
            tipo: 'CREDITO',
            monto,
            montoUSD: factura.moneda === 'USD' ? monto : 0,
            descripcion: `Pago factura ${factura.numeroFactura}`
        }
    ];

    // Registrar asiento
    const entry = await registerAccountingEntry({
        fecha,
        descripcion: `Pago Factura ${factura.numeroFactura} - ${factura.proveedor}`,
        referencia,
        documentoId: pagoRef.id,
        documentoTipo: DOCUMENT_TYPES.PAGO_PROVEEDOR,
        moduloOrigen: 'cuentas-pagar',
        userId,
        userEmail,
        movimientos,
        metadata: { facturaId, proveedor: factura.proveedor, monto }
    });

    // Actualizar factura
    const nuevoSaldo = factura.saldoPendiente - monto;
    const nuevoEstado = nuevoSaldo <= 0.01 ? 'pagada' : 'parcial';

    await setDoc(pagoRef, {
        documentoId: pagoRef.id,
        facturaId,
        proveedor: factura.proveedor,
        numeroFactura: factura.numeroFactura,
        fecha,
        monto,
        metodoPago,
        bancoId,
        bancoCode,
        bancoName,
        referencia,
        comentarios,
        asientoId: entry.asientoId,
        movimientosContablesIds: entry.movimientos.map((mov) => mov.id),
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail
    });

    await updateDoc(facturaRef, {
        saldoPendiente: nuevoSaldo,
        estado: nuevoEstado,
        pagos: [...(factura.pagos || []), {
            id: pagoRef.id,
            fecha,
            monto,
            metodoPago,
            bancoId,
            bancoCode,
            bancoName,
            referencia,
            comentarios,
            asientoId: entry.asientoId,
            movimientosContablesIds: entry.movimientos.map((mov) => mov.id),
            createdAt: Timestamp.now()
        }],
        updatedAt: Timestamp.now()
    });

    return { success: true, pagoId: pagoRef.id, nuevoSaldo, estado: nuevoEstado };
};

// ============================================
// ACTIVOS FIJOS
// ============================================

/**
 * Registra un activo fijo y genera el asiento de adquisición.
 * Si la compra es a crédito contra proveedores, también crea la factura en CxP.
 */
export const createActivoFijo = async (activoData) => {
    const {
        fechaAdquisicion,
        fechaInicioDepreciacion,
        sucursalId,
        sucursalName,
        nombre,
        descripcion,
        proveedorId = '',
        proveedorNombre = '',
        numeroDocumento = '',
        fechaVencimiento = '',
        moneda = 'NIO',
        tipoCambio = 1,
        costo,
        valorResidual = 0,
        vidaUtilMeses,
        tipoAdquisicion = 'contado',
        cuentaActivoId,
        cuentaPagoId = '',
        cuentaPasivoId = '',
        cuentaDepreciacionGastoId,
        cuentaDepreciacionAcumuladaId,
        adjuntos = [],
        observaciones = '',
        userId,
        userEmail
    } = activoData;

    const costoBase = roundToTwo(costo);
    const residualBase = roundToTwo(valorResidual);
    const exchangeRate = Number(tipoCambio) || 1;
    const usefulLifeMonths = Number(vidaUtilMeses) || 0;

    if (!fechaAdquisicion) {
        throw new Error('Debe indicar la fecha de adquisición del activo.');
    }

    if (!sucursalId) {
        throw new Error('Debe seleccionar la sucursal del activo fijo.');
    }

    if (!nombre) {
        throw new Error('Debe ingresar el nombre del activo fijo.');
    }

    if (!cuentaActivoId) {
        throw new Error('Debe seleccionar la cuenta del activo fijo.');
    }

    if (costoBase <= 0) {
        throw new Error('El costo del activo debe ser mayor a cero.');
    }

    if (residualBase < 0 || residualBase > costoBase) {
        throw new Error('El valor residual debe ser menor o igual al costo del activo.');
    }

    if (usefulLifeMonths <= 0) {
        throw new Error('La vida útil debe expresarse en meses y ser mayor a cero.');
    }

    const cuentaActivo = await getCuentaById(cuentaActivoId);
    if (!cuentaActivo) {
        throw new Error('No se encontró la cuenta del activo fijo.');
    }

    const cuentaContrapartida =
        tipoAdquisicion === 'contado'
            ? await getCuentaById(cuentaPagoId)
            : await getCuentaById(cuentaPasivoId);

    if (!cuentaContrapartida) {
        throw new Error(
            tipoAdquisicion === 'contado'
                ? 'Debe seleccionar la cuenta de salida para registrar la compra.'
                : 'Debe seleccionar la cuenta pasiva de la obligación.'
        );
    }

    const cuentaDepreciacionGasto =
        (await getCuentaById(cuentaDepreciacionGastoId)) ||
        (await getCuentaByCode('610112'));

    const cuentaDepreciacionAcumulada =
        (await getCuentaById(cuentaDepreciacionAcumuladaId)) ||
        (await getCuentaByCode('120199'));

    if (!cuentaDepreciacionGasto) {
        throw new Error('No se encontró la cuenta de gasto por depreciación.');
    }

    if (!cuentaDepreciacionAcumulada) {
        throw new Error('No se encontró la cuenta de depreciación acumulada.');
    }

    const costoNIO = moneda === 'USD' ? roundToTwo(costoBase * exchangeRate) : costoBase;
    const costoUSD = moneda === 'USD' ? costoBase : 0;
    const residualNIO = moneda === 'USD' ? roundToTwo(residualBase * exchangeRate) : residualBase;
    const residualUSD = moneda === 'USD' ? residualBase : 0;
    const baseDepreciableNIO = roundToTwo(costoNIO - residualNIO);
    const baseDepreciableUSD = roundToTwo(costoUSD - residualUSD);
    const depreciacionMensual = roundToTwo(baseDepreciableNIO / usefulLifeMonths);
    const depreciacionMensualUSD = moneda === 'USD'
        ? roundToTwo(baseDepreciableUSD / usefulLifeMonths)
        : 0;

    const activoRef = doc(collection(db, 'activosFijos'));
    const referenciaActivo = numeroDocumento || `AF-${activoRef.id.slice(0, 8).toUpperCase()}`;

    const acquisitionEntry = await registerAccountingEntry({
        fecha: fechaAdquisicion,
        descripcion: `Adquisición activo fijo: ${nombre}`,
        referencia: referenciaActivo,
        documentoId: activoRef.id,
        documentoTipo: DOCUMENT_TYPES.ACTIVO_FIJO,
        moduloOrigen: 'activosFijos',
        sucursalId,
        sucursalName,
        userId,
        userEmail,
        movimientos: [
            {
                cuentaId: cuentaActivo.id,
                cuentaCode: cuentaActivo.code,
                cuentaName: cuentaActivo.name,
                tipo: 'DEBITO',
                monto: costoNIO,
                montoUSD: costoUSD,
                descripcion: `Registro del activo fijo ${nombre}`
            },
            {
                cuentaId: cuentaContrapartida.id,
                cuentaCode: cuentaContrapartida.code,
                cuentaName: cuentaContrapartida.name,
                tipo: 'CREDITO',
                monto: costoNIO,
                montoUSD: costoUSD,
                descripcion:
                    tipoAdquisicion === 'contado'
                        ? `Salida por compra de activo fijo ${nombre}`
                        : `Obligación por compra de activo fijo ${nombre}`
            }
        ],
        metadata: {
            activoFijoId: activoRef.id,
            activoFijoNombre: nombre,
            tipoAdquisicion,
            proveedorId,
            proveedorNombre,
            moneda,
            tipoCambio: exchangeRate,
            sucursalId,
            sucursalName
        }
    });

    let facturaProveedorId = null;

    if (tipoAdquisicion === 'credito' && isProveedorLiabilityAccount(cuentaContrapartida)) {
        const facturaProveedorRef = doc(collection(db, 'facturasProveedor'));
        await setDoc(facturaProveedorRef, {
            documentoId: facturaProveedorRef.id,
            origenModulo: 'activosFijos',
            activoFijoId: activoRef.id,
            proveedorId,
            proveedorNombre: proveedorNombre || cuentaContrapartida.name,
            proveedorCodigo: '',
            sucursalId,
            sucursalName,
            numeroFactura: numeroDocumento || referenciaActivo,
            fechaEmision: fechaAdquisicion,
            fechaVencimiento: fechaVencimiento || fechaAdquisicion,
            monto: costoNIO,
            montoUSD: costoUSD,
            moneda,
            saldoPendiente: costoNIO,
            montoAbonado: 0,
            descripcion: `Activo fijo: ${nombre}`,
            cuentaGastoId: cuentaActivo.id,
            cuentaGastoCode: cuentaActivo.code,
            cuentaGastoName: cuentaActivo.name,
            cuentaProveedorId: cuentaContrapartida.id,
            cuentaProveedorCode: cuentaContrapartida.code,
            cuentaProveedorName: cuentaContrapartida.name,
            adjuntos,
            estado: 'pendiente',
            asientoId: acquisitionEntry.asientoId,
            movimientosContablesIds: acquisitionEntry.movimientos.map((mov) => mov.id),
            createdAt: Timestamp.now(),
            createdBy: userId,
            createdByEmail: userEmail
        });
        facturaProveedorId = facturaProveedorRef.id;
    }

    const activo = {
        documentoId: activoRef.id,
        fechaAdquisicion,
        fechaInicioDepreciacion: fechaInicioDepreciacion || fechaAdquisicion,
        sucursalId,
        sucursalName,
        nombre,
        descripcion,
        proveedorId,
        proveedorNombre,
        numeroDocumento: numeroDocumento || referenciaActivo,
        fechaVencimiento: fechaVencimiento || null,
        moneda,
        tipoCambio: exchangeRate,
        costoOriginal: costoNIO,
        costoOriginalUSD: costoUSD,
        valorResidual: residualNIO,
        valorResidualUSD: residualUSD,
        baseDepreciable: baseDepreciableNIO,
        baseDepreciableUSD,
        vidaUtilMeses: usefulLifeMonths,
        depreciacionMensual,
        depreciacionMensualUSD,
        depreciacionAcumulada: 0,
        depreciacionAcumuladaUSD: 0,
        valorEnLibros: costoNIO,
        valorEnLibrosUSD: costoUSD,
        mesesDepreciados: 0,
        mesesRestantes: usefulLifeMonths,
        ultimoPeriodoDepreciado: null,
        fechaUltimaDepreciacion: null,
        estado: 'activo',
        tipoAdquisicion,
        cuentaActivoId: cuentaActivo.id,
        cuentaActivoCode: cuentaActivo.code,
        cuentaActivoName: cuentaActivo.name,
        cuentaContrapartidaId: cuentaContrapartida.id,
        cuentaContrapartidaCode: cuentaContrapartida.code,
        cuentaContrapartidaName: cuentaContrapartida.name,
        cuentaDepreciacionGastoId: cuentaDepreciacionGasto.id,
        cuentaDepreciacionGastoCode: cuentaDepreciacionGasto.code,
        cuentaDepreciacionGastoName: cuentaDepreciacionGasto.name,
        cuentaDepreciacionAcumuladaId: cuentaDepreciacionAcumulada.id,
        cuentaDepreciacionAcumuladaCode: cuentaDepreciacionAcumulada.code,
        cuentaDepreciacionAcumuladaName: cuentaDepreciacionAcumulada.name,
        asientoAdquisicionId: acquisitionEntry.asientoId,
        movimientosAdquisicionIds: acquisitionEntry.movimientos.map((mov) => mov.id),
        facturaProveedorId,
        adjuntos,
        observaciones,
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail,
        updatedAt: Timestamp.now()
    };

    await setDoc(activoRef, activo);

    return {
        id: activoRef.id,
        ...activo,
        facturaProveedorId
    };
};

/**
 * Genera la depreciación mensual de un activo fijo para un periodo específico.
 */
export const generarDepreciacionActivoFijo = async (assetId, depreciationData = {}) => {
    const {
        periodo,
        fechaContable,
        userId,
        userEmail
    } = depreciationData;

    const activoRef = doc(db, 'activosFijos', assetId);
    const activoSnap = await getDoc(activoRef);

    if (!activoSnap.exists()) {
        throw new Error('Activo fijo no encontrado.');
    }

    const activo = { id: activoSnap.id, ...activoSnap.data() };
    const periodoDepreciacion =
        normalizePeriod(periodo) ||
        normalizePeriod(getPeriodFromDate(fechaContable)) ||
        normalizePeriod(getPeriodFromDate(new Date().toISOString()));

    if (!periodoDepreciacion) {
        throw new Error('Debe indicar un periodo válido para la depreciación.');
    }

    const periodoInicio = normalizePeriod(getPeriodFromDate(activo.fechaInicioDepreciacion || activo.fechaAdquisicion));
    if (periodoInicio && periodoDepreciacion < periodoInicio) {
        throw new Error('El periodo es anterior al inicio de depreciación del activo.');
    }

    const depreciationRef = doc(db, 'depreciacionesActivosFijos', `${assetId}_${periodoDepreciacion}`);
    const depreciationSnap = await getDoc(depreciationRef);
    if (depreciationSnap.exists()) {
        throw new Error(`La depreciación del periodo ${periodoDepreciacion} ya fue registrada.`);
    }

    const mesesDepreciados = Number(activo.mesesDepreciados || 0);
    const vidaUtilMeses = Number(activo.vidaUtilMeses || 0);

    if (mesesDepreciados >= vidaUtilMeses) {
        throw new Error('El activo ya completó su depreciación.');
    }

    const restanteNIO = roundToTwo((activo.baseDepreciable || 0) - (activo.depreciacionAcumulada || 0));
    const restanteUSD = roundToTwo((activo.baseDepreciableUSD || 0) - (activo.depreciacionAcumuladaUSD || 0));

    if (restanteNIO <= 0 && restanteUSD <= 0) {
        throw new Error('El activo ya no tiene base depreciable pendiente.');
    }

    const remainingMonths = Math.max(vidaUtilMeses - mesesDepreciados, 1);
    const montoDepreciacion = remainingMonths === 1
        ? restanteNIO
        : Math.min(roundToTwo(activo.depreciacionMensual || 0), restanteNIO);
    const montoDepreciacionUSD = remainingMonths === 1
        ? restanteUSD
        : Math.min(roundToTwo(activo.depreciacionMensualUSD || 0), restanteUSD);

    if (montoDepreciacion <= 0 && montoDepreciacionUSD <= 0) {
        throw new Error('No hay monto pendiente para depreciar en este activo.');
    }

    const cuentaGastoDepreciacion =
        (await getCuentaById(activo.cuentaDepreciacionGastoId)) ||
        (await getCuentaByCode('610112'));
    const cuentaDepreciacionAcumulada =
        (await getCuentaById(activo.cuentaDepreciacionAcumuladaId)) ||
        (await getCuentaByCode('120199'));

    if (!cuentaGastoDepreciacion || !cuentaDepreciacionAcumulada) {
        throw new Error('No se encontraron las cuentas contables para registrar la depreciación.');
    }

    const fechaRegistro = fechaContable || getLastDayOfPeriod(periodoDepreciacion);
    const referencia = `DEP-${periodoDepreciacion}-${assetId.slice(0, 6).toUpperCase()}`;

    const entry = await registerAccountingEntry({
        fecha: fechaRegistro,
        descripcion: `Depreciación ${periodoDepreciacion} - ${activo.nombre}`,
        referencia,
        documentoId: depreciationRef.id,
        documentoTipo: DOCUMENT_TYPES.DEPRECIACION_ACTIVO_FIJO,
        moduloOrigen: 'activosFijos',
        sucursalId: activo.sucursalId || null,
        sucursalName: activo.sucursalName || null,
        userId,
        userEmail,
        movimientos: [
            {
                cuentaId: cuentaGastoDepreciacion.id,
                cuentaCode: cuentaGastoDepreciacion.code,
                cuentaName: cuentaGastoDepreciacion.name,
                tipo: 'DEBITO',
                monto: montoDepreciacion,
                montoUSD: montoDepreciacionUSD,
                descripcion: `Gasto por depreciación ${activo.nombre}`
            },
            {
                cuentaId: cuentaDepreciacionAcumulada.id,
                cuentaCode: cuentaDepreciacionAcumulada.code,
                cuentaName: cuentaDepreciacionAcumulada.name,
                tipo: 'CREDITO',
                monto: montoDepreciacion,
                montoUSD: montoDepreciacionUSD,
                descripcion: `Depreciación acumulada ${activo.nombre}`
            }
        ],
        metadata: {
            activoFijoId: activo.id,
            activoFijoNombre: activo.nombre,
            periodoDepreciacion,
            sucursalId: activo.sucursalId || null,
            sucursalName: activo.sucursalName || null
        }
    });

    const nuevaDepreciacionAcumulada = roundToTwo((activo.depreciacionAcumulada || 0) + montoDepreciacion);
    const nuevaDepreciacionAcumuladaUSD = roundToTwo((activo.depreciacionAcumuladaUSD || 0) + montoDepreciacionUSD);
    const nuevoValorEnLibros = roundToTwo((activo.costoOriginal || 0) - nuevaDepreciacionAcumulada);
    const nuevoValorEnLibrosUSD = roundToTwo((activo.costoOriginalUSD || 0) - nuevaDepreciacionAcumuladaUSD);
    const nuevosMesesDepreciados = mesesDepreciados + 1;
    const nuevosMesesRestantes = Math.max(vidaUtilMeses - nuevosMesesDepreciados, 0);

    await setDoc(depreciationRef, {
        documentoId: depreciationRef.id,
        activoFijoId: activo.id,
        activoFijoNombre: activo.nombre,
        sucursalId: activo.sucursalId || null,
        sucursalName: activo.sucursalName || null,
        periodo: periodoDepreciacion,
        fechaContable: fechaRegistro,
        monto: montoDepreciacion,
        montoUSD: montoDepreciacionUSD,
        cuentaGastoId: cuentaGastoDepreciacion.id,
        cuentaGastoCode: cuentaGastoDepreciacion.code,
        cuentaGastoName: cuentaGastoDepreciacion.name,
        cuentaDepreciacionAcumuladaId: cuentaDepreciacionAcumulada.id,
        cuentaDepreciacionAcumuladaCode: cuentaDepreciacionAcumulada.code,
        cuentaDepreciacionAcumuladaName: cuentaDepreciacionAcumulada.name,
        asientoId: entry.asientoId,
        movimientosContablesIds: entry.movimientos.map((mov) => mov.id),
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail
    });

    await updateDoc(activoRef, {
        depreciacionAcumulada: nuevaDepreciacionAcumulada,
        depreciacionAcumuladaUSD: nuevaDepreciacionAcumuladaUSD,
        valorEnLibros: nuevoValorEnLibros,
        valorEnLibrosUSD: nuevoValorEnLibrosUSD,
        mesesDepreciados: nuevosMesesDepreciados,
        mesesRestantes: nuevosMesesRestantes,
        ultimoPeriodoDepreciado: periodoDepreciacion,
        fechaUltimaDepreciacion: fechaRegistro,
        estado: nuevosMesesRestantes === 0 ? 'depreciado' : 'activo',
        updatedAt: Timestamp.now()
    });

    return {
        success: true,
        assetId,
        periodo: periodoDepreciacion,
        asientoId: entry.asientoId,
        monto: montoDepreciacion
    };
};

/**
 * Genera la depreciación mensual para todos los activos elegibles del periodo.
 */
export const generarDepreciacionMensualActivos = async (generationData = {}) => {
    const {
        periodo,
        fechaContable,
        sucursalId = '',
        userId,
        userEmail
    } = generationData;

    const periodoDepreciacion =
        normalizePeriod(periodo) ||
        normalizePeriod(getPeriodFromDate(fechaContable)) ||
        normalizePeriod(getPeriodFromDate(new Date().toISOString()));

    if (!periodoDepreciacion) {
        throw new Error('Debe seleccionar un periodo válido para depreciar.');
    }

    const activosSnap = await getDocs(collection(db, 'activosFijos'));
    const activos = activosSnap.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((activo) => {
            const periodoInicio = normalizePeriod(getPeriodFromDate(activo.fechaInicioDepreciacion || activo.fechaAdquisicion));
            const basePendiente = roundToTwo((activo.baseDepreciable || 0) - (activo.depreciacionAcumulada || 0));
            const sameSucursal = !sucursalId || activo.sucursalId === sucursalId;

            return (
                sameSucursal &&
                periodoInicio &&
                periodoInicio <= periodoDepreciacion &&
                activo.estado !== 'inactivo' &&
                Number(activo.mesesDepreciados || 0) < Number(activo.vidaUtilMeses || 0) &&
                basePendiente > 0
            );
        });

    const result = {
        periodo: periodoDepreciacion,
        procesados: [],
        omitidos: [],
        errores: []
    };

    for (const activo of activos) {
        try {
            const depreciationRef = doc(db, 'depreciacionesActivosFijos', `${activo.id}_${periodoDepreciacion}`);
            const depreciationSnap = await getDoc(depreciationRef);

            if (depreciationSnap.exists()) {
                result.omitidos.push({
                    assetId: activo.id,
                    nombre: activo.nombre,
                    motivo: 'Ya depreciado en este periodo'
                });
                continue;
            }

            await generarDepreciacionActivoFijo(activo.id, {
                periodo: periodoDepreciacion,
                fechaContable: fechaContable || getLastDayOfPeriod(periodoDepreciacion),
                userId,
                userEmail
            });

            result.procesados.push({
                assetId: activo.id,
                nombre: activo.nombre
            });
        } catch (error) {
            result.errores.push({
                assetId: activo.id,
                nombre: activo.nombre,
                error: error.message
            });
        }
    }

    return result;
};

// ============================================
// AJUSTES MANUALES
// ============================================

/**
 * Crea un ajuste manual pendiente de aprobación
 */
export const createAjusteManual = async (ajusteData) => {
    const {
        fecha,
        cuentaId,
        cuentaCode,
        cuentaName,
        cuentaContrapartidaId,
        cuentaContrapartidaCode,
        cuentaContrapartidaName,
        tipoMovimiento,
        monto,
        descripcion,
        justificacion,
        userId,
        userEmail
    } = ajusteData;

    const montoNormalizado = Number(monto) || 0;

    if (!cuentaId || !cuentaCode || !cuentaName) {
        throw new Error('Debe seleccionar la cuenta que será ajustada.');
    }

    if (!cuentaContrapartidaId || !cuentaContrapartidaCode || !cuentaContrapartidaName) {
        throw new Error('Debe seleccionar la cuenta contrapartida del ajuste.');
    }

    if (cuentaId === cuentaContrapartidaId) {
        throw new Error('La cuenta ajustada y la contrapartida deben ser diferentes.');
    }

    if (!['DEBITO', 'CREDITO'].includes(tipoMovimiento)) {
        throw new Error('El tipo de movimiento del ajuste no es válido.');
    }

    if (montoNormalizado <= 0) {
        throw new Error('El ajuste manual debe tener un monto mayor a cero.');
    }

    const ajuste = {
        fecha,
        cuentaId,
        cuentaCode,
        cuentaName,
        cuentaContrapartidaId,
        cuentaContrapartidaCode,
        cuentaContrapartidaName,
        tipoMovimiento,
        monto: montoNormalizado,
        descripcion,
        justificacion,
        estado: 'pendiente',
        aprobadoPor: null,
        aprobadoPorEmail: null,
        aprobadoAt: null,
        rechazadoPor: null,
        rechazadoPorEmail: null,
        rechazadoAt: null,
        motivoRechazo: null,
        movimientosContablesIds: [],
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByEmail: userEmail
    };

    const docRef = await addDoc(collection(db, 'ajustesManuales'), ajuste);
    return { id: docRef.id, ...ajuste };
};

/**
 * Aprueba un ajuste manual y genera los movimientos contables
 */
export const aprobarAjusteManual = async (ajusteId, userId, userEmail) => {
    const ajusteRef = doc(db, 'ajustesManuales', ajusteId);
    const ajusteSnap = await getDoc(ajusteRef);

    if (!ajusteSnap.exists()) {
        throw new Error('Ajuste no encontrado');
    }

    const ajuste = ajusteSnap.data();

    if (ajuste.estado !== 'pendiente') {
        throw new Error('El ajuste ya fue procesado');
    }

    if (toNumber(ajuste.monto) <= 0) {
        throw new Error('El ajuste manual debe tener un monto mayor a cero');
    }

    const cuentaAjuste = await getDoc(doc(db, 'planCuentas', ajuste.cuentaId));
    const cuentaContrapartida = ajuste.cuentaContrapartidaId
        ? await getDoc(doc(db, 'planCuentas', ajuste.cuentaContrapartidaId))
        : null;

    if (!cuentaAjuste.exists()) {
        throw new Error('Cuenta del ajuste no encontrada');
    }

    const cuentaData = { id: cuentaAjuste.id, ...cuentaAjuste.data() };
    const gastosExtraAccount = await getCuentaByCode(CUENTAS_DGI.GASTOS_EXTRAORDINARIOS);
    const cuentaContrapartidaData = cuentaContrapartida?.exists()
        ? { id: cuentaContrapartida.id, ...cuentaContrapartida.data() }
        : gastosExtraAccount;

    if (!cuentaContrapartidaData) {
        throw new Error('No se encontró la cuenta contrapartida del ajuste manual');
    }

    if (cuentaData.id === cuentaContrapartidaData.id) {
        throw new Error('La cuenta del ajuste y la contrapartida no pueden ser iguales');
    }

    // Crear movimientos
    const movimientos = [];
    const tipoContrapartida = ajuste.tipoMovimiento === 'DEBITO' ? 'CREDITO' : 'DEBITO';

    if (ajuste.tipoMovimiento === 'DEBITO') {
        movimientos.push({
            cuentaId: cuentaData.id,
            cuentaCode: cuentaData.code,
            cuentaName: cuentaData.name,
            tipo: 'DEBITO',
            monto: ajuste.monto,
            montoUSD: 0,
            descripcion: ajuste.descripcion
        });
    } else {
        movimientos.push({
            cuentaId: cuentaData.id,
            cuentaCode: cuentaData.code,
            cuentaName: cuentaData.name,
            tipo: 'CREDITO',
            monto: ajuste.monto,
            montoUSD: 0,
            descripcion: ajuste.descripcion
        });
    }

    movimientos.push({
        cuentaId: cuentaContrapartidaData.id,
        cuentaCode: cuentaContrapartidaData.code,
        cuentaName: cuentaContrapartidaData.name,
        tipo: tipoContrapartida,
        monto: ajuste.monto,
        montoUSD: 0,
        descripcion: `Contrapartida ajuste: ${ajuste.descripcion}`
    });

    // Registrar asiento contable
    const entry = await registerAccountingEntry({
        fecha: ajuste.fecha,
        descripcion: `Ajuste Manual: ${ajuste.descripcion}`,
        referencia: `AJUSTE-${ajusteId}`,
        documentoId: ajusteId,
        documentoTipo: DOCUMENT_TYPES.AJUSTE,
        moduloOrigen: 'ajusteManual',
        userId,
        userEmail: userEmail || ajuste.createdByEmail || null,
        movimientos,
        metadata: { 
            tipo: 'ajusteManual',
            cuentaAjustada: cuentaData.name,
            cuentaContrapartida: cuentaContrapartidaData.name,
            tipoMovimiento: ajuste.tipoMovimiento,
            tipoContrapartida
        }
    });

    // Actualizar ajuste
    const updatePayload = {
        estado: 'aprobado',
        aprobadoPor: userId,
        aprobadoAt: Timestamp.now(),
        movimientosContablesIds: entry.movimientos.map(m => m.id),
        asientoId: entry.asientoId
    };

    if (userEmail || ajuste.createdByEmail) {
        updatePayload.aprobadoPorEmail = userEmail || ajuste.createdByEmail;
    }

    await updateDoc(ajusteRef, updatePayload);

    return { success: true };
};

/**
 * Rechaza un ajuste manual
 */
export const rechazarAjusteManual = async (ajusteId, motivo, userId, userEmail) => {
    const ajusteRef = doc(db, 'ajustesManuales', ajusteId);
    const ajusteSnap = await getDoc(ajusteRef);

    if (!ajusteSnap.exists()) {
        throw new Error('Ajuste no encontrado');
    }

    const ajuste = ajusteSnap.data();

    if (ajuste.estado !== 'pendiente') {
        throw new Error('El ajuste ya fue procesado');
    }

    const updatePayload = {
        estado: 'rechazado',
        rechazadoPor: userId,
        rechazadoAt: Timestamp.now(),
        motivoRechazo: motivo
    };

    if (userEmail || ajuste.createdByEmail) {
        updatePayload.rechazadoPorEmail = userEmail || ajuste.createdByEmail;
    }

    await updateDoc(ajusteRef, updatePayload);

    return { success: true };
};

/**
 * Reinicia los datos operativos del ERP manteniendo la configuración base.
 * Conserva usuarios, sucursales, configuración y estructura del plan de cuentas.
 * Los saldos contables vuelven a cero.
 */
export const resetERPDatabase = async ({ userId, userEmail, reason = 'manual-reset' }) => {
    if (!userId) {
        throw new Error('Debe iniciar sesión para reiniciar la base de datos');
    }

    const usuarioSnap = await getDoc(doc(db, 'usuarios', userId));
    if (!usuarioSnap.exists() || usuarioSnap.data()?.role !== 'admin') {
        throw new Error('Solo un administrador puede reiniciar la base de datos');
    }

    const collectionsToClear = [
        'ventasDirectas',
        'gastosDirectos',
        'compras',
        'gastosDiarios',
        'proveedores',
        'facturasProveedor',
        'facturasCuentaPagar',
        'pagosProveedor',
        'abonosProveedor',
        'abonosFacturaDetalle',
        'depositosTransito',
        'depositosBancarios',
        'cierresCajaERP',
        'activosFijos',
        'depreciacionesActivosFijos',
        'ajustesManuales',
        'asientosContables',
        'movimientosContables'
    ];

    const collectionsReset = {};

    for (const collectionName of collectionsToClear) {
        collectionsReset[collectionName] = await deleteCollectionDocuments(collectionName);
    }

    const planCuentasReset = await resetPlanCuentasBalances();
    const executedAt = Timestamp.now();

    await setDoc(
        doc(db, 'configuracion', 'ultimoReinicioSistema'),
        {
            executedAt,
            executedBy: userId,
            executedByEmail: userEmail || null,
            reason,
            collectionsReset,
            planCuentasReset,
            preservedCollections: ['usuarios', 'branches', 'configuracion', 'planCuentas']
        },
        { merge: true }
    );

    return {
        success: true,
        executedAt,
        collectionsReset,
        planCuentasReset,
        preservedCollections: ['usuarios', 'branches', 'configuracion', 'planCuentas']
    };
};

export default {
    DOCUMENT_TYPES,
    registerAccountingEntry,
    createCierreCajaERP,
    updateCierreCajaERPStatus,
    procesarCierreCajaERP,
    createDepositoTransitoERP,
    confirmarDepositoBancarioERP,
    createFacturaProveedor,
    registrarPagoProveedor,
    createActivoFijo,
    generarDepreciacionActivoFijo,
    generarDepreciacionMensualActivos,
    createAjusteManual,
    aprobarAjusteManual,
    rechazarAjusteManual,
    resetERPDatabase
};
