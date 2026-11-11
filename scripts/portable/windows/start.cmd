@echo off
cd /d "%~dp0"
node --use-env-proxy --max-http-header-size=65536 gateway\launch.mjs
