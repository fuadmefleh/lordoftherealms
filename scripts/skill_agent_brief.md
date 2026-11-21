# Brief for skill-pack agents (shared rules)

Repo: C:\Users\Nedal\lord_of_the_realms (Windows; Bash tool with POSIX syntax). Read CLAUDE.md and the README.md of each src/ folder you touch.

## The skill system (commit af1f1c8ea; read it first)
- src/systems/practiceSkills.js — levelled skills 1–10 on any holder (`holder.practiceSkills = { id: xp }`), per-level perks from data, level-up events with a text ("Diving rose to level 2 …"), NPC seeding by role/age, daily NPC XP via townsfolk, save/load already persist `practiceSkills`. Diving/swimming (src/player/diving.js, swimming.js, ui/innerMapDiving.js) are the worked example: look at how perks are read (`PracticeSkills.perk(...)` or similar), how XP is granted and how level-ups are announced, and how the character sheet (src/ui/ui/panels.js "Practised Skills") and NPC person cards (src/ui/innerMapUI.js) list skills.
- Data: put YOUR skills in your OWN pack file `data/skillPacks/<pack>.json` (`{ "skills": {...}, "npc": { "base": {...}, "roles": {...}, "dailyXp": {...} } }`), deep-merged into practiceSkills by `npm run build:data`. Do NOT edit data/practiceSkills.json.
- The old continuous `player.skills` / OddJobs.gainXp (0.1 steps) still exists for stealth, diplomacy, crafting etc. Where your skill replaces one, migrate the old value into the new XP (like swimPractice was) and keep anything else that reads the old value working (read the new level, or keep both in step). Don't break other systems.

## Rules
- Never run the full test suite. Lint the files you touch (`npx eslint <files>`) and run targeted spec files only.
- No Math.random in core/world/systems/player (Utils / seeded streams); no domain globals; content in data.
- Make the design calls yourself. Every level must give something the player can feel; show perks on the character sheet; announce level-ups.
- NPCs: seed the matching roles/trades (smiths smithing, poachers stealth, …) and daily XP from their work; where NPCs already do the activity in the sim (hiring, duels, trade, crafting), use their level.
- Other agents are editing in parallel. Keep edits to shared files (panels.js, innerMapUI.js, townsfolk.js, saveLoad.js, practiceSkills.js) small and focused. Before committing, `git diff <file>` each file you stage: if it contains changes that aren't yours, do NOT stage it — leave it and list it in your report for the lead. Never commit data/gamedata.json (the lead rebuilds it). Never `git add -A`, never stash, reset or checkout others' files.
- Commit your work yourself; message ends with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015H8bBwBoYmHtzQn6aSaAEB

## In-game check (required)
- Run your OWN dev server on your assigned port (never touch port 8099 or other agents' ports):
  `cd /c/Users/Nedal/lord_of_the_realms && npm run build:data && npx vite --config "C:/Users/Nedal/AppData/Local/Temp/claude/C--Users-Nedal-lord-of-the-realms/5cb10b3a-946f-44a4-93a3-361b20a7f9bd/scratchpad/vite.test.mjs" --port <PORT> --strictPort` (background). It does not watch files: after edits stop it (PowerShell: `$c=Get-NetTCPConnection -LocalPort <PORT> -State Listen; Stop-Process -Id $c.OwningProcess -Force`) and start it again.
- Use the browser only in a NEW tab you create (tabs_create_mcp) at http://localhost:<PORT>/; close it when done; don't touch other tabs. New game: click (782,392) then (967,690) (take a screenshot first if the layout differs). Get the game object by walking the React fiber from #root for a memoizedState with .world, .player and endDay(); enterInnerMap(q,r); reveal tiles (t.explored=t.visible=true). Fresh games only; don't change the user's saved settings.
- Actually perform the activity, see XP rise, force or reach a level-up, see the perk take effect and the announcement, and open the character sheet.

## Report
What each skill does per level (numbers), how XP is earned, NPC side, files, commit hash, what you saw in game, anything left (including shared files you couldn't commit).
