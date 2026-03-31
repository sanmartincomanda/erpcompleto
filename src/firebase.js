// src/firebase.js
// Configuración de Firebase para el ERP

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Configuración de Firebase - Nuevo proyecto: estado-resultado-nuevo
const firebaseConfig = {
    apiKey: "AIzaSyAGKR9hk1xTFgp4Wzr9ZfnM1KSiIF1VmRE",
    authDomain: "estado-resultado-nuevo.firebaseapp.com",
    databaseURL: "https://estado-resultado-nuevo-default-rtdb.firebaseio.com",
    projectId: "estado-resultado-nuevo",
    storageBucket: "estado-resultado-nuevo.firebasestorage.app",
    messagingSenderId: "527766169645",
    appId: "1:527766169645:web:e758556d3647d19f0670a4"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Exportar servicios
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;
