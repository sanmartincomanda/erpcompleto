// src/components/CierreCajaERP.jsx
// Flujo de cierre con efectivo en standby, arqueo y vista de cierres completados

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { doc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
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
import { createImageAttachment, fetchImageAttachment } from '../../utils/imageAttachments';
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

const createInitialAjusteDiferenciaCaja = () => ({
    aplicado: false,
    tipo: '',
    montoNIO: 0,
    montoUSD: 0,
    montoTotal: 0,
    requiereClave: false,
    autorizadoConClave: false,
    autorizadoAt: null,
    autorizadoBy: ''
});

const METODO_PAGO_DESGLOSE_CONFIG = {
    posBAC: { label: 'POS BAC', moneda: 'NIO' },
    posBANPRO: { label: 'POS BANPRO', moneda: 'NIO' },
    posLAFISE: { label: 'POS LAFISE', moneda: 'NIO' },
    transferenciaBAC: { label: 'Transferencia BAC', moneda: 'NIO' },
    transferenciaBANPRO: { label: 'Transferencia BANPRO', moneda: 'NIO' },
    transferenciaLAFISE: { label: 'Transferencia LAFISE', moneda: 'NIO' },
    transferenciaBAC_USD: { label: 'Transferencia BAC USD', moneda: 'USD' },
    transferenciaLAFISE_USD: { label: 'Transferencia LAFISE USD', moneda: 'USD' }
};

const METODO_PAGO_DESGLOSE_FIELDS = Object.keys(METODO_PAGO_DESGLOSE_CONFIG);

const createInitialDesgloseMontos = () =>
    METODO_PAGO_DESGLOSE_FIELDS.reduce((accumulator, field) => {
        accumulator[field] = [];
        return accumulator;
    }, {});

const createDesgloseMontoDraft = (item = {}) => ({
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    descripcion: item.descripcion || '',
    monto:
        item.monto !== undefined && item.monto !== null && item.monto !== ''
            ? String(item.monto)
            : ''
});

const normalizeDesgloseMontoRows = (rows = [], moneda = 'NIO') =>
    (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            id: row?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            descripcion: String(row?.descripcion || '').trim(),
            monto: Number(row?.monto || 0),
            moneda
        }))
        .filter((row) => row.monto > 0);

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
    totalFacturasCreditoBrutas: '0',
    totalFacturasCreditoCanceladas: '0',
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
    desgloseMontos: createInitialDesgloseMontos(),
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
    ajusteDiferenciaCaja: createInitialAjusteDiferenciaCaja(),
    fotos: []
});

const MAX_CIERRE_FOTOS = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CIERRE_ATTACHMENT_BYTES = 95 * 1024;
const CLAVE_FALTANTE_MAYOR = 'afirmativo';
const panelClass = 'rounded-[28px] border border-white/70 bg-white/90 p-5 md:p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur';
const mutedPanelClass = 'rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4 md:p-5';
const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50';
const readonlyFieldClass = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700';
const subtleButtonClass = 'inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.8)] transition hover:bg-blue-700 disabled:opacity-60';
const successButtonClass = 'inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(5,150,105,0.8)] transition hover:bg-emerald-700 disabled:opacity-60';

const getDisplayCierreCode = (cierre) => {
    if (cierre?.codigoCierre) return cierre.codigoCierre;
    if (cierre?.numeroCierre) {
        return `CC-${String(Number(cierre.numeroCierre) || 0).padStart(6, '0')}`;
    }
    return `CIERRE-${String(cierre?.id || '').slice(0, 8).toUpperCase()}`;
};

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
    const [viewingCierreFotos, setViewingCierreFotos] = useState([]);
    const [loadingViewingCierreFotos, setLoadingViewingCierreFotos] = useState(false);
    
    // Formulario de nuevo cierre
    const [formData, setFormData] = useState(() => createInitialFormData());

    const [submitting, setSubmitting] = useState(false);
    const [submitAction, setSubmitAction] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [processedNotice, setProcessedNotice] = useState(null);
    const [cierrePhotos, setCierrePhotos] = useState([]);
    const [claveFaltante, setClaveFaltante] = useState('');
    const [desgloseModal, setDesgloseModal] = useState({ field: '', rows: [] });
    const [arqueoModalOpen, setArqueoModalOpen] = useState(false);
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
    const { getGastoAccounts, accounts } = usePlanCuentas();
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

    useEffect(() => {
        let cancelled = false;

        const resolveViewingCierreFotos = async () => {
            if (!viewingCierre) {
                setViewingCierreFotos([]);
                setLoadingViewingCierreFotos(false);
                return;
            }

            const fotos = Array.isArray(viewingCierre.fotos) ? viewingCierre.fotos : [];
            if (!fotos.length) {
                setViewingCierreFotos([]);
                setLoadingViewingCierreFotos(false);
                return;
            }

            setLoadingViewingCierreFotos(true);

            try {
                const fotosResueltas = await Promise.all(
                    fotos.map(async (foto, index) => {
                        const existingUrl =
                            typeof foto === 'string'
                                ? foto
                                : foto?.url || foto?.downloadURL || foto?.comprobanteURL || foto?.dataUrl || null;

                        if (existingUrl) {
                            return {
                                ...(typeof foto === 'object' && foto ? foto : {}),
                                url: existingUrl,
                                name:
                                    (typeof foto === 'object' && foto?.name) ||
                                    `Foto ${index + 1}`
                            };
                        }

                        if (!foto?.attachmentId) return null;

                        try {
                            const attachment = await fetchImageAttachment(foto.attachmentId);
                            if (!attachment?.dataUrl) return null;

                            return {
                                ...foto,
                                url: attachment.dataUrl,
                                name: foto?.name || attachment.originalName || `Foto ${index + 1}`
                            };
                        } catch (attachmentError) {
                            console.error('Error cargando foto adjunta del cierre:', attachmentError);
                            return null;
                        }
                    })
                );

                if (!cancelled) {
                    setViewingCierreFotos(fotosResueltas.filter(Boolean));
                }
            } finally {
                if (!cancelled) {
                    setLoadingViewingCierreFotos(false);
                }
            }
        };

        resolveViewingCierreFotos();

        return () => {
            cancelled = true;
        };
    }, [viewingCierre]);

    // Calcular totales
    const totales = useMemo(() => calculateCierreCajaTotals(formData), [formData]);
    const arqueoTotales = useMemo(() => calculateArqueoTotals(formData), [formData]);
    const diferenciaCajaPendiente = Math.abs(totales.diferencia) > 0.01;
    const requiereClaveFaltante =
        totales.diferencia > 0 &&
        Math.abs(totales.diferencia) >= 50;
    const tipoAjusteDiferencia = totales.diferencia > 0 ? 'faltante' : 'sobrante';

    useEffect(() => {
        if (!formData.ajusteDiferenciaCaja?.aplicado) return;

        const montoTotalActual = Number(formData.ajusteDiferenciaCaja?.montoTotal || 0);
        const montoNIOActual = Number(formData.ajusteDiferenciaCaja?.montoNIO || 0);
        const montoUSDActual = Number(formData.ajusteDiferenciaCaja?.montoUSD || 0);
        const tipoActual = String(formData.ajusteDiferenciaCaja?.tipo || '');

        if (
            Math.abs(montoTotalActual - Math.abs(totales.diferencia)) > 0.01 ||
            Math.abs(montoNIOActual - Math.abs(totales.diferencia)) > 0.01 ||
            Math.abs(montoUSDActual - 0) > 0.01 ||
            tipoActual !== tipoAjusteDiferencia
        ) {
            setFormData((prev) => ({
                ...prev,
                ajusteDiferenciaCaja: createInitialAjusteDiferenciaCaja()
            }));
            setClaveFaltante('');
        }
    }, [
        totales.diferencia,
        formData.ajusteDiferenciaCaja?.aplicado,
        formData.ajusteDiferenciaCaja?.montoNIO,
        formData.ajusteDiferenciaCaja?.montoTotal,
        formData.ajusteDiferenciaCaja?.montoUSD,
        formData.ajusteDiferenciaCaja?.tipo,
        tipoAjusteDiferencia
    ]);

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

        return Promise.all(
            cierrePhotosRef.current.map(async (photo, index) => {
                const attachment = await createImageAttachment({
                    file: photo.file,
                    entityType: 'cierreCajaERP',
                    entityId: null,
                    category: 'fotoCierreCaja',
                    fileName: photo.name || `foto_${index + 1}.jpg`,
                    userId: user?.uid || null,
                    userEmail: user?.email || null,
                    maxDimension: 1280,
                    maxDataUrlBytes: MAX_CIERRE_ATTACHMENT_BYTES
                });

                return {
                    attachmentId: attachment.attachmentId,
                    name: photo.name || `Foto ${index + 1}`,
                    size: photo.size || 0,
                    uploadedAt: attachment.uploadedAt,
                    storageType: attachment.storageType
                };
            })
        );
    };

    // Calcular arqueo
    const calcularArqueo = () => {
        const totalArqueoCS = arqueoTotales.totalArqueoCS;
        const efectivoUSDFisico = Number(arqueoTotales.efectivoUSDFisico || 0);
        setFormData(prev => ({
            ...prev,
            arqueoRealizado: true,
            ajusteDiferenciaCaja: createInitialAjusteDiferenciaCaja(),
            efectivoCS: totalArqueoCS > 0 ? totalArqueoCS.toFixed(2) : '0',
            efectivoUSD: efectivoUSDFisico > 0 ? efectivoUSDFisico.toFixed(2) : '0',
            arqueo: {
                ...prev.arqueo,
                totalArqueoCS: totalArqueoCS,
                totalArqueo: arqueoTotales.totalArqueo,
                diferenciaCS: 0
            }
        }));
        setClaveFaltante('');
        setArqueoModalOpen(false);
    };

    // Manejar cambios en arqueo
    const handleArqueoChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            ajusteDiferenciaCaja: createInitialAjusteDiferenciaCaja(),
            arqueo: {
                ...prev.arqueo,
                [field]: Number(value) || 0
            }
        }));
        setClaveFaltante('');
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

                        const cuenta = cuentasRetencionPasivo.find((account) => account.id === value);

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

    const validarDatosSicar = () => {
        if (totales.totalFacturasCreditoCanceladas > totales.totalFacturasCreditoBrutas) {
            setError('Las facturas de credito canceladas no pueden ser mayores a las facturas de credito registradas.');
            return false;
        }

        if (totales.totalAbonosRecibidos > totales.totalIngresoRegistrado) {
            setError('Los abonos no pueden ser mayores al Ingreso total SICAR.');
            return false;
        }

        return true;
    };

    const enviarDiferenciaCaja = () => {
        if (!diferenciaCajaPendiente) {
            setError('No hay diferencia de caja pendiente para enviar.');
            return;
        }

        if (requiereClaveFaltante && claveFaltante !== CLAVE_FALTANTE_MAYOR) {
            setError(`Para faltantes mayores o iguales a C$ 50.00 debe ingresar la clave secreta "${CLAVE_FALTANTE_MAYOR}".`);
            return;
        }

        setFormData((prev) => ({
            ...prev,
            ajusteDiferenciaCaja: {
                aplicado: true,
                tipo: tipoAjusteDiferencia,
                montoNIO: Math.abs(totales.diferencia),
                montoUSD: 0,
                montoTotal: Math.abs(totales.diferencia),
                requiereClave: requiereClaveFaltante,
                autorizadoConClave: requiereClaveFaltante,
                autorizadoAt: new Date().toISOString(),
                autorizadoBy: user?.email || ''
            }
        }));
        setError(null);
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
        if (!validarDatosSicar()) return;
        if (!validarRetenciones()) return;
        setSubmitting(true);
        setSubmitAction('guardar');
        setError(null);
        setSuccess(null);

        try {
            const fotosAdjuntas = await uploadCierrePhotos();

            await createCierreCajaERP({
                ...formData,
                totalFacturasCredito: totales.totalFacturasCredito,
                fotos: fotosAdjuntas,
                ajusteDiferenciaCaja: formData.ajusteDiferenciaCaja,
                userId: user.uid,
                userEmail: user.email
            });

            setSuccess('Cierre de caja guardado exitosamente');
            
            // Resetear formulario
            setFormData(createInitialFormData(sucursalPredeterminada));
            resetCierrePhotos();
            setClaveFaltante('');

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
        if (!totales.estaCuadrado && !formData.ajusteDiferenciaCaja?.aplicado) {
            setError('No se puede cerrar: El cierre no está cuadrado. Diferencia: ' + totales.diferencia.toFixed(2));
            return;
        }

        if (!validarDatosSicar()) return;
        if (!validarRetenciones()) return;
        if (diferenciaCajaPendiente && !formData.ajusteDiferenciaCaja?.aplicado) {
            setError('Debe enviar la diferencia a faltante o sobrante de caja antes de procesar el cierre.');
            return;
        }
        setSubmitting(true);
        setSubmitAction('cerrar');
        setError(null);
        setSuccess(null);

        let cierreCreado = null;

        try {
            const fotosAdjuntas = await uploadCierrePhotos();

            cierreCreado = await createCierreCajaERP({
                ...formData,
                totalFacturasCredito: totales.totalFacturasCredito,
                fotos: fotosAdjuntas,
                ajusteDiferenciaCaja: formData.ajusteDiferenciaCaja,
                userId: user.uid,
                userEmail: user.email
            });

            await updateCierreCajaERPStatus(cierreCreado.id, 'cerrado', user.uid);
            await procesarCierreCajaERP(cierreCreado.id, user.uid, user.email);
            await updateCierreCajaERPStatus(cierreCreado.id, 'completado', user.uid);

            await loadCierres();
            setFormData(createInitialFormData(sucursalPredeterminada));
            resetCierrePhotos();
            setClaveFaltante('');
            setViewingCierre(null);
            setActiveTab('completados');
            setSuccess('Cierre de caja procesado exitosamente');
            setProcessedNotice({
                id: cierreCreado.id,
                codigo: getDisplayCierreCode(cierreCreado),
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
                ? ` Revise el cierre ${getDisplayCierreCode(cierreCreado)} antes de intentarlo de nuevo.`
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

    const getDesgloseRows = (field, source = formData) =>
        Array.isArray(source?.desgloseMontos?.[field]) ? source.desgloseMontos[field] : [];

    const getDesgloseTotal = (field, source = formData) =>
        getDesgloseRows(field, source).reduce(
            (total, row) => total + Number(row?.monto || 0),
            0
        );

    const handleMetodoPagoTotalChange = (field, value) => {
        setFormData((prev) => {
            const nextDesglose = {
                ...(prev.desgloseMontos || createInitialDesgloseMontos())
            };

            if ((nextDesglose[field] || []).length > 0) {
                nextDesglose[field] = [];
            }

            return {
                ...prev,
                [field]: value,
                desgloseMontos: nextDesglose
            };
        });
    };

    const openDesgloseModal = (field) => {
        const existingRows = getDesgloseRows(field);
        const currentValue = String(formData[field] ?? '').trim();
        const initialRows = existingRows.length > 0
            ? existingRows.map((row) => createDesgloseMontoDraft(row))
            : [
                createDesgloseMontoDraft(
                    Number(currentValue || 0) > 0 ? { monto: currentValue } : {}
                )
            ];

        setDesgloseModal({ field, rows: initialRows });
    };

    const closeDesgloseModal = () => {
        setDesgloseModal({ field: '', rows: [] });
    };

    const addDesgloseRow = () => {
        setDesgloseModal((prev) => ({
            ...prev,
            rows: [...prev.rows, createDesgloseMontoDraft()]
        }));
    };

    const updateDesgloseRow = (rowId, field, value) => {
        setDesgloseModal((prev) => ({
            ...prev,
            rows: prev.rows.map((row) =>
                row.id === rowId
                    ? { ...row, [field]: value }
                    : row
            )
        }));
    };

    const removeDesgloseRow = (rowId) => {
        setDesgloseModal((prev) => {
            const nextRows = prev.rows.filter((row) => row.id !== rowId);
            return {
                ...prev,
                rows: nextRows.length > 0 ? nextRows : [createDesgloseMontoDraft()]
            };
        });
    };

    const saveDesgloseModal = () => {
        const field = desgloseModal.field;
        const config = METODO_PAGO_DESGLOSE_CONFIG[field];

        if (!field || !config) {
            closeDesgloseModal();
            return;
        }

        const normalizedRows = normalizeDesgloseMontoRows(
            desgloseModal.rows,
            config.moneda
        );
        const total = normalizedRows.reduce(
            (sum, row) => sum + Number(row?.monto || 0),
            0
        );

        setFormData((prev) => ({
            ...prev,
            [field]: total > 0 ? total.toFixed(2) : '0',
            desgloseMontos: {
                ...(prev.desgloseMontos || createInitialDesgloseMontos()),
                [field]: normalizedRows
            }
        }));

        closeDesgloseModal();
    };

    const renderMetodoPagoField = (field) => {
        const config = METODO_PAGO_DESGLOSE_CONFIG[field];
        const rows = getDesgloseRows(field);
        const totalDesglose = getDesgloseTotal(field);
        const hasDesglose = rows.length > 0;

        return (
            <div key={field} className="rounded-[22px] border border-slate-200 bg-white/85 p-4 shadow-sm">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    {config.label}
                </label>
                <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="number"
                            step="0.01"
                            value={formData[field]}
                            onChange={(e) => handleMetodoPagoTotalChange(field, e.target.value)}
                            placeholder="0.00"
                            className={inputClass}
                        />
                        <button
                            type="button"
                            onClick={() => openDesgloseModal(field)}
                            className="inline-flex items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 whitespace-nowrap"
                        >
                            Desglosar
                        </button>
                    </div>
                    <p className={`text-xs ${hasDesglose ? 'text-blue-600' : 'text-slate-500'}`}>
                        {hasDesglose
                            ? `${rows.length} monto${rows.length === 1 ? '' : 's'} cargado${rows.length === 1 ? '' : 's'} · Total ${formatCurrency(totalDesglose, config.moneda)}`
                            : 'Puede digitar el total o abrir el desglose para sumar varios montos.'}
                    </p>
                </div>
            </div>
        );
    };

    // Renderizar formulario de nuevo cierre
    const renderNuevoCierre = () => (
        <form onSubmit={handleGuardar} className="space-y-5 lg:space-y-6">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-[26px] bg-slate-900 px-5 py-4 text-white shadow-[0_22px_50px_-28px_rgba(15,23,42,0.85)]">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Ingreso SICAR</p>
                    <p className="mt-3 text-2xl md:text-3xl font-black">{formatCurrency(totales.totalIngresoRegistrado)}</p>
                </div>
                <div className="rounded-[26px] border border-emerald-200 bg-white px-5 py-4 shadow-[0_22px_50px_-36px_rgba(16,185,129,0.35)]">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-600">Ventas contado</p>
                    <p className="mt-3 text-2xl md:text-3xl font-black text-emerald-600">{formatCurrency(totales.totalVentasContado)}</p>
                </div>
                <div className="rounded-[26px] border border-amber-200 bg-white px-5 py-4 shadow-[0_22px_50px_-36px_rgba(251,191,36,0.35)]">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-600">Credito neto</p>
                    <p className="mt-3 text-2xl md:text-3xl font-black text-amber-600">{formatCurrency(totales.totalFacturasCredito)}</p>
                </div>
                <div className="rounded-[26px] border border-blue-200 bg-white px-5 py-4 shadow-[0_22px_50px_-36px_rgba(59,130,246,0.35)]">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-600">Abonos recibidos</p>
                    <p className="mt-3 text-2xl md:text-3xl font-black text-blue-600">{formatCurrency(totales.totalAbonosRecibidos)}</p>
                </div>
            </div>
            {/* Información General */}
            <div className={panelClass}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Información General
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Configure la jornada, la sucursal y el responsable del cierre.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Cierre listo para móvil, tablet y escritorio.
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
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
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                        <p className="text-sm text-green-700">Ventas al Contado del Cierre</p>
                        <p className="text-2xl font-bold text-green-900">
                            {formatCurrency(totales.totalVentasContado)}
                        </p>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                        <p className="text-sm text-blue-700">Regla del Cuadre</p>
                        <p className="text-sm text-blue-900 mt-1">
                            Métodos de pago + gastos + retenciones deben explicar el total del ingreso SICAR del cierre.
                        </p>
                    </div>
                </div>
            </div>

            {/* Efectivo en Standby */}
            <div className={panelClass}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-600" />
                    Efectivo en Standby
                </h3>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="font-medium text-blue-900">
                        El efectivo del cierre ya no se vincula a una cuenta manual de caja.
                    </p>
                    <p className="text-sm text-blue-700 mt-2">
                        Queda en standby como dinero en tránsito y se lleva al banco cuando confirmas el depósito con foto y referencia bancaria.
                    </p>
                </div>
            </div>

            {/* Datos SICAR */}
            <div className={panelClass}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    Datos SICAR
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
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
                            Facturas de Crédito
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.totalFacturasCreditoBrutas}
                            onChange={(e) => setFormData(prev => ({ ...prev, totalFacturasCreditoBrutas: e.target.value }))}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Facturas Crédito Canceladas
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.totalFacturasCreditoCanceladas}
                            onChange={(e) => setFormData(prev => ({ ...prev, totalFacturasCreditoCanceladas: e.target.value }))}
                            placeholder="0.00"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Total de Facturas de Crédito
                        </label>
                        <div className="w-full px-3 py-2 border rounded-lg bg-slate-50 text-slate-700 font-semibold">
                            {formatCurrency(totales.totalFacturasCredito)}
                        </div>
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
            <div className={panelClass}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-purple-600" />
                    Métodos de Pago
                </h3>
                
                {/* Efectivo */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">Efectivo</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex flex-col justify-between">
                            <div>
                                <p className="text-sm font-medium text-blue-900">Conteo de Efectivo</p>
                                <p className="text-xs text-blue-700 mt-1">
                                    Cuente billetes y monedas en una ventana emergente y aplique el resultado al efectivo del cierre.
                                </p>
                                {formData.arqueoRealizado && (
                                    <div className="mt-3 text-sm text-blue-800 space-y-1">
                                        <p>Arqueo C$: {formatCurrency(arqueoTotales.totalArqueoCS)}</p>
                                        <p>Arqueo USD: {formatCurrency(arqueoTotales.efectivoUSDFisico, 'USD')}</p>
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setArqueoModalOpen(true)}
                                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Contar efectivo
                            </button>
                        </div>
                    </div>
                </div>

                {/* POS */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">POS</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {renderMetodoPagoField('posBAC')}
                        {renderMetodoPagoField('posBANPRO')}
                        {renderMetodoPagoField('posLAFISE')}
                    </div>
                </div>

                {/* Transferencias NIO */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3">Transferencias (Córdobas)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {renderMetodoPagoField('transferenciaBAC')}
                        {renderMetodoPagoField('transferenciaBANPRO')}
                        {renderMetodoPagoField('transferenciaLAFISE')}
                    </div>
                </div>

                {/* NUEVO: Transferencias USD */}
                <div className="mb-6">
                    <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Transferencias (Dólares USD)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderMetodoPagoField('transferenciaBAC_USD')}
                        {renderMetodoPagoField('transferenciaLAFISE_USD')}
                    </div>
                </div>
            </div>

            {/* Retenciones */}
            <div className={panelClass}>
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
            <div className={panelClass}>
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

            {false && (
            <div className={panelClass}>
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
                    <>
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
                    {diferenciaCajaPendiente && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div>
                                    <p className="font-semibold text-amber-900">
                                        {tipoAjusteDiferencia === 'faltante'
                                            ? 'Enviar a Faltante de Caja'
                                            : 'Enviar a Sobrante de Caja'}
                                    </p>
                                    <p className="text-sm text-amber-800 mt-1">
                                        {tipoAjusteDiferencia === 'faltante'
                                            ? 'El faltante se registrará en Otros Gastos Diversos.'
                                            : 'El sobrante se registrará en Otros Ingresos Diversos.'}
                                    </p>
                                    {formData.ajusteDiferenciaCaja?.aplicado && (
                                        <p className="text-sm text-green-700 mt-2 font-medium">
                                            Diferencia enviada correctamente al ajuste de caja.
                                        </p>
                                    )}
                                </div>
                                <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3">
                                    {requiereClaveFaltante && (
                                        <input
                                            type="password"
                                            value={claveFaltante}
                                            onChange={(e) => setClaveFaltante(e.target.value)}
                                            placeholder='Clave secreta: afirmativo'
                                            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500"
                                        />
                                    )}
                                    <button
                                        type="button"
                                        onClick={enviarDiferenciaCaja}
                                        className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                                    >
                                        {tipoAjusteDiferencia === 'faltante'
                                            ? 'Enviar a Faltante'
                                            : 'Enviar a Sobrante'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    </>
                )}
            </div>
            )}

            {/* Resumen y Cuadre */}
            <div className={panelClass}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-blue-600" />
                    Resumen y Cuadre
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-gray-600">Efectivo en Standby</p>
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

                {!totales.estaCuadrado && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div>
                                <p className="font-semibold text-amber-900">
                                    {tipoAjusteDiferencia === 'faltante'
                                        ? 'Enviar a Faltante de Caja'
                                        : 'Enviar a Sobrante de Caja'}
                                </p>
                                <p className="text-sm text-amber-800 mt-1">
                                    {tipoAjusteDiferencia === 'faltante'
                                        ? 'La diferencia faltante se registrará en Otros Gastos Diversos.'
                                        : 'La diferencia sobrante se registrará en Otros Ingresos Diversos.'}
                                </p>
                                {formData.ajusteDiferenciaCaja?.aplicado && (
                                    <p className="text-sm text-green-700 mt-2 font-medium">
                                        Diferencia enviada correctamente al ajuste de caja. Ya puede cerrar el cierre.
                                    </p>
                                )}
                            </div>
                            <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3">
                                {requiereClaveFaltante && (
                                    <input
                                        type="password"
                                        value={claveFaltante}
                                        onChange={(e) => setClaveFaltante(e.target.value)}
                                        placeholder='Clave secreta: afirmativo'
                                        className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500"
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={enviarDiferenciaCaja}
                                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                                >
                                    {tipoAjusteDiferencia === 'faltante'
                                        ? 'Enviar a Faltante'
                                        : 'Enviar a Sobrante'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Observaciones */}
            <div className={panelClass}>
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

            <div className={panelClass}>
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
            <div className={`${panelClass} flex flex-col gap-3 md:flex-row`}>
                <button
                    type="submit"
                    disabled={submitting}
                    className={`${primaryButtonClass} flex-1`}
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
                    disabled={submitting || (!totales.estaCuadrado && !formData.ajusteDiferenciaCaja?.aplicado)}
                    className={`${successButtonClass} flex-1`}
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

            {arqueoModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b sticky top-0 bg-white">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900">Conteo de Efectivo</h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Cuente los billetes y monedas. Al confirmar, el resultado se aplicará a Efectivo C$ y Efectivo USD.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setArqueoModalOpen(false)}
                                    className="px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100"
                                >
                                    <XCircle className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
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
                            </div>

                            <div className="rounded-xl bg-slate-50 border p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Arqueo C$</p>
                                    <p className="text-xl font-bold text-slate-900">{formatCurrency(arqueoTotales.totalArqueoCS)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Arqueo USD</p>
                                    <p className="text-xl font-bold text-slate-900">{formatCurrency(arqueoTotales.efectivoUSDFisico, 'USD')}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Total contado</p>
                                    <p className="text-xl font-bold text-slate-900">{formatCurrency(arqueoTotales.totalArqueo)}</p>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setArqueoModalOpen(false)}
                                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={calcularArqueo}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    Aplicar al efectivo
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {desgloseModal.field && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b sticky top-0 bg-white">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-900">
                                        Desglose de {METODO_PAGO_DESGLOSE_CONFIG[desgloseModal.field]?.label}
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Agregue varios montos para que el total se sume automáticamente en el cierre.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeDesgloseModal}
                                    className="px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100"
                                >
                                    <XCircle className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            {desgloseModal.rows.map((row, index) => (
                                <div
                                    key={row.id}
                                    className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 border rounded-xl p-4"
                                >
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Referencia o detalle
                                        </label>
                                        <input
                                            type="text"
                                            value={row.descripcion}
                                            onChange={(e) => updateDesgloseRow(row.id, 'descripcion', e.target.value)}
                                            placeholder={`Detalle ${index + 1}`}
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Monto
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={row.monto}
                                            onChange={(e) => updateDesgloseRow(row.id, 'monto', e.target.value)}
                                            placeholder="0.00"
                                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <button
                                            type="button"
                                            onClick={() => removeDesgloseRow(row.id)}
                                            className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}

                            <button
                                type="button"
                                onClick={addDesgloseRow}
                                className="w-full border border-dashed border-blue-300 text-blue-700 rounded-xl px-4 py-3 hover:bg-blue-50 flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Agregar otro monto
                            </button>

                            <div className="rounded-xl bg-slate-50 border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <p className="text-sm text-gray-500">Total del desglose</p>
                                    <p className="text-2xl font-bold text-slate-900">
                                        {formatCurrency(
                                            desgloseModal.rows.reduce((sum, row) => sum + Number(row?.monto || 0), 0),
                                            METODO_PAGO_DESGLOSE_CONFIG[desgloseModal.field]?.moneda || 'NIO'
                                        )}
                                    </p>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={closeDesgloseModal}
                                        className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveDesgloseModal}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        Guardar desglose
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </form>
    );

    // Renderizar lista de cierres completados (modo lectura)
    const renderCierresCompletados = () => (
        <div className="space-y-4">
            {cierresCompletados.length === 0 ? (
                <div className={`${panelClass} py-10 text-center`}>
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                        <Lock className="h-8 w-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">No hay cierres completados</h3>
                    <p className="mt-2 text-slate-500">Los cierres procesados aparecerán aquí.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {cierresCompletados.map((cierre) => (
                        <div
                            key={cierre.id}
                            className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur md:p-6"
                        >
                            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                                <div className="flex-1 space-y-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                            <Lock className="h-3.5 w-3.5" />
                                            {cierre.estado === 'completado' ? 'Completado' : 'Cerrado'}
                                        </span>
                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                            {getDisplayCierreCode(cierre)}
                                        </span>
                                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                            {cierre.caja}
                                        </span>
                                        <span className="text-sm text-slate-500">{cierre.fecha}</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Cajero</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">{cierre.cajero}</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Ingreso</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                                {formatCurrency(cierre.totalIngreso ?? cierre.cuadre?.totalIngreso)}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Diferencia</p>
                                            <p className={`mt-2 text-sm font-semibold ${
                                                cierre.cuadre?.estaCuadrado ? 'text-emerald-600' : 'text-red-600'
                                            }`}>
                                                {formatCurrency(cierre.cuadre?.diferencia || 0)}
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Movimientos</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                                {cierre.totalMovimientos || cierre.movimientosContablesIds?.length || 0} registrados
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Fotos</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                                {Array.isArray(cierre.fotos) && cierre.fotos.length > 0
                                                    ? `${cierre.fotos.length} adjunta${cierre.fotos.length === 1 ? '' : 's'}`
                                                    : 'Sin fotos'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => handleViewCierre(cierre)}
                                    className={`${primaryButtonClass} w-full xl:w-auto`}
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
        const fotosCierre = viewingCierreFotos;
        const gruposDesgloseMetodoPago = METODO_PAGO_DESGLOSE_FIELDS
            .map((field) => {
                const config = METODO_PAGO_DESGLOSE_CONFIG[field];
                const rows = normalizeDesgloseMontoRows(
                    cierre?.desgloseMontos?.[field],
                    config.moneda
                );

                return {
                    field,
                    config,
                    rows,
                    total: rows.reduce((sum, row) => sum + Number(row?.monto || 0), 0)
                };
            })
            .filter((group) => group.rows.length > 0);
        
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
                    <div className="p-6 border-b sticky top-0 bg-white">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Lock className="w-6 h-6 text-green-600" />
                                Cierre de Caja - {getDisplayCierreCode(cierre)}
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
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Código</p>
                                    <p className="font-medium">{getDisplayCierreCode(cierre)}</p>
                                </div>
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

                        {/* Efectivo en Standby */}
                        {(cierre.cuentaStandbyEfectivo || cierre.cuentaEfectivo) && (
                            <div className="bg-blue-50 rounded-lg p-4">
                                <h3 className="font-semibold mb-3">Efectivo en Standby</h3>
                                <p className="font-medium">
                                    {(cierre.cuentaStandbyEfectivo || cierre.cuentaEfectivo)?.code} - {(cierre.cuentaStandbyEfectivo || cierre.cuentaEfectivo)?.name}
                                </p>
                            </div>
                        )}

                        {/* Totales */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <h3 className="font-semibold mb-3">Totales</h3>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Total Ingreso SICAR</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalIngreso ?? cierre.cuadre?.totalIngreso)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Ventas al contado</p>
                                    <p className="font-medium">{formatCurrency(cierre.cuadre?.totalVentasContado ?? cierre.totalVentasContado)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Crédito bruto</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalFacturasCreditoBrutas ?? cierre.cuadre?.totalFacturasCreditoBrutas)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Crédito cancelado</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalFacturasCreditoCanceladas ?? cierre.cuadre?.totalFacturasCreditoCanceladas)}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Total facturas de crédito</p>
                                    <p className="font-medium">{formatCurrency(cierre.totalFacturasCredito ?? cierre.cuadre?.totalFacturasCredito)}</p>
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

                        {gruposDesgloseMetodoPago.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <h3 className="font-semibold">Desglose de POS y Transferencias</h3>
                                    <span className="text-sm text-gray-500">
                                        {gruposDesgloseMetodoPago.length} cuenta{gruposDesgloseMetodoPago.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {gruposDesgloseMetodoPago.map((group) => (
                                        <div key={group.field} className="bg-white border rounded-xl p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <h4 className="font-semibold text-gray-900">{group.config.label}</h4>
                                                <span className="font-semibold text-blue-700">
                                                    {formatCurrency(group.total, group.config.moneda)}
                                                </span>
                                            </div>
                                            <div className="space-y-2 mt-3">
                                                {group.rows.map((row, index) => (
                                                    <div
                                                        key={row.id || `${group.field}-${index}`}
                                                        className="flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0 pb-2 last:pb-0"
                                                    >
                                                        <p className="text-sm text-gray-700">
                                                            {row.descripcion || `Monto ${index + 1}`}
                                                        </p>
                                                        <span className="text-sm font-medium text-gray-900">
                                                            {formatCurrency(row.monto, group.config.moneda)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {loadingViewingCierreFotos && (
                            <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3 text-gray-600">
                                <RefreshCw className="w-5 h-5 animate-spin" />
                                Cargando fotos adjuntas...
                            </div>
                        )}

                        {!loadingViewingCierreFotos && fotosCierre.length > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <h3 className="font-semibold">Fotos Adjuntas</h3>
                                    <span className="text-sm text-gray-500">
                                        {fotosCierre.length} foto{fotosCierre.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {fotosCierre.map((foto, index) => {
                                        const fotoUrl = foto?.url || null;

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
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_32%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_46%,#f8fafc_100%)] px-3 py-4 sm:px-4 md:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
            {/* Header */}
            <div className="mb-6 overflow-hidden rounded-[32px] border border-white/70 bg-slate-900 px-5 py-6 text-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.95)] md:px-8 md:py-7">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-slate-200">
                    <Calculator className="h-4 w-4 text-blue-300" />
                    Operación protegida
                </div>
                <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <h1 className="text-3xl font-black tracking-tight md:text-4xl">
                            Cierre de Caja ERP
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                            Misma operación, con una experiencia más clara, dinámica y lista para teléfono, tablet y escritorio.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-[24px] border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Ingreso</p>
                            <p className="mt-2 text-xl font-black">{formatCurrency(totales.totalIngresoRegistrado)}</p>
                        </div>
                        <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100">Cuadre</p>
                            <p className={`mt-2 text-xl font-black ${totales.estaCuadrado ? 'text-emerald-300' : 'text-amber-200'}`}>
                                {totales.estaCuadrado ? 'OK' : formatCurrency(totales.diferencia)}
                            </p>
                        </div>
                        <div className="rounded-[24px] border border-blue-400/20 bg-blue-400/10 px-4 py-3">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-100">Retenciones</p>
                            <p className="mt-2 text-xl font-black text-blue-100">{formatCurrency(totales.totalRetenciones)}</p>
                        </div>
                        <div className="rounded-[24px] border border-orange-400/20 bg-orange-400/10 px-4 py-3">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-100">Gastos</p>
                            <p className="mt-2 text-xl font-black text-orange-100">{formatCurrency(totales.totalGastosCaja)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-6 overflow-x-auto">
                <div className="inline-flex min-w-full gap-2 rounded-[24px] border border-white/70 bg-white/80 p-2 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.8)] backdrop-blur sm:min-w-0">
                    <button
                        onClick={() => setActiveTab('nuevo')}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                            activeTab === 'nuevo'
                                ? 'bg-blue-600 text-white shadow-[0_18px_30px_-18px_rgba(37,99,235,0.8)]'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <Plus className="w-4 h-4" />
                        Nuevo Cierre
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('pendientes');
                            loadCierres();
                        }}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                            activeTab === 'pendientes'
                                ? 'bg-blue-600 text-white shadow-[0_18px_30px_-18px_rgba(37,99,235,0.8)]'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <Unlock className="w-4 h-4" />
                        Pendientes
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('completados');
                            loadCierres();
                        }}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                            activeTab === 'completados'
                                ? 'bg-blue-600 text-white shadow-[0_18px_30px_-18px_rgba(37,99,235,0.8)]'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <Lock className="w-4 h-4" />
                        Completados
                    </button>
                </div>
            </div>
            {/* Contenido según tab */}
            {activeTab === 'nuevo' && renderNuevoCierre()}
            {activeTab === 'pendientes' && (
                <div className="rounded-[28px] border border-white/70 bg-white/85 px-6 py-12 text-center text-slate-500 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.4)]">
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
                                <span className="text-sm text-gray-500">Código</span>
                                <span className="font-medium text-right">{processedNotice.codigo || '-'}</span>
                            </div>
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
        </div>
    );
};

export default CierreCajaERP;



