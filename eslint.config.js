import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// ─────────────────────────────────────────────────────────────────────────────
// Guardrail: forbid the domain/simulation layers (core, world, systems, player)
// from reaching through a global `game` / `window.game`. Those layers must
// receive `game` / `world` / `player` as explicit parameters so they stay
// unit-testable in isolation. The single sanctioned global binding lives in the
// UI composition root (src/components/GameView.jsx) and is used only by the
// legacy inline-onclick handler surface in src/ui/**.
//
// The domain layer is now clean, so this is 'error': `npm run lint` fails if any
// new game/window.game global reach is introduced into core/world/systems/player.
// ─────────────────────────────────────────────────────────────────────────────
const DOMAIN_GLOBAL_SEVERITY = 'error';

const noDomainGlobals = {
    'no-restricted-globals': [
        DOMAIN_GLOBAL_SEVERITY,
        {
            name: 'game',
            message:
                'Domain code (core/world/systems/player) must not read a global `game`. Accept `game`/`world`/`player` as a parameter instead.',
        },
    ],
    'no-restricted-syntax': [
        DOMAIN_GLOBAL_SEVERITY,
        {
            selector:
                "MemberExpression[object.type='Identifier'][object.name='window'] > Identifier.property[name='game']",
            message:
                'Domain code (core/world/systems/player) must not read `window.game`. Accept `game`/`world`/`player` as a parameter instead.',
        },
    ],
};

export default [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'dist-web/**',
            'build/**',
            '*.html',
            'scripts/**',
            'electron-main.js',
        ],
    },

    // Base recommended rules for all source, tuned so the pre-existing codebase
    // lints clean today — the meaningful signal is the domain-globals guardrail
    // below, not a flood of legacy style nits.
    js.configs.recommended,
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'off',
            'no-empty': 'off',
            'no-cond-assign': 'off',
            'no-constant-condition': ['warn', { checkLoops: false }],
            'no-fallthrough': 'off',
            'no-prototype-builtins': 'off',
            'no-useless-escape': 'off',
            'no-control-regex': 'off',
            'no-case-declarations': 'off',
            'no-inner-declarations': 'off',
            // Catches missing imports (several features threw ReferenceErrors
            // on use) and stray reads of the removed `game` global.
            'no-undef': 'error',
            // Pre-existing smells in legacy UI code — surfaced as warnings so the
            // scaffold lands green. Worth cleaning up later (Phase 5), not now.
            'no-unreachable': 'warn',
            'no-irregular-whitespace': 'warn',
            'no-constant-binary-expression': 'warn',
        },
    },

    // React shell.
    {
        files: ['src/**/*.jsx'],
        plugins: { react, 'react-hooks': reactHooks },
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        settings: { react: { version: 'detect' } },
        rules: {
            'react/jsx-uses-react': 'off',
            'react/react-in-jsx-scope': 'off',
        },
    },

    // The keystone: domain/simulation layers may not reach for a global.
    {
        files: [
            'src/core/**/*.js',
            'src/world/**/*.js',
            'src/systems/**/*.js',
            'src/player/**/*.js',
        ],
        rules: noDomainGlobals,
    },

    // Tests may use globals freely.
    {
        files: ['src/__tests__/**/*.js'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            'no-restricted-globals': 'off',
            'no-restricted-syntax': 'off',
        },
    },
];
