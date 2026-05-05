const {
    buildMirrorDocId,
    clampText,
    cleanString,
    normalizeKey,
    nowIso,
    sha1,
    toIsoDate,
    toIsoDateTime,
    toNumber
} = require('./helpers.cjs');

const PAYMENT_METHODS = {
    1: 'efectivo',
    2: 'cheque',
    3: 'credito',
    4: 'transferencia',
    5: 'vales',
    6: 'tarjeta',
    7: 'anticipo',
    8: 'sicarPagos'
};

const joinAddress = (...parts) =>
    parts
        .map((value) => cleanString(value))
        .filter(Boolean)
        .join(', ');

const normalizeCurrency = (rawValue) => {
    const value = cleanString(rawValue).toUpperCase();
    if (!value) return 'NIO';
    if (['USD', 'US$', '$'].includes(value)) return 'USD';
    if (['NIO', 'CS', 'C$', 'CORDOBA', 'CORDOBAS', 'MXN'].includes(value)) return 'NIO';
    return value;
};

const summarizeLineItems = (items = [], maxItems = 3) => {
    const labels = items
        .slice(0, maxItems)
        .map((item) => clampText(item.descripcion || item.nombre || item.clave || 'Detalle', 50))
        .filter(Boolean);

    if (!labels.length) return '';
    if (items.length <= maxItems) return labels.join(' + ');
    return `${labels.join(' + ')} +${items.length - maxItems} más`;
};

const buildSourceMetadata = ({ sourceTable, sourceId, sourceStatus, payload, syncedAt }) => ({
    sourceSystem: 'sicar',
    sourceTable,
    sourceId: String(sourceId),
    sourceStatus,
    sourceHash: sha1(payload),
    syncedAt,
    lastSeenAt: syncedAt,
    integrationVersion: '2026-05-05'
});

const mapEntityStatus = (status) => Number(status) === -1 ? 'inactivo' : 'activo';
const isCancelledStatus = (status) => Number(status) === -1;

const mapCreditState = (status, saldoPendiente) => {
    const normalizedStatus = Number(status);
    const saldo = Math.max(0, toNumber(saldoPendiente));

    if (normalizedStatus === -1) return 'anulado';
    if (normalizedStatus === 2 && saldo <= 0.01) return 'pagada';
    if (normalizedStatus === 2 && saldo > 0.01) return 'parcial';
    if (normalizedStatus === 1 && saldo > 0.01) return 'pendiente';
    if (saldo <= 0.01) return 'pagada';
    return 'pendiente';
};

const buildPaymentSummary = (payments = []) => {
    const normalized = payments
        .map((payment) => ({
            tpaId: Number(payment.tpa_id || payment.tpaId || 0),
            nombre: cleanString(payment.tipo_pago_nombre || payment.tipoPagoNombre || payment.nombre) || PAYMENT_METHODS[payment.tpa_id] || 'desconocido',
            metodo: PAYMENT_METHODS[payment.tpa_id] || 'otro',
            total: toNumber(payment.total)
        }))
        .filter((payment) => payment.total !== 0);

    const total = normalized.reduce((sum, payment) => sum + payment.total, 0);

    return {
        total,
        detail: normalized,
        metodoPrincipal:
            normalized.length === 1
                ? normalized[0].metodo
                : normalized.length > 1
                    ? 'mixto'
                    : ''
    };
};

const DEFAULT_OPERATION_PROFILE = {
    branchId: 'granada',
    branchCode: 'granada',
    branchName: 'CARNES SAN MARTIN GRANADA',
    confidence: 'fixed',
    notes: 'Integracion fija para la operacion de Granada.'
};

const buildFixedOperationProfile = (integrationConfig = {}) => {
    const configured = integrationConfig.operationProfile || {};

    return {
        branchId: cleanString(configured.branchId) || DEFAULT_OPERATION_PROFILE.branchId,
        branchCode: cleanString(configured.branchCode) || DEFAULT_OPERATION_PROFILE.branchCode,
        branchName: cleanString(configured.branchName) || DEFAULT_OPERATION_PROFILE.branchName,
        confidence: cleanString(configured.confidence) || DEFAULT_OPERATION_PROFILE.confidence,
        notes: cleanString(configured.notes) || DEFAULT_OPERATION_PROFILE.notes
    };
};

const createReferenceContext = ({ branches = [], accounts = [], integrationConfig = {} }) => {
    const accountsByCode = new Map();

    for (const account of accounts) {
        const normalizedCode = cleanString(account.code).replace(/\./g, '');
        if (normalizedCode) accountsByCode.set(normalizedCode, account);
    }

    const getAccount = (...codes) => {
        for (const code of codes) {
            const normalizedCode = cleanString(code).replace(/\./g, '');
            if (accountsByCode.has(normalizedCode)) {
                return accountsByCode.get(normalizedCode);
            }
        }
        return null;
    };

    return {
        branches,
        operationProfile: buildFixedOperationProfile(integrationConfig),
        paymentTypeMap: integrationConfig.paymentTypeMap || PAYMENT_METHODS,
        defaultAccounts: {
            supplierLiability: getAccount('210101'),
            customerReceivable: getAccount('110301'),
            salesIncome: getAccount('410101', '410102', '410103'),
            costExpense: getAccount('510101'),
            genericExpense: getAccount('610399', '610302', '610304')
        }
    };
};

const resolveBranch = (context, source = {}) => {
    const cajaId = cleanString(source.caj_id || source.cajaId);
    const cajaName = cleanString(source.caja_nombre || source.cajaNombre || source.sourceCajaName);
    const profile = context.operationProfile || DEFAULT_OPERATION_PROFILE;

    return {
        branchId: profile.branchId,
        branchCode: profile.branchCode,
        branchName: profile.branchName,
        confidence: profile.confidence || 'fixed',
        notes: profile.notes || '',
        needsReview: false,
        sourceCajaId: cajaId,
        sourceCajaName: cajaName
    };
};

const buildCustomerDocs = ({ customers = [], customerBalances = new Map(), reference, syncedAt }) =>
    customers.map((customer) => {
        const mirrorId = buildMirrorDocId('cliente', customer.cli_id);
        const balance = customerBalances.get(String(customer.cli_id)) || {};
        const account = reference.defaultAccounts.customerReceivable;
        const activo = Number(customer.status) !== -1;
        const payload = {
            documentoId: mirrorId,
            codigo: cleanString(customer.clave) || `CLI-${customer.cli_id}`,
            nombre: cleanString(customer.nombre),
            ruc: cleanString(customer.rfc),
            direccion: joinAddress(
                customer.domicilio,
                customer.noExt,
                customer.noInt,
                customer.colonia,
                customer.localidad,
                customer.ciudad,
                customer.estado,
                customer.pais
            ),
            telefono: cleanString(customer.celular || customer.telefono),
            email: cleanString(customer.mail),
            contacto: cleanString(customer.representante),
            limiteCredito: toNumber(customer.limite),
            plazoDias: toNumber(customer.diasCredito),
            saldoPendiente: toNumber(balance.saldoPendiente),
            totalCreditos: toNumber(balance.totalCreditos),
            totalAbonos: toNumber(balance.totalAbonos),
            activo,
            statusLabel: mapEntityStatus(customer.status),
            cuentaContableId: account?.id || '',
            cuentaContableCode: account?.code || '',
            cuentaContableName: account?.name || '',
            cuentaContableType: account?.type || '',
            origenModulo: 'sicarSync',
            createdAtSource: null,
            updatedAtSource: syncedAt
        };

        return {
            id: mirrorId,
            data: {
                ...payload,
                ...buildSourceMetadata({
                    sourceTable: 'cliente',
                    sourceId: customer.cli_id,
                    sourceStatus: customer.status,
                    payload,
                    syncedAt
                })
            }
        };
    });

const buildSupplierDocs = ({ suppliers = [], supplierBalances = new Map(), reference, syncedAt }) =>
    suppliers.map((supplier) => {
        const mirrorId = buildMirrorDocId('proveedor', supplier.pro_id);
        const balance = supplierBalances.get(String(supplier.pro_id)) || {};
        const account = reference.defaultAccounts.supplierLiability;
        const activo = Number(supplier.status) !== -1;
        const payload = {
            documentoId: mirrorId,
            codigo: `PRO-${supplier.pro_id}`,
            nombre: cleanString(supplier.nombre),
            alias: cleanString(supplier.alias),
            ruc: cleanString(supplier.rfc),
            direccion: joinAddress(
                supplier.domicilio,
                supplier.noExt,
                supplier.noInt,
                supplier.colonia,
                supplier.localidad,
                supplier.ciudad,
                supplier.estado,
                supplier.pais
            ),
            telefono: cleanString(supplier.celular || supplier.telefono),
            email: cleanString(supplier.mail),
            contacto: cleanString(supplier.representante),
            limiteCredito: toNumber(supplier.limite),
            plazoDias: toNumber(supplier.diasCredito),
            saldoPendiente: toNumber(balance.saldoPendiente),
            totalCompras: toNumber(balance.totalCompras),
            totalPagos: toNumber(balance.totalPagos),
            activo,
            statusLabel: mapEntityStatus(supplier.status),
            cuentaContableId: account?.id || '',
            cuentaContableCode: account?.code || '',
            cuentaContableName: account?.name || '',
            cuentaContableType: account?.type || '',
            origenModulo: 'sicarSync',
            updatedAtSource: syncedAt
        };

        return {
            id: mirrorId,
            data: {
                ...payload,
                ...buildSourceMetadata({
                    sourceTable: 'proveedor',
                    sourceId: supplier.pro_id,
                    sourceStatus: supplier.status,
                    payload,
                    syncedAt
                })
            }
        };
    });

const buildSalesDocs = ({
    sales = [],
    saleDetailsById = new Map(),
    salePaymentsById = new Map(),
    creditsBySaleId = new Map(),
    customersById = new Map(),
    reference,
    syncedAt
}) => sales.map((sale) => {
    const details = saleDetailsById.get(String(sale.ven_id)) || [];
    const paymentSummary = buildPaymentSummary(salePaymentsById.get(String(sale.ven_id)) || []);
    const credit = (creditsBySaleId.get(String(sale.ven_id)) || [])[0] || null;
    const customer = credit ? customersById.get(String(credit.cli_id)) : null;
    const branch = resolveBranch(reference, sale);
    const currency = normalizeCurrency(sale.monAbr);
    const mirrorId = buildMirrorDocId('venta', sale.ven_id);
    const itemCount = details.reduce((sum, item) => sum + toNumber(item.cantidad), 0);
    const warnings = [];
    if (paymentSummary.detail.length > 1) warnings.push('Venta con formas de pago mixtas.');

    const payload = {
        documentoId: mirrorId,
        fecha: toIsoDate(sale.fecha),
        fechaHora: toIsoDateTime(sale.fecha),
        descripcion: summarizeLineItems(details) || `Venta SICAR ${sale.ven_id}`,
        monto: toNumber(sale.total),
        subtotal: toNumber(sale.subtotal),
        descuento: toNumber(sale.descuento),
        montoUSD: currency === 'USD' ? toNumber(sale.total) : 0,
        moneda: currency,
        metodoPago: paymentSummary.metodoPrincipal || (credit ? 'credito' : ''),
        metodosPagoDetalle: paymentSummary.detail,
        clienteId: customer ? buildMirrorDocId('cliente', customer.cli_id) : '',
        cliente: cleanString(customer?.nombre),
        factura: cleanString(sale.afFolio) || `VTA-${sale.ven_id}`,
        esCredito: Boolean(credit),
        montoCredito: toNumber(credit?.total),
        cuentaIngresoId: reference.defaultAccounts.salesIncome?.id || '',
        cuentaIngresoCode: reference.defaultAccounts.salesIncome?.code || '',
        cuentaIngresoName: reference.defaultAccounts.salesIncome?.name || '',
        cuentaIngresoType: reference.defaultAccounts.salesIncome?.type || '',
        sucursalId: branch.branchId,
        sucursalName: branch.branchName,
        sucursalCode: branch.branchCode,
        sourceCajaId: branch.sourceCajaId,
        sourceCajaName: branch.sourceCajaName,
        sourceRccId: sale.rcc_id ? String(sale.rcc_id) : '',
        costoVenta: toNumber(sale.totalCompra),
        utilidadBruta: toNumber(sale.totalUtilidad),
        totalItems: itemCount,
        items: details.map((item) => ({
            artId: item.art_id,
            sku: cleanString(item.clave),
            descripcion: cleanString(item.descripcion),
            cantidad: toNumber(item.cantidad),
            unidad: cleanString(item.unidad),
            precio: toNumber(item.precioCon),
            importe: toNumber(item.importeCon),
            precioCompra: toNumber(item.precioCompra),
            importeCompra: toNumber(item.importeCompra)
        })),
        cancelado: isCancelledStatus(sale.status),
        estado: isCancelledStatus(sale.status) ? 'cancelada' : (credit ? 'credito' : 'completada'),
        syncWarnings: warnings,
        origenModulo: 'sicarSync'
    };

    return {
        id: mirrorId,
        data: {
            ...payload,
            ...buildSourceMetadata({
                sourceTable: 'venta',
                sourceId: sale.ven_id,
                sourceStatus: sale.status,
                payload,
                syncedAt
            })
        }
    };
});

const buildArCreditDocs = ({
    credits = [],
    abonosByCreditId = new Map(),
    customersById = new Map(),
    salesById = new Map(),
    reference,
    syncedAt
}) => credits.map((credit) => {
    const abonos = abonosByCreditId.get(String(credit.ccl_id)) || [];
    const customer = customersById.get(String(credit.cli_id)) || null;
    const sale = salesById.get(String(credit.ven_id)) || null;
    const totalAbonado = abonos
        .filter((item) => Number(item.status) === 1)
        .reduce((sum, item) => sum + toNumber(item.total), 0);
    const saldoPendiente = Math.max(0, toNumber(credit.total) - totalAbonado);
    const branch = resolveBranch(reference, sale || credit);
    const mirrorId = buildMirrorDocId('creditocliente', credit.ccl_id);
    const payload = {
        documentoId: mirrorId,
        clienteId: customer ? buildMirrorDocId('cliente', customer.cli_id) : '',
        clienteNombre: cleanString(customer?.nombre),
        clienteCodigo: cleanString(customer?.clave) || `CLI-${credit.cli_id}`,
        ventaId: credit.ven_id ? buildMirrorDocId('venta', credit.ven_id) : '',
        numeroDocumento: sale?.afFolio ? cleanString(sale.afFolio) : `VTA-${credit.ven_id}`,
        fechaEmision: toIsoDate(sale?.fecha),
        fechaVencimiento: toIsoDate(credit.fechaLimite),
        montoOriginal: toNumber(credit.total),
        montoAbonado: totalAbonado,
        saldoPendiente,
        estado: mapCreditState(credit.status, saldoPendiente),
        cuentaContableId: reference.defaultAccounts.customerReceivable?.id || '',
        cuentaContableCode: reference.defaultAccounts.customerReceivable?.code || '',
        cuentaContableName: reference.defaultAccounts.customerReceivable?.name || '',
        cuentaContableType: reference.defaultAccounts.customerReceivable?.type || '',
        sucursalId: branch.branchId,
        sucursalName: branch.branchName,
        sucursalCode: branch.branchCode,
        sourceCajaId: branch.sourceCajaId,
        sourceCajaName: branch.sourceCajaName,
        cancelado: Number(credit.status) === -1,
        origenModulo: 'sicarSync'
    };

    return {
        id: mirrorId,
        data: {
            ...payload,
            ...buildSourceMetadata({
                sourceTable: 'creditocliente',
                sourceId: credit.ccl_id,
                sourceStatus: credit.status,
                payload,
                syncedAt
            })
        }
    };
});

const buildArPaymentDocs = ({
    abonos = [],
    creditsById = new Map(),
    customersById = new Map(),
    salesById = new Map(),
    reference,
    syncedAt
}) => abonos.map((payment) => {
    const credit = creditsById.get(String(payment.ccl_id)) || null;
    const customer = credit ? customersById.get(String(credit.cli_id)) : null;
    const sale = credit ? salesById.get(String(credit.ven_id)) : null;
    const branch = resolveBranch(reference, sale || credit || payment);
    const mirrorId = buildMirrorDocId('abonocliente', payment.acl_id);
    const metodo = PAYMENT_METHODS[payment.tpa_id] || 'otro';
    const payload = {
        documentoId: mirrorId,
        cuentaPorCobrarId: payment.ccl_id ? buildMirrorDocId('creditocliente', payment.ccl_id) : '',
        clienteId: customer ? buildMirrorDocId('cliente', customer.cli_id) : '',
        clienteNombre: cleanString(customer?.nombre),
        fecha: toIsoDate(payment.fecha),
        montoTotal: toNumber(payment.total),
        montoAplicado: toNumber(payment.total),
        metodoPago: metodo,
        referencia: cleanString(payment.comentario) || `ACL-${payment.acl_id}`,
        estado: Number(payment.status) === -1 ? 'anulado' : 'completado',
        facturasIds: payment.ccl_id ? [buildMirrorDocId('creditocliente', payment.ccl_id)] : [],
        sucursalId: branch.branchId,
        sucursalName: branch.branchName,
        sourceCajaId: branch.sourceCajaId,
        sourceCajaName: branch.sourceCajaName,
        origenModulo: 'sicarSync'
    };

    return {
        id: mirrorId,
        data: {
            ...payload,
            ...buildSourceMetadata({
                sourceTable: 'abonocliente',
                sourceId: payment.acl_id,
                sourceStatus: payment.status,
                payload,
                syncedAt
            })
        }
    };
});

const buildPurchaseDocs = ({
    purchases = [],
    purchaseDetailsById = new Map(),
    purchasePaymentsById = new Map(),
    creditsByPurchaseId = new Map(),
    suppliersById = new Map(),
    reference,
    syncedAt
}) => purchases
    .filter((purchase) => Number(purchase.gasto) !== 1)
    .map((purchase) => {
        const details = purchaseDetailsById.get(String(purchase.com_id)) || [];
        const payments = buildPaymentSummary(purchasePaymentsById.get(String(purchase.com_id)) || []);
        const credit = (creditsByPurchaseId.get(String(purchase.com_id)) || [])[0] || null;
        const supplier = suppliersById.get(String(purchase.pro_id)) || null;
        const branch = resolveBranch(reference, purchase);
        const mirrorId = buildMirrorDocId('compra', purchase.com_id);
        const totalPaid = credit?.montoAbonado ?? (credit ? 0 : payments.total);
        const saldoPendiente = credit ? Math.max(0, toNumber(credit.total) - toNumber(credit.montoAbonado)) : 0;
        const costAccount = reference.defaultAccounts.costExpense;
        const warnings = [];

        const payload = {
            documentoId: mirrorId,
            fecha: toIsoDate(purchase.fecha),
            fechaHora: toIsoDateTime(purchase.fecha),
            sucursalId: branch.branchId,
            sucursalName: branch.branchName,
            sucursalCode: branch.branchCode,
            sourceCajaId: branch.sourceCajaId,
            sourceCajaName: branch.sourceCajaName,
            proveedorId: supplier ? buildMirrorDocId('proveedor', supplier.pro_id) : '',
            proveedor: cleanString(supplier?.nombre || purchase.proveedorNombre),
            descripcion: summarizeLineItems(details) || `Compra SICAR ${purchase.com_id}`,
            monto: toNumber(purchase.total),
            montoUSD: normalizeCurrency(purchase.monAbr) === 'USD' ? toNumber(purchase.total) : 0,
            moneda: normalizeCurrency(purchase.monAbr),
            esCredito: Boolean(credit),
            factura: cleanString(purchase.serieFolio || purchase.folio) || `COM-${purchase.com_id}`,
            metodoPago: credit ? 'credito' : payments.metodoPrincipal,
            metodosPagoDetalle: payments.detail,
            cuentaGastoId: costAccount?.id || '',
            cuentaGastoCode: costAccount?.code || '',
            cuentaGastoName: costAccount?.name || '',
            cuentaGastoType: costAccount?.type || 'COSTO',
            pagada: !credit || saldoPendiente <= 0.01,
            montoPagado: toNumber(totalPaid),
            saldoPendiente,
            statusMirror: credit ? mapCreditState(credit.status, saldoPendiente) : (isCancelledStatus(purchase.status) ? 'anulada' : 'pagada'),
            items: details.map((item) => ({
                artId: item.art_id,
                sku: cleanString(item.clave),
                descripcion: cleanString(item.descripcion),
                cantidad: toNumber(item.cantidad),
                unidad: cleanString(item.unidad),
                precio: toNumber(item.precioCon),
                importe: toNumber(item.importeCon)
            })),
            cancelado: isCancelledStatus(purchase.status),
            syncWarnings: warnings,
            origenModulo: 'sicarSync'
        };

        return {
            id: mirrorId,
            data: {
                ...payload,
                ...buildSourceMetadata({
                    sourceTable: 'compra',
                    sourceId: purchase.com_id,
                    sourceStatus: purchase.status,
                    payload,
                    syncedAt
                })
            }
        };
    });

const buildExpenseDocs = ({
    purchases = [],
    purchaseDetailsById = new Map(),
    purchasePaymentsById = new Map(),
    creditsByPurchaseId = new Map(),
    suppliersById = new Map(),
    reference,
    syncedAt
}) => purchases
    .filter((purchase) => Number(purchase.gasto) === 1 && !(creditsByPurchaseId.get(String(purchase.com_id)) || []).length)
    .map((purchase) => {
        const details = purchaseDetailsById.get(String(purchase.com_id)) || [];
        const payments = buildPaymentSummary(purchasePaymentsById.get(String(purchase.com_id)) || []);
        const supplier = suppliersById.get(String(purchase.pro_id)) || null;
        const branch = resolveBranch(reference, purchase);
        const mirrorId = buildMirrorDocId('gasto', purchase.com_id);
        const expenseAccount = reference.defaultAccounts.genericExpense;
        const warnings = [];

        const payload = {
            documentoId: mirrorId,
            fecha: toIsoDate(purchase.fecha),
            fechaHora: toIsoDateTime(purchase.fecha),
            sucursalId: branch.branchId,
            sucursalName: branch.branchName,
            sucursalCode: branch.branchCode,
            sourceCajaId: branch.sourceCajaId,
            sourceCajaName: branch.sourceCajaName,
            proveedorId: supplier ? buildMirrorDocId('proveedor', supplier.pro_id) : '',
            proveedor: cleanString(supplier?.nombre || purchase.proveedorNombre),
            concepto: summarizeLineItems(details) || `Gasto SICAR ${purchase.com_id}`,
            descripcion: summarizeLineItems(details) || `Gasto SICAR ${purchase.com_id}`,
            categoria: 'sicar',
            monto: toNumber(purchase.total),
            montoUSD: normalizeCurrency(purchase.monAbr) === 'USD' ? toNumber(purchase.total) : 0,
            moneda: normalizeCurrency(purchase.monAbr),
            factura: cleanString(purchase.serieFolio || purchase.folio) || `GAS-${purchase.com_id}`,
            metodoPago: payments.metodoPrincipal,
            metodosPagoDetalle: payments.detail,
            cuentaGastoId: expenseAccount?.id || '',
            cuentaGastoCode: expenseAccount?.code || '',
            cuentaGastoName: expenseAccount?.name || '',
            cuentaGastoType: expenseAccount?.type || 'GASTO',
            items: details.map((item) => ({
                artId: item.art_id,
                sku: cleanString(item.clave),
                descripcion: cleanString(item.descripcion),
                cantidad: toNumber(item.cantidad),
                unidad: cleanString(item.unidad),
                precio: toNumber(item.precioCon),
                importe: toNumber(item.importeCon)
            })),
            cancelado: isCancelledStatus(purchase.status),
            syncWarnings: warnings,
            origenModulo: 'sicarSync'
        };

        return {
            id: mirrorId,
            data: {
                ...payload,
                ...buildSourceMetadata({
                    sourceTable: 'compra_gasto',
                    sourceId: purchase.com_id,
                    sourceStatus: purchase.status,
                    payload,
                    syncedAt
                })
            }
        };
    });

const buildApCreditDocs = ({
    credits = [],
    abonosByCreditId = new Map(),
    purchasesById = new Map(),
    suppliersById = new Map(),
    reference,
    syncedAt
}) => credits.map((credit) => {
    const purchase = purchasesById.get(String(credit.com_id)) || null;
    const supplier = suppliersById.get(String(credit.pro_id)) || null;
    const abonos = abonosByCreditId.get(String(credit.cpr_id)) || [];
    const totalAbonado = abonos
        .filter((item) => Number(item.status) === 1)
        .reduce((sum, item) => sum + toNumber(item.total), 0);
    const saldoPendiente = Math.max(0, toNumber(credit.total) - totalAbonado);
    const branch = resolveBranch(reference, purchase || credit);
    const mirrorId = buildMirrorDocId('creditoproveedor', credit.cpr_id);
    const expenseAccount = Number(purchase?.gasto) === 1
        ? reference.defaultAccounts.genericExpense
        : reference.defaultAccounts.costExpense;
    const supplierAccount = reference.defaultAccounts.supplierLiability;
    const payload = {
        documentoId: mirrorId,
        proveedorId: supplier ? buildMirrorDocId('proveedor', supplier.pro_id) : '',
        proveedorNombre: cleanString(supplier?.nombre || credit.proveedorNombre),
        proveedorCodigo: `PRO-${credit.pro_id}`,
        numeroFactura: cleanString(purchase?.serieFolio || purchase?.folio) || `COM-${credit.com_id}`,
        fechaEmision: toIsoDate(purchase?.fecha),
        fechaVencimiento: toIsoDate(credit.fechaLimite),
        descripcion: summarizeLineItems(purchase ? (purchase.items || []) : []) || (Number(purchase?.gasto) === 1 ? `Gasto a credito ${credit.com_id}` : `Compra a credito ${credit.com_id}`),
        monto: toNumber(credit.total),
        saldoPendiente,
        montoAbonado: totalAbonado,
        moneda: normalizeCurrency(purchase?.monAbr),
        cuentaGastoId: expenseAccount?.id || '',
        cuentaGastoCode: expenseAccount?.code || '',
        cuentaGastoName: expenseAccount?.name || '',
        cuentaGastoType: expenseAccount?.type || (Number(purchase?.gasto) === 1 ? 'GASTO' : 'COSTO'),
        cuentaProveedorId: supplierAccount?.id || '',
        cuentaProveedorCode: supplierAccount?.code || '',
        cuentaProveedorName: supplierAccount?.name || '',
        cuentaProveedorType: supplierAccount?.type || 'PASIVO',
        sucursalId: branch.branchId,
        sucursalName: branch.branchName,
        sucursalCode: branch.branchCode,
        sourceCajaId: branch.sourceCajaId,
        sourceCajaName: branch.sourceCajaName,
        estado: mapCreditState(credit.status, saldoPendiente),
        esGasto: Number(purchase?.gasto) === 1,
        origenModulo: 'sicarSync',
        adjuntos: [],
        movimientosContablesIds: [],
        pagos: []
    };

    return {
        id: mirrorId,
        data: {
            ...payload,
            ...buildSourceMetadata({
                sourceTable: 'creditoproveedor',
                sourceId: credit.cpr_id,
                sourceStatus: credit.status,
                payload,
                syncedAt
            })
        }
    };
});

const buildApPaymentDocs = ({
    abonos = [],
    creditsById = new Map(),
    purchasesById = new Map(),
    suppliersById = new Map(),
    reference,
    syncedAt
}) => {
    const payments = [];
    const paymentDetails = [];

    for (const payment of abonos) {
        const credit = creditsById.get(String(payment.cpr_id)) || null;
        const purchase = credit ? purchasesById.get(String(credit.com_id)) : null;
        const supplier = credit ? suppliersById.get(String(credit.pro_id)) : null;
        const branch = resolveBranch(reference, purchase || credit || payment);
        const paymentId = buildMirrorDocId('abonoproveedor', payment.apr_id);
        const facturaId = payment.cpr_id ? buildMirrorDocId('creditoproveedor', payment.cpr_id) : '';
        const metodoPago = PAYMENT_METHODS[payment.tpa_id] || 'otro';

        const payload = {
            documentoId: paymentId,
            proveedorId: supplier ? buildMirrorDocId('proveedor', supplier.pro_id) : '',
            proveedorNombre: cleanString(supplier?.nombre),
            fecha: toIsoDate(payment.fecha),
            montoTotal: toNumber(payment.total),
            metodoPago,
            referencia: cleanString(payment.comentario) || `APR-${payment.apr_id}`,
            notas: cleanString(payment.comentario),
            estado: Number(payment.status) === -1 ? 'anulado' : 'completado',
            facturasIds: facturaId ? [facturaId] : [],
            cantidadFacturas: facturaId ? 1 : 0,
            aplicaciones: facturaId ? [{
                facturaId,
                montoAplicado: toNumber(payment.total),
                numeroFactura: cleanString(purchase?.serieFolio || purchase?.folio) || `COM-${credit?.com_id || ''}`
            }] : [],
            sucursalId: branch.branchId,
            sucursalName: branch.branchName,
            sourceCajaId: branch.sourceCajaId,
            sourceCajaName: branch.sourceCajaName,
            origenModulo: 'sicarSync'
        };

        payments.push({
            id: paymentId,
            data: {
                ...payload,
                ...buildSourceMetadata({
                    sourceTable: 'abonoproveedor',
                    sourceId: payment.apr_id,
                    sourceStatus: payment.status,
                    payload,
                    syncedAt
                })
            }
        });

        if (facturaId) {
            const detailPayload = {
                abonoId: paymentId,
                facturaId,
                numeroFactura: cleanString(purchase?.serieFolio || purchase?.folio) || `COM-${credit?.com_id || ''}`,
                montoAplicado: toNumber(payment.total),
                fecha: toIsoDate(payment.fecha),
                estado: Number(payment.status) === -1 ? 'anulado' : 'completado',
                origenModulo: 'sicarSync'
            };

            paymentDetails.push({
                id: buildMirrorDocId('abonofacturadetalle', `${payment.apr_id}_${payment.cpr_id}`),
                data: {
                    ...detailPayload,
                    ...buildSourceMetadata({
                        sourceTable: 'abonosfacturadetalle',
                        sourceId: `${payment.apr_id}_${payment.cpr_id}`,
                        sourceStatus: payment.status,
                        payload: detailPayload,
                        syncedAt
                    })
                }
            });
        }
    }

    return {
        payments,
        paymentDetails
    };
};

const buildInventoryDocs = ({ items = [], syncedAt }) => items.map((item) => {
    const mirrorId = buildMirrorDocId('articulo', item.art_id);
    const payload = {
        documentoId: mirrorId,
        sku: cleanString(item.clave),
        skuAlterno: cleanString(item.claveAlterna),
        descripcion: cleanString(item.descripcion),
        localizacion: cleanString(item.localizacion),
        existencia: toNumber(item.existencia),
        disponible: toNumber(item.disponible),
        existenciaAislada: toNumber(item.aislado),
        costoActual: toNumber(item.precioCompra),
        costoPromedio: toNumber(item.preCompraProm),
        pesoBase: toNumber(item.peso),
        unidadCompraId: item.unidadCompra,
        unidadVentaId: item.unidadVenta,
        servicio: Number(item.servicio) === 1,
        activo: Number(item.status) === 1,
        branchScope: 'global',
        origenModulo: 'sicarSync'
    };

    return {
        id: mirrorId,
        data: {
            ...payload,
            ...buildSourceMetadata({
                sourceTable: 'articulo',
                sourceId: item.art_id,
                sourceStatus: item.status,
                payload,
                syncedAt
            })
        }
    };
});

module.exports = {
    PAYMENT_METHODS,
    buildApCreditDocs,
    buildApPaymentDocs,
    buildArCreditDocs,
    buildArPaymentDocs,
    buildCustomerDocs,
    buildExpenseDocs,
    buildFixedOperationProfile,
    buildInventoryDocs,
    buildPaymentSummary,
    buildPurchaseDocs,
    buildSalesDocs,
    buildSupplierDocs,
    createReferenceContext,
    mapCreditState,
    normalizeCurrency,
    resolveBranch
};
