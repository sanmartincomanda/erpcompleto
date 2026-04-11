// src/components/ChartOfAccounts.jsx - Plan de Cuentas Dinámico con Vista de Movimientos
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { 
    collection, 
    onSnapshot, 
    query, 
    orderBy, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc
} from 'firebase/firestore';
import { 
    Plus, 
    Search, 
    Edit2, 
    Trash2, 
    BookOpen, 
    AlertCircle,
    CheckCircle,
    X,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    ArrowLeft,
    FileText,
    TrendingUp,
    TrendingDown,
    Calculator,
    FolderTree,
    List,
    BarChart3,
    Calendar,
    Filter
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const normalizeTipoMovimiento = (movimiento) =>
    movimiento?.tipo || movimiento?.type || '';

const normalizeCode = (code) => String(code || '').replace(/\./g, '');

const normalizeSearchText = (value) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

const getMovimientoAccountId = (movimiento) =>
    movimiento?.accountId || movimiento?.cuentaId || movimiento?.cuenta?.id || null;

const getMovimientoAccountCode = (movimiento) =>
    movimiento?.accountCode || movimiento?.cuentaCode || movimiento?.cuenta?.code || '';

const getMovimientoTimestampValue = (movimiento) => {
    if (typeof movimiento?.timestamp?.toMillis === 'function') {
        return movimiento.timestamp.toMillis();
    }

    if (typeof movimiento?.timestamp?.seconds === 'number') {
        return movimiento.timestamp.seconds * 1000;
    }

    if (typeof movimiento?.createdAt?.toMillis === 'function') {
        return movimiento.createdAt.toMillis();
    }

    if (typeof movimiento?.createdAt?.seconds === 'number') {
        return movimiento.createdAt.seconds * 1000;
    }

    const parsedDate = new Date(movimiento?.fecha || '').getTime();
    return Number.isNaN(parsedDate) ? 0 : parsedDate;
};

const getNatureByType = (type) =>
    ['ACTIVO', 'COSTO', 'GASTO'].includes(type) ? 'DEUDORA' : 'ACREEDORA';

const getSucursalMovimiento = (movimiento) =>
    movimiento?.sucursalName || movimiento?.branchName || movimiento?.tienda || 'General';

const ChartOfAccounts = () => {
    // Estados principales
    const [accounts, setAccounts] = useState([]);
    const [allMovimientos, setAllMovimientos] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('tree'); // 'tree' | 'list'
    const [selectedAccount, setSelectedAccount] = useState(null);
    const [showMovementsModal, setShowMovementsModal] = useState(false);
    const [showAccountModal, setShowAccountModal] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [loadingMovimientos, setLoadingMovimientos] = useState(false);
    
    // Filtros de movimientos
    const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
    const [filtroFechaHasta, setFiltroFechaHasta] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('todos');

    const [formData, setFormData] = useState({
        code: '',
        name: '',
        type: 'ACTIVO',
        subType: '',
        parentId: '',
        isGroup: false,
        currency: 'NIO',
        balance: 0,
        balanceUSD: 0,
        isActive: true,
        description: ''
    });

    const accountTypes = [
        { id: 'ACTIVO', name: 'Activos', nature: 'Deudora', color: 'bg-blue-100 text-blue-800', icon: TrendingUp },
        { id: 'PASIVO', name: 'Pasivos', nature: 'Acreedora', color: 'bg-red-100 text-red-800', icon: TrendingDown },
        { id: 'CAPITAL', name: 'Capital', nature: 'Acreedora', color: 'bg-green-100 text-green-800', icon: Calculator },
        { id: 'INGRESO', name: 'Ingresos', nature: 'Acreedora', color: 'bg-purple-100 text-purple-800', icon: TrendingUp },
        { id: 'COSTO', name: 'Costos', nature: 'Deudora', color: 'bg-orange-100 text-orange-800', icon: TrendingDown },
        { id: 'GASTO', name: 'Gastos', nature: 'Deudora', color: 'bg-yellow-100 text-yellow-800', icon: TrendingDown }
    ];

    const subTypes = [
        { id: '', name: 'Ninguno' },
        { id: 'caja', name: 'Caja' },
        { id: 'banco', name: 'Banco' },
        { id: 'transito', name: 'Dinero en Tránsito' },
        { id: 'clientes', name: 'Cuentas por Cobrar' },
        { id: 'proveedores', name: 'Cuentas por Pagar' },
        { id: 'inventario', name: 'Inventario' },
        { id: 'activo_fijo', name: 'Activo Fijo' },
        { id: 'patrimonio', name: 'Patrimonio' }
    ];

    // Cargar plan de cuentas
    useEffect(() => {
        const accountsRef = collection(db, 'planCuentas');
        const q = query(accountsRef, orderBy('code'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAccounts(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando plan de cuentas:', err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const movimientosRef = collection(db, 'movimientosContables');

        const unsubscribe = onSnapshot(movimientosRef, (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => {
                const raw = docSnapshot.data();
                const tipo = normalizeTipoMovimiento(raw);

                return {
                    id: docSnapshot.id,
                    ...raw,
                    tipo,
                    type: raw.type || tipo
                };
            });

            setAllMovimientos(data);
        });

        return () => unsubscribe();
    }, []);

    // Cargar movimientos cuando se selecciona una cuenta
    const cargarMovimientosCuenta = (account) => {
        setLoadingMovimientos(true);

        try {
            const accountIds = new Set();
            const accountCodes = new Set();

            const collectAccountHierarchy = (currentAccount) => {
                if (!currentAccount?.id) return;

                accountIds.add(currentAccount.id);

                const currentCode = normalizeCode(currentAccount.code);
                if (currentCode) {
                    accountCodes.add(currentCode);
                }

                accounts
                    .filter((item) => item.parentId === currentAccount.id)
                    .forEach((child) => collectAccountHierarchy(child));
            };

            collectAccountHierarchy(account);

            const unique = allMovimientos
                .filter((movimiento) => {
                    const movimientoAccountId = getMovimientoAccountId(movimiento);
                    const movimientoAccountCode = normalizeCode(getMovimientoAccountCode(movimiento));

                    return (
                        (movimientoAccountId && accountIds.has(movimientoAccountId)) ||
                        (movimientoAccountCode && accountCodes.has(movimientoAccountCode))
                    );
                })
                .filter((mov, index, self) =>
                    index === self.findIndex((item) => item.id === mov.id)
                )
                .sort((a, b) => getMovimientoTimestampValue(b) - getMovimientoTimestampValue(a));

            setMovimientos(unique);
        } catch (err) {
            console.error('Error cargando movimientos:', err);
            setMovimientos([]);
        } finally {
            setLoadingMovimientos(false);
        }
    };

    useEffect(() => {
        if (!showMovementsModal || !selectedAccount) return;
        cargarMovimientosCuenta(selectedAccount);
    }, [allMovimientos, selectedAccount, showMovementsModal]);

    // Filtrar movimientos
    const movimientosFiltrados = useMemo(() => {
        return movimientos.filter(mov => {
            const tipoMovimiento = normalizeTipoMovimiento(mov);
            const matchesTipo = filtroTipo === 'todos' || tipoMovimiento === filtroTipo;
            const matchesFechaDesde = !filtroFechaDesde || (mov.fecha >= filtroFechaDesde);
            const matchesFechaHasta = !filtroFechaHasta || (mov.fecha <= filtroFechaHasta);
            return matchesTipo && matchesFechaDesde && matchesFechaHasta;
        });
    }, [movimientos, filtroTipo, filtroFechaDesde, filtroFechaHasta]);

    // Calcular totales de movimientos
    const totalesMovimientos = useMemo(() => {
        const debitos = movimientosFiltrados
            .filter(m => normalizeTipoMovimiento(m) === 'DEBITO')
            .reduce((sum, m) => sum + Number(m.monto || 0), 0);
        const creditos = movimientosFiltrados
            .filter(m => normalizeTipoMovimiento(m) === 'CREDITO')
            .reduce((sum, m) => sum + Number(m.monto || 0), 0);
        return { debitos, creditos, saldo: debitos - creditos };
    }, [movimientosFiltrados]);

    const liveBalancesByAccountId = useMemo(() => {
        const accountsById = new Map();
        const accountsByCode = new Map();
        const balances = {};

        accounts.forEach((account) => {
            accountsById.set(account.id, account);
            const normalizedCode = normalizeCode(account.code);
            if (normalizedCode) {
                accountsByCode.set(normalizedCode, account);
            }
            if (!account.isGroup) {
                balances[account.id] = {
                    balance: 0,
                    balanceUSD: 0
                };
            }
        });

        allMovimientos.forEach((movimiento) => {
            const tipoMovimiento = normalizeTipoMovimiento(movimiento);
            if (!['DEBITO', 'CREDITO'].includes(tipoMovimiento)) return;

            const movimientoAccountId = getMovimientoAccountId(movimiento);
            const movimientoAccountCode = normalizeCode(getMovimientoAccountCode(movimiento));
            const account =
                (movimientoAccountId && accountsById.get(movimientoAccountId)) ||
                (movimientoAccountCode && accountsByCode.get(movimientoAccountCode));

            if (!account || account.isGroup) return;

            const nature = account.nature || getNatureByType(account.type);
            const isDeudora = nature === 'DEUDORA';
            const multiplier =
                (tipoMovimiento === 'DEBITO' && isDeudora) ||
                (tipoMovimiento === 'CREDITO' && !isDeudora)
                    ? 1
                    : -1;

            if (!balances[account.id]) {
                balances[account.id] = { balance: 0, balanceUSD: 0 };
            }

            balances[account.id].balance += Number(movimiento.monto || 0) * multiplier;
            balances[account.id].balanceUSD += Number(movimiento.montoUSD || 0) * multiplier;
        });

        return balances;
    }, [accounts, allMovimientos]);

    const getDisplayedAccountBalance = (account) => {
        if (!account || account.isGroup) return Number(account?.balance || 0);
        return Number(liveBalancesByAccountId[account.id]?.balance ?? account.balance ?? 0);
    };

    // Estructurar cuentas en árbol
    const accountTree = useMemo(() => {
        const map = {};
        const roots = [];
        
        accounts.forEach(acc => {
            map[acc.id] = { ...acc, children: [] };
        });
        
        accounts.forEach(acc => {
            if (acc.parentId && map[acc.parentId]) {
                map[acc.parentId].children.push(map[acc.id]);
            } else {
                roots.push(map[acc.id]);
            }
        });
        
        return roots;
    }, [accounts]);

    // Filtrar cuentas para vista de lista
    const normalizedSearchTerm = useMemo(() => normalizeSearchText(searchTerm), [searchTerm]);

    const accountMatchesSearch = (account) => {
        if (!normalizedSearchTerm) return true;

        const normalizedName = normalizeSearchText(account?.name);
        const normalizedDescription = normalizeSearchText(account?.description);
        const normalizedCodeValue = normalizeCode(account?.code);
        const normalizedSearchCode = normalizeCode(normalizedSearchTerm);

        return (
            normalizedName.includes(normalizedSearchTerm) ||
            normalizedDescription.includes(normalizedSearchTerm) ||
            normalizedCodeValue.includes(normalizedSearchCode)
        );
    };

    const filteredAccounts = useMemo(() => {
        if (!normalizedSearchTerm) return accounts;
        return accounts.filter(accountMatchesSearch);
    }, [accounts, normalizedSearchTerm]);

    // Agrupar cuentas por tipo
    const accountsByType = useMemo(() => {
        const grouped = {};
        accountTypes.forEach(type => {
            grouped[type.id] = accounts.filter(a => a.type === type.id);
        });
        return grouped;
    }, [accounts]);

    const filterAccountTree = (nodes) =>
        nodes.reduce((accumulator, node) => {
            const filteredChildren = filterAccountTree(node.children || []);
            const matchesNode = accountMatchesSearch(node);

            if (!normalizedSearchTerm || matchesNode || filteredChildren.length > 0) {
                accumulator.push({
                    ...node,
                    children: filteredChildren
                });
            }

            return accumulator;
        }, []);

    const filteredAccountTree = useMemo(() => {
        if (!normalizedSearchTerm) return accountTree;
        return filterAccountTree(accountTree);
    }, [accountTree, normalizedSearchTerm]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                nature: getNatureByType(formData.type),
                updatedAt: new Date()
            };

            if (editingAccount) {
                await updateDoc(doc(db, 'planCuentas', editingAccount.id), {
                    ...payload
                });
            } else {
                await addDoc(collection(db, 'planCuentas'), {
                    ...payload,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            }
            setShowAccountModal(false);
            setEditingAccount(null);
            resetForm();
        } catch (err) {
            console.error('Error guardando cuenta:', err);
            alert('Error al guardar la cuenta');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Está seguro de eliminar esta cuenta?')) {
            try {
                await deleteDoc(doc(db, 'planCuentas', id));
            } catch (err) {
                console.error('Error eliminando cuenta:', err);
                alert('Error al eliminar la cuenta');
            }
        }
    };

    const handleEdit = (account) => {
        setEditingAccount(account);
        setFormData({
            code: account.code || '',
            name: account.name || '',
            type: account.type || 'ACTIVO',
            subType: account.subType || '',
            parentId: account.parentId || '',
            isGroup: account.isGroup || false,
            currency: account.currency || 'NIO',
            balance: account.balance || 0,
            balanceUSD: account.balanceUSD || 0,
            isActive: account.isActive !== false,
            description: account.description || ''
        });
        setShowAccountModal(true);
    };

    const handleViewMovements = (account) => {
        setSelectedAccount(account);
        setShowMovementsModal(true);
        setFiltroFechaDesde('');
        setFiltroFechaHasta('');
        setFiltroTipo('todos');
        cargarMovimientosCuenta(account);
    };

    const resetForm = () => {
        setFormData({
            code: '',
            name: '',
            type: 'ACTIVO',
            subType: '',
            parentId: '',
            isGroup: false,
            currency: 'NIO',
            balance: 0,
            balanceUSD: 0,
            isActive: true,
            description: ''
        });
    };

    const toggleGroup = (accountId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [accountId]: !prev[accountId]
        }));
    };

    const getTypeInfo = (type) => accountTypes.find(t => t.id === type) || accountTypes[0];

    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    // Renderizar árbol de cuentas recursivamente
    const renderAccountTree = (nodes, level = 0) => {
        return nodes.map(account => (
            <div key={account.id} className="">
                {(() => {
                    const shouldExpand = normalizedSearchTerm ? true : expandedGroups[account.id];

                    return (
                <div 
                    className={`group flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-l-2 ${
                        selectedAccount?.id === account.id 
                            ? 'bg-blue-50 border-blue-500' 
                            : 'border-transparent'
                    }`}
                    style={{ paddingLeft: `${12 + level * 24}px` }}
                >
                    {account.isGroup ? (
                        <button
                            onClick={() => toggleGroup(account.id)}
                        className="p-0.5 hover:bg-slate-200 rounded"
                    >
                            {shouldExpand ? 
                                <ChevronDown className="w-4 h-4 text-slate-500" /> : 
                                <ChevronRight className="w-4 h-4 text-slate-500" />
                            }
                        </button>
                    ) : (
                        <span className="w-5" />
                    )}
                    
                    <span className="font-mono text-sm text-slate-600 w-28">{account.code}</span>
                    
                    <span className={`flex-1 text-sm ${account.isGroup ? 'font-semibold' : ''}`}>
                        {account.name}
                    </span>
                    
                    <span className={`px-2 py-0.5 rounded-full text-xs ${getTypeInfo(account.type).color}`}>
                        {account.type}
                    </span>
                    
                    {!account.isGroup && (
                        <span className="text-sm font-mono text-right w-32">
                            {formatCurrency(getDisplayedAccountBalance(account), account.currency)}
                        </span>
                    )}
                    
                    <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => handleViewMovements(account)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                            title="Ver movimientos"
                        >
                            <Eye className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => handleEdit(account)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                            title="Editar"
                        >
                            <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => handleDelete(account.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            title="Eliminar"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                    );
                })()}
                
                {account.isGroup && (normalizedSearchTerm ? true : expandedGroups[account.id]) && account.children?.length > 0 && (
                    <div className="">
                        {renderAccountTree(account.children, level + 1)}
                    </div>
                )}
            </div>
        ));
    };

    // Renderizar tarjetas de resumen por tipo
    const renderSummaryCards = () => (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {accountTypes.map(type => {
                const cuentas = accountsByType[type.id] || [];
                const total = cuentas.reduce((sum, a) => sum + (a.balance || 0), 0);
                const Icon = type.icon;
                
                return (
                    <div key={type.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 mb-2">
                            <div className={`p-2 rounded-lg ${type.color}`}>
                                <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-medium text-slate-500">{type.name}</span>
                        </div>
                        <p className="text-lg font-bold text-slate-800">{cuentas.length}</p>
                        <p className="text-xs text-slate-500">cuentas</p>
                    </div>
                );
            })}
        </div>
    );

    if (loading && accounts.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <BookOpen className="w-8 h-8 text-blue-600" />
                        Plan de Cuentas
                    </h1>
                    <p className="text-slate-600 mt-1">
                        Gestione el catálogo de cuentas contables y consulte movimientos
                    </p>
                </div>
                <div className="flex gap-2 mt-4 md:mt-0">
                    <div className="flex bg-slate-100 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('tree')}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${
                                viewMode === 'tree' 
                                    ? 'bg-white text-slate-900 shadow-sm' 
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <FolderTree className="w-4 h-4" />
                            Árbol
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${
                                viewMode === 'list' 
                                    ? 'bg-white text-slate-900 shadow-sm' 
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <List className="w-4 h-4" />
                            Lista
                        </button>
                    </div>
                    <button
                        onClick={() => { setEditingAccount(null); resetForm(); setShowAccountModal(true); }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Nueva Cuenta
                    </button>
                </div>
            </div>

            {/* Tarjetas de resumen */}
            {renderSummaryCards()}

            {/* Barra de búsqueda y filtros */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
                <div className="flex flex-wrap gap-4">
                    <div className="flex-1 min-w-[300px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar por código o nombre de cuenta..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <BarChart3 className="w-4 h-4" />
                        <span>{accounts.length} cuentas registradas</span>
                    </div>
                </div>
            </div>

            {/* Contenido principal */}
            {viewMode === 'tree' ? (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-4">
                        <span className="text-sm font-medium text-slate-700 w-28">Código</span>
                        <span className="flex-1 text-sm font-medium text-slate-700">Nombre</span>
                        <span className="text-sm font-medium text-slate-700 w-24">Tipo</span>
                        <span className="text-sm font-medium text-slate-700 w-32 text-right">Saldo</span>
                        <span className="w-24"></span>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {filteredAccountTree.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                <BookOpen className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                <p>{searchTerm ? 'No se encontraron cuentas' : 'No hay cuentas registradas'}</p>
                            </div>
                        ) : (
                            renderAccountTree(filteredAccountTree)
                        )}
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Código</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Nombre</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Tipo</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Subtipo</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Saldo C$</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Estado</th>
                                <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredAccounts.map((account) => (
                                <tr key={account.id} className="hover:bg-slate-50 group">
                                    <td className="px-4 py-3 font-mono text-sm text-slate-600">{account.code}</td>
                                    <td className="px-4 py-3">
                                        <span className={account.isGroup ? 'font-semibold' : ''}>
                                            {account.name}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTypeInfo(account.type).color}`}>
                                            {account.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600">
                                        {account.subType || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">
                                        {formatCurrency(getDisplayedAccountBalance(account), account.currency)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {account.isActive !== false ? (
                                            <span className="text-green-600 flex items-center justify-center gap-1 text-sm">
                                                <CheckCircle className="w-4 h-4" /> Activa
                                            </span>
                                        ) : (
                                            <span className="text-slate-400 flex items-center justify-center gap-1 text-sm">
                                                <X className="w-4 h-4" /> Inactiva
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => handleViewMovements(account)}
                                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                title="Ver movimientos"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEdit(account)}
                                                className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(account.id)}
                                                className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    
                    {filteredAccounts.length === 0 && (
                        <div className="p-8 text-center text-slate-500">
                            <BookOpen className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                            <p>No se encontraron cuentas</p>
                        </div>
                    )}
                </div>
            )}

            {/* Modal de Cuenta (Crear/Editar) */}
            {showAccountModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900">
                                {editingAccount ? 'Editar Cuenta' : 'Nueva Cuenta'}
                            </h2>
                            <button
                                onClick={() => setShowAccountModal(false)}
                                className="p-2 hover:bg-slate-100 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Código *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.code}
                                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                        placeholder="1.01.01.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Nombre *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Nombre de la cuenta"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Descripción
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Descripción opcional de la cuenta"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Tipo *
                                    </label>
                                    <select
                                        value={formData.type}
                                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        required
                                    >
                                        {accountTypes.map(type => (
                                            <option key={type.id} value={type.id}>
                                                {type.name} ({type.nature})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Subtipo
                                    </label>
                                    <select
                                        value={formData.subType}
                                        onChange={(e) => setFormData({ ...formData, subType: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        {subTypes.map(sub => (
                                            <option key={sub.id} value={sub.id}>
                                                {sub.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Moneda
                                    </label>
                                    <select
                                        value={formData.currency}
                                        onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="NIO">Córdobas (NIO)</option>
                                        <option value="USD">Dólares (USD)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Cuenta Padre
                                    </label>
                                    <select
                                        value={formData.parentId}
                                        onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Ninguna (Cuenta raíz)</option>
                                        {accounts.filter(a => a.isGroup).map(acc => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.code} - {acc.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 pt-2">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={formData.isGroup}
                                        onChange={(e) => setFormData({ ...formData, isGroup: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded"
                                    />
                                    <span className="text-sm text-slate-700">Es grupo (contiene subcuentas)</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={formData.isActive}
                                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded"
                                    />
                                    <span className="text-sm text-slate-700">Cuenta activa</span>
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button
                                    type="button"
                                    onClick={() => setShowAccountModal(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    {editingAccount ? 'Guardar Cambios' : 'Crear Cuenta'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Movimientos de Cuenta */}
            {showMovementsModal && selectedAccount && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                    <FileText className="w-6 h-6 text-blue-600" />
                                    Movimientos de Cuenta
                                </h2>
                                <p className="text-slate-600 mt-1">
                                    <span className="font-mono">{selectedAccount.code}</span> - {selectedAccount.name}
                                </p>
                            </div>
                            <button
                                onClick={() => setShowMovementsModal(false)}
                                className="p-2 hover:bg-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            {/* Filtros de movimientos */}
                            <div className="bg-slate-50 rounded-lg p-4 mb-6">
                                <div className="flex flex-wrap gap-4 items-end">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            <Calendar className="w-4 h-4 inline mr-1" />
                                            Desde
                                        </label>
                                        <input
                                            type="date"
                                            value={filtroFechaDesde}
                                            onChange={(e) => setFiltroFechaDesde(e.target.value)}
                                            className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            <Calendar className="w-4 h-4 inline mr-1" />
                                            Hasta
                                        </label>
                                        <input
                                            type="date"
                                            value={filtroFechaHasta}
                                            onChange={(e) => setFiltroFechaHasta(e.target.value)}
                                            className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            <Filter className="w-4 h-4 inline mr-1" />
                                            Tipo
                                        </label>
                                        <select
                                            value={filtroTipo}
                                            onChange={(e) => setFiltroTipo(e.target.value)}
                                            className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="todos">Todos</option>
                                            <option value="DEBITO">Débitos</option>
                                            <option value="CREDITO">Créditos</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setFiltroFechaDesde('');
                                            setFiltroFechaHasta('');
                                            setFiltroTipo('todos');
                                        }}
                                        className="px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg"
                                    >
                                        Limpiar filtros
                                    </button>
                                </div>
                            </div>

                            {/* Tarjetas de totales */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                                    <p className="text-sm text-green-700 mb-1">Total Débitos</p>
                                    <p className="text-2xl font-bold text-green-800">
                                        {formatCurrency(totalesMovimientos.debitos)}
                                    </p>
                                </div>
                                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                                    <p className="text-sm text-red-700 mb-1">Total Créditos</p>
                                    <p className="text-2xl font-bold text-red-800">
                                        {formatCurrency(totalesMovimientos.creditos)}
                                    </p>
                                </div>
                                <div className={`rounded-lg p-4 border ${
                                    totalesMovimientos.saldo >= 0 
                                        ? 'bg-blue-50 border-blue-200' 
                                        : 'bg-orange-50 border-orange-200'
                                }`}>
                                    <p className={`text-sm mb-1 ${
                                        totalesMovimientos.saldo >= 0 ? 'text-blue-700' : 'text-orange-700'
                                    }`}>Saldo</p>
                                    <p className={`text-2xl font-bold ${
                                        totalesMovimientos.saldo >= 0 ? 'text-blue-800' : 'text-orange-800'
                                    }`}>
                                        {formatCurrency(Math.abs(totalesMovimientos.saldo))}
                                        {totalesMovimientos.saldo < 0 && ' (Crédito)'}
                                    </p>
                                </div>
                            </div>

                            {/* Tabla de movimientos */}
                            {loadingMovimientos ? (
                                <div className="flex items-center justify-center py-12">
                                    <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                                </div>
                            ) : movimientosFiltrados.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">
                                    <FileText className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                                    <p className="text-lg">No se encontraron movimientos</p>
                                    <p className="text-sm">Esta cuenta no tiene movimientos registrados</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Fecha</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Descripción</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Referencia</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Sucursal</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Origen</th>
                                                <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Débito</th>
                                                <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Crédito</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {movimientosFiltrados.map((mov) => (
                                                <tr key={mov.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-sm">{mov.fecha}</td>
                                                    <td className="px-4 py-3 text-sm">{mov.descripcion}</td>
                                                    <td className="px-4 py-3 text-sm font-mono">{mov.referencia}</td>
                                                    <td className="px-4 py-3 text-sm">{getSucursalMovimiento(mov)}</td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <span className="px-2 py-1 bg-slate-100 rounded text-xs">
                                                            {mov.moduloOrigen || 'Sistema'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {normalizeTipoMovimiento(mov) === 'DEBITO' ? (
                                                            <span className="text-red-600 font-medium">
                                                                {formatCurrency(mov.monto)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {normalizeTipoMovimiento(mov) === 'CREDITO' ? (
                                                            <span className="text-green-600 font-medium">
                                                                {formatCurrency(mov.monto)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-300">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChartOfAccounts;
