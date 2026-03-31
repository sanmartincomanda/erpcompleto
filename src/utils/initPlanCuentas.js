// Script de inicialización del Plan de Cuentas DGI Nicaragua
import { db } from '../firebase';
import { collection, getDocs, addDoc, doc, setDoc, query, where } from 'firebase/firestore';

// Plan de Cuentas DGI Nicaragua Completo
export const PLAN_CUENTAS_DGI_NICARAGUA = [
    // ==================== CLASE 1: ACTIVOS ====================
    // GRUPO 11: ACTIVOS CORRIENTES
    { code: '1101', name: 'CAJA Y BANCOS', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '110101', name: 'Caja General', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'caja', currency: 'NIO' },
    { code: '110102', name: 'Caja Chica', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'caja', currency: 'NIO' },
    { code: '110103', name: 'Bancos - Cuentas Corrientes', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '11010301', name: 'Banco BAC - Cuenta Corriente C$', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'NIO' },
    { code: '11010302', name: 'Banco BAC - Cuenta Corriente USD', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'USD' },
    { code: '11010303', name: 'Banco BANPRO - Cuenta Corriente C$', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'NIO' },
    { code: '11010304', name: 'Banco BANPRO - Cuenta Corriente USD', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'USD' },
    { code: '11010305', name: 'Banco LAFISE - Cuenta Corriente C$', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'NIO' },
    { code: '11010306', name: 'Banco LAFISE - Cuenta Corriente USD', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'banco', currency: 'USD' },
    { code: '110104', name: 'Dinero en Tránsito', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'transito' },
    
    { code: '1102', name: 'INVERSIONES TEMPORALES', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '110201', name: 'Depósitos a Plazo', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110202', name: 'Inversiones en Valores', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    
    { code: '1103', name: 'CUENTAS Y DOCUMENTOS POR COBRAR', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '110301', name: 'Clientes - Cuentas por Cobrar', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'clientes' },
    { code: '110302', name: 'Documentos por Cobrar', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110303', name: 'Deudores Varios', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110304', name: 'Préstamos al Personal', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110305', name: 'Anticipo a Proveedores', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110399', name: 'Provisión para Cuentas Incobrables', type: 'ACTIVO', isGroup: false, nature: 'ACREEDORA' },
    
    { code: '1104', name: 'INVENTARIOS', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '110401', name: 'Inventario de Mercadería', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'inventario' },
    { code: '110402', name: 'Inventario de Materia Prima', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'inventario' },
    { code: '110403', name: 'Inventario de Productos en Proceso', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'inventario' },
    { code: '110404', name: 'Inventario de Productos Terminados', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'inventario' },
    { code: '110405', name: 'Inventario de Suministros', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'inventario' },
    
    { code: '1105', name: 'PAGOS ANTICIPADOS', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '110501', name: 'Alquileres Pagados por Anticipado', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110502', name: 'Seguros Pagados por Anticipado', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110503', name: 'Publicidad Pagada por Anticipado', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110504', name: 'Otros Gastos Pagados por Anticipado', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110505', name: 'Impuestos sobre la Renta Anticipado', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '110506', name: 'IVA Crédito Fiscal', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    
    // GRUPO 12: ACTIVOS NO CORRIENTES
    { code: '1201', name: 'PROPIEDAD, PLANTA Y EQUIPO', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '120101', name: 'Terrenos', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120102', name: 'Edificios', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120103', name: 'Mobiliario y Equipo de Oficina', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120104', name: 'Equipo de Computación', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120105', name: 'Equipo de Transporte', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120106', name: 'Maquinaria y Equipo', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120107', name: 'Herramientas', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA', subType: 'activo_fijo' },
    { code: '120199', name: 'Depreciación Acumulada - Propiedad, Planta y Equipo', type: 'ACTIVO', isGroup: false, nature: 'ACREEDORA' },
    
    { code: '1202', name: 'ACTIVOS INTANGIBLES', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '120201', name: 'Marcas y Patentes', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '120202', name: 'Derechos de Autor', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '120203', name: 'Software', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '120299', name: 'Amortización Acumulada - Intangibles', type: 'ACTIVO', isGroup: false, nature: 'ACREEDORA' },
    
    { code: '1203', name: 'ACTIVOS DIFERIDOS', type: 'ACTIVO', isGroup: true, nature: 'DEUDORA' },
    { code: '120301', name: 'Gastos de Constitución', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    { code: '120302', name: 'Gastos de Organización', type: 'ACTIVO', isGroup: false, nature: 'DEUDORA' },
    
    // ==================== CLASE 2: PASIVOS ====================
    // GRUPO 21: PASIVOS CORRIENTES
    { code: '2101', name: 'CUENTAS Y DOCUMENTOS POR PAGAR', type: 'PASIVO', isGroup: true, nature: 'ACREEDORA' },
    { code: '210101', name: 'Proveedores - Cuentas por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA', subType: 'proveedores' },
    { code: '210102', name: 'Documentos por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210103', name: 'Acreedores Varios', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210104', name: 'Anticipos de Clientes', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    
    { code: '2102', name: 'OBLIGACIONES CON INSTITUCIONES', type: 'PASIVO', isGroup: true, nature: 'ACREEDORA' },
    { code: '210201', name: 'Préstamos Bancarios Corto Plazo', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210202', name: 'Obligaciones con el INSS', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210203', name: 'Obligaciones con el INATEC', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210204', name: 'Obligaciones Laborales', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    
    { code: '2103', name: 'IMPUESTOS POR PAGAR', type: 'PASIVO', isGroup: true, nature: 'ACREEDORA' },
    { code: '210301', name: 'IVA por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210302', name: 'IR por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210303', name: 'Alcaldía por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '210304', name: 'Retenciones por Pagar', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    
    // GRUPO 22: PASIVOS NO CORRIENTES
    { code: '2201', name: 'PASIVOS A LARGO PLAZO', type: 'PASIVO', isGroup: true, nature: 'ACREEDORA' },
    { code: '220101', name: 'Préstamos Bancarios Largo Plazo', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    { code: '220102', name: 'Obligaciones con Partes Relacionadas', type: 'PASIVO', isGroup: false, nature: 'ACREEDORA' },
    
    // ==================== CLASE 3: PATRIMONIO ====================
    { code: '3101', name: 'CAPITAL SOCIAL', type: 'CAPITAL', isGroup: true, nature: 'ACREEDORA' },
    { code: '310101', name: 'Capital Social Autorizado', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    { code: '310102', name: 'Capital Social Suscrito', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    { code: '310103', name: 'Capital Social Pagado', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    
    { code: '3102', name: 'RESERVAS', type: 'CAPITAL', isGroup: true, nature: 'ACREEDORA' },
    { code: '310201', name: 'Reserva Legal', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    { code: '310202', name: 'Reserva Facultativa', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    { code: '310203', name: 'Reserva de Capital', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    
    { code: '3103', name: 'RESULTADOS ACUMULADOS', type: 'CAPITAL', isGroup: true, nature: 'ACREEDORA' },
    { code: '310301', name: 'Utilidades Retenidas', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    { code: '310302', name: 'Pérdidas Acumuladas', type: 'CAPITAL', isGroup: false, nature: 'DEUDORA', subType: 'patrimonio' },
    { code: '310303', name: 'Resultado del Ejercicio', type: 'CAPITAL', isGroup: false, nature: 'ACREEDORA', subType: 'patrimonio' },
    
    // ==================== CLASE 4: INGRESOS ====================
    { code: '4101', name: 'VENTAS', type: 'INGRESO', isGroup: true, nature: 'ACREEDORA' },
    { code: '410101', name: 'Ventas de Mercadería', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410102', name: 'Ventas de Productos Terminados', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410103', name: 'Ventas de Servicios', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410104', name: 'Ventas al por Mayor', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410105', name: 'Ventas al por Menor', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410199', name: 'Devoluciones sobre Ventas', type: 'INGRESO', isGroup: false, nature: 'DEUDORA' },
    
    { code: '4102', name: 'OTROS INGRESOS', type: 'INGRESO', isGroup: true, nature: 'ACREEDORA' },
    { code: '410201', name: 'Ingresos por Arrendamiento', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410202', name: 'Ingresos por Comisiones', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410203', name: 'Ingresos Financieros', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410204', name: 'Utilidad en Venta de Activos', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    { code: '410205', name: 'Otros Ingresos Diversos', type: 'INGRESO', isGroup: false, nature: 'ACREEDORA' },
    
    // ==================== CLASE 5: COSTOS ====================
    { code: '5101', name: 'COSTO DE VENTAS', type: 'COSTO', isGroup: true, nature: 'DEUDORA' },
    { code: '510101', name: 'Costo de Mercadería Vendida', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    { code: '510102', name: 'Costo de Productos Terminados Vendidos', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    { code: '510103', name: 'Costo de Servicios Prestados', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    
    { code: '5102', name: 'COSTOS DE PRODUCCIÓN', type: 'COSTO', isGroup: true, nature: 'DEUDORA' },
    { code: '510201', name: 'Materia Prima Directa', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    { code: '510202', name: 'Mano de Obra Directa', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    { code: '510203', name: 'Costos Indirectos de Fabricación', type: 'COSTO', isGroup: false, nature: 'DEUDORA' },
    
    // ==================== CLASE 6: GASTOS ====================
    { code: '6101', name: 'GASTOS DE ADMINISTRACIÓN', type: 'GASTO', isGroup: true, nature: 'DEUDORA' },
    { code: '610101', name: 'Sueldos y Salarios - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610102', name: 'Aguinaldos - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610103', name: 'Vacaciones - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610104', name: 'INSS Patronal - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610105', name: 'INATEC - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610106', name: 'Alquileres - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610107', name: 'Servicios Públicos - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610108', name: 'Teléfono e Internet - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610109', name: 'Papelería y Útiles - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610110', name: 'Seguros - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610111', name: 'Mantenimiento - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610112', name: 'Depreciación - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610113', name: 'Honorarios Profesionales', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610114', name: 'Gastos de Viaje - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610115', name: 'Capacitación - Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610116', name: 'Gastos Legales', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610117', name: 'Gastos Financieros - Bancarios', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610118', name: 'Gastos Financieros - Intereses', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610199', name: 'Otros Gastos de Administración', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    
    { code: '6102', name: 'GASTOS DE VENTAS', type: 'GASTO', isGroup: true, nature: 'DEUDORA' },
    { code: '610201', name: 'Sueldos y Salarios - Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610202', name: 'Comisiones - Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610203', name: 'Publicidad y Propaganda', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610204', name: 'Promoción de Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610205', name: 'Transporte - Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610206', name: 'Embalaje - Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610207', name: 'Muestras Gratis', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610299', name: 'Otros Gastos de Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    
    { code: '6103', name: 'GASTOS DIVERSOS', type: 'GASTO', isGroup: true, nature: 'DEUDORA' },
    { code: '610301', name: 'Pérdida en Venta de Activos', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610302', name: 'Gastos Extraordinarios', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610303', name: 'Impuesto sobre la Renta', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610304', name: 'Alcaldía - 1% sobre Ventas', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
    { code: '610399', name: 'Otros Gastos Diversos', type: 'GASTO', isGroup: false, nature: 'DEUDORA' },
];

// Función para inicializar el plan de cuentas con manejo de errores detallado
export const initPlanCuentasDGI = async () => {
    const results = {
        success: false,
        message: '',
        count: 0,
        errors: [],
        details: []
    };

    try {
        console.log('=== INICIANDO CARGA DEL PLAN DE CUENTAS DGI ===');
        console.log(`Total de cuentas a cargar: ${PLAN_CUENTAS_DGI_NICARAGUA.length}`);

        // Verificar conexión a Firebase
        let existingCount = 0;
        try {
            const cuentasRef = collection(db, 'planCuentas');
            const snapshot = await getDocs(cuentasRef);
            existingCount = snapshot.size;
            console.log(`Cuentas existentes en Firebase: ${existingCount}`);
        } catch (connErr) {
            console.error('Error de conexión a Firebase:', connErr);
            results.errors.push(`Error de conexión: ${connErr.message}`);
            results.message = 'No se pudo conectar a Firebase. Verifique su conexión a internet.';
            return results;
        }

        if (existingCount > 0) {
            console.log('Plan de cuentas ya existe, omitiendo...');
            results.success = true;
            results.message = `Plan de cuentas ya existe con ${existingCount} cuentas`;
            results.count = existingCount;
            results.alreadyExists = true;
            return results;
        }

        // Crear cuentas una por una
        let createdCount = 0;
        for (let i = 0; i < PLAN_CUENTAS_DGI_NICARAGUA.length; i++) {
            const cuenta = PLAN_CUENTAS_DGI_NICARAGUA[i];
            try {
                const docRef = await addDoc(collection(db, 'planCuentas'), {
                    ...cuenta,
                    balance: 0,
                    balanceUSD: 0,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                createdCount++;
                results.details.push({ 
                    code: cuenta.code, 
                    name: cuenta.name, 
                    status: 'ok',
                    id: docRef.id
                });
                
                if ((i + 1) % 20 === 0) {
                    console.log(`Progreso: ${i + 1}/${PLAN_CUENTAS_DGI_NICARAGUA.length}`);
                }
            } catch (err) {
                console.error(`Error creando cuenta ${cuenta.code}:`, err);
                results.errors.push({ 
                    code: cuenta.code, 
                    name: cuenta.name, 
                    error: err.message 
                });
                results.details.push({ 
                    code: cuenta.code, 
                    name: cuenta.name, 
                    status: 'error',
                    error: err.message
                });
            }
        }

        results.count = createdCount;
        results.success = createdCount > 0;
        results.message = `Plan DGI cargado: ${createdCount} de ${PLAN_CUENTAS_DGI_NICARAGUA.length} cuentas`;

        // Crear configuración inicial
        if (createdCount > 0) {
            try {
                await setDoc(doc(db, 'configuracion', 'cuentas'), {
                    cajaEfectivoNIO: '',
                    cajaEfectivoUSD: '',
                    bancoBAC: '',
                    bancoBANPRO: '',
                    bancoLAFISE: '',
                    transferenciaBAC: '',
                    transferenciaBANPRO: '',
                    transferenciaLAFISE: '',
                    transferenciaBAC_USD: '',
                    transferenciaLAFISE_USD: '',
                    posBAC: '',
                    posBANPRO: '',
                    posLAFISE: '',
                    proveedores: '',
                    dineroTransitoNIO: '',
                    dineroTransitoUSD: '',
                    updatedAt: new Date()
                });
                console.log('Configuración inicial creada');
            } catch (cfgErr) {
                console.error('Error creando configuración:', cfgErr);
                results.errors.push(`Configuración: ${cfgErr.message}`);
            }

            try {
                await setDoc(doc(db, 'configuracion', 'tasaCambio'), {
                    compra: 36.50,
                    venta: 36.80,
                    fecha: new Date().toISOString().split('T')[0],
                    updatedAt: new Date()
                });
                console.log('Tasa de cambio inicial creada');
            } catch (tasaErr) {
                console.error('Error creando tasa de cambio:', tasaErr);
            }
        }

        console.log('=== CARGA COMPLETADA ===');
        return results;

    } catch (error) {
        console.error('Error general:', error);
        results.success = false;
        results.message = `Error general: ${error.message}`;
        results.errors.push(error.message);
        return results;
    }
};

// Función para verificar si el plan existe
export const checkPlanCuentasExists = async () => {
    try {
        const cuentasRef = collection(db, 'planCuentas');
        const snapshot = await getDocs(cuentasRef);
        return {
            exists: !snapshot.empty,
            count: snapshot.size
        };
    } catch (error) {
        console.error('Error verificando plan:', error);
        return { exists: false, count: 0, error: error.message };
    }
};

export default initPlanCuentasDGI;
