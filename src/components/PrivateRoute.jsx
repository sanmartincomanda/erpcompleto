// src/components/PrivateRoute.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = ({ element }) => {
    const { user } = useAuth();
    
    if (!user) {
        return <Navigate to="/login" replace />;
    }
    
    return element;
};

export default PrivateRoute;
