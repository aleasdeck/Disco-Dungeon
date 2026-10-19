@echo off
rem Round 3 of resource art: hungover fly agarics and crystals in a toilet, 3 seeds each into output\resources3\<key>\
chcp 65001 >nul
cd /d "%~dp0..\.."
for %%k in (shrooms3a shrooms3b toilet3a toilet3b) do py -3 generate.py prompts\resources3\%%k.txt -n 3 --width 1024 --height 1024 --out output\resources3\%%k
