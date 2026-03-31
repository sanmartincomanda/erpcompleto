// src/tests/accounting.test.js
// Tests unitarios para funciones contables

// ============================================
// TESTS: Funciones de detección de cuentas
// ============================================

// Mock de isCajaAccount
const isCajaAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    const nameLower = (account.name || '').toLowerCase();
    
    if (nameLower.includes('transito') || nameLower.includes('tránsito')) {
        return false;
    }
    
    if (account.code) {
        const code = account.code.replace(/\./g, '');
        if (code === '110104' || code.startsWith('110104')) {
            return false;
        }
        if (code === '110101' || code === '110102') return true;
        if (code.startsWith('110101') || code.startsWith('110102')) return true;
    }
    
    if (account.subType === 'caja') {
        return true;
    }
    
    if ((nameLower.includes('caja') || nameLower.includes('cajas')) && 
        !nameLower.includes('transito') && 
        !nameLower.includes('tránsito') &&
        !nameLower.includes('diferencia')) {
        return true;
    }
    
    return false;
};

// Mock de isTransitoAccount
const isTransitoAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    if (account.subType === 'transito') return true;
    
    if (account.code && account.code.startsWith('110104')) return true;
    
    if (account.name) {
        const nameLower = account.name.toLowerCase();
        if (nameLower.includes('transito') || nameLower.includes('tránsito')) return true;
    }
    
    return false;
};

// Mock de isBancoAccount
const isBancoAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    if (account.subType === 'banco') return true;
    
    if (account.code && (
        account.code.startsWith('110103') ||
        account.code.startsWith('1102')
    )) return true;
    
    if (account.name) {
        const nameLower = account.name.toLowerCase();
        if (nameLower.includes('banco') || 
            nameLower.includes('bac') || 
            nameLower.includes('banpro') || 
            nameLower.includes('lafise') ||
            nameLower.includes('bancario') ||
            nameLower.includes('cuenta corriente')) return true;
    }
    
    return false;
};

// ============================================
// TESTS: Partida doble
// ============================================

const validarPartidaDoble = (movimientos) => {
    const totalDebitos = movimientos
        .filter(m => m.tipo === 'DEBITO')
        .reduce((sum, m) => sum + Number(m.monto || 0), 0);
    
    const totalCreditos = movimientos
        .filter(m => m.tipo === 'CREDITO')
        .reduce((sum, m) => sum + Number(m.monto || 0), 0);
    
    return {
        cuadrado: Math.abs(totalDebitos - totalCreditos) <= 0.01,
        totalDebitos,
        totalCreditos,
        diferencia: Math.abs(totalDebitos - totalCreditos)
    };
};

// ============================================
// SUITE DE TESTS
// ============================================

const runTests = () => {
    const results = {
        passed: 0,
        failed: 0,
        tests: []
    };

    const test = (name, fn) => {
        try {
            fn();
            results.passed++;
            results.tests.push({ name, status: 'PASSED' });
            console.log(`✅ ${name}`);
        } catch (err) {
            results.failed++;
            results.tests.push({ name, status: 'FAILED', error: err.message });
            console.error(`❌ ${name}: ${err.message}`);
        }
    };

    const assert = (condition, message) => {
        if (!condition) throw new Error(message || 'Assertion failed');
    };

    const assertEqual = (actual, expected, message) => {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, got ${actual}`);
        }
    };

    // ============================================
    // TESTS: isCajaAccount
    // ============================================
    
    test('isCajaAccount: debe aceptar Caja General (110101)', () => {
        const cuenta = { code: '110101', name: 'Caja General', isGroup: false };
        assert(isCajaAccount(cuenta), 'Debe ser cuenta de caja');
    });

    test('isCajaAccount: debe aceptar Caja Chica (110102)', () => {
        const cuenta = { code: '110102', name: 'Caja Chica', isGroup: false };
        assert(isCajaAccount(cuenta), 'Debe ser cuenta de caja');
    });

    test('isCajaAccount: NO debe aceptar Dinero en Tránsito (110104)', () => {
        const cuenta = { code: '110104', name: 'Dinero en Tránsito', isGroup: false };
        assert(!isCajaAccount(cuenta), 'NO debe ser cuenta de caja');
    });

    test('isCajaAccount: NO debe aceptar cuentas de grupo', () => {
        const cuenta = { code: '1101', name: 'CAJA Y BANCOS', isGroup: true };
        assert(!isCajaAccount(cuenta), 'Grupos no deben ser cuentas de caja');
    });

    test('isCajaAccount: debe aceptar por subType caja', () => {
        const cuenta = { code: '11010101', name: 'Caja Sucursal', isGroup: false, subType: 'caja' };
        assert(isCajaAccount(cuenta), 'Debe ser cuenta de caja por subType');
    });

    // ============================================
    // TESTS: isTransitoAccount
    // ============================================
    
    test('isTransitoAccount: debe aceptar Dinero en Tránsito (110104)', () => {
        const cuenta = { code: '110104', name: 'Dinero en Tránsito', isGroup: false };
        assert(isTransitoAccount(cuenta), 'Debe ser cuenta de tránsito');
    });

    test('isTransitoAccount: debe aceptar por subType transito', () => {
        const cuenta = { code: '11010401', name: 'Tránsito BAC', isGroup: false, subType: 'transito' };
        assert(isTransitoAccount(cuenta), 'Debe ser cuenta de tránsito por subType');
    });

    test('isTransitoAccount: NO debe aceptar Caja General', () => {
        const cuenta = { code: '110101', name: 'Caja General', isGroup: false };
        assert(!isTransitoAccount(cuenta), 'NO debe ser cuenta de tránsito');
    });

    // ============================================
    // TESTS: isBancoAccount
    // ============================================
    
    test('isBancoAccount: debe aceptar Banco BAC (11010301)', () => {
        const cuenta = { code: '11010301', name: 'Banco BAC C$', isGroup: false };
        assert(isBancoAccount(cuenta), 'Debe ser cuenta bancaria');
    });

    test('isBancoAccount: debe aceptar por nombre BAC', () => {
        const cuenta = { code: '110103', name: 'Cuenta BAC', isGroup: false };
        assert(isBancoAccount(cuenta), 'Debe ser cuenta bancaria por nombre');
    });

    test('isBancoAccount: NO debe aceptar Caja General', () => {
        const cuenta = { code: '110101', name: 'Caja General', isGroup: false };
        assert(!isBancoAccount(cuenta), 'NO debe ser cuenta bancaria');
    });

    // ============================================
    // TESTS: Partida doble
    // ============================================
    
    test('validarPartidaDoble: debe validar asiento cuadrado', () => {
        const movimientos = [
            { tipo: 'DEBITO', monto: 1000 },
            { tipo: 'CREDITO', monto: 1000 }
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Asiento debe estar cuadrado');
        assertEqual(resultado.diferencia, 0, 'Diferencia debe ser 0');
    });

    test('validarPartidaDoble: debe detectar asiento descuadrado', () => {
        const movimientos = [
            { tipo: 'DEBITO', monto: 1000 },
            { tipo: 'CREDITO', monto: 900 }
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(!resultado.cuadrado, 'Asiento NO debe estar cuadrado');
        assertEqual(resultado.diferencia, 100, 'Diferencia debe ser 100');
    });

    test('validarPartidaDoble: debe manejar múltiples movimientos', () => {
        const movimientos = [
            { tipo: 'DEBITO', monto: 500 },
            { tipo: 'DEBITO', monto: 500 },
            { tipo: 'CREDITO', monto: 1000 }
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Asiento debe estar cuadrado');
        assertEqual(resultado.totalDebitos, 1000, 'Total débitos debe ser 1000');
        assertEqual(resultado.totalCreditos, 1000, 'Total créditos debe ser 1000');
    });

    test('validarPartidaDoble: debe aceptar diferencia menor a 0.01', () => {
        const movimientos = [
            { tipo: 'DEBITO', monto: 1000.005 },
            { tipo: 'CREDITO', monto: 1000 }
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Asiento debe estar cuadrado (tolerancia)');
    });

    // ============================================
    // TESTS: Flujos completos
    // ============================================
    
    test('Flujo: Depósito en tránsito', () => {
        // Caja a Tránsito
        const movimientos = [
            { tipo: 'DEBITO', monto: 76094, cuentaCode: '110104' }, // Tránsito
            { tipo: 'CREDITO', monto: 76094, cuentaCode: '110101' }  // Caja
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Depósito en tránsito debe estar cuadrado');
    });

    test('Flujo: Confirmación de depósito', () => {
        // Tránsito a Banco
        const movimientos = [
            { tipo: 'DEBITO', monto: 76094, cuentaCode: '11010301' }, // Banco
            { tipo: 'CREDITO', monto: 76094, cuentaCode: '110104' }   // Tránsito
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Confirmación debe estar cuadrada');
    });

    test('Flujo: Factura de proveedor', () => {
        // Gasto a Proveedores
        const movimientos = [
            { tipo: 'DEBITO', monto: 25000, cuentaCode: '610109' },  // Gasto
            { tipo: 'CREDITO', monto: 25000, cuentaCode: '210101' }  // Proveedores
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Factura debe estar cuadrada');
    });

    test('Flujo: Pago a proveedor', () => {
        // Proveedores a Banco
        const movimientos = [
            { tipo: 'DEBITO', monto: 25000, cuentaCode: '210101' },  // Proveedores
            { tipo: 'CREDITO', monto: 25000, cuentaCode: '11010301' } // Banco
        ];
        const resultado = validarPartidaDoble(movimientos);
        assert(resultado.cuadrado, 'Pago debe estar cuadrado');
    });

    // ============================================
    // RESUMEN
    // ============================================
    
    console.log('\n' + '='.repeat(50));
    console.log(`RESULTADOS: ${results.passed} passed, ${results.failed} failed`);
    console.log('='.repeat(50) + '\n');

    return results;
};

// Exportar para uso en la aplicación
export { isCajaAccount, isTransitoAccount, isBancoAccount, validarPartidaDoble, runTests };

// Auto-ejecutar si se importa directamente
if (typeof window !== 'undefined') {
    window.runAccountingTests = runTests;
}

export default runTests;
