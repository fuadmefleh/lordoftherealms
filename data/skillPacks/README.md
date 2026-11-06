Practised-skill packs. Each `*.json` here is deep-merged into `data/practiceSkills.json`
by `npm run build:data` (objects merge key by key, other values replace; keys starting
with `_` are skipped). Put a group of skills in its own pack:

    { "skills": { "woodcutting": { "name": ..., "perks": {...}, "xp": {...} } },
      "npc": { "base": {...}, "roles": { "woodcutter": {...} }, "dailyXp": {...} } }
