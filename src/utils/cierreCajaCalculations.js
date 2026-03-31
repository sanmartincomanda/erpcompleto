const DEFAULT_TIPO_CAMBIO = 36.5;

export const toNumber = (value) => Number(value) || 0;

export const getTipoCambio = (value) => {
    const parsed = toNumber(value);
    return parsed > 0 ? parsed : DEFAULT_TIPO_CAMBIO;
};

const sumRetenciones = (retenciones = []) =>
    retenciones.reduce((sum, item) => sum + toNumber(item?.monto), 0);

const sumGastosCaja = (gastosCaja = []) =>
    gastosCaja.reduce((sum, item) => sum + toNumber(item?.monto), 0);

export const calculateCierreCajaTotals = (data = {}) => {
    const tipoCambio = getTipoCambio(data.tipoCambio);
    const efectivoCS = toNumber(data.efectivoCS);
    const efectivoUSD = toNumber(data.efectivoUSD);

    const totalEfectivo = efectivoCS + (efectivoUSD * tipoCambio);
    const totalPOS =
        toNumber(data.posBAC) +
        toNumber(data.posBANPRO) +
        toNumber(data.posLAFISE);

    const totalTransferenciasNIO =
        toNumber(data.transferenciaBAC) +
        toNumber(data.transferenciaBANPRO) +
        toNumber(data.transferenciaLAFISE);

    const totalTransferenciasUSD =
        toNumber(data.transferenciaBAC_USD) +
        toNumber(data.transferenciaLAFISE_USD);

    const totalTransferencias =
        totalTransferenciasNIO + (totalTransferenciasUSD * tipoCambio);

    const totalFacturasCredito = toNumber(data.totalFacturasCredito);
    const totalAbonosRecibidos = toNumber(data.totalAbonosRecibidos);
    const totalRetenciones =
        data.totalRetenciones !== undefined
            ? toNumber(data.totalRetenciones)
            : sumRetenciones(data.retenciones);
    const totalGastosCaja =
        data.totalGastosCaja !== undefined
            ? toNumber(data.totalGastosCaja)
            : sumGastosCaja(data.gastosCaja);

    const totalMediosPago = totalEfectivo + totalPOS + totalTransferencias;
    const totalIngresoRegistrado = toNumber(data.totalIngreso);
    const totalVentasDelDia = totalIngresoRegistrado - totalAbonosRecibidos;
    const totalEsperado =
        totalMediosPago +
        totalRetenciones +
        totalGastosCaja;
    const diferencia = totalIngresoRegistrado - totalEsperado;

    return {
        tipoCambio,
        efectivoCS,
        efectivoUSD,
        totalEfectivo,
        totalPOS,
        totalTransferenciasNIO,
        totalTransferenciasUSD,
        totalTransferencias,
        totalFacturasCredito,
        totalAbonosRecibidos,
        totalVentasDelDia,
        totalRetenciones,
        totalGastosCaja,
        totalMediosPago,
        totalIngresoRegistrado,
        totalEsperado,
        diferencia,
        estaCuadrado: Math.abs(diferencia) < 0.01
    };
};

export const calculateArqueoTotals = (data = {}) => {
    const tipoCambio = getTipoCambio(data.tipoCambio);
    const arqueo = data.arqueo || {};

    const totalArqueoCS =
        (toNumber(arqueo.billetes100) * 100) +
        (toNumber(arqueo.billetes50) * 50) +
        (toNumber(arqueo.billetes20) * 20) +
        (toNumber(arqueo.billetes10) * 10) +
        (toNumber(arqueo.billetes5) * 5) +
        (toNumber(arqueo.billetes1) * 1) +
        toNumber(arqueo.monedas);

    const efectivoUSDFisico = toNumber(
        arqueo.efectivoUSDFisico ?? arqueo.usdFisico
    );
    const totalArqueo = totalArqueoCS + (efectivoUSDFisico * tipoCambio);

    const cierreTotals = calculateCierreCajaTotals(data);
    const diferenciaCaja = totalArqueo - cierreTotals.totalEfectivo;

    return {
        totalArqueoCS,
        efectivoUSDFisico,
        totalArqueo,
        diferenciaCaja
    };
};
