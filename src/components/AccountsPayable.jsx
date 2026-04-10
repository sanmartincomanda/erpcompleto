// src/components/AccountsPayable.jsx
// Módulo de Cuentas por Pagar - INTEGRADO CON CONTABILIDAD

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { 
    collection, query, where, orderBy, onSnapshot, 
    addDoc, updateDoc, deleteDoc, doc, Timestamp, getDocs, setDoc
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { registerAccountingEntry } from '../services/unifiedAccountingService';
import {
    createImageAttachment,
    createLocalImagePreviewItems,
    revokeLocalImagePreviewItems,
    resolveStoredImageEntries
} from '../utils/imageAttachments';
import { 
    Building2, Plus, Trash2, Save, X, Search, 
    DollarSign, Calendar, CheckCircle, 
    AlertCircle, RefreshCw, FileText, CheckSquare, Square, Filter,
    TrendingDown, Landmark, Eye, Camera, Upload, Image,
    Users, ArrowUpRight
} from 'lucide-react';

const MAX_FACTURA_IMAGES = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const PAYMENT_METHOD_LABELS = {
    transferencia: 'Transferencia',
    cheque: 'Cheque',
    efectivo: 'Efectivo',
    deposito: 'Deposito'
};
const toAmount = (value) => Number(value || 0);
const getSaldoFactura = (factura) => toAmount(factura?.saldoPendiente ?? factura?.monto);
const getMontoAbonadoFactura = (factura) => toAmount(factura?.montoAbonado);
const isFacturaPendiente = (factura) => getSaldoFactura(factura) > 0.01;
const branchLabel = (branch) => branch?.name || branch?.nombre || branch?.branchName || branch?.tienda || 'Sucursal';
const formatReceiptCode = (abono) => `#${String(abono?.id || '').slice(-4).toUpperCase() || '----'}`;

const getDueMeta = (factura) => {
    if (!factura?.fechaVencimiento) {
        return {
            isOverdue: false,
            isUpcoming: false,
            label: 'Sin vencimiento',
            badgeClass: 'bg-slate-100 text-slate-500'
        };
    }

    const dueDate = new Date(`${factura.fechaVencimiento}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) {
        return {
            isOverdue: false,
            isUpcoming: false,
            label: factura.fechaVencimiento,
            badgeClass: 'bg-slate-100 text-slate-500'
        };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);

    if (diffDays < 0) {
        const overdueDays = Math.abs(diffDays);
        return {
            isOverdue: true,
            isUpcoming: false,
            label: `${overdueDays} dia${overdueDays === 1 ? '' : 's'} vencida`,
            badgeClass: 'bg-red-50 text-red-500 ring-1 ring-red-200'
        };
    }

    if (diffDays <= 3) {
        return {
            isOverdue: false,
            isUpcoming: true,
            label: diffDays === 0 ? 'Vence hoy' : `Por vencer (${diffDays}d)`,
            badgeClass: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
        };
    }

    return {
        isOverdue: false,
        isUpcoming: false,
        label: factura.fechaVencimiento,
        badgeClass: 'bg-slate-100 text-slate-500'
    };
};

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
    const [activeTab, setActiveTab] = useState('estado');
    
    const [showFacturaModal, setShowFacturaModal] = useState(false);
    const [showAbonoModal, setShowAbonoModal] = useState(false);
    const [showAbonosListModal, setShowAbonosListModal] = useState(false);
    const [facturaSeleccionadaParaAbonos, setFacturaSeleccionadaParaAbonos] = useState(null);
    const [facturaDetalle, setFacturaDetalle] = useState(null);
    const [facturaDetalleAdjuntos, setFacturaDetalleAdjuntos] = useState([]);
    const [loadingFacturaDetalleAdjuntos, setLoadingFacturaDetalleAdjuntos] = useState(false);
    
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
    const [facturaAdjuntos, setFacturaAdjuntos] = useState([]);
    const facturaFileInputRef = useRef(null);
    const facturaAdjuntosRef = useRef([]);

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

    useEffect(() => {
        facturaAdjuntosRef.current = facturaAdjuntos;
    }, [facturaAdjuntos]);

    useEffect(() => () => {
        revokeLocalImagePreviewItems(facturaAdjuntosRef.current);
    }, []);

    const facturasFiltradas = useMemo(() => {
        let f = facturas;
        if (proveedorSeleccionado) f = f.filter(x => x.proveedorId === proveedorSeleccionado);
        if (searchTerm) f = f.filter(x => x.numeroFactura?.toLowerCase().includes(searchTerm.toLowerCase()));
        if (filtroEstado === 'conSaldo') {
            f = f.filter((factura) => Number(factura.saldoPendiente || factura.monto || 0) > 0.01);
        } else if (filtroEstado) {
            f = f.filter(x => x.estado === filtroEstado);
        }
        return f;
    }, [facturas, proveedorSeleccionado, searchTerm, filtroEstado]);

    const getTotalesProveedor = (pid) => {
        const fp = facturas.filter(f => f.proveedorId === pid);
        const fpPendientes = fp.filter((factura) => Number(factura.saldoPendiente || factura.monto || 0) > 0.01);
        const pagosProveedor = abonos.filter(a => a.proveedorId === pid && a.estado !== 'anulado');
        const tf = fp.reduce((s, f) => s + Number(f.monto || 0), 0);
        const ta = fp.reduce((s, f) => s + Number(f.montoAbonado || 0), 0);
        const tp = pagosProveedor.reduce((s, a) => s + Number(a.montoTotal || 0), 0);
        return {
            totalFacturas: tf,
            totalAbonado: ta,
            totalPagos: tp,
            saldoPendiente: tf - ta,
            cantidadFacturas: fp.length,
            cantidadFacturasPendientes: fpPendientes.length
        };
    };

    const proveedorActual = useMemo(() => proveedores.find(p => p.id === proveedorSeleccionado), [proveedores, proveedorSeleccionado]);
    const facturasPendientesFiltradas = useMemo(
        () => facturasFiltradas.filter(isFacturaPendiente),
        [facturasFiltradas]
    );
    const resumenDashboard = useMemo(() => {
        const saldoTotal = facturasPendientesFiltradas.reduce((sum, factura) => sum + getSaldoFactura(factura), 0);
        const vencidas = facturasPendientesFiltradas.filter((factura) => getDueMeta(factura).isOverdue);
        const porVencer = facturasPendientesFiltradas.filter((factura) => getDueMeta(factura).isUpcoming);

        return {
            saldoTotal,
            pendientes: facturasPendientesFiltradas.length,
            vencidasMonto: vencidas.reduce((sum, factura) => sum + getSaldoFactura(factura), 0),
            vencidasCantidad: vencidas.length,
            porVencerMonto: porVencer.reduce((sum, factura) => sum + getSaldoFactura(factura), 0),
            porVencerCantidad: porVencer.length
        };
    }, [facturasPendientesFiltradas]);
    const gruposFacturasPorProveedor = useMemo(() => {
        const groups = new Map();

        facturasFiltradas.forEach((factura) => {
            const key = factura.proveedorId || 'sin-proveedor';
            const existing = groups.get(key) || {
                proveedorId: factura.proveedorId || '',
                proveedorNombre: factura.proveedorNombre || factura.cuentaProveedorName || 'Entidad',
                proveedorCodigo: factura.proveedorCodigo || '',
                saldoPendiente: 0,
                totalFacturas: 0,
                cantidadFacturas: 0,
                cantidadPendientes: 0,
                cantidadVencidas: 0,
                facturas: []
            };

            const saldoFactura = getSaldoFactura(factura);
            const dueMeta = getDueMeta(factura);
            existing.saldoPendiente += saldoFactura;
            existing.totalFacturas += toAmount(factura.monto);
            existing.cantidadFacturas += 1;
            existing.cantidadPendientes += isFacturaPendiente(factura) ? 1 : 0;
            existing.cantidadVencidas += dueMeta.isOverdue ? 1 : 0;
            existing.facturas.push(factura);
            groups.set(key, existing);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                facturas: [...group.facturas].sort((left, right) => {
                    const dueLeft = String(left.fechaVencimiento || '9999-12-31');
                    const dueRight = String(right.fechaVencimiento || '9999-12-31');
                    if (dueLeft !== dueRight) return dueLeft.localeCompare(dueRight);
                    return String(right.fechaEmision || '').localeCompare(String(left.fechaEmision || ''));
                })
            }))
            .sort((left, right) => right.saldoPendiente - left.saldoPendiente);
    }, [facturasFiltradas]);
    const resumenProveedores = useMemo(() => gruposFacturasPorProveedor.map((group) => ({
        ...group,
        totalAbonado: group.facturas.reduce((sum, factura) => sum + getMontoAbonadoFactura(factura), 0)
    })), [gruposFacturasPorProveedor]);
    const abonosFiltrados = useMemo(() => {
        let resultado = abonos.filter((abono) => abono.estado !== 'anulado');

        if (proveedorSeleccionado) {
            resultado = resultado.filter((abono) => abono.proveedorId === proveedorSeleccionado);
        }

        if (searchTerm) {
            const queryValue = searchTerm.toLowerCase();
            resultado = resultado.filter((abono) =>
                String(abono.proveedorNombre || '').toLowerCase().includes(queryValue) ||
                String(abono.referencia || '').toLowerCase().includes(queryValue)
            );
        }

        return resultado;
    }, [abonos, proveedorSeleccionado, searchTerm]);

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
    const facturasSeleccionadasProveedorNombre = facturasSeleccionadasOrdenadas[0]?.proveedorNombre || facturasSeleccionadasOrdenadas[0]?.cuentaProveedorName || '';
    const todasFacturasPendientesSeleccionadas = useMemo(() => {
        if (!facturasPendientesFiltradas.length) return false;
        return facturasPendientesFiltradas.every((factura) => facturasSeleccionadas.includes(factura.id));
    }, [facturasPendientesFiltradas, facturasSeleccionadas]);

    const openAbonoForFacturas = (facturasParaPagar) => {
        const facturasValidas = facturasParaPagar.filter(isFacturaPendiente);
        if (!facturasValidas.length) return;

        setFacturasSeleccionadas(facturasValidas.map((factura) => factura.id));
        setSeleccionarTodas(false);
        setAbonoForm((prev) => ({
            ...prev,
            montoTotal: facturasValidas.reduce((sum, factura) => sum + getSaldoFactura(factura), 0)
        }));
        setShowAbonoModal(true);
    };

    const resetFacturaAdjuntos = () => {
        revokeLocalImagePreviewItems(facturaAdjuntos);
        setFacturaAdjuntos([]);
        if (facturaFileInputRef.current) {
            facturaFileInputRef.current.value = '';
        }
    };

    const handleFacturaAdjuntosSelect = (event) => {
        const selectedFiles = Array.from(event.target.files || []);
        if (!selectedFiles.length) return;

        if (facturaAdjuntos.length + selectedFiles.length > MAX_FACTURA_IMAGES) {
            setError(`Puede adjuntar hasta ${MAX_FACTURA_IMAGES} imágenes por factura.`);
            if (facturaFileInputRef.current) facturaFileInputRef.current.value = '';
            return;
        }

        for (const file of selectedFiles) {
            if (!file.type.startsWith('image/')) {
                setError(`"${file.name}" no es una imagen válida.`);
                if (facturaFileInputRef.current) facturaFileInputRef.current.value = '';
                return;
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                setError(`"${file.name}" supera el máximo de 5MB.`);
                if (facturaFileInputRef.current) facturaFileInputRef.current.value = '';
                return;
            }
        }

        setFacturaAdjuntos((prev) => [...prev, ...createLocalImagePreviewItems(selectedFiles, 'factura-proveedor')]);
        setError(null);

        if (facturaFileInputRef.current) {
            facturaFileInputRef.current.value = '';
        }
    };

    const removeFacturaAdjunto = (attachmentId) => {
        const adjunto = facturaAdjuntos.find((item) => item.id === attachmentId);
        if (adjunto?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(adjunto.previewUrl);
        }
        setFacturaAdjuntos((prev) => prev.filter((item) => item.id !== attachmentId));
        if (facturaFileInputRef.current) {
            facturaFileInputRef.current.value = '';
        }
    };

    const persistFacturaAdjuntos = async (facturaId) =>
        Promise.all(
            facturaAdjuntos.map((item) =>
                createImageAttachment({
                    file: item.file,
                    entityType: 'facturaProveedor',
                    entityId: facturaId,
                    category: 'facturaProveedor',
                    fileName: item.name,
                    userId: user?.uid,
                    userEmail: user?.email
                })
            )
        );

    const openFacturaDetalle = async (factura) => {
        setFacturaDetalle(factura);
        setLoadingFacturaDetalleAdjuntos(true);

        try {
            const adjuntos = await resolveStoredImageEntries(factura?.adjuntos || []);
            setFacturaDetalleAdjuntos(adjuntos);
        } catch (detailError) {
            console.error('Error cargando adjuntos de factura:', detailError);
            setError(detailError.message || 'No se pudieron cargar los adjuntos de la factura.');
            setFacturaDetalleAdjuntos([]);
        } finally {
            setLoadingFacturaDetalleAdjuntos(false);
        }
    };

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
            const facturaRef = doc(collection(db, 'facturasProveedor'));
            const adjuntosFactura = await persistFacturaAdjuntos(facturaRef.id);
            
            // 1. GUARDAR FACTURA
            const facturaData = {
                documentoId: facturaRef.id,
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
                adjuntos: adjuntosFactura,
                estado: 'pendiente',
                createdAt: Timestamp.now(),
                createdBy: user?.uid
            };
            
            await setDoc(facturaRef, facturaData);
            
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
                    sucursalName: facturaForm.sucursalName,
                    adjuntosCount: adjuntosFactura.length
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
            resetFacturaAdjuntos();
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
    const renderEmptyState = (Icon, title, message) => (
        <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-14 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <Icon className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="mt-5 text-xl font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm text-slate-500">{message}</p>
        </div>
    );
    const tabBaseClass = 'inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all';
    const renderEstadoTab = () => {
        if (loading) {
            return (
                <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-16 text-center shadow-sm">
                    <RefreshCw className="mx-auto h-10 w-10 animate-spin text-blue-600" />
                </div>
            );
        }

        if (!gruposFacturasPorProveedor.length) {
            return renderEmptyState(FileText, 'No hay facturas para mostrar', 'Ajusta los filtros o registra una nueva factura de proveedor.');
        }

        return (
            <div className="space-y-6">
                {gruposFacturasPorProveedor.map((group) => (
                    <div key={group.proveedorId || group.proveedorNombre} className="overflow-hidden rounded-[30px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
                        <div className="border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-white px-6 py-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="flex items-start gap-4">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                                        <Building2 className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900">{group.proveedorNombre}</h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {group.proveedorCodigo ? `${group.proveedorCodigo} · ` : ''}{group.cantidadFacturas} factura{group.cantidadFacturas === 1 ? '' : 's'}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                                {group.cantidadPendientes} pendiente{group.cantidadPendientes === 1 ? '' : 's'}
                                            </span>
                                            {group.cantidadVencidas > 0 && (
                                                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-500 ring-1 ring-red-200">
                                                    {group.cantidadVencidas} vencida{group.cantidadVencidas === 1 ? '' : 's'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col items-start gap-4 lg:items-end">
                                    <div className="text-left lg:text-right">
                                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Saldo pendiente</p>
                                        <p className="mt-2 text-3xl font-black text-red-500">{formatCurrency(group.saldoPendiente)}</p>
                                    </div>
                                    {group.cantidadPendientes > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => openAbonoForFacturas(group.facturas.filter(isFacturaPendiente))}
                                            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(16,185,129,0.9)] transition hover:bg-emerald-600"
                                        >
                                            <CheckCircle className="h-4 w-4" />
                                            Realizar Abono
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto px-4 py-4">
                            <table className="w-full min-w-[920px] text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                        <th className="px-4 py-3 text-center">Sel</th>
                                        <th className="px-4 py-3">Factura</th>
                                        <th className="px-4 py-3">Sucursal</th>
                                        <th className="px-4 py-3">Emision</th>
                                        <th className="px-4 py-3">Vencimiento</th>
                                        <th className="px-4 py-3 text-right">Monto</th>
                                        <th className="px-4 py-3 text-right">Abonado</th>
                                        <th className="px-4 py-3 text-right">Saldo</th>
                                        <th className="px-4 py-3 text-center">Accion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {group.facturas.map((factura) => {
                                        const dueMeta = getDueMeta(factura);
                                        const isSelected = facturasSeleccionadas.includes(factura.id);
                                        const ordenSeleccion = ordenSeleccionMap.get(factura.id);

                                        return (
                                            <tr key={factura.id} className={`${isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50/80'} transition-colors`}>
                                                <td className="px-4 py-4 text-center">
                                                    {factura.estado !== 'pagada' ? (
                                                        <button type="button" onClick={() => toggleSeleccionFactura(factura.id)} className="inline-flex items-center justify-center">
                                                            {isSelected ? (
                                                                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                                                                    <CheckSquare className="h-4 w-4" />
                                                                </div>
                                                            ) : (
                                                                <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-400">
                                                                    <Square className="h-4 w-4" />
                                                                </div>
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-300">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-bold text-slate-900">{factura.numeroFactura || 'S/N'}</p>
                                                        {ordenSeleccion ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">Orden {ordenSeleccion}</span> : null}
                                                        {Array.isArray(factura.adjuntos) && factura.adjuntos.length > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">{factura.adjuntos.length} img</span> : null}
                                                    </div>
                                                    <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{factura.descripcion || 'Sin descripcion'}</p>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 ring-1 ring-blue-100">
                                                        {factura.sucursalName || 'General'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-slate-600">{factura.fechaEmision || '-'}</td>
                                                <td className="px-4 py-4">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-slate-700">{factura.fechaVencimiento || '-'}</span>
                                                        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${dueMeta.badgeClass}`}>{dueMeta.label}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-right text-slate-600">{formatCurrency(factura.monto)}</td>
                                                <td className="px-4 py-4 text-right font-semibold text-emerald-600">{getMontoAbonadoFactura(factura) > 0 ? formatCurrency(getMontoAbonadoFactura(factura)) : '-'}</td>
                                                <td className="px-4 py-4 text-right text-lg font-black text-red-500">{formatCurrency(getSaldoFactura(factura))}</td>
                                                <td className="px-4 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button onClick={() => openFacturaDetalle(factura)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600" title="Ver factura"><Eye className="h-4 w-4" /></button>
                                                        {getAbonosFactura(factura.id).length > 0 && <button onClick={() => verAbonosFactura(factura)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-blue-600" title="Ver abonos"><DollarSign className="h-4 w-4" /></button>}
                                                        <button onClick={() => handleDeleteFactura(factura)} className="rounded-xl p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-500" title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        );
    };
    const renderAbonosTab = () => {
        if (!abonosFiltrados.length) {
            return renderEmptyState(FileText, 'Sin historial de abonos', 'Todavia no hay pagos registrados para el filtro seleccionado.');
        }

        return (
            <div className="overflow-hidden rounded-[30px] border border-white/70 bg-white/90 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
                <div className="border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-white px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">Historial de Abonos</h3>
                            <p className="text-sm text-slate-500">Consulta pagos realizados y anula solo cuando sea necesario.</p>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto px-4 py-4">
                    <table className="w-full min-w-[820px] text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                                <th className="px-4 py-3">Recibo</th>
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Proveedor</th>
                                <th className="px-4 py-3">Metodo</th>
                                <th className="px-4 py-3 text-right">Monto abonado</th>
                                <th className="px-4 py-3 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {abonosFiltrados.map((abono) => (
                                <tr key={abono.id} className="hover:bg-slate-50/80">
                                    <td className="px-4 py-4 font-bold text-blue-600">{formatReceiptCode(abono)}</td>
                                    <td className="px-4 py-4 text-slate-600">{abono.fecha || '-'}</td>
                                    <td className="px-4 py-4 font-semibold text-slate-800">{abono.proveedorNombre || 'Proveedor'}</td>
                                    <td className="px-4 py-4 text-slate-500">{PAYMENT_METHOD_LABELS[abono.metodoPago] || abono.metodoPago || '-'}</td>
                                    <td className="px-4 py-4 text-right text-lg font-black text-emerald-600">{formatCurrency(abono.montoTotal)}</td>
                                    <td className="px-4 py-4 text-center">
                                        {abono.estado !== 'anulado' ? <button onClick={() => handleAnularAbono(abono)} className="text-xs font-bold uppercase tracking-[0.18em] text-red-500 transition hover:text-red-600">Anular</button> : <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-500 ring-1 ring-red-200">Anulado</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };
    const renderProveedoresTab = () => {
        if (!resumenProveedores.length) {
            return renderEmptyState(Users, 'Sin proveedores con movimientos', 'Cuando existan facturas o saldos, apareceran aqui agrupados.');
        }

        return (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {resumenProveedores.map((proveedor) => (
                    <div key={proveedor.proveedorId || proveedor.proveedorNombre} className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Proveedor</p>
                                <h3 className="mt-2 text-xl font-bold text-slate-900">{proveedor.proveedorNombre}</h3>
                                <p className="mt-1 text-sm text-slate-500">{proveedor.cantidadFacturas} factura{proveedor.cantidadFacturas === 1 ? '' : 's'} registradas</p>
                            </div>
                            <button type="button" onClick={() => { setProveedorSeleccionado(proveedor.proveedorId); setActiveTab('estado'); }} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                                Ver estado
                                <ArrowUpRight className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Saldo</p>
                                <p className="mt-2 text-2xl font-black text-red-500">{formatCurrency(proveedor.saldoPendiente)}</p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Pendientes</p>
                                <p className="mt-2 text-2xl font-black text-slate-900">{proveedor.cantidadPendientes}</p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Abonado</p>
                                <p className="mt-2 text-2xl font-black text-emerald-600">{formatCurrency(proveedor.totalAbonado)}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.12),_transparent_22%),linear-gradient(180deg,_#f8fbff_0%,_#f6f8fc_100%)] p-6 max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.32em] text-blue-500">Modulo financiero</p>
                    <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900">
                        Cuentas por <span className="text-blue-600">Pagar</span>
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm text-slate-500">
                        Mantiene la misma operacion contable y de proveedores, pero con una vista mas clara para seguimiento y pagos.
                    </p>
                </div>
                <p className="text-slate-600 mt-2">Facturas de proveedores con asientos contables automáticos</p>
            </div>

            {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"><AlertCircle className="w-5 h-5" />{error}<button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button></div>}
            {success && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"><CheckCircle className="w-5 h-5" />{success}</div>}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 mb-6">
                <div className="rounded-[28px] bg-slate-900 px-6 py-5 text-white shadow-[0_22px_50px_-28px_rgba(15,23,42,0.85)]">
                    <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">Saldo total</p><TrendingDown className="h-4 w-4 text-rose-400" /></div>
                    <p className="mt-4 text-4xl font-black">{formatCurrency(resumenDashboard.saldoTotal)}</p>
                    <p className="mt-2 text-sm text-slate-400">{resumenDashboard.pendientes} factura{resumenDashboard.pendientes === 1 ? '' : 's'} pendientes</p>
                </div>
                <div className="rounded-[28px] border border-red-200 bg-white px-6 py-5 shadow-[0_22px_50px_-36px_rgba(248,113,113,0.45)]">
                    <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.24em] text-red-500">Vencidas</p><AlertCircle className="h-4 w-4 text-red-400" /></div>
                    <p className="mt-4 text-4xl font-black text-red-500">{formatCurrency(resumenDashboard.vencidasMonto)}</p>
                    <p className="mt-2 text-sm text-red-400">Requieren atencion inmediata · {resumenDashboard.vencidasCantidad} factura{resumenDashboard.vencidasCantidad === 1 ? '' : 's'}</p>
                </div>
                <div className="rounded-[28px] border border-amber-200 bg-white px-6 py-5 shadow-[0_22px_50px_-36px_rgba(251,191,36,0.45)]">
                    <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-500">Por vencer (3d)</p><Calendar className="h-4 w-4 text-amber-400" /></div>
                    <p className="mt-4 text-4xl font-black text-amber-500">{formatCurrency(resumenDashboard.porVencerMonto)}</p>
                    <p className="mt-2 text-sm text-amber-400">Proximas a vencer · {resumenDashboard.porVencerCantidad} factura{resumenDashboard.porVencerCantidad === 1 ? '' : 's'}</p>
                </div>
            </div>

            {/* Filtros */}
            <div className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700"><Building2 className="w-4 h-4 inline mr-1" />Proveedor</label>
                        <select value={proveedorSeleccionado} onChange={(e) => { setProveedorSeleccionado(e.target.value); setFacturasSeleccionadas([]); setSeleccionarTodas(false); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50">
                            <option value="">Todos los proveedores</option>
                            {proveedores.map(p => <option key={p.id} value={p.id}>{p.codigo} - {p.nombre}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-slate-700"><Search className="w-4 h-4 inline mr-1" />Buscar</label>
                        <input type="text" placeholder="Número de factura..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1"><Filter className="w-4 h-4 inline mr-1" />Estado</label>
                        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg">
                            <option value="">Todos</option>
                            <option value="conSaldo">Parcial + Pendientes</option>
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
                        <div><p className="text-slate-500">Facturas pendientes</p><p className="font-medium">{getTotalesProveedor(proveedorActual.id).cantidadFacturasPendientes}</p></div>
                    </div>
                )}
            </div>

            <div className="rounded-[28px] border border-white/70 bg-white/85 p-3 shadow-sm mb-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => { resetFacturaForm(); resetFacturaAdjuntos(); setShowFacturaModal(true); }} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"><Plus className="h-4 w-4" />Nueva Factura</button>
                    <button type="button" onClick={() => setActiveTab('estado')} className={`${tabBaseClass} ${activeTab === 'estado' ? 'bg-blue-600 text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.8)]' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}><TrendingDown className="h-4 w-4" />Estado</button>
                    <button type="button" onClick={() => setActiveTab('abonos')} className={`${tabBaseClass} ${activeTab === 'abonos' ? 'bg-blue-600 text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.8)]' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}><DollarSign className="h-4 w-4" />Abonos</button>
                    <button type="button" onClick={() => setActiveTab('proveedores')} className={`${tabBaseClass} ${activeTab === 'proveedores' ? 'bg-blue-600 text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.8)]' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}><Users className="h-4 w-4" />Proveedores</button>
                    {facturasSeleccionadas.length > 0 && (
                        <button onClick={() => { setAbonoForm(prev => ({ ...prev, montoTotal: totalAPagar })); setShowAbonoModal(true); }} className="ml-auto inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(16,185,129,0.9)] transition hover:bg-emerald-600">
                            <CheckCircle className="h-4 w-4" />
                            Abonar seleccionadas
                            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">{facturasSeleccionadas.length}</span>
                        </button>
                    )}
                </div>
            </div>

            {activeTab === 'estado' && renderEstadoTab()}
            {activeTab === 'abonos' && renderAbonosTab()}
            {activeTab === 'proveedores' && renderProveedoresTab()}

            {/* Modal Factura */}
            {showFacturaModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold">Nueva Factura</h2>
                            <button onClick={() => { setShowFacturaModal(false); resetFacturaAdjuntos(); }} className="p-2 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
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
                            <div className="rounded-xl border border-slate-200 p-4 space-y-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                            <Camera className="w-4 h-4 text-blue-600" />
                                            Imágenes de la factura
                                        </h3>
                                        <p className="text-xs text-slate-500 mt-1">Se guardarán junto a la factura para consultarlas después.</p>
                                    </div>
                                    <span className="text-sm text-slate-500">{facturaAdjuntos.length}/{MAX_FACTURA_IMAGES}</span>
                                </div>

                                <input
                                    ref={facturaFileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleFacturaAdjuntosSelect}
                                    className="hidden"
                                />

                                <button
                                    type="button"
                                    onClick={() => {
                                        if (facturaFileInputRef.current) {
                                            facturaFileInputRef.current.value = '';
                                            facturaFileInputRef.current.click();
                                        }
                                    }}
                                    className="w-full px-4 py-4 border-2 border-dashed border-slate-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors flex flex-col items-center gap-2"
                                >
                                    <Upload className="w-6 h-6 text-slate-400" />
                                    <span className="font-medium text-slate-700">Agregar imágenes</span>
                                    <span className="text-xs text-slate-500">JPG, PNG o WebP. Máximo 5MB por archivo.</span>
                                </button>

                                {facturaAdjuntos.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {facturaAdjuntos.map((adjunto, index) => (
                                            <div key={adjunto.id} className="rounded-xl border border-slate-200 overflow-hidden">
                                                <img
                                                    src={adjunto.previewUrl}
                                                    alt={adjunto.name || `Factura ${index + 1}`}
                                                    className="w-full h-36 object-cover bg-slate-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3 flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-slate-900 truncate">{adjunto.name || `Adjunto ${index + 1}`}</p>
                                                        <p className="text-xs text-slate-500">{(Number(adjunto.size || 0) / 1024 / 1024).toFixed(2)} MB</p>
                                                    </div>
                                                    <button type="button" onClick={() => removeFacturaAdjunto(adjunto.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button type="button" onClick={() => { setShowFacturaModal(false); resetFacturaAdjuntos(); }} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
                                <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Save className="w-5 h-5 inline mr-2" />Guardar Factura</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {facturaDetalle && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Factura {facturaDetalle.numeroFactura}</h2>
                                <p className="text-sm text-slate-500">{facturaDetalle.proveedorNombre || facturaDetalle.cuentaProveedorName || 'Entidad'}</p>
                            </div>
                            <button type="button" onClick={() => { setFacturaDetalle(null); setFacturaDetalleAdjuntos([]); }} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">Cerrar</button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                                    <p><span className="font-medium">Sucursal:</span> {facturaDetalle.sucursalName || 'General'}</p>
                                    <p><span className="font-medium">Fecha emisión:</span> {facturaDetalle.fechaEmision || '-'}</p>
                                    <p><span className="font-medium">Vencimiento:</span> {facturaDetalle.fechaVencimiento || '-'}</p>
                                    <p><span className="font-medium">Monto:</span> {formatCurrency(facturaDetalle.monto)}</p>
                                    <p><span className="font-medium">Saldo pendiente:</span> {formatCurrency(facturaDetalle.saldoPendiente)}</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                                    <p><span className="font-medium">Cuenta gasto/costo:</span> {facturaDetalle.cuentaGastoCode} - {facturaDetalle.cuentaGastoName}</p>
                                    <p><span className="font-medium">Cuenta por pagar:</span> {facturaDetalle.cuentaProveedorCode} - {facturaDetalle.cuentaProveedorName}</p>
                                    <p><span className="font-medium">Estado:</span> {facturaDetalle.estado || 'pendiente'}</p>
                                    {facturaDetalle.descripcion && <p><span className="font-medium">Descripción:</span> {facturaDetalle.descripcion}</p>}
                                </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 p-4">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                            <Image className="w-4 h-4 text-blue-600" />
                                            Imágenes adjuntas
                                        </h3>
                                        <p className="text-sm text-slate-500">Comprobantes guardados en la factura.</p>
                                    </div>
                                    {loadingFacturaDetalleAdjuntos && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
                                </div>

                                {!loadingFacturaDetalleAdjuntos && facturaDetalleAdjuntos.length === 0 && (
                                    <p className="text-sm text-slate-500">Esta factura no tiene imágenes adjuntas.</p>
                                )}

                                {facturaDetalleAdjuntos.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {facturaDetalleAdjuntos.map((item, index) => (
                                            <a
                                                key={item.attachmentId || item.url || index}
                                                href={item.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
                                            >
                                                <img
                                                    src={item.url}
                                                    alt={item.name || `Factura ${index + 1}`}
                                                    className="w-full h-56 object-cover bg-slate-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3">
                                                    <p className="text-sm font-medium text-slate-900 truncate">{item.name || `Adjunto ${index + 1}`}</p>
                                                    <p className="text-xs text-blue-600 mt-1">Abrir imagen completa</p>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
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
