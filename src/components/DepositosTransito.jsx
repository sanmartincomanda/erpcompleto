import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { format } from 'date-fns';
import {
    AlertCircle,
    ArrowRightLeft,
    Banknote,
    Building2,
    CheckCircle,
    CheckSquare,
    Clock,
    FileText,
    Plus,
    RefreshCw
} from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import { createDepositoTransitoERP } from '../services/unifiedAccountingService';

const createInitialForm = (user) => ({
    fecha: format(new Date(), 'yyyy-MM-dd'),
    responsable: user?.email || '',
    bancoDestinoId: '',
    observaciones: ''
});

const formatCurrency = (amount, currency = 'NIO') => {
    const symbol = currency === 'USD' ? '$' : 'C$';
    return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
};

const getCierreCodigo = (cierre) => cierre?.codigoCierre || `CIERRE-${String(cierre?.id || '').slice(0, 8).toUpperCase()}`;

const buildPendingLinesFromCierre = (cierre) => {
    const lines = [];
    const depositoPendiente = cierre?.depositoPendiente || {};
    const cuentaOrigen = cierre?.cuentaEfectivo || {};
    const baseLine = {
        cierreId: cierre.id,
        cierreCodigo: getCierreCodigo(cierre),
        cierreNumero: cierre.numeroCierre || null,
        fechaCierre: cierre.fecha || '',
        sucursalId: cierre.sucursalId || null,
        sucursalName: cierre.sucursalName || cierre.tienda || '',
        caja: cierre.caja || '',
        cajero: cierre.cajero || '',
        cuentaOrigenId: cuentaOrigen.id || null,
        cuentaOrigenCode: cuentaOrigen.code || '',
        cuentaOrigenName: cuentaOrigen.name || ''
    };

    const pendingNio = depositoPendiente?.nio;
    const pendingUsd = depositoPendiente?.usd;

    const nioAmount = Number(
        pendingNio?.monto ??
        pendingNio?.montoNIO ??
        (
            !depositoPendiente?.nio &&
            cierre.procesado &&
            ['cerrado', 'completado'].includes(cierre.estado)
                ? cierre.efectivoCS
                : 0
        )
    ) || 0;

    if (nioAmount > 0) {
        lines.push({
            ...baseLine,
            uniqueKey: `${cierre.id}_nio`,
            moneda: 'NIO',
            monto: nioAmount,
            montoNIO: Number(pendingNio?.montoNIO ?? nioAmount) || nioAmount,
            montoUSD: 0,
            estado: pendingNio?.estado || 'disponible',
            depositoId: pendingNio?.depositoId || null,
            depositoNumero: pendingNio?.depositoNumero || null
        });
    }

    const usdAmount = Number(
        pendingUsd?.monto ??
        pendingUsd?.montoUSD ??
        (
            !depositoPendiente?.usd &&
            cierre.procesado &&
            ['cerrado', 'completado'].includes(cierre.estado)
                ? cierre.efectivoUSD
                : 0
        )
    ) || 0;

    if (usdAmount > 0) {
        lines.push({
            ...baseLine,
            uniqueKey: `${cierre.id}_usd`,
            moneda: 'USD',
            monto: usdAmount,
            montoNIO: Number(pendingUsd?.montoNIO ?? (usdAmount * (Number(cierre.tipoCambio) || 1))) || 0,
            montoUSD: Number(pendingUsd?.montoUSD ?? usdAmount) || usdAmount,
            estado: pendingUsd?.estado || 'disponible',
            depositoId: pendingUsd?.depositoId || null,
            depositoNumero: pendingUsd?.depositoNumero || null
        });
    }

    return lines;
};

const DepositosTransito = () => {
    const { user } = useAuth();
    const { getBancoAccounts } = usePlanCuentas();

    const [activeTab, setActiveTab] = useState('nuevo');
    const [cierres, setCierres] = useState([]);
    const [depositos, setDepositos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [monedaSeleccionada, setMonedaSeleccionada] = useState('NIO');
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [formData, setFormData] = useState(createInitialForm(user));

    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            responsable: prev.responsable || user?.email || ''
        }));
    }, [user]);

    useEffect(() => {
        const cierresQuery = query(collection(db, 'cierresCajaERP'), orderBy('createdAt', 'desc'));
        const depositosQuery = query(collection(db, 'depositosTransito'), orderBy('createdAt', 'desc'));

        const unsubscribeCierres = onSnapshot(cierresQuery, (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
            setCierres(data);
            setLoading(false);
        }, (snapshotError) => {
            console.error('Error cargando cierres para depósito:', snapshotError);
            setError('No se pudieron cargar los cierres pendientes de depósito.');
            setLoading(false);
        });

        const unsubscribeDepositos = onSnapshot(depositosQuery, (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
            setDepositos(data);
        });

        return () => {
            unsubscribeCierres();
            unsubscribeDepositos();
        };
    }, []);

    useEffect(() => {
        setSelectedKeys([]);
        setFormData((prev) => ({ ...prev, bancoDestinoId: '' }));
    }, [monedaSeleccionada]);

    const bancosDisponibles = useMemo(
        () => getBancoAccounts(monedaSeleccionada),
        [getBancoAccounts, monedaSeleccionada]
    );

    const lineasPendientes = useMemo(() => cierres
        .filter((cierre) => cierre.procesado && ['cerrado', 'completado'].includes(cierre.estado))
        .flatMap(buildPendingLinesFromCierre)
        .filter((line) => line.estado !== 'depositado' && line.moneda === monedaSeleccionada)
        .sort((left, right) => String(right.fechaCierre || '').localeCompare(String(left.fechaCierre || ''))), [cierres, monedaSeleccionada]);

    const selectedLines = useMemo(
        () => lineasPendientes.filter((line) => selectedKeys.includes(line.uniqueKey)),
        [lineasPendientes, selectedKeys]
    );

    const totalSeleccionado = useMemo(
        () => selectedLines.reduce((sum, line) => sum + Number(line.monto || 0), 0),
        [selectedLines]
    );

    const stats = useMemo(() => ({
        pendientes: lineasPendientes.filter((line) => line.estado === 'disponible').length,
        reservados: lineasPendientes.filter((line) => line.estado === 'en_transito').length,
        totalPendiente: lineasPendientes
            .filter((line) => ['disponible', 'en_transito'].includes(line.estado))
            .reduce((sum, line) => sum + Number(line.monto || 0), 0)
    }), [lineasPendientes]);

    const depositosPendientes = useMemo(
        () => depositos.filter((deposito) => deposito.estado === 'pendiente'),
        [depositos]
    );

    const depositosConfirmados = useMemo(
        () => depositos.filter((deposito) => deposito.estado === 'confirmado'),
        [depositos]
    );

    const toggleSelection = (line) => {
        if (line.estado !== 'disponible') return;

        setSelectedKeys((prev) =>
            prev.includes(line.uniqueKey)
                ? prev.filter((item) => item !== line.uniqueKey)
                : [...prev, line.uniqueKey]
        );
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);
        setSuccess(null);

        if (selectedLines.length === 0) {
            setError('Seleccione al menos un monto pendiente de cierre para agrupar el depósito.');
            return;
        }

        if (!formData.bancoDestinoId) {
            setError('Seleccione el banco destino del depósito.');
            return;
        }

        setSubmitting(true);

        try {
            const banco = bancosDisponibles.find((account) => account.id === formData.bancoDestinoId);
            const result = await createDepositoTransitoERP({
                fecha: formData.fecha,
                responsable: formData.responsable,
                moneda: monedaSeleccionada,
                bancoDestinoId: formData.bancoDestinoId,
                bancoDestinoCode: banco?.code || '',
                bancoDestinoName: banco?.name || '',
                cierresOrigen: selectedLines.map((line) => ({
                    cierreId: line.cierreId,
                    cierreCodigo: line.cierreCodigo,
                    cierreNumero: line.cierreNumero,
                    fechaCierre: line.fechaCierre,
                    sucursalId: line.sucursalId,
                    sucursalName: line.sucursalName,
                    caja: line.caja,
                    cajero: line.cajero,
                    moneda: line.moneda,
                    monto: line.monto,
                    montoNIO: line.montoNIO,
                    montoUSD: line.montoUSD,
                    cuentaOrigenId: line.cuentaOrigenId,
                    cuentaOrigenCode: line.cuentaOrigenCode,
                    cuentaOrigenName: line.cuentaOrigenName
                })),
                observaciones: formData.observaciones,
                userId: user?.uid,
                userEmail: user?.email
            });

            setSuccess(`Depósito #${result.numero} enviado a standby. Permanecerá pendiente hasta su confirmación bancaria.`);
            setSelectedKeys([]);
            setFormData(createInitialForm(user));
            setActiveTab('pendientes');
        } catch (submitError) {
            console.error('Error creando depósito en tránsito:', submitError);
            setError(submitError.message || 'No se pudo crear el depósito.');
        } finally {
            setSubmitting(false);
        }
    };

    const renderLineStatus = (line) => {
        if (line.estado === 'en_transito') {
            return (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    En depósito #{line.depositoNumero || '?'}
                </span>
            );
        }

        return (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Disponible
            </span>
        );
    };

    const renderNuevoDeposito = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-700">Montos Disponibles</p>
                    <p className="text-2xl font-bold text-blue-900">{stats.pendientes}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-700">En Standby</p>
                    <p className="text-2xl font-bold text-amber-900">{stats.reservados}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="text-sm text-green-700">Pendiente por Depositar</p>
                    <p className="text-2xl font-bold text-green-900">{formatCurrency(stats.totalPendiente, monedaSeleccionada)}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <p className="text-sm text-slate-600">Moneda</p>
                    <select
                        value={monedaSeleccionada}
                        onChange={(event) => setMonedaSeleccionada(event.target.value)}
                        className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                        <option value="NIO">Córdobas (NIO)</option>
                        <option value="USD">Dólares (USD)</option>
                    </select>
                </div>
            </div>

            <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
                    <Banknote className="w-5 h-5 text-blue-600" />
                    Montos pendientes por cierre
                </h3>

                <div className="space-y-3">
                    {lineasPendientes.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                            No hay montos pendientes en {monedaSeleccionada === 'USD' ? 'USD' : 'NIO'}.
                        </div>
                    ) : (
                        lineasPendientes.map((line) => {
                            const isSelected = selectedKeys.includes(line.uniqueKey);
                            const isDisabled = line.estado !== 'disponible';

                            return (
                                <button
                                    key={line.uniqueKey}
                                    type="button"
                                    onClick={() => toggleSelection(line)}
                                    disabled={isDisabled}
                                    className={`w-full text-left rounded-xl border p-4 transition-colors ${
                                        isSelected
                                            ? 'border-blue-500 bg-blue-50'
                                            : isDisabled
                                                ? 'border-amber-200 bg-amber-50'
                                                : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
                                    } ${isDisabled ? 'cursor-not-allowed' : ''}`}
                                >
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-slate-900">{line.cierreCodigo}</span>
                                                <span className="text-sm text-slate-500">Cierre {line.fechaCierre}</span>
                                                {renderLineStatus(line)}
                                            </div>
                                            <div className="mt-2 text-sm text-slate-600">
                                                {line.sucursalName || 'Sin sucursal'} · {line.caja || 'Caja'} · {line.cajero || 'Sin cajero'}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <p className="text-sm text-slate-500">Monto pendiente</p>
                                                <p className="text-xl font-bold text-slate-900">{formatCurrency(line.monto, line.moneda)}</p>
                                            </div>
                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                                isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                                            }`}>
                                                {isSelected && <CheckSquare className="w-4 h-4 text-white" />}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-600" />
                    Crear depósito en standby
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
                        <input
                            type="date"
                            value={formData.fecha}
                            onChange={(event) => setFormData((prev) => ({ ...prev, fecha: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Responsable</label>
                        <input
                            type="text"
                            value={formData.responsable}
                            onChange={(event) => setFormData((prev) => ({ ...prev, responsable: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            required
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Banco destino</label>
                        <select
                            value={formData.bancoDestinoId}
                            onChange={(event) => setFormData((prev) => ({ ...prev, bancoDestinoId: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            required
                        >
                            <option value="">Seleccione la cuenta bancaria...</option>
                            {bancosDisponibles.map((bank) => (
                                <option key={bank.id} value={bank.id}>
                                    {bank.code} - {bank.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Observaciones</label>
                    <textarea
                        value={formData.observaciones}
                        onChange={(event) => setFormData((prev) => ({ ...prev, observaciones: event.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        placeholder="Observaciones del depósito agrupado..."
                    />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-sm text-blue-700">Montos seleccionados</p>
                        <p className="text-lg font-bold text-blue-900">{selectedLines.length} cierre(s)</p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-blue-700">Total a depositar</p>
                        <p className="text-2xl font-bold text-blue-900">{formatCurrency(totalSeleccionado, monedaSeleccionada)}</p>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={submitting || selectedLines.length === 0}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ArrowRightLeft className="w-5 h-5" />}
                        {submitting ? 'Creando depósito...' : 'Enviar a Standby'}
                    </button>
                </div>
            </form>
        </div>
    );

    const renderDepositosList = (items, emptyMessage, tone = 'amber') => (
        <div className="space-y-4">
            {items.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    {emptyMessage}
                </div>
            ) : (
                items.map((deposito) => (
                    <div key={deposito.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-slate-900">Depósito #{deposito.numero}</span>
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                        tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                                    }`}>
                                        {tone === 'amber' ? 'Standby' : 'Confirmado'}
                                    </span>
                                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                                        {deposito.moneda}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-600 mt-2">
                                    {deposito.fecha} · {deposito.responsable || 'Sin responsable'}
                                </p>
                                <p className="text-sm text-slate-600">
                                    Banco destino: {deposito.bancoDestinoCode ? `${deposito.bancoDestinoCode} - ` : ''}{deposito.bancoDestinoName || 'Por definir'}
                                </p>
                            </div>

                            <div className="text-right">
                                <p className="text-sm text-slate-500">Total</p>
                                <p className="text-2xl font-bold text-slate-900">{formatCurrency(deposito.total, deposito.moneda)}</p>
                            </div>
                        </div>

                        <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
                            <p className="text-sm font-medium text-slate-700 mb-2">Cierres incluidos</p>
                            <div className="space-y-2">
                                {(deposito.cierresOrigen || []).map((item) => (
                                    <div key={`${deposito.id}_${item.cierreId}_${item.moneda}`} className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between text-sm text-slate-600">
                                        <span>{item.cierreCodigo} · {item.fechaCierre} · {item.caja || 'Caja'}</span>
                                        <span className="font-medium text-slate-900">{formatCurrency(item.monto, item.moneda)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <ArrowRightLeft className="w-8 h-8 text-blue-600" />
                    Depósitos en Tránsito
                </h1>
                <p className="text-slate-600 mt-1">
                    Agrupe montos pendientes de cierres de caja y envíelos a standby hasta la confirmación bancaria.
                </p>
            </div>

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

            <div className="flex gap-2 mb-6 border-b">
                <button
                    onClick={() => setActiveTab('nuevo')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'nuevo'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                    <Plus className="w-4 h-4 inline mr-1" />
                    Nuevo Depósito
                </button>
                <button
                    onClick={() => setActiveTab('pendientes')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'pendientes'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                    <Clock className="w-4 h-4 inline mr-1" />
                    Standby
                </button>
                <button
                    onClick={() => setActiveTab('historial')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'historial'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-slate-600 hover:text-slate-800'
                    }`}
                >
                    <CheckCircle className="w-4 h-4 inline mr-1" />
                    Confirmados
                </button>
            </div>

            {activeTab === 'nuevo' && renderNuevoDeposito()}
            {activeTab === 'pendientes' && renderDepositosList(depositosPendientes, 'No hay depósitos en standby.', 'amber')}
            {activeTab === 'historial' && renderDepositosList(depositosConfirmados, 'No hay depósitos confirmados.', 'green')}
        </div>
    );
};

export default DepositosTransito;
