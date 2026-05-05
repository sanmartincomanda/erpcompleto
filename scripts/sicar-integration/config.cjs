const fs = require('node:fs');
const path = require('node:path');

const { cleanString, toNumber, toBoolean } = require('./helpers.cjs');

const DEFAULT_FIREBASE_WEB_CONFIG = {
    apiKey: 'AIzaSyAGKR9hk1xTFgp4Wzr9ZfnM1KSiIF1VmRE',
    authDomain: 'estado-resultado-nuevo.firebaseapp.com',
    projectId: 'estado-resultado-nuevo',
    storageBucket: 'estado-resultado-nuevo.firebasestorage.app',
    messagingSenderId: '527766169645',
    appId: '1:527766169645:web:e758556d3647d19f0670a4'
};

const DEFAULT_SICAR_PATHS = {
    myIniPath: 'C:\\Program Files (x86)\\SICAR-S-131AB\\MySQL\\MySQL Server 5.6\\my.ini',
    passwordScriptPath: 'C:\\Program Files (x86)\\SICAR-S-131AB\\scripts\\import-racis.bat'
};

const DEFAULT_SYNC_OPTIONS = {
    mode: 'dry-run',
    lookbackDays: 45,
    writeInventoryCache: true,
    seedConfig: false,
    limit: 0,
    modules: ['masters', 'sales', 'ar', 'ap', 'purchases', 'expenses', 'inventory']
};

const MODULE_ALIASES = new Map([
    ['all', DEFAULT_SYNC_OPTIONS.modules],
    ['masters', ['masters']],
    ['catalogs', ['masters']],
    ['clientes', ['masters']],
    ['proveedores', ['masters']],
    ['sales', ['sales']],
    ['ventas', ['sales']],
    ['ar', ['ar']],
    ['cxc', ['ar']],
    ['ap', ['ap']],
    ['cxp', ['ap']],
    ['purchases', ['purchases']],
    ['compras', ['purchases']],
    ['expenses', ['expenses']],
    ['gastos', ['expenses']],
    ['inventory', ['inventory']],
    ['inventario', ['inventory']]
]);

const fileExists = (filePath) => {
    try {
        return fs.existsSync(filePath);
    } catch (error) {
        return false;
    }
};

const safeReadFile = (filePath) => {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return '';
    }
};

const parseArgs = (argv = []) => {
    const options = {
        ...DEFAULT_SYNC_OPTIONS,
        modules: [...DEFAULT_SYNC_OPTIONS.modules]
    };

    for (const rawArg of argv) {
        const arg = cleanString(rawArg);
        if (!arg.startsWith('--')) continue;

        const [rawKey, ...rest] = arg.slice(2).split('=');
        const key = cleanString(rawKey);
        const value = rest.length ? rest.join('=') : '';

        if (key === 'mode') {
            options.mode = cleanString(value) || options.mode;
            continue;
        }

        if (key === 'since') {
            options.sinceDate = cleanString(value) || null;
            continue;
        }

        if (key === 'lookback-days') {
            options.lookbackDays = Math.max(0, toNumber(value, options.lookbackDays));
            continue;
        }

        if (key === 'write-inventory-cache') {
            options.writeInventoryCache = toBoolean(value || 'true');
            continue;
        }

        if (key === 'seed-config') {
            options.seedConfig = value ? toBoolean(value) : true;
            continue;
        }

        if (key === 'limit') {
            options.limit = Math.max(0, toNumber(value, 0));
            continue;
        }

        if (key === 'modules') {
            options.modules = expandModules(value);
            continue;
        }
    }

    if (!options.sinceDate && options.lookbackDays > 0) {
        const baseDate = new Date();
        baseDate.setHours(0, 0, 0, 0);
        baseDate.setDate(baseDate.getDate() - options.lookbackDays);
        options.sinceDate = baseDate.toISOString().slice(0, 10);
    }

    return options;
};

const expandModules = (rawValue) => {
    const rawModules = cleanString(rawValue)
        .split(',')
        .map((item) => cleanString(item).toLowerCase())
        .filter(Boolean);

    if (!rawModules.length) {
        return [...DEFAULT_SYNC_OPTIONS.modules];
    }

    const modules = new Set();
    for (const moduleName of rawModules) {
        const expanded = MODULE_ALIASES.get(moduleName) || [moduleName];
        for (const item of expanded) {
            modules.add(item);
        }
    }

    return [...modules];
};

const discoverMysqlPort = () => {
    const rawMyIni = safeReadFile(DEFAULT_SICAR_PATHS.myIniPath);
    if (!rawMyIni) return 3307;

    const portMatch = rawMyIni.match(/^\s*port\s*=\s*(\d+)/im);
    return portMatch ? Number(portMatch[1]) : 3307;
};

const discoverMysqlPassword = () => {
    const rawScript = safeReadFile(DEFAULT_SICAR_PATHS.passwordScriptPath);
    if (!rawScript) return '';

    const explicitPasswordMatch = rawScript.match(/--password=([^\s"]+)/i);
    if (explicitPasswordMatch) return cleanString(explicitPasswordMatch[1]);

    const compactPasswordMatch = rawScript.match(/\s-p([^\s"]+)/i);
    if (compactPasswordMatch) return cleanString(compactPasswordMatch[1]);

    return '';
};

const resolveMysqlConfig = (env = process.env) => {
    const discoveredPassword = discoverMysqlPassword();
    const host = cleanString(env.SICAR_MYSQL_HOST || env.MYSQL_HOST || '127.0.0.1');
    const port = toNumber(env.SICAR_MYSQL_PORT || env.MYSQL_PORT, discoverMysqlPort());
    const user = cleanString(env.SICAR_MYSQL_USER || env.MYSQL_USER || 'root');
    const password = cleanString(env.SICAR_MYSQL_PASSWORD || env.MYSQL_PASSWORD || discoveredPassword);
    const database = cleanString(env.SICAR_MYSQL_DATABASE || env.MYSQL_DATABASE || 'sicar');

    return {
        host,
        port,
        user,
        password,
        database,
        discovery: {
            hostSource: env.SICAR_MYSQL_HOST || env.MYSQL_HOST ? 'env' : 'default',
            portSource: env.SICAR_MYSQL_PORT || env.MYSQL_PORT ? 'env' : 'auto',
            userSource: env.SICAR_MYSQL_USER || env.MYSQL_USER ? 'env' : 'default',
            passwordSource: env.SICAR_MYSQL_PASSWORD || env.MYSQL_PASSWORD ? 'env' : (discoveredPassword ? 'auto' : 'missing')
        }
    };
};

const resolveFirebaseConfig = (env = process.env) => {
    const privateKey = cleanString(env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n');
    const clientEmail = cleanString(env.FIREBASE_CLIENT_EMAIL);
    const projectId = cleanString(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_WEB_CONFIG.projectId);
    const storageBucket = cleanString(env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_WEB_CONFIG.storageBucket);
    const credentialsPath = cleanString(env.GOOGLE_APPLICATION_CREDENTIALS);

    const adminEnabled = Boolean(projectId && ((clientEmail && privateKey) || credentialsPath));
    const webConfig = {
        apiKey: cleanString(env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE_WEB_CONFIG.apiKey),
        authDomain: cleanString(env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_WEB_CONFIG.authDomain),
        projectId,
        storageBucket,
        messagingSenderId: cleanString(
            env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_WEB_CONFIG.messagingSenderId
        ),
        appId: cleanString(env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_WEB_CONFIG.appId)
    };

    return {
        admin: {
            enabled: adminEnabled,
            projectId,
            storageBucket,
            clientEmail,
            privateKey,
            credentialsPath
        },
        rest: {
            enabled: Boolean(webConfig.projectId && webConfig.apiKey),
            ...webConfig
        }
    };
};

const ensureDirectory = (directoryPath) => {
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
};

const resolveLogDirectory = (repoRoot, env = process.env) => {
    const configuredPath = cleanString(env.SICAR_SYNC_LOG_DIR || 'logs/sicar-sync');
    const absolutePath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repoRoot, configuredPath);

    return ensureDirectory(absolutePath);
};

const loadRuntimeConfig = ({ repoRoot, argv = process.argv.slice(2), env = process.env }) => {
    const cli = parseArgs(argv);
    const mysql = resolveMysqlConfig(env);
    const firebase = resolveFirebaseConfig(env);
    const logDirectory = resolveLogDirectory(repoRoot, env);

    return {
        repoRoot,
        cli,
        mysql,
        firebase,
        logDirectory,
        defaults: {
            firebaseWebProject: DEFAULT_FIREBASE_WEB_CONFIG.projectId,
            sicarPaths: DEFAULT_SICAR_PATHS
        }
    };
};

module.exports = {
    DEFAULT_FIREBASE_WEB_CONFIG,
    DEFAULT_SYNC_OPTIONS,
    DEFAULT_SICAR_PATHS,
    expandModules,
    fileExists,
    loadRuntimeConfig,
    parseArgs,
    resolveFirebaseConfig,
    resolveLogDirectory,
    resolveMysqlConfig
};
