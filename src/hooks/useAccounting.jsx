// src/hooks/useAccounting.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';

const AccountingContext = createContext();

export const useAccounting = () => {
    const context = useContext(AccountingContext);
    if (!context) {
        throw new Error('useAccounting debe usarse dentro de AccountingProvider');
    }
    return context;
};

export const AccountingProvider = ({ children }) => {
    const [accounts, setAccounts] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Cargar plan de cuentas
        const accountsRef = collection(db, 'planCuentas');
        const q = query(accountsRef, orderBy('code'));
        
        const unsubscribeAccounts = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAccounts(data);
        });

        // Cargar movimientos
        const movimientosRef = collection(db, 'movimientosContables');
        const qMov = query(movimientosRef, orderBy('timestamp', 'desc'));
        
        const unsubscribeMovimientos = onSnapshot(qMov, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMovimientos(data);
            setLoading(false);
        });

        return () => {
            unsubscribeAccounts();
            unsubscribeMovimientos();
        };
    }, []);

    const getAccountByCode = (code) => {
        return accounts.find(a => a.code === code) || null;
    };

    const getAccountById = (id) => {
        return accounts.find(a => a.id === id) || null;
    };

    return (
        <AccountingContext.Provider value={{ 
            accounts, 
            movimientos, 
            loading, 
            getAccountByCode, 
            getAccountById 
        }}>
            {children}
        </AccountingContext.Provider>
    );
};

export default AccountingContext;
