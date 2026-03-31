# 🛠️ Solución: Pantalla en Blanco

Si ves la pantalla en blanco, sigue estos pasos:

## Paso 1: Verificar la Consola del Navegador

1. Presiona **F12** para abrir las herramientas de desarrollador
2. Ve a la pestaña **Console**
3. Busca mensajes de error en **rojo**
4. Toma una captura de pantalla de los errores

## Paso 2: Errores Comunes y Soluciones

### Error: "Cannot read properties of null"
**Causa:** Algún componente está recibiendo datos nulos
**Solución:** Verifica que Firebase tenga datos en las colecciones

### Error: "Failed to load module"
**Causa:** Error en los imports
**Solución:** 
```bash
rm -rf node_modules
npm install
```

### Error: "Firebase Error"
**Causa:** Problema de conexión a Firebase
**Solución:** Verifica tu conexión a internet y las credenciales de Firebase

## Paso 3: Limpiar y Reinstalar

```bash
# Detener el servidor (Ctrl+C)

# Limpiar caché
rm -rf node_modules
rm -rf dist

# Reinstalar dependencias
npm install

# Iniciar de nuevo
npm run dev
```

## Paso 4: Verificar Archivos Críticos

Asegúrate de que estos archivos existan:
- `src/main.jsx`
- `src/App.jsx`
- `src/firebase.js`
- `index.html`

## Paso 5: Prueba de Diagnóstico

Visita: `http://localhost:3000/diagnostico.html`

Si ves la página de diagnóstico, el servidor está funcionando.

## Paso 6: Verificar Firebase

1. Ve a la consola de Firebase: https://console.firebase.google.com
2. Verifica que el proyecto "estado-resultado-nuevo" exista
3. Verifica que las colecciones estén creadas:
   - `planCuentas`
   - `cierresCajaERP`
   - `movimientosContables`

## Contacto

Si el problema persiste, comparte:
1. Captura de la consola con errores
2. Versión de Node.js (`node -v`)
3. Versión de npm (`npm -v`)
