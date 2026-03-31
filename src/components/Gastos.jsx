// src/components/Gastos.jsx
import React from 'react';
import { TrendingDown } from 'lucide-react';

const Gastos = () => {
    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <TrendingDown className="w-8 h-8 text-red-600" />
                Módulo de Gastos
            </h1>
            <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-gray-600 mb-4">Use el módulo Data Entry para registrar gastos</p>
                <a 
                    href="/dataentry" 
                    className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                    Ir a Data Entry
                </a>
            </div>
        </div>
    );
};

export default Gastos;
