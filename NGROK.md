# ngrok con Supabase Auth

El agente local está en `.tools/ngrok/ngrok.exe` (excluido de Git). Configura `NGROK_AUTHTOKEN` y las variables de Supabase en `.env`. No se utiliza la antigua APP_PASSWORD.

En Supabase Auth configura Site URL con APP_URL y agrega exactamente `APP_URL/auth/callback` a Redirect URLs. Desactiva Confirm email para entrar inmediatamente después del registro.

```powershell
npm run build
npm start
```

En otra terminal:

```powershell
npm run ngrok
```

El comando verifica que la API rechace usuarios anónimos, utiliza el dominio de APP_URL y desactiva la inspección de cuerpos de solicitudes. El túnel sólo funciona mientras el equipo y ambos procesos estén activos. Ctrl+C lo detiene.

Si cambias el dominio, actualiza APP_URL, Site URL y Redirect URLs en Supabase antes de reiniciar. Los datos están en Supabase, no en el archivo SQLite de respaldo.
