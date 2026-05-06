const {
    buildMirrorDocId,
    cleanString,
    toIsoDate,
    toIsoDateTime,
    toNumber
} = require('./helpers.cjs');
const { PAYMENT_METHODS, mapCreditState } = require('./transformers.cjs');

const getStatusNumeric = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const buildActivePaymentMetrics = (payments = []) => {
    const activePayments = payments
        .filter((item) => getStatusNumeric(item.status) === 1)
        .map((item) => ({
            ...item,
            total: toNumber(item.total)
        }))
        .sort((left, right) => {
            const leftTime = new Date(left.fecha || 0).getTime() || 0;
            const rightTime = new Date(right.fecha || 0).getTime() || 0;
            return leftTime - rightTime;
        });

    const totalAbonado = activePayments.reduce((sum, item) => sum + item.total, 0);
    const lastPayment = activePayments[activePayments.length - 1] || null;

    return {
        totalAbonado,
        paymentCount: activePayments.length,
        lastPayment
    };
};

const enrichArCreditDocs = ({
    docs = [],
    credits = [],
    abonosByCreditId = new Map(),
    customersById = new Map(),
    salesById = new Map()
}) => {
    const creditsById = new Map(credits.map((credit) => [String(credit.ccl_id), credit]));

    return docs.map((doc) => {
        const credit = creditsById.get(String(doc.data.sourceId || doc.data.creditoSicarId || ''));
        if (!credit) return doc;

        const customer = customersById.get(String(credit.cli_id)) || null;
        const sale = salesById.get(String(credit.ven_id)) || null;
        const paymentMetrics = buildActivePaymentMetrics(abonosByCreditId.get(String(credit.ccl_id)) || []);
        const saldoPendiente = Math.max(0, toNumber(credit.total) - paymentMetrics.totalAbonado);
        const statusMirror = mapCreditState(credit.status, saldoPendiente);

        return {
            ...doc,
            data: {
                ...doc.data,
                creditoSicarId: Number(credit.ccl_id),
                ventaSicarId: Number(credit.ven_id),
                clienteSicarId: Number(credit.cli_id),
                clienteComentario: cleanString(customer?.comentario),
                clienteTelefono: cleanString(customer?.celular || customer?.telefono),
                clienteEmail: cleanString(customer?.mail),
                limiteCreditoCliente: toNumber(customer?.limite),
                diasCreditoCliente: toNumber(customer?.diasCredito),
                folioSicar: cleanString(sale?.afFolio),
                fechaVentaHora: toIsoDateTime(sale?.fecha),
                comentarioSicar: cleanString(credit.comentario),
                comentarioVentaSicar: cleanString(sale?.comentario),
                montoAbonado: paymentMetrics.totalAbonado,
                saldoPendiente,
                cantidadAbonos: paymentMetrics.paymentCount,
                ultimoAbonoFecha: paymentMetrics.lastPayment ? toIsoDate(paymentMetrics.lastPayment.fecha) : '',
                ultimoAbonoMonto: paymentMetrics.lastPayment?.total || 0,
                ultimoAbonoMetodo: paymentMetrics.lastPayment
                    ? (PAYMENT_METHODS[paymentMetrics.lastPayment.tpa_id] || 'otro')
                    : '',
                ultimoAbonoMetodoNombre: cleanString(paymentMetrics.lastPayment?.tipo_pago_nombre),
                estado: statusMirror,
                statusSicar: getStatusNumeric(credit.status),
                statusSicarLabel: statusMirror,
                cancelado: getStatusNumeric(credit.status) === -1
            }
        };
    });
};

const enrichArPaymentDocs = ({
    docs = [],
    abonos = [],
    creditsById = new Map(),
    customersById = new Map(),
    salesById = new Map()
}) => {
    const paymentsById = new Map(abonos.map((payment) => [String(payment.acl_id), payment]));

    return docs.map((doc) => {
        const payment = paymentsById.get(String(doc.data.sourceId || doc.data.abonoSicarId || ''));
        if (!payment) return doc;

        const credit = creditsById.get(String(payment.ccl_id)) || null;
        const customer = credit ? customersById.get(String(credit.cli_id)) : null;
        const sale = credit ? salesById.get(String(credit.ven_id)) : null;

        return {
            ...doc,
            data: {
                ...doc.data,
                abonoSicarId: Number(payment.acl_id),
                creditoSicarId: Number(payment.ccl_id),
                ventaSicarId: Number(credit?.ven_id || 0),
                clienteSicarId: Number(credit?.cli_id || 0),
                clienteCodigo: cleanString(customer?.clave) || (credit ? `CLI-${credit.cli_id}` : ''),
                numeroDocumento: sale?.afFolio ? cleanString(sale.afFolio) : (credit ? `VTA-${credit.ven_id}` : ''),
                metodoPagoSicarId: Number(payment.tpa_id),
                metodoPagoSicarNombre: cleanString(payment.tipo_pago_nombre),
                comentarioSicar: cleanString(payment.comentario),
                statusSicar: getStatusNumeric(payment.status)
            }
        };
    });
};

module.exports = {
    enrichArCreditDocs,
    enrichArPaymentDocs
};
