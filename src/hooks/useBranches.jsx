// src/hooks/useBranches.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

const BranchesContext = createContext();

export const useBranches = () => {
    const context = useContext(BranchesContext);
    if (!context) {
        throw new Error('useBranches debe usarse dentro de BranchesProvider');
    }
    return context;
};

export const BranchesProvider = ({ children }) => {
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const branchesRef = collection(db, 'branches');
        const unsubscribe = onSnapshot(branchesRef, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setBranches(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando sucursales:', err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <BranchesContext.Provider value={{ branches, loading }}>
            {children}
        </BranchesContext.Provider>
    );
};

export default BranchesContext;
