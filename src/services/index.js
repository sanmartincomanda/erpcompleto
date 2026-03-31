// src/services/index.js
// Exportación centralizada de servicios

export {
    DOCUMENT_TYPES,
    registerAccountingEntry,
    createCierreCajaERP,
    updateCierreCajaERPStatus,
    procesarCierreCajaERP,
    createDepositoTransitoERP,
    confirmarDepositoBancarioERP,
    createFacturaProveedor,
    registrarPagoProveedor,
    createAjusteManual,
    aprobarAjusteManual,
    rechazarAjusteManual,
    resetERPDatabase
} from './unifiedAccountingService';
