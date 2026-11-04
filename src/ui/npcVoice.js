// The AI voice for a conversation scene (ui/conversationScene.js cfg.voice):
// each line the game has written for a speaker is said again in their own
// words by the language model (systems/npcBrain.js), keeping its facts. Null
// when the AI brain is off, so the scene keeps its written lines.
import { NpcBrain } from '../systems/npcBrain.js';

/**
 * persona: { id, firstName|name, traits?, role, disposition?, worldContext?, memories? }
 * (any field may be a function, read at the moment the line is asked for).
 */
export function npcVoice(persona) {
    if (!NpcBrain.isEnabled()) return null;
    const read = (v) => (typeof v === 'function' ? v() : v);
    return (text, how = {}) => NpcBrain.generateNpcLine(
        { id: read(persona.id), firstName: read(persona.firstName) || read(persona.name), traits: read(persona.traits) || [] },
        {
            topic: how.topic || 'a reply',
            asked: how.asked,
            outcome: how.outcome,
            history: how.history,
            says: text,
            fresh: true, // a new turn of phrase each time, not the cached one
            role: read(persona.role),
            disposition: read(persona.disposition) || 'neutral',
            worldContext: read(persona.worldContext) || '',
            memories: read(persona.memories) || [],
            fallback: text,
        },
    );
}
