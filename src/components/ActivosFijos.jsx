import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
    AlertCircle,
    Calculator,
    Camera,
    CheckCircle,
    Eye,
    Image,
    Package,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    Upload
} from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import {
    createImageAttachment,
    createLocalImagePreviewItems,
    revokeLocalImagePreviewItems,
    resolveStoredImageEntries
} from '../utils/imageAttachments';
import {
    createActivoFijo,
    generarDepreciacionActivoFijo,
    generarDepreciacionMensualActivos
} from '../services';

const today = () => new Date().toISOString().split('T')[0];
const currentPeriod = () => today().slice(0, 7);
const toNumber = (value) => Number(value || 0);
const normalizeText = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};
const formatCurrency = (value, currency = 'NIO') =>
    new Intl.NumberFormat('es-NI', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(value || 0));
const branchName = (branch) =>
    branch?.name || branch?.nombre || branch?.branchName || branch?.tienda || 'Sucursal';
const MAX_ACTIVO_IMAGES = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const isProviderLiability = (account) => {
    const code = String(account?.code || '').replace(/\./g, '');
    return account?.subType === 'proveedores' || code === '210101' || normalizeText(account?.name).includes('proveedor');
};
const initialForm = (overrides = {}) => ({
    fechaAdquisicion: today(),
    fechaInicioDepreciacion: today(),
    sucursalId: '',
    sucursalName: '',
    nombre: '',
    descripcion: '',
    proveedorId: '',
    proveedorNombre: '',
    numeroDocumento: '',
    fechaVencimiento: '',
    moneda: 'NIO',
    tipoCambio: '36.50',
    costo: '',
    valorResidual: '0',
    vidaUtilMeses: '60',
    tipoAdquisicion: 'contado',
    cuentaActivoId: '',
    cuentaPagoId: '',
    cuentaPasivoId: '',
    cuentaDepreciacionGastoId: '',
    cuentaDepreciacionAcumuladaId: '',
    observaciones: '',
    ...overrides
});

const Field = ({ label, required = false, children, helper = '' }) => (
    <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">
            {label}
            {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {children}
        {helper && <p className="text-xs text-slate-500">{helper}</p>}
    </div>
);

const ActivosFijos = () => {
    const { user } = useAuth();
    const { branches, loading: loadingBranches } = useBranches();
    const {
        accounts,
        loading: loadingAccounts,
        getCajaAccounts,
        getBancoAccounts,
        getPasivoAccounts,
        getProveedoresAccount
    } = usePlanCuentas();

    const sucursalesActivas = useMemo(() => branches.filter((branch) => branch.isActive !== false), [branches]);
    const [activeTab, setActiveTab] = useState('registrar');
    const [form, setForm] = useState(initialForm());
    const [activos, setActivos] = useState([]);
    const [depreciaciones, setDepreciaciones] = useState([]);
    const [proveedores, setProveedores] = useState([]);
    const [loadingModule, setLoadingModule] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [processingAssetId, setProcessingAssetId] = useState('');
    const [processingBulk, setProcessingBulk] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState(null);
    const [selectedAssetAdjuntos, setSelectedAssetAdjuntos] = useState([]);
    const [loadingSelectedAssetAdjuntos, setLoadingSelectedAssetAdjuntos] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [sucursalFiltro, setSucursalFiltro] = useState('');
    const [estadoFiltro, setEstadoFiltro] = useState('');
    const [periodoDepreciacion, setPeriodoDepreciacion] = useState(currentPeriod());
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [activoAdjuntos, setActivoAdjuntos] = useState([]);
    const activoFileInputRef = useRef(null);
    const activoAdjuntosRef = useRef([]);

    useEffect(() => {
        const unsubActivos = onSnapshot(collection(db, 'activosFijos'), (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
            setActivos([...data].sort((a, b) => toMillis(b.fechaAdquisicion || b.createdAt) - toMillis(a.fechaAdquisicion || a.createdAt)));
            setLoadingModule(false);
        }, () => {
            setError('No se pudieron cargar los activos fijos.');
            setLoadingModule(false);
        });
        const unsubDepreciaciones = onSnapshot(collection(db, 'depreciacionesActivosFijos'), (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
            setDepreciaciones([...data].sort((a, b) => String(b.periodo || '').localeCompare(String(a.periodo || ''))));
        });
        const unsubProveedores = onSnapshot(collection(db, 'proveedores'), (snapshot) => {
            const data = snapshot.docs
                .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
                .filter((provider) => provider.activo !== false);
            setProveedores([...data].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))));
        });
        return () => {
            unsubActivos();
            unsubDepreciaciones();
            unsubProveedores();
        };
    }, []);

    useEffect(() => {
        if (!selectedAsset) return;
        const updatedAsset = activos.find((asset) => asset.id === selectedAsset.id);
        if (updatedAsset) setSelectedAsset(updatedAsset);
    }, [activos, selectedAsset]);

    useEffect(() => {
        activoAdjuntosRef.current = activoAdjuntos;
    }, [activoAdjuntos]);

    useEffect(() => () => {
        revokeLocalImagePreviewItems(activoAdjuntosRef.current);
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadAdjuntosActivo = async () => {
            if (!selectedAsset) {
                setSelectedAssetAdjuntos([]);
                setLoadingSelectedAssetAdjuntos(false);
                return;
            }

            setLoadingSelectedAssetAdjuntos(true);
            try {
                const adjuntos = await resolveStoredImageEntries(selectedAsset.adjuntos || []);
                if (!cancelled) {
                    setSelectedAssetAdjuntos(adjuntos);
                }
            } catch (attachmentError) {
                console.error('Error cargando adjuntos del activo:', attachmentError);
                if (!cancelled) {
                    setSelectedAssetAdjuntos([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingSelectedAssetAdjuntos(false);
                }
            }
        };

        loadAdjuntosActivo();

        return () => {
            cancelled = true;
        };
    }, [selectedAsset]);

    const cuentasActivoFijo = useMemo(() => accounts
        .filter((account) => {
            const code = String(account.code || '').replace(/\./g, '');
            return !account.isGroup && account.type === 'ACTIVO' && (account.subType === 'activo_fijo' || code.startsWith('1201')) && code !== '120199';
        })
        .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''))), [accounts]);
    const cuentasDepreciacionGasto = useMemo(() => accounts
        .filter((account) => !account.isGroup && account.type === 'GASTO' && normalizeText(account.name).includes('depreciacion'))
        .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''))), [accounts]);
    const cuentasDepreciacionAcumulada = useMemo(() => accounts
        .filter((account) => {
            const code = String(account.code || '').replace(/\./g, '');
            const name = normalizeText(account.name);
            return !account.isGroup && account.type === 'ACTIVO' && (code === '120199' || (name.includes('depreciacion') && name.includes('acumul')));
        })
        .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''))), [accounts]);
    const cuentasPasivo = useMemo(() => getPasivoAccounts(), [getPasivoAccounts]);
    const cuentaProveedorDefault = useMemo(() => getProveedoresAccount(), [getProveedoresAccount]);
    const cuentasPagoContado = useMemo(() => {
        const merged = [...getCajaAccounts(form.moneda), ...getBancoAccounts(form.moneda)];
        return merged.filter((account, index, all) => index === all.findIndex((item) => item.id === account.id));
    }, [form.moneda, getBancoAccounts, getCajaAccounts]);
    const cuentaDepreciacionGastoDefault = useMemo(() => cuentasDepreciacionGasto.find((account) => String(account.code || '') === '610112') || cuentasDepreciacionGasto[0] || null, [cuentasDepreciacionGasto]);
    const cuentaDepreciacionAcumuladaDefault = useMemo(() => cuentasDepreciacionAcumulada.find((account) => String(account.code || '') === '120199') || cuentasDepreciacionAcumulada[0] || null, [cuentasDepreciacionAcumulada]);

    useEffect(() => {
        if (!sucursalesActivas.length || form.sucursalId) return;
        const branch = sucursalesActivas[0];
        setForm((prev) => ({ ...prev, sucursalId: branch.id, sucursalName: branchName(branch) }));
    }, [form.sucursalId, sucursalesActivas]);

    useEffect(() => {
        setForm((prev) => {
            let changed = false;
            const next = { ...prev };
            if (!prev.cuentaDepreciacionGastoId && cuentaDepreciacionGastoDefault) {
                next.cuentaDepreciacionGastoId = cuentaDepreciacionGastoDefault.id;
                changed = true;
            }
            if (!prev.cuentaDepreciacionAcumuladaId && cuentaDepreciacionAcumuladaDefault) {
                next.cuentaDepreciacionAcumuladaId = cuentaDepreciacionAcumuladaDefault.id;
                changed = true;
            }
            if (prev.tipoAdquisicion === 'contado' && !prev.cuentaPagoId && cuentasPagoContado.length === 1) {
                next.cuentaPagoId = cuentasPagoContado[0].id;
                changed = true;
            }
            if (prev.tipoAdquisicion === 'credito' && !prev.cuentaPasivoId && cuentaProveedorDefault) {
                next.cuentaPasivoId = cuentaProveedorDefault.id;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [cuentaDepreciacionAcumuladaDefault, cuentaDepreciacionGastoDefault, cuentaProveedorDefault, cuentasPagoContado]);

    const cuentaPasivoSeleccionada = useMemo(() => cuentasPasivo.find((account) => account.id === form.cuentaPasivoId) || null, [cuentasPasivo, form.cuentaPasivoId]);
    const requiereProveedor = useMemo(() => form.tipoAdquisicion === 'credito' && isProviderLiability(cuentaPasivoSeleccionada), [cuentaPasivoSeleccionada, form.tipoAdquisicion]);
    const previewCalculo = useMemo(() => {
        const exchangeRate = Number(form.tipoCambio) || 1;
        const costo = toNumber(form.costo);
        const residual = toNumber(form.valorResidual);
        const costoNIO = form.moneda === 'USD' ? costo * exchangeRate : costo;
        const residualNIO = form.moneda === 'USD' ? residual * exchangeRate : residual;
        const baseDepreciable = Math.max(costoNIO - residualNIO, 0);
        const depreciacionMensual = toNumber(form.vidaUtilMeses) > 0 ? baseDepreciable / toNumber(form.vidaUtilMeses) : 0;
        return { costoNIO, baseDepreciable, depreciacionMensual };
    }, [form.costo, form.moneda, form.tipoCambio, form.valorResidual, form.vidaUtilMeses]);
    const resumen = useMemo(() => activos.reduce((acc, asset) => {
        acc.costo += toNumber(asset.costoOriginal);
        acc.libros += toNumber(asset.valorEnLibros);
        acc.depreciacion += toNumber(asset.depreciacionAcumulada);
        return acc;
    }, { costo: 0, libros: 0, depreciacion: 0 }), [activos]);
    const activosFiltrados = useMemo(() => {
        const queryValue = normalizeText(searchTerm);
        return activos.filter((asset) => {
            const matchesSearch = !queryValue || [
                asset.nombre,
                asset.descripcion,
                asset.numeroDocumento,
                asset.proveedorNombre,
                asset.cuentaActivoCode,
                asset.cuentaActivoName
            ].some((value) => normalizeText(value).includes(queryValue));
            const matchesSucursal = !sucursalFiltro || asset.sucursalId === sucursalFiltro;
            const matchesEstado = !estadoFiltro || asset.estado === estadoFiltro;
            return matchesSearch && matchesSucursal && matchesEstado;
        });
    }, [activos, estadoFiltro, searchTerm, sucursalFiltro]);
    const depreciacionesFiltradas = useMemo(() => {
        const queryValue = normalizeText(searchTerm);
        return depreciaciones.filter((item) => {
            const matchesSearch = !queryValue || [
                item.activoFijoNombre,
                item.periodo,
                item.cuentaGastoCode,
                item.cuentaGastoName
            ].some((value) => normalizeText(value).includes(queryValue));
            const matchesSucursal = !sucursalFiltro || item.sucursalId === sucursalFiltro;
            return matchesSearch && matchesSucursal;
        });
    }, [depreciaciones, searchTerm, sucursalFiltro]);
    const selectedAssetDepreciaciones = useMemo(() => selectedAsset
        ? [...depreciaciones.filter((item) => item.activoFijoId === selectedAsset.id)]
            .sort((left, right) => String(right.periodo || '').localeCompare(String(left.periodo || '')))
        : [], [depreciaciones, selectedAsset]);

    const resetMessages = () => {
        setError('');
        setSuccess('');
    };
    const onField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
    const onBranch = (branchId) => {
        const branch = sucursalesActivas.find((item) => item.id === branchId);
        setForm((prev) => ({ ...prev, sucursalId: branchId, sucursalName: branch ? branchName(branch) : '' }));
    };
    const onProvider = (providerId) => {
        const provider = proveedores.find((item) => item.id === providerId);
        setForm((prev) => ({ ...prev, proveedorId: providerId, proveedorNombre: provider ? provider.nombre || prev.proveedorNombre : prev.proveedorNombre }));
    };
    const resetFormState = () => setForm(initialForm({
        sucursalId: form.sucursalId,
        sucursalName: form.sucursalName,
        tipoAdquisicion: form.tipoAdquisicion,
        moneda: form.moneda,
        tipoCambio: form.tipoCambio,
        cuentaDepreciacionGastoId: form.cuentaDepreciacionGastoId || cuentaDepreciacionGastoDefault?.id || '',
        cuentaDepreciacionAcumuladaId: form.cuentaDepreciacionAcumuladaId || cuentaDepreciacionAcumuladaDefault?.id || '',
        cuentaPagoId: form.tipoAdquisicion === 'contado' && cuentasPagoContado.length === 1 ? cuentasPagoContado[0].id : '',
        cuentaPasivoId: form.tipoAdquisicion === 'credito' && cuentaProveedorDefault ? cuentaProveedorDefault.id : ''
    }));

    const resetActivoAdjuntos = () => {
        revokeLocalImagePreviewItems(activoAdjuntos);
        setActivoAdjuntos([]);
        if (activoFileInputRef.current) {
            activoFileInputRef.current.value = '';
        }
    };

    const handleActivoAdjuntosSelect = (event) => {
        const selectedFiles = Array.from(event.target.files || []);
        if (!selectedFiles.length) return;

        if (activoAdjuntos.length + selectedFiles.length > MAX_ACTIVO_IMAGES) {
            setError(`Puede adjuntar hasta ${MAX_ACTIVO_IMAGES} imágenes por activo.`);
            if (activoFileInputRef.current) activoFileInputRef.current.value = '';
            return;
        }

        for (const file of selectedFiles) {
            if (!file.type.startsWith('image/')) {
                setError(`"${file.name}" no es una imagen válida.`);
                if (activoFileInputRef.current) activoFileInputRef.current.value = '';
                return;
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                setError(`"${file.name}" supera el máximo de 5MB.`);
                if (activoFileInputRef.current) activoFileInputRef.current.value = '';
                return;
            }
        }

        setActivoAdjuntos((prev) => [...prev, ...createLocalImagePreviewItems(selectedFiles, 'activo-fijo')]);
        setError('');

        if (activoFileInputRef.current) {
            activoFileInputRef.current.value = '';
        }
    };

    const removeActivoAdjunto = (attachmentId) => {
        const attachment = activoAdjuntos.find((item) => item.id === attachmentId);
        if (attachment?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.previewUrl);
        }
        setActivoAdjuntos((prev) => prev.filter((item) => item.id !== attachmentId));
        if (activoFileInputRef.current) {
            activoFileInputRef.current.value = '';
        }
    };

    const persistActivoAdjuntos = async () =>
        Promise.all(
            activoAdjuntos.map((item) =>
                createImageAttachment({
                    file: item.file,
                    entityType: 'activoFijo',
                    entityId: null,
                    category: 'activoFijo',
                    fileName: item.name,
                    userId: user?.uid,
                    userEmail: user?.email
                })
            )
        );

    const handleSubmit = async (event) => {
        event.preventDefault();
        resetMessages();

        if (!form.sucursalId) return setError('Seleccione la sucursal del activo.');
        if (!form.nombre.trim()) return setError('Ingrese el nombre del activo.');
        if (!form.cuentaActivoId) return setError('Seleccione la cuenta del activo fijo.');
        if (toNumber(form.costo) <= 0) return setError('El costo debe ser mayor a cero.');
        if (form.tipoAdquisicion === 'contado' && !form.cuentaPagoId) return setError('Seleccione la cuenta de salida.');
        if (form.tipoAdquisicion === 'credito' && !form.cuentaPasivoId) return setError('Seleccione la cuenta pasiva.');
        if (requiereProveedor && !form.proveedorNombre.trim()) return setError('Indique el proveedor para registrar la obligación.');

        setSubmitting(true);
        try {
            const adjuntos = await persistActivoAdjuntos();
            const result = await createActivoFijo({
                ...form,
                nombre: form.nombre.trim(),
                descripcion: form.descripcion.trim(),
                proveedorNombre: form.proveedorNombre.trim(),
                costo: toNumber(form.costo),
                valorResidual: toNumber(form.valorResidual),
                vidaUtilMeses: toNumber(form.vidaUtilMeses),
                tipoCambio: Number(form.tipoCambio) || 1,
                adjuntos,
                userId: user?.uid,
                userEmail: user?.email
            });
            setSuccess(result.facturaProveedorId ? 'Activo fijo registrado y vinculado a cuentas por pagar.' : 'Activo fijo registrado correctamente.');
            resetFormState();
            resetActivoAdjuntos();
            setActiveTab('activos');
        } catch (submitError) {
            setError(submitError.message || 'No se pudo registrar el activo fijo.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDepreciarActivo = async (assetId) => {
        resetMessages();
        setProcessingAssetId(assetId);
        try {
            await generarDepreciacionActivoFijo(assetId, {
                periodo: periodoDepreciacion,
                userId: user?.uid,
                userEmail: user?.email
            });
            setSuccess(`Depreciación ${periodoDepreciacion} registrada correctamente.`);
        } catch (processError) {
            setError(processError.message || 'No se pudo depreciar el activo.');
        } finally {
            setProcessingAssetId('');
        }
    };

    const handleDepreciacionMasiva = async () => {
        resetMessages();
        setProcessingBulk(true);
        try {
            const result = await generarDepreciacionMensualActivos({
                periodo: periodoDepreciacion,
                sucursalId: sucursalFiltro || '',
                userId: user?.uid,
                userEmail: user?.email
            });
            setSuccess(`Periodo ${result.periodo}: ${result.procesados.length} depreciado(s), ${result.omitidos.length} omitido(s), ${result.errores.length} con error.`);
            if (result.errores.length) {
                setError(result.errores.map((item) => `${item.nombre}: ${item.error}`).join(' | '));
            }
        } catch (processError) {
            setError(processError.message || 'No se pudo procesar la depreciación masiva.');
        } finally {
            setProcessingBulk(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                        <Package className="w-6 h-6" />
                    </span>
                    Activos Fijos
                </h1>
                <p className="mt-2 text-slate-600">
                    Registre activos fijos y genere la depreciación mensual desde el ERP.
                </p>
            </div>

            {(loadingModule || loadingAccounts || loadingBranches) && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 text-slate-600">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Cargando módulo...
                </div>
            )}

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-red-700">
                    <AlertCircle className="w-5 h-5 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {success && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3 text-emerald-700">
                    <CheckCircle className="w-5 h-5 mt-0.5" />
                    <span>{success}</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm text-blue-700">Costo histórico</p>
                    <p className="mt-2 text-2xl font-bold text-blue-900">{formatCurrency(resumen.costo)}</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-700">Depreciación acumulada</p>
                    <p className="mt-2 text-2xl font-bold text-amber-900">{formatCurrency(resumen.depreciacion)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm text-emerald-700">Valor en libros</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-900">{formatCurrency(resumen.libros)}</p>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
                <div className="flex flex-wrap gap-2">
                    {[
                        { id: 'registrar', label: 'Registrar', icon: Plus },
                        { id: 'activos', label: 'Activos', icon: Package },
                        { id: 'depreciaciones', label: 'Depreciaciones', icon: Calculator }
                    ].map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${
                                    activeTab === tab.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {activeTab === 'registrar' && (
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div className="xl:col-span-2 space-y-5">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <h2 className="font-bold text-slate-900 mb-4">Información del activo</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Field label="Fecha adquisición" required>
                                        <input type="date" value={form.fechaAdquisicion} onChange={(event) => onField('fechaAdquisicion', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                                    </Field>
                                    <Field label="Inicio depreciación">
                                        <input type="date" value={form.fechaInicioDepreciacion} onChange={(event) => onField('fechaInicioDepreciacion', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                                    </Field>
                                    <Field label="Sucursal" required>
                                        <select value={form.sucursalId} onChange={(event) => onBranch(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="">Seleccione...</option>
                                            {sucursalesActivas.map((branch) => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Moneda" required>
                                        <select value={form.moneda} onChange={(event) => onField('moneda', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="NIO">Córdobas (NIO)</option>
                                            <option value="USD">Dólares (USD)</option>
                                        </select>
                                    </Field>
                                    <Field label="Nombre del activo" required>
                                        <input type="text" value={form.nombre} onChange={(event) => onField('nombre', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                                    </Field>
                                    <Field label="Documento / factura">
                                        <input type="text" value={form.numeroDocumento} onChange={(event) => onField('numeroDocumento', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                                    </Field>
                                    <Field label="Descripción">
                                        <textarea value={form.descripcion} onChange={(event) => onField('descripcion', event.target.value)} rows={3} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl resize-none" />
                                    </Field>
                                    <Field label="Observaciones">
                                        <textarea value={form.observaciones} onChange={(event) => onField('observaciones', event.target.value)} rows={3} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl resize-none" />
                                    </Field>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                <h2 className="font-bold text-slate-900 mb-4">Valoración y cuentas</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <Field label="Costo" required><input type="number" min="0" step="0.01" value={form.costo} onChange={(event) => onField('costo', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" /></Field>
                                    <Field label="Valor residual"><input type="number" min="0" step="0.01" value={form.valorResidual} onChange={(event) => onField('valorResidual', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" /></Field>
                                    <Field label="Vida útil (meses)" required><input type="number" min="1" step="1" value={form.vidaUtilMeses} onChange={(event) => onField('vidaUtilMeses', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" /></Field>
                                    <Field label="Tipo de cambio" helper={form.moneda === 'USD' ? 'Convierte la compra a córdobas.' : 'Solo aplica en USD.'}><input type="number" min="0.0001" step="0.0001" disabled={form.moneda !== 'USD'} value={form.tipoCambio} onChange={(event) => onField('tipoCambio', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl disabled:bg-slate-100" /></Field>
                                    <Field label="Cuenta del activo" required>
                                        <select value={form.cuentaActivoId} onChange={(event) => onField('cuentaActivoId', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="">Seleccione...</option>
                                            {cuentasActivoFijo.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Tipo de adquisición" required>
                                        <select
                                            value={form.tipoAdquisicion}
                                            onChange={(event) => setForm((prev) => ({
                                                ...prev,
                                                tipoAdquisicion: event.target.value,
                                                cuentaPagoId: event.target.value === 'contado' && cuentasPagoContado.length === 1 ? cuentasPagoContado[0].id : '',
                                                cuentaPasivoId: event.target.value === 'credito' && cuentaProveedorDefault ? cuentaProveedorDefault.id : ''
                                            }))}
                                            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl"
                                        >
                                            <option value="contado">Contado</option>
                                            <option value="credito">Crédito</option>
                                        </select>
                                    </Field>
                                    {form.tipoAdquisicion === 'contado' ? (
                                        <Field label="Cuenta de salida" required>
                                            <select value={form.cuentaPagoId} onChange={(event) => onField('cuentaPagoId', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                                <option value="">Seleccione...</option>
                                                {cuentasPagoContado.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                                            </select>
                                        </Field>
                                    ) : (
                                        <Field label="Cuenta pasiva" required helper="Si es Proveedores, el ERP también crea la factura en CxP.">
                                            <select value={form.cuentaPasivoId} onChange={(event) => onField('cuentaPasivoId', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                                <option value="">Seleccione...</option>
                                                {cuentasPasivo.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                                            </select>
                                        </Field>
                                    )}
                                    <Field label="Fecha vencimiento"><input type="date" value={form.fechaVencimiento} onChange={(event) => onField('fechaVencimiento', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" /></Field>
                                    <Field label="Proveedor registrado">
                                        <select value={form.proveedorId} onChange={(event) => onProvider(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="">Seleccione...</option>
                                            {proveedores.map((provider) => <option key={provider.id} value={provider.id}>{provider.nombre}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Nombre del proveedor" required={requiereProveedor}><input type="text" value={form.proveedorNombre} onChange={(event) => onField('proveedorNombre', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" /></Field>
                                    <Field label="Gasto por depreciación">
                                        <select value={form.cuentaDepreciacionGastoId} onChange={(event) => onField('cuentaDepreciacionGastoId', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="">Seleccione...</option>
                                            {cuentasDepreciacionGasto.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Depreciación acumulada">
                                        <select value={form.cuentaDepreciacionAcumuladaId} onChange={(event) => onField('cuentaDepreciacionAcumuladaId', event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                            <option value="">Seleccione...</option>
                                            {cuentasDepreciacionAcumulada.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                                        </select>
                                    </Field>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-2xl border border-slate-200 p-5 space-y-3">
                                <p className="text-sm text-slate-500">Costo contable</p>
                                <p className="text-2xl font-bold text-slate-900">{formatCurrency(previewCalculo.costoNIO)}</p>
                                <p className="text-sm text-slate-500">Base depreciable</p>
                                <p className="text-xl font-bold text-slate-900">{formatCurrency(previewCalculo.baseDepreciable)}</p>
                                <p className="text-sm text-slate-500">Depreciación mensual estimada</p>
                                <p className="text-xl font-bold text-amber-700">{formatCurrency(previewCalculo.depreciacionMensual)}</p>
                            </div>
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 space-y-2">
                                <p>1. Débito al activo fijo.</p>
                                <p>2. Crédito a caja, banco o pasivo.</p>
                                <p>3. Si el crédito va a Proveedores, el ERP lo enviará también a CxP.</p>
                                <p>4. Luego podrá generar la depreciación por período sin duplicados.</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                            <Camera className="w-4 h-4 text-amber-600" />
                                            Imágenes del activo
                                        </h3>
                                        <p className="text-xs text-slate-500 mt-1">Factura, escritura o cualquier soporte del activo.</p>
                                    </div>
                                    <span className="text-sm text-slate-500">{activoAdjuntos.length}/{MAX_ACTIVO_IMAGES}</span>
                                </div>

                                <input
                                    ref={activoFileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleActivoAdjuntosSelect}
                                    className="hidden"
                                />

                                <button
                                    type="button"
                                    onClick={() => {
                                        if (activoFileInputRef.current) {
                                            activoFileInputRef.current.value = '';
                                            activoFileInputRef.current.click();
                                        }
                                    }}
                                    className="w-full px-4 py-4 border-2 border-dashed border-slate-300 rounded-xl hover:border-amber-500 hover:bg-amber-50 transition-colors flex flex-col items-center gap-2"
                                >
                                    <Upload className="w-6 h-6 text-slate-400" />
                                    <span className="font-medium text-slate-700">Agregar imágenes</span>
                                    <span className="text-xs text-slate-500">JPG, PNG o WebP. Máximo 5MB por archivo.</span>
                                </button>

                                {activoAdjuntos.length > 0 && (
                                    <div className="space-y-3">
                                        {activoAdjuntos.map((item, index) => (
                                            <div key={item.id} className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                                                <img
                                                    src={item.previewUrl}
                                                    alt={item.name || `Activo ${index + 1}`}
                                                    className="w-full h-36 object-cover bg-slate-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3 flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-slate-900 truncate">{item.name || `Adjunto ${index + 1}`}</p>
                                                        <p className="text-xs text-slate-500">{(Number(item.size || 0) / 1024 / 1024).toFixed(2)} MB</p>
                                                    </div>
                                                    <button type="button" onClick={() => removeActivoAdjunto(item.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button type="submit" disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-60">{submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{submitting ? 'Registrando...' : 'Registrar Activo Fijo'}</button>
                            <button type="button" onClick={() => { resetMessages(); resetFormState(); resetActivoAdjuntos(); }} className="w-full px-4 py-3 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold">Limpiar formulario</button>
                        </div>
                    </form>
                )}

                {activeTab === 'activos' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Field label="Buscar">
                                <div className="relative">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Activo, documento, proveedor..." className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl" />
                                </div>
                            </Field>
                            <Field label="Sucursal">
                                <select value={sucursalFiltro} onChange={(event) => setSucursalFiltro(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                    <option value="">Todas</option>
                                    {sucursalesActivas.map((branch) => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}
                                </select>
                            </Field>
                            <Field label="Estado">
                                <select value={estadoFiltro} onChange={(event) => setEstadoFiltro(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                    <option value="">Todos</option>
                                    <option value="activo">Activo</option>
                                    <option value="depreciado">Depreciado</option>
                                    <option value="inactivo">Inactivo</option>
                                </select>
                            </Field>
                            <Field label="Período para depreciar">
                                <input type="month" value={periodoDepreciacion} onChange={(event) => setPeriodoDepreciacion(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                            </Field>
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-slate-200">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Activo</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Sucursal</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Costo</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Valor libros</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Estado</th>
                                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 bg-white">
                                    {activosFiltrados.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No hay activos para los filtros seleccionados.</td>
                                        </tr>
                                    )}
                                    {activosFiltrados.map((asset) => (
                                        <tr key={asset.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-4">
                                                <div className="font-semibold text-slate-900">{asset.nombre}</div>
                                                <div className="text-sm text-slate-500">{asset.numeroDocumento || 'Sin documento'}</div>
                                                <div className="text-xs text-slate-500 mt-1">{asset.cuentaActivoCode} - {asset.cuentaActivoName}</div>
                                                {asset.facturaProveedorId && <span className="inline-flex mt-2 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Vinculado a CxP</span>}
                                                {Array.isArray(asset.adjuntos) && asset.adjuntos.length > 0 && <span className="inline-flex mt-2 ml-2 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{asset.adjuntos.length} imagen{asset.adjuntos.length === 1 ? '' : 'es'}</span>}
                                            </td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{asset.sucursalName || 'Sin sucursal'}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{formatCurrency(asset.costoOriginal)}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">
                                                <div>{formatCurrency(asset.valorEnLibros)}</div>
                                                <div className="text-xs text-slate-500">Dep. acum.: {formatCurrency(asset.depreciacionAcumulada)}</div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${asset.estado === 'depreciado' ? 'bg-slate-200 text-slate-700' : asset.estado === 'inactivo' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{asset.estado || 'activo'}</span>
                                                <div className="text-xs text-slate-500 mt-2">{toNumber(asset.mesesDepreciados)} / {toNumber(asset.vidaUtilMeses)} meses</div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <button type="button" onClick={() => setSelectedAsset(asset)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"><Eye className="w-4 h-4" />Ver</button>
                                                    <button type="button" onClick={() => handleDepreciarActivo(asset.id)} disabled={asset.estado !== 'activo' || processingAssetId === asset.id} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm disabled:opacity-50">{processingAssetId === asset.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}Depreciar</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'depreciaciones' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_auto] gap-4 items-end">
                            <Field label="Buscar">
                                <div className="relative">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input type="text" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Activo, período o cuenta..." className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl" />
                                </div>
                            </Field>
                            <Field label="Sucursal">
                                <select value={sucursalFiltro} onChange={(event) => setSucursalFiltro(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl">
                                    <option value="">Todas</option>
                                    {sucursalesActivas.map((branch) => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}
                                </select>
                            </Field>
                            <Field label="Período">
                                <input type="month" value={periodoDepreciacion} onChange={(event) => setPeriodoDepreciacion(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl" />
                            </Field>
                            <button type="button" onClick={handleDepreciacionMasiva} disabled={processingBulk} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-60">
                                {processingBulk ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                                {processingBulk ? 'Procesando...' : 'Depreciar período'}
                            </button>
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-slate-200">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Activo</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Período</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Sucursal</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Monto</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Cuenta gasto</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Fecha contable</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 bg-white">
                                    {depreciacionesFiltradas.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-10 text-center text-slate-500">Aún no hay depreciaciones para los filtros elegidos.</td>
                                        </tr>
                                    )}
                                    {depreciacionesFiltradas.map((item) => (
                                        <tr key={item.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-4 text-sm text-slate-700"><div className="font-semibold text-slate-900">{item.activoFijoNombre}</div><div className="text-xs text-slate-500">{item.documentoId}</div></td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{item.periodo}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{item.sucursalName || 'General'}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{formatCurrency(item.monto)}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{item.cuentaGastoCode} - {item.cuentaGastoName}</td>
                                            <td className="px-4 py-4 text-sm text-slate-700">{item.fechaContable}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {selectedAsset && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60" onClick={() => setSelectedAsset(null)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">{selectedAsset.nombre}</h2>
                                <p className="text-sm text-slate-500">{selectedAsset.cuentaActivoCode} - {selectedAsset.cuentaActivoName}</p>
                            </div>
                            <button type="button" onClick={() => setSelectedAsset(null)} className="px-3 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50">Cerrar</button>
                        </div>

                        <div className="p-5 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><p className="text-sm text-blue-700">Costo original</p><p className="mt-2 text-2xl font-bold text-blue-900">{formatCurrency(selectedAsset.costoOriginal)}</p></div>
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-700">Depreciación acumulada</p><p className="mt-2 text-2xl font-bold text-amber-900">{formatCurrency(selectedAsset.depreciacionAcumulada)}</p></div>
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm text-emerald-700">Valor en libros</p><p className="mt-2 text-2xl font-bold text-emerald-900">{formatCurrency(selectedAsset.valorEnLibros)}</p></div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="rounded-2xl border border-slate-200 p-5 space-y-2 text-sm text-slate-700">
                                    <h3 className="font-semibold text-slate-900">Detalle del activo</h3>
                                    <p><span className="font-medium">Sucursal:</span> {selectedAsset.sucursalName || 'Sin sucursal'}</p>
                                    <p><span className="font-medium">Fecha adquisición:</span> {selectedAsset.fechaAdquisicion || '-'}</p>
                                    <p><span className="font-medium">Inicio depreciación:</span> {selectedAsset.fechaInicioDepreciacion || '-'}</p>
                                    <p><span className="font-medium">Documento:</span> {selectedAsset.numeroDocumento || 'Sin documento'}</p>
                                    <p><span className="font-medium">Proveedor:</span> {selectedAsset.proveedorNombre || 'No indicado'}</p>
                                    <p><span className="font-medium">Vida útil:</span> {toNumber(selectedAsset.vidaUtilMeses)} meses</p>
                                    <p><span className="font-medium">Depreciación mensual:</span> {formatCurrency(selectedAsset.depreciacionMensual)}</p>
                                    {selectedAsset.descripcion && <p><span className="font-medium">Descripción:</span> {selectedAsset.descripcion}</p>}
                                    {selectedAsset.observaciones && <p><span className="font-medium">Observaciones:</span> {selectedAsset.observaciones}</p>}
                                </div>
                                <div className="rounded-2xl border border-slate-200 p-5 space-y-2 text-sm text-slate-700">
                                    <h3 className="font-semibold text-slate-900">Cuentas y vínculos</h3>
                                    <p><span className="font-medium">Activo:</span> {selectedAsset.cuentaActivoCode} - {selectedAsset.cuentaActivoName}</p>
                                    <p><span className="font-medium">Contrapartida:</span> {selectedAsset.cuentaContrapartidaCode} - {selectedAsset.cuentaContrapartidaName}</p>
                                    <p><span className="font-medium">Gasto depreciación:</span> {selectedAsset.cuentaDepreciacionGastoCode} - {selectedAsset.cuentaDepreciacionGastoName}</p>
                                    <p><span className="font-medium">Depreciación acumulada:</span> {selectedAsset.cuentaDepreciacionAcumuladaCode} - {selectedAsset.cuentaDepreciacionAcumuladaName}</p>
                                    <p><span className="font-medium">Asiento adquisición:</span> {selectedAsset.asientoAdquisicionId || 'No disponible'}</p>
                                    {selectedAsset.facturaProveedorId && <p><span className="font-medium">Factura CxP:</span> {selectedAsset.facturaProveedorId}</p>}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 p-5">
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                            <Image className="w-4 h-4 text-amber-600" />
                                            Imágenes adjuntas
                                        </h3>
                                        <p className="text-sm text-slate-500">Soportes guardados con este activo fijo.</p>
                                    </div>
                                    {loadingSelectedAssetAdjuntos && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
                                </div>

                                {!loadingSelectedAssetAdjuntos && selectedAssetAdjuntos.length === 0 && (
                                    <p className="text-sm text-slate-500">Este activo no tiene imágenes adjuntas.</p>
                                )}

                                {selectedAssetAdjuntos.length > 0 && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {selectedAssetAdjuntos.map((item, index) => (
                                            <a
                                                key={item.attachmentId || item.url || index}
                                                href={item.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
                                            >
                                                <img
                                                    src={item.url}
                                                    alt={item.name || `Activo ${index + 1}`}
                                                    className="w-full h-56 object-cover bg-slate-100"
                                                    loading="lazy"
                                                />
                                                <div className="p-3">
                                                    <p className="text-sm font-medium text-slate-900 truncate">{item.name || `Adjunto ${index + 1}`}</p>
                                                    <p className="text-xs text-amber-700 mt-1">Abrir imagen completa</p>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-2xl border border-slate-200 overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <h3 className="font-semibold text-slate-900">Historial de depreciación</h3>
                                        <p className="text-sm text-slate-500">Cada período puede registrarse una sola vez.</p>
                                    </div>
                                    <button type="button" onClick={() => handleDepreciarActivo(selectedAsset.id)} disabled={selectedAsset.estado !== 'activo' || processingAssetId === selectedAsset.id} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
                                        {processingAssetId === selectedAsset.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                                        Depreciar {periodoDepreciacion}
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Período</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Monto</th>
                                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Asiento</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 bg-white">
                                            {selectedAssetDepreciaciones.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">Este activo todavía no tiene depreciaciones registradas.</td>
                                                </tr>
                                            )}
                                            {selectedAssetDepreciaciones.map((item) => (
                                                <tr key={item.id}>
                                                    <td className="px-4 py-3 text-sm text-slate-700">{item.periodo}</td>
                                                    <td className="px-4 py-3 text-sm text-slate-700">{item.fechaContable}</td>
                                                    <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(item.monto)}</td>
                                                    <td className="px-4 py-3 text-sm text-slate-700">{item.asientoId || 'No disponible'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ActivosFijos;
