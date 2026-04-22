// src/hooks/useBranches.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { normalizeBranch } from '../utils/branches';

const BranchesContext = createContext();

export const useBranches = () => {
    const context = useContext(BranchesContext);
    if (!context) {
        throw new Error('useBranches debe usarse dentro de BranchesProvider');
    }
    return context;
};

export const BranchesProvider = ({ children }) => {
    const { user, loading: authLoading } = useAuth();
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading) {
            setLoading(true);
            return undefined;
        }

        if (!user) {
            setBranches([]);
            setLoading(false);
            return undefined;
        }

        const branchesRef = collection(db, 'branches');
        setLoading(true);

        const unsubscribe = onSnapshot(
            branchesRef,
            (snapshot) => {
                const data = snapshot.docs
                    .map((doc) =>
                        normalizeBranch({
                            ...doc.data(),
                            id: doc.id
                        })
                    )
                    .sort((left, right) => (left.name || '').localeCompare(right.name || ''));
                setBranches(data);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando sucursales:', err);
                setBranches([]);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [authLoading, user]);

    return (
        <BranchesContext.Provider value={{ branches, loading }}>
            {children}
        </BranchesContext.Provider>
    );
};

export default BranchesContext;
