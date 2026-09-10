# Pulso · Monitor de presupuesto

React + backend JavaScript compatible con Vercel Functions + PostgreSQL/Supabase + Supabase Auth. Ollama Cloud analiza únicamente los datos del usuario que hizo la consulta.

Producción: [monitor-presupuesto.vercel.app](https://monitor-presupuesto.vercel.app/).

## Configuración

Node.js 24 recomendado. Instala las dependencias con `npm install` y configura `.env` a partir de `.env.example` sin sobrescribir tus claves existentes:

| Variable | Uso |
|---|---|
| SUPABASE_URL | URL del proyecto monitor-presupuesto |
| SUPABASE_PUBLISHABLE_KEY | Clave publicable o anon; nunca service_role |
| APP_URL | https://monitor-presupuesto.vercel.app |
| OLLAMA_API_KEY | Clave privada de Ollama Cloud |
| OLLAMA_MODEL | gpt-oss:120b-cloud |
| NGROK_AUTHTOKEN | Token privado, sólo para compartir una ejecución local |
| PORT | 3000 |

APP_PASSWORD, DATABASE_URL y DATABASE_AUTH_TOKEN ya no se utilizan. El backend no abre SQLite y no admite sesiones de la antigua contraseña compartida. `.env`, bases locales, exportaciones de datos, claves y ejecutables se excluyen de Git.

## Proyecto Supabase

Nombre solicitado: **monitor-presupuesto**. Ejecuta la migración `supabase/migrations/202609080001_user_isolation.sql` una sola vez mediante una migración de Supabase o su editor SQL.

Configura Authentication:

- Email/password habilitado y registros permitidos.
- **Confirm email desactivado** (`mailer_autoconfirm: true`). El registro debe devolver una sesión inmediatamente.
- Contraseñas de al menos 8 caracteres.
- Site URL: `https://monitor-presupuesto.vercel.app`.
- Redirect URL permitida exacta: `https://monitor-presupuesto.vercel.app/auth/callback`.

No uses un comodín general para las redirecciones. Si cambia el dominio de Vercel, actualiza APP_URL y ambas URLs de Supabase. Con correo/contraseña no se necesita una redirección al ingresar; la ruta callback queda disponible para las devoluciones de Auth y utiliza PKCE. La callback apunta al dominio de Vercel, no al dominio de Supabase.

## Ejecutar

```powershell
npm run dev
```

Para compartir la compilación de producción, en una terminal:

```powershell
npm run build
npm start
```

Para compartir una ejecución local con ngrok, de forma opcional:

```powershell
npm run ngrok
```

La URL de producción es `https://monitor-presupuesto.vercel.app/`. Cada cuenta comienza vacía. La clave de Ollama permanece en el backend. La clave publicable de Supabase es pública por diseño y las políticas RLS protegen los datos.

## Aislamiento y persistencia

Todas las tablas tienen `user_id` vinculado a `auth.users`, RLS habilitado y forzado, y políticas `auth.uid() = user_id` tanto para leer como para escribir. Las tablas son `budget_rows`, `budget_imports`, `budget_messages`, `budget_charts` y `budget_settings`.

Cada petición de la app envía su access token. El servidor lo verifica con Supabase Auth y usa ese mismo JWT para consultar PostgreSQL. No existe un cliente con service_role que eluda RLS, ni se acepta un user_id proporcionado por el navegador como propietario. Las funciones RPC son SECURITY INVOKER y no conceden acceso anónimo.

La clave única de una partida incluye usuario, proyecto, partida y corte: dos usuarios pueden importar CSV idénticos sin compartir datos. La importación de filas y CSV original es atómica, al igual que el guardado de un turno de chat y sus gráficos. Las lecturas de estado son instantáneas consistentes y las revisiones pertenecen a cada usuario. Al salir o cambiar de cuenta se desmonta el panel para descartar datos y solicitudes visuales de la cuenta anterior.

Los originales CSV se almacenan en PostgreSQL bajo RLS, no en un bucket público. Los gráficos conservan especificación y datos de la instantánea. El agente sólo recibe las filas y el historial del propietario de la solicitud.

## Datos anteriores de SQLite

El archivo `data/presupuesto.db` se conserva como respaldo local. No se asignan datos al primer usuario que se registre. La cuenta propietaria se elige explícitamente antes de importar.

```powershell
node scripts/export-legacy.js correo-del-propietario
```

El exportador de sólo lectura genera `.tools/supabase-legacy-migration.sql` (excluido de Git). El usuario debe existir en Supabase Auth. Aplica ese SQL con acceso administrativo al proyecto correcto. El proceso preserva CSV originales, filas, mensajes, gráficos y revisión, y aborta si la cuenta destino contiene datos para no sobrescribirlos. No publica ni borra el respaldo. No ejecutes la exportación otra vez para una cuenta distinta sin autorización del dueño de esos datos.

## CSV y cálculos

Columnas exactas: `partida,presupuesto_inicial,presupuesto_modificado,ejecutado,fecha_corte,proyecto`.

- UTF-8, fecha AAAA-MM-DD e importes no negativos con punto decimal y hasta dos decimales, sin separador de miles. Una sola moneda en cada espacio.
- Máximo 5.000 filas / 2 MB por archivo; 20.000 registros por usuario. Los importes se almacenan en centavos enteros.
- Duplicados dentro del archivo se rechazan. Reimportar la misma clave actualiza sus importes; no elimina las filas ausentes.
- Los totales toman el último corte de cada proyecto hasta la fecha elegida, sin sumar cortes ni arrastrar partidas antiguas ausentes. Cada corte debe incluir todas las partidas.
- Ejecutado se interpreta como acumulado. Modificación = modificado − inicial. Ejecución = ejecutado / modificado × 100; denominador cero queda indefinido.
- Ejecución menor al 80% es señal descriptiva; superior al 100% es exceso. Sin cronograma no se puede afirmar atraso.
- Índice de desviación: `60 × min(1, suma de excesos positivos por partida / modificado total) + 40 × min(1, suma de modificaciones absolutas por partida / inicial total)`. Denominador cero con numerador positivo aporta el máximo; ambos cero, cero. No es probabilidad y no tiene umbrales de alerta aprobados.

## Verificación

```powershell
npm test
npm run build
```

Las pruebas usan PostgreSQL embebido con PGlite y ejecutan la migración real, roles, JWT simulado y RLS. Verifican dos usuarios, acceso anónimo, falsificación de propietario, consultas directas y RPC, escritura/borrado cruzados, importación y chat atómicos. Las pruebas de API simulan Supabase Auth y Ollama; no sustituyen la prueba de registro/login en el proyecto remoto.

La interfaz muestra los últimos 100 mensajes/gráficos y 30 importaciones; los anteriores permanecen en la base. Cada herramienta devuelve hasta 100 filas por página. Los gráficos indican si truncaron datos.

## Vercel

El proyecto incluye `vercel.json`: Vite, salida dist, función `api/index.js` y ruta `/auth/callback`. El proyecto de producción es `monitor-presupuesto` y despliega desde `main`. En Vercel están configuradas `OLLAMA_API_KEY`, `OLLAMA_MODEL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `APP_URL`. Supabase guarda los datos independientemente de las funciones.

Documentación oficial: https://supabase.com/docs/guides/auth/general-configuration, https://supabase.com/docs/guides/database/postgres/row-level-security, https://supabase.com/docs/guides/auth/redirect-urls y https://docs.ollama.com/cloud.
