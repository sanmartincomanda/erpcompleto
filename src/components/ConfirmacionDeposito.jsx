// src/components/ConfirmacionDeposito.jsx - Confirmación de Depósitos Bancarios
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, storage } from '../firebase';
import { 
    collection, query, where, orderBy, onSnapshot, 
    doc, getDoc, updateDoc, Timestamp, addDoc 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../context/AuthContext';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import { confirmarDepositoBancarioERP } from '../services/unifiedAccountingService';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    CheckCircle, AlertCircle, Landmark, Calendar, 
    Clock, DollarSign, Search, Filter, Eye, 
    X, Check, Banknote, ArrowRight, RefreshCw,
    Building2, FileText, User, Camera, Upload, Image
} from 'lucide-react';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const createInitialConfirmForm = () => ({
    bancoDestinoId: '',
    fechaDeposito: format(new Date(), 'yyyy-MM-dd'),
    horaDeposito: format(new Date(), 'HH:mm'),
    referenciaBancaria: '',
    comentarios: ''
});

const revokePreviewUrl = (url) => {
    if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
};

const ConfirmacionDeposito = () => {
    const { user } = useAuth();
    const { getBancoAccounts } = usePlanCuentas();
    
    const [depositos, setDepositos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtroEstado, setFiltroEstado] = useState('pendiente');
    const [searchTerm, setSearchTerm] = useState('');
    
    // Modal de confirmación
    const [showModal, setShowModal] = useState(false);
    const [selectedDeposito, setSelectedDeposito] = useState(null);
    const [confirmForm, setConfirmForm] = useState(createInitialConfirmForm);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    
    // Estados para subida de fotos
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const fileInputRef = useRef(null);

    const monedaDepositoSeleccionado = selectedDeposito?.moneda || 'NIO';
    const cuentasBanco = useMemo(
        () => getBancoAccounts(monedaDepositoSeleccionado),
        [getBancoAccounts, monedaDepositoSeleccionado]
    );

    // Cargar depósitos
    useEffect(() => {
        setLoading(true);
        const q = query(
            collection(db, 'depositosTransito'),
            orderBy('createdAt', 'desc')
        );
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setDepositos(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando depósitos:', err);
            setLoading(false);
        });
        
        return () => unsubscribe();
    }, []);

    const depositosFiltrados = useMemo(() => {
        return depositos.filter(d => {
            const matchesEstado = filtroEstado === 'todos' || d.estado === filtroEstado;
            const matchesSearch = 
                d.responsable?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                d.numero?.toString().includes(searchTerm);
            return matchesEstado && matchesSearch;
        });
    }, [depositos, filtroEstado, searchTerm]);

    const stats = useMemo(() => {
        const pendientes = depositos.filter(d => d.estado === 'pendiente');
        const confirmados = depositos.filter(d => d.estado === 'confirmado');
        return {
            totalPendientes: pendientes.length,
            montoPendientes: pendientes.reduce((sum, d) => sum + (d.total || 0), 0),
            totalConfirmados: confirmados.length,
            montoConfirmados: confirmados.reduce((sum, d) => sum + (d.total || 0), 0)
        };
    }, [depositos]);

    useEffect(() => () => {
        revokePreviewUrl(previewUrl);
    }, [previewUrl]);

    const resetSelectedImage = () => {
        revokePreviewUrl(previewUrl);
        setSelectedFile(null);
        setPreviewUrl(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const closeConfirmModal = () => {
        resetSelectedImage();
        setSelectedDeposito(null);
        setConfirmForm(createInitialConfirmForm());
        setError(null);
        setShowModal(false);
    };

    const handleConfirmar = async (e) => {
        e.preventDefault();
        const bancoDestinoIdFinal = confirmForm.bancoDestinoId || selectedDeposito?.bancoDestinoId;
        if (!bancoDestinoIdFinal) {
            setError('Debe indicar el banco destino del depósito');
            return;
        }
        
        setSubmitting(true);
        setError(null);
        
        try {
            // Subir imagen si hay una seleccionada
            let comprobanteURL = null;
            if (selectedFile) {
                comprobanteURL = await uploadImage(selectedFile, selectedDeposito.id);
            }
            
            const banco = cuentasBanco.find(b => b.id === bancoDestinoIdFinal);
            
            await confirmarDepositoBancarioERP(selectedDeposito.id, {
                bancoDestinoId: bancoDestinoIdFinal,
                bancoDestinoCode: banco?.code || selectedDeposito?.bancoDestinoCode,
                bancoDestinoName: banco?.name || selectedDeposito?.bancoDestinoName,
                fechaDeposito: confirmForm.fechaDeposito,
                horaDeposito: confirmForm.horaDeposito,
                referenciaBancaria: confirmForm.referenciaBancaria,
                comprobanteURL,
                comentarios: confirmForm.comentarios,
                userId: user.uid,
                userEmail: user.email
            });
            
            setSuccess('Depósito confirmado exitosamente');
            closeConfirmModal();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error confirmando depósito:', err);
            setError(err.message || 'Error al confirmar el depósito');
        } finally {
            setSubmitting(false);
        }
    };

    const openConfirmModal = (deposito) => {
        setSelectedDeposito(deposito);
        setConfirmForm({
            ...createInitialConfirmForm(),
            bancoDestinoId: deposito.bancoDestinoId || ''
        });
        resetSelectedImage();
        setShowModal(true);
        setError(null);
    };
    
    // Manejar selección de archivo
    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validar tipo de archivo
            if (!file.type.startsWith('image/')) {
                setError('Por favor seleccione una imagen válida (JPG, PNG)');
                return;
            }
            // Validar tamaño (máximo 5MB)
            if (file.size > 5 * 1024 * 1024) {
                setError('La imagen no debe superar los 5MB');
                return;
            }
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setError(null);
        }
    };

    const handleValidatedFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            resetSelectedImage();
            setError('Por favor seleccione una imagen vÃ¡lida (JPG, PNG, WebP)');
            return;
        }

        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            resetSelectedImage();
            setError('La imagen no debe superar los 5MB');
            return;
        }

        revokePreviewUrl(previewUrl);
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setError(null);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };
    
    // Subir imagen a Firebase Storage
    const uploadImage = async (file, depositoId) => {
        if (!file) return null;
        
        setUploadingImage(true);
        try {
            const timestamp = Date.now();
            const fileName = `comprobantes/depositos/${depositoId}/${timestamp}_${file.name}`;
            const storageRef = ref(storage, fileName);
            
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            
            return downloadURL;
        } catch (err) {
            console.error('Error subiendo imagen:', err);
            throw new Error('Error al subir la imagen: ' + err.message);
        } finally {
            setUploadingImage(false);
        }
    };

    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        if (timestamp.toDate) {
            return format(timestamp.toDate(), 'dd/MM/yyyy HH:mm', { locale: es });
        }
        return timestamp;
    };

    const selectedDepositoItems = useMemo(() => {
        if (!selectedDeposito) return [];

        if (Array.isArray(selectedDeposito.cierresOrigen) && selectedDeposito.cierresOrigen.length > 0) {
            return selectedDeposito.cierresOrigen.map((item) => ({
                key: `${item.cierreId}_${item.moneda}`,
                label: `${item.cierreCodigo || 'CIERRE'} · ${item.fechaCierre || '-'} · ${item.caja || 'Caja'}`,
                subtitle: `${item.sucursalName || 'Sin sucursal'} · ${item.cajero || 'Sin cajero'}`,
                amount: item.monto,
                currency: item.moneda || selectedDeposito.moneda
            }));
        }

        return (selectedDeposito.cuentasOrigen || []).map((item, index) => ({
            key: `${selectedDeposito.id}_${index}`,
            label: `${item.accountCode || ''} - ${item.accountName || 'Cuenta origen'}`,
            subtitle: item.cierreCodigo ? `Cierre ${item.cierreCodigo}` : 'Cuenta origen histórica',
            amount: item.monto,
            currency: selectedDeposito.moneda
        }));
    }, [selectedDeposito]);

    const bancoDestinoSeleccionado = useMemo(() => {
        if (!selectedDeposito) return null;

        const bancoId = confirmForm.bancoDestinoId || selectedDeposito.bancoDestinoId;
        if (!bancoId) return null;

        const bancoEncontrado = cuentasBanco.find((banco) => banco.id === bancoId);
        if (bancoEncontrado) return bancoEncontrado;

        return {
            id: bancoId,
            code: selectedDeposito.bancoDestinoCode || '',
            name: selectedDeposito.bancoDestinoName || 'Banco destino'
        };
    }, [confirmForm.bancoDestinoId, cuentasBanco, selectedDeposito]);

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-green-600" />
                    </div>
                    Confirmación de Depósitos
                </h1>
                <p className="text-slate-600 mt-2">
                    Confirme los depósitos en standby con foto y referencia bancaria
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-700">Depósitos Pendientes</p>
                    <p className="text-2xl font-bold text-amber-800">{stats.totalPendientes}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-700">Monto Pendiente</p>
                    <p className="text-2xl font-bold text-amber-800">{formatCurrency(stats.montoPendientes)}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-sm text-green-700">Depósitos Confirmados</p>
                    <p className="text-2xl font-bold text-green-800">{stats.totalConfirmados}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-sm text-green-700">Monto Confirmado</p>
                    <p className="text-2xl font-bold text-green-800">{formatCurrency(stats.montoConfirmados)}</p>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
                <div className="flex flex-wrap gap-4">
                    <div className="flex-1 min-w-[250px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar por responsable o número..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                    </div>
                    <select
                        value={filtroEstado}
                        onChange={(e) => setFiltroEstado(e.target.value)}
                        className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    >
                        <option value="todos">Todos los estados</option>
                        <option value="pendiente">Pendientes</option>
                        <option value="confirmado">Confirmados</option>
                    </select>
                </div>
            </div>

            {/* Mensajes */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            {/* Tabla */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">N°</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Responsable</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Sucursal</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Monto</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Estado</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr>
                                <td colSpan="7" className="px-4 py-8 text-center">
                                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-green-600" />
                                </td>
                            </tr>
                        ) : depositosFiltrados.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                                    <Banknote className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                    <p>No hay depósitos {filtroEstado !== 'todos' ? filtroEstado + 's' : ''}</p>
                                </td>
                            </tr>
                        ) : (
                            depositosFiltrados.map((deposito) => (
                                <tr key={deposito.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-mono text-sm font-medium">#{deposito.numero}</td>
                                    <td className="px-4 py-3 text-sm">{deposito.fecha}</td>
                                    <td className="px-4 py-3 text-sm font-medium">{deposito.responsable}</td>
                                    <td className="px-4 py-3 text-sm">{deposito.sucursalName || '-'}</td>
                                    <td className="px-4 py-3 text-right font-medium">
                                        {formatCurrency(deposito.total, deposito.moneda)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2 py-1 rounded-full text-xs ${
                                            deposito.estado === 'confirmado' 
                                                ? 'bg-green-100 text-green-700' 
                                                : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {deposito.estado === 'confirmado' ? 'Confirmado' : 'Pendiente'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {deposito.estado === 'pendiente' ? (
                                            <button
                                                onClick={() => openConfirmModal(deposito)}
                                                className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm flex items-center gap-1 mx-auto"
                                            >
                                                <Check className="w-4 h-4" />
                                                Confirmar
                                            </button>
                                        ) : (
                                            <span className="text-sm text-slate-500">
                                                {deposito.bancoDestinoName || 'Confirmado'}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal de Confirmación */}
            {showModal && selectedDeposito && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-green-50">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                                Confirmar Depósito #{selectedDeposito.numero}
                            </h2>
                            <button
                                onClick={closeConfirmModal}
                                className="p-2 hover:bg-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleConfirmar} className="p-6 space-y-4">
                            {/* Info del depósito */}
                            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                                <p className="text-sm"><strong>Responsable:</strong> {selectedDeposito.responsable}</p>
                                <p className="text-sm"><strong>Monto:</strong> {formatCurrency(selectedDeposito.total, selectedDeposito.moneda)}</p>
                                <p className="text-sm">
                                    <strong>Banco definido en standby:</strong>{' '}
                                    {bancoDestinoSeleccionado
                                        ? `${bancoDestinoSeleccionado.code ? `${bancoDestinoSeleccionado.code} - ` : ''}${bancoDestinoSeleccionado.name}`
                                        : 'Pendiente por elegir'}
                                </p>
                                <div className="pt-2">
                                    <p className="text-sm font-medium text-slate-700">Cierres incluidos</p>
                                    <div className="mt-2 space-y-2 max-h-48 overflow-auto pr-1">
                                        {selectedDepositoItems.length === 0 ? (
                                            <p className="text-sm text-slate-500">No hay cierres vinculados para mostrar.</p>
                                        ) : (
                                            selectedDepositoItems.map((item) => (
                                                <div key={item.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-medium text-slate-900">{item.label}</p>
                                                        <p className="text-xs text-slate-500">{item.subtitle}</p>
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                                                        {formatCurrency(item.amount, item.currency)}
                                                    </p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            {selectedDeposito?.bancoDestinoId ? (
                                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                                    <label className="block text-sm font-medium text-green-800 mb-1">
                                        <Building2 className="w-4 h-4 inline mr-1" />
                                        Banco destino
                                    </label>
                                    <p className="text-sm text-green-900 font-medium">
                                        {selectedDeposito.bancoDestinoCode ? `${selectedDeposito.bancoDestinoCode} - ` : ''}{selectedDeposito.bancoDestinoName}
                                    </p>
                                    <p className="text-xs text-green-700 mt-1">
                                        Este banco se definió cuando el depósito fue enviado a standby.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        <Building2 className="w-4 h-4 inline mr-1" />
                                        Banco Destino *
                                    </label>
                                    <select
                                        value={confirmForm.bancoDestinoId}
                                        onChange={(e) => setConfirmForm({...confirmForm, bancoDestinoId: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                        required
                                    >
                                        <option value="">Seleccione el banco donde se depositó...</option>
                                        {cuentasBanco.map(b => (
                                            <option key={b.id} value={b.id}>
                                                {b.code} - {b.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        <Calendar className="w-4 h-4 inline mr-1" />
                                        Fecha del Depósito
                                    </label>
                                    <input
                                        type="date"
                                        value={confirmForm.fechaDeposito}
                                        onChange={(e) => setConfirmForm({...confirmForm, fechaDeposito: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        <Clock className="w-4 h-4 inline mr-1" />
                                        Hora
                                    </label>
                                    <input
                                        type="time"
                                        value={confirmForm.horaDeposito}
                                        onChange={(e) => setConfirmForm({...confirmForm, horaDeposito: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    <FileText className="w-4 h-4 inline mr-1" />
                                    Referencia Bancaria *
                                </label>
                                <input
                                    type="text"
                                    value={confirmForm.referenciaBancaria}
                                    onChange={(e) => setConfirmForm({...confirmForm, referenciaBancaria: e.target.value})}
                                    placeholder="Número de comprobante o referencia"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Comentarios
                                </label>
                                <textarea
                                    value={confirmForm.comentarios}
                                    onChange={(e) => setConfirmForm({...confirmForm, comentarios: e.target.value})}
                                    placeholder="Observaciones adicionales..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                                    rows={3}
                                />
                            </div>
                            
                            {/* Subida de Foto del Comprobante */}
                            <div className="border-2 border-dashed border-slate-300 rounded-lg p-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    <Camera className="w-4 h-4 inline mr-1" />
                                    Foto del Comprobante (Opcional)
                                </label>
                                
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleValidatedFileSelect}
                                    accept="image/*"
                                    className="hidden"
                                />
                                
                                {!previewUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (fileInputRef.current) {
                                                fileInputRef.current.value = '';
                                                fileInputRef.current.click();
                                            }
                                        }}
                                        className="w-full py-4 border-2 border-dashed border-slate-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors flex flex-col items-center gap-2"
                                    >
                                        <Upload className="w-8 h-8 text-slate-400" />
                                        <span className="text-sm text-slate-600">
                                            Haga clic para subir foto del comprobante
                                        </span>
                                        <span className="text-xs text-slate-400">
                                            JPG, PNG - Máximo 5MB
                                        </span>
                                    </button>
                                ) : (
                                    <div className="relative">
                                        <img
                                            src={previewUrl}
                                            alt="Vista previa"
                                            className="w-full h-48 object-contain bg-slate-100 rounded-lg"
                                            loading="lazy"
                                        />
                                        <button
                                            type="button"
                                            onClick={resetSelectedImage}
                                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                        {uploadingImage && (
                                            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-lg">
                                                <RefreshCw className="w-8 h-8 text-white animate-spin" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={closeConfirmModal}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting || uploadingImage}
                                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {(submitting || uploadingImage) ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                                    {uploadingImage ? 'Subiendo imagen...' : submitting ? 'Confirmando...' : 'Confirmar Depósito'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConfirmacionDeposito;
