// ============================================
// LEGENDARY ARTIFACTS — Discovery, fragments, and reforging
// ============================================

const LegendaryArtifacts = {
    _getDefinitions() {
        if (typeof DataLoader !== 'undefined' && DataLoader.artifacts && Array.isArray(DataLoader.artifacts.artifacts)) {
            return DataLoader.artifacts.artifacts;
        }
        return [];
    },

    initialize(player) {
        if (!player.artifacts) {
            player.artifacts = {
                fragments: {},
                forged: [],
                discovered: [],
            };
        }

        if (!player.artifacts.fragments || typeof player.artifacts.fragments !== 'object') {
            player.artifacts.fragments = {};
        }
        if (!Array.isArray(player.artifacts.forged)) {
            player.artifacts.forged = [];
        }
        if (!Array.isArray(player.artifacts.discovered)) {
            player.artifacts.discovered = [];
        }
    },

    getArtifactById(id) {
        return this._getDefinitions().find(artifact => artifact.id === id) || null;
    },

    getFragmentCount(player, artifactId) {
        this.initialize(player);
        return player.artifacts.fragments[artifactId] || 0;
    },

    getForgeableArtifacts(player) {
        this.initialize(player);
        return this._getDefinitions().filter(artifact => {
            if (player.artifacts.forged.includes(artifact.id)) return false;
            return (player.artifacts.fragments[artifact.id] || 0) >= artifact.fragmentsRequired;
        });
    },

    hasForgeableArtifacts(player) {
        return this.getForgeableArtifacts(player).length > 0;
    },

    getProgress(player) {
        this.initialize(player);
        return this._getDefinitions().map(artifact => ({
            ...artifact,
            fragmentsOwned: player.artifacts.fragments[artifact.id] || 0,
            isForged: player.artifacts.forged.includes(artifact.id),
            isDiscovered: player.artifacts.discovered.includes(artifact.id),
            isForgeable: (player.artifacts.fragments[artifact.id] || 0) >= artifact.fragmentsRequired && !player.artifacts.forged.includes(artifact.id),
        }));
    },

    _chooseArtifactForFragment(player, poiType) {
        const progress = this.getProgress(player)
            .filter(artifact => !artifact.isForged)
            .sort((a, b) => a.fragmentsOwned - b.fragmentsOwned);

        if (progress.length === 0) return null;

        const biased = progress.filter(artifact => Array.isArray(artifact.poiBias) && artifact.poiBias.includes(poiType));
        if (biased.length > 0 && Math.random() < 0.75) {
            return Utils.randPick(biased);
        }

        return Utils.randPick(progress);
    },

    _chooseUndiscoveredArtifact(player, poiType) {
        const candidates = this.getProgress(player).filter(artifact => !artifact.isDiscovered && !artifact.isForged);
        if (candidates.length === 0) return null;

        const biased = candidates.filter(artifact => Array.isArray(artifact.poiBias) && artifact.poiBias.includes(poiType));
        if (biased.length > 0 && Math.random() < 0.8) {
            return Utils.randPick(biased);
        }

        return Utils.randPick(candidates);
    },

    discoverFromPOI(player, world, tile, poi) {
        this.initialize(player);
        if (!poi) return { found: false };

        const fragmentChanceByType = {
            ruins: 0.38,
            monument: 0.3,
            cave: 0.26,
            shrine: 0.14,
            oasis: 0.12,
        };

        const directArtifactChanceByType = {
            ruins: 0.05,
            monument: 0.04,
            cave: 0.03,
            shrine: 0.01,
            oasis: 0.01,
        };

        const directChance = directArtifactChanceByType[poi.type] || 0.02;
        const fragmentChance = fragmentChanceByType[poi.type] || 0.16;

        const roll = Math.random();

        if (roll < directChance) {
            const artifact = this._chooseUndiscoveredArtifact(player, poi.type);
            if (artifact) {
                player.artifacts.discovered.push(artifact.id);
                player.artifacts.forged.push(artifact.id);

                const reward = artifact.reforgeRewards || {};
                if (reward.gold) player.gold += reward.gold;
                if (reward.renown) player.renown += reward.renown;
                if (reward.combatSkill) player.skills.combat = Math.min(10, (player.skills.combat || 0) + reward.combatSkill);
                if (reward.diplomacySkill) player.skills.diplomacy = Math.min(10, (player.skills.diplomacy || 0) + reward.diplomacySkill);
                if (reward.cartographySkill) player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + reward.cartographySkill);

                return {
                    found: true,
                    type: 'artifact',
                    artifact,
                    lore: `You recover the complete ${artifact.name}. Some relics survive the ages whole.`,
                };
            }
        }

        if (roll < fragmentChance) {
            const artifact = this._chooseArtifactForFragment(player, poi.type);
            if (!artifact) return { found: false };

            player.artifacts.fragments[artifact.id] = (player.artifacts.fragments[artifact.id] || 0) + 1;
            player.artifacts.discovered = Array.from(new Set([...(player.artifacts.discovered || []), artifact.id]));
            const fragmentsOwned = player.artifacts.fragments[artifact.id];
            const completedSet = fragmentsOwned >= artifact.fragmentsRequired;

            if (typeof Quests !== 'undefined') {
                Quests.generateAvailableQuests(player);
            }

            return {
                found: true,
                type: 'fragment',
                artifact,
                fragmentsOwned,
                fragmentsRequired: artifact.fragmentsRequired,
                completedSet,
                lore: completedSet
                    ? `This fragment completes the set needed to reforge ${artifact.name}.`
                    : `The fragment bears markings matching legends of ${artifact.name}.`,
            };
        }

        return { found: false };
    },

    reforgeArtifact(player, artifactId) {
        this.initialize(player);
        const artifact = this.getArtifactById(artifactId);
        if (!artifact) return { success: false, reason: 'Unknown artifact.' };

        if (player.artifacts.forged.includes(artifact.id)) {
            return { success: false, reason: `${artifact.name} has already been reforged.` };
        }

        const owned = player.artifacts.fragments[artifact.id] || 0;
        if (owned < artifact.fragmentsRequired) {
            return { success: false, reason: `Need ${artifact.fragmentsRequired} fragments (${owned} owned).` };
        }

        player.artifacts.fragments[artifact.id] = owned - artifact.fragmentsRequired;
        player.artifacts.forged.push(artifact.id);

        const reward = artifact.reforgeRewards || {};
        if (reward.gold) player.gold += reward.gold;
        if (reward.renown) player.renown += reward.renown;
        if (reward.combatSkill) player.skills.combat = Math.min(10, (player.skills.combat || 0) + reward.combatSkill);
        if (reward.diplomacySkill) player.skills.diplomacy = Math.min(10, (player.skills.diplomacy || 0) + reward.diplomacySkill);
        if (reward.cartographySkill) player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + reward.cartographySkill);

        if (typeof Quests !== 'undefined') {
            Quests.generateAvailableQuests(player);
        }

        return { success: true, artifact, reward };
    },
};
