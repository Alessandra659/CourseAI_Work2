# Pulso · Análisis presupuestal de proyectos sociales

Aplicación React con backend JavaScript compatible con Vercel Functions. Guarda partidas, CSV originales, historial de importaciones, conversaciones y gráficos (especificación + datos de la instantánea) en SQLite. Agente con herramientas de cálculo y visualización usando Ollama Cloud, modelo solicitado `gpt-oss:120b-cloud`.

## Ejecutar en tu computadora

Necesitas Node.js 22 o superior (recomendado 24).

```powershell
npm install
Copy-Item .env.example .env
# Edita .env y agrega OLLAMA_API_KEY
npm run dev
```

Abre http://localhost:3000. La base se crea automáticamente en `data/presupuesto.db`. El panel, la carga de CSV y los gráficos manuales funcionan sin API key; el chat explica la configuración pendiente. No hay respuestas de IA simuladas ni datos de ejemplo precargados.

Obtén tu clave en https://ollama.com/settings/keys y guárdala **únicamente en `.env`**, nunca en el frontend ni en Git. Reinicia el servidor al cambiarla. El modelo local se llama `gpt-oss:120b-cloud`; la API directa en `https://ollama.com/api/chat` usa `gpt-oss:120b`, como indica la [documentación de Ollama Cloud](https://docs.ollama.com/cloud). La aplicación traduce ese alias automáticamente. No necesitas instalar Ollama ni descargar 120B en tu computadora.

## Uso

1. Importa un CSV usando el botón superior. Puedes descargar `public/ejemplo-presupuesto.csv` desde la interfaz.
2. Revisa la vista previa y confirma la importación. Se valida todo el archivo antes de guardarlo en una transacción.
3. Selecciona proyecto y fecha máxima de corte. La tabla permite comprobar las partidas.
4. Pregunta por modificaciones, ejecución, evolución de una partida o desviación por proyecto. Para evolución, identifica proyecto y partida.
5. El agente consulta herramientas del backend y crea gráficos en el lienzo. También puedes generar una comparación manual sin IA.
6. Los gráficos y la conversación permanecen al recargar. Los gráficos existentes no cambian al importar nuevos datos; muestran un aviso de versión anterior. Cada gráfico permite descargar su instantánea como JSON o eliminarlo del lienzo.

## CSV y reglas de análisis

Columnas exactas, en cualquier orden:

```csv
partida,presupuesto_inicial,presupuesto_modificado,ejecutado,fecha_corte,proyecto
Alimentación,60000,72000,47000,2026-06-30,Nutrición infantil
```

- UTF-8; separador coma, punto y coma o tabulador autodetectado. Nombres entre comillas si contienen separadores.
- Importes entre 0 y 1.000.000.000 con hasta dos decimales, punto decimal y sin separadores de miles. Se almacenan como **centavos enteros** y se convierten para mostrar y analizar. El límite mantiene exactas las sumas en JavaScript incluso con el máximo de registros.
- Todos los registros del espacio deben usar una misma moneda. No se asume ninguna divisa.
- Fecha real `AAAA-MM-DD`. Máximo 5.000 filas / 2 MB por archivo y 20.000 registros únicos en el espacio.
- Clave única: `(proyecto, partida, fecha_corte)`. Duplicados dentro del archivo se rechazan. Importar otra vez actualiza esa clave; no duplica los montos. Las filas ausentes no se eliminan de la base.
- Un corte debe incluir todas las partidas de un proyecto. Los totales toman el **último corte por proyecto** dentro del filtro de fecha, sin sumar cortes ni arrastrar partidas ausentes de cortes anteriores. Si corriges un corte existente, las claves no incluidas permanecen: la importación es incremental, no una sustitución completa del corte.
- Ejecutado se interpreta como acumulado al corte, no como gasto del período.
- Modificación: modificado − inicial. Porcentaje sobre inicial. Inicial cero → porcentaje indefinido.
- Ejecución: ejecutado / modificado × 100. Modificado cero → porcentaje indefinido. Menos del 80% es una señal descriptiva; más del 100% indica sobre-ejecución. Sin cronograma/metas no se puede afirmar atraso.
- Índice de desviación de proyecto (heurístico, no probabilidad): `60 × min(1, suma de excesos positivos por partida / modificado total) + 40 × min(1, suma de modificaciones absolutas por partida / inicial total)`. Ambos numeradores se calculan por partida para no cancelar excesos con saldos o aumentos con reducciones. Denominador cero con numerador positivo aporta el máximo del componente; ambos cero aporta cero. No penaliza automáticamente baja ejecución.
- El sistema avisa cuando agrega proyectos con cortes diferentes. Para comparaciones estrictas, carga cortes comunes.

## Desplegar en Vercel

Un archivo SQLite dentro de una función **no es almacenamiento persistente**. Por ello se usa SQLite local en desarrollo y una base remota **libSQL** (SQLite) en producción, accesible con `@libsql/client`. No uses una base del nuevo motor Turso incompatible con libSQL: elige una instancia libSQL. Alternativamente ejecuta el backend en un servidor con disco persistente para mantener un archivo SQLite puro.

1. Crea una base remota libSQL (por ejemplo en Turso) y obtén URL y token.
2. Sube este proyecto a tu repositorio e impórtalo en Vercel como aplicación Vite. El proyecto incluye `vercel.json`, build `npm run build`, salida `dist` y función `api/index.js`.
3. Configura las variables de entorno privadas:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `libsql://...` de la base remota |
| `DATABASE_AUTH_TOKEN` | Token de esa base |
| `OLLAMA_API_KEY` | Clave de Ollama Cloud |
| `OLLAMA_MODEL` | `gpt-oss:120b-cloud` |
| `APP_PASSWORD` | Contraseña robusta de al menos 16 caracteres |

4. Despliega. Las tablas se crean de forma idempotente en el primer acceso. El backend bloquea el arranque en Vercel si falta una base remota o la protección del espacio.

La base local no se migra automáticamente: importa tus CSV en el espacio desplegado. Las conversaciones y gráficos locales permanecen en el archivo local. Cada despliegue que use la misma base y contraseña comparte los mismos datos; utiliza bases separadas para pruebas y producción.

Esta versión es un **espacio compartido con contraseña**, no un sistema de cuentas o permisos por proyecto. La sesión dura 8 horas y usa cookie HttpOnly, SameSite y Secure en Vercel. La clave de Ollama nunca llega al navegador. Cambiar APP_PASSWORD invalida sesiones existentes. Para exposición a muchas personas, añade cuentas individuales, límites de uso y protección de intentos de acceso antes de ampliarlo.

La duración máxima configurada es de 300 segundos; depende del plan y configuración de Vercel. El agente limita sus ciclos, tamaño de salida y tiempo, y comunica errores del proveedor. No se ha realizado un despliegue ni una llamada real a Ollama sin credenciales.

## Verificación y estructura

```powershell
npm test
npm run build
npm start
```

- `src/`: interfaz y gráficos Recharts; Markdown seguro sin HTML crudo.
- `api/index.js`: handler Node de Vercel, sesión, importación, consultas, chat y gráficos.
- `server/csv.js`: validación estricta y conversión a centavos.
- `server/db.js`: esquema SQLite, importaciones atómicas e historial.
- `server/analysis.js`: cálculos deterministas y gráficos con datos verificables.
- `server/agent.js`: herramientas del agente y conexión directa a Ollama Cloud. No acepta SQL ni código del modelo.
- `server/dev.js`: servidor local (Vite en desarrollo; `dist` con `npm start`).
- `tests/`: validación, cortes, denominadores cero, riesgo, agente con proveedor simulado y API contra SQLite real.

Las herramientas devuelven páginas de hasta 100 filas; el agente puede paginar. Cada gráfico muestra hasta 100 elementos y declara truncamiento. La interfaz muestra los 100 últimos mensajes, los 100 últimos gráficos y las 30 últimas importaciones; los anteriores permanecen en la base. El contexto del agente incluye los últimos 12 mensajes y hasta 500 pares de nombres para orientación; puede consultar las herramientas para recuperar más datos.

El navegador envía al servidor sólo la pregunta y filtros. El agente envía a Ollama los nombres de proyectos/partidas, resúmenes, las filas consultadas y un tramo del historial. Respeta el contexto de confidencialidad de tus proyectos al usar el servicio cloud. Haz copias del archivo SQLite con el servidor detenido o utiliza respaldos consistentes de tu proveedor remoto.

Referencias: [Ollama Cloud](https://docs.ollama.com/cloud), [API de chat](https://docs.ollama.com/api/chat), [SQLite en Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [cliente libSQL](https://docs.turso.tech/sdk/ts/reference).
