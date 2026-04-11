import React, { useEffect, useMemo, useState } from 'react';
import {
    addDoc,
    collection,
    doc,
    onSnapshot,
    setDoc,
    Timestamp,
    updateDoc
} from 'firebase/firestore';
import {
    ArrowRightLeft,
    CheckCircle2,
    CheckSquare,
    Clock3,
    FileSpreadsheet,
    History,
    Landmark,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Square,
    Upload,
    X
} from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import {
    DOCUMENT_TYPES,
    registerAccountingEntry
} from '../services/unifiedAccountingService';
import {
    guessColumnMapping,
    mapCsvRowsToTransactions,
    parseCsvText
} from '../utils/bankReconciliationCsv';

const normalizeNumber = (value) => Number(value || 0);
const normalizeCode = (value) => String(value || '').replace(/\./g, '').trim();

const formatDateInput = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
};

const getMonthStart = () => {
    const date = new Date();
    date.setDate(1);
    return formatDateInput(date);
};

const formatCurrency = (amount, currency = 'NIO') =>
    new Intl.NumberFormat('es-NI', {
        style: 'currency',
        currency: currency === 'USD' ? 'USD' : 'NIO',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(amount || 0));

const formatSignedAmount = (amount, currency = 'NIO') => {
    const numericAmount = Number(amount || 0);
    const prefix = numericAmount > 0 ? '+' : numericAmount < 0 ? '-' : '';
    return `${prefix}${formatCurrency(Math.abs(numericAmount), currency)}`;
};

const getDateKey = (value) => {
    if (!value) return '';
    if (typeof value?.toDate === 'function') {
        return formatDateInput(value.toDate());
    }
    if (typeof value?.seconds === 'number') {
        return formatDateInput(new Date(value.seconds * 1000));
    }
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    return formatDateInput(value);
};

const getMovimientoAccountId = (movimiento) =>
    movimiento?.accountId || movimiento?.cuentaId || '';

const getMovimientoAccountCode = (movimiento) =>
    normalizeCode(movimiento?.accountCode || movimiento?.cuentaCode);

const getMovimientoTipo = (movimiento) =>
    String(movimiento?.tipo || movimiento?.type || '').toUpperCase();

const getMovimientoMonto = (movimiento, currency = 'NIO') => {
    if (currency === 'USD') {
        return normalizeNumber(
            movimiento?.montoUSD || movimiento?.amountUSD || movimiento?.monto
        );
    }

    return normalizeNumber(movimiento?.monto);
};

const getMovimientoSignedAmount = (movimiento, account = null) => {
    const tipo = getMovimientoTipo(movimiento);
    const currency = account?.currency || 'NIO';
    const monto = getMovimientoMonto(movimiento, currency);
    const accountType = String(account?.type || 'ACTIVO').toUpperCase();
    const isActivo = accountType !== 'PASIVO';

    if (isActivo) {
        return tipo === 'DEBITO' ? monto : -monto;
    }

    return tipo === 'CREDITO' ? monto : -monto;
};

const createEmptyCsvState = () => ({
    open: false,
    fileName: '',
    rows: [],
    headers: [],
    mapping: {
        date: '',
        description: '',
        reference: '',
        debit: '',
        credit: '',
        amount: ''
    },
    error: '',
    loading: false
});

const createMatchId = () =>
    `match-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const sortByUpdatedAt = (items = []) =>
    [...items].sort((left, right) => {
        const leftValue = left?.updatedAt?.seconds || left?.createdAt?.seconds || 0;
        const rightValue = right?.updatedAt?.seconds || right?.createdAt?.seconds || 0;
        return rightValue - leftValue;
    });

const isTransferAccount = (account = {}) => {
    const subType = String(account.subType || '').toLowerCase();
    const code = normalizeCode(account.code);

    return (
        ['caja', 'banco', 'transito', 'clientes', 'proveedores'].includes(subType) ||
        code.startsWith('1101') ||
        code.startsWith('1103') ||
        code.startsWith('2101')
    );
};

const createRegisterForm = (transaction = null, currency = 'NIO') => ({
    bankTransactionId: transaction?.id || '',
    category: normalizeNumber(transaction?.signedAmount) < 0 ? 'gasto' : 'ingreso',
    fecha: transaction?.fecha || formatDateInput(),
    descripcion: transaction?.descripcion || '',
    referencia: transaction?.referencia || '',
    counterpartAccountId: '',
    notas: '',
    tipoCambio: currency === 'USD' ? '36.50' : '1'
});

const ConciliacionBancaria = () => {
    const { user } = useAuth();
    const { accounts, getBancoAccounts, loading: loadingAccounts } = usePlanCuentas();

    const [reconciliaciones, setReconciliaciones] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    const [loadingReconciliaciones, setLoadingReconciliaciones] = useState(true);
    const [loadingMovimientos, setLoadingMovimientos] = useState(true);

    const [activeReconciliation, setActiveReconciliation] = useState(null);
    const [selectedBankIds, setSelectedBankIds] = useState([]);
    const [selectedMovimientoIds, setSelectedMovimientoIds] = useState([]);
    const [csvState, setCsvState] = useState(createEmptyCsvState());
    const [searchBank, setSearchBank] = useState('');
    const [searchErp, setSearchErp] = useState('');
    const [showMatched, setShowMatched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [registeringEntry, setRegisteringEntry] = useState(false);
    const [registerForm, setRegisterForm] = useState(createRegisterForm());

    const bankAccounts = useMemo(() => {
        const accounts = [...getBancoAccounts('NIO'), ...getBancoAccounts('USD')];
        return accounts.filter(
            (account, index, list) =>
                index === list.findIndex((candidate) => candidate.id === account.id)
        );
    }, [getBancoAccounts]);

    const getLastFinishedForAccount = (accountId) =>
        sortByUpdatedAt(
            reconciliaciones.filter(
                (item) =>
                    item.accountId === accountId &&
                    ['completada', 'cerrada'].includes(item.estado)
            )
        )[0] || null;

    const hydrateReconciliation = (item, account = null) => ({
        id: item?.id || null,
        accountId: item?.accountId || account?.id || '',
        accountCode: item?.accountCode || account?.code || '',
        accountName: item?.accountName || account?.name || '',
        currency: item?.currency || account?.currency || 'NIO',
        fechaInicio: item?.fechaInicio || getMonthStart(),
        fechaFin: item?.fechaFin || formatDateInput(),
        fechaCorte: item?.fechaCorte || item?.fechaFin || formatDateInput(),
        saldoInicial: normalizeNumber(item?.saldoInicial),
        saldoFinal: normalizeNumber(item?.saldoFinal),
        csvFileName: item?.csvFileName || '',
        notes: item?.notes || '',
        estado: item?.estado || 'borrador',
        bankTransactions: Array.isArray(item?.bankTransactions) ? item.bankTransactions : [],
        matchGroups: Array.isArray(item?.matchGroups) ? item.matchGroups : [],
        createdAt: item?.createdAt || null,
        updatedAt: item?.updatedAt || null
    });

    const buildBlankReconciliation = (account) => {
        const lastCompleted = getLastFinishedForAccount(account.id);

        return hydrateReconciliation(
            {
                saldoInicial: normalizeNumber(lastCompleted?.saldoFinal),
                fechaInicio: getMonthStart(),
                fechaFin: formatDateInput(),
                fechaCorte: formatDateInput(),
                estado: 'borrador',
                bankTransactions: [],
                matchGroups: []
            },
            account
        );
    };

    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'conciliacionesBancarias'),
            (snapshot) => {
                const data = snapshot.docs.map((item) => ({
                    id: item.id,
                    ...item.data()
                }));
                setReconciliaciones(sortByUpdatedAt(data));
                setLoadingReconciliaciones(false);
            },
            (snapshotError) => {
                console.error('Error cargando conciliaciones bancarias:', snapshotError);
                setError(
                    snapshotError.message ||
                        'No se pudieron cargar las conciliaciones bancarias.'
                );
                setLoadingReconciliaciones(false);
            }
        );

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'movimientosContables'),
            (snapshot) => {
                const data = snapshot.docs.map((item) => ({
                    id: item.id,
                    ...item.data()
                }));
                setMovimientos(data);
                setLoadingMovimientos(false);
            },
            (snapshotError) => {
                console.error('Error cargando movimientos contables:', snapshotError);
                setError(
                    snapshotError.message ||
                        'No se pudieron cargar los movimientos bancarios del ERP.'
                );
                setLoadingMovimientos(false);
            }
        );

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (activeReconciliation || loadingAccounts || !bankAccounts.length) return;

        const firstAccount = bankAccounts[0];
        const existingDraft =
            sortByUpdatedAt(
                reconciliaciones.filter(
                    (item) =>
                        item.accountId === firstAccount.id && item.estado === 'borrador'
                )
            )[0] || null;

        setActiveReconciliation(
            existingDraft
                ? hydrateReconciliation(existingDraft, firstAccount)
                : buildBlankReconciliation(firstAccount)
        );
    }, [activeReconciliation, bankAccounts, loadingAccounts, reconciliaciones]);

    const selectedAccount = useMemo(
        () =>
            bankAccounts.find((account) => account.id === activeReconciliation?.accountId) ||
            null,
        [activeReconciliation?.accountId, bankAccounts]
    );

    const activeMatchGroups = activeReconciliation?.matchGroups || [];
    const activeBankTransactions = activeReconciliation?.bankTransactions || [];

    const matchedBankIds = useMemo(
        () =>
            new Set(
                activeMatchGroups.flatMap((group) => group.bankTransactionIds || [])
            ),
        [activeMatchGroups]
    );

    const matchedMovimientoIds = useMemo(
        () =>
            new Set(activeMatchGroups.flatMap((group) => group.movimientoIds || [])),
        [activeMatchGroups]
    );

    const erpMovementsForAccount = useMemo(() => {
        if (!selectedAccount || !activeReconciliation) return [];

        return movimientos
            .filter((movimiento) => {
                const movementDate = getDateKey(movimiento.fecha || movimiento.timestamp);
                if (
                    activeReconciliation.fechaInicio &&
                    movementDate < activeReconciliation.fechaInicio
                ) {
                    return false;
                }
                if (
                    activeReconciliation.fechaFin &&
                    movementDate > activeReconciliation.fechaFin
                ) {
                    return false;
                }

                const sameAccountId =
                    getMovimientoAccountId(movimiento) === selectedAccount.id;
                const sameAccountCode =
                    getMovimientoAccountCode(movimiento) ===
                    normalizeCode(selectedAccount.code);

                return sameAccountId || sameAccountCode;
            })
            .map((movimiento) => ({
                ...movimiento,
                movementDate: getDateKey(movimiento.fecha || movimiento.timestamp),
                signedAmount: getMovimientoSignedAmount(movimiento, selectedAccount)
            }))
            .sort((left, right) =>
                String(right.movementDate || '').localeCompare(
                    String(left.movementDate || '')
                )
            );
    }, [activeReconciliation, movimientos, selectedAccount]);

    const filteredBankTransactions = useMemo(() => {
        const queryText = searchBank.trim().toLowerCase();

        return activeBankTransactions.filter((transaction) => {
            const isMatched = matchedBankIds.has(transaction.id);
            if (!showMatched && isMatched) return false;
            if (!queryText) return true;

            return [transaction.descripcion, transaction.referencia, transaction.fecha]
                .join(' ')
                .toLowerCase()
                .includes(queryText);
        });
    }, [activeBankTransactions, matchedBankIds, searchBank, showMatched]);

    const filteredErpMovements = useMemo(() => {
        const queryText = searchErp.trim().toLowerCase();

        return erpMovementsForAccount.filter((movimiento) => {
            const isMatched = matchedMovimientoIds.has(movimiento.id);
            if (!showMatched && isMatched) return false;
            if (!queryText) return true;

            return [
                movimiento.descripcion,
                movimiento.referencia,
                movimiento.moduloOrigen,
                movimiento.sucursalName
            ]
                .join(' ')
                .toLowerCase()
                .includes(queryText);
        });
    }, [erpMovementsForAccount, matchedMovimientoIds, searchErp, showMatched]);

    const selectedBankTransactions = useMemo(
        () =>
            activeBankTransactions.filter((transaction) =>
                selectedBankIds.includes(transaction.id)
            ),
        [activeBankTransactions, selectedBankIds]
    );

    const selectedBankTransactionForRegistration = useMemo(
        () =>
            activeBankTransactions.find(
                (transaction) => transaction.id === registerForm.bankTransactionId
            ) || null,
        [activeBankTransactions, registerForm.bankTransactionId]
    );

    const selectedErpMovements = useMemo(
        () =>
            erpMovementsForAccount.filter((movimiento) =>
                selectedMovimientoIds.includes(movimiento.id)
            ),
        [erpMovementsForAccount, selectedMovimientoIds]
    );

    const selectionBankTotal = useMemo(
        () =>
            selectedBankTransactions.reduce(
                (sum, transaction) => sum + normalizeNumber(transaction.signedAmount),
                0
            ),
        [selectedBankTransactions]
    );

    const selectionErpTotal = useMemo(
        () =>
            selectedErpMovements.reduce(
                (sum, movimiento) => sum + normalizeNumber(movimiento.signedAmount),
                0
            ),
        [selectedErpMovements]
    );

    const expectedNetChange =
        normalizeNumber(activeReconciliation?.saldoFinal) -
        normalizeNumber(activeReconciliation?.saldoInicial);

    const importedNetChange = activeBankTransactions.reduce(
        (sum, transaction) => sum + normalizeNumber(transaction.signedAmount),
        0
    );

    const matchedErpNetChange = erpMovementsForAccount
        .filter((movimiento) => matchedMovimientoIds.has(movimiento.id))
        .reduce((sum, movimiento) => sum + normalizeNumber(movimiento.signedAmount), 0);

    const statementDifference = expectedNetChange - importedNetChange;
    const bookDifference = expectedNetChange - matchedErpNetChange;
    const pendingBankTransactions = activeBankTransactions.filter(
        (transaction) => !matchedBankIds.has(transaction.id)
    );
    const pendingErpMovements = erpMovementsForAccount.filter(
        (movimiento) => !matchedMovimientoIds.has(movimiento.id)
    );

    const canComplete =
        !!selectedAccount &&
        activeBankTransactions.length > 0 &&
        Math.abs(statementDifference) <= 0.01 &&
        Math.abs(bookDifference) <= 0.01;
    const canCloseDraft = !!selectedAccount && activeBankTransactions.length > 0;
    const isLockedReconciliation = ['completada', 'cerrada'].includes(
        activeReconciliation?.estado
    );

    const accountSessions = useMemo(() => {
        if (!activeReconciliation?.accountId) return reconciliaciones;
        return reconciliaciones.filter(
            (item) => item.accountId === activeReconciliation.accountId
        );
    }, [activeReconciliation?.accountId, reconciliaciones]);

    const selectableCounterpartAccounts = useMemo(() => {
        const availableAccounts = accounts
            .filter((account) => !account.isGroup && account.id !== selectedAccount?.id)
            .sort((left, right) =>
                String(left.code || '').localeCompare(String(right.code || ''))
            );

        switch (registerForm.category) {
            case 'gasto':
                return availableAccounts.filter((account) =>
                    ['GASTO', 'COSTO'].includes(String(account.type || '').toUpperCase())
                );
            case 'ingreso':
                return availableAccounts.filter(
                    (account) => String(account.type || '').toUpperCase() === 'INGRESO'
                );
            case 'transferencia':
                return availableAccounts.filter((account) => isTransferAccount(account));
            default:
                return availableAccounts;
        }
    }, [accounts, registerForm.category, selectedAccount?.id]);

    const resetSelections = () => {
        setSelectedBankIds([]);
        setSelectedMovimientoIds([]);
    };

    const closeRegisterModal = () => {
        setShowRegisterModal(false);
        setRegisterForm(createRegisterForm(null, selectedAccount?.currency || 'NIO'));
    };

    const handleAccountChange = (accountId) => {
        const account = bankAccounts.find((item) => item.id === accountId);
        if (!account) return;

        const existingDraft =
            sortByUpdatedAt(
                reconciliaciones.filter(
                    (item) => item.accountId === accountId && item.estado === 'borrador'
                )
            )[0] || null;

        setActiveReconciliation(
            existingDraft
                ? hydrateReconciliation(existingDraft, account)
                : buildBlankReconciliation(account)
        );
        resetSelections();
        setShowRegisterModal(false);
        setRegisterForm(createRegisterForm(null, account.currency || 'NIO'));
        setSuccess('');
        setError('');
    };

    const handleFieldChange = (field, value) => {
        setActiveReconciliation((previous) => ({
            ...previous,
            [field]: value
        }));
    };

    const persistReconciliation = async (
        reconciliation,
        targetStatus = reconciliation?.estado || 'borrador',
        successMessage = ''
    ) => {
        if (!reconciliation?.accountId) {
            throw new Error(
                'Seleccione una cuenta bancaria antes de guardar la conciliación.'
            );
        }

        const now = Timestamp.now();
        const reconciliationMatchGroups = reconciliation.matchGroups || [];
        const reconciliationBankTransactions = reconciliation.bankTransactions || [];
        const reconciliationMatchedBankIds = new Set(
            reconciliationMatchGroups.flatMap((group) => group.bankTransactionIds || [])
        );
        const reconciliationMatchedMovimientoIds = new Set(
            reconciliationMatchGroups.flatMap((group) => group.movimientoIds || [])
        );
        const expectedNetChangeValue =
            normalizeNumber(reconciliation.saldoFinal) -
            normalizeNumber(reconciliation.saldoInicial);
        const importedNetChangeValue = reconciliationBankTransactions.reduce(
            (sum, transaction) => sum + normalizeNumber(transaction.signedAmount),
            0
        );
        const matchedErpNetChangeValue = erpMovementsForAccount
            .filter((movimiento) =>
                reconciliationMatchedMovimientoIds.has(movimiento.id)
            )
            .reduce(
                (sum, movimiento) => sum + normalizeNumber(movimiento.signedAmount),
                0
            );
        const statementDifferenceValue =
            expectedNetChangeValue - importedNetChangeValue;
        const bookDifferenceValue =
            expectedNetChangeValue - matchedErpNetChangeValue;
        const totalPendientesBancoValue = reconciliationBankTransactions.filter(
            (transaction) => !reconciliationMatchedBankIds.has(transaction.id)
        ).length;
        const totalPendientesERPValue = erpMovementsForAccount.filter(
            (movimiento) => !reconciliationMatchedMovimientoIds.has(movimiento.id)
        ).length;

        const payload = {
            accountId: reconciliation.accountId,
            accountCode: reconciliation.accountCode,
            accountName: reconciliation.accountName,
            currency: reconciliation.currency || 'NIO',
            fechaInicio: reconciliation.fechaInicio || '',
            fechaFin: reconciliation.fechaFin || '',
            fechaCorte: reconciliation.fechaCorte || reconciliation.fechaFin || '',
            saldoInicial: normalizeNumber(reconciliation.saldoInicial),
            saldoFinal: normalizeNumber(reconciliation.saldoFinal),
            csvFileName: reconciliation.csvFileName || '',
            notes: reconciliation.notes || '',
            estado: targetStatus,
            bankTransactions: reconciliationBankTransactions,
            matchGroups: reconciliationMatchGroups,
            importedNetChange: normalizeNumber(importedNetChangeValue),
            matchedErpNetChange: normalizeNumber(matchedErpNetChangeValue),
            expectedNetChange: normalizeNumber(expectedNetChangeValue),
            statementDifference: normalizeNumber(statementDifferenceValue),
            bookDifference: normalizeNumber(bookDifferenceValue),
            totalPendientesBanco: totalPendientesBancoValue,
            totalPendientesERP: totalPendientesERPValue,
            updatedAt: now,
            updatedBy: user?.uid || '',
            updatedByEmail: user?.email || ''
        };

        if (reconciliation.id) {
            await updateDoc(doc(db, 'conciliacionesBancarias', reconciliation.id), payload);
            const nextState = {
                ...reconciliation,
                ...payload,
                estado: targetStatus,
                updatedAt: now
            };
            setActiveReconciliation(nextState);
            if (successMessage) setSuccess(successMessage);
            return nextState;
        }

        const ref = await addDoc(collection(db, 'conciliacionesBancarias'), {
            ...payload,
            createdAt: now,
            createdBy: user?.uid || '',
            createdByEmail: user?.email || ''
        });

        const nextState = {
            ...reconciliation,
            ...payload,
            id: ref.id,
            estado: targetStatus,
            createdAt: now,
            updatedAt: now
        };

        setActiveReconciliation(nextState);
        if (successMessage) setSuccess(successMessage);
        return nextState;
    };

    const handleSaveDraft = async () => {
        if (!activeReconciliation) return;

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            await persistReconciliation(
                activeReconciliation,
                'borrador',
                'Conciliación guardada. Puedes seguir después sin perder el avance.'
            );
        } catch (saveError) {
            console.error('Error guardando conciliación bancaria:', saveError);
            setError(
                saveError.message || 'No se pudo guardar la conciliación bancaria.'
            );
        } finally {
            setSaving(false);
        }
    };

    const handleComplete = async () => {
        if (!activeReconciliation) return;

        if (!canComplete) {
            setError(
                'No se puede completar todavía. La diferencia del estado y la diferencia en libros deben quedar en cero.'
            );
            return;
        }

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            await persistReconciliation(
                activeReconciliation,
                'completada',
                'Conciliación completada correctamente.'
            );
        } catch (saveError) {
            console.error('Error completando conciliación bancaria:', saveError);
            setError(
                saveError.message ||
                    'No se pudo completar la conciliación bancaria.'
            );
        } finally {
            setSaving(false);
        }
    };

    const handleCloseDraft = async () => {
        if (!activeReconciliation) return;
        if (!canCloseDraft) {
            setError(
                'Necesitas cargar al menos un estado bancario antes de terminar este archivo.'
            );
            return;
        }

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            await persistReconciliation(
                activeReconciliation,
                'cerrada',
                'Archivo bancario terminado. Puedes iniciar otra conciliación con un nuevo CSV cuando quieras.'
            );
        } catch (saveError) {
            console.error('Error cerrando conciliación bancaria:', saveError);
            setError(
                saveError.message ||
                    'No se pudo terminar la conciliación bancaria actual.'
            );
        } finally {
            setSaving(false);
        }
    };

    const handleNewReconciliation = () => {
        if (!selectedAccount) return;
        setActiveReconciliation(buildBlankReconciliation(selectedAccount));
        resetSelections();
        setSuccess('Se inició una nueva conciliación para la cuenta seleccionada.');
        setError('');
        closeRegisterModal();
    };

    const openRegisterMissingModal = () => {
        if (selectedBankIds.length !== 1) {
            setError('Seleccione una sola transacción del banco para registrarla en el ERP.');
            return;
        }

        const transaction = activeBankTransactions.find(
            (item) => item.id === selectedBankIds[0]
        );

        if (!transaction) {
            setError('No se encontró la transacción bancaria seleccionada.');
            return;
        }

        setRegisterForm(createRegisterForm(transaction, selectedAccount?.currency || 'NIO'));
        setShowRegisterModal(true);
        setError('');
        setSuccess('');
    };

    const toggleBankSelection = (transactionId) => {
        if (
            matchedBankIds.has(transactionId) ||
            isLockedReconciliation
        ) {
            return;
        }

        setSelectedBankIds((previous) =>
            previous.includes(transactionId)
                ? previous.filter((item) => item !== transactionId)
                : [...previous, transactionId]
        );
    };

    const toggleMovimientoSelection = (movimientoId) => {
        if (
            matchedMovimientoIds.has(movimientoId) ||
            isLockedReconciliation
        ) {
            return;
        }

        setSelectedMovimientoIds((previous) =>
            previous.includes(movimientoId)
                ? previous.filter((item) => item !== movimientoId)
                : [...previous, movimientoId]
        );
    };

    const handleMatchSelection = async () => {
        if (!activeReconciliation) return;
        if (!selectedBankIds.length || !selectedMovimientoIds.length) {
            setError(
                'Seleccione transacciones del banco y movimientos del ERP para conciliarlos.'
            );
            return;
        }

        if (Math.abs(selectionBankTotal - selectionErpTotal) > 0.01) {
            setError(
                'Los montos seleccionados no cuadran. Ajuste la selección hasta que la diferencia sea cero.'
            );
            return;
        }

        const nextState = {
            ...activeReconciliation,
            matchGroups: [
                ...activeMatchGroups,
                {
                    id: createMatchId(),
                    bankTransactionIds: selectedBankIds,
                    movimientoIds: selectedMovimientoIds,
                    totalBank: selectionBankTotal,
                    totalERP: selectionErpTotal,
                    createdAt: new Date().toISOString()
                }
            ]
        };

        setActiveReconciliation(nextState);
        resetSelections();
        setError('');
        setSuccess('Selección conciliada. El avance quedó guardado.');

        try {
            await persistReconciliation(nextState, 'borrador');
        } catch (persistError) {
            console.error('Error guardando grupo conciliado:', persistError);
            setError(
                persistError.message ||
                    'La selección se marcó, pero no se pudo guardar en la base de datos.'
            );
        }
    };

    const handleUndoMatch = async (matchId) => {
        if (!activeReconciliation) return;

        const nextState = {
            ...activeReconciliation,
            matchGroups: activeMatchGroups.filter((group) => group.id !== matchId)
        };

        setActiveReconciliation(nextState);
        setSuccess('Se deshizo la conciliación seleccionada.');
        setError('');

        try {
            await persistReconciliation(nextState, 'borrador');
        } catch (persistError) {
            console.error('Error deshaciendo conciliación:', persistError);
            setError(
                persistError.message ||
                    'No se pudo guardar el cambio al deshacer la conciliación.'
            );
        }
    };

    const openCsvModal = () => {
        if (!selectedAccount) {
            setError(
                'Seleccione una cuenta bancaria antes de importar el CSV del banco.'
            );
            return;
        }

        setCsvState((previous) => ({
            ...createEmptyCsvState(),
            open: true,
            fileName: previous.fileName || ''
        }));
        setError('');
        setSuccess('');
    };

    const closeCsvModal = () => setCsvState(createEmptyCsvState());

    const handleCsvFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setCsvState((previous) => ({
            ...previous,
            loading: true,
            error: '',
            fileName: file.name
        }));

        try {
            const text = await file.text();
            const { rows } = parseCsvText(text);

            if (rows.length < 2) {
                throw new Error(
                    'El archivo CSV no trae suficientes filas para importarlo.'
                );
            }

            const headers = rows[0].map((header) => String(header || '').trim());
            const mapping = guessColumnMapping(headers);

            setCsvState((previous) => ({
                ...previous,
                loading: false,
                rows,
                headers,
                mapping
            }));
        } catch (parseError) {
            console.error('Error leyendo CSV bancario:', parseError);
            setCsvState((previous) => ({
                ...previous,
                loading: false,
                error: parseError.message || 'No se pudo leer el archivo CSV.'
            }));
        }
    };

    const handleImportCsv = async () => {
        if (!activeReconciliation) return;

        try {
            const transactions = mapCsvRowsToTransactions(
                csvState.rows,
                csvState.mapping
            );
            if (!transactions.length) {
                throw new Error(
                    'No se pudieron detectar transacciones válidas en el CSV.'
                );
            }

            const dates = transactions
                .map((transaction) => transaction.fecha)
                .filter(Boolean)
                .sort();

            const nextState = {
                ...activeReconciliation,
                csvFileName: csvState.fileName,
                fechaInicio: activeReconciliation.fechaInicio || dates[0] || '',
                fechaFin:
                    activeReconciliation.fechaFin ||
                    dates[dates.length - 1] ||
                    '',
                fechaCorte:
                    activeReconciliation.fechaCorte ||
                    activeReconciliation.fechaFin ||
                    dates[dates.length - 1] ||
                    '',
                bankTransactions: transactions,
                matchGroups: []
            };

            setActiveReconciliation(nextState);
            resetSelections();
            closeCsvModal();
            setError('');
            setSuccess(
                `Se importaron ${transactions.length} transacciones del estado bancario.`
            );

            await persistReconciliation(nextState, 'borrador');
        } catch (importError) {
            console.error('Error importando CSV bancario:', importError);
            setError(importError.message || 'No se pudo importar el archivo CSV.');
        }
    };

    const loadReconciliation = (item) => {
        const account =
            bankAccounts.find((candidate) => candidate.id === item.accountId) || null;
        setActiveReconciliation(hydrateReconciliation(item, account));
        resetSelections();
        setShowRegisterModal(false);
        setRegisterForm(createRegisterForm(null, account?.currency || 'NIO'));
        setError('');
        setSuccess(
            ['completada', 'cerrada'].includes(item.estado)
                ? 'Conciliación histórica cargada en modo consulta.'
                : 'Conciliación cargada para continuar trabajando.'
        );
    };

    const handleRegisterMissingEntry = async (event) => {
        event.preventDefault();

        if (!selectedAccount || !selectedBankTransactionForRegistration || !activeReconciliation) {
            setError('No se encontró la transacción bancaria para registrar.');
            return;
        }

        const counterpartAccount = selectableCounterpartAccounts.find(
            (account) => account.id === registerForm.counterpartAccountId
        );

        if (!counterpartAccount) {
            setError('Seleccione la cuenta contrapartida del movimiento.');
            return;
        }

        const signedAmount = normalizeNumber(
            selectedBankTransactionForRegistration.signedAmount
        );

        if (registerForm.category === 'gasto' && signedAmount > 0) {
            setError('Una transacción de gasto debe ser una salida del banco.');
            return;
        }

        if (registerForm.category === 'ingreso' && signedAmount < 0) {
            setError('Una transacción de ingreso debe ser una entrada al banco.');
            return;
        }

        setRegisteringEntry(true);
        setError('');
        setSuccess('');

        try {
            const amountAbs = Math.abs(signedAmount);
            const exchangeRate =
                Number(registerForm.tipoCambio || 0) > 0
                    ? Number(registerForm.tipoCambio)
                    : 36.5;
            const amountNio =
                String(selectedAccount.currency || 'NIO').toUpperCase() === 'USD'
                    ? amountAbs * exchangeRate
                    : amountAbs;
            const amountUsd =
                String(selectedAccount.currency || 'NIO').toUpperCase() === 'USD'
                    ? amountAbs
                    : 0;

            const bankTipo = signedAmount >= 0 ? 'DEBITO' : 'CREDITO';
            const counterpartTipo = bankTipo === 'DEBITO' ? 'CREDITO' : 'DEBITO';

            const documentRef = doc(collection(db, 'registrosConciliacionBancaria'));
            const documentType =
                registerForm.category === 'ingreso'
                    ? DOCUMENT_TYPES.INGRESO
                    : registerForm.category === 'gasto'
                      ? DOCUMENT_TYPES.GASTO
                      : DOCUMENT_TYPES.AJUSTE;

            await setDoc(documentRef, {
                fecha: registerForm.fecha,
                descripcion: registerForm.descripcion || selectedBankTransactionForRegistration.descripcion || 'Movimiento conciliado',
                referencia: registerForm.referencia || selectedBankTransactionForRegistration.referencia || '',
                accountId: selectedAccount.id,
                accountCode: selectedAccount.code,
                accountName: selectedAccount.name,
                bankTransactionId: selectedBankTransactionForRegistration.id,
                reconciliationId: activeReconciliation.id || null,
                category: registerForm.category,
                counterpartAccountId: counterpartAccount.id,
                counterpartAccountCode: counterpartAccount.code,
                counterpartAccountName: counterpartAccount.name,
                monto: amountNio,
                montoUSD: amountUsd,
                currency: selectedAccount.currency || 'NIO',
                tipoCambio: exchangeRate,
                notas: registerForm.notas || '',
                createdAt: Timestamp.now(),
                createdBy: user?.uid || '',
                createdByEmail: user?.email || ''
            });

            const entry = await registerAccountingEntry({
                fecha: registerForm.fecha,
                descripcion:
                    registerForm.descripcion ||
                    selectedBankTransactionForRegistration.descripcion ||
                    `Movimiento conciliado ${registerForm.category}`,
                referencia:
                    registerForm.referencia ||
                    selectedBankTransactionForRegistration.referencia ||
                    `CONC-${documentRef.id.slice(0, 8).toUpperCase()}`,
                documentoId: documentRef.id,
                documentoTipo: documentType,
                moduloOrigen: 'conciliacionBancaria',
                userId: user?.uid,
                userEmail: user?.email,
                movimientos: [
                    {
                        cuentaId: selectedAccount.id,
                        cuentaCode: selectedAccount.code,
                        cuentaName: selectedAccount.name,
                        tipo: bankTipo,
                        monto: amountNio,
                        montoUSD: amountUsd,
                        descripcion: selectedBankTransactionForRegistration.descripcion || registerForm.descripcion || 'Movimiento bancario'
                    },
                    {
                        cuentaId: counterpartAccount.id,
                        cuentaCode: counterpartAccount.code,
                        cuentaName: counterpartAccount.name,
                        tipo: counterpartTipo,
                        monto: amountNio,
                        montoUSD: amountUsd,
                        descripcion: registerForm.descripcion || selectedBankTransactionForRegistration.descripcion || 'Contrapartida conciliación bancaria'
                    }
                ],
                metadata: {
                    reconciliationId: activeReconciliation.id || null,
                    bankTransactionId: selectedBankTransactionForRegistration.id,
                    category: registerForm.category,
                    bankAccountId: selectedAccount.id,
                    bankAccountCode: selectedAccount.code,
                    tipoCambio: exchangeRate
                }
            });

            const bankMovimiento =
                entry.movimientos.find(
                    (movimiento) =>
                        movimiento.cuentaId === selectedAccount.id ||
                        normalizeCode(movimiento.cuentaCode) === normalizeCode(selectedAccount.code)
                ) || entry.movimientos[0];

            const nextState = {
                ...activeReconciliation,
                matchGroups: [
                    ...activeMatchGroups,
                    {
                        id: createMatchId(),
                        bankTransactionIds: [selectedBankTransactionForRegistration.id],
                        movimientoIds: [bankMovimiento.id],
                        totalBank: signedAmount,
                        totalERP: signedAmount,
                        createdAt: new Date().toISOString(),
                        autoGenerated: true
                    }
                ]
            };

            setActiveReconciliation(nextState);
            resetSelections();
            closeRegisterModal();
            setSuccess('Movimiento registrado en el ERP y conciliado inmediatamente.');
            await persistReconciliation(nextState, 'borrador');
        } catch (registerError) {
            console.error('Error registrando movimiento faltante:', registerError);
            setError(
                registerError.message ||
                    'No se pudo registrar el movimiento faltante desde la conciliación.'
            );
        } finally {
            setRegisteringEntry(false);
        }
    };

    const loadingScreen =
        loadingAccounts ||
        (!activeReconciliation && (loadingReconciliaciones || loadingMovimientos));

    if (loadingScreen) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
                    <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
                    Preparando conciliación bancaria...
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
            <section className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 p-6 text-white shadow-xl">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                            <Landmark className="h-4 w-4" />
                            Conciliación Bancaria
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight">
                                Conciliación Bancaria
                            </h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-300 md:text-base">
                                Sube CSV Banco.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={handleNewReconciliation}
                            disabled={!selectedAccount}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Plus className="h-4 w-4" />
                            Nueva conciliación
                        </button>
                        <button
                            type="button"
                            onClick={openCsvModal}
                            disabled={!selectedAccount}
                            className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Upload className="h-4 w-4" />
                            Subir CSV Banco
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveDraft}
                            disabled={saving || !activeReconciliation || isLockedReconciliation}
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4" />
                            )}
                            Guardar borrador
                        </button>
                        <button
                            type="button"
                            onClick={handleCloseDraft}
                            disabled={saving || !canCloseDraft || isLockedReconciliation}
                            className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Clock3 className="h-4 w-4" />
                            Terminar archivo
                        </button>
                        <button
                            type="button"
                            onClick={handleComplete}
                            disabled={saving || !canComplete}
                            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <CheckCircle2 className="h-4 w-4" />
                            Completar
                        </button>
                    </div>
                </div>
            </section>

            {(error || success) && (
                <div className="grid gap-3">
                    {error && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            {success}
                        </div>
                    )}
                </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="space-y-6">
                    <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-2">
                            <ArrowRightLeft className="h-5 w-5 text-blue-600" />
                            <h2 className="text-lg font-bold text-slate-900">
                                Sesión actual
                            </h2>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-600">
                                    Cuenta bancaria
                                </label>
                                <select
                                    value={activeReconciliation?.accountId || ''}
                                    onChange={(event) =>
                                        handleAccountChange(event.target.value)
                                    }
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white"
                                >
                                    {bankAccounts.map((account) => (
                                        <option key={account.id} value={account.id}>
                                            {account.code} - {account.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Desde
                                    </label>
                                    <input
                                        type="date"
                                        value={activeReconciliation?.fechaInicio || ''}
                                        onChange={(event) =>
                                            handleFieldChange(
                                                'fechaInicio',
                                                event.target.value
                                            )
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Hasta
                                    </label>
                                    <input
                                        type="date"
                                        value={activeReconciliation?.fechaFin || ''}
                                        onChange={(event) => {
                                            handleFieldChange(
                                                'fechaFin',
                                                event.target.value
                                            );
                                            handleFieldChange(
                                                'fechaCorte',
                                                event.target.value
                                            );
                                        }}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Saldo inicial
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={activeReconciliation?.saldoInicial ?? 0}
                                        onChange={(event) =>
                                            handleFieldChange(
                                                'saldoInicial',
                                                event.target.value
                                            )
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Saldo final estado
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={activeReconciliation?.saldoFinal ?? 0}
                                        onChange={(event) =>
                                            handleFieldChange(
                                                'saldoFinal',
                                                event.target.value
                                            )
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                <p className="font-semibold text-slate-900">
                                    Archivo actual:{' '}
                                    {activeReconciliation?.csvFileName ||
                                        'Sin CSV cargado'}
                                </p>
                                <p className="mt-1">
                                    Estado:{' '}
                                    <span className="font-medium capitalize">
                                        {activeReconciliation?.estado || 'borrador'}
                                    </span>
                                </p>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-600">
                                    Notas
                                </label>
                                <textarea
                                    rows={4}
                                    value={activeReconciliation?.notes || ''}
                                    onChange={(event) =>
                                        handleFieldChange('notes', event.target.value)
                                    }
                                    placeholder="Notas internas, diferencias observadas, pendientes del banco..."
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                />
                            </div>
                        </div>
                    </section>

                    <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-2">
                            <History className="h-5 w-5 text-slate-700" />
                            <h2 className="text-lg font-bold text-slate-900">
                                Guardar y seguir después
                            </h2>
                        </div>

                        <div className="space-y-3">
                            {loadingReconciliaciones && (
                                <div className="flex items-center gap-2 text-sm text-slate-500">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Cargando historial...
                                </div>
                            )}

                            {!loadingReconciliaciones && accountSessions.length === 0 && (
                                <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                                    Todavía no hay conciliaciones guardadas para esta
                                    cuenta.
                                </p>
                            )}

                            {accountSessions.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => loadReconciliation(item)}
                                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                                        activeReconciliation?.id === item.id
                                            ? 'border-blue-300 bg-blue-50'
                                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">
                                                {item.accountName || 'Cuenta bancaria'}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {item.fechaInicio || '---'} al{' '}
                                                {item.fechaFin || '---'}
                                            </p>
                                        </div>
                                        <span
                                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                                item.estado === 'completada'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : item.estado === 'cerrada'
                                                      ? 'bg-slate-200 text-slate-700'
                                                      : 'bg-amber-100 text-amber-700'
                                            }`}
                                        >
                                            {item.estado}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                        <span>
                                            {formatCurrency(item.saldoFinal, item.currency)}
                                        </span>
                                        <span>{item.csvFileName || 'Sin CSV'}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                </aside>

                <section className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-500">
                                Cambio esperado
                            </p>
                            <p className="mt-2 text-2xl font-black text-slate-900">
                                {formatSignedAmount(
                                    expectedNetChange,
                                    selectedAccount?.currency || 'NIO'
                                )}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                                Saldo final menos saldo inicial.
                            </p>
                        </div>

                        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-500">
                                Estado bancario importado
                            </p>
                            <p className="mt-2 text-2xl font-black text-slate-900">
                                {formatSignedAmount(
                                    importedNetChange,
                                    selectedAccount?.currency || 'NIO'
                                )}
                            </p>
                            <p
                                className={`mt-2 text-xs font-semibold ${
                                    Math.abs(statementDifference) <= 0.01
                                        ? 'text-emerald-600'
                                        : 'text-red-600'
                                }`}
                            >
                                Diferencia CSV:{' '}
                                {formatSignedAmount(
                                    statementDifference,
                                    selectedAccount?.currency || 'NIO'
                                )}
                            </p>
                        </div>

                        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-500">
                                Libros conciliados
                            </p>
                            <p className="mt-2 text-2xl font-black text-slate-900">
                                {formatSignedAmount(
                                    matchedErpNetChange,
                                    selectedAccount?.currency || 'NIO'
                                )}
                            </p>
                            <p
                                className={`mt-2 text-xs font-semibold ${
                                    Math.abs(bookDifference) <= 0.01
                                        ? 'text-emerald-600'
                                        : 'text-red-600'
                                }`}
                            >
                                Diferencia libros:{' '}
                                {formatSignedAmount(
                                    bookDifference,
                                    selectedAccount?.currency || 'NIO'
                                )}
                            </p>
                        </div>

                        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-500">
                                Pendientes por conciliar
                            </p>
                            <p className="mt-2 text-2xl font-black text-slate-900">
                                {pendingBankTransactions.length} /{' '}
                                {pendingErpMovements.length}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">Banco / ERP</p>
                        </div>
                    </div>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <h2 className="text-xl font-black text-slate-900">
                                    Panel de conciliación
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Selecciona líneas del banco y movimientos del ERP hasta que la diferencia de la selección sea cero.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowMatched((previous) => !previous)}
                                    className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                                        showMatched
                                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    {showMatched ? 'Ocultar conciliados' : 'Ver conciliados'}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetSelections}
                                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                    Limpiar selección
                                </button>
                                <button
                                    type="button"
                                    onClick={openRegisterMissingModal}
                                    disabled={
                                        isLockedReconciliation ||
                                        selectedBankIds.length !== 1
                                    }
                                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Registrar en ERP
                                </button>
                                <button
                                    type="button"
                                    onClick={handleMatchSelection}
                                    disabled={
                                        isLockedReconciliation ||
                                        !selectedBankIds.length ||
                                        !selectedMovimientoIds.length
                                    }
                                    className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Conciliar selección
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 grid gap-4 lg:grid-cols-3">
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                                    Banco seleccionado
                                </p>
                                <p className="mt-2 text-2xl font-black text-blue-900">
                                    {formatSignedAmount(selectionBankTotal, selectedAccount?.currency || 'NIO')}
                                </p>
                                <p className="mt-2 text-sm text-blue-700">
                                    {selectedBankIds.length} línea(s) marcadas
                                </p>
                            </div>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                                    ERP seleccionado
                                </p>
                                <p className="mt-2 text-2xl font-black text-emerald-900">
                                    {formatSignedAmount(selectionErpTotal, selectedAccount?.currency || 'NIO')}
                                </p>
                                <p className="mt-2 text-sm text-emerald-700">
                                    {selectedMovimientoIds.length} movimiento(s) marcados
                                </p>
                            </div>
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                                    Diferencia selección
                                </p>
                                <p className={`mt-2 text-2xl font-black ${
                                    Math.abs(selectionBankTotal - selectionErpTotal) <= 0.01
                                        ? 'text-emerald-700'
                                        : 'text-amber-900'
                                }`}>
                                    {formatSignedAmount(
                                        selectionBankTotal - selectionErpTotal,
                                        selectedAccount?.currency || 'NIO'
                                    )}
                                </p>
                                <p className="mt-2 text-sm text-amber-700">
                                    Debe quedar en cero para conciliar.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-6 xl:grid-cols-2">
                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">
                                            Transacciones del banco
                                        </h3>
                                        <p className="text-sm text-slate-500">
                                            {pendingBankTransactions.length} pendientes en el estado bancario
                                        </p>
                                    </div>
                                    <label className="relative block md:w-64">
                                        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchBank}
                                            onChange={(event) => setSearchBank(event.target.value)}
                                            placeholder="Buscar en banco..."
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                        />
                                    </label>
                                </div>

                                <div className="overflow-hidden rounded-[24px] border border-slate-200">
                                    <div className="max-h-[520px] overflow-auto">
                                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                                            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="px-4 py-3">Sel.</th>
                                                    <th className="px-4 py-3">Fecha</th>
                                                    <th className="px-4 py-3">Descripción</th>
                                                    <th className="px-4 py-3">Monto</th>
                                                    <th className="px-4 py-3">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {filteredBankTransactions.map((transaction) => {
                                                    const isSelected = selectedBankIds.includes(transaction.id);
                                                    const isMatched = matchedBankIds.has(transaction.id);

                                                    return (
                                                        <tr key={transaction.id} className={isSelected ? 'bg-blue-50' : ''}>
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleBankSelection(transaction.id)}
                                                                    className="text-blue-600 disabled:text-slate-300"
                                                                    disabled={isMatched || isLockedReconciliation}
                                                                >
                                                                    {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-600">{transaction.fecha}</td>
                                                            <td className="px-4 py-3">
                                                                <p className="font-medium text-slate-900">{transaction.descripcion}</p>
                                                                <p className="text-xs text-slate-500">{transaction.referencia || 'Sin referencia'}</p>
                                                            </td>
                                                            <td className="px-4 py-3 font-semibold text-slate-900">
                                                                <span className={normalizeNumber(transaction.signedAmount) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                                                    {formatSignedAmount(transaction.signedAmount, selectedAccount?.currency || 'NIO')}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                                                    isMatched
                                                                        ? 'bg-emerald-100 text-emerald-700'
                                                                        : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                    {isMatched ? 'Conciliada' : 'Pendiente'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}

                                                {filteredBankTransactions.length === 0 && (
                                                    <tr>
                                                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                                                            No hay transacciones bancarias que mostrar con los filtros actuales.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">
                                            Movimientos ERP de la cuenta
                                        </h3>
                                        <p className="text-sm text-slate-500">
                                            {pendingErpMovements.length} pendientes en libros
                                        </p>
                                    </div>
                                    <label className="relative block md:w-64">
                                        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchErp}
                                            onChange={(event) => setSearchErp(event.target.value)}
                                            placeholder="Buscar en ERP..."
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                        />
                                    </label>
                                </div>

                                <div className="overflow-hidden rounded-[24px] border border-slate-200">
                                    <div className="max-h-[520px] overflow-auto">
                                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                                            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="px-4 py-3">Sel.</th>
                                                    <th className="px-4 py-3">Fecha</th>
                                                    <th className="px-4 py-3">Origen</th>
                                                    <th className="px-4 py-3">Detalle</th>
                                                    <th className="px-4 py-3">Monto</th>
                                                    <th className="px-4 py-3">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {filteredErpMovements.map((movimiento) => {
                                                    const isSelected = selectedMovimientoIds.includes(movimiento.id);
                                                    const isMatched = matchedMovimientoIds.has(movimiento.id);

                                                    return (
                                                        <tr key={movimiento.id} className={isSelected ? 'bg-emerald-50' : ''}>
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleMovimientoSelection(movimiento.id)}
                                                                    className="text-emerald-600 disabled:text-slate-300"
                                                                    disabled={isMatched || isLockedReconciliation}
                                                                >
                                                                    {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-600">{movimiento.movementDate}</td>
                                                            <td className="px-4 py-3">
                                                                <p className="font-medium text-slate-900">{movimiento.moduloOrigen || 'manual'}</p>
                                                                <p className="text-xs text-slate-500">{movimiento.sucursalName || 'General'}</p>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <p className="font-medium text-slate-900">{movimiento.descripcion || 'Movimiento contable'}</p>
                                                                <p className="text-xs text-slate-500">{movimiento.referencia || 'Sin referencia'}</p>
                                                            </td>
                                                            <td className="px-4 py-3 font-semibold text-slate-900">
                                                                <span className={normalizeNumber(movimiento.signedAmount) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                                                    {formatSignedAmount(movimiento.signedAmount, selectedAccount?.currency || 'NIO')}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                                                    isMatched
                                                                        ? 'bg-emerald-100 text-emerald-700'
                                                                        : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                    {isMatched ? 'Conciliado' : 'Pendiente'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}

                                                {filteredErpMovements.length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                                                            No hay movimientos ERP para la cuenta y período seleccionados.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">
                                        Grupos ya conciliados
                                    </h3>
                                    <p className="text-sm text-slate-500">
                                        Puedes deshacer un grupo si necesitas reclasificarlo.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-500">
                                    <Clock3 className="h-4 w-4" />
                                    {activeMatchGroups.length} grupo(s) guardados
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3">
                                {activeMatchGroups.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                                        Todavía no has conciliado ninguna selección en esta sesión.
                                    </div>
                                )}

                                {activeMatchGroups.map((group) => (
                                    <div key={group.id} className="rounded-2xl border border-white bg-white px-4 py-4 shadow-sm">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="font-semibold text-slate-900">
                                                    Grupo {group.id.slice(-6).toUpperCase()}
                                                </p>
                                                <p className="mt-1 text-sm text-slate-500">
                                                    {group.bankTransactionIds?.length || 0} línea(s) del banco y {group.movimientoIds?.length || 0} movimiento(s) ERP
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <p className="text-sm font-semibold text-emerald-700">
                                                    {formatSignedAmount(group.totalERP, selectedAccount?.currency || 'NIO')}
                                                </p>
                                                {!isLockedReconciliation && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUndoMatch(group.id)}
                                                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                        Deshacer
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </section>
            </div>

            {showRegisterModal && selectedBankTransactionForRegistration && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-[28px] bg-white shadow-2xl">
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900">
                                    Registrar movimiento faltante
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Crea el movimiento desde la línea bancaria y déjalo conciliado al guardar.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeRegisterModal}
                                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleRegisterMissingEntry} className="space-y-6 p-6">
                            <div className="rounded-[22px] border border-blue-100 bg-blue-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                                    Línea del banco
                                </p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                            {selectedBankTransactionForRegistration.descripcion}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {selectedBankTransactionForRegistration.fecha} · {selectedBankTransactionForRegistration.referencia || 'Sin referencia'}
                                        </p>
                                    </div>
                                    <div className="text-left sm:text-right">
                                        <p className={`text-xl font-black ${
                                            normalizeNumber(selectedBankTransactionForRegistration.signedAmount) >= 0
                                                ? 'text-emerald-600'
                                                : 'text-red-600'
                                        }`}>
                                            {formatSignedAmount(
                                                selectedBankTransactionForRegistration.signedAmount,
                                                selectedAccount?.currency || 'NIO'
                                            )}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Cuenta banco: {selectedAccount?.code} - {selectedAccount?.name}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Tipo de movimiento
                                    </label>
                                    <select
                                        value={registerForm.category}
                                        onChange={(event) =>
                                            setRegisterForm((previous) => ({
                                                ...previous,
                                                category: event.target.value,
                                                counterpartAccountId: ''
                                            }))
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    >
                                        <option value="gasto">Gasto / egreso</option>
                                        <option value="ingreso">Ingreso</option>
                                        <option value="transferencia">Transferencia</option>
                                        <option value="ajuste">Ajuste</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Fecha
                                    </label>
                                    <input
                                        type="date"
                                        value={registerForm.fecha}
                                        onChange={(event) =>
                                            setRegisterForm((previous) => ({
                                                ...previous,
                                                fecha: event.target.value
                                            }))
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Cuenta contrapartida
                                    </label>
                                    <select
                                        value={registerForm.counterpartAccountId}
                                        onChange={(event) =>
                                            setRegisterForm((previous) => ({
                                                ...previous,
                                                counterpartAccountId: event.target.value
                                            }))
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                        required
                                    >
                                        <option value="">Seleccione una cuenta...</option>
                                        {selectableCounterpartAccounts.map((account) => (
                                            <option key={account.id} value={account.id}>
                                                {account.code} - {account.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {String(selectedAccount?.currency || 'NIO').toUpperCase() === 'USD' && (
                                    <div>
                                        <label className="mb-1 block text-sm font-semibold text-slate-600">
                                            Tipo de cambio
                                        </label>
                                        <input
                                            type="number"
                                            step="0.0001"
                                            min="0.0001"
                                            value={registerForm.tipoCambio}
                                            onChange={(event) =>
                                                setRegisterForm((previous) => ({
                                                    ...previous,
                                                    tipoCambio: event.target.value
                                                }))
                                            }
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                        />
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-600">
                                    Descripción
                                </label>
                                <input
                                    type="text"
                                    value={registerForm.descripcion}
                                    onChange={(event) =>
                                        setRegisterForm((previous) => ({
                                            ...previous,
                                            descripcion: event.target.value
                                        }))
                                    }
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    placeholder="Descripción contable del movimiento"
                                />
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Referencia
                                    </label>
                                    <input
                                        type="text"
                                        value={registerForm.referencia}
                                        onChange={(event) =>
                                            setRegisterForm((previous) => ({
                                                ...previous,
                                                referencia: event.target.value
                                            }))
                                        }
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                        placeholder="Referencia o documento"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                        Monto banco
                                    </label>
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                                        {formatSignedAmount(
                                            selectedBankTransactionForRegistration.signedAmount,
                                            selectedAccount?.currency || 'NIO'
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-600">
                                    Notas
                                </label>
                                <textarea
                                    rows={3}
                                    value={registerForm.notas}
                                    onChange={(event) =>
                                        setRegisterForm((previous) => ({
                                            ...previous,
                                            notas: event.target.value
                                        }))
                                    }
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white"
                                    placeholder="Comentario opcional"
                                />
                            </div>

                            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={closeRegisterModal}
                                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={registeringEntry}
                                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {registeringEntry ? 'Registrando...' : 'Registrar y conciliar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {csvState.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-[30px] bg-white shadow-2xl">
                        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900">
                                    Importar CSV bancario
                                </h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Sube el estado del banco y mapea las columnas una sola vez para esta sesión.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeCsvModal}
                                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="space-y-6 p-6">
                            <div className="rounded-[24px] border border-dashed border-blue-200 bg-blue-50 p-6">
                                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 text-center">
                                    <div className="rounded-full bg-blue-100 p-3 text-blue-600">
                                        <FileSpreadsheet className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <p className="text-base font-bold text-slate-900">
                                            Seleccionar archivo CSV
                                        </p>
                                        <p className="text-sm text-slate-500">
                                            Admite columnas de fecha, descripción, débito/crédito o monto único.
                                        </p>
                                    </div>
                                    <span className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                                        Elegir archivo
                                    </span>
                                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFileChange} />
                                </label>
                            </div>

                            {csvState.loading && (
                                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Leyendo archivo...
                                </div>
                            )}

                            {csvState.error && (
                                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    {csvState.error}
                                </div>
                            )}

                            {csvState.headers.length > 0 && (
                                <>
                                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                                        <div className="mb-4 flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-900">
                                                    Mapeo de columnas
                                                </h3>
                                                <p className="text-sm text-slate-500">
                                                    {csvState.fileName}
                                                </p>
                                            </div>
                                            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                                                {csvState.rows.length - 1} filas
                                            </span>
                                        </div>

                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                            {[
                                                ['date', 'Fecha'],
                                                ['description', 'Descripción'],
                                                ['reference', 'Referencia'],
                                                ['debit', 'Débito'],
                                                ['credit', 'Crédito'],
                                                ['amount', 'Monto único']
                                            ].map(([field, label]) => (
                                                <div key={field}>
                                                    <label className="mb-1 block text-sm font-semibold text-slate-600">
                                                        {label}
                                                    </label>
                                                    <select
                                                        value={csvState.mapping[field]}
                                                        onChange={(event) =>
                                                            setCsvState((previous) => ({
                                                                ...previous,
                                                                mapping: {
                                                                    ...previous.mapping,
                                                                    [field]:
                                                                        event.target.value
                                                                }
                                                            }))
                                                        }
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-300"
                                                    >
                                                        <option value="">No usar</option>
                                                        {csvState.headers.map((header) => (
                                                            <option
                                                                key={`${field}-${header}`}
                                                                value={header}
                                                            >
                                                                {header}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-[24px] border border-slate-200 bg-white">
                                        <div className="border-b border-slate-200 px-5 py-4">
                                            <h3 className="text-lg font-bold text-slate-900">
                                                Vista previa
                                            </h3>
                                            <p className="text-sm text-slate-500">
                                                Primeras filas detectadas del estado bancario.
                                            </p>
                                        </div>
                                        <div className="overflow-auto">
                                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                                    <tr>
                                                        {csvState.headers.map((header) => (
                                                            <th key={header} className="px-4 py-3">
                                                                {header}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {csvState.rows.slice(1, 6).map((row, rowIndex) => (
                                                        <tr key={`preview-${rowIndex}`}>
                                                            {csvState.headers.map((header, index) => (
                                                                <td key={`${rowIndex}-${header}`} className="px-4 py-3 text-slate-600">
                                                                    {row[index] || '-'}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-slate-200 bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-slate-500">
                                Importa, asigna y concilia movimientos bancarios.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={closeCsvModal}
                                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={handleImportCsv}
                                    disabled={!csvState.headers.length}
                                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Importar al conciliador
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConciliacionBancaria;
