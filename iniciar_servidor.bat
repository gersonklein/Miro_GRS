@echo off
title Miro_GRS - Servidor Local
echo ======================================================
echo   Iniciando Miro_GRS (Miro + PureRef + Audio Studio)
echo   Abrindo http://localhost:8080 no seu navegador...
echo ======================================================
start "" "http://localhost:8080"
where python >nul 2>nul
if %errorlevel%==0 (
    python -m http.server 8080
) else (
    npx --yes serve -l 8080
)
pause
