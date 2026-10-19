@echo off
rem Round 4 of resource art: ore rock textures, gold nuggets and a rock sketch; stages of the picked mushrooms A2 and toilet B3
chcp 65001 >nul
cd /d "%~dp0..\.."
for %%k in (rock_side_a rock_side_b) do py -3 generate.py prompts\resources4\%%k.txt -n 3 --width 1536 --height 512 --out output\resources4\%%k
for %%k in (rock_top_a rock_top_b gold_nugget gold_cluster rock_full) do py -3 generate.py prompts\resources4\%%k.txt -n 3 --width 1024 --height 1024 --out output\resources4\%%k
for %%k in (shrooms_2 shrooms_1) do py -3 edit.py output\resources3\shrooms3a\shrooms3a_00002_.png prompts\resources4\%%k.txt -n 3 --out output\resources4\%%k
for %%k in (toilet_2 toilet_1) do py -3 edit.py output\resources3\toilet3b\toilet3b_00003_.png prompts\resources4\%%k.txt -n 3 --out output\resources4\%%k
