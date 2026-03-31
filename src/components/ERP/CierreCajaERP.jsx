// src/components/CierreCajaERP.jsx
// CORREGIDO: Agregada selección de cuenta de efectivo y modo lectura para cierres completados

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { usePlanCuentas } from '../../hooks/useUnifiedAccounting';
import { useBranches } from '../../hooks/useBranches';
import { 
    createCierreCajaERP, 
    updateCierreCajaERPStatus, 
    procesarCierreCajaERP 
} from '../../services/unifiedAccountingService';
import {
    calculateArqueoTotals,
    calculateCierreCajaTotals
} from '../../utils/cierreCajaCalculations';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    Calculator, 
    Save, 
    CheckCircle, 
    XCircle, 
    AlertCircle,
    Upload,
    DollarSign,
    TrendingUp,
    TrendingDown,
    Wallet,
    CreditCard,
    Building2,
    FileText,
    Eye,
    Lock,
    Unlock,
    Printer,
    ArrowLeft,
    Plus,
    Trash2,
    RefreshCw,
    Search,
    Filter,
    ChevronDown,
    ChevronUp,
    Camera
} from 'lucide-react';

const createInitialFormData = (defaultSucursal = null) => ({
    fecha: format(new Date(), 'yyyy-MM-dd'),
    sucursalId: defaultSucursal?.id || '',
    sucursalName: defaultSucursal?.name || '',
    tienda: defaultSucursal?.name || '',
    caja: '',
    cajero: '',
    horaApertura: '06:00',
    horaCierre: format(new Date(), 'HH:mm'),
    observaciones: '',
    totalIngreso: '',
    totalFacturasCredito: '0',
    totalAbonosRecibidos: '0',
    efectivoCS: '',
    efectivoUSD: '',
    tipoCambio: '36.50',
    posBAC: '0',
    posBANPRO: '0',
    posLAFISE: '0',
    transferenciaBAC: '0',
    transferenciaBANPRO: '0',
    transferenciaLAFISE: '0',
    transferenciaBAC_USD: '0',
    transferenciaLAFISE_USD: '0',
    retenciones: [],
    gastosCaja: [],
    arqueoRealizado: false,
    arqueo: {
        billetes100: 0,
        billetes50: 0,
        billetes20: 0,
        billetes10: 0,
        billetes5: 0,
        billetes1: 0,
        monedas: 0,
        efectivoUSDFisico: 0,
        totalArqueoCS: 0,
        totalArqueo: 0,
        diferenciaCS: 0,
        comentarioDiferencia: ''
    },
    cuentaEfectivoId: '',
    cuentaEfectivoCode: '',
    cuentaEfectivoName: '',
    fotos: []
});

const MAX_CIERRE_FOTOS = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const sanitizeStorageFileName = (fileName = 'foto.jpg') =>
    fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

const CierreCajaERP = () => {
    const { user } = useAuth();
    const { branches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );
    const sucursalPredeterminada = sucursalesActivas[0] || null;
    
    // Estados
    const [activeTab, setActiveTab] = useState('nuevo'); // 'nuevo', 'pendientes', 'completados'
    const [cierres, setCierres] = useState([]);
    const [cierresCompletados, setCierresCompletados] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewingCierre, setViewingCierre] = useState(null); // Cierre en modo lectura
    
    // Formulario de nuevo cierre
    const [formData, setFormData] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        sucursalId: '',
        sucursalName: '',
        tienda: '',
        caja: '',
        cajero: '',
        horaApertura: '06:00',
        horaCierre: format(new Date(), 'HH:mm'),
        observaciones: '',
        
        // Datos SICAR
        totalIngreso: '',
        
        // Créditos
        totalFacturasCredito: '0',
        totalAbonosRecibidos: '0',
        
        // Métodos de pago
        efectivoCS: '',
        efectivoUSD: '',
        tipoCambio: '36.50',
        posBAC: '0',
        posBANPRO: '0',
        posLAFISE: '0',
        transferenciaBAC: '0',
        transferenciaBANPRO: '0',
        transferenciaLAFISE: '0',
        
        // NUEVO: Transferencias USD
        transferenciaBAC_USD: '0',
        transferenciaLAFISE_USD: '0',
        
        // Retenciones
        retenciones: [],
        
        // Gastos de caja
        gastosCaja: [],
        arqueoRealizado: false,
        
        // Arqueo
        arqueo: {
            billetes100: 0,
            billetes50: 0,
            billetes20: 0,
            billetes10: 0,
            billetes5: 0,
            billetes1: 0,
            monedas: 0,
            efectivoUSDFisico: 0,
            totalArqueoCS: 0,
            totalArqueo: 0,
            diferenciaCS: 0,
            comentarioDiferencia: ''
        },
        
        // NUEVO: Cuenta de efectivo seleccionada
        cuentaEfectivoId: '',
        cuentaEfectivoCode: '',
        cuentaEfectivoName: '',
        
        fotos: []
    });

    const [submitting, setSubmitting] = useState(false);
    const [submitAction, setSubmitAction] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [processedNotice, setProcessedNotice] = useState(null);
    const [cierrePhotos, setCierrePhotos] = useState([]);
    const cierrePhotoInputRef = useRef(null);
    const cierrePhotosRef = useRef([]);

    useEffect(() => {
        if (!sucursalPredeterminada || formData.sucursalId) return;

        setFormData((prev) => ({
            ...prev,
            sucursalId: sucursalPredeterminada.id,
            sucursalName: sucursalPredeterminada.name,
            tienda: sucursalPredeterminada.name
        }));
    }, [formData.sucursalId, sucursalPredeterminada]);

    useEffect(() => {
        cierrePhotosRef.current = cierrePhotos;
    }, [cierrePhotos]);

    useEffect(() => () => {
        cierrePhotosRef.current.forEach((photo) => {
            if (photo?.previewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(photo.previewUrl);
            }
        });
    }, []);

    // Hooks
    const { 
        getCajaAccounts, 
        getGastoAccounts,
        accounts 
    } = usePlanCuentas();

    const cuentasCaja = useMemo(() => getCajaAccounts('NIO'), [getCajaAccounts]);
    const cuentasGastos = useMemo(() => getGastoAccounts(), [getGastoAccounts]);
    const cuentasRetencionPasivo = useMemo(
        () => accounts
            .filter((account) => {
                if (account.type !== 'PASIVO' || account.isGroup) return false;
                const code = String(account.code || '').replace(/\./g, '');
                const name = String(account.name || '').toLowerCase();
                return (
                    code.startsWith('2102') ||
                    code.startsWith('2103') ||
                    name.includes('oblig') ||
                    name.includes('impuesto') ||
                    name.includes('retencion') ||
                    name.includes('alcal') ||
                    name.includes('ir') ||
                    name.includes('inss') ||
                    name.includes('inatec')
                );
            })
            .sort((a, b) => (a.code || '').localeCompare(b.code || '')),
        [accounts]
    );

    const loadCierres = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'cierresCajaERP'));
            const todosLosCierres = snap.docs
                .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
                .sort((a, b) => {
                    const getSortValue = (cierre) => {
                        if (typeof cierre?.createdAt?.toMillis === 'function') {
                            return cierre.createdAt.toMillis();
                        }

                        if (typeof cierre?.createdAt?.seconds === 'number') {
                            return cierre.createdAt.seconds * 1000;
                        }

                        if (cierre?.fecha) {
                            const parsed = new Date(cierre.fecha).getTime();
                            return Number.isNaN(parsed) ? 0 : parsed;
                        }

                        return 0;
                    };

                    return getSortValue(b) - getSortValue(a);
                });

            setCierres(
                todosLosCierres.filter((cierre) =>
                    ['borrador', 'pendiente'].includes(cierre.estado)
                )
            );
            setCierresCompletados(
                todosLosCierres.filter((cierre) =>
                    ['completado', 'cerrado'].includes(cierre.estado)
                )
            );
        } catch (err) {
            console.error('Error cargando cierres:', err);
        } finally {
            setLoading(false);
        }
    };

    // Cargar cierres
    useEffect(() => {
        loadCierres();
    }, []);

    // Calcular totales
    const totales = useMemo(() => calculateCierreCajaTotals(formData), [formData]);
    const arqueoTotales = useMemo(() => calculateArqueoTotals(formData), [formData]);

    const resetCierrePhotos = () => {
        cierrePhotosRef.current.forEach((photo) => {
            if (photo?.previewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(photo.previewUrl);
            }
        });
        cierrePhotosRef.current = [];
        setCierrePhotos([]);
        if (cierrePhotoInputRef.current) {
            cierrePhotoInputRef.current.value = '';
        }
    };

    const handleCierrePhotosSelect = (event) => {
        const selectedFiles = Array.from(event.target.files || []);
        if (!selectedFiles.length) return;

        const totalFotos = cierrePhotosRef.current.length + selectedFiles.length;
        if (totalFotos > MAX_CIERRE_FOTOS) {
            setError(`Puede adjuntar hasta ${MAX_CIERRE_FOTOS} fotos por cierre.`);
            if (cierrePhotoInputRef.current) {
                cierrePhotoInputRef.current.value = '';
            }
            return;
        }

        for (const file of selectedFiles) {
            if (!file.type.startsWith('image/')) {
                setError(`"${file.name}" no es una imagen válida.`);
                if (cierrePhotoInputRef.current) {
                    cierrePhotoInputRef.current.value = '';
                }
                return;
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                setError(`"${file.name}" supera el máximo de 5MB.`);
                if (cierrePhotoInputRef.current) {
                    cierrePhotoInputRef.current.value = '';
                }
                return;
            }
        }

        const nuevasFotos = selectedFiles.map((file, index) => ({
            id: `${Date.now()}-${index}-${file.name}`,
            file,
            name: file.name,
            size: file.size,
            previewUrl: URL.createObjectURL(file)
        }));

        setCierrePhotos((prev) => [...prev, ...nuevasFotos]);
        setError(null);

        if (cierrePhotoInputRef.current) {
            cierrePhotoInputRef.current.value = '';
        }
    };

    const removeCierrePhoto = (photoId) => {
        setCierrePhotos((prev) => {
            const photoToRemove = prev.find((photo) => photo.id === photoId);
            if (photoToRemove?.previewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(photoToRemove.previewUrl);
            }
            return prev.filter((photo) => photo.id !== photoId);
        });

        if (cierrePhotoInputRef.current) {
            cierrePhotoInputRef.current.value = '';
        }
    };

    const uploadCierrePhotos = async () => {
        if (!cierrePhotosRef.current.length) return [];

        const loteId = `${Date.now()}_${user?.uid || 'anonimo'}`;

        return Promise.all(
            cierrePhotosRef.current.map(async (photo, index) => {
                const safeName = sanitizeStorageFileName(photo.name || `foto_${index + 1}.jpg`);
                const storageRef = ref(
                    storage,
                    `comprobantes/cierres-caja/${loteId}/${index + 1}_${safeName}`
                );

                await uploadBytes(storageRef, photo.file);
                const url = await getDownloadURL(storageRef);

                return {
                    url,
                    name: photo.name || `Foto ${index + 1}`,
                    size: photo.size || 0,
                    uploadedAt: new Date().toISOString()
                };
            })
        );
    };

    // Calcular arqueo
    const calcularArqueo = () => {
        setFormData(prev => ({
            ...prev,
            arqueoRealizado: true,
            arqueo: {
                ...prev.arqueo,
                totalArqueoCS: arqueoTotales.totalArqueoCS,
                totalArqueo: arqueoTotales.totalArqueo,
                diferenciaCS: arqueoTotales.diferenciaCaja
            }
        }));
    };

    // Manejar cambios en arqueo
    const handleArqueoChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            arqueo: {
                ...prev.arqueo,
                [field]: Number(value) || 0
            }
        }));
    };

    // Agregar retención
    const addRetencion = () => {
        setFormData(prev => ({
            ...prev,
            retenciones: [...prev.retenciones, {
                cuentaPasivoId: '',
                cuentaPasivoCode: '',
                cuentaPasivoName: '',
                monto: '',
                cliente: '',
                facturaRelacionada: ''
            }]
        }));
    };

    // Eliminar retención
    const removeRetencion = (index) => {
        setFormData(prev => ({
            ...prev,
            retenciones: prev.retenciones.filter((_, i) => i !== index)
        }));
    };

    // Actualizar retención
    const updateRetencion = (index, field, value) => {
        setFormData(prev => ({
            ...prev,
            retenciones: prev.retenciones.map((r, i) => 
                i === index
                    ? (() => {
                        if (field !== 'cuentaPasivoId') {
                            return { ...r, [field]: value };
                        }

                        const cuenta =
                            cuentasRetencionPasivo.find((account) => account.id === value) ||
                            (() => {
                                const searchTerm =
                                    value === 'IR'
                                        ? 'ir'
                                        : value === 'Alcaldia'
                                          ? 'alcal'
                                          : '';

                                return searchTerm
                                    ? cuentasRetencionPasivo.find((account) =>
                                        `${account.code || ''} ${account.name || ''}`
                                            .toLowerCase()
                                            .includes(searchTerm)
                                    )
                                    : null;
                            })();

                        return {
                            ...r,
                            cuentaPasivoId: cuenta?.id || value,
                            cuentaPasivoCode: cuenta?.code || '',
                            cuentaPasivoName: cuenta?.name || ''
                        };
                    })()
                    : r
            )
        }));
    };

    const validarRetenciones = () => {
        const retencionSinCuenta = formData.retenciones.some(
            (retencion) => Number(retencion?.monto || 0) > 0 && !retencion?.cuentaPasivoId
        );

        if (retencionSinCuenta) {
            setError('Cada retencion con monto debe tener una cuenta por pagar seleccionada.');
            return false;
        }

        return true;
    };

    // Agregar gasto
    const addGasto = () => {
        setFormData(prev => ({
            ...prev,
            gastosCaja: [...prev.gastosCaja, { 
                concepto: '', 
                monto: '', 
                responsable: '',
                cuentaContableId: '',
                cuentaContableCode: '',
                cuentaContableName: ''
            }]
        }));
    };

    // Eliminar gasto
    const removeGasto = (index) => {
        setFormData(prev => ({
            ...prev,
            gastosCaja: prev.gastosCaja.filter((_, i) => i !== index)
        }));
    };

    // Actualizar gasto
    const updateGasto = (index, field, value) => {
        setFormData(prev => {
            const newGastos = [...prev.gastosCaja];
            newGastos[index] = { ...newGastos[index], [field]: value };
            
            // Si es cuenta contable, actualizar también código y nombre
            if (field === 'cuentaContableId') {
                const cuenta = cuentasGastos.find(c => c.id === value);
                if (cuenta) {
                    newGastos[index].cuentaContableCode = cuenta.code;
                    newGastos[index].cuentaContableName = cuenta.name;
                }
            }
            
            return { ...prev, gastosCaja: newGastos };
        });
    };

    // Guardar cierre (borrador)
    const handleGuardar = async (e) => {
        e.preventDefault();
        if (submitting) return;
        if (totales.totalAbonosRecibidos > totales.totalIngresoRegistrado) {
            setError('Los abonos no pueden ser mayores al Ingreso total SICAR.');
            return;
        }
        if (!validarRetenciones()) return;
        setSubmitting(true);
        setSubmitAction('guardar');
        setError(null);
        setSuccess(null);

        try {
            const fotosAdjuntas = await uploadCierrePhotos();

            await createCierreCajaERP({
                ...formData,
                fotos: fotosAdjuntas,
                userId: user.uid,
                userEmail: user.email
            });

            setSuccess('Cierre de caja guardado exitosamente');
            
            // Resetear formulario
            setFormData(createInitialFormData(sucursalPredeterminada));
            resetCierrePhotos();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error guardando cierre:', err);
            setError(err.message || 'Error al guardar el cierre');
        } finally {
            setSubmitting(false);
            setSubmitAction(null);
        }
    };

    // Cerrar cierre (procesar)
    const handleCerrar = async () => {
        if (submitting) return;
        if (!totales.estaCuadrado) {
            setError('No se puede cerrar: El cierre no está cuadrado. Diferencia: ' + totales.diferencia.toFixed(2));
            return;
        }

        if (!validarRetenciones()) return;
        setSubmitting(true);
        setSubmitAction('cerrar');
        setError(null);
        setSuccess(null);

        let cierreCreado = null;

        try {
            const fotosAdjuntas = await uploadCierrePhotos();

            cierreCreado = await createCierreCajaERP({
                ...formData,
                fotos: fotosAdjuntas,
                userId: user.uid,
                userEmail: user.email
            });

            await updateCierreCajaERPStatus(cierreCreado.id, 'cerrado', user.uid);
            await procesarCierreCajaERP(cierreCreado.id, user.uid, user.email);
            await updateCierreCajaERPStatus(cierreCreado.id, 'completado', user.uid);

            await loadCierres();
            setFormData(createInitialFormData(sucursalPredeterminada));
            resetCierrePhotos();
            setViewingCierre(null);
            setActiveTab('completados');
            setSuccess('Cierre de caja procesado exitosamente');
            setProcessedNotice({
                id: cierreCreado.id,
                fecha: formData.fecha,
                tienda: formData.sucursalName || formData.tienda || '',
                caja: formData.caja,
                cajero: formData.cajero,
                totalIngreso: totales.totalIngresoRegistrado
            });
        } catch (err) {
            console.error('Error cerrando cierre:', err);
            await loadCierres();
            const detalle = cierreCreado?.id
                ? ` Revise el cierre ${cierreCreado.id.slice(0, 8).toUpperCase()} antes de intentarlo de nuevo.`
                : '';
            setError((err.message || 'Error al cerrar el cierre') + detalle);
        } finally {
            setSubmitting(false);
            setSubmitAction(null);
        }
    };

    // Ver cierre en modo lectura
    const handleViewCierre = async (cierre) => {
        try {
            const cierreSnap = await getDoc(doc(db, 'cierresCajaERP', cierre.id));

            if (cierreSnap.exists()) {
                setViewingCierre({ id: cierreSnap.id, ...cierreSnap.data() });
                return;
            }
        } catch (err) {
            console.error('Error cargando detalle del cierre:', err);
        }

        setViewingCierre(cierre);
    };

    // Formatear moneda
    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    // Renderizar formulario de nuevo cierre
    const renderNuevoCierre = () => (
        <form onSubmit={handleGuardar} className="space-y-6">
            {/* Información General */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Información General
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
                        <input
                            type="date"
                            value={formData.fecha}
                            onChange={(e) => setFormData(prev => ({ ...prev, fecha: e.target.value }))}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tienda *</label>
                        <select
                            value={formData.sucursalId || ''}
                            onChange={(e) => {
                                const sucursal = sucursalesActivas.find((branch) => branch.id === e.target.value);
                                setFormData((prev) => ({
                                    ...prev,
                                    sucursalId: e.target.value,
                                    sucursalName: sucursal?.name || '',
                                    tienda: sucursal?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione una sucursal...</option>
                            {sucursalesActivas.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Caja / Punto de Cobro *</label>
                        <input
                            type="text"
                            value={formData.caja}
                            onChange={(e) => setFormData(prev => ({ ...prev, caja: e.target.value }))}
                            placeholder="Caja principal"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Cajero *</label>
                        <input
                            type="text"
                            value={formData.cajero}
                            onChange={(e) => setFormData(prev => ({ ...prev, cajero: e.target.value }))}
                            placeholder="Nombre del cajero"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Hora Apertura</label>
                        <input
                            type="time"
                            value={formData.horaApertura}
                            onChange={(e) => setFormData(prev => ({ ...prev, horaApertura: e.target.value }))}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Hora Cierre</label>
                        <input
                            type="time"
                            value={formData.horaCierre}
                            onChange={(e) => setFormData(prev => ({ ...prev, horaCierre: e.target.value }))}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* NUEVO: Configuración de Cuenta de Efectivo */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-600" />
                    Configuración Contable
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Cuenta de Efectivo (Caja) *
                        </label>
                        <select
                            value={formData.cuentaEfectivoId}
                            onChange={(e) => {
                                const cuenta = cuentasCaja.find(c => c.id === e.target.value);
                                setFormData(prev => ({
                                    ...prev,
                                    cuentaEfectivoId: e.target.value,
                                    cuentaEfectivoCode: cuenta?.code || '',
                                    cuentaEfectivoName: cuenta?.name || ''
                                }));
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">Seleccione una cuenta...</option>
                            {cuentasCaja.map(cuenta => (
                                <option key={cuenta.id} value={cuenta.id}>
                                    {cuenta.code} - {cuenta.name}
                                </option>
                            ))}
                        </select>
                        <p className="text-sm text-gray-500 mt-1">
                            Esta cuenta se usará para registrar los movimientos de efectivo
                        </p>
                    </div>
                </div>
            </div>

            {/* Datos SICAR */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    Datos SICAR
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Total Ingreso SICAR *
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.totalIngreso}
                            onChange={(e) => setFormData(prev => ({ ...prev, totalIngreso: e.target.value }))}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Total Facturas Crédito
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.totalFacturasCredito}
                            onChange={(e) => setFormData(prev => ({ ...prev, totalFacturasCredito: e.target.value }))}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Total Abonos Recibidos
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.totalAbonosRecibidos}
                            onChange={(e) => setFormData(prev => ({ ...prev, totalAbonosRecibidos: e.target.value }))}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Métodos de Pago */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-purple-600" />
                    Métodos de Pago
                </h3>
                
                {/* Efectivo */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">Efectivo</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Efectivo C$
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.efectivoCS}
                                onChange={(e) => setFormData(prev => ({ ...prev, efectivoCS: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Efectivo USD
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.efectivoUSD}
                                onChange={(e) => setFormData(prev => ({ ...prev, efectivoUSD: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Tipo de Cambio
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.tipoCambio}
                                onChange={(e) => setFormData(prev => ({ ...prev, tipoCambio: e.target.value }))}
                                placeholder="36.50"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* POS */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">POS</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">POS BAC</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.posBAC}
                                onChange={(e) => setFormData(prev => ({ ...prev, posBAC: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">POS BANPRO</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.posBANPRO}
                                onChange={(e) => setFormData(prev => ({ ...prev, posBANPRO: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">POS LAFISE</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.posLAFISE}
                                onChange={(e) => setFormData(prev => ({ ...prev, posLAFISE: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Transferencias NIO */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">Transferencias (Córdobas)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Transferencia BAC</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.transferenciaBAC}
                                onChange={(e) => setFormData(prev => ({ ...prev, transferenciaBAC: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Transferencia BANPRO</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.transferenciaBANPRO}
                                onChange={(e) => setFormData(prev => ({ ...prev, transferenciaBANPRO: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Transferencia LAFISE</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.transferenciaLAFISE}
                                onChange={(e) => setFormData(prev => ({ ...prev, transferenciaLAFISE: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* NUEVO: Transferencias USD */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Transferencias (Dólares USD)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Transferencia BAC USD
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.transferenciaBAC_USD}
                                onChange={(e) => setFormData(prev => ({ ...prev, transferenciaBAC_USD: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Transferencia LAFISE USD
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.transferenciaLAFISE_USD}
                                onChange={(e) => setFormData(prev => ({ ...prev, transferenciaLAFISE_USD: e.target.value }))}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Retenciones */}
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <TrendingDown className="w-5 h-5 text-red-600" />
                        Retenciones
                    </h3>
                    <button
                        type="button"
                        onClick={addRetencion}
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" />
                        Agregar Retención
                    </button>
                </div>
                
                {formData.retenciones.map((ret, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta por pagar</label>
                            <select
                                value={ret.cuentaPasivoId || ''}
                                onChange={(e) => updateRetencion(index, 'cuentaPasivoId', e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Seleccione una cuenta...</option>
                                {cuentasRetencionPasivo.map((cuenta) => (
                                    <option key={cuenta.id} value={cuenta.id}>
                                        {cuenta.code} - {cuenta.name}
                                    </option>
                                ))}
                                <option value="IR">IR (Retención IR)</option>
                                <option value="Alcaldia">Alcaldía</option>
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                                Use una cuenta de obligaciones para que el cierre genere el pasivo correcto.
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
                            <input
                                type="number"
                                step="0.01"
                                value={ret.monto}
                                onChange={(e) => updateRetencion(index, 'monto', e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
                            <input
                                type="text"
                                value={ret.cliente}
                                onChange={(e) => updateRetencion(index, 'cliente', e.target.value)}
                                placeholder="Nombre del cliente"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Factura</label>
                                <input
                                    type="text"
                                    value={ret.facturaRelacionada}
                                    onChange={(e) => updateRetencion(index, 'facturaRelacionada', e.target.value)}
                                    placeholder="# Factura"
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => removeRetencion(index)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ))}
                
                {formData.retenciones.length === 0 && (
                    <p className="text-gray-500 text-center py-4">No hay retenciones registradas</p>
                )}
            </div>

            {/* Gastos de Caja */}
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <TrendingDown className="w-5 h-5 text-orange-600" />
                        Gastos de Caja
                    </h3>
                    <button
                        type="button"
                        onClick={addGasto}
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" />
                        Agregar Gasto
                    </button>
                </div>
                
                {formData.gastosCaja.map((gasto, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Concepto</label>
                            <input
                                type="text"
                                value={gasto.concepto}
                                onChange={(e) => updateGasto(index, 'concepto', e.target.value)}
                                placeholder="Descripción del gasto"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
                            <input
                                type="number"
                                step="0.01"
                                value={gasto.monto}
                                onChange={(e) => updateGasto(index, 'monto', e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Responsable</label>
                            <input
                                type="text"
                                value={gasto.responsable}
                                onChange={(e) => updateGasto(index, 'responsable', e.target.value)}
                                placeholder="Nombre"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta</label>
                                <select
                                    value={gasto.cuentaContableId}
                                    onChange={(e) => updateGasto(index, 'cuentaContableId', e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Seleccione...</option>
                                    {cuentasGastos.map(cuenta => (
                                        <option key={cuenta.id} value={cuenta.id}>
                                            {cuenta.code} - {cuenta.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeGasto(index)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ))}
                
                {formData.gastosCaja.length === 0 && (
                    <p className="text-gray-500 text-center py-4">No hay gastos registrados</p>
                )}
            </div>

            {/* Arqueo */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-blue-600" />
                    Arqueo de Efectivo
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 100</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes100}
                            onChange={(e) => handleArqueoChange('billetes100', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 50</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes50}
                            onChange={(e) => handleArqueoChange('billetes50', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 20</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes20}
                            onChange={(e) => handleArqueoChange('billetes20', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 10</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes10}
                            onChange={(e) => handleArqueoChange('billetes10', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 5</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes5}
                            onChange={(e) => handleArqueoChange('billetes5', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Billetes de 1</label>
                        <input
                            type="number"
                            value={formData.arqueo.billetes1}
                            onChange={(e) => handleArqueoChange('billetes1', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Monedas</label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.arqueo.monedas}
                            onChange={(e) => handleArqueoChange('monedas', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Efectivo USD Físico</label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.arqueo.efectivoUSDFisico}
                            onChange={(e) => handleArqueoChange('efectivoUSDFisico', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={calcularArqueo}
                            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                        >
                            Confirmar Arqueo
                        </button>
                    </div>
                </div>
                <p className="mt-3 text-sm text-gray-500">
                    La diferencia de caja solo se generará si confirmas el arqueo.
                </p>
                
                {arqueoTotales.totalArqueo > 0 && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="font-medium">Arqueo C$:</span>
                            <span className="text-lg font-bold">{formatCurrency(arqueoTotales.totalArqueoCS)}</span>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <span className="font-medium">Arqueo USD:</span>
                            <span className="text-lg font-bold">$ {Number(arqueoTotales.efectivoUSDFisico || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-medium">Total Arqueo:</span>
                            <span className="text-lg font-bold">{formatCurrency(arqueoTotales.totalArqueo)}</span>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <span className="font-medium">Diferencia:</span>
                            <span className={`text-lg font-bold ${
                                Math.abs(arqueoTotales.diferenciaCaja) < 0.01 
                                    ? 'text-green-600' 
                                    : arqueoTotales.diferenciaCaja < 0 
                                        ? 'text-red-600' 
                                        : 'text-blue-600'
                            }`}>
                                {formatCurrency(arqueoTotales.diferenciaCaja)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Resumen y Cuadre */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-blue-600" />
                    Resumen y Cuadre
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-gray-600">Efectivo Físico</p>
                        <p className="text-xl font-bold text-blue-600">{formatCurrency(totales.totalEfectivo)}</p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-sm text-gray-600">Total POS</p>
                        <p className="text-xl font-bold text-purple-600">{formatCurrency(totales.totalPOS)}</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-gray-600">Total Transferencias</p>
                        <p className="text-xl font-bold text-green-600">{formatCurrency(totales.totalTransferencias)}</p>
                    </div>
                    <div className="p-4 bg-orange-50 rounded-lg">
                        <p className="text-sm text-gray-600">Total Medios de Pago</p>
                        <p className="text-xl font-bold text-orange-600">{formatCurrency(totales.totalMediosPago)}</p>
                    </div>
                </div>
                
                <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="p-4 bg-red-50 rounded-lg">
                        <p className="text-sm text-gray-600">Retenciones</p>
                        <p className="text-xl font-bold text-red-600">{formatCurrency(totales.totalRetenciones)}</p>
                    </div>
                    <div className="p-4 bg-yellow-50 rounded-lg">
                        <p className="text-sm text-gray-600">Gastos de Caja</p>
                        <p className="text-xl font-bold text-yellow-700">{formatCurrency(totales.totalGastosCaja)}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600">Ingreso SICAR</p>
                        <p className="text-xl font-bold">{formatCurrency(totales.totalIngresoRegistrado)}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600">Medios + Gastos + Retenciones</p>
                        <p className="text-xl font-bold">{formatCurrency(totales.totalEsperado)}</p>
                    </div>
                    <div className={`p-4 rounded-lg ${
                        totales.estaCuadrado 
                            ? 'bg-green-50 border-2 border-green-200' 
                            : 'bg-red-50 border-2 border-red-200'
                    }`}>
                        <p className="text-sm text-gray-600">Diferencia</p>
                        <p className={`text-xl font-bold ${
                            totales.estaCuadrado ? 'text-green-600' : 'text-red-600'
                        }`}>
                            {formatCurrency(totales.diferencia)}
                        </p>
                        <p className={`text-sm mt-1 ${
                            totales.estaCuadrado ? 'text-green-600' : 'text-red-600'
                        }`}>
                            {totales.estaCuadrado ? '✓ Cuadrado' : '✗ No cuadrado'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Observaciones */}
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Camera className="w-5 h-5 text-blue-600" />
                            Fotos del Cierre
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            Adjunte vouchers, arqueo físico o evidencia del cierre. Máximo {MAX_CIERRE_FOTOS} fotos.
                        </p>
                    </div>
                    <span className="text-sm text-gray-500">
                        {cierrePhotos.length}/{MAX_CIERRE_FOTOS}
                    </span>
                </div>

                <input
                    ref={cierrePhotoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleCierrePhotosSelect}
                    className="hidden"
                />

                <button
                    type="button"
                    onClick={() => cierrePhotoInputRef.current?.click()}
                    className="w-full mb-4 border-2 border-dashed border-gray-300 rounded-lg px-4 py-5 hover:border-blue-500 hover:bg-blue-50 transition-colors flex flex-col items-center gap-2"
                >
                    <Upload className="w-7 h-7 text-gray-400" />
                    <span className="font-medium text-gray-700">Agregar fotos del cierre</span>
                    <span className="text-xs text-gray-500">JPG, PNG o WebP. Hasta 5MB por archivo.</span>
                </button>

                {cierrePhotos.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {cierrePhotos.map((photo, index) => (
                            <div key={photo.id} className="border rounded-lg overflow-hidden bg-gray-50">
                                <img
                                    src={photo.previewUrl}
                                    alt={`Foto del cierre ${index + 1}`}
                                    className="w-full h-44 object-cover bg-white"
                                    loading="lazy"
                                />
                                <div className="p-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm text-gray-900 truncate">{photo.name}</p>
                                        <p className="text-xs text-gray-500">
                                            {(photo.size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeCierrePhoto(photo.id)}
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 text-center py-3">
                        No hay fotos adjuntas todavía.
                    </p>
                )}
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Observaciones</label>
                <textarea
                    value={formData.observaciones}
                    onChange={(e) => setFormData(prev => ({ ...prev, observaciones: e.target.value }))}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Observaciones adicionales..."
                />
            </div>

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

            {/* Botones */}
            <div className="flex gap-4">
                <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {submitting ? (
                        <>
                            <RefreshCw className="w-5 h-5 animate-spin" />
                            {submitAction === 'guardar' ? 'Guardando...' : 'Procesando...'}
                        </>
                    ) : (
                        <>
                            <Save className="w-5 h-5" />
                            Guardar Borrador
                        </>
                    )}
                </button>
                <button
                    type="button"
                    onClick={handleCerrar}
                    disabled={submitting || !totales.estaCuadrado}
                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {submitting && submitAction === 'cerrar' ? (
                        <>
                            <RefreshCw className="w-5 h-5 animate-spin" />
                            Cerrando y Procesando...
                        </>
                    ) : (
                        <>
                            <CheckCircle className="w-5 h-5" />
                            Cerrar y Procesar
                        </>
                    )}
                </button>
            </div>
        </form>
    );

    // Renderizar lista de cierres completados (modo lectura)
    const renderCierresCompletados = () => (
        <div className="space-y-4">
            {cierresCompletados.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-8 text-center">
                    <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900">No hay cierres completados</h3>
                    <p className="text-gray-600">Los cierres procesados aparecerán aquí</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {cierresCompletados.map((cierre) => (
                        <div
                            key={cierre.id}
                            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1">
                                            <Lock className="w-3 h-3" />
                                            {cierre.estado === 'completado' ? 'Completado' : 'Cerrado'}
                                        </span>
                                        <span className="text-gray-500">
                                            {cierre.fecha}
                                        </span>
                                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                                            {cierre.caja}
                                        </span>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                                        <div>
                                            <p className="text-sm text-gray-500">Cajero</p>
                                            <p className="font-medium">{cierre.cajero}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Total Ingreso</p>
                                            <p className="font-medium text-lg">
                                                {formatCurrency(cierre.totalIngreso ?? cierre.cuadre?.totalIngreso)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Diferencia</p>
                                            <p className={`font-medium ${
                                                cierre.cuadre?.estaCuadrado 
                                                    ? 'text-green-600' 
                                                    : 'text-red-600'
                                            }`}>
                                                {formatCurrency(cierre.cuadre?.diferencia || 0)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Movimientos</p>
                                            <p className="font-medium">
                                                {cierre.totalMovimientos || cierre.movimientosContablesIds?.length || 0} registrados
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Fotos</p>
                                            <p className="font-medium">
                                                {Array.isArray(cierre.fotos) && cierre.fotos.length > 0
                                                    ? `${cierre.fotos.length} adjunta${cierre.fotos.length === 1 ? '' : 's'}`
                                                    : 'Sin fotos'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                
                                <button
                                    onClick={() => handleViewCierre(cierre)}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                                >
                                    <Eye className="w-4 h-4" />
                                    Ver Detalle
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    // Renderizar vista de cierre (modo lectura)
    const renderViewCierre = () => {
        if (!viewingCierre) return null;
        
        const cierre = viewingCierre;
        const retenciones = cierre.retenciones || [];
        const gastosCaja = cierre.gastosCaja || [];
        const fotosCierre = Array.isArray(cierre.fotos) ? cierre.fotos : [];
        
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
                    <div className="p-6 border-b sticky top-0 bg-white">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Lock className="w-6 h-6 text-green-600" />
                                Cierre de Caja - Modo Lectura
                            </h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => window.print()}
                                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
                                >
                                    <Printer className="w-4 h-4" />
                                    Imprimir
                                </button>
                                <button
                                    onClick={() => setViewingCierre(null)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Información General */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <h3 className="font-semibold mb-3">Información General</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Fecha</p>
                                    <p className="font-medium">{cierre.fecha}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Tienda</p>
                                    <p className="font-medium">{cierre.sucursalName || cierre.tienda || '-'}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Caja</p>
                                    <p className="font-medium">{cierre.caja}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Cajero</p>
                                    <p className="font-medium">{cierre.cajero}</p>
                                </div>
                            </div>
                        </div>

                        {/* Cuenta de Efectivo */}
                        {cierre.cuentaEfectivo && (
                            <div className="bg-blue-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Cuenta Contable de Efectivo</h3>
                                <p className="font-medium">
                                    {cierre.cuentaEfectivo.code} - {cierre.cuentaEfectivo.name}
                                </p>
                            </div>
                        )}

                        {/* Totales */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <h3 className="font-semibold mb-3">Totales</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Total Ingreso SICAR</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalIngreso ?? cierre.cuadre?.totalIngreso)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Facturas de crÃ©dito</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalFacturasCredito)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Abonos recibidos</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalAbonosRecibidos)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Retenciones</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalRetenciones ?? cierre.cuadre?.totalRetenciones)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Gastos de caja</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalGastosCaja ?? cierre.cuadre?.totalGastosCaja)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Efectivo C$</p>
                                    <p className="font-medium">{formatCurrency(cierre.efectivoCS)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Efectivo USD</p>
                                    <p className="font-medium">${Number(cierre.efectivoUSD || 0).toFixed(2)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Total Transferencias USD</p>
                                    <p className="font-medium">${((cierre.transferenciaBAC_USD || 0) + (cierre.transferenciaLAFISE_USD || 0)).toFixed(2)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Cuadre */}
                        <div className={`rounded-lg p-4 ${
                            cierre.cuadre?.estaCuadrado 
                                ? 'bg-green-50 border border-green-200' 
                                : 'bg-red-50 border border-red-200'
                        }`}>
                            <h3 className="font-semibold mb-3">Cuadre</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Total Medios de Pago</p>
                                    <p className="font-medium">{formatCurrency(cierre.cuadre?.totalMediosPago)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Medios + Gastos + Retenciones</p>
                                    <p className="font-medium">{formatCurrency(cierre.cuadre?.totalEsperado)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Diferencia</p>
                                    <p className={`font-medium ${cierre.cuadre?.estaCuadrado ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatCurrency(cierre.cuadre?.diferencia)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Estado</p>
                                    <p className={`font-medium ${cierre.cuadre?.estaCuadrado ? 'text-green-600' : 'text-red-600'}`}>
                                        {cierre.cuadre?.estaCuadrado ? '✓ Cuadrado' : '✗ No cuadrado'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {retenciones.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Retenciones Registradas</h3>
                                <div className="space-y-3">
                                    {retenciones.map((retencion, index) => (
                                        <div key={`${retencion.cuentaPasivoId || 'ret'}-${index}`} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b border-gray-200 last:border-b-0 pb-3 last:pb-0">
                                            <div>
                                                <p className="font-medium text-gray-900">
                                                    {retencion.cuentaPasivoCode || ''} {retencion.cuentaPasivoName || 'Cuenta por pagar'}
                                                </p>
                                                <p className="text-sm text-gray-500">
                                                    {retencion.cliente || 'Sin cliente'}{retencion.facturaRelacionada ? ` · Factura ${retencion.facturaRelacionada}` : ''}
                                                </p>
                                            </div>
                                            <p className="font-semibold text-red-600">{formatCurrency(retencion.monto)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {gastosCaja.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Gastos de Caja</h3>
                                <div className="space-y-3">
                                    {gastosCaja.map((gasto, index) => (
                                        <div key={`${gasto.cuentaContableId || 'gasto'}-${index}`} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b border-gray-200 last:border-b-0 pb-3 last:pb-0">
                                            <div>
                                                <p className="font-medium text-gray-900">{gasto.concepto || 'Gasto de caja'}</p>
                                                <p className="text-sm text-gray-500">
                                                    {gasto.cuentaContableCode || ''} {gasto.cuentaContableName || 'Cuenta no especificada'}
                                                    {gasto.responsable ? ` · ${gasto.responsable}` : ''}
                                                </p>
                                            </div>
                                            <p className="font-semibold text-orange-600">{formatCurrency(gasto.monto)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {fotosCierre.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <h3 className="font-semibold">Fotos Adjuntas</h3>
                                    <span className="text-sm text-gray-500">
                                        {fotosCierre.length} foto{fotosCierre.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {fotosCierre.map((foto, index) => {
                                        const fotoUrl =
                                            typeof foto === 'string'
                                                ? foto
                                                : foto?.url || foto?.downloadURL || foto?.comprobanteURL || null;

                                        if (!fotoUrl) return null;

                                        const fotoNombre =
                                            typeof foto === 'string'
                                                ? `Foto ${index + 1}`
                                                : foto?.name || `Foto ${index + 1}`;

                                        return (
                                            <a
                                                key={`${fotoNombre}-${index}`}
                                                href={fotoUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="border rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow"
                                            >
                                                <img
                                                    src={fotoUrl}
                                                    alt={fotoNombre}
                                                    className="w-full h-56 object-cover bg-gray-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3">
                                                    <p className="font-medium text-gray-900">{fotoNombre}</p>
                                                    <p className="text-sm text-blue-600 mt-1">Abrir imagen completa</p>
                                                </div>
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Movimientos Contables */}
                        {cierre.movimientosContablesIds?.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Movimientos Contables Generados</h3>
                                <p className="text-gray-700">
                                    Se generaron {cierre.movimientosContablesIds.length} movimientos contables 
                                    vinculados a este cierre.
                                </p>
                            </div>
                        )}

                        {/* Observaciones */}
                        {cierre.observaciones && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Observaciones</h3>
                                <p className="text-gray-700">{cierre.observaciones}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Calculator className="w-8 h-8 text-blue-600" />
                    Cierre de Caja ERP
                </h1>
                <p className="text-gray-600 mt-1">
                    Gestione los cierres de caja y su vinculación al plan de cuentas
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b">
                <button
                    onClick={() => setActiveTab('nuevo')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'nuevo' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <Plus className="w-4 h-4 inline mr-1" />
                    Nuevo Cierre
                </button>
                <button
                    onClick={() => {
                        setActiveTab('pendientes');
                        loadCierres();
                    }}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'pendientes' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <Unlock className="w-4 h-4 inline mr-1" />
                    Pendientes
                </button>
                <button
                    onClick={() => {
                        setActiveTab('completados');
                        loadCierres();
                    }}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'completados' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <Lock className="w-4 h-4 inline mr-1" />
                    Completados
                </button>
            </div>

            {/* Contenido según tab */}
            {activeTab === 'nuevo' && renderNuevoCierre()}
            {activeTab === 'pendientes' && (
                <div className="text-center py-8 text-gray-500">
                    Funcionalidad de cierres pendientes en desarrollo
                </div>
            )}
            {activeTab === 'completados' && renderCierresCompletados()}

            {/* Modal de vista */}
            {viewingCierre && renderViewCierre()}

            {processedNotice && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
                        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
                            <CheckCircle className="w-9 h-9 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900">Cierre Procesado</h2>
                        <p className="text-gray-600 mt-2">
                            El cierre fue procesado correctamente y ya aparece en completados.
                        </p>

                        <div className="mt-6 bg-gray-50 rounded-xl p-4 text-left space-y-2">
                            <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-500">Sucursal</span>
                                <span className="font-medium text-right">{processedNotice.tienda || '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-500">Caja</span>
                                <span className="font-medium text-right">{processedNotice.caja || '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-500">Cajero</span>
                                <span className="font-medium text-right">{processedNotice.cajero || '-'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-sm text-gray-500">Ingreso SICAR</span>
                                <span className="font-medium text-right">{formatCurrency(processedNotice.totalIngreso)}</span>
                            </div>
                        </div>

                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setProcessedNotice(null);
                                    setSuccess(null);
                                    setActiveTab('nuevo');
                                }}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                Nuevo cierre
                            </button>
                            <button
                                type="button"
                                onClick={() => setProcessedNotice(null)}
                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CierreCajaERP;
