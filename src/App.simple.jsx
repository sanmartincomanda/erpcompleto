// App.jsx SIMPLIFICADO para diagnóstico
// Reemplaza App.jsx con este archivo para probar

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Componente Login simplificado
const SimpleLogin = () => (
    <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(to bottom right, #1e293b, #334155)'
    }}>
        <div style={{ 
            background: 'white', 
            padding: '40px', 
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center'
        }}>
            <h1 style={{ marginBottom: '10px' }}>ERP Carnessanmartin</h1>
            <p style={{ color: '#666', marginBottom: '30px' }}>Granada - Modo Diagnóstico</p>
            <button 
                onClick={() => window.location.href = '/inicio'}
                style={{
                    padding: '12px 30px',
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    cursor: 'pointer'
                }}
            >
                Entrar (Sin Login)
            </button>
        </div>
    </div>
);

// Componente Inicio simplificado
const SimpleInicio = () => (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1>✅ ¡Funciona!</h1>
        <p>El problema está en los providers (AuthProvider, BranchesProvider, AccountingProvider) o en los hooks de Firebase.</p>
        
        <div style={{ 
            background: '#f0f9ff', 
            padding: '20px', 
            borderRadius: '8px',
            marginTop: '20px'
        }}>
            <h3>Próximos pasos:</h3>
            <ol>
                <li>Verifica la consola (F12) para ver errores específicos</li>
                <li>Revisa que Firebase esté configurado correctamente</li>
                <li>Verifica que las credenciales en firebase.js sean correctas</li>
            </ol>
        </div>

        <div style={{ marginTop: '30px' }}>
            <a href="/" style={{ color: '#2563eb' }}>← Volver al Login</a>
        </div>
    </div>
);

function AppSimple() {
    return (
        <Router>
            <Routes>
                <Route path="/login" element={<SimpleLogin />} />
                <Route path="/inicio" element={<SimpleInicio />} />
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="*" element={<div style={{ padding: '50px', textAlign: 'center' }}><h1>404</h1><a href="/login">Volver</a></div>} />
            </Routes>
        </Router>
    );
}

export default AppSimple;
