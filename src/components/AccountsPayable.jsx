// src/components/AccountsPayable.jsx
// Módulo de Cuentas por Pagar - INTEGRADO CON CONTABILIDAD

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { 
    collection, query, where, orderBy, onSnapshot, 
    addDoc, updateDoc, deleteDoc, doc, Timestamp, getDocs
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { registerAccountingEntry } from '../services/unifiedAccountingService';
import { 
    Building2, Plus, Trash2, Save, X, Search, 
    DollarSign, Calendar, CheckCircle, 
    AlertCircle, RefreshCw, FileText, CheckSquare, Square, Filter,
    TrendingDown, Landmark
} from 'lucide-react';

const AccountsPayable = () => {
    const { user } = useAuth();
    const { branches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );
    
    const [proveedores, setProveedores] = useState([]);
    const [facturas, setFacturas] = useState([]);
    const [abonos, setAbonos] = useState([]);
    const [cuentasGasto, setCuentasGasto] = useState([]);
    const [cuentasCaja, setCuentasCaja] = useState([]);
    const [cuentasBanco, setCuentasBanco] = useState([]);
    const [cuentaProveedor, setCuentaProveedor] = useState(null);
    const [loading, setLoading] = useState(true);
    
    const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('');
    
    const [showFacturaModal, setShowFacturaModal] = useState(false);
    const [showAbonoModal, setShowAbonoModal] = useState(false);
    const [showAbonosListModal, setShowAbonosListModal] = useState(false);
    const [facturaSeleccionadaParaAbonos, setFacturaSeleccionadaParaAbonos] = useState(null);
    
    const [facturasSeleccionadas, setFacturasSeleccionadas] = useState([]);
    const [seleccionarTodas, setSeleccionarTodas] = useState(false);
    
    const [facturaForm, setFacturaForm] = useState({
        proveedorId: '',
        sucursalId: '',
        sucursalName: '',
        numeroFactura: '',
        fechaEmision: new Date().toISOString().split('T')[0],
        fechaVencimiento: '',
        monto: '',
        descripcion: '',
        cuentaGastoId: '',
        cuentaGastoCode: '',
        cuentaGastoName: ''
    });
    
    const [abonoForm, setAbonoForm] = useState({
        fecha: new Date().toISOString().split('T')[0],
        sucursalId: '',
        sucursalName: '',
        montoTotal: 0,
        metodoPago: 'transferencia',
        cuentaOrigenId: '',
        cuentaOrigenCode: '',
        cuentaOrigenName: '',
        referencia: '',
        notas: ''
    });
    
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Cargar datos
    useEffect(() => {
        setLoading(true);
        
        // Proveedores
        const unsubProv = onSnapshot(
            query(collection(db, 'proveedores'), orderBy('nombre')),
            (snap) => {
                setProveedores(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.activo !== false));
            }
        );
        
        // Facturas
        const unsubFact = onSnapshot(
            query(collection(db, 'facturasProveedor'), orderBy('fechaEmision', 'desc')),
            (snap) => {
                setFacturas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            }
        );
        
        // Abonos
        const unsubAbonos = onSnapshot(
            query(collection(db, 'abonosProveedor'), orderBy('fecha', 'desc')),
            (snap) => setAbonos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );
        
        // Cuentas del plan de cuentas
        getDocs(query(collection(db, 'planCuentas'), orderBy('code'))).then(snap => {
            const cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setCuentasGasto(cuentas.filter(c => {
                const code = (c.code || '').replace(/\./g, '');
                return (code.startsWith('61') || code.startsWith('51')) && !c.isGroup;
            }));
            setCuentasCaja(cuentas.filter(c => {
                const code = (c.code || '').replace(/\./g, '');
                return code === '110101' || code === '110102';
            }));
            setCuentasBanco(cuentas.filter(c => {
                const code = (c.code || '').replace(/\./g, '');
                return code.startsWith('110103');
            }));
            setCuentaProveedor(
                cuentas.find(c => {
                    const code = (c.code || '').replace(/\./g, '');
                    return code === '210101' || (
                        c.type === 'PASIVO' &&
                        c.name?.toLowerCase().includes('proveedor')
                    );
                }) || null
            );
        });
        
        return () => { unsubProv(); unsubFact(); unsubAbonos(); };
    }, []);

    const facturasFiltradas = useMemo(() => {
        let f = facturas;
        if (proveedorSeleccionado) f = f.filter(x => x.proveedorId === proveedorSeleccionado);
        if (searchTerm) f = f.filter(x => x.numeroFactura?.toLowerCase().includes(searchTerm.toLowerCase()));
        if (filtroEstado) f = f.filter(x => x.estado === filtroEstado);
        return f;
    }, [facturas, proveedorSeleccionado, searchTerm, filtroEstado]);

    const getTotalesProveedor = (pid) => {
        const fp = facturas.filter(f => f.proveedorId === pid);
        const pagosProveedor = abonos.filter(a => a.proveedorId === pid && a.estado !== 'anulado');
        const tf = fp.reduce((s, f) => s + Number(f.monto || 0), 0);
        const ta = fp.reduce((s, f) => s + Number(f.montoAbonado || 0), 0);
        const tp = pagosProveedor.reduce((s, a) => s + Number(a.montoTotal || 0), 0);
        return {
            totalFacturas: tf,
            totalAbonado: ta,
            totalPagos: tp,
            saldoPendiente: tf - ta,
            cantidadFacturas: fp.length
        };
    };

    const proveedorActual = useMemo(() => proveedores.find(p => p.id === proveedorSeleccionado), [proveedores, proveedorSeleccionado]);

    const toggleSeleccionFactura = (fid) => {
        setFacturasSeleccionadas(prev => prev.includes(fid) ? prev.filter(id => id !== fid) : [...prev, fid]);
    };

    const toggleSeleccionarTodas = () => {
        if (seleccionarTodas) {
            setFacturasSeleccionadas([]);
        } else {
            setFacturasSeleccionadas(facturasFiltradas.filter(f => f.estado !== 'pagada').map(f => f.id));
        }
        setSeleccionarTodas(!seleccionarTodas);
    };

    const facturasSeleccionadasOrdenadas = useMemo(() => {
        const facturasMap = new Map(facturas.map((factura) => [factura.id, factura]));

        return facturasSeleccionadas
            .map((facturaId) => facturasMap.get(facturaId))
            .filter(Boolean);
    }, [facturas, facturasSeleccionadas]);

    const totalAPagar = useMemo(() => {
        return facturasSeleccionadasOrdenadas
            .reduce((sum, factura) => sum + Number(factura.saldoPendiente || factura.monto || 0), 0);
    }, [facturasSeleccionadasOrdenadas]);

    const ordenSeleccionMap = useMemo(
        () => new Map(facturasSeleccionadas.map((facturaId, index) => [facturaId, index + 1])),
        [facturasSeleccionadas]
    );

    const previewAplicacionAbono = useMemo(() => {
        let montoRestante = Number(abonoForm.montoTotal || 0);

        return facturasSeleccionadasOrdenadas
            .filter((factura) => factura.estado !== 'pagada')
            .map((factura) => {
                const saldoPendiente = Number(factura.saldoPendiente || factura.monto || 0);
                const montoAplicado = Math.max(0, Math.min(saldoPendiente, montoRestante));
                montoRestante -= montoAplicado;

                return {
                    ...factura,
                    saldoPendiente,
                    montoAplicado,
                    saldoDespues: Math.max(0, saldoPendiente - montoAplicado)
                };
            });
    }, [abonoForm.montoTotal, facturasSeleccionadasOrdenadas]);

    // ============================================
    // GUARDAR FACTURA + ASIENTO CONTABLE
    // ============================================
    const handleSaveFactura = async (e) => {
        e.preventDefault();
        setError(null);
        
        try {
            if (!facturaForm.proveedorId) { setError('Seleccione un proveedor'); return; }
            if (!facturaForm.sucursalId) { setError('Seleccione la sucursal de la factura'); return; }
            if (!facturaForm.cuentaGastoId) { setError('Seleccione el tipo de gasto/costo'); return; }
            if (!facturaForm.monto || Number(facturaForm.monto) <= 0) { setError('El monto debe ser mayor a cero'); return; }
            
            const proveedor = proveedores.find(p => p.id === facturaForm.proveedorId);
            const cuentaGasto = cuentasGasto.find(c => c.id === facturaForm.cuentaGastoId);
            
            if (!cuentaGasto) { setError('Cuenta de gasto no encontrada'); return; }
            if (!cuentaProveedor) { setError('Cuenta contable de proveedores no encontrada'); return; }
            
            const monto = Number(facturaForm.monto);
            
            // 1. GUARDAR FACTURA
            const facturaData = {
                proveedorId: facturaForm.proveedorId,
                proveedorNombre: proveedor?.nombre || '',
                proveedorCodigo: proveedor?.codigo || '',
                sucursalId: facturaForm.sucursalId,
                sucursalName: facturaForm.sucursalName,
                numeroFactura: facturaForm.numeroFactura,
                fechaEmision: facturaForm.fechaEmision,
                fechaVencimiento: facturaForm.fechaVencimiento,
                monto: monto,
                saldoPendiente: monto,
                montoAbonado: 0,
                descripcion: facturaForm.descripcion,
                cuentaGastoId: cuentaGasto.id,
                cuentaGastoCode: cuentaGasto.code,
                cuentaGastoName: cuentaGasto.name,
                cuentaGastoType: cuentaGasto.type,
                cuentaProveedorId: cuentaProveedor.id,
                cuentaProveedorCode: cuentaProveedor.code,
                cuentaProveedorName: cuentaProveedor.name,
                estado: 'pendiente',
                createdAt: Timestamp.now(),
                createdBy: user?.uid
            };
            
            const facturaRef = await addDoc(collection(db, 'facturasProveedor'), facturaData);
            
            // 2. CREAR ASIENTO CONTABLE USANDO EL SERVICIO UNIFICADO
            // El servicio espera 'cuentaId', 'cuentaCode', 'cuentaName'
            const asiento = {
                fecha: facturaForm.fechaEmision,
                descripcion: `Factura ${facturaForm.numeroFactura} - ${proveedor?.nombre || 'Proveedor'}`,
                referencia: `FAC-${facturaForm.numeroFactura}`,
                documentoId: facturaRef.id,
                documentoTipo: 'facturaProveedor',
                moduloOrigen: 'cuentas-pagar',
                sucursalId: facturaForm.sucursalId,
                sucursalName: facturaForm.sucursalName,
                userId: user?.uid,
                userEmail: user?.email,
                movimientos: [
                    {
                        cuentaId: cuentaGasto.id,
                        cuentaCode: cuentaGasto.code,
                        cuentaName: cuentaGasto.name,
                        tipo: 'DEBITO',
                        monto: monto,
                        descripcion: `Gasto: ${facturaForm.numeroFactura}`
                    },
                    {
                        cuentaId: cuentaProveedor.id,
                        cuentaCode: cuentaProveedor.code,
                        cuentaName: cuentaProveedor.name,
                        tipo: 'CREDITO',
                        monto: monto,
                        descripcion: `A cuenta de: ${proveedor?.nombre || 'Proveedor'}`
                    }
                ],
                metadata: {
                    sucursalId: facturaForm.sucursalId,
                    sucursalName: facturaForm.sucursalName
                }
            };
            
            console.log('Registrando asiento contable:', asiento);
            const resultado = await registerAccountingEntry(asiento);
            console.log('Asiento registrado:', resultado);
            await updateDoc(facturaRef, {
                asientoId: resultado.asientoId,
                movimientosContablesIds: resultado.movimientos.map(m => m.id),
                updatedAt: Timestamp.now()
            });
            
            // 3. ACTUALIZAR SALDO DEL PROVEEDOR
            if (proveedor) {
                const { saldoPendiente, totalFacturas } = getTotalesProveedor(proveedor.id);
                await updateDoc(doc(db, 'proveedores', proveedor.id), {
                    saldoPendiente: saldoPendiente + monto,
                    totalCompras: totalFacturas + monto,
                    updatedAt: Timestamp.now()
                });
            }
            
            setSuccess(`Factura creada y asiento contable registrado: DEBITO ${cuentaGasto.code} / CREDITO ${cuentaProveedor.code}`);
            setShowFacturaModal(false);
            resetFacturaForm();
            setTimeout(() => setSuccess(null), 5000);
        } catch (err) {
            console.error('Error:', err);
            setError('Error: ' + err.message);
        }
    };

    // ============================================
    // REALIZAR ABONO + ASIENTO CONTABLE
    // ============================================
    const handleAbonoMultiple = async (e) => {
        e.preventDefault();
        setError(null);
        
        try {
            const facturasAPagar = facturasSeleccionadasOrdenadas.filter(
                (factura) => factura.estado !== 'pagada' && Number(factura.saldoPendiente || factura.monto || 0) > 0
            );
            const montoTotal = Number(abonoForm.montoTotal);
            const cuentasPasivoSeleccionadas = Array.from(
                new Map(
                    facturasAPagar
                        .map((factura) => ({
                            id: factura.cuentaProveedorId || cuentaProveedor?.id || '',
                            code: factura.cuentaProveedorCode || cuentaProveedor?.code || '',
                            name: factura.cuentaProveedorName || cuentaProveedor?.name || ''
                        }))
                        .filter((cuenta) => cuenta.id && cuenta.code)
                        .map((cuenta) => [cuenta.id, cuenta])
                ).values()
            );
             
            if (montoTotal <= 0) { setError('El monto debe ser mayor a cero'); return; }
            if (montoTotal > totalAPagar) { setError('El monto excede el saldo pendiente'); return; }
            if (facturasAPagar.length === 0) { setError('Seleccione al menos una factura pendiente'); return; }
            if (!abonoForm.sucursalId) { setError('Seleccione la sucursal del pago'); return; }
            if ((abonoForm.metodoPago === 'efectivo' || abonoForm.metodoPago === 'transferencia' || abonoForm.metodoPago === 'deposito') && !abonoForm.cuentaOrigenId) {
                setError(`Seleccione una cuenta de origen para ${abonoForm.metodoPago}`);
                return;
            }
             
            const proveedor = proveedores.find(p => p.id === proveedorSeleccionado);
            if (!cuentaProveedor) { setError('Cuenta contable de proveedores no encontrada'); return; }
            if (cuentasPasivoSeleccionadas.length > 1) {
                setError('Seleccione facturas con la misma cuenta por pagar para registrar un solo abono');
                return;
            }

            const cuentaPasivoPago = cuentasPasivoSeleccionadas[0] || cuentaProveedor;
             
            // 1. CREAR ABONO
            const abonoData = {
                proveedorId: proveedorSeleccionado,
                proveedorNombre: proveedor?.nombre || '',
                sucursalId: abonoForm.sucursalId,
                sucursalName: abonoForm.sucursalName,
                fecha: abonoForm.fecha,
                montoTotal: montoTotal,
                metodoPago: abonoForm.metodoPago,
                cuentaOrigenId: abonoForm.cuentaOrigenId,
                cuentaOrigenCode: abonoForm.cuentaOrigenCode,
                cuentaOrigenName: abonoForm.cuentaOrigenName,
                referencia: abonoForm.referencia,
                notas: abonoForm.notas,
                facturasIds: facturasAPagar.map((factura) => factura.id),
                cantidadFacturas: facturasAPagar.length,
                ordenAplicacionFacturas: facturasAPagar.map((factura) => ({
                    facturaId: factura.id,
                    numeroFactura: factura.numeroFactura
                })),
                estado: 'completado',
                createdAt: Timestamp.now(),
                createdBy: user?.uid
            };
            
            const abonoRef = await addDoc(collection(db, 'abonosProveedor'), abonoData);
            
            // 2. DISTRIBUIR PAGO ENTRE FACTURAS
            let montoRestante = montoTotal;
            for (const factura of facturasAPagar) {
                if (montoRestante <= 0) break;
                const saldoFactura = Number(factura.saldoPendiente || factura.monto || 0);
                const montoAAplicar = Math.min(saldoFactura, montoRestante);
                const nuevoSaldo = saldoFactura - montoAAplicar;
                const nuevoMontoAbonado = Number(factura.montoAbonado || 0) + montoAAplicar;
                const nuevoEstado = nuevoSaldo <= 0.01 ? 'pagada' : 'parcial';
                
                await updateDoc(doc(db, 'facturasProveedor', factura.id), {
                    saldoPendiente: nuevoSaldo,
                    montoAbonado: nuevoMontoAbonado,
                    estado: nuevoEstado,
                    updatedAt: Timestamp.now()
                });
                
                await addDoc(collection(db, 'abonosFacturaDetalle'), {
                    abonoId: abonoRef.id,
                    facturaId: factura.id,
                    numeroFactura: factura.numeroFactura,
                    montoAplicado: montoAAplicar,
                    fecha: abonoForm.fecha
                });
                
                montoRestante -= montoAAplicar;
            }
            
            // 3. CREAR ASIENTO CONTABLE DEL PAGO
            const asientoPago = {
                fecha: abonoForm.fecha,
                descripcion: `Pago a ${proveedor?.nombre || 'Proveedor'} - ${abonoForm.metodoPago}`,
                referencia: `PAGO-${abonoForm.referencia || abonoRef.id.slice(0, 6)}`,
                documentoId: abonoRef.id,
                documentoTipo: 'abonoProveedor',
                moduloOrigen: 'cuentas-pagar',
                sucursalId: abonoForm.sucursalId,
                sucursalName: abonoForm.sucursalName,
                userId: user?.uid,
                userEmail: user?.email,
                movimientos: [
                    {
                        cuentaId: cuentaPasivoPago.id,
                        cuentaCode: cuentaPasivoPago.code,
                        cuentaName: cuentaPasivoPago.name,
                        tipo: 'DEBITO',
                        monto: montoTotal,
                        descripcion: `Pago a ${proveedor?.nombre || 'Proveedor'}`
                    },
                    {
                        cuentaId: abonoForm.cuentaOrigenId,
                        cuentaCode: abonoForm.cuentaOrigenCode,
                        cuentaName: abonoForm.cuentaOrigenName,
                        tipo: 'CREDITO',
                        monto: montoTotal,
                        descripcion: `Salida por pago ${abonoForm.metodoPago}`
                    }
                ],
                metadata: {
                    sucursalId: abonoForm.sucursalId,
                    sucursalName: abonoForm.sucursalName
                }
            };
            
            console.log('Registrando asiento de pago:', asientoPago);
            const resultadoPago = await registerAccountingEntry(asientoPago);
            await updateDoc(abonoRef, {
                asientoId: resultadoPago.asientoId,
                movimientosContablesIds: resultadoPago.movimientos.map(m => m.id),
                updatedAt: Timestamp.now()
            });
            
            // 4. ACTUALIZAR SALDO DEL PROVEEDOR
            if (proveedor) {
                const { saldoPendiente, totalPagos } = getTotalesProveedor(proveedor.id);
                await updateDoc(doc(db, 'proveedores', proveedor.id), {
                    saldoPendiente: Math.max(0, saldoPendiente - montoTotal),
                    totalPagos: totalPagos + montoTotal,
                    updatedAt: Timestamp.now()
                });
            }
             
            setSuccess(`Pago de ${formatCurrency(montoTotal)} registrado. Asiento: DEBITO ${cuentaPasivoPago.code} / CREDITO ${abonoForm.cuentaOrigenCode}`);
            setShowAbonoModal(false);
            setFacturasSeleccionadas([]);
            setSeleccionarTodas(false);
            resetAbonoForm();
            setTimeout(() => setSuccess(null), 5000);
        } catch (err) {
            console.error('Error en abono:', err);
            setError('Error: ' + err.message);
        }
    };

    // Anular abono
    const handleAnularAbono = async (abono) => {
        if (!confirm('¿Anular este abono?')) return;
        try {
            const detalles = await getDocs(query(collection(db, 'abonosFacturaDetalle'), where('abonoId', '==', abono.id)));
            for (const d of detalles.docs) {
                const dd = d.data();
                const fref = doc(db, 'facturasProveedor', dd.facturaId);
                const fsnap = await getDocs(query(collection(db, 'facturasProveedor'), where('__name__', '==', dd.facturaId)));
                if (!fsnap.empty) {
                    const f = fsnap.docs[0].data();
                    await updateDoc(fref, {
                        saldoPendiente: Number(f.saldoPendiente || 0) + dd.montoAplicado,
                        montoAbonado: Math.max(0, Number(f.montoAbonado || 0) - dd.montoAplicado),
                        estado: Number(f.montoAbonado || 0) - dd.montoAplicado > 0 ? 'parcial' : 'pendiente',
                        updatedAt: Timestamp.now()
                    });
                }
                await deleteDoc(doc(db, 'abonosFacturaDetalle', d.id));
            }
            await updateDoc(doc(db, 'abonosProveedor', abono.id), { estado: 'anulado', anuladoAt: Timestamp.now(), anuladoBy: user?.uid });
            
            const prov = proveedores.find(p => p.id === abono.proveedorId);
            if (prov) {
                const { saldoPendiente, totalPagos } = getTotalesProveedor(prov.id);
                await updateDoc(doc(db, 'proveedores', prov.id), {
                    saldoPendiente: saldoPendiente + abono.montoTotal,
                    totalPagos: Math.max(0, totalPagos - abono.montoTotal),
                    updatedAt: Timestamp.now()
                });
            }
            setSuccess('Abono anulado');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) { setError('Error: ' + err.message); }
    };

    // Eliminar factura
    const handleDeleteFactura = async (factura) => {
        if (!confirm('¿Eliminar esta factura?')) return;
        try {
            await deleteDoc(doc(db, 'facturasProveedor', factura.id));
            const prov = proveedores.find(p => p.id === factura.proveedorId);
            if (prov) {
                const { saldoPendiente, totalFacturas } = getTotalesProveedor(prov.id);
                await updateDoc(doc(db, 'proveedores', prov.id), {
                    saldoPendiente: Math.max(0, saldoPendiente - Number(factura.saldoPendiente || factura.monto || 0)),
                    totalCompras: Math.max(0, totalFacturas - Number(factura.monto || 0)),
                    updatedAt: Timestamp.now()
                });
            }
            setSuccess('Factura eliminada');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) { setError('Error: ' + err.message); }
    };

    const verAbonosFactura = (factura) => { setFacturaSeleccionadaParaAbonos(factura); setShowAbonosListModal(true); };

    const formatCurrency = (amount) => `C$ ${Number(amount || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const resetFacturaForm = () => setFacturaForm({
        proveedorId: proveedorSeleccionado || '',
        sucursalId: '',
        sucursalName: '',
        numeroFactura: '',
        fechaEmision: new Date().toISOString().split('T')[0],
        fechaVencimiento: '',
        monto: '',
        descripcion: '',
        cuentaGastoId: '',
        cuentaGastoCode: '',
        cuentaGastoName: ''
    });
    const resetAbonoForm = () => setAbonoForm({
        fecha: new Date().toISOString().split('T')[0],
        sucursalId: '',
        sucursalName: '',
        montoTotal: 0,
        metodoPago: 'transferencia',
        cuentaOrigenId: '',
        cuentaOrigenCode: '',
        cuentaOrigenName: '',
        referencia: '',
        notas: ''
    });

    const getAbonosFactura = (fid) => abonos.filter(a => a.facturasIds?.includes(fid));

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><DollarSign className="w-6 h-6 text-blue-600" /></div>
                    Cuentas por Pagar
                </h1>
                <p className="text-slate-600 mt-2">Facturas de proveedores con asientos contables automáticos</p>
            </div>

            {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button></div>}
            {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

            {/* Filtros */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1"><Building2 className="w-4 h-4 inline mr-1" />Proveedor</label>
                        <select value={proveedorSeleccionado} onChange={(e) => { setProveedorSeleccionado(e.target.value); setFacturasSeleccionadas([]); setSeleccionarTodas(false); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg">
                            <option value="">Todos los proveedores</option>
                            {proveedores.map(p => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1"><Search className="w-4 h-4 inline mr-1" />Buscar</label>
                        <input type="text" placeholder="Número de factura..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1"><Filter className="w-4 h-4 inline mr-1" />Estado</label>
                        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg">
                            <option value="">Todos</option>
                            <option value="pendiente">Pendiente</option>
                            <option value="parcial">Parcial</option>
                            <option value="pagada">Pagada</option>
                        </select>
                    </div>
                </div>
                {proveedorActual && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-lg grid grid-cols-4 gap-4 text-sm">
                        <div><p className="text-slate-500">Límite</p><p className="font-medium">{formatCurrency(proveedorActual.limiteCredito)}</p></div>
                        <div><p className="text-slate-500">Plazo</p><p className="font-medium">{proveedorActual.plazoDias} días</p></div>
                        <div><p className="text-slate-500">Saldo</p><p className="font-medium text-red-600">{formatCurrency(getTotalesProveedor(proveedorActual.id).saldoPendiente)}</p></div>
                        <div><p className="text-slate-500">Facturas</p><p className="font-medium">{getTotalesProveedor(proveedorActual.id).cantidadFacturas}</p></div>
                    </div>
                )}
            </div>

            {/* Acciones */}
            <div className="flex flex-wrap gap-3 mb-4">
                <button onClick={() => { resetFacturaForm(); setShowFacturaModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"><Plus className="w-5 h-5" />Nueva Factura</button>
                {facturasSeleccionadas.length > 0 && (
                    <button onClick={() => { setAbonoForm(prev => ({ ...prev, montoTotal: totalAPagar })); setShowAbonoModal(true); }} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2">
                        <DollarSign className="w-5 h-5" />Pagar ({facturasSeleccionadas.length}) - {formatCurrency(totalAPagar)}
                    </button>
                )}
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-3 py-3 text-center w-10"><button onClick={toggleSeleccionarTodas}>{seleccionarTodas ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-slate-400" />}</button></th>
                            <th className="px-3 py-3 text-left text-sm font-medium">Factura</th>
                            <th className="px-3 py-3 text-left text-sm font-medium">Proveedor / Entidad</th>
                            <th className="px-3 py-3 text-left text-sm font-medium">Sucursal</th>
                            <th className="px-3 py-3 text-left text-sm font-medium">Emisión</th>
                            <th className="px-3 py-3 text-left text-sm font-medium">Vence</th>
                            <th className="px-3 py-3 text-right text-sm font-medium">Monto</th>
                            <th className="px-3 py-3 text-right text-sm font-medium">Saldo</th>
                            <th className="px-3 py-3 text-center text-sm font-medium">Estado</th>
                            <th className="px-3 py-3 text-center text-sm font-medium">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? <tr><td colSpan="10" className="px-4 py-8 text-center"><RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" /></td></tr> :
                         facturasFiltradas.length === 0 ? <tr><td colSpan="10" className="px-4 py-8 text-center text-slate-500"><FileText className="w-12 h-12 mx-auto mb-4 text-slate-300" /><p>No hay facturas</p></td></tr> :
                         facturasFiltradas.map(f => {
                            const vencida = f.fechaVencimiento && new Date(f.fechaVencimiento) < new Date() && f.estado !== 'pagada';
                            const ordenSeleccion = ordenSeleccionMap.get(f.id);
                            return (
                                <tr key={f.id} className={`hover:bg-slate-50 ${vencida ? 'bg-red-50' : ''}`}>
                                    <td className="px-3 py-3 text-center">
                                        {f.estado !== 'pagada' && (
                                            <button onClick={() => toggleSeleccionFactura(f.id)} className="inline-flex items-center gap-1">
                                                {facturasSeleccionadas.includes(f.id) ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-slate-400" />}
                                                {ordenSeleccion ? (
                                                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold">
                                                        {ordenSeleccion}
                                                    </span>
                                                ) : null}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium">{f.numeroFactura}</p>
                                            {ordenSeleccion ? (
                                                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                                                    Orden {ordenSeleccion}
                                                </span>
                                            ) : null}
                                        </div>
                                        {f.descripcion && <p className="text-xs text-slate-500 truncate max-w-xs">{f.descripcion}</p>}
                                    </td>
                                    <td className="px-3 py-3 text-sm">
                                        <p>{f.proveedorNombre || f.cuentaProveedorName || 'Entidad'}</p>
                                        {f.cuentaProveedorCode && (
                                            <p className="text-xs text-slate-500">
                                                {f.cuentaProveedorCode} - {f.cuentaProveedorName}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-sm">{f.sucursalName || 'General'}</td>
                                    <td className="px-3 py-3 text-sm">{f.fechaEmision}</td>
                                    <td className="px-3 py-3 text-sm"><span className={vencida ? 'text-red-600 font-medium' : ''}>{f.fechaVencimiento}{vencida && <span className="text-xs ml-1">(Vencida)</span>}</span></td>
                                    <td className="px-3 py-3 text-right text-sm">{formatCurrency(f.monto)}</td>
                                    <td className="px-3 py-3 text-right text-sm font-medium">{formatCurrency(f.saldoPendiente)}</td>
                                    <td className="px-3 py-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-medium ${f.estado === 'pagada' ? 'bg-green-100 text-green-700' : f.estado === 'parcial' ? 'bg-amber-100 text-amber-700' : vencida ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{f.estado === 'pagada' ? 'Pagada' : f.estado === 'parcial' ? 'Parcial' : 'Pendiente'}</span></td>
                                    <td className="px-3 py-3 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            {getAbonosFactura(f.id).length > 0 && <button onClick={() => verAbonosFactura(f)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Ver abonos"><DollarSign className="w-4 h-4" /></button>}
                                            <button onClick={() => handleDeleteFactura(f)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                         })}
                    </tbody>
                </table>
            </div>

            {/* Modal Factura */}
            {showFacturaModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold">Nueva Factura</h2>
                            <button onClick={() => setShowFacturaModal(false)} className="p-2 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
                        </div>
                        <form onSubmit={handleSaveFactura} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Proveedor *</label>
                                <select value={facturaForm.proveedorId} onChange={(e) => setFacturaForm({...facturaForm, proveedorId: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
                                    <option value="">Seleccione...</option>
                                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Sucursal *</label>
                                <select
                                    value={facturaForm.sucursalId}
                                    onChange={(e) => {
                                        const sucursal = sucursalesActivas.find((branch) => branch.id === e.target.value);
                                        setFacturaForm({
                                            ...facturaForm,
                                            sucursalId: e.target.value,
                                            sucursalName: sucursal?.name || ''
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    required
                                >
                                    <option value="">Seleccione...</option>
                                    {sucursalesActivas.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                                </select>
                            </div>
                            {proveedorActual && <div className="p-3 bg-blue-50 rounded-lg text-sm"><p><strong>Límite:</strong> {formatCurrency(proveedorActual.limiteCredito)} | <strong>Plazo:</strong> {proveedorActual.plazoDias} días</p></div>}
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">N° Factura *</label><input type="text" value={facturaForm.numeroFactura} onChange={(e) => setFacturaForm({...facturaForm, numeroFactura: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></div>
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Monto *</label><input type="number" step="0.01" value={facturaForm.monto} onChange={(e) => setFacturaForm({...facturaForm, monto: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Fecha Emisión *</label><input type="date" value={facturaForm.fechaEmision} onChange={(e) => setFacturaForm({...facturaForm, fechaEmision: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></div>
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Vencimiento *</label><input type="date" value={facturaForm.fechaVencimiento} onChange={(e) => setFacturaForm({...facturaForm, fechaVencimiento: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1"><TrendingDown className="w-4 h-4 inline mr-1" />Tipo de Gasto/Costo *</label>
                                <select value={facturaForm.cuentaGastoId} onChange={(e) => { const c = cuentasGasto.find(x => x.id === e.target.value); setFacturaForm({...facturaForm, cuentaGastoId: e.target.value, cuentaGastoCode: c?.code, cuentaGastoName: c?.name}); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
                                    <option value="">Seleccione...</option>
                                    <optgroup label="GASTOS (61)">{cuentasGasto.filter(c => c.type === 'GASTO').map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</optgroup>
                                    <optgroup label="COSTOS (51)">{cuentasGasto.filter(c => c.type === 'COSTO').map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</optgroup>
                                </select>
                                <p className="text-xs text-slate-500 mt-1">Se debitará esta cuenta. El crédito irá a 210101 - Proveedores.</p>
                            </div>
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label><textarea value={facturaForm.descripcion} onChange={(e) => setFacturaForm({...facturaForm, descripcion: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" rows={2} /></div>
                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => setShowFacturaModal(false)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
                                <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Save className="w-5 h-5 inline mr-2" />Guardar Factura</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Abono */}
            {showAbonoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold"><DollarSign className="w-6 h-6 inline mr-2 text-green-600" />Pago a Facturas</h2>
                            <button onClick={() => setShowAbonoModal(false)} className="p-2 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
                        </div>
                        <form onSubmit={handleAbonoMultiple} className="p-6 space-y-4">
                            <div className="bg-slate-50 rounded-lg p-4">
                                <h3 className="font-medium mb-2">Facturas ({facturasSeleccionadas.length})</h3>
                                <p className="text-xs text-slate-500 mb-2">
                                    El pago se aplicará exactamente en este orden de selección.
                                </p>
                                <div className="max-h-32 overflow-auto space-y-1 text-sm">
                                    {facturasSeleccionadasOrdenadas.map((factura, index) => (
                                        <div key={factura.id} className="flex justify-between gap-3">
                                            <span>{index + 1}. {factura.numeroFactura}</span>
                                            <span>{formatCurrency(factura.saldoPendiente)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="border-t pt-2 mt-2 flex justify-between font-bold"><span>Total:</span><span className="text-green-600">{formatCurrency(totalAPagar)}</span></div>
                            </div>
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Monto *</label><input type="number" step="0.01" value={abonoForm.montoTotal} onChange={(e) => setAbonoForm({...abonoForm, montoTotal: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium" required /></div>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <h3 className="font-medium text-blue-900 mb-2">Vista previa de aplicación</h3>
                                <div className="space-y-2 text-sm">
                                    {previewAplicacionAbono.map((factura, index) => (
                                        <div key={factura.id} className="flex flex-col gap-1 rounded-lg bg-white px-3 py-2 border border-blue-100">
                                            <div className="flex justify-between gap-3">
                                                <span className="font-medium text-slate-900">{index + 1}. {factura.numeroFactura}</span>
                                                <span className="font-semibold text-blue-700">{formatCurrency(factura.montoAplicado)}</span>
                                            </div>
                                            <div className="flex justify-between gap-3 text-xs text-slate-500">
                                                <span>Saldo actual: {formatCurrency(factura.saldoPendiente)}</span>
                                                <span>Saldo después: {formatCurrency(factura.saldoDespues)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Fecha *</label><input type="date" value={abonoForm.fecha} onChange={(e) => setAbonoForm({...abonoForm, fecha: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required /></div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Sucursal *</label>
                                <select
                                    value={abonoForm.sucursalId}
                                    onChange={(e) => {
                                        const sucursal = sucursalesActivas.find((branch) => branch.id === e.target.value);
                                        setAbonoForm({
                                            ...abonoForm,
                                            sucursalId: e.target.value,
                                            sucursalName: sucursal?.name || ''
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    required
                                >
                                    <option value="">Seleccione...</option>
                                    {sucursalesActivas.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Método *</label>
                                <select value={abonoForm.metodoPago} onChange={(e) => setAbonoForm({...abonoForm, metodoPago: e.target.value, cuentaOrigenId: '', cuentaOrigenCode: '', cuentaOrigenName: ''})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
                                    <option value="transferencia">Transferencia</option>
                                    <option value="cheque">Cheque</option>
                                    <option value="efectivo">Efectivo</option>
                                    <option value="deposito">Depósito</option>
                                </select>
                            </div>
                            {abonoForm.metodoPago === 'efectivo' && (
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Caja *</label>
                                    <select value={abonoForm.cuentaOrigenId} onChange={(e) => { const c = cuentasCaja.find(x => x.id === e.target.value); setAbonoForm({...abonoForm, cuentaOrigenId: e.target.value, cuentaOrigenCode: c?.code, cuentaOrigenName: c?.name}); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
                                        <option value="">Seleccione...</option>
                                        {cuentasCaja.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                                    </select>
                                </div>
                            )}
                            {(abonoForm.metodoPago === 'transferencia' || abonoForm.metodoPago === 'deposito') && (
                                <div><label className="block text-sm font-medium text-slate-700 mb-1"><Landmark className="w-4 h-4 inline mr-1" />Cuenta Bancaria *</label>
                                    <select value={abonoForm.cuentaOrigenId} onChange={(e) => { const c = cuentasBanco.find(x => x.id === e.target.value); setAbonoForm({...abonoForm, cuentaOrigenId: e.target.value, cuentaOrigenCode: c?.code, cuentaOrigenName: c?.name}); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
                                        <option value="">Seleccione...</option>
                                        {cuentasBanco.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Referencia</label><input type="text" placeholder="N° transferencia, cheque..." value={abonoForm.referencia} onChange={(e) => setAbonoForm({...abonoForm, referencia: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" /></div>
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Notas</label><textarea value={abonoForm.notas} onChange={(e) => setAbonoForm({...abonoForm, notas: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg" rows={2} /></div>
                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => setShowAbonoModal(false)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
                                <button type="submit" className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><CheckCircle className="w-5 h-5 inline mr-2" />Confirmar Pago</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Abonos */}
            {showAbonosListModal && facturaSeleccionadaParaAbonos && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold">Abonos - {facturaSeleccionadaParaAbonos.numeroFactura}</h2>
                            <button onClick={() => setShowAbonosListModal(false)} className="p-2 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6">
                            {getAbonosFactura(facturaSeleccionadaParaAbonos.id).length === 0 ? <p className="text-center text-slate-500">No hay abonos</p> :
                                <div className="space-y-3">
                                    {getAbonosFactura(facturaSeleccionadaParaAbonos.id).map(a => (
                                        <div key={a.id} className="border rounded-lg p-4">
                                            <div className="flex justify-between">
                                                <div><p className="font-medium">{formatCurrency(a.montoTotal)}</p><p className="text-sm text-slate-500">{a.fecha} - {a.metodoPago}</p></div>
                                                <div className="flex gap-2">
                                                    <span className={`px-2 py-1 rounded-full text-xs ${a.estado === 'completado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{a.estado}</span>
                                                    {a.estado !== 'anulado' && <button onClick={() => handleAnularAbono(a)} className="text-red-600 hover:bg-red-50 p-1 rounded"><Trash2 className="w-4 h-4" /></button>}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            }
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountsPayable;
