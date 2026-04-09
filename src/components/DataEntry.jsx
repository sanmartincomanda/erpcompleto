// src/components/DataEntry.jsx
// CORREGIDO: Vinculación correcta al plan de cuentas actual + Selección de sucursal

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import { useBranches } from '../hooks/useBranches';
import { registerAccountingEntry, DOCUMENT_TYPES } from '../services/unifiedAccountingService';
import { collection, doc, getDoc, onSnapshot, query, setDoc, Timestamp, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import {
    createImageAttachment,
    createLocalImagePreviewItems,
    revokeLocalImagePreviewItems,
    resolveStoredImageEntries
} from '../utils/imageAttachments';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    Plus, 
    Save, 
    TrendingUp, 
    TrendingDown, 
    Calendar,
    DollarSign,
    FileText,
    Tag,
    Building2,
    Store,
    AlertCircle,
    CheckCircle,
    RefreshCw,
    Trash2,
    Search,
    Filter,
    ArrowLeft,
    Edit3,
    Eye,
    Image,
    CreditCard,
    User,
    Wallet,
    Landmark,
    Camera,
    Upload,
    X
} from 'lucide-react';

const MAX_DATA_ENTRY_IMAGES = 4;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const FormField = React.memo(({ label, icon: Icon, children, required }) => (
    <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
            {Icon && <Icon className="w-4 h-4 inline mr-1.5 text-gray-500" />}
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {children}
    </div>
));

const DataEntry = () => {
    const { user } = useAuth();
    const { branches, loading: loadingBranches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );
    
    const [activeTab, setActiveTab] = useState('ventas');
    const [historial, setHistorial] = useState([]);
    const [loading, setLoading] = useState(false);
    
    const [ventaForm, setVentaForm] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        sucursalId: '',
        sucursalName: '',
        descripcion: '',
        monto: '',
        moneda: 'NIO',
        tipoCambio: '36.50',
        metodoPago: 'efectivo',
        bancoId: '',
        cliente: '',
        factura: '',
        cuentaIngresoId: '',
        cuentaIngresoCode: '',
        cuentaIngresoName: ''
    });
    
    const [gastoForm, setGastoForm] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        sucursalId: '',
        sucursalName: '',
        descripcion: '',
        monto: '',
        moneda: 'NIO',
        tipoCambio: '36.50',
        metodoPago: 'efectivo',
        bancoId: '',
        proveedor: '',
        factura: '',
        cuentaGastoId: '',
        cuentaGastoCode: '',
        cuentaGastoName: '',
        cuentaPasivoId: '',
        cuentaPasivoCode: '',
        cuentaPasivoName: '',
        esCompraCredito: false
    });
    
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [ventaAdjuntos, setVentaAdjuntos] = useState([]);
    const [gastoAdjuntos, setGastoAdjuntos] = useState([]);
    const [detalleDocumento, setDetalleDocumento] = useState(null);
    const [detalleAdjuntos, setDetalleAdjuntos] = useState([]);
    const [loadingDetalleAdjuntos, setLoadingDetalleAdjuntos] = useState(false);
    const ventaFileInputRef = useRef(null);
    const gastoFileInputRef = useRef(null);
    const ventaAdjuntosRef = useRef([]);
    const gastoAdjuntosRef = useRef([]);

    const { 
        accounts,
        getIngresoAccounts,
        getGastoAccounts,
        getCajaAccounts,
        getBancoAccounts,
        getPasivoAccounts,
        getProveedoresAccount
    } = usePlanCuentas();

    const cuentasIngresos = useMemo(() => getIngresoAccounts(), [getIngresoAccounts]);
    const cuentasGastos = useMemo(() => getGastoAccounts(), [getGastoAccounts]);
    const cuentasCajaVenta = useMemo(
        () => getCajaAccounts(ventaForm.moneda),
        [getCajaAccounts, ventaForm.moneda]
    );
    const cuentasBancoVenta = useMemo(
        () => getBancoAccounts(ventaForm.moneda),
        [getBancoAccounts, ventaForm.moneda]
    );
    const cuentasCajaGasto = useMemo(
        () => getCajaAccounts(gastoForm.moneda),
        [getCajaAccounts, gastoForm.moneda]
    );
    const cuentasBancoGasto = useMemo(
        () => getBancoAccounts(gastoForm.moneda),
        [getBancoAccounts, gastoForm.moneda]
    );
    const cuentasPasivo = useMemo(() => getPasivoAccounts(), [getPasivoAccounts]);
    const cuentaPasivoPredeterminada = useMemo(
        () => getProveedoresAccount(),
        [getProveedoresAccount]
    );

    useEffect(() => {
        if (!cuentaPasivoPredeterminada || gastoForm.cuentaPasivoId) return;

        setGastoForm((prev) => ({
            ...prev,
            cuentaPasivoId: cuentaPasivoPredeterminada.id,
            cuentaPasivoCode: cuentaPasivoPredeterminada.code,
            cuentaPasivoName: cuentaPasivoPredeterminada.name
        }));
    }, [cuentaPasivoPredeterminada, gastoForm.cuentaPasivoId]);

    useEffect(() => {
        const loadHistorial = () => {
            const movimientosRef = collection(db, 'movimientosContables');
            const q = query(
                movimientosRef,
                where('moduloOrigen', 'in', ['dataEntry', 'ventaDirecta', 'gastoDirecto']),
                orderBy('timestamp', 'desc')
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setHistorial(data);
            });

            return unsubscribe;
        };

        const unsubscribe = loadHistorial();
        return () => unsubscribe && unsubscribe();
    }, []);

    useEffect(() => {
        ventaAdjuntosRef.current = ventaAdjuntos;
    }, [ventaAdjuntos]);

    useEffect(() => {
        gastoAdjuntosRef.current = gastoAdjuntos;
    }, [gastoAdjuntos]);

    useEffect(() => () => {
        revokeLocalImagePreviewItems(ventaAdjuntosRef.current);
        revokeLocalImagePreviewItems(gastoAdjuntosRef.current);
    }, []);

    const resetVentaAdjuntos = () => {
        revokeLocalImagePreviewItems(ventaAdjuntos);
        setVentaAdjuntos([]);
        if (ventaFileInputRef.current) {
            ventaFileInputRef.current.value = '';
        }
    };

    const resetGastoAdjuntos = () => {
        revokeLocalImagePreviewItems(gastoAdjuntos);
        setGastoAdjuntos([]);
        if (gastoFileInputRef.current) {
            gastoFileInputRef.current.value = '';
        }
    };

    const handleAdjuntosSelect = (event, currentItems, setItems, inputRef, prefix) => {
        const selectedFiles = Array.from(event.target.files || []);
        if (!selectedFiles.length) return;

        const totalFiles = currentItems.length + selectedFiles.length;
        if (totalFiles > MAX_DATA_ENTRY_IMAGES) {
            setError(`Puede adjuntar hasta ${MAX_DATA_ENTRY_IMAGES} imágenes por registro.`);
            if (inputRef?.current) inputRef.current.value = '';
            return;
        }

        for (const file of selectedFiles) {
            if (!file.type.startsWith('image/')) {
                setError(`"${file.name}" no es una imagen válida.`);
                if (inputRef?.current) inputRef.current.value = '';
                return;
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                setError(`"${file.name}" supera el máximo de 5MB.`);
                if (inputRef?.current) inputRef.current.value = '';
                return;
            }
        }

        const nuevosAdjuntos = createLocalImagePreviewItems(selectedFiles, prefix);
        setItems((prev) => [...prev, ...nuevosAdjuntos]);
        setError(null);

        if (inputRef?.current) {
            inputRef.current.value = '';
        }
    };

    const removeAdjunto = (attachmentId, items, setItems, inputRef) => {
        const adjunto = items.find((item) => item.id === attachmentId);
        if (adjunto?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(adjunto.previewUrl);
        }
        setItems((prev) => prev.filter((item) => item.id !== attachmentId));
        if (inputRef?.current) {
            inputRef.current.value = '';
        }
    };

    const persistAdjuntos = async (items, entityType, entityId, category) =>
        Promise.all(
            items.map((item) =>
                createImageAttachment({
                    file: item.file,
                    entityType,
                    entityId,
                    category,
                    fileName: item.name,
                    userId: user?.uid,
                    userEmail: user?.email
                })
            )
        );

    const openDetalleDocumento = async (movimiento) => {
        if (!movimiento?.documentoId) return;

        const configByType = {
            [DOCUMENT_TYPES.INGRESO]: {
                collectionName: 'ventasDirectas',
                title: 'Detalle de ingreso'
            },
            [DOCUMENT_TYPES.GASTO]: {
                collectionName: 'gastosDirectos',
                title: 'Detalle de gasto'
            },
            [DOCUMENT_TYPES.FACTURA_PROVEEDOR]: {
                collectionName: 'facturasProveedor',
                title: 'Detalle de gasto a crédito'
            }
        };

        const config = configByType[movimiento.documentoTipo];
        if (!config) {
            setError('No hay detalle disponible para este movimiento.');
            return;
        }

        setLoadingDetalleAdjuntos(true);

        try {
            const documentSnap = await getDoc(doc(db, config.collectionName, movimiento.documentoId));
            if (!documentSnap.exists()) {
                throw new Error('No se encontró el documento origen de este movimiento.');
            }

            const documentData = { id: documentSnap.id, ...documentSnap.data() };
            const adjuntos = await resolveStoredImageEntries(documentData.adjuntos || []);

            setDetalleDocumento({
                ...documentData,
                title: config.title,
                tipoDocumento: movimiento.documentoTipo
            });
            setDetalleAdjuntos(adjuntos);
        } catch (detailError) {
            console.error('Error cargando detalle de Data Entry:', detailError);
            setError(detailError.message || 'No se pudo cargar el detalle del documento.');
        } finally {
            setLoadingDetalleAdjuntos(false);
        }
    };

    const handleRegistrarVenta = async (e) => {
        e.preventDefault();
        
        if (!ventaForm.cuentaIngresoId) {
            setError('Debe seleccionar una cuenta de ingreso');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const monto = Number(ventaForm.monto);
            const montoUSD = ventaForm.moneda === 'USD' ? monto : 0;
            const montoNIO = ventaForm.moneda === 'NIO' ? monto : monto * Number(ventaForm.tipoCambio);

            let cuentaDestino = null;
            if (ventaForm.metodoPago === 'efectivo') {
                cuentaDestino = cuentasCajaVenta[0];
            } else if (ventaForm.bancoId) {
                cuentaDestino = cuentasBancoVenta.find(b => b.id === ventaForm.bancoId);
            }

            if (!cuentaDestino) {
                throw new Error('No se encontró cuenta de destino para el método de pago seleccionado');
            }

            const movimientos = [
                {
                    cuentaId: cuentaDestino.id,
                    cuentaCode: cuentaDestino.code,
                    cuentaName: cuentaDestino.name,
                    tipo: 'DEBITO',
                    monto: montoNIO,
                    montoUSD: montoUSD,
                    descripcion: `Venta - ${ventaForm.descripcion}`
                },
                {
                    cuentaId: ventaForm.cuentaIngresoId,
                    cuentaCode: ventaForm.cuentaIngresoCode,
                    cuentaName: ventaForm.cuentaIngresoName,
                    tipo: 'CREDITO',
                    monto: montoNIO,
                    montoUSD: montoUSD,
                    descripcion: `Ingreso por venta - ${ventaForm.cliente || 'Contado'}`
                }
            ];

            const ventaRef = doc(collection(db, 'ventasDirectas'));
            const referenciaVenta = ventaForm.factura || `VTA-${ventaRef.id.slice(0, 8).toUpperCase()}`;
            const ventaAdjuntosGuardados = await persistAdjuntos(
                ventaAdjuntos,
                'dataEntryIngreso',
                ventaRef.id,
                'comprobanteIngreso'
            );

            const entry = await registerAccountingEntry({
                fecha: ventaForm.fecha,
                descripcion: `Venta: ${ventaForm.descripcion}`,
                referencia: referenciaVenta,
                documentoId: ventaRef.id,
                documentoTipo: DOCUMENT_TYPES.INGRESO,
                moduloOrigen: 'dataEntry',
                userId: user.uid,
                userEmail: user.email,
                movimientos,
                metadata: {
                    cliente: ventaForm.cliente,
                    factura: ventaForm.factura,
                    metodoPago: ventaForm.metodoPago,
                    moneda: ventaForm.moneda,
                    adjuntosCount: ventaAdjuntosGuardados.length,
                    sucursalId: ventaForm.sucursalId,
                    sucursalName: ventaForm.sucursalName
                }
            });

            await setDoc(ventaRef, {
                documentoId: ventaRef.id,
                fecha: ventaForm.fecha,
                descripcion: ventaForm.descripcion,
                monto: montoNIO,
                montoUSD: montoUSD,
                moneda: ventaForm.moneda,
                metodoPago: ventaForm.metodoPago,
                cliente: ventaForm.cliente,
                factura: ventaForm.factura,
                cuentaIngresoId: ventaForm.cuentaIngresoId,
                cuentaIngresoCode: ventaForm.cuentaIngresoCode,
                cuentaIngresoName: ventaForm.cuentaIngresoName,
                cuentaDestinoId: cuentaDestino.id,
                cuentaDestinoCode: cuentaDestino.code,
                cuentaDestinoName: cuentaDestino.name,
                sucursalId: ventaForm.sucursalId,
                sucursalName: ventaForm.sucursalName,
                adjuntos: ventaAdjuntosGuardados,
                asientoId: entry.asientoId,
                movimientosContablesIds: entry.movimientos.map(m => m.id),
                createdAt: Timestamp.now(),
                createdBy: user.uid,
                createdByEmail: user.email
            });

            setSuccess('Venta registrada exitosamente');
            
            setVentaForm({
                fecha: format(new Date(), 'yyyy-MM-dd'),
                sucursalId: '',
                sucursalName: '',
                descripcion: '',
                monto: '',
                moneda: 'NIO',
                tipoCambio: '36.50',
                metodoPago: 'efectivo',
                bancoId: '',
                cliente: '',
                factura: '',
                cuentaIngresoId: '',
                cuentaIngresoCode: '',
                cuentaIngresoName: ''
            });
            resetVentaAdjuntos();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error registrando venta:', err);
            setError(err.message || 'Error al registrar la venta');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRegistrarGasto = async (e) => {
        e.preventDefault();
        
        if (!gastoForm.cuentaGastoId) {
            setError('Debe seleccionar una cuenta de gasto');
            return;
        }

        if (gastoForm.esCompraCredito && !gastoForm.cuentaPasivoId) {
            setError('Debe seleccionar la cuenta por pagar u obligacion');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const monto = Number(gastoForm.monto);
            const montoUSD = gastoForm.moneda === 'USD' ? monto : 0;
            const montoNIO = gastoForm.moneda === 'NIO' ? monto : monto * Number(gastoForm.tipoCambio);

            let cuentaOrigen = null;
            if (gastoForm.metodoPago === 'efectivo') {
                cuentaOrigen = cuentasCajaGasto[0];
            } else if (gastoForm.bancoId) {
                cuentaOrigen = cuentasBancoGasto.find(b => b.id === gastoForm.bancoId);
            }

            if (!cuentaOrigen && !gastoForm.esCompraCredito) {
                throw new Error('No se encontró cuenta de origen para el método de pago seleccionado');
            }

            const movimientos = [];
            const gastoRef = doc(collection(db, 'gastosDirectos'));
            const facturaProveedorRef = gastoForm.esCompraCredito
                ? doc(collection(db, 'facturasProveedor'))
                : null;
            const documentoContableId = facturaProveedorRef?.id || gastoRef.id;
            const documentoContableTipo = gastoForm.esCompraCredito
                ? DOCUMENT_TYPES.FACTURA_PROVEEDOR
                : DOCUMENT_TYPES.GASTO;
            const gastoAdjuntosGuardados = await persistAdjuntos(
                gastoAdjuntos,
                gastoForm.esCompraCredito ? 'dataEntryFacturaProveedor' : 'dataEntryGasto',
                documentoContableId,
                gastoForm.esCompraCredito ? 'facturaProveedor' : 'comprobanteGasto'
            );

            if (gastoForm.esCompraCredito) {
                movimientos.push(
                    {
                        cuentaId: gastoForm.cuentaGastoId,
                        cuentaCode: gastoForm.cuentaGastoCode,
                        cuentaName: gastoForm.cuentaGastoName,
                        tipo: 'DEBITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Gasto: ${gastoForm.descripcion}`
                    },
                    {
                        cuentaId: gastoForm.cuentaPasivoId,
                        cuentaCode: gastoForm.cuentaPasivoCode,
                        cuentaName: gastoForm.cuentaPasivoName,
                        tipo: 'CREDITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Por pagar a ${gastoForm.proveedor || gastoForm.cuentaPasivoName || 'Entidad'}`
                    }
                );
            } else {
                movimientos.push(
                    {
                        cuentaId: gastoForm.cuentaGastoId,
                        cuentaCode: gastoForm.cuentaGastoCode,
                        cuentaName: gastoForm.cuentaGastoName,
                        tipo: 'DEBITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Gasto: ${gastoForm.descripcion}`
                    },
                    {
                        cuentaId: cuentaOrigen.id,
                        cuentaCode: cuentaOrigen.code,
                        cuentaName: cuentaOrigen.name,
                        tipo: 'CREDITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Pago de gasto: ${gastoForm.descripcion}`
                    }
                );
            }

            const referenciaGasto = gastoForm.factura || `GTO-${gastoRef.id.slice(0, 8).toUpperCase()}`;

            const entry = await registerAccountingEntry({
                fecha: gastoForm.fecha,
                descripcion: `Gasto: ${gastoForm.descripcion}`,
                referencia: referenciaGasto,
                documentoId: documentoContableId,
                documentoTipo: documentoContableTipo,
                moduloOrigen: 'dataEntry',
                userId: user.uid,
                userEmail: user.email,
                movimientos,
                metadata: {
                    proveedor: gastoForm.proveedor,
                    factura: gastoForm.factura,
                    metodoPago: gastoForm.metodoPago,
                    moneda: gastoForm.moneda,
                    esCompraCredito: gastoForm.esCompraCredito,
                    adjuntosCount: gastoAdjuntosGuardados.length,
                    gastoDirectoId: gastoRef.id,
                    facturaProveedorId: facturaProveedorRef?.id || null,
                    sucursalId: gastoForm.sucursalId,
                    sucursalName: gastoForm.sucursalName
                }
            });

            await setDoc(gastoRef, {
                documentoId: gastoRef.id,
                fecha: gastoForm.fecha,
                descripcion: gastoForm.descripcion,
                monto: montoNIO,
                montoUSD: montoUSD,
                moneda: gastoForm.moneda,
                metodoPago: gastoForm.metodoPago,
                proveedor: gastoForm.proveedor,
                factura: gastoForm.factura,
                cuentaGastoId: gastoForm.cuentaGastoId,
                cuentaGastoCode: gastoForm.cuentaGastoCode,
                cuentaGastoName: gastoForm.cuentaGastoName,
                cuentaPasivoId: gastoForm.cuentaPasivoId || null,
                cuentaPasivoCode: gastoForm.cuentaPasivoCode || null,
                cuentaPasivoName: gastoForm.cuentaPasivoName || null,
                esCompraCredito: gastoForm.esCompraCredito,
                cuentaOrigenId: cuentaOrigen?.id,
                cuentaOrigenCode: cuentaOrigen?.code,
                cuentaOrigenName: cuentaOrigen?.name,
                sucursalId: gastoForm.sucursalId,
                sucursalName: gastoForm.sucursalName,
                adjuntos: gastoAdjuntosGuardados,
                asientoId: entry.asientoId,
                movimientosContablesIds: entry.movimientos.map(m => m.id),
                facturaProveedorId: facturaProveedorRef?.id || null,
                createdAt: Timestamp.now(),
                createdBy: user.uid,
                createdByEmail: user.email
            });

            if (gastoForm.esCompraCredito && facturaProveedorRef) {
                await setDoc(facturaProveedorRef, {
                    documentoId: facturaProveedorRef.id,
                    origenModulo: 'dataEntry',
                    gastoDirectoId: gastoRef.id,
                    proveedorId: '',
                    proveedorNombre: gastoForm.proveedor || gastoForm.cuentaPasivoName || 'Entidad',
                    proveedorCodigo: '',
                    sucursalId: gastoForm.sucursalId,
                    sucursalName: gastoForm.sucursalName,
                    numeroFactura: gastoForm.factura || referenciaGasto,
                    fechaEmision: gastoForm.fecha,
                    fechaVencimiento: gastoForm.fecha,
                    monto: montoNIO,
                    saldoPendiente: montoNIO,
                    montoAbonado: 0,
                    descripcion: gastoForm.descripcion,
                    cuentaGastoId: gastoForm.cuentaGastoId,
                    cuentaGastoCode: gastoForm.cuentaGastoCode,
                    cuentaGastoName: gastoForm.cuentaGastoName,
                    cuentaProveedorId: gastoForm.cuentaPasivoId,
                    cuentaProveedorCode: gastoForm.cuentaPasivoCode,
                    cuentaProveedorName: gastoForm.cuentaPasivoName,
                    estado: 'pendiente',
                    adjuntos: gastoAdjuntosGuardados,
                    asientoId: entry.asientoId,
                    movimientosContablesIds: entry.movimientos.map((m) => m.id),
                    createdAt: Timestamp.now(),
                    createdBy: user.uid,
                    createdByEmail: user.email
                });
            }

            setSuccess(
                gastoForm.esCompraCredito
                    ? 'Gasto a credito registrado y enviado a cuentas por pagar'
                    : 'Gasto registrado exitosamente'
            );
            
            setGastoForm({
                fecha: format(new Date(), 'yyyy-MM-dd'),
                sucursalId: '',
                sucursalName: '',
                descripcion: '',
                monto: '',
                moneda: 'NIO',
                tipoCambio: '36.50',
                metodoPago: 'efectivo',
                bancoId: '',
                proveedor: '',
                factura: '',
                cuentaGastoId: '',
                cuentaGastoCode: '',
                cuentaGastoName: '',
                cuentaPasivoId: cuentaPasivoPredeterminada?.id || '',
                cuentaPasivoCode: cuentaPasivoPredeterminada?.code || '',
                cuentaPasivoName: cuentaPasivoPredeterminada?.name || '',
                esCompraCredito: false
            });
            resetGastoAdjuntos();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error registrando gasto:', err);
            setError(err.message || 'Error al registrar el gasto');
        } finally {
            setSubmitting(false);
        }
    };

    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    const renderAdjuntosSection = ({ title, items, onPick, onRemove, inputRef }) => (
        <div className="bg-gray-50 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                        <Camera className="w-4 h-4" />
                        {title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                        Adjunte hasta {MAX_DATA_ENTRY_IMAGES} imágenes. Se guardarán con el documento para consultarlas después.
                    </p>
                </div>
                <span className="text-sm text-gray-500">{items.length}/{MAX_DATA_ENTRY_IMAGES}</span>
            </div>

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPick}
            />

            <button
                type="button"
                onClick={() => {
                    if (inputRef.current) {
                        inputRef.current.value = '';
                        inputRef.current.click();
                    }
                }}
                className="w-full px-4 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-white transition-colors flex flex-col items-center justify-center gap-2"
            >
                <Upload className="w-6 h-6 text-gray-400" />
                <span className="font-medium text-gray-700">Agregar imágenes</span>
                <span className="text-xs text-gray-500">JPG, PNG o WebP. Máximo 5MB por archivo.</span>
            </button>

            {items.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    {items.map((item, index) => (
                        <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <img
                                src={item.previewUrl}
                                alt={item.name || `Adjunto ${index + 1}`}
                                className="w-full h-44 object-cover bg-gray-100"
                                loading="lazy"
                            />
                            <div className="p-3 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{item.name || `Adjunto ${index + 1}`}</p>
                                    <p className="text-xs text-gray-500">{(Number(item.size || 0) / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(item.id)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                    title="Quitar imagen"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderVentaForm = () => (
        <form onSubmit={handleRegistrarVenta} className="space-y-6">
            {/* Sección: Información General */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Información General
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Fecha" icon={Calendar} required>
                        <input
                            type="date"
                            value={ventaForm.fecha}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, fecha: e.target.value }))}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                        />
                    </FormField>
                    <FormField label="Sucursal" icon={Store} required>
                        <select
                            value={ventaForm.sucursalId}
                            disabled={loadingBranches}
                            onChange={(e) => {
                                const sucursal = sucursalesActivas.find((s) => s.id === e.target.value);
                                setVentaForm(prev => ({ 
                                    ...prev, 
                                    sucursalId: e.target.value,
                                    sucursalName: sucursal?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione...</option>
                            {sucursalesActivas.map((sucursal) => (
                                <option key={sucursal.id} value={sucursal.id}>
                                    {sucursal.name}
                                </option>
                            ))}
                        </select>
                    </FormField>
                    <FormField label="Moneda" icon={DollarSign}>
                        <select
                            value={ventaForm.moneda}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, moneda: e.target.value }))}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="NIO">Córdobas (NIO)</option>
                            <option value="USD">Dólares (USD)</option>
                        </select>
                    </FormField>
                </div>
            </div>

            {/* Sección: Detalle de la Venta */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Detalle de la Venta
                </h3>
                <div className="space-y-4">
                    <FormField label="Descripción" icon={FileText} required>
                        <input
                            type="text"
                            value={ventaForm.descripcion}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, descripcion: e.target.value }))}
                            placeholder="Descripción de la venta"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </FormField>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Monto" icon={DollarSign} required>
                            <input
                                type="number"
                                step="0.01"
                                value={ventaForm.monto}
                                onChange={(e) => setVentaForm(prev => ({ ...prev, monto: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </FormField>
                        {ventaForm.moneda === 'USD' && (
                            <FormField label="Tipo de Cambio">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={ventaForm.tipoCambio}
                                    onChange={(e) => setVentaForm(prev => ({ ...prev, tipoCambio: e.target.value }))}
                                    placeholder="36.50"
                                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </FormField>
                        )}
                    </div>

                    <FormField label="Cuenta de Ingreso" icon={TrendingUp} required>
                        <select
                            value={ventaForm.cuentaIngresoId}
                            onChange={(e) => {
                                const cuenta = cuentasIngresos.find(c => c.id === e.target.value);
                                setVentaForm(prev => ({
                                    ...prev,
                                    cuentaIngresoId: e.target.value,
                                    cuentaIngresoCode: cuenta?.code || '',
                                    cuentaIngresoName: cuenta?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione una cuenta...</option>
                            {cuentasIngresos.map(cuenta => (
                                <option key={cuenta.id} value={cuenta.id}>
                                    {cuenta.code} - {cuenta.name}
                                </option>
                            ))}
                        </select>
                    </FormField>
                </div>
            </div>

            {/* Sección: Método de Pago */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Método de Pago
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Método de Pago">
                        <select
                            value={ventaForm.metodoPago}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, metodoPago: e.target.value, bancoId: '' }))}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="efectivo">Efectivo</option>
                            <option value="transferencia">Transferencia Bancaria</option>
                            <option value="pos">POS</option>
                        </select>
                    </FormField>
                    {ventaForm.metodoPago !== 'efectivo' && (
                        <FormField label="Banco" icon={Building2} required={ventaForm.metodoPago !== 'efectivo'}>
                            <select
                                value={ventaForm.bancoId}
                                onChange={(e) => setVentaForm(prev => ({ ...prev, bancoId: e.target.value }))}
                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                required={ventaForm.metodoPago !== 'efectivo'}
                            >
                                <option value="">Seleccione un banco...</option>
                                {cuentasBancoVenta.map(banco => (
                                    <option key={banco.id} value={banco.id}>
                                        {banco.code} - {banco.name}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                    )}
                </div>
            </div>

            {/* Sección: Información Adicional */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Información Adicional
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Cliente">
                        <input
                            type="text"
                            value={ventaForm.cliente}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, cliente: e.target.value }))}
                            placeholder="Nombre del cliente"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </FormField>
                    <FormField label="N° Factura" icon={Tag}>
                        <input
                            type="text"
                            value={ventaForm.factura}
                            onChange={(e) => setVentaForm(prev => ({ ...prev, factura: e.target.value }))}
                            placeholder="Número de factura"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </FormField>
                </div>
            </div>

            {renderAdjuntosSection({
                title: 'Imágenes del ingreso',
                items: ventaAdjuntos,
                onPick: (event) =>
                    handleAdjuntosSelect(event, ventaAdjuntos, setVentaAdjuntos, ventaFileInputRef, 'venta'),
                onRemove: (attachmentId) =>
                    removeAdjunto(attachmentId, ventaAdjuntos, setVentaAdjuntos, ventaFileInputRef),
                inputRef: ventaFileInputRef
            })}

            {/* Mensajes */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
            >
                {submitting ? (
                    <><RefreshCw className="w-5 h-5 animate-spin" /> Registrando...</>
                ) : (
                    <><TrendingUp className="w-5 h-5" /> Registrar Venta</>
                )}
            </button>
        </form>
    );

    const renderGastoForm = () => (
        <form onSubmit={handleRegistrarGasto} className="space-y-6">
            {/* Sección: Información General */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Información General
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField label="Fecha" icon={Calendar} required>
                        <input
                            type="date"
                            value={gastoForm.fecha}
                            onChange={(e) => setGastoForm(prev => ({ ...prev, fecha: e.target.value }))}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </FormField>
                    <FormField label="Sucursal" icon={Store} required>
                        <select
                            value={gastoForm.sucursalId}
                            disabled={loadingBranches}
                            onChange={(e) => {
                                const sucursal = sucursalesActivas.find((s) => s.id === e.target.value);
                                setGastoForm(prev => ({ 
                                    ...prev, 
                                    sucursalId: e.target.value,
                                    sucursalName: sucursal?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione...</option>
                            {sucursalesActivas.map((sucursal) => (
                                <option key={sucursal.id} value={sucursal.id}>
                                    {sucursal.name}
                                </option>
                            ))}
                        </select>
                    </FormField>
                    <FormField label="Moneda" icon={DollarSign}>
                        <select
                            value={gastoForm.moneda}
                            onChange={(e) => setGastoForm(prev => ({ ...prev, moneda: e.target.value }))}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="NIO">Córdobas (NIO)</option>
                            <option value="USD">Dólares (USD)</option>
                        </select>
                    </FormField>
                </div>
            </div>

            {/* Sección: Detalle del Gasto */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    Detalle del Gasto
                </h3>
                <div className="space-y-4">
                    <FormField label="Descripción" icon={FileText} required>
                        <input
                            type="text"
                            value={gastoForm.descripcion}
                            onChange={(e) => setGastoForm(prev => ({ ...prev, descripcion: e.target.value }))}
                            placeholder="Descripción del gasto"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </FormField>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Monto" icon={DollarSign} required>
                            <input
                                type="number"
                                step="0.01"
                                value={gastoForm.monto}
                                onChange={(e) => setGastoForm(prev => ({ ...prev, monto: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </FormField>
                        {gastoForm.moneda === 'USD' && (
                            <FormField label="Tipo de Cambio">
                                <input
                                    type="number"
                                    step="0.01"
                                    value={gastoForm.tipoCambio}
                                    onChange={(e) => setGastoForm(prev => ({ ...prev, tipoCambio: e.target.value }))}
                                    placeholder="36.50"
                                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </FormField>
                        )}
                    </div>

                    <FormField label="Cuenta de Gasto" icon={TrendingDown} required>
                        <select
                            value={gastoForm.cuentaGastoId}
                            onChange={(e) => {
                                const cuenta = cuentasGastos.find(c => c.id === e.target.value);
                                setGastoForm(prev => ({
                                    ...prev,
                                    cuentaGastoId: e.target.value,
                                    cuentaGastoCode: cuenta?.code || '',
                                    cuentaGastoName: cuenta?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione una cuenta...</option>
                            {cuentasGastos.map(cuenta => (
                                <option key={cuenta.id} value={cuenta.id}>
                                    {cuenta.code} - {cuenta.name}
                                </option>
                            ))}
                        </select>
                    </FormField>
                </div>
            </div>

            {/* Opción de compra a crédito */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={gastoForm.esCompraCredito}
                        onChange={(e) => setGastoForm(prev => ({ ...prev, esCompraCredito: e.target.checked }))}
                        className="w-5 h-5 text-blue-600 mt-0.5"
                    />
                    <div>
                        <span className="font-medium text-gray-800">Es una compra a crédito</span>
                        <p className="text-sm text-gray-600 mt-1">
                            Se registrará en Proveedores (2.01.01.01) en lugar de descontar de caja/banco
                        </p>
                    </div>
                </label>
            </div>

            {/* Sección: Método de Pago */}
            {gastoForm.esCompraCredito && (
                <div className="bg-gray-50 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                        <Landmark className="w-4 h-4" />
                        Cuenta por Pagar
                    </h3>
                    <FormField label="Cuenta por pagar / obligacion" icon={Building2} required>
                        <select
                            value={gastoForm.cuentaPasivoId}
                            onChange={(e) => {
                                const cuenta = cuentasPasivo.find((c) => c.id === e.target.value);
                                setGastoForm((prev) => ({
                                    ...prev,
                                    cuentaPasivoId: e.target.value,
                                    cuentaPasivoCode: cuenta?.code || '',
                                    cuentaPasivoName: cuenta?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione una cuenta...</option>
                            {cuentasPasivo.map((cuenta) => (
                                <option key={cuenta.id} value={cuenta.id}>
                                    {cuenta.code} - {cuenta.name}
                                </option>
                            ))}
                        </select>
                    </FormField>
                </div>
            )}

            {!gastoForm.esCompraCredito && (
                <div className="bg-gray-50 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        Método de Pago
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField label="Método de Pago">
                            <select
                                value={gastoForm.metodoPago}
                                onChange={(e) => setGastoForm(prev => ({ ...prev, metodoPago: e.target.value, bancoId: '' }))}
                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="efectivo">Efectivo</option>
                                <option value="transferencia">Transferencia Bancaria</option>
                                <option value="cheque">Cheque</option>
                            </select>
                        </FormField>
                        {gastoForm.metodoPago !== 'efectivo' && (
                            <FormField label="Banco" icon={Building2} required={gastoForm.metodoPago !== 'efectivo'}>
                                <select
                                    value={gastoForm.bancoId}
                                    onChange={(e) => setGastoForm(prev => ({ ...prev, bancoId: e.target.value }))}
                                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required={gastoForm.metodoPago !== 'efectivo'}
                                >
                                    <option value="">Seleccione un banco...</option>
                                    {cuentasBancoGasto.map(banco => (
                                        <option key={banco.id} value={banco.id}>
                                            {banco.code} - {banco.name}
                                        </option>
                                    ))}
                                </select>
                            </FormField>
                        )}
                    </div>
                </div>
            )}

            {/* Sección: Información Adicional */}
            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Información Adicional
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label={gastoForm.esCompraCredito ? 'Proveedor / Entidad' : 'Proveedor'}>
                        <input
                            type="text"
                            value={gastoForm.proveedor}
                            onChange={(e) => setGastoForm(prev => ({ ...prev, proveedor: e.target.value }))}
                            placeholder="Nombre del proveedor"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </FormField>
                    <FormField label="N° Factura" icon={Tag}>
                        <input
                            type="text"
                            value={gastoForm.factura}
                            onChange={(e) => setGastoForm(prev => ({ ...prev, factura: e.target.value }))}
                            placeholder="Número de factura"
                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </FormField>
                </div>
            </div>

            {renderAdjuntosSection({
                title: gastoForm.esCompraCredito ? 'Imágenes de la factura / gasto a crédito' : 'Imágenes del gasto',
                items: gastoAdjuntos,
                onPick: (event) =>
                    handleAdjuntosSelect(event, gastoAdjuntos, setGastoAdjuntos, gastoFileInputRef, 'gasto'),
                onRemove: (attachmentId) =>
                    removeAdjunto(attachmentId, gastoAdjuntos, setGastoAdjuntos, gastoFileInputRef),
                inputRef: gastoFileInputRef
            })}

            {/* Mensajes */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
            >
                {submitting ? (
                    <><RefreshCw className="w-5 h-5 animate-spin" /> Registrando...</>
                ) : (
                    <><TrendingDown className="w-5 h-5" /> Registrar Gasto</>
                )}
            </button>
        </form>
    );

    const renderHistorial = () => (
        <div className="space-y-4">
            {historial.length === 0 ? (
                <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl">
                    <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No hay registros en el historial</p>
                </div>
            ) : (
                <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Fecha</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Descripción</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Cuenta</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Monto</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Tipo</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {historial.slice(0, 50).map((mov) => (
                                <tr key={mov.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm text-gray-600">{mov.fecha}</td>
                                    <td className="px-4 py-3 text-sm">{mov.descripcion}</td>
                                    <td className="px-4 py-3 text-sm">{mov.accountCode} - {mov.accountName}</td>
                                    <td className={`px-4 py-3 text-sm text-right font-medium ${
                                        mov.type === 'DEBITO' ? 'text-red-600' : 'text-green-600'
                                    }`}>
                                        {mov.type === 'DEBITO' ? '-' : '+'}
                                        {formatCurrency(mov.monto)}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 rounded-full text-xs ${
                                            mov.type === 'DEBITO' 
                                                ? 'bg-red-100 text-red-800' 
                                                : 'bg-green-100 text-green-800'
                                        }`}>
                                            {mov.type === 'DEBITO' ? 'Débito' : 'Crédito'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            type="button"
                                            onClick={() => openDetalleDocumento(mov)}
                                            className="inline-flex items-center justify-center p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                            title="Ver detalle"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Plus className="w-6 h-6 text-blue-600" />
                    </div>
                    Data Entry - Ventas y Gastos
                </h1>
                <p className="text-gray-600 mt-2 ml-13">
                    Registre ventas y gastos directamente vinculados al plan de cuentas
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-gray-200">
                <button
                    onClick={() => { setActiveTab('ventas'); setError(null); setSuccess(null); }}
                    className={`px-5 py-3 font-medium flex items-center gap-2 transition-all border-b-2 ${
                        activeTab === 'ventas' 
                            ? 'text-green-600 border-green-600 bg-green-50' 
                            : 'text-gray-600 border-transparent hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <TrendingUp className="w-4 h-4" />
                    Registrar Venta
                </button>
                <button
                    onClick={() => { setActiveTab('gastos'); setError(null); setSuccess(null); }}
                    className={`px-5 py-3 font-medium flex items-center gap-2 transition-all border-b-2 ${
                        activeTab === 'gastos' 
                            ? 'text-red-600 border-red-600 bg-red-50' 
                            : 'text-gray-600 border-transparent hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <TrendingDown className="w-4 h-4" />
                    Registrar Gasto
                </button>
                <button
                    onClick={() => { setActiveTab('historial'); setError(null); setSuccess(null); }}
                    className={`px-5 py-3 font-medium flex items-center gap-2 transition-all border-b-2 ${
                        activeTab === 'historial' 
                            ? 'text-blue-600 border-blue-600 bg-blue-50' 
                            : 'text-gray-600 border-transparent hover:text-gray-800 hover:bg-gray-50'
                    }`}
                >
                    <FileText className="w-4 h-4" />
                    Historial
                </button>
            </div>

            {/* Contenido */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {activeTab === 'ventas' && renderVentaForm()}
                {activeTab === 'gastos' && renderGastoForm()}
                {activeTab === 'historial' && renderHistorial()}
            </div>

            {detalleDocumento && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
                        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">{detalleDocumento.title}</h2>
                                <p className="text-sm text-gray-500">{detalleDocumento.descripcion || detalleDocumento.numeroFactura || detalleDocumento.factura || detalleDocumento.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setDetalleDocumento(null);
                                    setDetalleAdjuntos([]);
                                }}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                Cerrar
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                                    <p><span className="font-medium">Fecha:</span> {detalleDocumento.fecha || detalleDocumento.fechaEmision || '-'}</p>
                                    <p><span className="font-medium">Sucursal:</span> {detalleDocumento.sucursalName || 'Sin sucursal'}</p>
                                    <p><span className="font-medium">Monto:</span> {formatCurrency(detalleDocumento.monto, detalleDocumento.moneda || 'NIO')}</p>
                                    <p><span className="font-medium">Moneda:</span> {detalleDocumento.moneda || 'NIO'}</p>
                                </div>
                                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                                    <p><span className="font-medium">Referencia:</span> {detalleDocumento.factura || detalleDocumento.numeroFactura || detalleDocumento.documentoId || '-'}</p>
                                    <p><span className="font-medium">Cliente / Proveedor:</span> {detalleDocumento.cliente || detalleDocumento.proveedorNombre || detalleDocumento.proveedor || '-'}</p>
                                    <p><span className="font-medium">Cuenta principal:</span> {detalleDocumento.cuentaIngresoCode || detalleDocumento.cuentaGastoCode || '-'} {detalleDocumento.cuentaIngresoName || detalleDocumento.cuentaGastoName || ''}</p>
                                    {detalleDocumento.metodoPago && <p><span className="font-medium">Método:</span> {detalleDocumento.metodoPago}</p>}
                                </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 p-4">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                            <Image className="w-4 h-4 text-blue-600" />
                                            Imágenes adjuntas
                                        </h3>
                                        <p className="text-sm text-gray-500">Comprobantes guardados junto al documento.</p>
                                    </div>
                                    {loadingDetalleAdjuntos && <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />}
                                </div>

                                {!loadingDetalleAdjuntos && detalleAdjuntos.length === 0 && (
                                    <p className="text-sm text-gray-500">Este documento no tiene imágenes adjuntas.</p>
                                )}

                                {detalleAdjuntos.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {detalleAdjuntos.map((item, index) => (
                                            <a
                                                key={item.attachmentId || item.url || index}
                                                href={item.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                                            >
                                                <img
                                                    src={item.url}
                                                    alt={item.name || `Adjunto ${index + 1}`}
                                                    className="w-full h-56 object-cover bg-gray-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3">
                                                    <p className="text-sm font-medium text-gray-900 truncate">{item.name || `Adjunto ${index + 1}`}</p>
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
        </div>
    );
};

export default DataEntry;
