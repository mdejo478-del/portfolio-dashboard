@echo off
title IPMS - local server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dashboard.ps1" %*
