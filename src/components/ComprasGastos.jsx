// src/components/ComprasGastos.jsx
import React from 'react';
import { ShoppingCart } from 'lucide-react';

const ComprasGastos = () => {
    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <ShoppingCart className="w-8 h-8 text-blue-600" />
                Compras y Gastos
            </h1>
            <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-gray-600 mb-4">Use el módulo Cuentas por Pagar para gestionar compras</p>
                <a 
                    href="/cuentas-pagar" 
                    className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                    Ir a Cuentas por Pagar
                </a>
            </div>
        </div>
    );
};

export default ComprasGastos;
