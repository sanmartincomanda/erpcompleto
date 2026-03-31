# 🔧 Diagnóstico - Pantalla en Blanco

## Paso 1: Verificar si es problema de Providers

El problema más común es que uno de los providers (AuthProvider, BranchesProvider, AccountingProvider) está fallando silenciosamente.

### Prueba rápida:

1. **Haz backup de App.jsx:**
   ```bash
   cp src/App.jsx src/App.backup.jsx
   ```

2. **Reemplaza App.jsx con la versión simplificada:**
   ```bash
   cp src/App.simple.jsx src/App.jsx
   ```

3. **Recarga la página** - Si ves el login, el problema está en los providers.

4. **Para volver a la versión original:**
   ```bash
   cp src/App.backup.jsx src/App.jsx
   ```

---

## Paso 2: Verificar Firebase

Abre la consola (F12) y busca errores como:
- `FirebaseError`
- `Permission denied`
- `Network error`

### Solución:
1. Ve a https://console.firebase.google.com
2. Verifica que el proyecto `estado-resultado-nuevo` exista
3. Ve a Firestore Database y crea las colecciones vacías:
   - `planCuentas`
   - `cierresCajaERP`
   - `branches`

---

## Paso 3: Verificar Dependencias

```bash
# Detener el servidor (Ctrl+C)

# Limpiar todo
rm -rf node_modules dist

# Reinstalar
npm install

# Iniciar de nuevo
npm run dev
```

---

## Paso 4: Página de Diagnóstico

Visita: http://localhost:3000/test.html

Si ves la página de diagnóstico, el servidor está funcionando.

---

## Paso 5: Errores Comunes

### Error: "Cannot read properties of null"
**Causa:** Los hooks están retornando null
**Solución:** Verifica que Firebase tenga datos o que los hooks manejen el estado null

### Error: "Failed to fetch"
**Causa:** Problema de conexión a internet o Firebase
**Solución:** Verifica tu conexión

### Error: "process is not defined"
**Causa:** Estás usando `process.env` en lugar de `import.meta.env`
**Solución:** Busca y reemplaza `process.env` por `import.meta.env`

---

## Paso 6: Contactar Soporte

Si nada funciona, comparte:
1. Captura de la consola (F12) con todos los errores
2. Output de `node -v` y `npm -v`
3. Contenido del archivo `src/firebase.js` (oculta las credenciales)
