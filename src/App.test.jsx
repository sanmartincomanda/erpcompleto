// App simplificado para diagnóstico
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Solo importar lo esencial para prueba
import Login from './components/Login';

// Componente de prueba simple
const TestPage = () => (
    <div style={{ padding: '50px', textAlign: 'center' }}>
        <h1>✅ ¡Funciona!</h1>
        <p>Si ves esto, el problema está en los providers o componentes importados.</p>
    </div>
);

function AppTest() {
    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/test" element={<TestPage />} />
                <Route path="/" element={<Navigate to="/test" replace />} />
            </Routes>
        </Router>
    );
}

export default AppTest;
